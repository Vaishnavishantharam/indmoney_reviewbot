#!/usr/bin/env bash
# Use a project venv to avoid pip errors from other packages in base (e.g. Invalid version '4.0.0-unsupported').
# Run from repo root: bash scripts/setup-venv-and-run-phase3.sh

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV_DIR="$REPO_ROOT/.venv"

if [[ ! -d "$VENV_DIR" ]]; then
  echo "Creating venv at $VENV_DIR ..."
  python3 -m venv "$VENV_DIR"
fi
echo "Activating venv ..."
# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"
echo "Installing dependencies (Phase 3 needs google-generativeai) ..."
pip install -q --upgrade pip
pip install -q google-genai
echo "Running Phase 3 ..."
python3 "$REPO_ROOT/phase3/weekly_pulse.py"
