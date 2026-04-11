"""
Configuration management for the outreach tool.
Loads/saves config.json with defaults for profile, credentials, and settings.
"""

import json
import os

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")

DEFAULT_CONFIG = {
    "gmail_address": "",
    "gmail_app_password": "",
    "groq_api_key": "",
    "send_delay_seconds": 60,
    "profile": {
        "name": "",
        "college": "",
        "branch": "",
        "year": "",
        "cgpa": "",
        "skills": "",
        "github": "",
        "linkedin": "",
        "bio": ""
    },
    "resume_path": "uploads/resume.pdf",
    "resume_parsed": {}
}


def load_config():
    """Load config from disk. Create with defaults if missing."""
    if not os.path.exists(CONFIG_PATH):
        save_config(DEFAULT_CONFIG)
        return DEFAULT_CONFIG.copy()

    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config = json.load(f)

    # Merge with defaults to handle missing keys after upgrades
    merged = DEFAULT_CONFIG.copy()
    merged.update(config)
    if "profile" in config:
        merged_profile = DEFAULT_CONFIG["profile"].copy()
        merged_profile.update(config["profile"])
        merged["profile"] = merged_profile

    return merged


def save_config(config):
    """Persist config to disk."""
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)


def is_profile_complete(config):
    """Check if the minimum profile fields are filled."""
    profile = config.get("profile", {})
    required = ["name", "college", "branch", "year", "skills", "bio"]
    return all(profile.get(field, "").strip() for field in required)


def is_settings_complete(config):
    """Check if Gmail + Gemini credentials are configured."""
    return bool(
        config.get("gmail_address", "").strip()
        and config.get("gmail_app_password", "").strip()
        and config.get("groq_api_key", "").strip()
    )
