"""
Gemini API email generation logic.
Constructs prompts per the spec and returns parsed JSON with subject + body.
"""

import time
import json
import random
from google import genai
from google.genai import types
from utils import extract_company_from_email


SYSTEM_PROMPT = """You are helping a college student write personalized cold outreach emails for internship/job opportunities. 
Your emails must:
- Sound completely human and natural — NOT like an AI template or a generic cold email
- Be semi-formal in tone (friendly but professional — like an email from a smart, confident student)
- Be specific and unique to this recipient — reference their company name or domain where possible
- NOT use generic phrases like "I hope this email finds you well", "I am writing to express my interest", 
  "I would be honored", "I am a passionate individual", "synergy", "leverage", "cutting-edge", or any 
  corporate buzzword
- NOT start with the subject or with "Dear Sir/Madam"
- NOT sound like a cover letter
- Be 150–220 words for the body (not too short, not too long)
- Have a natural, slightly casual opening that feels like a real person wrote it
- End with a specific, low-pressure ask (e.g., "Would love to hear if there's any opportunity to contribute")
- Include a subject line that is specific, concise, and not generic (avoid "Internship Application" as the entire subject)
- Output format: Return ONLY a JSON object with two keys: "subject" and "body". No extra text."""


FOLLOWUP_SYSTEM_PROMPT = """You are helping a college student write a follow-up email. The student sent an initial outreach email and hasn't received a response.
Your follow-up must:
- Be brief (80–120 words)
- Be warm and non-pushy — not desperate
- Reference the original email naturally
- End with a soft, open-ended ask
- Output format: Return ONLY a JSON object with two keys: "subject" and "body". No extra text."""


def _get_client(api_key):
    """Create a Gemini API client with the given key."""
    return genai.Client(api_key=api_key)


def generate_email(profile, recipient, campaign_goal, additional_context, api_key):
    """
    Generate a unique cold outreach email for a single recipient.

    Args:
        profile: dict with name, college, branch, year, cgpa, skills, github, linkedin, bio
        recipient: dict with email, name (nullable)
        campaign_goal: str describing the campaign objective
        additional_context: str with extra info (optional)
        api_key: Gemini API key

    Returns:
        dict with "subject" and "body" keys, or raises Exception
    """
    # Client is created per-call in _call_gemini

    company = extract_company_from_email(recipient["email"])
    recipient_name = recipient.get("name") or "Unknown — address them naturally without a name"

    user_prompt = f"""Generate a cold outreach email from the following student to the recipient at {company}.

STUDENT PROFILE:
- Name: {profile.get('name', '')}
- College: {profile.get('college', '')}, {profile.get('branch', '')}, {profile.get('year', '')}
- CGPA: {profile.get('cgpa', 'Not provided')}
- Skills: {profile.get('skills', '')}
- Bio: {profile.get('bio', '')}
- GitHub: {profile.get('github', 'Not provided')}
- LinkedIn: {profile.get('linkedin', 'Not provided')}

RECIPIENT:
- Email: {recipient['email']}
- Name: {recipient_name}
- Company: {company}

CAMPAIGN GOAL:
{campaign_goal}

ADDITIONAL CONTEXT:
{additional_context or 'None'}

IMPORTANT: Make this email feel completely unique and human. Vary the structure, opening line, and phrasing 
from any other emails you generate in this session. Do not reuse the same opening sentence across emails.
Reference the company name naturally where it fits.

Return ONLY valid JSON: {{"subject": "...", "body": "..."}}"""

    return _call_gemini(SYSTEM_PROMPT, user_prompt, api_key)


def generate_followup(profile, original_subject, original_body, followup_context, api_key):
    """
    Generate a follow-up email for a recipient who hasn't responded.

    Returns:
        dict with "subject" and "body" keys
    """
    # Client is created per-call in _call_gemini

    user_prompt = f"""Generate a follow-up email that will be sent as a reply to the email thread below.

The student is following up because they haven't received a response. The tone should be:
- Brief (80–120 words)
- Warm and non-pushy — not desperate
- Reference the original email naturally ("just wanted to follow up on my previous message")
- End with a soft, open-ended ask

ORIGINAL EMAIL SENT:
Subject: {original_subject}
Body: {original_body}

STUDENT PROFILE:
- Name: {profile.get('name', '')}
- College: {profile.get('college', '')}, {profile.get('branch', '')}, {profile.get('year', '')}
- Skills: {profile.get('skills', '')}

FOLLOW-UP CONTEXT FROM USER:
{followup_context or 'None provided — write a standard polite follow-up.'}

Return ONLY valid JSON: {{"subject": "Re: {original_subject}", "body": "..."}}"""

    return _call_gemini(FOLLOWUP_SYSTEM_PROMPT, user_prompt, api_key)


def _call_gemini(system_prompt, user_prompt, api_key, retries=4):
    """
    Call the Gemini API and parse the JSON response.
    Retries on parse failure or 503/UNAVAILABLE errors with exponential backoff.
    """
    client = _get_client(api_key)

    last_error = None
    for attempt in range(retries):
        try:
            # Add random seed variation for uniqueness
            seed_note = f"\n[Variation seed: {random.randint(1000, 9999)}]"

            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=user_prompt + seed_note,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=0.9,
                    response_mime_type="application/json",
                ),
            )

            text = response.text.strip()

            # Try to extract JSON from the response
            result = json.loads(text)

            if "subject" not in result or "body" not in result:
                raise ValueError("Response missing 'subject' or 'body' keys")

            return result

        except (json.JSONDecodeError, ValueError) as e:
            last_error = e
            if attempt < retries - 1:
                continue
            raise Exception(f"Failed to parse Gemini response after {retries} attempts: {e}")
            
        except Exception as e:
            if "503" in str(e) or "UNAVAILABLE" in str(e):
                last_error = e
                wait = 10 * (2 ** attempt)  # 10s, 20s, 40s, 80s
                print(f"Gemini 503/UNAVAILABLE — retrying in {wait}s (attempt {attempt+1}/{retries})")
                time.sleep(wait)
            else:
                raise # re-raise non-503 errors immediately

    raise Exception(f"Gemini API unavailable/failed after {retries} retries. Try again later. Last error: {last_error}")
