import { spawnSync } from "child_process";
import path from "path";
import fs from "fs";

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

export async function POST(request) {
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
      return Response.json(
        { error: stderr || `Exit ${r.status}` },
        { status: 500 }
      );
    }

    return Response.json({ sent: true });
  } catch (err) {
    return Response.json(
      { error: err.message || "Send failed" },
      { status: 500 }
    );
  }
}
