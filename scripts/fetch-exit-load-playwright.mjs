#!/usr/bin/env node
/**
 * Fetch a public IND Money (or other) page with Chromium to bypass simple bot blocks.
 * Writes full HTML to stdout for phase4/pulse_bundle.py to parse exit-load text.
 * Usage: node scripts/fetch-exit-load-playwright.mjs <url>
 * Requires: npm install at repo root (playwright dependency).
 */
import { chromium } from "playwright";

const url = process.argv[2];
if (!url || !/^https?:\/\//i.test(url)) {
  console.error("Usage: node scripts/fetch-exit-load-playwright.mjs <https://...>");
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 4000));
  const html = await page.content();
  process.stdout.write(html);
} finally {
  await browser.close();
}
