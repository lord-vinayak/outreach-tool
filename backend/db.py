"""
SQLite database initialization and helper functions.
"""

import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "outreach.db")


def get_db():
    """Get a database connection with row factory."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def migrate_reply_status_columns(conn):
    cursor = conn.cursor()
    existing = [row[1] for row in cursor.execute("PRAGMA table_info(recipients)").fetchall()]

    new_columns = [
        ("reply_status",    "TEXT DEFAULT 'no_reply'"),
        ("reply_content",   "TEXT"),
        ("check_back_date", "TEXT"),
        ("exclude_followup","INTEGER DEFAULT 0"),
        ("status_updated_at", "TEXT"),
    ]

    for col_name, col_def in new_columns:
        if col_name not in existing:
            cursor.execute(f"ALTER TABLE recipients ADD COLUMN {col_name} {col_def}")

    conn.commit()


def init_db():
    """Create tables if they don't exist."""
    conn = get_db()
    cursor = conn.cursor()

    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS campaigns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            goal TEXT NOT NULL,
            additional_context TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS recipients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
            email TEXT NOT NULL,
            name TEXT,
            subject TEXT,
            email_body TEXT,
            status TEXT DEFAULT 'draft',
            sent_at DATETIME,
            message_id TEXT,
            error_message TEXT,
            follow_up_sent INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS followups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipient_id INTEGER NOT NULL REFERENCES recipients(id),
            subject TEXT,
            email_body TEXT,
            status TEXT DEFAULT 'draft',
            sent_at DATETIME,
            error_message TEXT
        );
    """)
    conn.commit()
    migrate_reply_status_columns(conn)
    conn.close()


def query_db(query, args=(), one=False):
    """Execute a query and return results as list of dicts."""
    conn = get_db()
    cursor = conn.execute(query, args)
    rows = cursor.fetchall()
    conn.close()

    result = [dict(row) for row in rows]
    if one:
        return result[0] if result else None
    return result


def execute_db(query, args=()):
    """Execute a write query and return lastrowid."""
    conn = get_db()
    cursor = conn.execute(query, args)
    conn.commit()
    lastrowid = cursor.lastrowid
    conn.close()
    return lastrowid
