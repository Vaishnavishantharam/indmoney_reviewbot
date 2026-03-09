# Phase 5 — Web UI & CLI

Trigger **Generate one-pager** and **Send email** from a **Next.js web UI** or from the **CLI**.

## CLI (from repo root)

**Generate weekly pulse (Phase 1 → 2a → 2b → 3):**
```bash
npm run weekly
# Skip fetch if reviews exist:
npm run weekly -- --skip-fetch
```

**Send email (Phase 4):**
```bash
npm run email
npm run email -- --recipient you@example.com --recipient-name "Vaishnavi" --send
```

## Web UI (Next.js)

**Run the UI:**
```bash
# From repo root
npm run ui
# Or from phase5/
cd phase5 && npm install && npm run dev
```

Then open **http://localhost:3000**.

**Flows:**
1. **Generate one-pager** — Set “Weeks back”, click “Generate one-pager”. Runs Phase 1 (fetch) → 2a → 2b → 3 and shows the weekly note and theme legend.
2. **Send email** — Optionally enter recipient email and name, then “Send email to me”. Calls Phase 4 with `--send` (uses `.env` from repo root for SMTP).

**APIs:**
- `POST /api/weekly-pulse` — body: `{ weeksBack?: number }`. Runs full pipeline, returns `{ pulse, themeLegend }`.
- `POST /api/send-email` — body: `{ recipient?: string, recipientName?: string }`. Sends email via Phase 4.

Ensure `.env` is in the **repo root** (not in phase5); the API loads it when running the Python scripts.
