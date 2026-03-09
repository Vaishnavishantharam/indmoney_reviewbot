#!/usr/bin/env node
/**
 * CLI: Fetch IND Money Play Store reviews (Phase 1).
 * Methods: api (google-play-scraper) or playwright (browser scrape).
 * Output: reviews/reviews_YYYY-MM-DD.json and .csv (no PII).
 * Sample fields: date, text, dateDisplay, helpfulCount ("X people found this helpful").
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadEnv() {
  const path = join(root, '.env');
  if (!existsSync(path)) return;
  const content = readFileSync(path, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const appId = process.env.APP_ID || 'in.indwealth';
const weeksBack = Math.min(12, Math.max(8, parseInt(process.env.WEEKS_BACK || '10', 10) || 10));
const maxReviews = parseInt(process.env.MAX_REVIEWS || '800', 10) || 800;
const method = (process.env.FETCH_METHOD || 'api').toLowerCase();

async function runApi() {
  const { fetchReviews, writeReviewArtifacts } = await import('../phase1/fetch-reviews.js');
  console.log('  Method: google-play-scraper (single request + pagination)\n');
  const reviews = await fetchReviews({
    appId,
    weeksBack,
    maxReviews,
    onProgress(fetched, kept) {
      process.stdout.write(`\r  Fetched ${fetched} reviews, kept ${kept} in last ${weeksBack} weeks`);
    },
  });
  return { reviews, writeReviewArtifacts };
}

async function runPlaywright() {
  const { fetchReviewsPlaywright, writeReviewArtifacts } = await import('../phase1/fetch-reviews-playwright.js');
  console.log('  Method: Playwright (browser scrape of Play Store page)\n');
  const reviews = await fetchReviewsPlaywright({
    appId,
    lang: 'en_US',
    weeksBack,
    maxReviews,
    onProgress(kept) {
      process.stdout.write(`\r  Loaded ${kept} reviews (scrolling…)`);
    },
  });
  return { reviews, writeReviewArtifacts };
}

console.log('Phase 1 — Fetch reviews');
console.log('  APP_ID:', appId);
console.log('  WEEKS_BACK:', weeksBack);
console.log('  MAX_REVIEWS:', maxReviews);
console.log('  FETCH_METHOD:', method, '(set FETCH_METHOD=playwright to use browser)\n');

const { reviews, writeReviewArtifacts } =
  method === 'playwright' ? await runPlaywright() : await runApi();

console.log('\n');

const { jsonPath, csvPath } = await writeReviewArtifacts(reviews, join(root, 'reviews'));

console.log('Done.');
console.log('  Reviews kept:', reviews.length);
console.log('  JSON:', jsonPath);
console.log('  CSV:', csvPath);
console.log('\nEach review has: index, rating, text, date, dateDisplay, helpfulCount.');
