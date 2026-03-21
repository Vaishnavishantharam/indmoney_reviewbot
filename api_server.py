#!/usr/bin/env python3
"""
Backend API for GROWW Weekly Review Pulse.
Runs the full Python pipeline (Phase 1 → 2a → 2b → 3) and returns JSON.
Deploy to Railway, Render, or any Python host. Frontend (Vercel) calls this API.

Run from repo root:
  pip install -r requirements.txt
  python api_server.py

Set PORT in env (e.g. 8000). CORS is enabled for your Vercel frontend origin.
"""
import os
import subprocess
import time

from flask import Flask, request, jsonify
from flask_cors import CORS

# Import pipeline helpers from existing web_ui
from web_ui import (
    REPO_ROOT,
    load_env,
    run_cmd,
    get_python,
    has_grouped_themes,
    read_latest_pulse_and_legend,
    enrich_with_pulse_bundle,
    get_latest_pulse_md_path,
)


def run_phase3_only(env):
    """Run Phase 3 only (one-pager from existing themes_grouped_*.json). Uses Python directly for Docker compatibility."""
    run_cmd(get_python(), ["phase3/weekly_pulse.py"], env=env)

app = Flask(__name__)
_cors_origins = os.environ.get("CORS_ORIGINS", "*").strip()
CORS(app, origins=[o.strip() for o in _cors_origins.split(",") if o.strip()] or ["*"])


@app.errorhandler(Exception)
def handle_error(e):
    """Ensure every error returns JSON so the proxy never gets HTML."""
    msg = getattr(e, "message", str(e)) if e else "Unknown error"
    return jsonify(error=_nice_error(msg)), 500


def _nice_error(msg):
    s = (msg or "").strip()
    if s in ("Exit 1", "Exit 2") or (s.startswith("Exit ") and len(s) < 10):
        return (
            "Pipeline failed. Check GROQ_API_KEY and GEMINI_API_KEY in env, "
            "and that phases (phase1, 2a, 2b, 3) run correctly."
        )
    return s or "Pipeline failed."


@app.route("/", methods=["GET"])
def index():
    return jsonify(
        service="GROWW Weekly Pulse API",
        docs={
            "health": "GET /health",
            "weekly_pulse": "POST /api/weekly-pulse (body: {\"weeksBack\": 10}) → pulse, themeLegend, pulseBundle, feeBlockMarkdown, feeBlockPlain",
        },
    )


@app.route("/health", methods=["GET"])
def health():
    return jsonify(ok=True)


@app.route("/api/weekly-pulse", methods=["POST"])
def api_weekly_pulse():
    try:
        env = load_env() or os.environ.copy()
        data = request.get_json(force=True, silent=True) or {}
        weeks_back = data.get("weeksBack", 10)
        env["WEEKS_BACK"] = str(weeks_back)
        if "MAX_REVIEWS" not in env or not str(env.get("MAX_REVIEWS", "")).strip():
            env["MAX_REVIEWS"] = "250"
        py = get_python()

        run_cmd(py, ["phase1/fetch_reviews.py"], env=env)

        used_fallback = False
        try:
            run_cmd(py, ["phase2a/theme_discovery.py"], env=env)
            time.sleep(10)
            run_cmd(py, ["phase2b/classify_reviews.py"], env=env)
            run_cmd(py, ["phase3/weekly_pulse.py"], env=env)
        except RuntimeError as e:
            err_str = str(e)
            if "429" in err_str or "Rate limit" in err_str or "rate_limit" in err_str:
                if has_grouped_themes():
                    run_phase3_only(env)
                    used_fallback = True
                else:
                    return jsonify(
                        error="Groq rate limit (429). Try again later."
                    ), 500
            else:
                raise

        pulse, theme_legend = read_latest_pulse_and_legend()
        if not pulse:
            return jsonify(error="No weekly pulse generated"), 500
        bundle_extra = enrich_with_pulse_bundle(get_latest_pulse_md_path(), env)
        return jsonify(
            pulse=pulse,
            themeLegend=theme_legend or "",
            fromFallback=used_fallback,
            **bundle_extra,
        )
    except RuntimeError as e:
        err_msg = _nice_error(str(e))
        pulse, theme_legend = read_latest_pulse_and_legend()
        if pulse:
            bundle_extra = enrich_with_pulse_bundle(get_latest_pulse_md_path(), env)
            return jsonify(
                pulse=pulse,
                themeLegend=theme_legend or "",
                fromFallback=True,
                error=f"Regeneration failed: {err_msg}. Showing last saved one-pager.",
                **bundle_extra,
            )
        return jsonify(error=err_msg), 500
    except Exception as e:
        return jsonify(error=_nice_error(str(e))), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=False)
