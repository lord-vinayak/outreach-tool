"""
Utility functions for the outreach tool.
Includes robust email list parsing.
"""

import re
import json
import time
import threading
from datetime import datetime, timezone
from groq import Groq
import db

_company_cache = {}


class GroqRateLimiter:
    """
    Thread-safe pacing gate for a single Groq account.
    Free-tier Groq keys cap out around 8K tokens/minute — well below what
    10 parallel ThreadPoolExecutor workers would otherwise fire at once.
    Blocking here (not by reducing worker count) keeps the actual dispatch
    rate within budget regardless of how much parallelism callers use.
    """

    def __init__(self, min_interval_seconds: float):
        self._min_interval = min_interval_seconds
        self._lock = threading.Lock()
        self._last_call = 0.0

    def wait(self):
        with self._lock:
            now = time.monotonic()
            remaining = self._min_interval - (now - self._last_call)
            if remaining > 0:
                time.sleep(remaining)
            self._last_call = time.monotonic()


# Each configured Groq API key may belong to a different account with its own
# independent rate-limit budget (this app round-robins up to 3 keys), so pacing
# is tracked per key rather than one shared gate that would throttle all keys
# down to a single account's throughput.
_rate_limiters_by_key = {}
_rate_limiters_lock = threading.Lock()


def get_groq_rate_limiter(api_key: str, min_interval_seconds: float = 8) -> GroqRateLimiter:
    with _rate_limiters_lock:
        limiter = _rate_limiters_by_key.get(api_key)
        if limiter is None:
            limiter = GroqRateLimiter(min_interval_seconds)
            _rate_limiters_by_key[api_key] = limiter
        return limiter


def resolve_company_name(domain: str, groq_api_key: str, min_interval_seconds: float = 8) -> str:
    """
    Resolve proper company name from domain using Groq only — always Groq,
    regardless of which provider is writing the email body, so paid
    OpenAI/Anthropic keys never pay for this lookup.
    """
    domain_clean = domain.lower().strip()

    if domain_clean in _company_cache:
        return _company_cache[domain_clean]

    cached = db.query_db(
        "SELECT company_name FROM company_name_cache WHERE domain = ?",
        (domain_clean,),
        one=True,
    )
    if cached:
        _company_cache[domain_clean] = cached["company_name"]
        return cached["company_name"]

    fallback = domain_clean.split(".")[0].replace("-", " ").replace("_", " ").title()
    resolved_by_groq = False

    try:
        get_groq_rate_limiter(groq_api_key, min_interval_seconds).wait()
        client = Groq(api_key=groq_api_key)
        response = client.chat.completions.create(
            model="openai/gpt-oss-20b",
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
        else:
            resolved_by_groq = True

    except Exception as e:
        print(f"Company name lookup failed for {domain_clean}: {e}")
        company_name = fallback

    _company_cache[domain_clean] = company_name

    # Only persist genuine Groq resolutions — a crude domain-parsed fallback
    # (e.g. from a transient API error) shouldn't get locked in permanently.
    if resolved_by_groq:
        db.execute_db(
            "INSERT OR REPLACE INTO company_name_cache (domain, company_name, resolved_at) VALUES (?, ?, ?)",
            (domain_clean, company_name, datetime.now(timezone.utc).isoformat()),
        )
    return company_name


EMAIL_REGEX = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")

# Pattern: Name <email>
ANGLE_BRACKET_PATTERN = re.compile(
    r"(.+?)\s*<\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\s*>"
)

# Pattern: Name - email
# Requires whitespace around the dash so hyphenated local-parts (no-reply@x.com,
# jane-doe@x.com) aren't misread as "name - email" and split apart.
DASH_PATTERN = re.compile(
    r"(.+?)\s+-\s+([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})"
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
