import imaplib
import email
import json
import re
from email.header import decode_header
from datetime import datetime, timezone
from groq import Groq

GROQ_MODEL = "llama-3.1-8b-instant"

def get_imap_connection(gmail_address: str, app_password: str) -> imaplib.IMAP4_SSL:
    """Connect to Gmail via IMAP using App Password."""
    mail = imaplib.IMAP4_SSL("imap.gmail.com", 993)
    mail.login(gmail_address, app_password)
    return mail

def search_bounce_and_ooo_emails(mail: imaplib.IMAP4_SSL) -> list[dict]:
    """
    Search Gmail inbox AND All Mail for:
    1. Bounce/delivery failure notifications (from mailer-daemon/postmaster)
    2. Out-of-office auto-reply emails

    Returns a list of raw parsed email dicts.
    """
    results = []
    folders_to_search = ["INBOX", '"[Gmail]/All Mail"', '"[Gmail]/Spam"', '"[Gmail]/Trash"']

    for folder in folders_to_search:
        try:
            status, _ = mail.select(folder, readonly=True)
            if status != "OK":
                continue

            # Search for bounce notifications
            bounce_criteria = '(OR FROM "mailer-daemon" FROM "postmaster") SINCE "01-Jan-2026"'
            _, bounce_data = mail.search(None, bounce_criteria)

            # Search for out-of-office replies
            ooo_criteria = '(OR SUBJECT "out of office" SUBJECT "auto-reply") SINCE "01-Jan-2026"'
            _, ooo_data = mail.search(None, ooo_criteria)

            all_ids = set()
            for data in [bounce_data, ooo_data]:
                if data and data[0]:
                    all_ids.update(data[0].split())

            for msg_id in list(all_ids)[:100]:  # cap at 100 per folder
                try:
                    _, msg_data = mail.fetch(msg_id, "(RFC822)")
                    raw = msg_data[0][1]
                    parsed = email.message_from_bytes(raw)
                    results.append({
                        "message_id": msg_id.decode(),
                        "folder": folder,
                        "parsed": parsed
                    })
                except Exception:
                    continue

        except Exception:
            continue

    return results

def extract_body(msg) -> str:
    """Extract plain text body from a parsed email message."""
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            if content_type == "text/plain":
                try:
                    body += part.get_payload(decode=True).decode(errors="replace")
                except Exception:
                    pass
    else:
        try:
            body = msg.get_payload(decode=True).decode(errors="replace")
        except Exception:
            pass
    return body[:3000]  # cap to avoid huge payloads to Groq

def classify_email_with_groq(api_key: str, sender: str, subject: str, body: str) -> dict:
    """
    Use Groq to classify a Gmail notification email as:
    - hard_bounce: permanent delivery failure, extract the failed email address
    - out_of_office: auto-reply, extract the return date if mentioned
    - irrelevant: ignore

    Returns a dict with type and extracted data.
    """
    client = Groq(api_key=api_key)

    system_prompt = """You analyze email notification messages and classify them.

Classification rules:
1. "hard_bounce" — permanent delivery failure. Keywords: "does not exist", "user unknown",
   "no such user", "account not found", "invalid address", "550", "551", "553".
   Extract: the email address that FAILED to receive the message (not the sender's address).

2. "out_of_office" — automated away/vacation reply from a real person.
   Keywords: "out of office", "on vacation", "away until", "will be back", "auto-reply",
   "on leave", "returning on".
   Extract: the date they return (if mentioned), and the email address that sent the OOO reply.

3. "irrelevant" — anything else (spam reports, newsletters, unsubscribes, etc.)

Return ONLY valid JSON:
{
  "type": "hard_bounce" | "out_of_office" | "irrelevant",
  "failed_email": "address@domain.com" or null,
  "ooo_sender_email": "address@domain.com" or null,
  "return_date": "YYYY-MM-DD" or null,
  "confidence": 0.0 to 1.0,
  "reason": "one sentence explanation"
}"""

    user_prompt = f"""Classify this email notification:

FROM: {sender}
SUBJECT: {subject}
BODY:
{body}"""


    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.1,
            response_format={"type": "json_object"}
        )
        result = json.loads(response.choices[0].message.content)

        # Validate required keys
        if "type" not in result:
            return {"type": "irrelevant", "confidence": 0.0, "reason": "Parse error"}

        return result
    except Exception as e:
        return {"type": "irrelevant", "confidence": 0.0, "reason": str(e)}

def find_recipient_by_email(conn, email_address: str) -> dict | None:
    """
    Find the most recent recipient record matching the given email address.
    Returns the recipient row as a dict or None if not found.
    """
    cursor = conn.cursor()
    cursor.execute("""
        SELECT r.id, r.email, r.campaign_id, r.reply_status, r.follow_up_sent,
               c.name as campaign_name
        FROM recipients r
        JOIN campaigns c ON r.campaign_id = c.id
        WHERE LOWER(r.email) = LOWER(?)
        ORDER BY r.sent_at DESC
        LIMIT 1
    """, (email_address.strip(),))
    row = cursor.fetchone()
    if row:
        columns = [d[0] for d in cursor.description]
        return dict(zip(columns, row))
    return None

def find_recipient_by_ooo_sender(conn, sender_email: str) -> dict | None:
    """
    Find a recipient record where we sent an email TO this address
    and this address sent back an OOO reply.
    """
    return find_recipient_by_email(conn, sender_email)

def apply_bounce_update(conn, recipient_id: int) -> None:
    """Mark a recipient as invalid_email due to hard bounce."""
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE recipients
        SET reply_status = 'invalid_email',
            exclude_followup = 1,
            status_updated_at = ?,
            error_message = 'Hard bounce — email address does not exist or is unreachable'
        WHERE id = ?
    """, (datetime.now(timezone.utc).isoformat(), recipient_id))
    conn.commit()

def apply_ooo_update(conn, recipient_id: int, return_date: str | None) -> None:
    """
    Set recipient status to check_back with parsed return date.
    Only update if current status is no_reply (don't override manual updates).
    """
    cursor = conn.cursor()

    # Only update if currently no_reply — respect manual status updates
    cursor.execute("SELECT reply_status FROM recipients WHERE id = ?", (recipient_id,))
    row = cursor.fetchone()
    if not row or row[0] != "no_reply":
        return

    cursor.execute("""
        UPDATE recipients
        SET reply_status = 'check_back',
            check_back_date = ?,
            status_updated_at = ?,
            reply_content = 'Auto-detected: Out-of-office reply received.'
        WHERE id = ?
    """, (return_date, datetime.now(timezone.utc).isoformat(), recipient_id))
    conn.commit()

def run_inbox_monitor(config: dict, db_conn) -> dict:
    """
    Full inbox monitoring pipeline:
    1. Connect to Gmail via IMAP
    2. Search inbox + All Mail for bounces and OOO replies
    3. Classify each email with Groq
    4. Match to recipients in DB
    5. Apply status updates
    6. Return a summary of what was found and updated

    Returns:
    {
      "bounces_detected": int,
      "ooo_detected": int,
      "updated": int,
      "skipped": int,  (classified but no matching recipient found)
      "errors": int,
      "details": [ list of action dicts ]
    }
    """
    gmail_address = config.get("gmail_address")
    app_password = config.get("gmail_app_password")
    groq_api_key = config.get("groq_api_key")

    if not all([gmail_address, app_password, groq_api_key]):
        return {"error": "Gmail or Groq credentials not configured"}

    summary = {
        "bounces_detected": 0,
        "ooo_detected": 0,
        "updated": 0,
        "skipped": 0,
        "errors": 0,
        "details": [],
        "last_run": datetime.now(timezone.utc).isoformat()
    }

    try:
        mail = get_imap_connection(gmail_address, app_password)
        emails = search_bounce_and_ooo_emails(mail)
        mail.logout()
    except Exception as e:
        summary["error"] = f"IMAP connection failed: {str(e)}"
        return summary

    seen_emails = set()  # avoid processing same address twice

    for item in emails:
        try:
            msg = item["parsed"]
            sender = msg.get("From", "")
            subject_raw = msg.get("Subject", "")

            # Decode subject
            decoded_parts = decode_header(subject_raw)
            subject = ""
            for part, enc in decoded_parts:
                if isinstance(part, bytes):
                    subject += part.decode(enc or "utf-8", errors="replace")
                else:
                    subject += str(part)

            body = extract_body(msg)
            classification = classify_email_with_groq(groq_api_key, sender, subject, body)

            if classification["type"] == "hard_bounce" and classification.get("confidence", 0) >= 0.75:
                failed_email = classification.get("failed_email")
                if not failed_email or failed_email in seen_emails:
                    continue
                seen_emails.add(failed_email)
                summary["bounces_detected"] += 1

                recipient = find_recipient_by_email(db_conn, failed_email)
                if recipient:
                    apply_bounce_update(db_conn, recipient["id"])
                    summary["updated"] += 1
                    summary["details"].append({
                        "type": "hard_bounce",
                        "email": failed_email,
                        "campaign": recipient["campaign_name"],
                        "action": "Marked as invalid_email"
                    })
                else:
                    summary["skipped"] += 1
                    summary["details"].append({
                        "type": "hard_bounce",
                        "email": failed_email,
                        "action": "No matching recipient found in DB"
                    })

            elif classification["type"] == "out_of_office" and classification.get("confidence", 0) >= 0.70:
                ooo_sender = classification.get("ooo_sender_email")
                if not ooo_sender or ooo_sender in seen_emails:
                    continue
                seen_emails.add(ooo_sender)
                summary["ooo_detected"] += 1

                recipient = find_recipient_by_ooo_sender(db_conn, ooo_sender)
                if recipient:
                    apply_ooo_update(db_conn, recipient["id"], classification.get("return_date"))
                    summary["updated"] += 1
                    summary["details"].append({
                        "type": "out_of_office",
                        "email": ooo_sender,
                        "campaign": recipient["campaign_name"],
                        "return_date": classification.get("return_date"),
                        "action": "Set status to check_back"
                    })
                else:
                    summary["skipped"] += 1

        except Exception:
            summary["errors"] += 1
            continue

    return summary
