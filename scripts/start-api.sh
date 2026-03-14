#!/bin/sh
# Start the API server bound to PORT (Railway / Render set this at runtime).
set -e
PORT="${PORT:-8000}"
echo "Starting API on 0.0.0.0:${PORT} (worker timeout 5m for pipeline)"
exec gunicorn -w 1 -b "0.0.0.0:${PORT}" --timeout 300 api_server:app
