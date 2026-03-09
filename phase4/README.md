# Phase 4 — Email Draft & Send

Produce a draft email containing the weekly note (and optionally send it).

**Input:** Path to the generated pulse file (e.g. `output/weekly-pulse_YYYY-MM-DD.md`), or omit to use the latest. Config from `.env`.

**Message:**
- **Subject:** GROWW Weekly Review Pulse -- Week of {date}
- **From:** EMAIL_SENDER
- **To:** `--recipient` or EMAIL_RECIPIENT from config, else same as From (send to yourself)
- **Body:** Personalised: always starts with **"Hi {recipient name},"** (or "Hi," if no name given) then the full weekly pulse report. Multipart (plain + HTML). Plain = text version (from .txt if present, else .md); HTML = Markdown converted to HTML.

**Dry-run (default):** Writes the message to `output/weekly-pulse_YYYY-MM-DD.eml`. Does not connect to SMTP.

**Send mode:** With `--send` and SMTP credentials in `.env`, sends via smtplib (TLS). Password is never logged or stored.

**Config (.env):** EMAIL_SENDER, EMAIL_PASSWORD (e.g. Gmail App Password), SMTP_HOST, SMTP_PORT. EMAIL_RECIPIENT optional when recipient is supplied by CLI/API.

## Run (from repo root)

```bash
# Dry-run: write .eml only
python3 phase4/draft_email.py

# Personalised: recipient name appears in greeting ("Hi Vaishnavi," then weekly pulse report)
python3 phase4/draft_email.py output/weekly-pulse_2026-03-08.md --recipient you@example.com --recipient-name "Vaishnavi"

# Send (requires EMAIL_PASSWORD and SMTP_* in .env)
python3 phase4/draft_email.py --send
```

Requires Phase 3 output: `output/weekly-pulse_*.md` (and optionally `.txt`).
