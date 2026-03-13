#!/usr/bin/env bash
# Start the Python web UI and open the app in your browser.
# From repo root: bash scripts/open-ui.sh

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

export PORT="${PORT:-5001}"
URL="http://127.0.0.1:${PORT}"

echo "Starting web UI on $URL"
echo "Opening in browser in 2 seconds... (Ctrl+C to cancel)"
(sleep 2; open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null || true) &
exec .venv/bin/python3 web_ui.py
