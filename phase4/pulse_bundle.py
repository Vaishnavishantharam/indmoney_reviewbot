#!/usr/bin/env python3
"""
Phase 3.1 + fee enrichment — build pulse_bundle_YYYY-MM-DD.json (ARCHITECTURE.md §3.1)
and Markdown/plain fragments for the Mutual Fund Exit Load email block.

Exit-load text: tries HTTP fetch of EXIT_LOAD_SOURCE_URL (public IND Money pages).
Many sites return Cloudflare challenges to simple clients; in that case use
EXIT_LOAD_BULLETS_JSON or built-in educational fallbacks + source link(s).

Run from repo root:
  python3 phase4/pulse_bundle.py [weekly-pulse_YYYY-MM-DD.md]
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = _REPO_ROOT / "output"

DEFAULT_EXIT_LOAD_URL = (
    "https://www.indmoney.com/mutual-funds/hdfc-mid-cap-fund-direct-plan-growth-option-3097"
)
# Second official reference (industry / regulatory context); pair with fund URL for Part B “2 official links”.
DEFAULT_OFFICIAL_SECOND_LINK = "https://www.amfiindia.com/investor-zone/investor-information"

MIN_FEE_BULLETS = 3
MAX_FEE_BULLETS = 6

# Facts-only, neutral; no product recommendations or comparisons (Part B).
FALLBACK_EXIT_LOAD_BULLETS = [
    "Exit load is a charge some mutual fund schemes apply on redemption within a defined holding period when that term appears in the scheme documents.",
    "The applicable percentage and holding period are stated in the scheme information document and any addenda published for that scheme.",
    "A scheme may disclose nil exit load after a stated minimum holding period.",
    "Disclosure formats include scheme factsheets and offer documents made available by the asset management company.",
    "Registrar and platform pages typically reproduce the exit-load terms supplied for that scheme.",
    "Exit-load calculations follow the conventions (e.g., holding period, rounding) described in the scheme’s stated terms.",
]

FEE_SCENARIO_LABEL = "Mutual Fund Exit Load"


def load_dotenv() -> None:
    for base in (_REPO_ROOT, Path.cwd()):
        env_path = base / ".env"
        if not env_path.exists():
            continue
        try:
            content = env_path.read_text(encoding="utf-8")
        except OSError:
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


def _source_urls() -> list[str]:
    load_dotenv()
    raw = (os.environ.get("EXIT_LOAD_SOURCE_URL") or "").strip() or DEFAULT_EXIT_LOAD_URL
    return [u.strip() for u in raw.split(",") if u.strip()]


def normalize_official_source_links(urls: list[str]) -> list[str]:
    """Part B: at least two distinct official-style URLs in source_links (typically fund page + AMFI/SEBI-class link)."""
    out: list[str] = []
    for u in urls:
        u = (u or "").strip()
        if u and u not in out:
            out.append(u)
    second = (os.environ.get("EXIT_LOAD_SECOND_OFFICIAL_URL") or "").strip() or DEFAULT_OFFICIAL_SECOND_LINK
    if len(out) < 2:
        for extra in (second, DEFAULT_EXIT_LOAD_URL):
            if extra and extra not in out:
                out.append(extra)
            if len(out) >= 2:
                break
    return out[:2] if len(out) >= 2 else out


def _fetch_url(url: str, timeout: float = 25.0) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; WeeklyPulseBot/1.0; +https://example.invalid)",
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _try_playwright_html(url: str) -> str | None:
    """Use repo-root Playwright script when urllib hits Cloudflare."""
    script = _REPO_ROOT / "scripts" / "fetch-exit-load-playwright.mjs"
    if not script.is_file():
        return None
    try:
        r = subprocess.run(
            ["node", str(script), url],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=str(_REPO_ROOT),
        )
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return None
    if r.returncode != 0 or not (r.stdout or "").strip():
        return None
    return r.stdout


def _is_cloudflare_challenge(html: str) -> bool:
    if len(html) < 800:
        return True
    h = html.lower()
    return "cf-chl" in h or "challenges.cloudflare.com" in h or "just a moment" in h


def _strip_html_tags(html: str) -> str:
    t = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", html)
    t = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", t)
    t = re.sub(r"(?s)<[^>]+>", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _cap_sentence(p: str, max_len: int = 280) -> str:
    p = p.strip()
    if len(p) <= max_len:
        return p
    return p[: max_len - 1].rsplit(" ", 1)[0] + "…"


def _fallback_exit_load_sentences(full_text: str, max_bullets: int = MAX_FEE_BULLETS) -> list[str]:
    """Scan full page text for sentences mentioning exit load / redemption charges."""
    if not full_text:
        return []
    parts = re.split(r"(?<=[.!?])\s+", full_text.replace("\n", " "))
    out: list[str] = []
    for p in parts:
        p = p.strip()
        if len(p) < 30:
            continue
        pl = p.lower()
        hit = ("exit" in pl and "load" in pl) or (
            "redemption" in pl and ("charge" in pl or "fee" in pl or "load" in pl)
        )
        if not hit:
            continue
        p = _cap_sentence(p)
        if p not in out:
            out.append(p)
        if len(out) >= max_bullets:
            break
    return out


def _extract_exit_load_bullets_from_html(html: str, max_bullets: int = MAX_FEE_BULLETS) -> list[str]:
    """Heuristic: visible text around 'exit load'. Returns up to MAX_FEE_BULLETS short sentences."""
    text = _strip_html_tags(html)
    if not text or len(text) < 50:
        return []
    low = text.lower()
    idx = -1
    for key in ("exit load", "exit-load", "exitload"):
        idx = low.find(key)
        if idx >= 0:
            break
    out: list[str] = []
    if idx >= 0:
        window = text[idx : idx + 2200]
        parts = re.split(r"(?<=[.!?])\s+", window)
        for p in parts:
            p = p.strip()
            if len(p) < 25:
                continue
            pl = p.lower()
            if "exit" not in pl and "load" not in pl and "redemp" not in pl:
                continue
            out.append(_cap_sentence(p))
            if len(out) >= max_bullets:
                return out
    if len(out) < max_bullets:
        for extra in _fallback_exit_load_sentences(text, max_bullets):
            if extra not in out:
                out.append(extra)
            if len(out) >= max_bullets:
                break
    return out


def get_exit_load_bullets_and_links() -> tuple[list[str], list[str]]:
    """
    Returns (explanation_bullets, source_links) — Part B: ≤6 bullets, 2 official links.
    Priority: EXIT_LOAD_BULLETS_JSON → fetch+parse → FALLBACK_EXIT_LOAD_BULLETS.
    """
    load_dotenv()
    raw_urls = _source_urls()
    links = normalize_official_source_links(raw_urls)

    raw_json = (os.environ.get("EXIT_LOAD_BULLETS_JSON") or "").strip()
    if raw_json:
        try:
            data = json.loads(raw_json)
            if isinstance(data, list) and len(data) >= MIN_FEE_BULLETS:
                bullets = [str(x).strip() for x in data[:MAX_FEE_BULLETS]]
                while len(bullets) < MIN_FEE_BULLETS:
                    bullets.append(FALLBACK_EXIT_LOAD_BULLETS[len(bullets) % len(FALLBACK_EXIT_LOAD_BULLETS)])
                return bullets[:MAX_FEE_BULLETS], links
        except json.JSONDecodeError:
            pass

    bullets: list[str] = []
    for url in raw_urls:
        try:
            html = _fetch_url(url)
        except Exception:
            html = ""
        if html and not _is_cloudflare_challenge(html):
            bullets = _extract_exit_load_bullets_from_html(html)
            if len(bullets) >= MIN_FEE_BULLETS:
                return bullets[:MAX_FEE_BULLETS], links

    if len(bullets) < MIN_FEE_BULLETS:
        for url in raw_urls:
            html = _try_playwright_html(url)
            if not html or _is_cloudflare_challenge(html):
                continue
            bullets = _extract_exit_load_bullets_from_html(html)
            if len(bullets) >= MIN_FEE_BULLETS:
                return bullets[:MAX_FEE_BULLETS], links

    if len(bullets) > 0:
        merged = bullets + FALLBACK_EXIT_LOAD_BULLETS
        out = merged[:MAX_FEE_BULLETS]
        while len(out) < MIN_FEE_BULLETS:
            out.append(FALLBACK_EXIT_LOAD_BULLETS[len(out) % len(FALLBACK_EXIT_LOAD_BULLETS)])
        return out[:MAX_FEE_BULLETS], links

    out = list(FALLBACK_EXIT_LOAD_BULLETS[:MAX_FEE_BULLETS])
    return out, links


def parse_weekly_pulse_md(content: str) -> dict[str, Any]:
    """Extract themes, quotes, action_ideas from Phase 3 markdown (best-effort)."""
    themes: list[str] = []
    quotes: list[str] = []
    actions: list[str] = []

    tm = re.search(
        r"###\s*Top 3 Themes\s*\n(.*?)(?=^###\s*3 User Quotes\s*$)",
        content,
        re.S | re.M,
    )
    if tm:
        for line in tm.group(1).strip().split("\n"):
            line = line.strip()
            m = re.match(r"^\d+\.\s+\*\*([^*]+)\*\*", line)
            if m:
                themes.append(m.group(1).strip().rstrip(":").strip())

    qm = re.search(
        r"###\s*3 User Quotes\s*\n(.*?)(?=^###\s*3 Action Ideas\s*$)",
        content,
        re.S | re.M,
    )
    if qm:
        for line in qm.group(1).strip().split("\n"):
            line = line.strip()
            m = re.match(r"^\*\s+\"(.+)\"\s*$", line) or re.match(r"^[-*]\s+\"(.+)\"\s*$", line)
            if m:
                quotes.append(m.group(1).strip())

    am = re.search(r"###\s*3 Action Ideas\s*\n(.*?)(?=^##|\Z)", content, re.S | re.M)
    if am:
        for line in am.group(1).strip().split("\n"):
            line = line.strip()
            m = re.match(r"^\d+\.\s+\*\*([^*]+)\*\*", line)
            if m:
                actions.append(m.group(1).strip())

    return {"themes": themes[:3], "quotes": quotes[:3], "action_ideas": actions[:3]}


def build_pulse_bundle(pulse_path: Path, date_str: str) -> dict[str, Any]:
    text = pulse_path.read_text(encoding="utf-8")
    weekly = parse_weekly_pulse_md(text)
    bullets, links = get_exit_load_bullets_and_links()
    while len(bullets) < MIN_FEE_BULLETS:
        bullets.append(FALLBACK_EXIT_LOAD_BULLETS[len(bullets) % len(FALLBACK_EXIT_LOAD_BULLETS)])
    bullets = bullets[:MAX_FEE_BULLETS]
    links = normalize_official_source_links(links)
    return {
        "date": date_str,
        "weekly_pulse": weekly,
        "fee_scenario": FEE_SCENARIO_LABEL,
        "explanation_bullets": bullets,
        "source_links": links,
        "last_checked": date_str,
    }


def mcp_notes_append_payload(bundle: dict[str, Any]) -> dict[str, Any]:
    """Subset for Google Doc / Notes append (Part B MCP — approval-gated in Cursor)."""
    return {
        "date": bundle.get("date"),
        "weekly_pulse": bundle.get("weekly_pulse"),
        "fee_scenario": bundle.get("fee_scenario"),
        "explanation_bullets": bundle.get("explanation_bullets"),
        "source_links": bundle.get("source_links"),
    }


def fee_block_markdown(bundle: dict[str, Any]) -> str:
    bullets = bundle.get("explanation_bullets") or []
    links: list[str] = list(bundle.get("source_links") or [])
    checked = bundle.get("last_checked") or bundle.get("date") or ""
    lines = [
        "",
        "---",
        "",
        f"## Fee explanation — {bundle.get('fee_scenario', FEE_SCENARIO_LABEL)}",
        "",
    ]
    for b in bullets[:MAX_FEE_BULLETS]:
        lines.append(f"- {b}")
    lines.append("")
    lines.append("**Official sources:**")
    for u in links:
        lines.append(f"- {u}")
    lines.append("")
    if checked:
        lines.append(f"*Last checked: {checked}*")
        lines.append("")
    return "\n".join(lines)


def fee_block_plain(bundle: dict[str, Any]) -> str:
    bullets = bundle.get("explanation_bullets") or []
    links: list[str] = list(bundle.get("source_links") or [])
    checked = bundle.get("last_checked") or bundle.get("date") or ""
    lines = [
        "",
        "--------------------------------------------------------------------------------",
        f"FEE EXPLANATION — {bundle.get('fee_scenario', FEE_SCENARIO_LABEL)}",
        "--------------------------------------------------------------------------------",
        "",
    ]
    for b in bullets[:MAX_FEE_BULLETS]:
        lines.append(f"• {b}")
    lines.append("")
    lines.append("Official sources:")
    for u in links:
        lines.append(f"  {u}")
    lines.append("")
    if checked:
        lines.append(f"Last checked: {checked}")
        lines.append("")
    return "\n".join(lines)


FEE_MD_ANCHOR = "## Fee explanation —"


def append_fee_to_pulse_md(pulse_path: Path, bundle: dict[str, Any]) -> None:
    """Append exit-load section to weekly-pulse_*.md once (so file matches email/UI)."""
    try:
        text = pulse_path.read_text(encoding="utf-8")
        if FEE_MD_ANCHOR in text:
            return
        fee = fee_block_markdown(bundle)
        pulse_path.write_text(text.rstrip() + "\n" + fee, encoding="utf-8")
    except OSError:
        pass


def save_pulse_bundle(
    bundle: dict[str, Any],
    date_str: str,
    out_dir: Path | None = None,
    pulse_md_path: Path | None = None,
) -> Path:
    out = (out_dir or OUTPUT_DIR).resolve()
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"pulse_bundle_{date_str}.json"
    path.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    mcp_path = out / f"mcp_append_{date_str}.json"
    mcp_path.write_text(
        json.dumps(mcp_notes_append_payload(bundle), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    if pulse_md_path is not None:
        append_fee_to_pulse_md(Path(pulse_md_path), bundle)
    return path


def main() -> None:
    load_dotenv()
    if len(sys.argv) > 1:
        pulse_path = Path(sys.argv[1])
        if not pulse_path.is_absolute():
            pulse_path = (Path.cwd() / pulse_path).resolve()
    else:
        files = list(OUTPUT_DIR.glob("weekly-pulse_*.md"))
        if not files:
            print("No weekly-pulse_*.md in output/. Run Phase 3 first.", file=sys.stderr)
            sys.exit(1)
        pulse_path = max(files, key=lambda p: p.stem)

    if not pulse_path.exists():
        print(f"Not found: {pulse_path}", file=sys.stderr)
        sys.exit(1)

    stem = pulse_path.stem
    m = re.match(r"weekly-pulse_(\d{4}-\d{2}-\d{2})", stem)
    date_str = m.group(1) if m else datetime.now().strftime("%Y-%m-%d")

    bundle = build_pulse_bundle(pulse_path, date_str)
    out_path = save_pulse_bundle(bundle, date_str, pulse_md_path=pulse_path)
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
