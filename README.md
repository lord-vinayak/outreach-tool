# Outreach Tool

A personal email outreach tool that generates unique, human-sounding personalized emails using the Gemini API and sends them via Gmail SMTP with resume attachment.

**Single-user, no-login, localhost-only.**

## Prerequisites

- Python 3.11+
- Node.js 18+
- A Gmail account with 2-Step Verification enabled
- A Groq API key (free)

## Setup

### 1. Backend

```bash
cd backend
pip install -r requirements.txt
python app.py
# Flask runs on http://localhost:5000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
# Vite runs on http://localhost:5173
```

Then open **http://localhost:5173** in your browser.

## Getting a Gmail App Password

1. Go to [Google Account Security](https://myaccount.google.com/security)
2. Enable **2-Step Verification** if not already enabled
3. Under 2-Step Verification, find **App Passwords**
4. Generate a new app password for "Mail"
5. Copy the 16-character password and paste it in Settings

## Getting a Groq API Key

1. Go to [Groq Console](https://console.groq.com/keys)
2. Sign in with your Google account
3. Click **Create API Key** 
4. Copy the key and paste it in Settings

## Usage

1. **First launch:** Fill in your Profile (name, college, skills, bio, resume PDF)
2. **Settings:** Add your Gmail address, App Password, and Gemini API key
3. **New Campaign:** Paste emails, describe your goal, and generate personalized emails
4. **Preview:** Review, edit, or regenerate individual emails
5. **Send:** Emails are sent one by one with a configurable delay (default 60s)
6. **Follow-up:** Send threaded follow-up emails from Campaign Detail page

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11+, Flask, SQLite |
| AI | Groq API |
| Email | Gmail SMTP with App Password |
| Frontend | React 18 (Vite) + Tailwind CSS v3 |
