# Phase 3 — One-Page Weekly Note (Gemini)

Produce a **scannable one-pager** (≤250 words): **top 3 themes**, **3 user quotes**, **3 action ideas**. No PII. Uses **Gemini** as the LLM (not Groq).

**Input:** `themes/themes_grouped_YYYY-MM-DD.json` (from Phase 2b; themes with nested reviews)

**Output:**
- `output/weekly-pulse_YYYY-MM-DD.md` — One-page weekly pulse (markdown)
- `output/theme-legend.md` — Theme labels and short descriptions

**Validation:** Word count ≤250; basic PII check (no emails/@handles in output).

## Run (from repo root)

**Option A — Use project venv (recommended if base env has pip issues):**

```bash
# Set GEMINI_API_KEY in .env first. Get key at: https://aistudio.google.com/apikey
bash scripts/setup-venv-and-run-phase3.sh
```

This creates `.venv/`, installs `google-generativeai` there, and runs Phase 3. Use this if you see `InvalidVersion: '4.0.0-unsupported'` or dependency conflicts in your base environment.

**Option B — Install in current environment:**

```bash
pip install "google-generativeai>=0.8.0,<0.9"   # pin to 0.8.x (avoid old 0.1.x)
python3 phase3/weekly_pulse.py
```

Requires Phase 2b so that `themes_grouped_*.json` exists.
