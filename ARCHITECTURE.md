# IND Money — Weekly Review Pulse: Phase-wise Architecture

**Product:** IND Money  
**LLM:** Groq  
**Review Source:** Google Play Store (public exports via `google-play-scraper`)  
**App ID:** `in.indwealth`

---

## 1. Problem Statement (Summary)

Turn recent Play Store reviews into a **one-page weekly pulse** containing:
- **Top themes** (3–5 max)
- **Real user quotes** (3, anonymized)
- **Three action ideas**
- **Draft email** with this weekly note, sent to self/alias

**Audience:** Product/Growth (what to fix), Support (what users say), Leadership (weekly health pulse).

**Constraints:** Public review exports only; max 5 themes; notes ≤250 words; no PII (no usernames/emails/IDs).

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           TRIGGER LAYER                                          │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐  │
│  │   CLI (optional)     │  │   Web UI             │  │   Scheduler          │  │
│  │   npm run weekly     │  │   "Generate Pulse"   │  │   Weekly 9:45 PM CST │  │
│  │   npm run email      │  │   "Send Email"       │  │   (8 wks, 1000 rev.) │  │
│  └──────────┬──────────┘  └──────────┬──────────┘  └──────────┬──────────┘  │
└─────────────┼─────────────────────────┼─────────────────────────┼────────────┘
              │                         │                         │
              ▼                         ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           ORCHESTRATION / API LAYER                              │
│  • Validate inputs (date range, appId)                                            │
│  • Call: Fetch → Themes → One-pager → Email                                       │
│  • Return: one-pager (MD/PDF), email draft, theme legend                          │
└─────────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           CORE PIPELINE (Phase 2–4)                              │
│  Phase 2: Ingest (google-play-scraper) → Phase 3: Theme (Groq) →                  │
│  Phase 4: One-pager + Email (Groq + templates)                                   │
└─────────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           OUTPUTS                                                │
│  • reviews.csv / reviews.json (redacted)   • weekly-pulse.md / .pdf              │
│  • email-draft.txt / screenshot            • theme-legend.md                     │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Phase-wise Architecture

### Phase 1 — Foundation & Data Ingress

**Goal:** Set up project, config, and **import reviews from the last 8–12 weeks** (rating, title, text, date) using public exports only.

| Component | Responsibility |
|-----------|----------------|
| **Package** | `google-play-scraper` (Node.js) for Play Store reviews. No scraping behind logins. |
| **App ID** | `in.indwealth` (IND Money). Configurable via env or UI. |
| **Date filter** | After fetching, filter by `date` to keep only last 8–12 weeks (configurable). |
| **Schema** | Each review: `{ rating, title, text, date }` — **no** userName, userId, or any PII stored. |
| **Storage** | Persist to `reviews/reviews_YYYY-MM-DD.json` and optional `reviews/reviews_YYYY-MM-DD.csv` (redacted). |
| **Config** | `WEEKS_BACK` (default 8), `APP_ID`, `MAX_REVIEWS` (default 1000; scheduler uses 8 weeks, 1000 reviews). |

**Data flow:**
1. Call `google-play-scraper.reviews({ appId: 'in.indwealth', ... })` in a loop (paginate with `nextPaginationToken`) until date range or limit.
2. Strip any PII from payload before saving; keep only rating, title, text, date.
3. Export CSV/JSON for deliverables (sample/redacted OK).

**Outcome:** Reliable, repeatable review ingestion; no PII in artifacts.

---

### Phase 2a — Theme Discovery (LLM: Groq)

**Goal:** From a **sample of the review corpus**, **generate 3–5 theme labels** using Groq.

| Component | Responsibility |
|-----------|----------------|
| **LLM** | Groq (e.g. `llama-3.3-70b-versatile` or `mixtral-8x7b`) via `groq` (Python). |
| **Input** | Sampled review texts from `reviews/reviews_YYYY-MM-DD.json` (anonymized; no PII). |
| **Prompt 1 — Themes** | “Given these app reviews, identify 3–5 distinct themes (e.g. UX, performance, features, support). Return only theme labels, one per line.” |
| **Output** | List of 3–5 theme labels (max 5). |
| **Prompt 2 — Grouping** | “For each theme, list which of these review excerpts belong to it. Themes: []. Excerpts: [].” Or: “For each excerpt, assign exactly one theme from [list].” |
| **Storage** | `themes/themes_YYYY-MM-DD.json`: `{ themes: string[], reviewIdToTheme: Record<id, theme> }`. Use internal non-PII IDs (e.g. index). |

**Constraints:** Max 5 themes; no PII in prompts or outputs.

**Outcome:** Theme list for Phase 2b and for legend/one-pager.

---

### Phase 2b — Review Classification (LLM: Groq, batched)

**Goal:** **Assign each review to exactly one theme** from 2a. **Process reviews in batches of ~50** to stay within context limits.

| Component | Responsibility |
|-----------|----------------|
| **Input** | Full list from `reviews/reviews_YYYY-MM-DD.json` + theme list from 2a `themes/theme_labels_YYYY-MM-DD.json`. |
| **Chunk size** | ~50 reviews per batch (configurable) to respect context window. |
| **Prompt (per chunk)** | Themes: [list]. For each review below, assign exactly one theme. Return a JSON object mapping review index to theme label. |
| **Output** | Merged mapping: review index to theme. |
| **Storage** | `themes/themes_YYYY-MM-DD.json`: `{ "themes": string[], "reviewIdToTheme": Record<string, string> }`. |

**Constraints:** No PII; each review assigned to exactly one theme from 2a.

**Outcome:** Every review mapped to one theme; full file for Phase 3 one-pager.

---

### Phase 3 — One-Page Weekly Note (LLM: Gemini)

**Goal:** Generate a **detailed weekly one-page note** with: **Top 3 themes**, **3 user quotes**, **3 action ideas**. Uses **Gemini** (not Groq) for this phase.

| Component | Responsibility |
|-----------|----------------|
| **Input** | `themes/themes_grouped_YYYY-MM-DD.json` (from Phase 2b: themes with nested reviews, counts, descriptions). |
| **Prompt** | Generate a weekly one-page note. Required structure: (1) **Top 3 themes** — theme name, review count, 1–2 sentences each; (2) **3 user quotes** — anonymized, from sample quotes; (3) **3 action ideas** — concrete next steps. No PII. Complete all sections. |
| **Output format** | Exact structure: `## Weekly One-Page Note` → `### Top 3 Themes` → `### 3 User Quotes` → `### 3 Action Ideas`. **Week of Month DD, YYYY** at the top of both outputs. |
| **Validation** | Word count (detailed one-pager, ~300–450 words); no emails/usernames in generated text. |
| **Storage** | `output/weekly-pulse_YYYY-MM-DD.md`, `output/weekly-pulse_YYYY-MM-DD.txt` (both with date on top); `output/theme-legend.md`. |

**Theme legend:** `output/theme-legend.md` — theme labels, short descriptions, and review counts.

**Outcome:** Weekly one-page note in `.md` and `.txt` (date on top), plus theme legend for re-run clarity.

---

### Phase 4 — Email Draft & Send (Optional UI Trigger)

**Goal:** Produce a **draft email** (and optionally send it) containing the weekly note.

| Component | Responsibility |
|-----------|----------------|
| **Input** | Path to the generated pulse file (e.g. `output/weekly-pulse_YYYY-MM-DD.md`), and config from `.env`. |
| **Message** | **Subject:** GROWW Weekly Review Pulse -- Week of {date}. **From:** EMAIL_SENDER. **To:** Recipient from caller (`--recipient`) or EMAIL_RECIPIENT, else From. **Body:** Personalised: weekly pulse report contains **"Hi {name of recipient},"** (or "Hi," if no name) then the rest of the email. Multipart (plain + HTML). Plain = text version; HTML = Markdown to HTML. |
| **Dry-run (default)** | Write to `output/weekly-pulse_YYYY-MM-DD.eml`; no SMTP. |
| **Send mode** | With `--send` and SMTP credentials: send via `smtplib` (TLS). Do not log or store password. |
| **Config** | EMAIL_SENDER, EMAIL_PASSWORD, SMTP_HOST, SMTP_PORT. EMAIL_RECIPIENT optional. Recipient name: `--recipient-name`. |

**Deliverable:** Draft written to `output/weekly-pulse_YYYY-MM-DD.eml`; optionally sent when `--send` and credentials are used.

**UI integration (Phase 5):** "Send email" can call this phase with recipient (and recipient-name) from the UI; "Generate one-pager" runs pipeline up to Phase 3.

**Outcome:** Email draft (.eml) and optionally sent email to recipient/self.

---

### Phase 5 — UI for Triggering (Web App)

**Goal:** Besides CLI, allow **triggering “Generate one-pager”** and **“Send email”** from a **web UI**.

| Component | Responsibility |
|-----------|----------------|
| **Stack** | Simple stack: e.g. **Next.js** (or Express + React/Vite) for UI; shared Node services for pipeline. |
| **UI flows** | 1) **Generate Pulse:** date range (or “last 10 weeks”), then “Run” → progress → download/view one-pager (MD/PDF). 2) **Send Email:** same + “Send to my email” → backend sends or saves draft and shows confirmation. |
| **Backend API** | `POST /api/weekly-pulse` — runs fetch + themes + one-pager; returns one-pager text + theme legend. `POST /api/send-email` — takes one-pager (or run id), sends/saves draft. |
| **Security** | No auth required for prototype; for production, add API key or login. Env-based config (e.g. `GROQ_API_KEY`, `APP_ID`, `SEND_TO_ALIAS`). |
| **State** | Optional “last run” cache so “Send email” can reuse last one-pager without re-running full pipeline. |

**Rough wireframe:**
- Page 1: “IND Money Weekly Pulse”  
  - Inputs: Weeks back (8–12), App ID (default `in.indwealth`)  
  - Buttons: “Generate one-pager”, “Send email to me”  
- Page 2 (or modal): Show one-pager (rendered MD), theme legend, download MD/PDF, “Email sent” or “Draft saved” message.

**Outcome:** Working UI to trigger pipeline and email without using CLI.

**Python Web UI (no Node/npm):** From repo root run `python3 web_ui.py`, then open **http://127.0.0.1:5000**. Same flows: "Generate one-pager" (runs Phase 1→2a→2b→3) and "Send email" (Phase 4). Uses `web_ui.py` and `templates/weekly_ui.html`; requires `flask` in `requirements.txt`.

---

### Weekly Scheduler

**Goal:** Run the full pipeline **every week at 9:45 PM CST** and send the weekly pulse to a **fixed recipient** without manual trigger.

| Component | Responsibility |
|-----------|----------------|
| **Script** | `scripts/scheduler.py` (Python; uses APScheduler). Run from repo root: `python3 scripts/scheduler.py`; keep process running (e.g. tmux/screen or systemd). Use `--run-now` to run the pipeline once and send email (for testing). |
| **Schedule** | Every **Sunday 9:45 PM CST** (America/Chicago). |
| **Pipeline** | Same as CLI: Phase 1 → 2a → 2b → 3 → 4 (fetch, themes, classify, one-pager, send email). No Node required; runs Python phases directly. |
| **Review scope** | **8 weeks**, **max 1000 reviews** (`WEEKS_BACK=8`, `MAX_REVIEWS=1000` set by scheduler for each run). |
| **Recipient** | Fixed: **vaishnavishantharam09@gmail.com** (and recipient name for personalisation). |

**GitHub Actions integration:** The same schedule is available as a workflow so the pipeline runs in the cloud without a local process.

| Component | Responsibility |
|-----------|----------------|
| **Workflow** | `.github/workflows/weekly-pulse.yml` — triggers every **Monday 03:45 UTC** (Sunday 9:45 PM CST) and on `workflow_dispatch` (manual run from Actions tab). |
| **Runner** | `ubuntu-latest`; Python 3.11; `pip install -r requirements.txt`; then Phase 1 → 2a → 2b → 3 → 4. |
| **Secrets** | In repo **Settings → Secrets and variables → Actions**, add: `GROQ_API_KEY`, `GEMINI_API_KEY`, `EMAIL_SENDER`, `EMAIL_PASSWORD`. Optional: `SMTP_HOST`, `SMTP_PORT` (defaults: Gmail). |
| **Recipient** | Same fixed recipient: vaishnavishantharam09@gmail.com. |

**Outcome:** Weekly pulse generated and emailed automatically every week at 9:45 PM CST (local scheduler or GitHub Actions).

---

### Phase 6 — Automation, README & Deliverables

**Goal:** Document **how to re-run for a new week**, **theme legend**, and tie together all deliverables.

| Item | Description |
|------|-------------|
| **Re-run** | README: “To re-run for a new week: set `WEEKS_BACK` (or pick in UI), run `npm run weekly` or use UI ‘Generate one-pager’.” Optional: cron or weekly job to auto-generate. |
| **Theme legend** | In README or `theme-legend.md`: short description of each theme (e.g. “Performance”, “UX”, “Support”, “Features”, “Bugs”). |
| **Deliverables checklist** | Working prototype (link or ≤3-min demo video), latest one-page note (PDF/Doc/MD), email draft (screenshot or text), reviews CSV/JSON (sample/redacted), README with re-run + theme legend. |

---

## 4. Technology Stack (Summary)

| Layer | Choice |
|-------|--------|
| **Reviews** | `google-play-scraper` (Node.js), appId `in.indwealth` |
| **LLM** | Groq (`groq-sdk` or `@ai-sdk/groq`), e.g. `llama-3.3-70b-versatile` |
| **Runtime** | Node.js 18+ |
| **API / orchestration** | Express or Next.js API routes |
| **UI** | Next.js (or Express + React/Vite) |
| **Email** | Nodemailer (SMTP) or Gmail API; draft fallback to file |
| **Output formats** | Markdown (primary), optional PDF (e.g. `md-to-pdf`), CSV/JSON (redacted) |

---

## 5. File Structure (Phase-wise)

```
indmoney_reviewbot-1/
├── README.md
├── ARCHITECTURE.md
├── package.json
├── .env.example
├── requirements.txt
├── phase1/                   # Data ingress — fetch Play Store reviews
│   ├── fetch_reviews.py
│   ├── fetch-reviews.js
│   ├── fetch-reviews-playwright.js
│   └── README.md
├── phase2a/                 # Theme discovery (Groq)
│   ├── theme_discovery.py
│   └── README.md
├── phase2b/                 # Review classification, batched ~50 (Groq)
│   ├── classify_reviews.py
│   └── README.md
├── phase2/                   # (legacy) README
│   └── README.md
├── phase3/                   # One-page weekly note (Groq)
│   └── README.md
├── phase4/                   # Email draft & send
│   ├── draft_email.py
│   └── README.md
├── web_ui.py                 # Python Web UI (Flask); run: python3 web_ui.py → http://127.0.0.1:5000
├── templates/
│   └── weekly_ui.html        # Single-page UI (Generate one-pager, Send email)
├── phase5/                   # Web UI (Next.js) + CLI entrypoints
│   ├── app/                  # Next.js App Router (page, api/weekly-pulse, api/send-email)
│   ├── package.json
│   └── README.md
├── reviews/                  # Phase 1 output
├── themes/                   # Phase 2 output
├── output/                   # weekly-pulse, email-draft, theme-legend
├── .github/
│   └── workflows/
│       └── weekly-pulse.yml  # GitHub Actions: Sunday 9:45 PM CST (Monday 03:45 UTC); same pipeline, secrets for keys/email
└── scripts/
    ├── scheduler.py          # Weekly run at 9:45 PM CST; 8 weeks, 1000 reviews; fixed recipient; --run-now to test
    ├── cli-fetch-reviews.js
    ├── cli-weekly.js
    └── cli-email.js
```

---

## 6. Environment & Configuration

| Variable | Purpose |
|----------|---------|
| `GROQ_API_KEY` | Groq API key for theme discovery and classification (Phase 2a/2b) |
| `GEMINI_API_KEY` | Gemini API key for one-page weekly pulse (Phase 3) |
| `APP_ID` | Play Store app ID (default `in.indwealth`) |
| `WEEKS_BACK` | How many weeks of reviews (default 8; range 8–12). Scheduler uses 8. |
| `MAX_REVIEWS` | Max reviews to keep (default 1000). Scheduler uses 1000. |
| `EMAIL_SENDER` | Sender address (Phase 4) |
| `EMAIL_PASSWORD` | SMTP password (e.g. Gmail App Password); never logged or stored |
| `SMTP_HOST`, `SMTP_PORT` | SMTP server (Phase 4 send mode); TLS used |
| `EMAIL_RECIPIENT` | Default recipient when not supplied by CLI/API (optional) |
---

## 7. Security & Compliance

- **No PII:** Do not store or pass usernames, emails, or user IDs in reviews, themes, one-pager, or email.
- **Public data only:** Use only public Play Store data via `google-play-scraper`; no scraping behind logins.
- **Secrets:** All keys and SMTP credentials in env; `.env` in `.gitignore`.

---

## 8. Success Criteria (Recap)

- [ ] Reviews from last 8–12 weeks imported (rating, title, text, date) via `google-play-scraper`.
- [ ] Reviews grouped into 3–5 LLM-generated themes.
- [ ] One-page weekly note (≤250 words): top 3 themes, 3 quotes, 3 action ideas; no PII.
- [ ] Email draft (and optional send to self/alias).
- [ ] UI to trigger “Generate one-pager” and “Send email” (in addition to CLI).
- [ ] README: re-run instructions + theme legend.
- [ ] Deliverables: prototype link or demo video, weekly note (MD/PDF), email draft (screenshot/text), sample reviews (CSV/JSON redacted).

---

*Document version: 1.0 — IND Money Weekly Review Pulse, Groq, google-play-scraper.*
