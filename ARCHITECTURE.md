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
- **Fee explanation block** — a fixed scenario (**Mutual Fund Exit Load**): three factual bullets plus source link(s), populated from **public** IND Money fund page data (e.g. exit load text for a configured canonical URL such as [HDFC Mid Cap example](https://www.indmoney.com/mutual-funds/hdfc-mid-cap-fund-direct-plan-growth-option-3097))
- **Google Doc append** — after each run, a **single combined JSON** document (schema below) is **appended** to a designated Google Doc via **MCP** (Model Context Protocol), e.g. Google Docs MCP in Cursor or an automated worker using the same contract

**Audience:** Product/Growth (what to fix), Support (what users say), Leadership (weekly health pulse).

**Constraints:** Public review exports only; max 5 themes; notes ≤250 words; no PII (no usernames/emails/IDs). Fee content must come from **public** product pages only (no authenticated scraping).

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
│  • Call: Fetch → Themes → One-pager → Fee enrich → Bundle JSON → Email + MCP Doc │
│  • Return: one-pager (MD/PDF), email draft, theme legend, pulse bundle JSON       │
└─────────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           CORE PIPELINE (Phase 2–4)                              │
│  Phase 2: Ingest (google-play-scraper) → Phase 3: Theme (Groq) →                  │
│  Phase 4: One-pager + Email (Groq + templates) + Fee block + MCP Google Doc      │
└─────────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           OUTPUTS                                                │
│  • reviews.csv / reviews.json (redacted)   • weekly-pulse.md / .pdf              │
│  • email-draft.txt / .eml / screenshot     • theme-legend.md                     │
│  • output/pulse_bundle_YYYY-MM-DD.json   • Google Doc append (via MCP)           │
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

### Fee explanation — Mutual Fund Exit Load (email enrichment)

**Goal:** Add a **standard support/education block** to the weekly email: **Mutual Fund Exit Load**, with **three short bullets** grounded in **fetched public fund facts** and at least one **source link** (canonical IND Money fund URL).

| Component | Responsibility |
|-----------|----------------|
| **Scenario label** | Fixed human-readable title for the block, e.g. `Mutual Fund Exit Load` (maps to `fee_scenario` in the combined JSON). |
| **Data source** | One or more **configurable public URLs** (default: example fund page pattern `https://www.indmoney.com/mutual-funds/...`). HTTP fetch + parse (e.g. structured data in page, or stable DOM selectors). **No login.** |
| **Extraction** | Read **exit load** (and closely related fee text if present on the same surface) and normalize into **exactly three** concise bullets (`explanation_bullets[]`). If the page structure changes, fall back to a safe message + link only (document in run logs). |
| **Email section layout** | After the main weekly pulse body, append a section such as: **Fee explanation — Mutual Fund Exit Load** → Bullet 1 / Bullet 2 / Bullet 3 → **Example / Source:** linked URL(s). Same block in **plain text** and **HTML** parts of Phase 4. |
| **Storage** | Include the same fields in `output/pulse_bundle_YYYY-MM-DD.json` (see §3.1) for parity with Google Doc MCP. |

**Outcome:** Every email that goes out (or draft `.eml`) includes the exit-load explanation block when fee enrichment is enabled; content is traceable to public source link(s).

---

### Phase 3.1 — Combined weekly bundle (JSON contract)

**Goal:** One **canonical JSON object** per run, used for **Google Doc append (MCP)** and optional API responses. It merges pulse summaries, fee scenario, and metadata.

**Schema (append this object as JSON — pretty-printed or minified per MCP step):**

```json
{
  "date": "2026-03-15",
  "weekly_pulse": {
    "themes": ["Theme 1", "Theme 2", "Theme 3"],
    "quotes": ["Quote 1", "Quote 2", "Quote 3"],
    "action_ideas": ["Action 1", "Action 2", "Action 3"]
  },
  "fee_scenario": "Mutual Fund Exit Load",
  "explanation_bullets": [
    "Fact 1...",
    "Fact 2...",
    "Fact 3..."
  ],
  "source_links": ["Link 1", "Link 2"],
  "last_checked": "2026-03-15"
}
```

| Field | Description |
|-------|-------------|
| `date` | Run date (ISO `YYYY-MM-DD`), aligned with pulse file date. |
| `weekly_pulse.themes` | Top theme names (typically 3) from Phase 3 output. |
| `weekly_pulse.quotes` | Three anonymized quotes. |
| `weekly_pulse.action_ideas` | Three action ideas. |
| `fee_scenario` | Label for the fee block (e.g. Mutual Fund Exit Load). |
| `explanation_bullets` | Three bullets from fee fetch / normalization. |
| `source_links` | Public IND Money (or other) URLs used as sources. |
| `last_checked` | Date exit-load (or fee) facts were fetched (usually same as `date`). |

**File:** `output/pulse_bundle_YYYY-MM-DD.json` (written on each full run before email send / MCP append).

---

### Google Doc append via MCP

**Goal:** After the bundle JSON is built, **append** it to a **single designated Google Doc** so stakeholders have a running log of weekly pulses + fee blocks.

| Component | Responsibility |
|-----------|----------------|
| **MCP** | Use a **Google Docs MCP server** (or equivalent) that can insert text at the end of a document or add a dated section. Invocation may be **manual** (operator runs MCP in Cursor with the JSON) or **automated** (CI/worker with service account + Docs API — still emitting the **same JSON** as the MCP contract). |
| **Input** | The object in §3.1 (read from `pulse_bundle_YYYY-MM-DD.json` or passed inline). |
| **Append format** | Recommended: append a **heading** (`## Pulse {date}`), then a **fenced JSON code block** or formatted bullet summary derived from the JSON so the Doc stays human-readable. Raw JSON append is acceptable if the team prefers machine-first logs. |
| **Config** | Target document ID in env (e.g. `GOOGLE_PULSE_DOC_ID`); MCP connection details outside repo (Cursor MCP config or secrets for Docs API). |

**Outcome:** Google Doc grows by one entry per run; email and Doc stay consistent with the same bundle.

---

### Phase 4 — Email Draft & Send (Optional UI Trigger)

**Goal:** Produce a **draft email** (and optionally send it) containing the weekly note **and** the **fee explanation** block (§ Fee explanation).

| Component | Responsibility |
|-----------|----------------|
| **Input** | Path to the generated pulse file (e.g. `output/weekly-pulse_YYYY-MM-DD.md`), **`pulse_bundle_YYYY-MM-DD.json`** (or equivalent in-memory struct; see **Fee explanation** and **§3.1** above), and config from `.env`. |
| **Message** | **Subject:** GROWW Weekly Review Pulse -- Week of {date}. **From:** EMAIL_SENDER. **To:** Recipient from caller (`--recipient`) or EMAIL_RECIPIENT, else From. **Body:** Personalised: weekly pulse report contains **"Hi {name of recipient},"** (or "Hi," if no name) then the main weekly note. **Then** the **Fee explanation — Mutual Fund Exit Load** section (title + 3 bullets + example/source link(s)). Multipart (plain + HTML). Plain = text version; HTML = Markdown to HTML. |
| **Dry-run (default)** | Write to `output/weekly-pulse_YYYY-MM-DD.eml`; no SMTP. |
| **Send mode** | With `--send` and SMTP credentials: send via `smtplib` (TLS). Do not log or store password. |
| **Config** | EMAIL_SENDER, EMAIL_PASSWORD, SMTP_HOST, SMTP_PORT. EMAIL_RECIPIENT optional. Recipient name: `--recipient-name`. Optional: `EXIT_LOAD_SOURCE_URL` (or list) for fund page(s) used in fee enrichment. |

**Deliverable:** Draft written to `output/weekly-pulse_YYYY-MM-DD.eml`; optionally sent when `--send` and credentials are used.

**UI integration (Phase 5):** "Send email" can call this phase with recipient (and recipient-name) from the UI; "Generate one-pager" runs pipeline up to Phase 3, then fee fetch + bundle JSON before send.

**Outcome:** Email draft (.eml) and optionally sent email to recipient/self, **including exit-load bullets and links**.

---

### Phase 5 — UI for Triggering (Web App)

**Goal:** Besides CLI, allow **triggering “Generate one-pager”** and **“Send email”** from a **web UI**.

| Component | Responsibility |
|-----------|----------------|
| **Stack** | Simple stack: e.g. **Next.js** (or Express + React/Vite) for UI; shared Node services for pipeline. |
| **UI flows** | 1) **Generate Pulse:** date range (or “last 10 weeks”), then “Run” → progress → download/view one-pager (MD/PDF) + **pulse bundle JSON**. 2) **Send Email:** includes **fee explanation** block. 3) Optional: **“Copy for Google Doc / MCP”** — exposes or downloads `pulse_bundle_YYYY-MM-DD.json` for append via MCP. |
| **Backend API** | `POST /api/weekly-pulse` — runs fetch + themes + one-pager + **fee enrichment** + **bundle JSON**; returns one-pager text, theme legend, and JSON payload. `POST /api/send-email` — takes bundle or run id, sends/saves draft **with fee section**. |
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
| **Pipeline** | Same as CLI: Phase 1 → 2a → 2b → 3 → **fee enrich + pulse_bundle JSON** → 4 (send email). **Google Doc:** operator or automation appends bundle via MCP per § Google Doc append. No Node required for core Python path. |
| **Review scope** | **8 weeks**, **max 1000 reviews** (`WEEKS_BACK=8`, `MAX_REVIEWS=1000` set by scheduler for each run). |
| **Recipient** | Fixed: **vaishnavishantharam09@gmail.com** (and recipient name for personalisation). |

**GitHub Actions integration:** The same schedule is available as a workflow so the pipeline runs in the cloud without a local process.

| Component | Responsibility |
|-----------|----------------|
| **Workflow** | `.github/workflows/weekly-pulse.yml` — triggers every **Monday 03:45 UTC** (Sunday 9:45 PM CST) and on `workflow_dispatch` (manual run from Actions tab). |
| **Runner** | `ubuntu-latest`; Python 3.11; `pip install -r requirements.txt`; then Phase 1 → 2a → 2b → 3 → 4. |
| **Secrets** | In repo **Settings → Secrets and variables → Actions**, add: `GROQ_API_KEY`, `GEMINI_API_KEY`, `EMAIL_SENDER`, `EMAIL_PASSWORD`. Optional: `SMTP_HOST`, `SMTP_PORT` (defaults: Gmail), `EXIT_LOAD_SOURCE_URL`, `GOOGLE_PULSE_DOC_ID` (if a future job appends to Docs via API). **MCP** Google Doc steps are typically local/Cursor unless wired to a service account job. |
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
| **Output formats** | Markdown (primary), optional PDF (e.g. `md-to-pdf`), CSV/JSON (redacted), **`pulse_bundle_*.json`** |
| **Fee source** | HTTP fetch of public IND Money fund URLs; configurable `EXIT_LOAD_SOURCE_URL` |
| **Google Docs** | MCP (Google Docs) or Docs API worker; same JSON contract as §3.1 |

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
├── phase4/                   # Email draft & send (+ fee block from bundle)
│   ├── draft_email.py
│   └── README.md
├── (planned) phase_fee/ or phase4/fee_exit_load.py  # Fetch exit load from public fund URL → bullets
├── web_ui.py                 # Python Web UI (Flask); run: python3 web_ui.py → http://127.0.0.1:5000
├── templates/
│   └── weekly_ui.html        # Single-page UI (Generate one-pager, Send email)
├── phase5/                   # Web UI (Next.js) + CLI entrypoints
│   ├── app/                  # Next.js App Router (page, api/weekly-pulse, api/send-email)
│   ├── package.json
│   └── README.md
├── reviews/                  # Phase 1 output
├── themes/                   # Phase 2 output
├── output/                   # weekly-pulse, email-draft, theme-legend, pulse_bundle_*.json
├── .cursor/                  # optional: mcp.json for Google Docs MCP (local only; not committed with secrets)
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
| `EXIT_LOAD_SOURCE_URL` | Public IND Money mutual-fund URL(s) for exit-load extraction (comma-separated if multiple) |
| `GOOGLE_PULSE_DOC_ID` | Target Google Doc ID for MCP/append (optional; used by automation or documented for operators) |
---

## 7. Security & Compliance

- **No PII:** Do not store or pass usernames, emails, or user IDs in reviews, themes, one-pager, or email.
- **Public data only:** Use only public Play Store data via `google-play-scraper`; no scraping behind logins. Fee/exit-load text only from **public** product pages.
- **Google Doc / MCP:** Doc IDs and OAuth tokens stay in env or local MCP config; do not commit credentials.
- **Secrets:** All keys and SMTP credentials in env; `.env` in `.gitignore`.

---

## 8. Success Criteria (Recap)

- [ ] Reviews from last 8–12 weeks imported (rating, title, text, date) via `google-play-scraper`.
- [ ] Reviews grouped into 3–5 LLM-generated themes.
- [ ] One-page weekly note (≤250 words): top 3 themes, 3 quotes, 3 action ideas; no PII.
- [ ] Email draft (and optional send to self/alias) **including Mutual Fund Exit Load section** (3 bullets + source link(s)).
- [ ] **`pulse_bundle_YYYY-MM-DD.json`** produced each run; **Google Doc** updated via MCP (or documented manual append) using §3.1 schema.
- [ ] UI to trigger “Generate one-pager” and “Send email” (in addition to CLI).
- [ ] README: re-run instructions + theme legend.
- [ ] Deliverables: prototype link or demo video, weekly note (MD/PDF), email draft (screenshot/text), sample reviews (CSV/JSON redacted).

---

*Document version: 1.1 — IND Money Weekly Review Pulse; adds exit-load fee email block, pulse bundle JSON, and Google Doc append via MCP.*
