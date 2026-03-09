# Phase 2 — Theme Discovery (2a) & Review Classification (2b)

Phase 2 is split into:

- **Phase 2a** — Theme discovery: Groq generates 3–5 theme labels from a sample of reviews.  
  Code: `phase2a/theme_discovery.py` → output `themes/theme_labels_YYYY-MM-DD.json`.

- **Phase 2b** — Review classification: Full review list + theme list from 2a; process in **batches of ~50**; Groq assigns each review to one theme.  
  Code: `phase2b/classify_reviews.py` → output `themes/themes_YYYY-MM-DD.json`.

See ARCHITECTURE.md Phase 2a and 2b. Run 2a then 2b from repo root with `GROQ_API_KEY` set.
