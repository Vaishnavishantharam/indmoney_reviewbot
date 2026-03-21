#!/usr/bin/env python3
"""
Phase 3 — One-Page Weekly Note (LLM: Gemini).
Reads themes + grouped reviews from themes/themes_grouped_YYYY-MM-DD.json;
calls Gemini to produce a scannable one-pager: top 3 themes, 3 user quotes,
3 action ideas. Writes output/weekly-pulse_YYYY-MM-DD.md and .txt (with
"Week of Month DD, YYYY" at top), and output/theme-legend.md.
Run from repo root: python3 phase3/weekly_pulse.py
"""

import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT))

THEMES_DIR = _REPO_ROOT / "themes"
OUTPUT_DIR = _REPO_ROOT / "output"
MAX_WORDS = 450
TOP_THEMES = 3
NUM_QUOTES = 3
NUM_ACTIONS = 3


def load_dotenv():
    """Load .env from repo root or cwd into os.environ."""
    for base in (_REPO_ROOT, Path.cwd()):
        env_path = base / ".env"
        if not env_path.exists():
            continue
        try:
            content = env_path.read_text(encoding="utf-8")
        except Exception:
            continue
        for line in content.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            eq = line.find("=")
            if eq <= 0:
                continue
            key = line[:eq].strip()
            value = line[eq + 1 :].strip().strip("'\"")
            if key:
                os.environ[key] = value
        return


def get_latest_grouped_path():
    """Return path to most recent themes_grouped_YYYY-MM-DD.json."""
    if not THEMES_DIR.exists():
        raise FileNotFoundError(f"No themes directory: {THEMES_DIR}. Run Phase 2b first.")
    files = list(THEMES_DIR.glob("themes_grouped_*.json"))
    if not files:
        raise FileNotFoundError(
            f"No themes_grouped_*.json in {THEMES_DIR}. Run Phase 2b (and optionally --grouped-only) first."
        )
    return max(files, key=lambda p: p.stem)


def load_grouped_data(path):
    """Load themesWithReviews from grouped JSON."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("themesWithReviews") or []


def build_prompt_input(themes_with_reviews):
    """Build theme summary and quote list for the LLM."""
    # Only themes with at least 1 review; sort by count descending, take top 3
    entries = [
        {
            "label": e["theme"].get("label", ""),
            "description": e["theme"].get("description", ""),
            "count": len(e.get("reviews", [])),
        }
        for e in themes_with_reviews
        if len(e.get("reviews", [])) > 0
    ]
    entries.sort(key=lambda x: -x["count"])
    top = entries[:TOP_THEMES]

    theme_lines = []
    for i, t in enumerate(top, 1):
        theme_lines.append(f"{i}. {t['label']} ({t['count']} reviews): {t['description'] or 'N/A'}")

    # Collect anonymized quote candidates (no PII): up to ~15 from across top themes
    quotes = []
    for e in themes_with_reviews:
        label = e["theme"].get("label", "")
        for r in e.get("reviews", [])[:5]:
            text = (r.get("text") or "").strip()
            if text and len(text) >= 10:
                quotes.append(f"[{label}] \"{text[:200]}{'...' if len(text) > 200 else ''}\"")
    quotes = quotes[:20]

    theme_summary_out = "\n\n".join(theme_lines) if theme_lines else "(No themes with reviews in this run. Do not invent themes or counts.)"
    quotes_out = "\n".join(quotes) if quotes else "(No sample quotes available.)"
    return theme_summary_out, quotes_out


def call_gemini(prompt: str) -> str:
    """Call Gemini API (google-genai SDK); return generated text."""
    try:
        from google import genai
    except ImportError:
        print("Missing dependency. Run: pip install google-genai")
        sys.exit(1)
    api_key = (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or "").strip()
    if not api_key:
        print("GEMINI_API_KEY is not set.")
        print("  Add GEMINI_API_KEY=... to .env or set GOOGLE_API_KEY.")
        print("  Get a key at: https://aistudio.google.com/apikey")
        sys.exit(1)
    client = genai.Client(api_key=api_key)
    try:
        config = genai.types.GenerateContentConfig(max_output_tokens=3072, temperature=0.3)
        response = client.models.generate_content(model="gemini-2.5-flash", contents=prompt, config=config)
    except (AttributeError, TypeError):
        response = client.models.generate_content(model="gemini-2.5-flash", contents=prompt)
    text = getattr(response, "text", None) or (
        response.candidates[0].content.parts[0].text
        if response.candidates and response.candidates[0].content.parts
        else None
    )
    if not text:
        raise RuntimeError("Gemini returned no text")
    return text.strip()


def word_count(text: str) -> int:
    return len(text.split())


def has_pii(text: str) -> bool:
    """Simple check: emails, @handles, obvious user IDs."""
    if re.search(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b", text):
        return True
    if re.search(r"@[A-Za-z0-9_]+", text):
        return True
    return False


def write_theme_legend(themes_with_reviews, path: Path):
    """Write theme-legend.md with label and description per theme (no top-level heading; UI shows its own title)."""
    lines = []
    for e in themes_with_reviews:
        t = e["theme"]
        label = t.get("label", "")
        desc = t.get("description", "")
        n = len(e.get("reviews", []))
        lines.append(f"## {label}\n")
        if desc:
            lines.append(f"{desc}\n")
        lines.append(f"*{n} reviews*\n")
    path.write_text("\n".join(lines), encoding="utf-8")


def main():
    load_dotenv()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    grouped_path = get_latest_grouped_path()
    date_str = grouped_path.stem.replace("themes_grouped_", "")
    themes_with_reviews = load_grouped_data(grouped_path)
    if not themes_with_reviews:
        print("No themes in grouped file.")
        sys.exit(1)

    theme_summary, quotes_block = build_prompt_input(themes_with_reviews)

    prompt = f"""Generate a weekly one-page note for product leadership from the app store review data below.

**Theme summary (top themes by review count):**
{theme_summary}

**Sample anonymized quotes (use or paraphrase ONLY from this list; do not invent quotes):**
{quotes_block}

**REQUIRED OUTPUT — follow this markdown template exactly (keep # characters; do not output plain text headings).**

## Weekly One-Page Note

### Top 3 Themes
1. **Theme label (N reviews):** One or two sentences on what users are saying. Use real labels and counts from the theme summary only.
2. **Theme label (N reviews):** One or two sentences.
3. **Theme label (N reviews):** One or two sentences.

### 3 User Quotes
Exactly three lines. Each line MUST be: asterisk, space, double-quoted quote (no merging into one paragraph).
* "First quote."
* "Second quote."
* "Third quote."

### 3 Action Ideas
1. **Short action title:** One or two sentences (concrete next step).
2. **Short action title:** One or two sentences.
3. **Short action title:** One or two sentences.

---
RULES: Output ONLY from "## Weekly One-Page Note" through action item 3. Keep ### headers and numbered lists exactly as in the template. Do not invent themes or counts. If sample quotes are empty, output three lines: * "(No user quotes available this week.)" on each line. Aim for 300–{MAX_WORDS} words. Professional tone. No sign-off."""

    print("Phase 3 — One-page weekly pulse (Gemini)")
    print(f"  Input: {grouped_path}")
    print("  Calling Gemini...")
    raw = call_gemini(prompt)

    # Validation
    words = word_count(raw)
    if words > MAX_WORDS + 100:
        print(f"  Warning: output is {words} words (max {MAX_WORDS}). Trimming to first ~{MAX_WORDS} words.")
        parts = raw.split()
        raw = " ".join(parts[:MAX_WORDS])
    if has_pii(raw):
        print("  Warning: possible PII detected in output. Please review.")

    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        week_header = dt.strftime("Week of %B %d, %Y")
    except ValueError:
        week_header = f"Week of {date_str}"
    content_with_header = f"{week_header}\n\n{raw}"

    out_md = OUTPUT_DIR / f"weekly-pulse_{date_str}.md"
    out_md.write_text(content_with_header, encoding="utf-8")
    print(f"  Output: {out_md} ({word_count(raw)} words)")

    out_txt = OUTPUT_DIR / f"weekly-pulse_{date_str}.txt"
    out_txt.write_text(content_with_header, encoding="utf-8")
    print(f"  Output: {out_txt}")

    legend_path = OUTPUT_DIR / "theme-legend.md"
    write_theme_legend(themes_with_reviews, legend_path)
    print(f"  Theme legend: {legend_path}")


if __name__ == "__main__":
    main()
