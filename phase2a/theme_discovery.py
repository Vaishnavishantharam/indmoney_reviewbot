#!/usr/bin/env python3
"""
Phase 2a — Theme Discovery.
Reads ALL reviews from reviews/reviews_YYYY-MM-DD.json, sends them to Groq to get 3–5 theme labels,
writes themes/theme_labels_YYYY-MM-DD.json. Prompt is capped to stay within context limit.
Run from repo root: python3 phase2a/theme_discovery.py
"""

import json
import os
import re
import sys
import time
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT))

REVIEWS_DIR = _REPO_ROOT / "reviews"


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


THEMES_DIR = _REPO_ROOT / "themes"
MAX_THEMES = 5
NUM_BATCHES = 2  # Send reviews in this many batches, then merge theme lists
# Cap total review text per batch to stay within context (~128k).
MAX_CHARS_PER_REVIEW = 400
MAX_PROMPT_REVIEW_CHARS = 80_000


def get_latest_reviews_path():
    """Return path to most recent reviews_YYYY-MM-DD.json."""
    if not REVIEWS_DIR.exists():
        raise FileNotFoundError(f"No reviews directory: {REVIEWS_DIR}")
    files = list(REVIEWS_DIR.glob("reviews_*.json"))
    if not files:
        raise FileNotFoundError(f"No reviews_*.json in {REVIEWS_DIR}")
    return max(files, key=lambda p: p.stem)


def load_all_reviews(path):
    """Load all reviews and return all review texts (no PII). Used for theme discovery from full dataset."""
    with open(path, encoding="utf-8") as f:
        reviews = json.load(f)
    if not reviews:
        raise ValueError("Reviews file is empty")
    return [r.get("text", "") for r in reviews], path.stem.replace("reviews_", "")


def split_into_batches(texts, n_batches):
    """Split list of texts into n_batches roughly equal batches."""
    if n_batches <= 1:
        return [texts] if texts else []
    size = max(1, (len(texts) + n_batches - 1) // n_batches)
    return [texts[i : i + size] for i in range(0, len(texts), size)][:n_batches]


def _get_client():
    try:
        from groq import Groq
    except ImportError:
        print("Missing dependency. Run: pip install groq")
        sys.exit(1)
    api_key = (os.environ.get("GROQ_API_KEY") or "").strip()
    if not api_key:
        print("GROQ_API_KEY is not set.")
        print("  Option 1: Add one line to the .env file in the project root:")
        print("    GROQ_API_KEY=gsk_your_actual_key_here")
        print("  Option 2: Run with: export GROQ_API_KEY=gsk_xxx && python3 phase2a/theme_discovery.py")
        print("  Get a key at: https://console.groq.com/keys")
        sys.exit(1)
    return Groq(api_key=api_key)


def _parse_theme_lines(text):
    """Parse LLM output into list of theme strings (max MAX_THEMES)."""
    themes = []
    for line in text.splitlines():
        line = re.sub(r"^[\d\.\)\-\*]+\s*", "", line.strip()).strip()
        if not line or len(line) < 2:
            continue
        if not any(t.lower() == line.lower() for t in themes):
            themes.append(line)
        if len(themes) >= MAX_THEMES:
            break
    return themes[:MAX_THEMES]


DEFAULT_THEMES = [
    {"label": "UX / Usability", "description": "Ease of use, navigation, and interface feedback"},
    {"label": "Performance", "description": "App speed, responsiveness, and stability"},
    {"label": "Features", "description": "Requests or feedback about functionality"},
    {"label": "Support", "description": "Customer support and resolution"},
    {"label": "Bugs / Issues", "description": "Defects, errors, and technical problems"},
]


def _parse_theme_lines_with_descriptions(text):
    """Parse LLM output into list of {label, description}. Expects pairs of lines: label then description."""
    themes = []
    lines = [re.sub(r"^[\d\.\)\-\*]+\s*", "", L.strip()).strip() for L in text.splitlines()]
    lines = [L for L in lines if L]
    i = 0
    while i < len(lines) and len(themes) < MAX_THEMES:
        label = lines[i]
        description = lines[i + 1] if i + 1 < len(lines) else ""
        if label and len(label) >= 2:
            themes.append({"label": label, "description": description or ""})
        i += 2
    return themes[:MAX_THEMES]


def call_groq_themes(client, review_texts, batch_label=""):
    """Call Groq to get 3–5 theme labels for one batch of reviews. Returns list of theme strings."""
    parts = [
        f"[Review {i+1}]\n{(t or '')[:MAX_CHARS_PER_REVIEW]}"
        for i, t in enumerate(review_texts)
        if (t or "").strip()
    ]
    combined = ""
    n_in_prompt = 0
    for p in parts:
        if len(combined) + len(p) + 2 > MAX_PROMPT_REVIEW_CHARS:
            break
        combined = (combined + "\n\n" + p) if combined else p
        n_in_prompt += 1
    combined = combined[:MAX_PROMPT_REVIEW_CHARS]
    print(f"  {batch_label}Sending {n_in_prompt} reviews in this request (of {len(review_texts)} in batch)")
    prompt = f"""Given these app store reviews, identify 3 to 5 distinct themes (e.g. UX/Usability, Performance, Features, Support, Bugs/Issues).
For each theme, give the theme label on one line, then a short one-line description on the next line. No numbering. Maximum {MAX_THEMES} themes.
Format:
Label1
Short description for label1
Label2
Short description for label2

Reviews:
{combined}
"""
    for attempt in range(3):
        try:
            response = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=400,
            )
            break
        except Exception as e:
            err_str = str(e).lower()
            if "429" not in err_str and "rate" not in err_str:
                raise
            if attempt == 2:
                raise
            wait = 60 * (attempt + 1)
            print(f"  Groq rate limit (429). Waiting {wait}s before retry {attempt + 1}/2...")
            time.sleep(wait)
    text = (response.choices[0].message.content or "").strip()
    themes = _parse_theme_lines_with_descriptions(text)
    if not themes:
        themes = [{"label": t["label"], "description": t.get("description", "")} for t in DEFAULT_THEMES]
    return themes[:MAX_THEMES]


def call_groq_merge_themes(client, list_of_theme_lists):
    """Ask LLM to merge multiple theme lists into one list of 3–5 themes with labels and descriptions."""
    # list_of_theme_lists is list of list of {label, description}
    combined = ""
    for i, theme_list in enumerate(list_of_theme_lists):
        combined += f"Batch {i+1}:\n"
        for t in theme_list:
            label = t.get("label", t) if isinstance(t, dict) else t
            desc = t.get("description", "") if isinstance(t, dict) else ""
            combined += f"  {label}: {desc}\n"
        combined += "\n"
    prompt = f"""These theme lists were generated from different batches of the same app's reviews. Merge them into a single list of 3 to 5 distinct themes that best cover all feedback.
For each final theme, give the theme label on one line, then a short one-line description on the next line. No numbering. Maximum {MAX_THEMES} themes.

{combined}
"""
    for attempt in range(3):
        try:
            response = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
                max_tokens=400,
            )
            break
        except Exception as e:
            err_str = str(e).lower()
            if "429" not in err_str and "rate" not in err_str:
                raise
            if attempt == 2:
                raise
            wait = 60 * (attempt + 1)
            print(f"  Groq rate limit (429). Waiting {wait}s before retry {attempt + 1}/2...")
            time.sleep(wait)
    text = (response.choices[0].message.content or "").strip()
    themes = _parse_theme_lines_with_descriptions(text)
    if not themes:
        # Fallback: use first batch's labels, empty descriptions
        seen = set()
        for lst in list_of_theme_lists:
            for t in lst:
                label = t.get("label", t) if isinstance(t, dict) else t
                k = (label or "").strip().lower()
                if k and k not in seen:
                    seen.add(k)
                    themes.append({"label": label.strip(), "description": t.get("description", "") if isinstance(t, dict) else ""})
                    if len(themes) >= MAX_THEMES:
                        break
            if len(themes) >= MAX_THEMES:
                break
    if not themes:
        themes = list(DEFAULT_THEMES)
    return themes[:MAX_THEMES]


def main():
    load_dotenv()
    THEMES_DIR.mkdir(parents=True, exist_ok=True)
    reviews_path = get_latest_reviews_path()
    print(f"Phase 2a — Theme discovery ({NUM_BATCHES} batches)")
    print(f"  Input: {reviews_path}")
    texts, date_str = load_all_reviews(reviews_path)
    texts = [t for t in texts if (t or "").strip()]
    print(f"  Total reviews: {len(texts)}")
    client = _get_client()
    batches = split_into_batches(texts, NUM_BATCHES)
    batch_themes = []
    for i, batch in enumerate(batches):
        th = call_groq_themes(client, batch, batch_label=f"Batch {i+1}/{len(batches)}: ")
        batch_themes.append(th)
        if i < len(batches) - 1:
            time.sleep(0.5)
    if len(batch_themes) > 1:
        print(f"  Merging {len(batch_themes)} theme lists into one...")
        themes = call_groq_merge_themes(client, batch_themes)
    else:
        themes = batch_themes[0] if batch_themes else []
    print(f"  Final themes: {[t.get('label', t) for t in themes]}")
    out_path = THEMES_DIR / f"theme_labels_{date_str}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"themes": themes}, f, indent=2)
    print(f"  Output: {out_path}")


if __name__ == "__main__":
    main()
