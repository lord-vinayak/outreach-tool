# Outreach Tool — Claude Context

Automated cold email sending tool built by Vinayak (college student) for internship/job outreach at scale.
AI-generates personalised emails, sends via Gmail, monitors inbox for bounces/replies, manages follow-ups.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Backend | Python 3 / Flask, SQLite (`outreach.db`) |
| Frontend | React + Vite + Tailwind CSS + React Router |
| AI (local/manual) | Groq API — llama-4-scout-17b primary, fallbacks to llama-3.3-70b, qwen3-32b, llama-3.1-8b |
| AI (batch worker) | Google Gemini 2.0 Flash (1500 req/day free) → Groq key 1/2/3 fallback |
| Email send | Gmail SMTP (google.com Workspace, 2000/day hard limit, worker uses 1900) |
| Email recv | Gmail IMAP (inbox monitoring) |
| Resume parsing | pdfplumber + Groq |
| Scheduler | APScheduler (inbox monitor every 10 min) |
| Prod server | gunicorn (`--workers 1`) behind Nginx on EC2 t2.micro |

---

## Repository Layout

```
outreach-tool/
├── backend/
│   ├── app.py              # Flask app, all API routes (~1400 lines)
│   ├── ai_generator.py     # Email generation — Groq + Gemini, cold + follow-up
│   ├── batch_worker.py     # Autonomous daemon (auto_mode campaigns only)
│   ├── quota_tracker.py    # Daily quota tracking per provider → quotas.json
│   ├── db.py               # SQLite init, schema migrations, query helpers
│   ├── config.py           # config.json load/save with defaults
│   ├── email_sender.py     # Gmail SMTP sender (attaches resume.pdf)
│   ├── inbox_monitor.py    # IMAP bounce/OOO detection via Groq classification
│   ├── resume_parser.py    # PDF parsing + Groq structured extraction
│   └── utils.py            # Email list parser, company name resolver via Groq
├── frontend/
│   └── src/
│       ├── App.jsx
│       ├── api.js           # All fetch() calls to /api/*
│       ├── pages/
│       │   ├── Dashboard.jsx
│       │   ├── Campaigns.jsx
│       │   ├── CampaignDetail.jsx
│       │   ├── NewCampaign.jsx   # CSV upload + Auto Worker Mode toggle
│       │   ├── Preview.jsx
│       │   ├── SendProgress.jsx
│       │   ├── Settings.jsx      # Gemini key field + quota status widget
│       │   ├── Profile.jsx
│       │   └── Search.jsx
│       └── components/
│           ├── Navbar.jsx
│           ├── ProgressBar.jsx
│           ├── DuplicateWarning.jsx
│           ├── ContactHistoryPanel.jsx
│           └── ConfirmModal.jsx
└── deploy/
    ├── setup.sh                  # One-shot EC2 Ubuntu setup script
    ├── nginx.conf                # Serves React build, proxies /api/ → Flask
    ├── outreach-api.service      # systemd: gunicorn
    └── outreach-worker.service   # systemd: batch_worker.py
```

---

## Database Schema

```sql
campaigns (id, name, goal, additional_context, auto_mode INTEGER DEFAULT 0, created_at)
recipients (id, campaign_id, email, name, subject, email_body,
            status TEXT DEFAULT 'draft',   -- draft | sent | failed
            sent_at, message_id, error_message,
            follow_up_sent, reply_status,  -- no_reply | check_back | interested |
                                           --   no_openings | invalid_email |
                                           --   final_rejection | interview_scheduled
            reply_content, check_back_date, exclude_followup, status_updated_at)
followups  (id, recipient_id, subject, email_body, status, sent_at, error_message)
blocked_domains (id, domain, reason, blocked_at)
```

---

## Key API Routes (backend/app.py)

| Method | Path | What it does |
|---|---|---|
| GET/POST | `/api/settings` | Read/write config.json |
| GET | `/api/quotas` | Today's provider quota usage (from quota_tracker) |
| GET | `/api/worker/status` | Reads worker_status.json written by batch_worker |
| GET/POST | `/api/campaigns` | List / create campaigns (`auto_mode` flag in POST) |
| GET | `/api/campaigns/<id>` | Campaign + all recipients |
| POST | `/api/generate` | Manual email generation (non-auto campaigns) |
| POST | `/api/send` | Manual send trigger |
| GET | `/api/search` | CRM search across all contacts |

---

## Batch Worker (EC2 autonomous mode)

`backend/batch_worker.py` runs as a systemd service and only touches campaigns with `auto_mode = 1`.

**Loop logic:**
1. Count pending (need generation / need sending)
2. If nothing → idle-poll every 5 min
3. Generate a mini-batch of 15 using best available provider
4. Send one email (with configurable `send_delay_seconds` between sends)
5. If all quotas exhausted → sleep until midnight UTC + 90s buffer

**Provider priority:** Gemini 2.0 Flash → groq_1 → groq_2 → groq_3

**Daily limits in quota_tracker.py:**
```python
DAILY_LIMITS = {
    "gemini":     1500,
    "groq_1":     250,
    "groq_2":     250,
    "groq_3":     250,
    "gmail_sent": 1900,
}
```

**Rate limits to be aware of:**
- Gemini: 15 RPM (per minute) — worker sleeps 4s between calls
- `mark_exhausted(provider)` is only called after all internal retries fail (= confirmed daily limit, NOT RPM 429)

**Runtime files written by worker:**
- `backend/quotas.json` — daily counters, auto-reset at UTC midnight
- `backend/worker_status.json` — last action, timestamp, read by `/api/worker/status`
- `backend/worker.log` — append-only human-readable log

---

## EC2 Deployment

**Instance:** t2.micro, Ubuntu 24.04 LTS, 1GB RAM + 1GB swapfile, EBS SSD
**Region:** ap-south-1 (Mumbai)
**Security group:** ports 22 (SSH) + 80 (HTTP)
**Auth:** SSH key-only (`.pem` file), Nginx HTTP Basic Auth on the UI

**Services:**
```bash
sudo systemctl status outreach-api     # gunicorn Flask
sudo systemctl status outreach-worker  # batch_worker.py
```

**Useful log commands:**
```bash
tail -f /home/ubuntu/outreach-tool/backend/worker.log   # batch worker
tail -f /home/ubuntu/outreach-tool/backend/access.log   # nginx access
tail -f /home/ubuntu/outreach-tool/backend/error.log    # gunicorn errors
sudo journalctl -u outreach-api -f                       # systemd api logs
sudo journalctl -u outreach-worker -f                    # systemd worker logs
```

**Deploy latest code:**
```bash
cd /home/ubuntu/outreach-tool && git pull origin integ-claude
sudo systemctl restart outreach-api outreach-worker
```

**If Gemini 429 immediately after restart (RPM, not daily limit):**
```bash
rm -f /home/ubuntu/outreach-tool/backend/quotas.json
# wait 2 minutes for RPM window to clear
sudo systemctl restart outreach-worker
```

**SSH from Windows Git Bash:**
```bash
ssh -i /d/out/out.pem ubuntu@<EC2-PUBLIC-IP>
```

**Nginx basic auth** protects the UI at port 80. Password is stored at `/etc/nginx/.htpasswd`.

---

## Config Fields (config.json)

```json
{
  "gmail_address": "",
  "gmail_app_password": "",
  "profile": { "name": "", "background": "", "skills": "", "goals": "" },
  "groq_api_key": "",
  "groq_api_key_2": "",
  "groq_api_key_3": "",
  "gemini_api_key": "",
  "send_delay_seconds": 30
}
```

Get Gemini key free at: https://aistudio.google.com/apikey

---

## Active Branch

`integ-claude` — EC2 + Gemini + batch worker integration.

**What was added in this branch vs main:**
- `backend/quota_tracker.py` (new)
- `backend/batch_worker.py` (new)
- `deploy/` directory (new)
- Gemini support in `ai_generator.py` via `google-genai` SDK (NOT deprecated `google-generativeai`)
- `auto_mode` column in campaigns table
- `/api/quotas` and `/api/worker/status` endpoints in `app.py`
- Gemini key field + quota widget in `Settings.jsx`
- CSV upload + Auto Worker Mode toggle in `NewCampaign.jsx`
- `gunicorn` added to `requirements.txt`, `google-genai` replaces `google-generativeai`

---

## Known Gotchas

- **Gemini SDK:** Must use `google-genai` (new). `google-generativeai` v0.8.6 is fully deprecated — API calls hang silently.
- **Gemini model:** Use `gemini-2.0-flash` (not `gemini-1.5-flash` — deprecated, returns 404).
- **t2.micro OOM:** Keep gunicorn at `--workers 1`. Swap is set up at `/swapfile` (1GB).
- **`init_db()` in app.py:** Must run at module import level (not just under `if __name__ == "__main__"`) so gunicorn workers initialise the DB correctly.
- **Windows SSH:** Use Git Bash with `/d/out/out.pem` (not `D:\out\out.pem`).
- **Nginx 500 after setup:** If `www-data` can't read files under `/home/ubuntu/`, run `chmod o+x /home/ubuntu`.
