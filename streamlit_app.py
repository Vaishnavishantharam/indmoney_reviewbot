#!/usr/bin/env python3
"""
Streamlit UI for GROWW Weekly Review Pulse (backend).
Runs the full Python pipeline (Phase 1 → 2a → 2b → 3) and displays the one-pager.
Deploy to Streamlit Community Cloud; run from repo root so phase1/2a/2b/3 are available.

Secrets: set GROQ_API_KEY, GEMINI_API_KEY (and optional APP_ID, WEEKS_BACK) in Streamlit Cloud.
"""
import os
import subprocess
import sys
from pathlib import Path

import streamlit as st

REPO_ROOT = Path(__file__).resolve().parent


def load_env():
    env = os.environ.copy()
    env_path = REPO_ROOT / ".env"
    if not env_path.exists():
        return env
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        eq = line.find("=")
        if eq <= 0:
            continue
        key = line[:eq].strip()
        val = line[eq + 1 :].strip().strip("'\"")
        if key:
            env[key] = val
    return env


def get_python():
    venv_py = REPO_ROOT / ".venv" / "bin" / "python3"
    return str(venv_py) if venv_py.is_file() else sys.executable


def run_pipeline(weeks_back: int):
    env = load_env()
    env["WEEKS_BACK"] = str(weeks_back)
    py = get_python()

    steps = [
        (py, ["phase1/fetch_reviews.py"]),
        (py, ["phase2a/theme_discovery.py"]),
        (py, ["phase2b/classify_reviews.py"]),
        ("bash", ["scripts/setup-venv-and-run-phase3.sh"]),
    ]
    for cmd, args in steps:
        r = subprocess.run(
            [cmd] + args,
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            env=env,
        )
        if r.returncode != 0:
            err = (r.stderr or r.stdout or "").strip()
            raise RuntimeError(err or f"Exit {r.returncode}")


def read_latest_pulse_and_legend():
    output_dir = REPO_ROOT / "output"
    if not output_dir.exists():
        return None, None
    md_files = sorted(
        f for f in output_dir.iterdir()
        if f.name.startswith("weekly-pulse_") and f.name.endswith(".md")
    )
    if not md_files:
        return None, None
    pulse = md_files[-1].read_text(encoding="utf-8")
    legend_path = output_dir / "theme-legend.md"
    theme_legend = legend_path.read_text(encoding="utf-8") if legend_path.exists() else ""
    return pulse, theme_legend


st.set_page_config(page_title="GROWW Weekly Pulse", layout="centered")
st.title("GROWW Weekly Review Pulse")
st.caption("Run the pipeline (fetch reviews → themes → one-pager) and view the result.")

weeks_back = st.sidebar.number_input("Weeks back", min_value=8, max_value=12, value=10)

ran_this_run = False
if st.button("Generate one-pager", type="primary"):
    with st.spinner("Running pipeline (fetch → themes → classify → one-pager)…"):
        try:
            run_pipeline(weeks_back)
            pulse, theme_legend = read_latest_pulse_and_legend()
            if pulse:
                st.session_state["ran_pipeline"] = True
                ran_this_run = True
                st.success("Done.")
                st.subheader("Weekly One-Page Note")
                st.markdown(pulse)
                if theme_legend:
                    st.subheader("Theme legend")
                    st.markdown(theme_legend)
            else:
                st.error("Pipeline ran but no weekly-pulse_*.md was produced.")
        except Exception as e:
            st.error(str(e))

# Show last result if user didn't just run (e.g. after page reload)
if not ran_this_run:
    pulse, theme_legend = read_latest_pulse_and_legend()
    if pulse:
        st.subheader("Last generated one-pager")
        st.markdown(pulse)
        if theme_legend:
            with st.expander("Theme legend"):
                st.markdown(theme_legend)
