import { spawnSync } from "child_process";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Next.js runs from phase5/; repo root is parent. On Vercel, only phase5 is deployed so pipeline isn't available.
const REPO_ROOT = path.resolve(process.cwd(), "..");

function isVercelOrNoPipeline() {
  // Vercel sets these at runtime
  if (process.env.VERCEL || process.env.VERCEL_URL || process.env.VERCEL_ENV) return true;
  // If phase1 isn't in cwd or parent, we're in a deployment that only has phase5 (e.g. Vercel with Root Directory = phase5)
  try {
    const inCwd = path.join(process.cwd(), "phase1", "fetch_reviews.py");
    const inParent = path.join(process.cwd(), "..", "phase1", "fetch_reviews.py");
    if (fs.existsSync(inCwd) || fs.existsSync(inParent)) return false;
  } catch {
    // Safe default: assume pipeline not available
  }
  return true;
}

function loadEnv() {
  const envPath = path.join(REPO_ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key) process.env[key] = val;
  }
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    env: { ...process.env },
  });
  if (r.status !== 0) {
    const stderr = (r.stderr || "").trim();
    const stdout = (r.stdout || "").trim();
    const msg =
      stderr ||
      stdout ||
      (r.status != null ? `Pipeline step failed (exit ${r.status}).` : "Pipeline not available here. Use « Run weekly pulse in cloud » or run the app locally.");
    throw new Error(msg);
  }
  return r;
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const weeksBack = body.weeksBack ?? 10;
  const env = { ...process.env, WEEKS_BACK: String(weeksBack) };

  // On Vercel (or when Python pipeline is missing) run the Node.js pipeline so one-pager displays on screen.
  if (isVercelOrNoPipeline()) {
    try {
      const { runNodePipeline } = await import("../../../lib/pipeline.js");
      const { pulse, themeLegend } = await runNodePipeline(env);
      return Response.json({ pulse, themeLegend });
    } catch (err) {
      return Response.json(
        { error: err.message || "Pipeline failed" },
        { status: 500 }
      );
    }
  }

  try {
    loadEnv();
    if (weeksBack) process.env.WEEKS_BACK = String(weeksBack);

    run("python3", ["phase1/fetch_reviews.py"]);
    run("python3", ["phase2a/theme_discovery.py"]);
    run("python3", ["phase2b/classify_reviews.py"]);
    run("bash", ["scripts/setup-venv-and-run-phase3.sh"]);

    const outputDir = path.join(REPO_ROOT, "output");
    const mdFiles = fs.readdirSync(outputDir).filter((f) => f.startsWith("weekly-pulse_") && f.endsWith(".md"));
    if (mdFiles.length === 0) {
      return Response.json({ error: "No weekly pulse generated" }, { status: 500 });
    }
    const latest = mdFiles.sort().pop();
    const pulsePath = path.join(outputDir, latest);
    const pulse = fs.readFileSync(pulsePath, "utf-8");
    const legendPath = path.join(outputDir, "theme-legend.md");
    const themeLegend = fs.existsSync(legendPath) ? fs.readFileSync(legendPath, "utf-8") : "";

    return Response.json({ pulse, themeLegend });
  } catch (err) {
    let msg = err.message || "Pipeline failed";
    if (msg === "Exit null" || msg.includes("Exit null")) {
      msg =
        "Generate one-pager is not available here. Use « Run weekly pulse in cloud » to trigger the pipeline; you'll receive the email when it finishes.";
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
