/**
 * Phase 1 — Alternative: scrape Play Store page with Playwright (Node).
 * Use when API returns too few reviews.
 */

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

const APP_URL = (appId, lang = 'en_US', showAllReviews = true) => {
  const base = `https://play.google.com/store/apps/details?id=${appId}&hl=${lang}`;
  return showAllReviews ? `${base}&showAllReviews=true` : base;
};

const SCROLL_DELAY_MS = 2500;
const MAX_SCROLLS = 80;
const WEEKS_MS = (n) => n * 7 * 24 * 60 * 60 * 1000;

function formatDateDisplay(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function parseHelpful(text) {
  if (!text || typeof text !== 'string') return 0;
  const m = text.match(/(\d+)\s+people found this review helpful/i);
  if (m) return parseInt(m[1], 10);
  if (/one person found/i.test(text)) return 1;
  return 0;
}

function parseRatingFromStars(ariaLabelOrText) {
  if (!ariaLabelOrText) return 0;
  const m = String(ariaLabelOrText).match(/(\d)/);
  return m ? parseInt(m[1], 10) : 0;
}

async function extractReviewsFromPage(page) {
  return page.evaluate(() => {
    const out = [];
    const containers = document.querySelectorAll('[data-review-id], .RHo1pe, [itemprop="review"]');
    const fallback = document.querySelectorAll('div[class*="review"]');
    const nodes = containers.length ? containers : fallback;
    nodes.forEach((node) => {
      const textEl = node.querySelector('.UD7Dzf, [data-review-body], [itemprop="reviewBody"], .bAhAQe');
      const text = textEl ? textEl.textContent.trim() : '';
      if (!text) return;
      const dateEl = node.querySelector('.bp9Aid, [itemprop="datePublished"], time');
      let dateStr = dateEl ? (dateEl.getAttribute('datetime') || dateEl.textContent.trim()) : '';
      if (!dateStr && dateEl) dateStr = dateEl.textContent.trim();
      const helpfulEl = node.querySelector('.i9xfbb, .AJTPZc, [aria-label*="helpful"]');
      const helpfulText = helpfulEl ? helpfulEl.textContent : '';
      const starEl = node.querySelector('[aria-label*="star"], [role="img"]');
      const rating = starEl ? (starEl.getAttribute('aria-label') || starEl.getAttribute('alt') || '') : '';
      out.push({ text, dateStr, helpfulText, ratingText: rating });
    });
    return out;
  });
}

async function scrollReviewsSection(page) {
  await page.evaluate(() => {
    const sheet = document.querySelector('div[role="dialog"] .fysCi, div[role="dialog"] [class*="scroll"], .T4LgNb');
    const main = document.scrollingElement || document.documentElement;
    (sheet || main).scrollTop = (sheet || main).scrollHeight;
  });
}

export async function fetchReviewsPlaywright({
  appId = 'in.indwealth',
  lang = 'en_US',
  weeksBack = 10,
  maxReviews = 5000,
  onProgress,
} = {}) {
  const cutoffMs = Date.now() - WEEKS_MS(weeksBack);
  const url = APP_URL(appId, lang);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const seen = new Set();
  const all = [];
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: lang.replace('_', '-'),
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const seeAllBtn = await page.$('button:has-text("See all reviews"), span:has-text("See all reviews"), a:has-text("See all reviews")');
    if (seeAllBtn) { await seeAllBtn.click(); await page.waitForTimeout(2000); }
    for (let s = 0; s < MAX_SCROLLS && all.length < maxReviews; s++) {
      const batch = await extractReviewsFromPage(page);
      for (const r of batch) {
        const key = (r.text || '').slice(0, 200);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        let dateIso = '';
        if (r.dateStr) {
          const parsed = new Date(r.dateStr);
          dateIso = !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : r.dateStr;
        }
        const reviewMs = dateIso ? new Date(dateIso).getTime() : 0;
        if (reviewMs && reviewMs < cutoffMs) continue;
        all.push({
          index: all.length,
          rating: parseRatingFromStars(r.ratingText),
          text: r.text,
          date: dateIso,
          dateDisplay: formatDateDisplay(dateIso),
          helpfulCount: parseHelpful(r.helpfulText),
        });
      }
      if (typeof onProgress === 'function') onProgress(all.length);
      await scrollReviewsSection(page);
      await page.waitForTimeout(SCROLL_DELAY_MS);
    }
    await context.close();
  } finally {
    await browser.close();
  }
  return all.slice(0, maxReviews);
}

export async function writeReviewArtifacts(reviews, outDir = 'reviews') {
  await mkdir(outDir, { recursive: true });
  const dateStr = new Date().toISOString().slice(0, 10);
  const jsonPath = join(outDir, `reviews_${dateStr}.json`);
  const csvPath = join(outDir, `reviews_${dateStr}.csv`);
  await writeFile(jsonPath, JSON.stringify(reviews, null, 2), 'utf8');
  const header = 'index,rating,text,date,dateDisplay,helpfulCount';
  const escape = (s) => { const t = String(s ?? '').replace(/"/g, '""'); return t.includes(',') || t.includes('"') || t.includes('\n') ? `"${t}"` : t; };
  const rows = reviews.map((r) => [r.index, r.rating, escape(r.text), escape(r.date), escape(r.dateDisplay), r.helpfulCount].join(','));
  await writeFile(csvPath, [header, ...rows].join('\n'), 'utf8');
  return { jsonPath, csvPath };
}
