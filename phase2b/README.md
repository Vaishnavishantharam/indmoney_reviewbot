# Phase 2b — Review Classification (batched)

Assign each review to **exactly one theme** from Phase 2a. Processes reviews in **batches of ~50** (configurable) to stay within context limits.

**Input:**
- `reviews/reviews_YYYY-MM-DD.json` (full list from Phase 1)
- `themes/theme_labels_YYYY-MM-DD.json` (from Phase 2a; themes may be `[{ "label", "description" }, ...]` or `string[]`)

**Output:** `themes/themes_YYYY-MM-DD.json`:
- `themes`: theme list from 2a (labels + descriptions if present)
- `reviewIdToTheme`: `Record<string, string>` — review index (string) → theme label

**Constraints:** No PII; each review assigned to exactly one theme from 2a.

## Run (from repo root)

```bash
# Ensure .env has GROQ_API_KEY=... (or export it)
python3 phase2a/theme_discovery.py   # run 2a first
python3 phase2b/classify_reviews.py
```

**Config:**
- `GROQ_API_KEY` — required; from env or `.env`
- `CLASSIFY_CHUNK_SIZE` — reviews per Groq batch (default `50`)
