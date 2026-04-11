"""
Groq API email generation logic.
Constructs prompts per the spec and returns parsed JSON with subject + body.
Incorporates resume highlights for personalization.
"""

import json
import random
import time
from groq import Groq
from utils import extract_company_from_email

GROQ_MODEL = "llama-3.3-70b-versatile"

SYSTEM_PROMPT = """You are helping a college student write personalised cold outreach emails for internship/job opportunities.
These emails will be sent directly from the student's Gmail. They must feel like real, human-written emails — not templates, not cover letters, not LinkedIn messages.

MANDATORY EMAIL STRUCTURE (follow this every time):
1. Greeting line: Start with "Hi [Name]," if name is known, or "Hi there," if unknown. Never "Dear Sir/Madam". Never skip the greeting.
2. Opening sentence: A natural, varied opener that isn't "I've been following your work". It could be:
   - A direct, confident intro ("I'm Vinayak, a third-year ChemE student at NIT Durgapur, and I wanted to reach out about...")
   - A brief, genuine observation about the company (only if it feels specific and natural — not forced flattery)
   - Getting straight to the point ("I came across [Company] while researching ML startups and thought I'd reach out directly.")
   Vary this opener every single time. Never repeat the same structure across emails.
3. Middle (2–3 sentences): Briefly state what you're looking for, mention ONE specific thing from your background (a project or experience, one sentence max), and connect it to why you're reaching out to them specifically.
4. Availability + ask (1–2 sentences): Mention availability and end with a soft, specific ask. Vary the closing line — do NOT use the same sentence across emails.
5. Sign-off: "Best," followed by the student's first name on a new line.

BANNED PHRASES (never use any of these):
- "I've been following [X]'s work"
- "I am writing to express my interest"
- "I would be honored"
- "I am a passionate individual"
- "I believe my skills could be a great fit"
- "Would love to hear if there's any opportunity to contribute" (you may vary the sentiment but not reuse this exact line)
- "synergy", "leverage", "cutting-edge", "innovative solutions", "bringing to the table"
- "I hope this email finds you well"
- "Dear Sir/Madam"
- Any phrase that sounds like it was copied from a cover letter template

TONE:
- Semi-formal: professional but conversational — like a confident student emailing a founder, not a formal job application
- Direct and concise — get to the point quickly
- Warm but not sycophantic — genuine, not flattering

LENGTH: 200-240 words for the body (including greeting and sign-off). Shorter is better if the message is complete.

OUTPUT FORMAT: Return ONLY a valid JSON object: {"subject": "...", "body": "..."}
The body must include the greeting line and sign-off. No markdown, no extra text."""


FOLLOWUP_SYSTEM_PROMPT = """You are helping a college student write a brief follow-up email for an unanswered internship/job outreach.

MANDATORY EMAIL STRUCTURE:
1. Greeting: "Hi [Name]," or "Hi there," — same as the original email
2. Opening: A natural reference to the previous email (e.g., "Just wanted to follow up on my note from last week." or "Circling back on my previous email in case it got buried.")
3. Body (1–2 sentences max): A very brief re-statement of interest — do NOT repeat the full pitch
4. Soft closing ask: Low-pressure, open-ended (e.g., "Even a quick note on whether this is the right time would be great.")
5. Sign-off: "Best," + first name

RULES:
- 80–110 words total including greeting and sign-off
- Warm and non-pushy — confident, not desperate
- Do NOT use: "I hope this email finds you well", "I wanted to circle back" as the first three words of every email (vary it), "Dear Sir/Madam"
- Sound like a real person following up, not an automated sequence

OUTPUT FORMAT: Return ONLY valid JSON: {"subject": "Re: [original subject]", "body": "..."}"""


def build_resume_highlights(resume_parsed: dict) -> str:
    """
    Construct a concise resume highlights block for injection into the AI prompt.
    Picks the most relevant projects and one experience entry.
    """
    if not resume_parsed:
        return "No resume data available."
    
    lines = []

    projects = resume_parsed.get("projects", [])
    if projects:
        lines.append("PROJECTS (pick 1–2 most relevant to mention briefly):")
        for p in projects[:4]:  # max 4 projects passed to AI
            title = p.get("title", "")
            desc = p.get("description", "")
            if title:
                lines.append(f"  - {title}: {desc}")

    experience = resume_parsed.get("experience", [])
    if experience:
        lines.append("EXPERIENCE / RESEARCH:")
        for e in experience[:3]:  # max 3 entries
            role = e.get("role", "")
            org = e.get("organization", "")
            desc = e.get("description", "")
            if role:
                lines.append(f"  - {role} at {org}: {desc}")

    achievements = resume_parsed.get("achievements", [])
    if achievements:
        lines.append("NOTABLE ACHIEVEMENTS:")
        for a in achievements[:3]:
            lines.append(f"  - {a}")

    return "\n".join(lines) if lines else "No structured resume data extracted."


def generate_email(profile, recipient, campaign_goal, additional_context, api_key, resume_parsed=None):
    """
    Generate a unique cold outreach email for a single recipient.
    """
    company = extract_company_from_email(recipient["email"])
    recipient_name = recipient.get("name") or "address them naturally without a explicit name if unknown"
    
    resume_block = build_resume_highlights(resume_parsed) if resume_parsed else "Not available."

    user_prompt = f"""Generate a cold outreach email from the following student to the recipient at {company}.

STUDENT PROFILE:
- Name: {profile.get('name', '')}
- College: {profile.get('college', '')}, {profile.get('branch', '')}, {profile.get('year', '')}
- CGPA: {profile.get('cgpa', 'Not specified')}
- Skills: {profile.get('skills', '')}
- Bio: {profile.get('bio', '')}
- GitHub: {profile.get('github', 'Not provided')}
- LinkedIn: {profile.get('linkedin', 'Not provided')}

RESUME HIGHLIGHTS (use to personalise the email — pick 1–2 specific things to naturally mention):
{resume_block}

RECIPIENT:
- Email: {recipient['email']}
- Name: {recipient_name}
- Company: {company}

CAMPAIGN GOAL:
{campaign_goal}

ADDITIONAL CONTEXT:
{additional_context or 'None'}

RESUME HIGHLIGHT RULES:
- Mention exactly ONE project or experience from RESUME HIGHLIGHTS — pick the most relevant to this company's domain
- Keep it to one natural sentence (e.g., "I recently built X that does Y using Z" — not a full description)
- The goal is to intrigue them enough to open the resume, not to summarise it
- Do NOT mention multiple projects
- Do NOT copy the project description verbatim — rephrase naturally

EMAIL STRUCTURE RULES:
- Line 1 must be the greeting: "Hi [Name]," or "Hi there,"
- Vary the opening sentence — do not start with the same phrase as other emails
- Vary the closing ask — do not use identical wording across emails
- The email must read like a natural message — not a list of credentials
- Give proper spacing of 1 blank line between paragraphs. Don't dump every information into 1 single paragraph.

SIGN-OFF:
End the email body with exactly this format (on its own lines, after the main content):

Best,
{profile.get('name', '').split()[0] if profile.get('name') else 'Student'}

Return ONLY valid JSON: {{"subject": "...", "body": "..."}}"""

    return _call_groq(SYSTEM_PROMPT, user_prompt, api_key)


def generate_followup(profile, original_subject, original_body, followup_context, api_key, resume_parsed=None):
    """
    Generate a follow-up email.
    """
    resume_block = build_resume_highlights(resume_parsed) if resume_parsed else "Not available."
    first_name = profile.get('name', '').split()[0] if profile.get('name') else 'Student'

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

RESUME HIGHLIGHTS (optional — only reference if naturally relevant to the follow-up):
{resume_block}

FOLLOW-UP CONTEXT FROM USER:
{followup_context or 'None provided — write a standard polite follow-up.'}

SIGN-OFF:
End the follow-up body with exactly this format:

Best,
{first_name}

Return ONLY valid JSON: {{"subject": "Re: {original_subject}", "body": "..."}}"""

    return _call_groq(FOLLOWUP_SYSTEM_PROMPT, user_prompt, api_key)


def _call_groq(system_prompt, user_prompt, api_key, retries=4, model=GROQ_MODEL):
    """
    Call the Groq API and parse the JSON response.
    Retries on rate limits or service unavailable.
    """
    client = Groq(api_key=api_key)

    last_error = None
    for attempt in range(retries):
        try:
            # Add random seed variation for uniqueness
            seed_note = f"\n[Variation seed: {random.randint(1000, 9999)}]"

            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt + seed_note}
                ],
                temperature=0.9,
                response_format={"type": "json_object"}
            )

            text = response.choices[0].message.content.strip()
            result = json.loads(text)

            if "subject" not in result or "body" not in result:
                raise ValueError("Response missing 'subject' or 'body' keys")

            return result

        except (json.JSONDecodeError, ValueError) as e:
            last_error = e
            if attempt < retries - 1:
                continue
            raise Exception(f"Failed to parse Groq response after {retries} attempts: {e}")
            
        except Exception as e:
            err_str = str(e).upper()
            if "TOKENS PER DAY" in err_str or "REQUESTS PER DAY" in err_str:
                # If we hit a daily limit on the heavy model, fallback to a lighter one
                if model == GROQ_MODEL:
                    print(f"Daily rate limit hit on {model}. Falling back to llama-3.1-8b-instant...")
                    return _call_groq(system_prompt, user_prompt, api_key, retries, model="llama-3.1-8b-instant")
                raise Exception(f"Groq daily rate limit reached on fallback model: {e}")
                
            if "429" in err_str or "RATE_LIMIT" in err_str or "503" in err_str or "UNAVAILABLE" in err_str:
                last_error = e
                wait = 5 * (2 ** attempt)  # 5s, 10s, 20s, 40s
                print(f"Groq API error ({e}) on model {model} — retrying in {wait}s (attempt {attempt+1}/{retries})")
                time.sleep(wait)
            else:
                 raise Exception(f"Groq API error: {e}")

    raise Exception(f"Groq API unavailable/failed after {retries} retries. Last error: {last_error}")
