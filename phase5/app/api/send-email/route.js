import { spawnSync } from "child_process";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REPO_ROOT = path.resolve(process.cwd(), "..");

function isVercelOrNoPipeline() {
  if (process.env.VERCEL || process.env.VERCEL_URL || process.env.VERCEL_ENV) return true;
  try {
    const inCwd = path.join(process.cwd(), "phase4", "draft_email.py");
    const inParent = path.join(process.cwd(), "..", "phase4", "draft_email.py");
    if (fs.existsSync(inCwd) || fs.existsSync(inParent)) return false;
  } catch {
    return true;
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

export async function POST(request) {
  if (isVercelOrNoPipeline()) {
    return Response.json(
      {
        error:
          "Send email is not available on Vercel. Use « Run weekly pulse in cloud » — the workflow will send the email when it finishes.",
      },
      { status: 501 }
    );
  }
  try {
    loadEnv();
    const body = await request.json().catch(() => ({}));
    const recipient = body.recipient?.trim();
    const recipientName = body.recipientName?.trim();

    const args = ["phase4/draft_email.py", "--send"];
    if (recipient) args.push("--recipient", recipient);
    if (recipientName) args.push("--recipient-name", recipientName);

    const r = spawnSync("python3", args, {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      env: { ...process.env },
    });

    if (r.status !== 0) {
      const stderr = (r.stderr || "").trim();
      const stdout = (r.stdout || "").trim();
      let msg =
        stderr ||
        stdout ||
        (r.status != null ? `Send failed (exit ${r.status}).` : "Send email is not available here. Use « Run weekly pulse in cloud » to get the report by email.");
      if (msg === "Exit null" || msg.includes("Exit null")) {
        msg = "Send email is not available here. Use « Run weekly pulse in cloud » — the workflow will send the email when it finishes.";
      }
      return Response.json({ error: msg }, { status: 500 });
    }

    return Response.json({ sent: true });
  } catch (err) {
    let msg = err.message || "Send failed";
    if (msg === "Exit null" || msg.includes("Exit null")) {
      msg = "Send email is not available here. Use « Run weekly pulse in cloud » — the workflow will send the email when it finishes.";
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
