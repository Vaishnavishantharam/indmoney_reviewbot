#!/usr/bin/env node
/**
 * CLI: Draft or send weekly pulse email (Phase 4).
 * Usage: npm run email [-- [options]]
 * Options: --recipient ADDR  --recipient-name "Name"  --send
 * Run from repo root.
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const hasSend = args.includes("--send");
const recipientIdx = args.indexOf("--recipient");
const nameIdx = args.indexOf("--recipient-name");

const cliArgs = [];
if (recipientIdx >= 0 && args[recipientIdx + 1]) {
  cliArgs.push("--recipient", args[recipientIdx + 1]);
}
if (nameIdx >= 0 && args[nameIdx + 1]) {
  cliArgs.push("--recipient-name", args[nameIdx + 1]);
}
if (hasSend) cliArgs.push("--send");

console.log("CLI — Email (Phase 4)\n");
const r = spawnSync("python3", ["phase4/draft_email.py", ...cliArgs], {
  cwd: REPO_ROOT,
  stdio: "inherit",
  env: { ...process.env },
});
process.exit(r.status ?? 0);
