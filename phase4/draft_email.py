#!/usr/bin/env python3
"""
Phase 4 — Email draft & send.
Produces a personalised draft email containing the weekly pulse report.
Body always starts with "Hi {recipient name}," (or "Hi," if no name) then the rest of the weekly note.
Dry-run (default): writes output/weekly-pulse_YYYY-MM-DD.eml. No SMTP.
Send mode (--send): sends via smtplib with TLS when credentials are present.
Config from .env: EMAIL_SENDER, EMAIL_PASSWORD, SMTP_HOST, SMTP_PORT, EMAIL_RECIPIENT.
Run from repo root: python3 phase4/draft_email.py [pulse.md] [--recipient ADDR] [--recipient-name NAME] [--send]
"""

import argparse
import os
import re
import smtplib
import sys
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Optional

_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT))

OUTPUT_DIR = _REPO_ROOT / "output"
SUBJECT_PREFIX = "GROWW Weekly Review Pulse -- "


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


def get_latest_pulse_path():
    """Return path to most recent output/weekly-pulse_YYYY-MM-DD.md."""
    if not OUTPUT_DIR.exists():
        raise FileNotFoundError(f"No output directory: {OUTPUT_DIR}. Run Phase 3 first.")
    files = list(OUTPUT_DIR.glob("weekly-pulse_*.md"))
    if not files:
        raise FileNotFoundError(f"No weekly-pulse_*.md in {OUTPUT_DIR}. Run Phase 3 first.")
    return max(files, key=lambda p: p.stem)


def date_from_pulse_path(pulse_path: Path) -> str:
    """Extract date string from pulse filename (weekly-pulse_YYYY-MM-DD.md) for subject."""
    stem = pulse_path.stem
    m = re.match(r"weekly-pulse_(\d{4}-\d{2}-\d{2})", stem)
    if m:
        return m.group(1)
    return stem.replace("weekly-pulse_", "")


def week_label_from_content(content: str) -> str:
    """Get 'Week of Month DD, YYYY' from first line of pulse if present."""
    first = content.split("\n")[0].strip()
    if first.startswith("Week of "):
        return first
    return ""


def get_config():
    """Load email config from environment. Do not log or store EMAIL_PASSWORD."""
    load_dotenv()
    sender = (os.environ.get("EMAIL_SENDER") or "").strip()
    password = (os.environ.get("EMAIL_PASSWORD") or "").strip()
    host = (os.environ.get("SMTP_HOST") or "smtp.gmail.com").strip()
    port_str = (os.environ.get("SMTP_PORT") or "587").strip()
    try:
        port = int(port_str)
    except ValueError:
        port = 587
    recipient = (os.environ.get("EMAIL_RECIPIENT") or "").strip()
    return {
        "EMAIL_SENDER": sender,
        "EMAIL_PASSWORD": password,
        "SMTP_HOST": host,
        "SMTP_PORT": port,
        "EMAIL_RECIPIENT": recipient or sender,
    }


def build_body_content(pulse_path: Path, recipient_name: Optional[str]) -> tuple:
    """Read pulse .md and optional .txt; return (plain_text, markdown_content). Always prepend personalised greeting: 'Hi {name},' then rest of weekly pulse."""
    md_path = pulse_path if pulse_path.suffix.lower() == ".md" else pulse_path.with_suffix(".md")
    if not md_path.exists():
        raise FileNotFoundError(f"Pulse file not found: {md_path}")
    content_md = md_path.read_text(encoding="utf-8")
    txt_path = md_path.with_suffix(".txt")
    if txt_path.exists():
        content_plain = txt_path.read_text(encoding="utf-8")
    else:
        content_plain = content_md

    # Personalised greeting: "Hi {recipient name}," then rest of email. If no name, use "Hi,".
    name = (recipient_name or "").strip()
    greeting = f"Hi {name},\n\n" if name else "Hi,\n\n"

    plain = greeting + content_plain
    md_with_greeting = greeting + content_md
    return plain, md_with_greeting


def markdown_to_html(md: str) -> str:
    """Convert markdown to HTML."""
    try:
        import markdown
        return markdown.markdown(md, extensions=["extra", "nl2br"])
    except ImportError:
        return "<pre>\n" + md.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;") + "\n</pre>"


def build_message(
    from_addr: str,
    to_addr: str,
    subject: str,
    body_plain: str,
    body_md: str,
) -> MIMEMultipart:
    """Build multipart message (plain + HTML)."""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg.attach(MIMEText(body_plain, "plain", "utf-8"))
    msg.attach(MIMEText(markdown_to_html(body_md), "html", "utf-8"))
    return msg


def main():
    parser = argparse.ArgumentParser(description="Phase 4: Draft or send weekly pulse email.")
    parser.add_argument(
        "pulse_file",
        nargs="?",
        default=None,
        help="Path to weekly pulse .md (default: latest in output/)",
    )
    parser.add_argument(
        "--recipient",
        "-r",
        default=None,
        help="Recipient email (overrides EMAIL_RECIPIENT)",
    )
    parser.add_argument(
        "--recipient-name",
        "-n",
        default=None,
        help="Recipient name for personalised greeting: email body starts with 'Hi {name},' then the weekly pulse report",
    )
    parser.add_argument(
        "--send",
        "-s",
        action="store_true",
        help="Send via SMTP (default: dry-run, write .eml only)",
    )
    args = parser.parse_args()

    load_dotenv()
    config = get_config()
    from_addr = config["EMAIL_SENDER"]
    if not from_addr:
        if args.send:
            print("EMAIL_SENDER is not set in .env. Required for --send.")
            sys.exit(1)
        from_addr = "pulse@local"

    if args.pulse_file:
        pulse_path = Path(args.pulse_file)
        if not pulse_path.is_absolute():
            pulse_path = (Path.cwd() / pulse_path).resolve()
        if not pulse_path.exists():
            pulse_path = (OUTPUT_DIR / pulse_path.name)
        if not pulse_path.exists():
            pulse_path = get_latest_pulse_path()
    else:
        pulse_path = get_latest_pulse_path()

    date_str = date_from_pulse_path(pulse_path)
    week_label = ""
    try:
        content_preview = pulse_path.read_text(encoding="utf-8")
        week_label = week_label_from_content(content_preview)
    except Exception:
        pass
    if not week_label:
        try:
            from datetime import datetime
            dt = datetime.strptime(date_str, "%Y-%m-%d")
            week_label = dt.strftime("Week of %B %d, %Y")
        except ValueError:
            week_label = f"Week of {date_str}"

    subject = SUBJECT_PREFIX + week_label
    to_addr = (args.recipient or config["EMAIL_RECIPIENT"] or from_addr).strip()

    body_plain, body_md = build_body_content(pulse_path, args.recipient_name)
    msg = build_message(from_addr, to_addr, subject, body_plain, body_md)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    eml_path = OUTPUT_DIR / f"weekly-pulse_{date_str}.eml"
    with open(eml_path, "wb") as f:
        f.write(msg.as_bytes())
    print(f"Phase 4 — Email draft")
    print(f"  Pulse: {pulse_path}")
    print(f"  Subject: {subject}")
    print(f"  To: {to_addr}")
    print(f"  Draft written: {eml_path}")

    if args.send:
        password = config["EMAIL_PASSWORD"]
        if not password:
            print("  --send requires EMAIL_PASSWORD in .env. Skipping send.")
            sys.exit(1)
        host = config["SMTP_HOST"]
        port = config["SMTP_PORT"]
        try:
            with smtplib.SMTP(host, port) as server:
                server.starttls()
                server.login(from_addr, password)
                server.sendmail(from_addr, [to_addr], msg.as_string())
            print("  Sent successfully.")
        except Exception as e:
            print(f"  Send failed: {e}")
            sys.exit(1)
    else:
        print("  Dry-run: no SMTP. Use --send to send.")


if __name__ == "__main__":
    main()
