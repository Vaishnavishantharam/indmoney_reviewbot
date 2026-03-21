# Phase 4 — Email Draft & Send

Produce a draft email containing the weekly note (and optionally send it).

**Input:** Path to the generated pulse file (e.g. `output/weekly-pulse_YYYY-MM-DD.md`), or omit to use the latest. Config from `.env`.

**Message:**
- **Subject:** GROWW Weekly Review Pulse -- Week of {date}
- **From:** EMAIL_SENDER
- **To:** `--recipient` or EMAIL_RECIPIENT from config, else same as From (send to yourself)
- **Body:** Personalised: always starts with **"Hi {recipient name},"** (or "Hi," if no name given) then the full weekly pulse report. **Then** a **Fee explanation — Mutual Fund Exit Load** block (three bullets + example/source link(s)). Multipart (plain + HTML). Plain = text version (from .txt if present, else .md); HTML = Markdown converted to HTML.

**Pulse bundle JSON:** Each draft writes **`output/pulse_bundle_YYYY-MM-DD.json`** and **`output/mcp_append_YYYY-MM-DD.json`** (Part B subset: `date`, `weekly_pulse`, `fee_scenario`, `explanation_bullets`, `source_links` for MCP append). See [MCP_GOOGLE_DOC.md](./MCP_GOOGLE_DOC.md).

**Part B email:** Subject **`Weekly Pulse + Fee Explainer — {week}`** (set `EMAIL_LEGACY_SUBJECT=1` for the old GROWW subject). Body labels **Weekly pulse** then **Fee explanation**, with **Last checked** and **two official source links** in the fee block.

**Exit load on disk:** Saving the bundle also **appends** the *Fee explanation — Mutual Fund Exit Load* section to **`weekly-pulse_*.md`** once (so the markdown file matches the email). Phase 3 alone does not add it until you run `pulse_bundle.py` or `draft_email.py`.

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

**Build JSON only (no email):**

```bash
python3 phase4/pulse_bundle.py
python3 phase4/pulse_bundle.py output/weekly-pulse_2026-03-12.md
```

**Env:** `EXIT_LOAD_SOURCE_URL`, optional `EXIT_LOAD_BULLETS_JSON` if automated HTML fetch hits Cloudflare — see `.env.example`.

**Playwright (optional):** If `urllib` gets a Cloudflare challenge, `pulse_bundle` runs `node scripts/fetch-exit-load-playwright.mjs <url>` (repo-root `npm install` + Chromium). Use `npm run fetch-exit-load -- <url>` to test.
