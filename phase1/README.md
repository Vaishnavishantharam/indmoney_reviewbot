# Phase 1 — Data Ingress (Fetch Reviews)

Import Google Play Store reviews for IND Money (last 8–12 weeks). Output: `reviews/` at repo root (JSON + CSV, no PII).

## Run (from repo root)

**Python (recommended, no Node required):**
```bash
pip install -r requirements.txt
python3 phase1/fetch_reviews.py
```

**Node (optional):**
```bash
npm run fetch-reviews          # API method
npm run fetch-reviews:playwright   # Browser method
```

## Env (optional)

- `APP_ID` — default `in.indwealth`
- `WEEKS_BACK` — 8–12, default 10
- `MAX_REVIEWS` — default 500

## Output

- `reviews/reviews_YYYY-MM-DD.json`
- `reviews/reviews_YYYY-MM-DD.csv`

Schema: `index`, `rating`, `text`, `date`, `dateDisplay`, `helpfulCount`. Reviews with &lt;5 words or emoji-only are filtered out.
