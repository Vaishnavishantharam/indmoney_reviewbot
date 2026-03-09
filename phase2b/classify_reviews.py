#!/usr/bin/env python3
"""
Phase 2b — Review Classification (batched).
Reads full reviews + theme list from 2a; processes in chunks of ~50; calls Groq per chunk;
merges and writes themes/themes_YYYY-MM-DD.json with themes + reviewIdToTheme.
Run from repo root: python3 phase2b/classify_reviews.py
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
THEMES_DIR = _REPO_ROOT / "themes"
# Reviews per batch; configurable via CLASSIFY_CHUNK_SIZE (default 50)
CHUNK_SIZE = int(os.environ.get("CLASSIFY_CHUNK_SIZE", "50"))


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


def get_latest_reviews_path():
    """Return path to most recent reviews_YYYY-MM-DD.json."""
    if not REVIEWS_DIR.exists():
        raise FileNotFoundError(f"No reviews directory: {REVIEWS_DIR}")
    files = list(REVIEWS_DIR.glob("reviews_*.json"))
    if not files:
        raise FileNotFoundError(f"No reviews_*.json in {REVIEWS_DIR}")
    return max(files, key=lambda p: p.stem)


def get_latest_theme_labels_path():
    """Return path to most recent theme_labels_YYYY-MM-DD.json."""
    if not THEMES_DIR.exists():
        raise FileNotFoundError(f"No themes directory: {THEMES_DIR}. Run Phase 2a first.")
    files = list(THEMES_DIR.glob("theme_labels_*.json"))
    if not files:
        raise FileNotFoundError(f"No theme_labels_*.json in {THEMES_DIR}. Run Phase 2a first.")
    return max(files, key=lambda p: p.stem)


def chunk_list(lst, size):
    """Yield chunks of size."""
    for i in range(0, len(lst), size):
        yield lst[i : i + size]


def normalize_theme_label(returned: str, theme_labels: list) -> str:
    """Map LLM response to exact theme label from our list."""
    if not returned or not theme_labels:
        return theme_labels[0] if theme_labels else ""
    r = (returned or "").strip()
    for label in theme_labels:
        if label == r:
            return label
    for label in theme_labels:
        if label.lower() == r.lower():
            return label
    for label in theme_labels:
        if r.lower() in label.lower() or label.lower() in r.lower():
            return label
    return theme_labels[0]


def call_groq_classify_chunk(theme_labels, chunk_reviews):
    """Classify one chunk of reviews. chunk_reviews = list of {index, text}. Returns dict index_str -> theme label."""
    try:
        from groq import Groq
    except ImportError:
        print("Missing dependency. Run: pip install groq")
        sys.exit(1)
    api_key = (os.environ.get("GROQ_API_KEY") or "").strip()
    if not api_key:
        print("GROQ_API_KEY is not set.")
        print("  Option 1: Add GROQ_API_KEY=... to .env in the project root.")
        print("  Option 2: Run with: export GROQ_API_KEY=gsk_xxx && python3 phase2b/classify_reviews.py")
        sys.exit(1)
    client = Groq(api_key=api_key)
    themes_str = ", ".join(theme_labels)
    lines = []
    for r in chunk_reviews:
        idx = r["index"]
        text = (r.get("text") or "")[:400]
        lines.append(f"Index {idx}: {text}")
    block = "\n".join(lines)
    prompt = f"""Themes (use exactly one per review; return the exact theme label as given): {themes_str}

For each review below, assign exactly one theme from the list. Reply with a JSON object mapping index to theme label, e.g. {{"0": "UX/Usability", "1": "Performance"}}. Use string keys. Return only the JSON object, no other text.

Reviews:
{block}
"""
    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=1024,
    )
    text = (response.choices[0].message.content or "").strip()
    # Extract JSON (handle markdown code blocks)
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return {}
    try:
        raw = json.loads(m.group())
        # Normalize values to exact theme labels
        return {k: normalize_theme_label(v, theme_labels) for k, v in raw.items()}
    except json.JSONDecodeError:
        return {}


def build_themes_with_reviews(themes, reviews, review_id_to_theme):
    """Group reviews under each theme. Returns list of { theme, description?, reviews } in theme order."""
    theme_labels = [t.get("label", t) if isinstance(t, dict) else t for t in themes]
    # Index reviews by id for lookup
    reviews_by_id = {str(r["index"]): r for r in reviews}
    # For each theme, collect reviews assigned to it
    theme_to_reviews = {label: [] for label in theme_labels}
    for rid, label in review_id_to_theme.items():
        if label in theme_to_reviews and rid in reviews_by_id:
            theme_to_reviews[label].append(reviews_by_id[rid])
    # Build list in theme order: theme (label + description), then its reviews
    result = []
    for t in themes:
        label = t.get("label", t) if isinstance(t, dict) else t
        desc = t.get("description", "") if isinstance(t, dict) else ""
        result.append({
            "theme": {"label": label, "description": desc} if isinstance(t, dict) else {"label": label, "description": ""},
            "reviews": theme_to_reviews.get(label, []),
        })
    return result


def remove_older_classification_files(keep_date_str: str):
    """Remove older themes_*.json and themes_grouped_* files; keep only the latest (keep_date_str)."""
    import re as re_mod
    for p in THEMES_DIR.iterdir():
        if not p.is_file():
            continue
        name = p.name
        # themes_YYYY-MM-DD.json or themes_grouped_YYYY-MM-DD.json / .md
        m = re_mod.match(r"themes(_grouped)?_(\d{4}-\d{2}-\d{2})\.(json|md)$", name)
        if m and m.group(2) != keep_date_str:
            try:
                p.unlink()
                print(f"  Removed older: {name}")
            except OSError:
                pass


def write_grouped_md(themes_with_reviews, path):
    """Write a markdown file: each theme as heading, then its reviews."""
    lines = ["# Themes and reviews (grouped)\n"]
    for entry in themes_with_reviews:
        theme = entry["theme"]
        label = theme.get("label", "")
        desc = theme.get("description", "")
        reviews = entry.get("reviews", [])
        lines.append(f"## {label}\n")
        if desc:
            lines.append(f"{desc}\n")
        lines.append(f"*{len(reviews)} reviews*\n")
        for r in reviews:
            text = (r.get("text") or "").strip()
            rating = r.get("rating", "")
            date_display = r.get("dateDisplay", "")
            if text:
                lines.append(f"- [{rating}★] {text}")
                if date_display:
                    lines.append(f"  — {date_display}")
                lines.append("")
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def get_latest_themes_path():
    """Return path to most recent themes_YYYY-MM-DD.json (Phase 2b output)."""
    if not THEMES_DIR.exists():
        raise FileNotFoundError(f"No themes directory: {THEMES_DIR}")
    files = list(THEMES_DIR.glob("themes_[0-9]*.json"))
    files = [p for p in files if "grouped" not in p.name]
    if not files:
        raise FileNotFoundError(f"No themes_YYYY-MM-DD.json in {THEMES_DIR}. Run Phase 2b first.")
    return max(files, key=lambda p: p.stem)


def main():
    load_dotenv()
    THEMES_DIR.mkdir(parents=True, exist_ok=True)
    grouped_only = "--grouped-only" in sys.argv
    if grouped_only:
        # Build grouped output from existing themes_*.json and reviews_*.json (no Groq calls)
        reviews_path = get_latest_reviews_path()
        themes_path = get_latest_themes_path()
        date_str = reviews_path.stem.replace("reviews_", "")
        with open(reviews_path, encoding="utf-8") as f:
            reviews = json.load(f)
        with open(themes_path, encoding="utf-8") as f:
            data = json.load(f)
        themes = data.get("themes") or []
        review_id_to_theme = data.get("reviewIdToTheme") or {}
        if not themes or not review_id_to_theme:
            print("themes_*.json must contain themes and reviewIdToTheme. Run Phase 2b first.")
            sys.exit(1)
        themes_with_reviews = build_themes_with_reviews(themes, reviews, review_id_to_theme)
        grouped_json_path = THEMES_DIR / f"themes_grouped_{date_str}.json"
        with open(grouped_json_path, "w", encoding="utf-8") as f:
            json.dump({"themesWithReviews": themes_with_reviews}, f, indent=2)
        grouped_md_path = THEMES_DIR / f"themes_grouped_{date_str}.md"
        write_grouped_md(themes_with_reviews, grouped_md_path)
        print(f"Grouped output: {grouped_json_path}, {grouped_md_path}")
        remove_older_classification_files(date_str)
        return
    reviews_path = get_latest_reviews_path()
    labels_path = get_latest_theme_labels_path()
    date_str = reviews_path.stem.replace("reviews_", "")
    with open(reviews_path, encoding="utf-8") as f:
        reviews = json.load(f)
    with open(labels_path, encoding="utf-8") as f:
        data = json.load(f)
    themes = data.get("themes") or []
    if not themes:
        print("No themes in theme_labels file. Run Phase 2a again.")
        sys.exit(1)
    # Support both formats: list of {label, description} or list of strings
    theme_labels = [
        t.get("label", t) if isinstance(t, dict) else t
        for t in themes
    ]
    print(f"Phase 2b — Review classification (chunk size {CHUNK_SIZE})")
    print(f"  Reviews: {reviews_path} ({len(reviews)} reviews)")
    print(f"  Themes: {theme_labels}")
    review_id_to_theme = {}
    chunks = list(chunk_list(reviews, CHUNK_SIZE))
    for i, chunk in enumerate(chunks):
        result = call_groq_classify_chunk(theme_labels, chunk)
        for k, v in result.items():
            review_id_to_theme[str(k)] = v
        print(f"  Chunk {i+1}/{len(chunks)}: {len(result)} classified")
        time.sleep(0.5)
    out_path = THEMES_DIR / f"themes_{date_str}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"themes": themes, "reviewIdToTheme": review_id_to_theme}, f, indent=2)
    print(f"  Output: {out_path} ({len(review_id_to_theme)} mappings)")

    # Grouped output: each theme with its reviews nested under it
    themes_with_reviews = build_themes_with_reviews(themes, reviews, review_id_to_theme)
    grouped_json_path = THEMES_DIR / f"themes_grouped_{date_str}.json"
    with open(grouped_json_path, "w", encoding="utf-8") as f:
        json.dump({"themesWithReviews": themes_with_reviews}, f, indent=2)
    grouped_md_path = THEMES_DIR / f"themes_grouped_{date_str}.md"
    write_grouped_md(themes_with_reviews, grouped_md_path)
    print(f"  Grouped: {grouped_json_path}, {grouped_md_path}")
    remove_older_classification_files(date_str)


if __name__ == "__main__":
    main()
