"""
Flask application with all API routes for the outreach tool.
"""

import os
import threading
import time
from datetime import datetime

from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.utils import secure_filename

from config import load_config, save_config, is_profile_complete, is_settings_complete
from db import init_db, get_db, query_db, execute_db
from utils import parse_email_list
from email_sender import send_email
from ai_generator import generate_email, generate_followup
from resume_parser import parse_resume

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# In-memory progress tracking for send jobs
send_progress = {}


# ─── Profile Routes ──────────────────────────────────────────────────────────


@app.route("/api/profile", methods=["GET"])
def get_profile():
    config = load_config()
    return jsonify({
        "profile": config.get("profile", {}),
        "is_complete": is_profile_complete(config),
        "resume_parsed": config.get("resume_parsed", {}),
        "has_resume": os.path.exists(
            os.path.join(UPLOAD_FOLDER, "resume.pdf")
        ),
    })


@app.route("/api/profile", methods=["POST"])
def save_profile():
    config = load_config()
    data = request.json

    if not data:
        return jsonify({"error": "No data provided"}), 400

    profile_fields = [
        "name", "college", "branch", "year",
        "cgpa", "skills", "github", "linkedin", "bio",
    ]
    for field in profile_fields:
        if field in data:
            config["profile"][field] = data[field]

    save_config(config)
    return jsonify({"message": "Profile saved successfully"})


@app.route("/api/upload-resume", methods=["POST"])
def upload_resume():
    if "resume" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["resume"]
    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    if not file.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Only PDF files are accepted"}), 400

    # Check file size (5MB max)
    file.seek(0, os.SEEK_END)
    size = file.tell()
    file.seek(0)
    if size > 5 * 1024 * 1024:
        return jsonify({"error": "File too large. Maximum size is 5MB."}), 400

    filepath = os.path.join(UPLOAD_FOLDER, "resume.pdf")
    file.save(filepath)

    config = load_config()
    config["resume_path"] = filepath
    
    # Trigger parsing automatically if Groq key exists
    groq_api_key = config.get("groq_api_key", "")
    if groq_api_key:
        try:
            parsed = parse_resume(filepath, groq_api_key)
            config["resume_parsed"] = parsed
        except Exception as e:
            print(f"Resume parsing failed: {e}")
            config["resume_parsed"] = {}
    else:
        config["resume_parsed"] = {}

    save_config(config)

    return jsonify({"message": "Resume uploaded successfully", "parsed": config["resume_parsed"]})


@app.route("/api/resume/reparse", methods=["POST"])
def reparse_resume():
    config = load_config()
    groq_api_key = config.get("groq_api_key", "")
    resume_path = config.get("resume_path", os.path.join(UPLOAD_FOLDER, "resume.pdf"))
    
    if not groq_api_key:
        return jsonify({"error": "Groq API key not configured. Go to Settings."}), 400
    
    if not os.path.exists(resume_path):
        return jsonify({"error": "No resume uploaded yet"}), 400
    
    try:
        parsed = parse_resume(resume_path, groq_api_key)
        config["resume_parsed"] = parsed
        save_config(config)
        return jsonify({"success": True, "parsed": parsed})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─── Settings Routes ─────────────────────────────────────────────────────────


@app.route("/api/settings", methods=["GET"])
def get_settings():
    config = load_config()
    return jsonify({
        "gmail_address": config.get("gmail_address", ""),
        "has_gmail_password": bool(config.get("gmail_app_password", "")),
        "has_groq_key": bool(config.get("groq_api_key", "")),
        "send_delay_seconds": config.get("send_delay_seconds", 60),
        "is_complete": is_settings_complete(config),
    })


@app.route("/api/settings", methods=["POST"])
def save_settings():
    config = load_config()
    data = request.json

    if not data:
        return jsonify({"error": "No data provided"}), 400

    if "gmail_address" in data:
        config["gmail_address"] = data["gmail_address"]
    if "gmail_app_password" in data and data["gmail_app_password"]:
        config["gmail_app_password"] = data["gmail_app_password"]
    if "groq_api_key" in data and data["groq_api_key"]:
        config["groq_api_key"] = data["groq_api_key"]
    if "send_delay_seconds" in data:
        delay = int(data["send_delay_seconds"])
        config["send_delay_seconds"] = max(20, min(90, delay))

    save_config(config)
    return jsonify({"message": "Settings saved successfully"})


# ─── Campaign Routes ─────────────────────────────────────────────────────────


@app.route("/api/campaigns", methods=["GET"])
def list_campaigns():
    campaigns = query_db("""
        SELECT c.*, 
               COUNT(r.id) as total_recipients,
               SUM(CASE WHEN r.status = 'sent' THEN 1 ELSE 0 END) as sent_count,
               SUM(CASE WHEN r.status = 'failed' THEN 1 ELSE 0 END) as failed_count
        FROM campaigns c
        LEFT JOIN recipients r ON r.campaign_id = c.id
        GROUP BY c.id
        ORDER BY c.created_at DESC
    """)
    return jsonify(campaigns)


@app.route("/api/campaign/<int:campaign_id>", methods=["GET"])
def get_campaign(campaign_id):
    campaign = query_db(
        "SELECT * FROM campaigns WHERE id = ?", (campaign_id,), one=True
    )
    if not campaign:
        return jsonify({"error": "Campaign not found"}), 404

    recipients = query_db(
        "SELECT * FROM recipients WHERE campaign_id = ? ORDER BY id",
        (campaign_id,),
    )

    # Fetch follow-ups for each recipient
    for r in recipients:
        followups = query_db(
            "SELECT * FROM followups WHERE recipient_id = ? ORDER BY id",
            (r["id"],),
        )
        r["followups"] = followups

    campaign["recipients"] = recipients
    return jsonify(campaign)


@app.route("/api/campaign/new", methods=["POST"])
def create_campaign():
    data = request.json
    if not data:
        return jsonify({"error": "No data provided"}), 400

    name = data.get("name", "").strip()
    goal = data.get("goal", "").strip()
    email_list_raw = data.get("email_list", "").strip()
    additional_context = data.get("additional_context", "").strip()

    if not name:
        return jsonify({"error": "Campaign name is required"}), 400
    if not goal:
        return jsonify({"error": "Campaign goal is required"}), 400
    if not email_list_raw:
        return jsonify({"error": "Email list is required"}), 400

    # Check resume exists
    resume_path = os.path.join(UPLOAD_FOLDER, "resume.pdf")
    if not os.path.exists(resume_path):
        return jsonify({"error": "Please upload your resume in Profile before creating a campaign"}), 400

    # Parse emails
    parsed = parse_email_list(email_list_raw)
    if not parsed:
        return jsonify({"error": "No valid emails found in the list"}), 400

    # Create campaign
    campaign_id = execute_db(
        "INSERT INTO campaigns (name, goal, additional_context) VALUES (?, ?, ?)",
        (name, goal, additional_context or None),
    )

    # Insert recipients as drafts
    conn = get_db()
    for entry in parsed:
        conn.execute(
            "INSERT INTO recipients (campaign_id, email, name, status) VALUES (?, ?, ?, 'draft')",
            (campaign_id, entry["email"], entry.get("name")),
        )
    conn.commit()
    conn.close()

    return jsonify({
        "campaign_id": campaign_id,
        "recipients_count": len(parsed),
        "message": f"Campaign created with {len(parsed)} recipients",
    })


@app.route("/api/campaign/<int:campaign_id>/generate", methods=["POST"])
def generate_campaign_emails(campaign_id):
    """Generate AI emails for all draft recipients in a campaign."""
    config = load_config()

    if not config.get("groq_api_key"):
        return jsonify({"error": "Groq API key not configured. Go to Settings."}), 400

    campaign = query_db(
        "SELECT * FROM campaigns WHERE id = ?", (campaign_id,), one=True
    )
    if not campaign:
        return jsonify({"error": "Campaign not found"}), 404

    recipients = query_db(
        "SELECT * FROM recipients WHERE campaign_id = ? AND status = 'draft'",
        (campaign_id,),
    )
    if not recipients:
        return jsonify({"error": "No draft recipients to generate emails for"}), 400

    profile = config.get("profile", {})
    api_key = config["groq_api_key"]
    resume_parsed = config.get("resume_parsed", {})
    errors = []

    conn = get_db()
    for r in recipients:
        try:
            result = generate_email(
                profile=profile,
                recipient={"email": r["email"], "name": r["name"]},
                campaign_goal=campaign["goal"],
                additional_context=campaign.get("additional_context", ""),
                api_key=api_key,
                resume_parsed=resume_parsed
            )
            conn.execute(
                "UPDATE recipients SET subject = ?, email_body = ? WHERE id = ?",
                (result["subject"], result["body"], r["id"]),
            )
            conn.commit()
        except Exception as e:
            err_msg = str(e)
            errors.append({"email": r["email"], "error": err_msg})
            if "daily rate limit" in err_msg.lower():
                break

    conn.close()

    return jsonify({
        "message": f"Generated emails for {len(recipients) - len(errors)} recipients",
        "errors": errors,
    })


@app.route("/api/campaign/<int:campaign_id>/preview", methods=["GET"])
def preview_campaign(campaign_id):
    """Get all recipients with their generated emails for preview."""
    campaign = query_db(
        "SELECT * FROM campaigns WHERE id = ?", (campaign_id,), one=True
    )
    if not campaign:
        return jsonify({"error": "Campaign not found"}), 404

    recipients = query_db(
        "SELECT * FROM recipients WHERE campaign_id = ? ORDER BY id",
        (campaign_id,),
    )

    return jsonify({
        "campaign": campaign,
        "recipients": recipients,
    })


@app.route("/api/campaign/<int:campaign_id>/recipient/<int:recipient_id>", methods=["PUT"])
def update_recipient(campaign_id, recipient_id):
    """Update a recipient's email subject/body (manual edit)."""
    data = request.json
    if not data:
        return jsonify({"error": "No data provided"}), 400

    conn = get_db()
    if "subject" in data:
        conn.execute(
            "UPDATE recipients SET subject = ? WHERE id = ? AND campaign_id = ?",
            (data["subject"], recipient_id, campaign_id),
        )
    if "email_body" in data:
        conn.execute(
            "UPDATE recipients SET email_body = ? WHERE id = ? AND campaign_id = ?",
            (data["email_body"], recipient_id, campaign_id),
        )
    conn.commit()
    conn.close()

    return jsonify({"message": "Recipient updated"})


@app.route("/api/campaign/<int:campaign_id>/recipient/<int:recipient_id>/regenerate", methods=["POST"])
def regenerate_recipient_email(campaign_id, recipient_id):
    """Regenerate AI email for a single recipient."""
    config = load_config()
    if not config.get("groq_api_key"):
        return jsonify({"error": "Groq API key not configured"}), 400

    campaign = query_db(
        "SELECT * FROM campaigns WHERE id = ?", (campaign_id,), one=True
    )
    recipient = query_db(
        "SELECT * FROM recipients WHERE id = ? AND campaign_id = ?",
        (recipient_id, campaign_id),
        one=True,
    )
    if not campaign or not recipient:
        return jsonify({"error": "Campaign or recipient not found"}), 404

    try:
        result = generate_email(
            profile=config.get("profile", {}),
            recipient={"email": recipient["email"], "name": recipient["name"]},
            campaign_goal=campaign["goal"],
            additional_context=campaign.get("additional_context", ""),
            api_key=config["groq_api_key"],
            resume_parsed=config.get("resume_parsed", {})
        )

        conn = get_db()
        conn.execute(
            "UPDATE recipients SET subject = ?, email_body = ? WHERE id = ?",
            (result["subject"], result["body"], recipient_id),
        )
        conn.commit()
        conn.close()

        return jsonify({
            "subject": result["subject"],
            "body": result["body"],
            "message": "Email regenerated",
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/campaign/<int:campaign_id>/send", methods=["POST"])
def send_campaign(campaign_id):
    """Start sending emails in a background thread."""
    config = load_config()

    if not is_settings_complete(config):
        return jsonify({"error": "Gmail and Gemini credentials not configured. Go to Settings."}), 400

    resume_path = os.path.join(UPLOAD_FOLDER, "resume.pdf")
    if not os.path.exists(resume_path):
        return jsonify({"error": "Resume PDF not found. Upload it in Profile."}), 400

    recipients = query_db(
        "SELECT * FROM recipients WHERE campaign_id = ? AND status = 'draft' AND subject IS NOT NULL",
        (campaign_id,),
    )
    if not recipients:
        return jsonify({"error": "No emails ready to send"}), 400

    # Initialize progress tracking
    send_progress[campaign_id] = {
        "current": 0,
        "total": len(recipients),
        "status": "sending",
        "log": [],
        "current_email": "",
    }

    # Start background thread
    thread = threading.Thread(
        target=_send_campaign_thread,
        args=(campaign_id, recipients, config, resume_path),
        daemon=True,
    )
    thread.start()

    return jsonify({"message": "Sending started", "total": len(recipients)})


def _send_campaign_thread(campaign_id, recipients, config, resume_path):
    """Background thread that sends emails one by one with delay."""
    delay = config.get("send_delay_seconds", 60)
    progress = send_progress[campaign_id]

    for i, r in enumerate(recipients):
        progress["current"] = i + 1
        progress["current_email"] = r["email"]

        conn = get_db()
        try:
            message_id = send_email(
                sender_email=config["gmail_address"],
                sender_name=config["profile"]["name"],
                app_password=config["gmail_app_password"],
                recipient_email=r["email"],
                subject=r["subject"],
                body=r["email_body"],
                resume_path=resume_path,
            )
            conn.execute(
                "UPDATE recipients SET status = 'sent', sent_at = ?, message_id = ? WHERE id = ?",
                (datetime.utcnow().isoformat(), message_id, r["id"]),
            )
            progress["log"].append({
                "email": r["email"],
                "status": "sent",
                "time": datetime.utcnow().isoformat(),
            })
        except Exception as e:
            conn.execute(
                "UPDATE recipients SET status = 'failed', error_message = ? WHERE id = ?",
                (str(e), r["id"]),
            )
            progress["log"].append({
                "email": r["email"],
                "status": "failed",
                "error": str(e),
                "time": datetime.utcnow().isoformat(),
            })
        finally:
            conn.commit()
            conn.close()

        # Wait between emails (skip delay after last one)
        if i < len(recipients) - 1:
            time.sleep(delay)

    progress["status"] = "complete"
    progress["current_email"] = ""


@app.route("/api/campaign/<int:campaign_id>/progress", methods=["GET"])
def get_send_progress(campaign_id):
    """Poll endpoint for send progress."""
    progress = send_progress.get(campaign_id)
    if not progress:
        return jsonify({"status": "idle", "current": 0, "total": 0, "log": []})
    return jsonify(progress)


@app.route("/api/campaign/<int:campaign_id>", methods=["DELETE"])
def delete_campaign(campaign_id):
    """Delete/discard a campaign and its recipients."""
    conn = get_db()
    # Delete followups first (FK constraint)
    conn.execute("""
        DELETE FROM followups WHERE recipient_id IN 
        (SELECT id FROM recipients WHERE campaign_id = ?)
    """, (campaign_id,))
    conn.execute("DELETE FROM recipients WHERE campaign_id = ?", (campaign_id,))
    conn.execute("DELETE FROM campaigns WHERE id = ?", (campaign_id,))
    conn.commit()
    conn.close()
    return jsonify({"message": "Campaign deleted"})


# ─── Follow-up Routes ─────────────────────────────────────────────────────────


@app.route("/api/campaign/<int:campaign_id>/followup/generate", methods=["POST"])
def generate_followups(campaign_id):
    """Generate follow-up emails for sent recipients who haven't been followed up."""
    config = load_config()
    if not config.get("groq_api_key"):
        return jsonify({"error": "Groq API key not configured"}), 400

    data = request.json or {}
    followup_context = data.get("context", "")

    # Get recipients who were sent but not followed up
    recipients = query_db("""
        SELECT * FROM recipients 
        WHERE campaign_id = ? AND status = 'sent' AND follow_up_sent = 0
    """, (campaign_id,))

    if not recipients:
        return jsonify({"error": "No recipients eligible for follow-up"}), 400

    profile = config.get("profile", {})
    api_key = config["groq_api_key"]
    resume_parsed = config.get("resume_parsed", {})
    errors = []

    conn = get_db()
    for r in recipients:
        try:
            result = generate_followup(
                profile=profile,
                original_subject=r["subject"],
                original_body=r["email_body"],
                followup_context=followup_context,
                api_key=api_key,
                resume_parsed=resume_parsed
            )
            conn.execute(
                "INSERT INTO followups (recipient_id, subject, email_body, status) VALUES (?, ?, ?, 'draft')",
                (r["id"], result["subject"], result["body"]),
            )
            conn.commit()
        except Exception as e:
            err_msg = str(e)
            errors.append({"email": r["email"], "error": err_msg})
            if "daily rate limit" in err_msg.lower():
                break

    conn.close()

    return jsonify({
        "message": f"Generated follow-ups for {len(recipients) - len(errors)} recipients",
        "errors": errors,
        "campaign_id": campaign_id,
    })


@app.route("/api/campaign/<int:campaign_id>/followup/preview", methods=["GET"])
def preview_followups(campaign_id):
    """Get follow-up drafts for preview."""
    followups = query_db("""
        SELECT f.*, r.email as recipient_email, r.name as recipient_name, r.message_id as original_message_id
        FROM followups f
        JOIN recipients r ON r.id = f.recipient_id
        WHERE r.campaign_id = ? AND f.status = 'draft'
        ORDER BY f.id
    """, (campaign_id,))

    return jsonify({"followups": followups, "campaign_id": campaign_id})


@app.route("/api/followup/<int:followup_id>", methods=["PUT"])
def update_followup(followup_id):
    """Edit a follow-up email."""
    data = request.json
    if not data:
        return jsonify({"error": "No data provided"}), 400

    conn = get_db()
    if "subject" in data:
        conn.execute("UPDATE followups SET subject = ? WHERE id = ?", (data["subject"], followup_id))
    if "email_body" in data:
        conn.execute("UPDATE followups SET email_body = ? WHERE id = ?", (data["email_body"], followup_id))
    conn.commit()
    conn.close()

    return jsonify({"message": "Follow-up updated"})


@app.route("/api/campaign/<int:campaign_id>/followup/send", methods=["POST"])
def send_followups(campaign_id):
    """Start sending follow-up emails in a background thread."""
    config = load_config()

    if not is_settings_complete(config):
        return jsonify({"error": "Credentials not configured"}), 400

    resume_path = os.path.join(UPLOAD_FOLDER, "resume.pdf")
    if not os.path.exists(resume_path):
        return jsonify({"error": "Resume PDF not found"}), 400

    followups = query_db("""
        SELECT f.*, r.email as recipient_email, r.name as recipient_name, 
               r.message_id as original_message_id, r.id as rid
        FROM followups f
        JOIN recipients r ON r.id = f.recipient_id
        WHERE r.campaign_id = ? AND f.status = 'draft'
        ORDER BY f.id
    """, (campaign_id,))

    if not followups:
        return jsonify({"error": "No follow-ups ready to send"}), 400

    # Use a separate progress key for follow-ups
    progress_key = f"{campaign_id}_followup"
    send_progress[progress_key] = {
        "current": 0,
        "total": len(followups),
        "status": "sending",
        "log": [],
        "current_email": "",
    }

    thread = threading.Thread(
        target=_send_followup_thread,
        args=(campaign_id, followups, config, resume_path, progress_key),
        daemon=True,
    )
    thread.start()

    return jsonify({"message": "Follow-up sending started", "total": len(followups), "progress_key": progress_key})


def _send_followup_thread(campaign_id, followups, config, resume_path, progress_key):
    """Background thread that sends follow-up emails."""
    delay = config.get("send_delay_seconds", 60)
    progress = send_progress[progress_key]

    for i, f in enumerate(followups):
        progress["current"] = i + 1
        progress["current_email"] = f["recipient_email"]

        conn = get_db()
        try:
            message_id = send_email(
                sender_email=config["gmail_address"],
                sender_name=config["profile"]["name"],
                app_password=config["gmail_app_password"],
                recipient_email=f["recipient_email"],
                subject=f["subject"],
                body=f["email_body"],
                resume_path=resume_path,
                reply_to_message_id=f["original_message_id"],
            )
            conn.execute(
                "UPDATE followups SET status = 'sent', sent_at = ? WHERE id = ?",
                (datetime.utcnow().isoformat(), f["id"]),
            )
            conn.execute(
                "UPDATE recipients SET follow_up_sent = 1 WHERE id = ?",
                (f["rid"],),
            )
            progress["log"].append({
                "email": f["recipient_email"],
                "status": "sent",
                "time": datetime.utcnow().isoformat(),
            })
        except Exception as e:
            conn.execute(
                "UPDATE followups SET status = 'failed', error_message = ? WHERE id = ?",
                (str(e), f["id"]),
            )
            progress["log"].append({
                "email": f["recipient_email"],
                "status": "failed",
                "error": str(e),
                "time": datetime.utcnow().isoformat(),
            })
        finally:
            conn.commit()
            conn.close()

        if i < len(followups) - 1:
            time.sleep(delay)

    progress["status"] = "complete"
    progress["current_email"] = ""


@app.route("/api/campaign/<int:campaign_id>/followup/progress", methods=["GET"])
def get_followup_progress(campaign_id):
    """Poll endpoint for follow-up send progress."""
    progress_key = f"{campaign_id}_followup"
    progress = send_progress.get(progress_key)
    if not progress:
        return jsonify({"status": "idle", "current": 0, "total": 0, "log": []})
    return jsonify(progress)


# ─── Dashboard Route ──────────────────────────────────────────────────────────


@app.route("/api/dashboard", methods=["GET"])
def dashboard():
    """Get quick stats for the dashboard."""
    stats = query_db("""
        SELECT 
            (SELECT COUNT(*) FROM campaigns) as total_campaigns,
            (SELECT COUNT(*) FROM recipients WHERE status = 'sent') as total_sent,
            (SELECT COUNT(*) FROM recipients WHERE status = 'failed') as total_failed,
            (SELECT COUNT(*) FROM followups WHERE status = 'sent') as total_followups_sent
    """, one=True)

    recent = query_db("""
        SELECT c.id, c.name, c.created_at, COUNT(r.id) as recipient_count
        FROM campaigns c
        LEFT JOIN recipients r ON r.campaign_id = c.id
        GROUP BY c.id
        ORDER BY c.created_at DESC
        LIMIT 5
    """)

    return jsonify({"stats": stats, "recent_campaigns": recent})


# ─── App Startup ──────────────────────────────────────────────────────────────


if __name__ == "__main__":
    init_db()
    load_config()  # Ensure config.json exists
    app.run(debug=True, port=5000)
