import json
import pdfplumber
from groq import Groq

GROQ_MODEL = "llama-3.3-70b-versatile"

def extract_text_from_pdf(pdf_path: str) -> str:
    """Extract all text from the resume PDF."""
    text = ""
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
        return text.strip()
    except Exception as e:
        print(f"Error extracting PDF: {e}")
        return ""


def parse_resume_with_groq(api_key: str, resume_text: str) -> dict:
    """
    Use Groq to parse raw resume text into structured data.
    Returns a dict with projects, experience, education, achievements, skills.
    """
    client = Groq(api_key=api_key)

    system_prompt = """You are a resume parser. Given raw resume text, extract structured information.
Return ONLY a valid JSON object with exactly these keys:
- "name": full name of the candidate (string)
- "education": list of objects with keys "degree", "institution", "year" (e.g. B.Tech Chemical Engineering, NIT Durgapur, 2026)
- "projects": list of objects with keys "title" and "description" (1–2 sentence description of what was built and the tech used)
- "experience": list of objects with keys "role", "organization", "duration", "description" (internships, research, jobs)
- "achievements": list of strings (awards, rankings, competitions, publications)
- "skills": list of strings (technical skills extracted from resume)
- "summary": a 2–3 sentence professional summary you generate based on the resume content

Rules:
- Extract maximum 5 projects (most significant ones)
- Extract maximum 4 experience entries
- Extract maximum 5 achievements
- Keep project/experience descriptions concise but specific (mention technologies, outcomes)
- Do not invent information — only extract what is present in the resume
- Return ONLY valid JSON, no extra text"""

    user_prompt = f"""Parse this resume and return structured JSON:

{resume_text}"""

    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt}
        ],
        temperature=0.1,  # Low temperature for accurate extraction
        response_format={"type": "json_object"}
    )

    raw = response.choices[0].message.content
    parsed = json.loads(raw)
    return parsed


def parse_resume(pdf_path: str, groq_api_key: str) -> dict:
    """
    Full pipeline: extract text from PDF → parse with Groq → return structured dict.
    Called when a new resume is uploaded.
    """
    resume_text = extract_text_from_pdf(pdf_path)
    if not resume_text or len(resume_text) < 100:
        raise ValueError("Could not extract meaningful text from the resume PDF. "
                         "Ensure the PDF is not image-only or password-protected.")
    
    structured = parse_resume_with_groq(groq_api_key, resume_text)
    structured["raw_text"] = resume_text  # Store raw text too, for reference
    return structured
