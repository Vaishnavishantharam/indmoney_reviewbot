#!/usr/bin/env node
/**
 * CLI: Run full pipeline for weekly one-pager (Phase 1 → 2a → 2b → 3).
 * Optional: skip fetch if reviews already exist (--skip-fetch).
 * Run from repo root: npm run weekly [-- --skip-fetch]
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: { ...process.env },
    ...opts,
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
  return r;
}

const skipFetch = process.argv.includes("--skip-fetch");

console.log("CLI — Weekly pulse pipeline\n");

if (!skipFetch) {
  console.log("Phase 1: Fetching reviews...");
  run("python3", ["phase1/fetch_reviews.py"]);
} else {
  console.log("Phase 1: Skipped (--skip-fetch).");
}

console.log("\nPhase 2a: Theme discovery...");
run("python3", ["phase2a/theme_discovery.py"]);

console.log("\nPhase 2b: Classifying reviews...");
run("python3", ["phase2b/classify_reviews.py"]);

console.log("\nPhase 3: Generating weekly one-pager...");
run("bash", ["scripts/setup-venv-and-run-phase3.sh"]);

console.log("\nDone. Output: output/weekly-pulse_*.md, output/weekly-pulse_*.txt, output/theme-legend.md");
