#!/usr/bin/env python3
"""
Weekly pulse scheduler: runs the full pipeline runs the full pipeline every Sunday at 9:45 PM CST and sends the one-pager to a fixed recipient.

- Uses 8 weeks of reviews and max 1000 reviews (WEEKS_BACK=8, MAX_REVIEWS=1000).
- Recipient: vaishnavishantharam09@gmail.com (fixed).
- Runs Phase 1 → 2a → 2b → 3 → 4 (same as CLI); no Node required.
- Logs: logs/scheduler.log (separate from pipeline output).

Run from repo root: python3 scripts/scheduler.py
Keep the process running (e.g. tmux/screen or as a service).

Test triggers at 19:20, 19:25, 19:30: SCHEDULER_TEST_TIMES=1 python3 scripts/scheduler.py
Run pipeline once and exit: python3 scripts/scheduler.py --run-now
"""
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# Repo root (parent of scripts/)
REPO_ROOT = Path(__file__).resolve().parent.parent
# Scheduler logs only (separate from pipeline output in output/)
LOG_DIR = REPO_ROOT / "logs"
LOG_FILE = LOG_DIR / "scheduler.log"


def log(msg: str):
    """Print and append to scheduler log file only."""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass

# Fixed recipient for scheduled runs
SCHEDULER_RECIPIENT = "vaishnavishantharam09@gmail.com"
SCHEDULER_RECIPIENT_NAME = "Vaishnavi"

# Scheduler config: 8 weeks, 1000 reviews
SCHEDULER_WEEKS_BACK = "8"
SCHEDULER_MAX_REVIEWS = "1000"


def load_env():
    env = os.environ.copy()
    env_path = REPO_ROOT / ".env"
    if not env_path.is_file():
        return env
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


def get_python():
    """Use repo .venv python if present so scheduled job runs with same deps as run-scheduler.sh."""
    venv_py = REPO_ROOT / ".venv" / "bin" / "python3"
    return str(venv_py) if venv_py.exists() else "python3"


def run_cmd(cmd, args, env):
    r = subprocess.run(
        [cmd] + args,
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        env=env,
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or f"Exit {r.returncode}")
    return r


def run_weekly_pipeline_and_send():
    """Run Phase 1 → 2a → 2b → 3 → 4 with scheduler defaults; send to fixed recipient."""
    py = get_python()
    log("Job triggered: starting weekly pipeline (8 weeks, 1000 reviews)...")
    try:
        env = load_env()
        env["WEEKS_BACK"] = SCHEDULER_WEEKS_BACK
        env["MAX_REVIEWS"] = SCHEDULER_MAX_REVIEWS

        log("Phase 1: fetch_reviews.py")
        run_cmd(py, ["phase1/fetch_reviews.py"], env=env)
        log("Phase 2a: theme_discovery.py")
        run_cmd(py, ["phase2a/theme_discovery.py"], env=env)
        log("Phase 2b: classify_reviews.py")
        run_cmd(py, ["phase2b/classify_reviews.py"], env=env)
        log("Phase 3: weekly_pulse (via venv script)")
        run_cmd("bash", ["scripts/setup-venv-and-run-phase3.sh"], env=env)

        log(f"Phase 4: sending email to {SCHEDULER_RECIPIENT}...")
        run_cmd(
            py,
            [
                "phase4/draft_email.py",
                "--send",
                "--recipient",
                SCHEDULER_RECIPIENT,
                "--recipient-name",
                SCHEDULER_RECIPIENT_NAME,
            ],
            env=env,
        )
        log("Job finished: pipeline and email completed successfully.")
    except Exception as e:
        log(f"Job FAILED: {e}")
        raise


def main():
    # Run pipeline once and exit (for testing: verify it runs and sends email locally)
    if "--run-now" in sys.argv:
        log(f"--run-now: running pipeline once and sending email to {SCHEDULER_RECIPIENT}")
        run_weekly_pipeline_and_send()
        return

    try:
        from apscheduler.schedulers.blocking import BlockingScheduler
        from apscheduler.triggers.cron import CronTrigger
    except ImportError:
        print("Install scheduler dependency: pip install apscheduler", file=sys.stderr)
        sys.exit(1)

    scheduler = BlockingScheduler()

    # Test mode: trigger at 19:20, 19:25, 19:30 (every 5 min at those times) for local testing
    # Set SCHEDULER_TEST_TIMES=1 to enable
    if os.environ.get("SCHEDULER_TEST_TIMES") == "1":
        trigger = CronTrigger(
            hour=19,
            minute="20,25,30",
            timezone="America/Chicago",
        )
        log("Schedule: test mode — 19:20, 19:25, 19:30 (America/Chicago)")
    else:
        # Production: every Sunday 9:45 PM CST
        trigger = CronTrigger(
            hour=21,
            minute=45,
            timezone="America/Chicago",
            day_of_week="sun",
        )
        log("Schedule: weekly Sunday 9:45 PM CST")

    scheduler.add_job(run_weekly_pipeline_and_send, trigger, id="weekly_pulse")

    try:
        job = scheduler.get_job("weekly_pulse")
        next_run = getattr(job, "next_run_time", None) if job else None
        next_str = next_run.strftime("%Y-%m-%d %H:%M:%S %Z") if next_run else "see schedule above"
    except Exception:
        next_str = "see schedule above"
    log(f"Scheduler started. Recipient: {SCHEDULER_RECIPIENT}")
    log(f"Next run at: {next_str}")
    log(f"Log file: {LOG_FILE}")
    print("Press Ctrl+C to stop.")
    scheduler.start()


if __name__ == "__main__":
    main()
