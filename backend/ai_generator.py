"""
Gemini API email generation logic.
Constructs prompts per the spec and returns parsed JSON with subject + body.
"""

import json
import random
import google.generativeai as genai
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


def configure_api(api_key):
    """Configure the Gemini API with the given key."""
    genai.configure(api_key=api_key)


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
    configure_api(api_key)

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
    configure_api(api_key)

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


def _call_gemini(system_prompt, user_prompt, api_key, retries=1):
    """
    Call the Gemini API and parse the JSON response.
    Retries once on parse failure.
    """
    configure_api(api_key)

    model = genai.GenerativeModel(
        model_name="gemini-1.5-flash",
        system_instruction=system_prompt,
        generation_config=genai.GenerationConfig(
            temperature=0.9,
            response_mime_type="application/json",
        ),
    )

    last_error = None
    for attempt in range(1 + retries):
        try:
            # Add random seed variation for uniqueness
            seed_note = f"\n[Variation seed: {random.randint(1000, 9999)}]"
            response = model.generate_content(user_prompt + seed_note)

            text = response.text.strip()

            # Try to extract JSON from the response
            result = json.loads(text)

            if "subject" not in result or "body" not in result:
                raise ValueError("Response missing 'subject' or 'body' keys")

            return result

        except (json.JSONDecodeError, ValueError) as e:
            last_error = e
            if attempt < retries:
                continue
            raise Exception(
                f"Failed to parse Gemini response after {1 + retries} attempts: {e}"
            )
        except Exception as e:
            raise Exception(f"Gemini API error: {e}")
