#!/usr/bin/env bash
# Run pipeline phase by phase (1 → 2a → 2b → 3), then start the Python web UI and print the URL.
# From repo root: bash scripts/run-phases-then-ui.sh
# Ensure .env has GROQ_API_KEY, GEMINI_API_KEY (and email vars if you'll send from UI).

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "--- Phase 1: Fetch reviews ---"
python3 phase1/fetch_reviews.py
echo ""

echo "--- Phase 2a: Theme discovery ---"
python3 phase2a/theme_discovery.py
echo ""

echo "--- Phase 2b: Classify reviews ---"
python3 phase2b/classify_reviews.py
echo ""

echo "--- Phase 3: Weekly one-pager ---"
bash scripts/setup-venv-and-run-phase3.sh
echo ""

echo "--- All phases done. Starting web UI ---"
echo ""
echo "  Open in your browser:  http://127.0.0.1:5001"
echo "  (Press Ctrl+C to stop the server.)"
echo ""
exec python3 web_ui.py
