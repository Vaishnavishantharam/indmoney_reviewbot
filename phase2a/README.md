# Phase 2a — Theme Discovery

Generate 3–5 theme labels from a **sample** of reviews using Groq.

**Input:** `reviews/reviews_YYYY-MM-DD.json` (uses latest file; **all reviews** sent to LLM, truncated per review and total to fit context)  
**Output:** `themes/theme_labels_YYYY-MM-DD.json` — `{ "themes": ["Theme1", "Theme2", ...] }`

## Run (from repo root)

```bash
export GROQ_API_KEY=your_key
python3 phase2a/theme_discovery.py
```

Requires Phase 1 data. Run Phase 2b after this to classify all reviews by theme.
