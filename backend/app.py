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
from ai_generator import generate_email, generate_followup, generate_contextual_followup
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


@app.route("/api/recipient/<int:recipient_id>/status", methods=["PATCH"])
def update_recipient_status(recipient_id):
    data = request.json or {}
    reply_status = data.get("reply_status", "no_reply")
    reply_content = data.get("reply_content")
    check_back_date = data.get("check_back_date")
    exclude_followup = 1 if reply_status in ["invalid_email", "interview_scheduled", "final_rejection"] else data.get("exclude_followup", 0)
    
    conn = get_db()
    conn.execute(
        "UPDATE recipients SET reply_status = ?, reply_content = ?, check_back_date = ?, exclude_followup = ?, status_updated_at = ? WHERE id = ?",
        (reply_status, reply_content, check_back_date, int(exclude_followup), datetime.utcnow().isoformat(), recipient_id)
    )
    conn.commit()
    conn.close()
    
    recipient = query_db("SELECT * FROM recipients WHERE id = ?", (recipient_id,), one=True)
    return jsonify({"message": "Status updated successfully", "recipient": recipient})

@app.route("/api/campaign/<int:campaign_id>/recipients/status", methods=["PATCH"])
def bulk_update_recipient_statuses(campaign_id):
    data = request.json or {}
    updates = data.get("updates", [])
    conn = get_db()
    for update in updates:
        recipient_id = update["recipient_id"]
        reply_status = update["reply_status"]
        reply_content = update.get("reply_content")
        check_back_date = update.get("check_back_date")
        exclude_followup = 1 if reply_status in ["invalid_email", "interview_scheduled", "final_rejection"] else update.get("exclude_followup", 0)
        
        conn.execute(
            "UPDATE recipients SET reply_status = ?, reply_content = ?, check_back_date = ?, exclude_followup = ?, status_updated_at = ? WHERE id = ? AND campaign_id = ?",
            (reply_status, reply_content, check_back_date, int(exclude_followup), datetime.utcnow().isoformat(), recipient_id, campaign_id)
        )
    conn.commit()
    conn.close()
    return jsonify({"message": "Statuses updated successfully"})

@app.route("/api/campaign/<int:campaign_id>/followup-eligible", methods=["GET"])
def get_followup_eligible(campaign_id):
    recipients = query_db("""
        SELECT * FROM recipients 
        WHERE campaign_id = ? 
        AND status = 'sent' 
        AND follow_up_sent = 0 
        AND exclude_followup = 0 
        AND reply_status NOT IN ('invalid_email', 'interview_scheduled', 'final_rejection')
    """, (campaign_id,))
    return jsonify(recipients)

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


@app.route("/api/campaign/<int:campaign_id>/generate-followups", methods=["POST"])
def generate_followups(campaign_id):
    config = load_config()
    if not config.get("groq_api_key"):
        return jsonify({"error": "Groq API key not configured"}), 400

    data = request.json or {}
    global_context = data.get("global_context", "")
    recipient_ids = data.get("recipient_ids")

    base_query = """
        SELECT * FROM recipients 
        WHERE campaign_id = ? AND status = 'sent' AND follow_up_sent = 0
        AND exclude_followup = 0 
        AND reply_status NOT IN ('invalid_email', 'interview_scheduled', 'final_rejection')
    """
    
    recipients = query_db(base_query, (campaign_id,))
    if recipient_ids:
        recipients = [r for r in recipients if r["id"] in recipient_ids]

    if not recipients:
        return jsonify({"error": "No recipients eligible for follow-up"}), 400

    profile = config.get("profile", {})
    api_key = config["groq_api_key"]
    resume_parsed = config.get("resume_parsed", {})
    errors = []

    conn = get_db()
    for r in recipients:
        try:
            result = generate_contextual_followup(
                profile=profile,
                original_subject=r["subject"],
                original_body=r["email_body"],
                recipient_email=r["email"],
                recipient_name=r["name"],
                reply_status=r["reply_status"] or "no_reply",
                reply_content=r["reply_content"],
                check_back_date=r["check_back_date"],
                global_context=global_context,
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

    generated = query_db("""
        SELECT f.*, r.email as recipient_email, r.name as recipient_name, r.message_id as original_message_id, r.reply_status
        FROM followups f
        JOIN recipients r ON r.id = f.recipient_id
        WHERE r.campaign_id = ? AND f.status = 'draft'
        ORDER BY f.id DESC
    """, (campaign_id,))

    return jsonify({
        "message": f"Generated follow-ups for {len(recipients) - len(errors)} recipients",
        "errors": errors,
        "campaign_id": campaign_id,
        "followups": generated
    })


@app.route("/api/campaign/<int:campaign_id>/followup/preview", methods=["GET"])
def preview_followups(campaign_id):
    """Get follow-up drafts for preview."""
    followups = query_db("""
        SELECT f.*, r.email as recipient_email, r.name as recipient_name, r.message_id as original_message_id, r.reply_status
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


@app.route("/api/dashboard/reply-stats", methods=["GET"])
def reply_stats():
    res = query_db("""
        SELECT reply_status, COUNT(*) as count 
        FROM recipients 
        WHERE status = 'sent' 
        GROUP BY reply_status
    """)
    
    stats_dict = {
        "interested": 0,
        "check_back": 0,
        "no_reply": 0,
        "invalid_email": 0
    }
    
    for row in res:
        key = row["reply_status"] or "no_reply"
        if key in stats_dict:
            stats_dict[key] += row["count"]
            
    return jsonify(stats_dict)

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


# ─── CRM Search Routes ──────────────────────────────────────────────────────────

import urllib.parse

@app.route("/api/search", methods=["GET"])
def search_global():
    query = request.args.get("q", "").strip()
    if not query or len(query) < 2:
        return jsonify({"results": [], "total": 0, "page": 1, "limit": 20, "pages": 0})
        
    status = request.args.get("status")
    days = request.args.get("days")
    campaign_id = request.args.get("campaign_id")
    page = int(request.args.get("page", 1))
    limit = int(request.args.get("limit", 20))
    
    q = f"%{query.lower()}%"
    offset = (page - 1) * limit

    base_sql = """
        SELECT
            r.id,
            r.email,
            r.name,
            c.name as campaign_name,
            r.reply_status,
            r.reply_content,
            r.check_back_date,
            r.follow_up_sent,
            r.sent_at,
            r.subject,
            r.email_body,
            r.status as send_status,
            r.error_message,
            c.id as campaign_id,
            c.goal as campaign_goal,
            c.created_at as campaign_created_at
        FROM recipients r
        JOIN campaigns c ON r.campaign_id = c.id
        WHERE (
            LOWER(r.email) LIKE ?
            OR LOWER(r.name) LIKE ?
            OR LOWER(SUBSTR(r.email, INSTR(r.email, '@') + 1)) LIKE ?
        )
    """

    params = [q, q, q]

    if status and status != "all":
        base_sql += " AND r.reply_status = ?"
        params.append(status)

    if days:
        base_sql += " AND r.sent_at >= datetime('now', ?)"
        params.append(f"-{days} days")

    if campaign_id:
        base_sql += " AND r.campaign_id = ?"
        params.append(campaign_id)

    count_sql = f"SELECT COUNT(*) as cnt FROM ({base_sql})"
    count_res = query_db(count_sql, params, one=True)
    total_count = count_res["cnt"] if count_res else 0

    base_sql += " ORDER BY r.sent_at DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    
    results = query_db(base_sql, params)

    return jsonify({
        "results": results,
        "total": total_count,
        "page": page,
        "limit": limit,
        "pages": (total_count + limit - 1) // limit
    })


@app.route("/api/contact/<path:email>", methods=["GET"])
def contact_history(email):
    email = urllib.parse.unquote(email)
    domain = email.split("@")[-1] if "@" in email else ""
    
    history = query_db("""
        SELECT r.*, c.name as campaign_name 
        FROM recipients r
        JOIN campaigns c ON r.campaign_id = c.id
        WHERE r.email = ?
        ORDER BY r.sent_at DESC
    """, (email,))
    
    for h in history:
        f = query_db("SELECT * FROM followups WHERE recipient_id = ? ORDER BY sent_at DESC LIMIT 1", (h["id"],), one=True)
        if f:
            h["follow_up_body"] = f["email_body"]
            h["follow_up_sent_at"] = f["sent_at"]
        else:
            h["follow_up_body"] = None
            h["follow_up_sent_at"] = None

    same_domain = query_db("""
        SELECT r.email, c.name as campaign_name, r.sent_at, r.reply_status
        FROM recipients r
        JOIN campaigns c ON r.campaign_id = c.id
        WHERE SUBSTR(r.email, INSTR(r.email, '@') + 1) = ? AND r.email != ?
        ORDER BY r.sent_at DESC
    """, (domain, email))
    
    return jsonify({
        "email": email,
        "resolved_name": history[0]["name"] if history and history[0].get("name") else None,
        "domain": domain,
        "company": domain.split(".")[0].capitalize() if domain else None,
        "total_contacts": len(history),
        "history": history,
        "same_domain_contacts": same_domain
    })

@app.route("/api/campaign/check-duplicates", methods=["POST"])
def check_duplicates():
    data = request.json or {}
    emails = data.get("emails", [])
    
    if not emails:
        return jsonify({"duplicates": [], "new_emails": [], "duplicate_count": 0, "new_count": 0})
        
    placeholders = ",".join("?" for _ in emails)
    
    duplicates_res = query_db(f"""
        SELECT r.email, MAX(r.sent_at) as last_contacted, c.name as campaign_name, c.id as campaign_id, r.reply_status, COUNT(*) as times_contacted
        FROM recipients r
        JOIN campaigns c ON r.campaign_id = c.id
        WHERE r.email IN ({placeholders})
        GROUP BY r.email
    """, emails)
    
    dup_emails = {d["email"] for d in duplicates_res}
    new_emails = [e for e in emails if e not in dup_emails]
    
    return jsonify({
        "duplicates": duplicates_res,
        "new_emails": new_emails,
        "duplicate_count": len(duplicates_res),
        "new_count": len(new_emails)
    })

@app.route("/api/reengagement", methods=["GET"])
def reengagement_candidates():
    min_days = int(request.args.get("min_days", 14))
    max_days = int(request.args.get("max_days", 60))
    status_arg = request.args.get("status", "no_reply,check_back")
    statuses = [s.strip() for s in status_arg.split(",")]
    
    placeholders = ",".join("?" for _ in statuses)
    
    query = f"""
        SELECT r.email, r.name, r.sent_at, r.reply_status, c.name as campaign_name, c.id as campaign_id
        FROM recipients r
        JOIN campaigns c ON r.campaign_id = c.id
        WHERE r.sent_at <= datetime('now', ?)
        AND r.sent_at >= datetime('now', ?)
        AND r.reply_status IN ({placeholders})
        AND r.follow_up_sent = 0
        AND r.exclude_followup = 0
        ORDER BY r.sent_at DESC
    """
    
    params = [f"-{min_days} days", f"-{max_days} days"] + statuses
    candidates = query_db(query, params)
    
    return jsonify({"candidates": candidates})


# ─── App Startup ──────────────────────────────────────────────────────────────


if __name__ == "__main__":
    init_db()
    load_config()  # Ensure config.json exists
    app.run(debug=True, port=5000)
