import { spawnSync } from "child_process";
import path from "path";
import fs from "fs";

// Next.js runs from phase5/; repo root is parent.
const REPO_ROOT = path.resolve(process.cwd(), "..");

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
    throw new Error(stderr || `Exit ${r.status}`);
  }
  return r;
}

export async function POST(request) {
  try {
    loadEnv();
    const body = await request.json().catch(() => ({}));
    const weeksBack = body.weeksBack ?? 10;
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
    return Response.json(
      { error: err.message || "Pipeline failed" },
      { status: 500 }
    );
  }
}
