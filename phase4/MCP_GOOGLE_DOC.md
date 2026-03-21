# Part B — MCP append + fee explainer (approval-gated)

After Phase 4 / bundle save you get:

| File | Purpose |
|------|---------|
| `output/pulse_bundle_YYYY-MM-DD.json` | Full bundle (includes `last_checked`) |
| `output/mcp_append_YYYY-MM-DD.json` | **Exact subset for Notes/Doc append** (Part B) |

## MCP append payload (required shape)

Use **`mcp_append_*.json`** or the same object from code (`mcp_notes_append_payload` in `phase4/pulse_bundle.py`). Fields:

- `date`
- `weekly_pulse` — `{ themes, quotes, action_ideas }`
- `fee_scenario` — e.g. `"Mutual Fund Exit Load"`
- `explanation_bullets` — array, **≤ 6** factual bullets (no recommendations/comparisons)
- `source_links` — **2** official URLs (fund page + AMFI investor link by default)

**Approval-gated:** In Cursor, run the Google Docs MCP only after you review the JSON; do not auto-append without human approval unless your org policy allows it.

## Option A — Cursor + Google Docs MCP

1. Configure a **Google Docs MCP server** with Docs scope.
2. Run the pipeline or `python3 phase4/draft_email.py` so `output/mcp_append_*.json` exists.
3. Approve the append, then instruct the agent to insert a heading (e.g. `## Pulse 2026-03-21`) and paste the JSON (fenced code block or formatted bullets).

Do **not** commit OAuth tokens or service-account JSON.

## Option B — Manual

Open `mcp_append_*.json`, copy all text, paste at the end of your Google Doc.

## Option C — Automation later

Google Docs API + service account: read `mcp_append_*.json` and insert a paragraph — same schema as above.
