#!/usr/bin/env bash
# Run the weekly pulse scheduler (Sunday 9:45 PM CST). Logs: logs/scheduler.log
# From repo root: bash scripts/run-scheduler.sh
# Test at 19:20, 19:25, 19:30: SCHEDULER_TEST_TIMES=1 bash scripts/run-scheduler.sh

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [[ ! -d .venv ]]; then
  echo "Creating .venv ..."
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -q -r requirements.txt
echo "Scheduler logs: logs/scheduler.log"
echo "Starting scheduler. Press Ctrl+C to stop."
exec python3 scripts/scheduler.py
