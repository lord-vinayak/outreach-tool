import sqlite3
import os

db_path = 'outreach.db'
if not os.path.exists(db_path):
    print(f"DB not found at {db_path}")
    exit(1)

conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

print("--- LAST CAMPAIGN ---")
row = cursor.execute("SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 1").fetchone()
if row:
    print(dict(row))
    campaign_id = row['id']
    print("\n--- RECIPIENTS ---")
    recipients = cursor.execute("SELECT id, email, status, subject IS NOT NULL as generated FROM recipients WHERE campaign_id = ?", (campaign_id,)).fetchall()
    for r in recipients:
        print(dict(r))
else:
    print("No campaigns found.")

conn.close()
