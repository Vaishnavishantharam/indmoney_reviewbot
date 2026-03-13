#!/usr/bin/env python3
"""
Python-only Web UI for GROWW Weekly Review Pulse.
Run from repo root: python3 web_ui.py
Then open http://127.0.0.1:5001 (no npm required).
Uses port 5001 to avoid conflict with macOS AirPlay on 5000.
"""
import os
import subprocess

import markdown
from flask import Flask, request, jsonify, render_template

app = Flask(__name__)

REPO_ROOT = os.path.dirname(os.path.abspath(__file__))


def load_env():
    env_path = os.path.join(REPO_ROOT, ".env")
    if not os.path.isfile(env_path):
        return
    env = os.environ.copy()
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            eq = line.find("=")
            if eq <= 0:
                continue
            key = line[:eq].strip()
            val = line[eq + 1 :].strip().strip("'\"").strip('"')
            if key:
                env[key] = val
    return env


def run_cmd(cmd, args, env=None):
    env = env or load_env() or os.environ.copy()
    r = subprocess.run(
        [cmd] + args,
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        env=env,
    )
    if r.returncode != 0:
        err = (r.stderr or "").strip()
        out = (r.stdout or "").strip()
        if err and out:
            msg = f"{err}\n{out}"
        else:
            msg = err or out or f"Exit {r.returncode}"
        raise RuntimeError(msg)
    return r


def get_python():
    """Use repo .venv python if present."""
    venv_py = os.path.join(REPO_ROOT, ".venv", "bin", "python3")
    return venv_py if os.path.isfile(venv_py) else "python3"


def has_grouped_themes():
    """True if we have at least one themes_grouped_*.json (can run Phase 3 only)."""
    themes_dir = os.path.join(REPO_ROOT, "themes")
    if not os.path.isdir(themes_dir):
        return False
    for f in os.listdir(themes_dir):
        if f.startswith("themes_grouped_") and f.endswith(".json"):
            return True
    return False


def run_phase3_only(env):
    """Run only Phase 3 (one-pager from existing themes_grouped_*.json)."""
    run_cmd("bash", ["scripts/setup-venv-and-run-phase3.sh"], env=env)


def read_latest_pulse_and_legend():
    """Read latest weekly-pulse_*.md and theme-legend.md from output/."""
    output_dir = os.path.join(REPO_ROOT, "output")
    md_files = [
        f for f in os.listdir(output_dir)
        if f.startswith("weekly-pulse_") and f.endswith(".md")
    ]
    if not md_files:
        return None, None
    latest = sorted(md_files)[-1]
    pulse_path = os.path.join(output_dir, latest)
    with open(pulse_path, "r", encoding="utf-8") as f:
        pulse = f.read()
    legend_path = os.path.join(output_dir, "theme-legend.md")
    theme_legend = ""
    if os.path.isfile(legend_path):
        with open(legend_path, "r", encoding="utf-8") as f:
            theme_legend = f.read()
        # Drop legacy top heading and intro line so UI section title is enough
        if theme_legend.startswith("# Theme legend"):
            rest = theme_legend.split("\n", 2)
            theme_legend = rest[2] if len(rest) > 2 else ""
    return pulse, theme_legend


@app.route("/")
def index():
    return render_template("weekly_ui.html")


def _nice_error(msg):
    """Turn generic 'Exit N' into a helpful message."""
    s = (msg or "").strip()
    if s in ("Exit 1", "Exit 2") or (s.startswith("Exit ") and len(s) < 10):
        return (
            "Pipeline failed. Check: (1) .env in project root has GROQ_API_KEY and GEMINI_API_KEY, "
            "(2) you ran the server from the project folder, (3) run: pip install -r requirements.txt"
        )
    return s or "Pipeline failed."


@app.route("/api/weekly-pulse", methods=["POST"])
def api_weekly_pulse():
    try:
        env = load_env() or os.environ.copy()
        data = request.get_json(force=True, silent=True) or {}
        weeks_back = data.get("weeksBack", 10)
        env["WEEKS_BACK"] = str(weeks_back)
        py = get_python()

        # Phase 1: fetch reviews
        run_cmd(py, ["phase1/fetch_reviews.py"], env=env)

        # Phase 2a + 2b + 3: if Groq rate limit (429), fall back to Phase 3 only using existing data
        used_fallback = False
        try:
            run_cmd(py, ["phase2a/theme_discovery.py"], env=env)
            run_cmd(py, ["phase2b/classify_reviews.py"], env=env)
            run_cmd("bash", ["scripts/setup-venv-and-run-phase3.sh"], env=env)
        except RuntimeError as e:
            err_str = str(e)
            if "429" in err_str or "Rate limit" in err_str or "rate_limit" in err_str:
                if has_grouped_themes():
                    run_phase3_only(env)
                    used_fallback = True
                else:
                    return jsonify(
                        error="Groq rate limit (429). No existing theme data to fall back to. Try again later or add GROQ_API_KEY with more quota."
                    ), 500
            else:
                raise

        pulse, theme_legend = read_latest_pulse_and_legend()
        if not pulse:
            return jsonify(error="No weekly pulse generated"), 500
        pulse_html = markdown.markdown(pulse, extensions=["nl2br"])
        return jsonify(pulse=pulse, pulseHtml=pulse_html, themeLegend=theme_legend or "", fromFallback=used_fallback)
    except RuntimeError as e:
        err_msg = _nice_error(str(e))
        pulse, theme_legend = read_latest_pulse_and_legend()
        if pulse:
            pulse_html = markdown.markdown(pulse, extensions=["nl2br"])
            return jsonify(
                pulse=pulse,
                pulseHtml=pulse_html,
                themeLegend=theme_legend or "",
                fromFallback=True,
                error=f"Regeneration failed: {err_msg}. Showing last saved one-pager below.",
            )  # 200 so the link works and content is shown
        return jsonify(error=err_msg), 500
    except Exception as e:
        err_msg = _nice_error(str(e))
        pulse, theme_legend = read_latest_pulse_and_legend()
        if pulse:
            pulse_html = markdown.markdown(pulse, extensions=["nl2br"])
            return jsonify(
                pulse=pulse,
                pulseHtml=pulse_html,
                themeLegend=theme_legend or "",
                fromFallback=True,
                error=f"Regeneration failed: {err_msg}. Showing last saved one-pager below.",
            )  # 200 so the link works and content is shown
        return jsonify(error=err_msg), 500


@app.route("/api/send-email", methods=["POST"])
def api_send_email():
    try:
        env = load_env() or os.environ.copy()
        data = request.get_json(force=True, silent=True) or {}
        recipient = (data.get("recipient") or "").strip()
        recipient_name = (data.get("recipientName") or "").strip()

        args = ["phase4/draft_email.py", "--send"]
        if recipient:
            args.extend(["--recipient", recipient])
        if recipient_name:
            args.extend(["--recipient-name", recipient_name])

        run_cmd(get_python(), args, env=env)
        return jsonify(sent=True)
    except Exception as e:
        return jsonify(error=str(e)), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    app.run(host="127.0.0.1", port=port, debug=False)
