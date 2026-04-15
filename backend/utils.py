"""
Utility functions for the outreach tool.
Includes robust email list parsing.
"""

import re
import json
from groq import Groq

_company_cache = {}

def resolve_company_name(domain: str, groq_api_key: str) -> str:
    """
    Resolve proper company name from domain using Groq only.
    No web search — Groq's training data knows most companies,
    and can intelligently parse unknown domain names.
    """
    domain_clean = domain.lower().strip()

    if domain_clean in _company_cache:
        return _company_cache[domain_clean]

    fallback = domain_clean.split(".")[0].replace("-", " ").replace("_", " ").title()

    try:
        client = Groq(api_key=groq_api_key)
        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a company name resolver. Given a website domain, return the official "
                        "company/organization name. Use your training knowledge first. If the company "
                        "is not well-known, intelligently parse the domain — e.g. 'nisargaits.com' → "
                        "'Nisarga IT Solutions', 'techaheadcorp.com' → 'TechAhead Corp', "
                        "'logicboots.com' → 'LogicBoots'. "
                        "Return ONLY valid JSON: {\"company_name\": \"Name Here\"}. Never return null."
                    )
                },
                {
                    "role": "user",
                    "content": f"What is the official company name for the domain: {domain_clean}"
                }
            ],
            temperature=0.1,
            response_format={"type": "json_object"}
        )

        result = json.loads(response.choices[0].message.content)
        company_name = result.get("company_name", fallback).strip()

        if not company_name or len(company_name) > 60:
            company_name = fallback

    except Exception as e:
        print(f"Company name lookup failed for {domain_clean}: {e}")
        company_name = fallback

    _company_cache[domain_clean] = company_name
    return company_name
    """
    Resolve a proper company name from an email domain.
    e.g. nisargaits.com → Nisarga IT Solutions
    Falls back to capitalized domain if lookup fails.
    """
    domain_clean = domain.lower().strip()

    # Return cached result if available
    if domain_clean in _company_cache:
        return _company_cache[domain_clean]

    fallback = domain_clean.split(".")[0].capitalize()

    try:
        # Step 1: Quick DuckDuckGo search
        results = []
        with DDGS() as ddgs:
            hits = list(ddgs.text(f"{domain_clean} company", max_results=4))
            results.extend(hits)

        snippets = "\n".join([
            f"Title: {r.get('title', '')}\nSnippet: {r.get('body', '')}"
            for r in results[:4]
        ]) or "No results found."

        # Step 2: Ask Groq to extract the real company name
        client = Groq(api_key=groq_api_key)
        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",  # use fast/cheap model for this simple task
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You extract the official company name from a domain and web search results. "
                        "Return ONLY valid JSON: {\"company_name\": \"Official Name\"} "
                        "If unsure, return the best guess based on the domain. Never return null."
                    )
                },
                {
                    "role": "user",
                    "content": (
                        f"Domain: {domain_clean}\n\n"
                        f"Web search results:\n{snippets}\n\n"
                        f"What is the official company name for this domain?"
                    )
                }
            ],
            temperature=0.1,
            response_format={"type": "json_object"}
        )

        result = json.loads(response.choices[0].message.content)
        company_name = result.get("company_name", fallback).strip()

        # Sanity check — if result is empty or too long, use fallback
        if not company_name or len(company_name) > 60:
            company_name = fallback

    except Exception as e:
        print(f"Company name lookup failed for {domain_clean}: {e}")
        company_name = fallback

    _company_cache[domain_clean] = company_name
    return company_name

EMAIL_REGEX = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")

# Pattern: Name <email>
ANGLE_BRACKET_PATTERN = re.compile(
    r"(.+?)\s*<\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\s*>"
)

# Pattern: Name - email
DASH_PATTERN = re.compile(
    r"(.+?)\s*-\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})"
)


def parse_email_list(raw_text):
    """
    Parse a raw text block containing emails in various formats.
    
    Supported formats:
    - One per line
    - Comma-separated
    - Space-separated
    - Name <email>
    - Name - email
    - Mixed formats
    
    Returns a deduplicated list of {"email": str, "name": str|None} dicts.
    """
    if not raw_text or not raw_text.strip():
        return []

    results = []
    seen_emails = set()

    # Split on newlines first to process line by line
    lines = raw_text.strip().split("\n")

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Try angle bracket pattern: Name <email>
        angle_matches = ANGLE_BRACKET_PATTERN.findall(line)
        if angle_matches:
            for name, email in angle_matches:
                _add_entry(results, seen_emails, email.strip(), name.strip())
            continue

        # Try dash pattern: Name - email
        dash_matches = DASH_PATTERN.findall(line)
        if dash_matches:
            for name, email in dash_matches:
                _add_entry(results, seen_emails, email.strip(), name.strip())
            continue

        # Split on commas and spaces, then extract bare emails
        # Split on commas first
        segments = line.split(",")
        for segment in segments:
            segment = segment.strip()
            if not segment:
                continue

            # Find all emails in this segment
            emails_found = EMAIL_REGEX.findall(segment)
            for email in emails_found:
                _add_entry(results, seen_emails, email, None)

    return results


def _add_entry(results, seen_emails, email, name):
    """Add an email entry if not already seen (case-insensitive dedup)."""
    email_lower = email.lower()
    if email_lower in seen_emails:
        return
    seen_emails.add(email_lower)

    # Clean up the name
    if name:
        name = name.strip().strip('"').strip("'").strip()
        if not name:
            name = None

    results.append({"email": email, "name": name})


# def extract_company_from_email(email):
#     """
#     Extract a company name from an email domain.
#     e.g., john@stripe.com → Stripe
#           hr@big-tech.io  → Big Tech
#     """
#     if not email or "@" not in email:
#         return "the company"

#     domain = email.split("@")[1]
#     # Remove TLD
#     company_part = domain.split(".")[0]
#     # Replace hyphens/underscores with spaces and title-case
#     company_name = company_part.replace("-", " ").replace("_", " ").title()
#     return company_name
