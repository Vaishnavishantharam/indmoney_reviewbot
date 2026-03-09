#!/usr/bin/env python3
"""
Phase 1 — Fetch IND Money Play Store reviews.
Run from repo root: python3 phase1/fetch_reviews.py
Writes to reviews/reviews_YYYY-MM-DD.json and .csv (at repo root).
"""

import csv
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

# Repo root: one level up from phase1/
_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT))

try:
    from google_play_scraper import reviews, Sort
except ImportError:
    print("Missing dependency. Run: pip install google-play-scraper")
    sys.exit(1)

try:
    from langdetect import detect, LangDetectException
except ImportError:
    detect = None
    LangDetectException = Exception

APP_ID = os.environ.get("APP_ID", "in.indwealth")
WEEKS_BACK = int(os.environ.get("WEEKS_BACK", "8"))
WEEKS_BACK = max(8, min(12, WEEKS_BACK))
MAX_REVIEWS = int(os.environ.get("MAX_REVIEWS", "1000"))
REVIEWS_DIR = _REPO_ROOT / "reviews"
PAGE_DELAY_SEC = 1.2
MIN_WORDS = 5  # Drop reviews with fewer than this many real words (ignores emoji-only tokens)


def _real_word_count(text):
    """Count tokens that contain at least one letter or digit (excludes emoji-only tokens)."""
    if not text or not isinstance(text, str):
        return 0
    words = [t for t in text.split() if any(c.isalnum() for c in t)]
    return len(words)


def is_meaningful_review(title, text):
    """Keep only if at least MIN_WORDS real words; drops very short and emoji-only reviews."""
    combined = f"{(title or '').strip()} {(text or '').strip()}".strip()
    return _real_word_count(combined) >= MIN_WORDS


def is_english(text):
    """Keep only if the text is detected as English. Drops other languages."""
    if not text or not isinstance(text, str) or len(text.strip()) < 10:
        return False
    if detect is None:
        return True  # no langdetect: keep all
    try:
        return detect(text) == "en"
    except (LangDetectException, Exception):
        return False


def format_date_display(iso_date):
    if not iso_date:
        return ""
    try:
        d = datetime.fromisoformat(iso_date.replace("Z", "+00:00"))
        return d.strftime("%B %d, %Y")  # June 22, 2025
    except Exception:
        return iso_date


def redact(review, index):
    """Keep only rating, text, date, dateDisplay, helpfulCount — no PII, no title."""
    raw_date = review.get("at") or review.get("date")
    if hasattr(raw_date, "isoformat"):
        date = raw_date.isoformat()
    else:
        date = str(raw_date) if raw_date else ""
    return {
        "index": index,
        "rating": int(review.get("score", 0) or 0),
        "text": (review.get("content") or review.get("text") or "").strip(),
        "date": date,
        "dateDisplay": format_date_display(date),
        "helpfulCount": int(review.get("thumbsUpCount", 0) or review.get("thumbsUp", 0) or 0),
    }


def main():
    import time

    REVIEWS_DIR.mkdir(parents=True, exist_ok=True)
    cutoff = datetime.utcnow() - timedelta(weeks=WEEKS_BACK)
    cutoff_ts = cutoff.timestamp()

    print("Phase 1 — Fetch reviews (Python)")
    print(f"  APP_ID: {APP_ID}")
    print(f"  WEEKS_BACK: {WEEKS_BACK}")
    print(f"  MAX_REVIEWS: {MAX_REVIEWS}")
    print("  Using google-play-scraper (Python) with pagination…\n")

    all_raw = []
    continuation_token = None

    fetch_limit = max(MAX_REVIEWS * 3, 1500)  # fetch enough raw to get MAX_REVIEWS after filter
    while len(all_raw) < fetch_limit:
        try:
            if continuation_token is None:
                result, continuation_token = reviews(
                    APP_ID,
                    lang="en",
                    country="us",
                    sort=Sort.NEWEST,
                    count=200,
                )
            else:
                result, continuation_token = reviews(APP_ID, continuation_token=continuation_token)
        except Exception as e:
            print(f"\n  Stopping: {e}")
            break

        added = 0
        for r in result:
            raw_date = r.get("at") or r.get("date")
            if raw_date is None:
                all_raw.append(r)
                added += 1
                continue
            if hasattr(raw_date, "timestamp"):
                ts = raw_date.timestamp()
            else:
                try:
                    ts = datetime.fromisoformat(str(raw_date).replace("Z", "+00:00")).timestamp()
                except Exception:
                    ts = 0
            if ts >= cutoff_ts:
                all_raw.append(r)
                added += 1
            if len(all_raw) >= fetch_limit:
                break

        print(f"\r  Fetched {len(all_raw)} reviews in last {WEEKS_BACK} weeks", end="", flush=True)
        no_more = continuation_token is None or getattr(continuation_token, "token", None) is None
        if no_more or not result or added == 0:
            break
        time.sleep(PAGE_DELAY_SEC)

    redacted = [redact(r, i) for i, r in enumerate(all_raw[:fetch_limit])]
    before_filter = len(redacted)
    redacted = [r for r in redacted if is_meaningful_review("", r["text"])]
    after_meaningful = len(redacted)
    redacted = [r for r in redacted if is_english(r["text"])]
    after_english = len(redacted)
    redacted = redacted[:MAX_REVIEWS]
    redacted = [{**r, "index": i} for i, r in enumerate(redacted)]
    removed_meaningful = before_filter - after_meaningful
    removed_non_english = after_meaningful - after_english

    date_str = datetime.utcnow().strftime("%Y-%m-%d")
    json_path = REVIEWS_DIR / f"reviews_{date_str}.json"
    csv_path = REVIEWS_DIR / f"reviews_{date_str}.csv"

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(redacted, f, indent=2, ensure_ascii=False)

    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["index", "rating", "text", "date", "dateDisplay", "helpfulCount"])
        for r in redacted:
            w.writerow([
                r["index"],
                r["rating"],
                r["text"],
                r["date"],
                r["dateDisplay"],
                r["helpfulCount"],
            ])

    print("\n\nDone.")
    print(f"  Before filter: {before_filter} | Removed (short/emoji-only): {removed_meaningful} | Removed (non-English): {removed_non_english} | Reviews kept: {len(redacted)}")
    print(f"  JSON: {json_path}")
    print(f"  CSV: {csv_path}")


if __name__ == "__main__":
    main()
