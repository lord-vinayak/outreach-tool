"""
Daily quota tracker for AI providers and Gmail sending.
Resets automatically at midnight UTC. Persists to quotas.json.
"""

import json
import os
import threading
from datetime import datetime, timedelta, timezone

QUOTA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "quotas.json")

DAILY_LIMITS = {
    "gemini":      500,   # gemini-3.1-flash-lite free tier (15 RPM, 500 RPD)
    "groq_1":     250,    # Conservative per-key estimate (token limit ~500K/day @ ~2K tokens/email)
    "groq_2":     250,
    "groq_3":     250,
    "gmail_sent": 1900,   # Buffer under Google Workspace 2000/day hard limit
}

_lock = threading.Lock()


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _fresh() -> dict:
    return {
        "date": _today(),
        "gemini":     0,
        "groq_1":     0,
        "groq_2":     0,
        "groq_3":     0,
        "gmail_sent": 0,
    }


def _load() -> dict:
    if not os.path.exists(QUOTA_PATH):
        return _fresh()
    try:
        with open(QUOTA_PATH, "r") as f:
            data = json.load(f)
        if data.get("date") != _today():
            data = _fresh()
        return data
    except Exception:
        return _fresh()


def _save(data: dict):
    with open(QUOTA_PATH, "w") as f:
        json.dump(data, f, indent=2)


def get_quotas() -> dict:
    with _lock:
        data = _load()
        used = {k: data.get(k, 0) for k in DAILY_LIMITS}
        return {
            "date":      data["date"],
            "limits":    DAILY_LIMITS,
            "used":      used,
            "remaining": {k: max(0, DAILY_LIMITS[k] - used[k]) for k in DAILY_LIMITS},
        }


def can_use(provider: str) -> bool:
    with _lock:
        data = _load()
        return data.get(provider, 0) < DAILY_LIMITS.get(provider, 0)


def increment(provider: str):
    with _lock:
        data = _load()
        data[provider] = data.get(provider, 0) + 1
        _save(data)


def mark_exhausted(provider: str):
    """
    Mark a provider as fully exhausted for today.
    Called when the actual API returns a rate-limit/quota error,
    so the tracker doesn't keep retrying the same exhausted provider.
    """
    with _lock:
        data = _load()
        data[provider] = DAILY_LIMITS.get(provider, 9999)
        _save(data)


def get_best_generation_provider(config: dict):
    """
    Returns (provider_key, api_key) for the first provider with remaining quota.
    Priority: gemini → groq_1 → groq_2 → groq_3
    Returns None if all exhausted.
    """
    candidates = [
        ("gemini", config.get("gemini_api_key", "").strip()),
        ("groq_1", config.get("groq_api_key",   "").strip()),
        ("groq_2", config.get("groq_api_key_2", "").strip()),
        ("groq_3", config.get("groq_api_key_3", "").strip()),
    ]
    for provider, key in candidates:
        if key and can_use(provider):
            return provider, key
    return None


def seconds_until_midnight_utc() -> int:
    """Returns seconds until next midnight UTC, plus a 90s buffer."""
    now       = datetime.now(timezone.utc)
    tomorrow  = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return int((tomorrow - now).total_seconds()) + 90
