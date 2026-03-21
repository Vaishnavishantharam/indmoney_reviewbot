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
  const body = await request.json().catch(() => ({}));
  const recipient = body.recipient?.trim();
  const recipientName = body.recipientName?.trim();
  const pulse = body.pulse?.trim();
  let feeBlockPlain = (body.feeBlockPlain && String(body.feeBlockPlain).trim()) || "";
  if (!feeBlockPlain && body.pulseBundle) {
    try {
      const { feeBlockPlain: fp } = await import("../../../lib/pulseBundle.js");
      feeBlockPlain = fp(body.pulseBundle);
    } catch {
      /* ignore */
    }
  }

  if (isVercelOrNoPipeline()) {
    try {
      const sender = (process.env.EMAIL_SENDER || "").trim();
      const password = (process.env.EMAIL_PASSWORD || "").trim();
      const host = (process.env.SMTP_HOST || "smtp.gmail.com").trim();
      const port = parseInt(process.env.SMTP_PORT || "587", 10) || 587;
      const to = recipient || process.env.EMAIL_RECIPIENT || sender;
      if (!sender || !password) {
        return Response.json(
          {
            error:
              "Email not configured. Set EMAIL_SENDER and EMAIL_PASSWORD in Vercel (Settings → Environment Variables). Use a Gmail App Password for EMAIL_PASSWORD: myaccount.google.com/apppasswords",
          },
          { status: 503 }
        );
      }
      if (!pulse) {
        return Response.json(
          { error: "Generate the one-pager first, then click Send email. The pulse content is required." },
          { status: 400 }
        );
      }
      const nodemailer = (await import("nodemailer")).default;
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user: sender, pass: password },
        ...(port === 587 && { requireTLS: true }),
      });
      const greeting = recipientName ? `Hi ${recipientName},\n\n` : "Hi,\n\n";
      const weeklyHeader = "WEEKLY PULSE\n\n";
      const text =
        greeting + weeklyHeader + pulse + (feeBlockPlain ? "\n" + feeBlockPlain : "");
      const dateLabel = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const legacySubj = (process.env.EMAIL_LEGACY_SUBJECT || "").toLowerCase();
      const subject =
        legacySubj === "1" || legacySubj === "true"
          ? `GROWW Weekly Review Pulse -- ${dateLabel}`
          : `Weekly Pulse + Fee Explainer — ${dateLabel}`;
      await transporter.sendMail({
        from: sender,
        to,
        subject,
        text,
      });
      return Response.json({ sent: true });
    } catch (err) {
      let errMsg = err.message || "Failed to send email";
      if (err.code === "EAUTH" || errMsg.toLowerCase().includes("invalid login")) {
        errMsg =
          "SMTP auth failed. Use a Gmail App Password (not your normal password): myaccount.google.com/apppasswords. Set it as EMAIL_PASSWORD in Vercel.";
      }
      return Response.json({ error: errMsg }, { status: 500 });
    }
  }

  try {
    loadEnv();
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
