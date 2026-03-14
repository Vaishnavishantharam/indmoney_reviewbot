#!/bin/sh
# Start the API server bound to PORT (Railway / Render set this at runtime).
set -e
PORT="${PORT:-8000}"
echo "Starting API on 0.0.0.0:${PORT}"
exec gunicorn -w 1 -b "0.0.0.0:${PORT}" api_server:app
