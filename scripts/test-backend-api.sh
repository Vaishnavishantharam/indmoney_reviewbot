#!/usr/bin/env bash
# Quick test for the Railway backend API (port 8000 internally; Railway URL has no port).
# Usage: bash scripts/test-backend-api.sh [BASE_URL] [--health-only]
#   BASE_URL default: https://indmoneyreviewbot-production.up.railway.app
#   For local: bash scripts/test-backend-api.sh http://localhost:8000
#   --health-only: only hit /health (no long-running pipeline)

set -e
BASE_URL="${1:-https://indmoneyreviewbot-production.up.railway.app}"
HEALTH_ONLY=false
[[ "$2" == "--health-only" ]] && HEALTH_ONLY=true
[[ "$1" == "--health-only" ]] && HEALTH_ONLY=true && BASE_URL="https://indmoneyreviewbot-production.up.railway.app"
BASE_URL="${BASE_URL%/}"

echo "Testing backend: $BASE_URL"
echo ""

echo "1. GET /health"
curl -s -w "\nHTTP %{http_code}\n" "$BASE_URL/health"
echo ""

if [[ "$HEALTH_ONLY" == "true" ]]; then
  echo "Done (--health-only). Omit it to run full POST /api/weekly-pulse."
  exit 0
fi

echo "2. POST /api/weekly-pulse (weeksBack=10) — may take 1–2 minutes..."
RESP=$(curl -s -w "\n%{http_code}" --max-time 180 -X POST "$BASE_URL/api/weekly-pulse" \
  -H "Content-Type: application/json" \
  -d '{"weeksBack": 10}')
HTTP_CODE=$(echo "$RESP" | tail -n1)
BODY=$(echo "$RESP" | sed '$d')
echo "HTTP $HTTP_CODE"
if echo "$BODY" | head -c 400 | grep -q '"pulse"'; then
  echo "OK — response has pulse JSON field."
  if echo "$BODY" | grep -q '"pulseBundle"'; then
    echo "OK — pulseBundle present (exit load + weekly_pulse schema)."
  else
    echo "Note: no pulseBundle (older backend?). Redeploy api_server with latest web_ui."
  fi
  echo "First 400 chars:"
  echo "$BODY" | head -c 400
  echo "..."
else
  echo "Response body:"
  echo "$BODY" | head -c 500
fi
