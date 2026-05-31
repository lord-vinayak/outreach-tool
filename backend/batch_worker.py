"""
Autonomous batch worker for large-scale email campaigns.
Run as a systemd service on EC2. Processes campaigns with auto_mode=1,
and handles follow-up generation/sending for any campaign where the user
has clicked "Generate & Send Follow-ups" (followup_queued = 1).

Loop behaviour:
  1. Try to generate a mini-batch of initial emails (respects daily provider quotas).
  2. Generate follow-ups for any campaign with followup_queued=1 (Groq, sequential).
  3. Send one ready email — initial first, then follow-up drafts (gmail_sent quota).
  4. If all quotas exhausted, sleep up to RECHECK_INTERVAL then retry.
  5. If nothing left to do, idle-poll every 5 minutes for new work.
"""

import itertools
import os
import sys
import json
import time
import logging
from datetime import datetime, timezone

# Make sure the backend directory is on the path when run directly
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import load_config
from db import get_db, query_db
from ai_generator import generate_email_auto, generate_contextual_followup
from email_sender import send_email
import quota_tracker

# ── Logging ────────────────────────────────────────────────────────────────────

LOG_PATH    = os.path.join(os.path.dirname(os.path.abspath(__file__)), "worker.log")
STATUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "worker_status.json")

# Per-campaign follow-up job progress (written by worker, read by API).
FOLLOWUP_STATUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "followup_status.json")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [WORKER] %(levelname)s %(message)s",
    handlers=[
        logging.FileHandler(LOG_PATH, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("batch_worker")

RESUME_PATH            = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads", "resume.pdf")
GENERATE_BATCH         = 15   # Initial emails generated per loop iteration
GEMINI_RPM_SLEEP       = 4    # Seconds between Gemini calls  (15 RPM limit)
CEREBRAS_RPM_SLEEP     = 2    # Seconds between Cerebras calls (30 RPM limit)
GROQ_FOLLOWUP_RPM_SLEEP = 2   # Seconds between Groq calls for follow-up generation
RECHECK_INTERVAL       = 1800 # Max sleep when nothing is actionable (30 min cap).


# ── Worker status file ─────────────────────────────────────────────────────────

def _write_status(action: str, extra: dict = None):
    try:
        status = {
            "running":       True,
            "last_activity": datetime.now(timezone.utc).isoformat(),
            "last_action":   action,
            **(extra or {}),
        }
        with open(STATUS_PATH, "w") as f:
            json.dump(status, f, indent=2)
    except Exception:
        pass


def _write_stopped():
    try:
        existing = {}
        if os.path.exists(STATUS_PATH):
            with open(STATUS_PATH) as f:
                existing = json.load(f)
        existing["running"] = False
        with open(STATUS_PATH, "w") as f:
            json.dump(existing, f, indent=2)
    except Exception:
        pass


# ── Follow-up status file ──────────────────────────────────────────────────────
# Single JSON file keyed by campaign_id (as string).
# Read by GET /api/campaign/<id>/followup/auto-progress in app.py.

def _write_followup_status(campaign_id: int, updates: dict):
    """Merge `updates` into the per-campaign entry in followup_status.json."""
    try:
        data = {}
        if os.path.exists(FOLLOWUP_STATUS_PATH):
            with open(FOLLOWUP_STATUS_PATH) as f:
                data = json.load(f)
        key = str(campaign_id)
        if key not in data:
            data[key] = {}
        data[key].update(updates)
        data[key]["campaign_id"] = campaign_id
        data[key]["updated_at"]  = datetime.now(timezone.utc).isoformat()
        with open(FOLLOWUP_STATUS_PATH, "w") as f:
            json.dump(data, f, indent=2)
    except Exception:
        pass


# ── DB helpers — initial emails ────────────────────────────────────────────────

def get_pending_generation(limit: int = GENERATE_BATCH):
    """Recipients that need AI generation (draft, no subject yet, in auto campaigns,
    domain not blocked — no point generating for an address we can never send to)."""
    return query_db("""
        SELECT r.id, r.email, r.name, r.campaign_id,
               c.goal   AS campaign_goal,
               c.additional_context
        FROM   recipients r
        JOIN   campaigns  c ON c.id = r.campaign_id
        WHERE  r.status    = 'draft'
        AND    r.subject   IS NULL
        AND    c.auto_mode = 1
        AND    LOWER(SUBSTR(r.email, INSTR(r.email, '@') + 1))
               NOT IN (SELECT domain FROM blocked_domains)
        ORDER  BY r.id ASC
        LIMIT  ?
    """, (limit,))


def get_next_to_send():
    """Next recipient ready to send (draft, has subject, in auto campaign, domain not blocked)."""
    return query_db("""
        SELECT r.*
        FROM   recipients r
        JOIN   campaigns  c ON c.id = r.campaign_id
        WHERE  r.status     = 'draft'
        AND    r.subject    IS NOT NULL
        AND    c.auto_mode  = 1
        AND    LOWER(SUBSTR(r.email, INSTR(r.email, '@') + 1))
               NOT IN (SELECT domain FROM blocked_domains)
        ORDER  BY r.id ASC
        LIMIT  1
    """, one=True)


def count_pending():
    # Must mirror the WHERE clauses of get_pending_generation / get_next_to_send,
    # INCLUDING the blocked-domain exclusion, to avoid the "counted work that the
    # fetch query won't return → false exhaustion sleep" bug.
    row = query_db("""
        SELECT
            SUM(CASE WHEN r.subject IS NULL  THEN 1 ELSE 0 END) AS need_gen,
            SUM(CASE WHEN r.subject IS NOT NULL THEN 1 ELSE 0 END) AS need_send
        FROM recipients r
        JOIN campaigns c ON c.id = r.campaign_id
        WHERE r.status = 'draft' AND c.auto_mode = 1
        AND   LOWER(SUBSTR(r.email, INSTR(r.email, '@') + 1))
              NOT IN (SELECT domain FROM blocked_domains)
    """, one=True)
    return (row["need_gen"] or 0), (row["need_send"] or 0)


# ── DB helpers — follow-ups ────────────────────────────────────────────────────

def get_best_groq_provider(config: dict):
    """Return (provider_key, api_key) for the first Groq key with remaining quota.
    Returns None if all Groq keys are exhausted or unconfigured.
    Follow-up generation uses Groq (generate_contextual_followup is Groq-only)."""
    candidates = [
        ("groq_1", config.get("groq_api_key",   "").strip()),
        ("groq_2", config.get("groq_api_key_2",  "").strip()),
        ("groq_3", config.get("groq_api_key_3",  "").strip()),
    ]
    for provider, key in candidates:
        if key and quota_tracker.can_use(provider):
            return provider, key
    return None


def get_queued_followup_campaigns():
    """Campaigns flagged for follow-up generation by the worker (followup_queued=1)."""
    return query_db("""
        SELECT id, name, goal, additional_context
        FROM campaigns
        WHERE followup_queued = 1
        ORDER BY id ASC
    """)


def get_followup_eligible_for_campaign(campaign_id: int):
    """Recipients in `campaign_id` that are eligible for a follow-up:
    original email sent, no follow-up yet, not excluded, not terminal reply, domain not blocked."""
    return query_db("""
        SELECT *
        FROM recipients
        WHERE campaign_id = ?
          AND status      = 'sent'
          AND follow_up_sent  = 0
          AND exclude_followup = 0
          AND reply_status NOT IN
              ('invalid_email', 'interview_scheduled', 'final_rejection', 'interested')
          AND LOWER(SUBSTR(email, INSTR(email, '@') + 1))
              NOT IN (SELECT domain FROM blocked_domains)
        ORDER BY id ASC
    """, (campaign_id,))


def get_next_followup_to_send():
    """Next follow-up draft that the worker should send automatically (auto_send=1,
    domain not blocked).  Returns None if nothing is queued."""
    return query_db("""
        SELECT f.*,
               r.email      AS recipient_email,
               r.name       AS recipient_name,
               r.message_id AS original_message_id,
               r.id         AS rid,
               r.campaign_id AS campaign_id
        FROM followups f
        JOIN recipients r ON r.id = f.recipient_id
        WHERE f.status    = 'draft'
          AND f.auto_send = 1
          AND LOWER(SUBSTR(r.email, INSTR(r.email, '@') + 1))
              NOT IN (SELECT domain FROM blocked_domains)
        ORDER BY f.id ASC
        LIMIT 1
    """, one=True)


# ── Core actions — initial emails ──────────────────────────────────────────────

def generate_batch(config: dict) -> int:
    """
    Generate emails for up to GENERATE_BATCH recipients.
    Returns count of successes.
    """
    provider_info = quota_tracker.get_best_generation_provider(config)
    if not provider_info:
        return 0

    provider, api_key = provider_info
    pending = get_pending_generation()
    if not pending:
        return 0

    log.info(f"Generating {len(pending)} emails using [{provider}]...")
    profile       = config.get("profile", {})
    resume_parsed = config.get("resume_parsed", {})
    success = 0

    for r in pending:
        # Re-check quota before each call (another process may have incremented it)
        if not quota_tracker.can_use(provider):
            log.info(f"[{provider}] quota exhausted mid-batch, switching.")
            break

        try:
            result = generate_email_auto(
                profile=profile,
                recipient={"email": r["email"], "name": r["name"]},
                campaign_goal=r["campaign_goal"],
                additional_context=r.get("additional_context") or "",
                api_key=api_key,
                provider=provider,
                resume_parsed=resume_parsed,
            )
            conn = get_db()
            conn.execute(
                "UPDATE recipients SET subject = ?, email_body = ? WHERE id = ?",
                (result["subject"], result["body"], r["id"]),
            )
            conn.commit()
            conn.close()

            quota_tracker.increment(provider)
            success += 1
            log.info(f"  Generated [{provider}]: {r['email']}")

            # Respect provider RPM limits
            if provider == "gemini":
                time.sleep(GEMINI_RPM_SLEEP)
            elif provider == "cerebras":
                time.sleep(CEREBRAS_RPM_SLEEP)

        except Exception as e:
            log.error(f"  Generation failed for {r['email']}: {e}")
            err = str(e).lower()
            if any(x in err for x in ["resource_exhausted", "daily limit", "rate limit", "429"]):
                log.warning(f"  [{provider}] daily limit confirmed — marking exhausted, switching provider.")
                quota_tracker.mark_exhausted(provider)
                break
            if any(x in err for x in ["404", "not_found", "does not exist", "no access", "model_not_found"]):
                log.warning(f"  [{provider}] model not found / no access — marking exhausted, switching provider.")
                quota_tracker.mark_exhausted(provider)
                break
            time.sleep(2)

    return success


def send_one(config: dict) -> bool:
    """Send the next ready initial email.
    Returns True if an email was sent (or failed and marked), False if nothing to send."""
    r = get_next_to_send()
    if not r:
        return False

    if not quota_tracker.can_use("gmail_sent"):
        return False

    try:
        message_id = send_email(
            sender_email=config["gmail_address"],
            sender_name=config["profile"]["name"],
            app_password=config["gmail_app_password"],
            recipient_email=r["email"],
            subject=r["subject"],
            body=r["email_body"],
            resume_path=RESUME_PATH,
        )
        conn = get_db()
        conn.execute(
            "UPDATE recipients SET status = 'sent', sent_at = ?, message_id = ? WHERE id = ?",
            (datetime.utcnow().isoformat(), message_id, r["id"]),
        )
        conn.commit()
        conn.close()

        quota_tracker.increment("gmail_sent")
        log.info(f"  Sent → {r['email']}")
        _write_status(f"Sent → {r['email']}")
        return True

    except Exception as e:
        log.error(f"  Send failed for {r['email']}: {e}")
        conn = get_db()
        conn.execute(
            "UPDATE recipients SET status = 'failed', error_message = ? WHERE id = ?",
            (str(e), r["id"]),
        )
        conn.commit()
        conn.close()
        time.sleep(5)
        return True  # Still "processed" this slot


# ── Core actions — follow-ups ──────────────────────────────────────────────────

def generate_followup_campaign(campaign: dict, config: dict) -> int:
    """Generate follow-up drafts for all eligible recipients in one campaign.

    Uses Groq round-robin across all configured keys (generate_contextual_followup
    is Groq-only).  Quota is tracked via quota_tracker (groq_1/2/3 counters).

    Sets followup_queued=0 on the campaign when done (success or partial failure),
    so the campaign never gets stuck in the queue.  Returns count of drafts created.
    """
    campaign_id   = campaign["id"]
    campaign_name = campaign["name"]

    recipients = get_followup_eligible_for_campaign(campaign_id)
    if not recipients:
        log.info(f"Campaign [{campaign_id}] '{campaign_name}': no eligible recipients for follow-up.")
        conn = get_db()
        conn.execute("UPDATE campaigns SET followup_queued = 0 WHERE id = ?", (campaign_id,))
        conn.commit()
        conn.close()
        _write_followup_status(campaign_id, {
            "status": "complete", "gen_total": 0, "gen_completed": 0, "gen_failed": 0,
            "send_total": 0, "send_current": 0, "sent": 0, "send_failed": 0,
            "current_email": "", "errors": [],
        })
        return 0

    log.info(f"Campaign [{campaign_id}] '{campaign_name}': generating {len(recipients)} follow-ups...")
    _write_followup_status(campaign_id, {
        "status": "generating",
        "gen_total": len(recipients), "gen_completed": 0, "gen_failed": 0,
        "send_total": 0, "send_current": 0, "sent": 0, "send_failed": 0,
        "current_email": "", "errors": [],
    })

    profile       = config.get("profile", {})
    resume_parsed = config.get("resume_parsed", {})

    # Build a round-robin cycle over available Groq keys
    groq_keys = []
    for field in ["groq_api_key", "groq_api_key_2", "groq_api_key_3"]:
        val = config.get(field, "").strip()
        if val:
            groq_keys.append(val)
    key_cycle = itertools.cycle(groq_keys) if groq_keys else None

    success = 0
    errors  = []

    for r in recipients:
        # Check Groq quota before each call
        groq_info = get_best_groq_provider(config)
        if not groq_info:
            log.info(f"  All Groq quotas exhausted mid-follow-up generation for campaign {campaign_id}.")
            errors.append({"email": r["email"], "error": "Groq quota exhausted"})
            break

        provider, _ = groq_info
        api_key = next(key_cycle) if key_cycle else ""

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
                global_context="",
                api_key=api_key,
                resume_parsed=resume_parsed,
            )
            conn = get_db()
            conn.execute(
                "INSERT INTO followups (recipient_id, subject, email_body, status, auto_send) "
                "VALUES (?, ?, ?, 'draft', 1)",
                (r["id"], result["subject"], result["body"]),
            )
            conn.commit()
            conn.close()

            quota_tracker.increment(provider)
            success += 1
            log.info(f"  Follow-up generated [{provider}]: {r['email']}")
            _write_followup_status(campaign_id, {"gen_completed": success})
            time.sleep(GROQ_FOLLOWUP_RPM_SLEEP)

        except Exception as e:
            log.error(f"  Follow-up generation failed for {r['email']}: {e}")
            errors.append({"email": r["email"], "error": str(e)})
            err = str(e).lower()
            if any(x in err for x in ["daily rate limit", "tokens per day", "requests per day",
                                       "resource_exhausted", "daily limit"]):
                quota_tracker.mark_exhausted(provider)
                log.warning(f"  [{provider}] Groq daily limit hit during follow-up generation.")
                break
            time.sleep(2)

    # Count drafts ready to send (what we just inserted)
    send_total_row = query_db("""
        SELECT COUNT(*) AS cnt FROM followups f
        JOIN recipients r ON r.id = f.recipient_id
        WHERE r.campaign_id = ? AND f.status = 'draft' AND f.auto_send = 1
    """, (campaign_id,), one=True)
    send_total = send_total_row["cnt"] if send_total_row else 0

    # Release the queue flag regardless of success/failure
    conn = get_db()
    conn.execute("UPDATE campaigns SET followup_queued = 0 WHERE id = ?", (campaign_id,))
    conn.commit()
    conn.close()

    _write_followup_status(campaign_id, {
        "status":        "sending" if send_total > 0 else "complete",
        "gen_total":     len(recipients),
        "gen_completed": success,
        "gen_failed":    len(recipients) - success,
        "send_total":    send_total,
        "errors":        errors,
    })

    log.info(f"Campaign [{campaign_id}]: follow-up generation done — "
             f"{success}/{len(recipients)} generated, {send_total} drafts queued for send.")
    return success


def send_one_followup(config: dict) -> bool:
    """Send the next auto_send follow-up draft.
    Returns True if a follow-up was sent (or failed and marked), False if none pending."""
    f = get_next_followup_to_send()
    if not f:
        return False

    if not quota_tracker.can_use("gmail_sent"):
        return False

    campaign_id = f["campaign_id"]

    try:
        message_id = send_email(
            sender_email=config["gmail_address"],
            sender_name=config["profile"]["name"],
            app_password=config["gmail_app_password"],
            recipient_email=f["recipient_email"],
            subject=f["subject"],
            body=f["email_body"],
            resume_path=None,   # follow-ups are threaded replies — no resume attachment
            reply_to_message_id=f["original_message_id"],
        )
        conn = get_db()
        conn.execute(
            "UPDATE followups SET status = 'sent', sent_at = ? WHERE id = ?",
            (datetime.utcnow().isoformat(), f["id"]),
        )
        conn.execute(
            "UPDATE recipients SET follow_up_sent = 1 WHERE id = ?",
            (f["rid"],),
        )
        conn.commit()
        conn.close()

        quota_tracker.increment("gmail_sent")
        log.info(f"  Follow-up sent → {f['recipient_email']}")
        _write_status(f"Follow-up sent → {f['recipient_email']}")

        # Update per-campaign progress in followup_status.json
        _increment_followup_send_count(campaign_id, sent=1)
        return True

    except Exception as e:
        log.error(f"  Follow-up send failed for {f['recipient_email']}: {e}")
        conn = get_db()
        conn.execute(
            "UPDATE followups SET status = 'failed', error_message = ? WHERE id = ?",
            (str(e), f["id"]),
        )
        conn.commit()
        conn.close()
        _increment_followup_send_count(campaign_id, failed=1)
        time.sleep(5)
        return True  # Still "processed" this slot


def _increment_followup_send_count(campaign_id: int, sent: int = 0, failed: int = 0):
    """Read-modify-write the send counters in followup_status.json for one campaign."""
    try:
        data = {}
        if os.path.exists(FOLLOWUP_STATUS_PATH):
            with open(FOLLOWUP_STATUS_PATH) as f:
                data = json.load(f)
        key = str(campaign_id)
        if key not in data:
            data[key] = {}
        entry = data[key]
        entry["sent"]        = entry.get("sent", 0) + sent
        entry["send_failed"] = entry.get("send_failed", 0) + failed
        entry["send_current"] = entry.get("send_current", 0) + sent + failed

        # Mark complete when all drafts are accounted for
        total = entry.get("send_total", 0)
        done  = entry.get("send_current", 0)
        if total > 0 and done >= total:
            entry["status"] = "complete"
            entry["current_email"] = ""

        entry["updated_at"] = datetime.now(timezone.utc).isoformat()
        with open(FOLLOWUP_STATUS_PATH, "w") as f:
            json.dump(data, f, indent=2)
    except Exception:
        pass


# ── Main loop ──────────────────────────────────────────────────────────────────

def run():
    log.info("=" * 60)
    log.info("Batch worker started.")
    log.info("=" * 60)
    _write_status("Worker started")

    try:
        while True:
            config = load_config()

            need_gen, need_send       = count_pending()
            followup_campaigns        = get_queued_followup_campaigns()
            has_followup_drafts       = get_next_followup_to_send() is not None

            nothing_to_do = (
                need_gen == 0 and need_send == 0
                and len(followup_campaigns) == 0 and not has_followup_drafts
            )
            if nothing_to_do:
                log.info("Nothing pending. Idling — will check again in 5 min.")
                _write_status("Idle — no pending work")
                time.sleep(300)
                continue

            did_something = False

            # ── Generate a mini-batch of initial emails ────────────────────
            if need_gen > 0:
                provider_info = quota_tracker.get_best_generation_provider(config)
                if provider_info:
                    n = generate_batch(config)
                    if n > 0:
                        did_something = True
                        quotas = quota_tracker.get_quotas()
                        _write_status(
                            f"Generated {n} emails",
                            {
                                "pending_generation": need_gen - n,
                                "pending_sending":    need_send,
                                "quotas_remaining":   quotas["remaining"],
                            },
                        )
                    elif quota_tracker.get_best_generation_provider(config):
                        # Provider was marked exhausted mid-batch (e.g. 404/model error)
                        # but another is available — keep looping, don't sleep.
                        log.info("Provider failed and was marked exhausted — retrying with next provider.")
                        did_something = True
                else:
                    log.info("All generation quotas exhausted for today.")

            # ── Generate follow-ups for queued campaigns ───────────────────
            for campaign in followup_campaigns:
                if not get_best_groq_provider(config):
                    log.info("No Groq quota available for follow-up generation — skipping.")
                    break
                generate_followup_campaign(campaign, config)
                did_something = True   # campaign was dequeued regardless of partial failure

            # ── Send one email (initial first, then follow-up) ─────────────
            if need_send > 0 or has_followup_drafts:
                if quota_tracker.can_use("gmail_sent"):
                    # Initial emails take priority; fall back to follow-up drafts.
                    sent = send_one(config)
                    if not sent:
                        sent = send_one_followup(config)
                    if sent:
                        did_something = True
                        delay = config.get("send_delay_seconds", 30)
                        time.sleep(delay)
                else:
                    log.info("Gmail daily limit reached (1900). Waiting for midnight UTC.")

            # ── Sleep if nothing was actionable ────────────────────────────
            # Cap at RECHECK_INTERVAL so a stall just after midnight (where
            # seconds_until_midnight_utc ≈ 24h) can't park the worker all day.
            if not did_something:
                secs_to_midnight = quota_tracker.seconds_until_midnight_utc()
                sleep_secs = min(secs_to_midnight, RECHECK_INTERVAL)
                log.info(
                    f"Nothing actionable (quotas exhausted or no sendable work). "
                    f"Sleeping {sleep_secs / 60:.0f} min then re-checking "
                    f"(midnight reset in {secs_to_midnight / 3600:.1f}h)."
                )
                _write_status(
                    f"Idle/exhausted — re-checking in {sleep_secs / 60:.0f} min",
                    {"sleep_until_utc": (datetime.now(timezone.utc).isoformat())},
                )
                time.sleep(sleep_secs)

    except KeyboardInterrupt:
        log.info("Worker stopped by user.")
    except Exception as e:
        log.exception(f"Worker crashed: {e}")
    finally:
        _write_stopped()


if __name__ == "__main__":
    run()
