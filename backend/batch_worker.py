"""
Autonomous batch worker for large-scale email campaigns.
Run as a systemd service on EC2. Processes campaigns with auto_mode=1.

Loop behaviour:
  1. Try to generate a mini-batch of emails (respects daily provider quotas).
  2. Try to send one ready email (respects Gmail 1900/day limit).
  3. If all quotas exhausted, sleep until midnight UTC and retry.
  4. If nothing left to do, idle-poll every 5 minutes for new campaigns.
"""

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
from ai_generator import generate_email_auto
from email_sender import send_email
import quota_tracker

# ── Logging ────────────────────────────────────────────────────────────────────

LOG_PATH    = os.path.join(os.path.dirname(os.path.abspath(__file__)), "worker.log")
STATUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "worker_status.json")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [WORKER] %(levelname)s %(message)s",
    handlers=[
        logging.FileHandler(LOG_PATH, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("batch_worker")

RESUME_PATH   = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads", "resume.pdf")
GENERATE_BATCH = 15   # Generate this many per loop before switching to send
GEMINI_RPM_SLEEP = 4  # Seconds between Gemini calls to respect 15 RPM limit


# ── Status file ────────────────────────────────────────────────────────────────

def _write_status(action: str, extra: dict = None):
    try:
        status = {
            "running":      True,
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


# ── DB helpers ─────────────────────────────────────────────────────────────────

def get_pending_generation(limit: int = GENERATE_BATCH):
    """Recipients that need AI generation (draft, no subject yet, in auto campaigns)."""
    return query_db("""
        SELECT r.id, r.email, r.name, r.campaign_id,
               c.goal   AS campaign_goal,
               c.additional_context
        FROM   recipients r
        JOIN   campaigns  c ON c.id = r.campaign_id
        WHERE  r.status    = 'draft'
        AND    r.subject   IS NULL
        AND    c.auto_mode = 1
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
    row = query_db("""
        SELECT
            SUM(CASE WHEN r.subject IS NULL  THEN 1 ELSE 0 END) AS need_gen,
            SUM(CASE WHEN r.subject IS NOT NULL THEN 1 ELSE 0 END) AS need_send
        FROM recipients r
        JOIN campaigns c ON c.id = r.campaign_id
        WHERE r.status = 'draft' AND c.auto_mode = 1
    """, one=True)
    return (row["need_gen"] or 0), (row["need_send"] or 0)


# ── Core actions ───────────────────────────────────────────────────────────────

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
    profile      = config.get("profile", {})
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

            # Respect Gemini's 15 RPM hard limit
            if provider == "gemini":
                time.sleep(GEMINI_RPM_SLEEP)

        except Exception as e:
            log.error(f"  Generation failed for {r['email']}: {e}")
            err = str(e).lower()
            if any(x in err for x in ["quota", "resource_exhausted", "daily limit", "rate limit"]):
                log.warning(f"  [{provider}] rate limit hit — stopping batch early.")
                break
            time.sleep(2)

    return success


def send_one(config: dict) -> bool:
    """
    Send the next ready email.
    Returns True if an email was sent (or failed and marked), False if nothing to send.
    """
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


# ── Main loop ──────────────────────────────────────────────────────────────────

def run():
    log.info("=" * 60)
    log.info("Batch worker started.")
    log.info("=" * 60)
    _write_status("Worker started")

    try:
        while True:
            config = load_config()

            need_gen, need_send = count_pending()

            if need_gen == 0 and need_send == 0:
                log.info("Nothing pending. Idling — will check again in 5 min.")
                _write_status("Idle — no pending work")
                time.sleep(300)
                continue

            did_something = False

            # ── Generate a mini-batch ──────────────────────────────────────
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
                else:
                    log.info("All generation quotas exhausted for today.")

            # ── Send one email ─────────────────────────────────────────────
            if need_send > 0 or (need_gen == 0):
                if quota_tracker.can_use("gmail_sent"):
                    sent = send_one(config)
                    if sent:
                        did_something = True
                        delay = config.get("send_delay_seconds", 30)
                        time.sleep(delay)
                else:
                    log.info("Gmail daily limit reached (1900). Waiting for midnight UTC.")

            # ── Sleep if everything is exhausted ───────────────────────────
            if not did_something:
                sleep_secs = quota_tracker.seconds_until_midnight_utc()
                log.info(
                    f"All quotas exhausted. Sleeping {sleep_secs / 3600:.1f}h until midnight UTC reset."
                )
                _write_status(
                    f"Sleeping until midnight UTC ({sleep_secs / 3600:.1f}h)",
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
