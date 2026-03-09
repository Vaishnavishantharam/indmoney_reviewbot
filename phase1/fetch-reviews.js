/**
 * Phase 1 — Fetch Google Play reviews (Node).
 * Use from repo root via scripts/cli-fetch-reviews.js.
 */

import gplay from 'google-play-scraper';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

const PAGE_DELAY_MS = 1000;
const REVIEWS_PER_PAGE = 150;
const MIN_WORDS = 5;

function realWordCount(text) {
  if (!text || typeof text !== 'string') return 0;
  return text.split(/\s+/).filter((t) => /[a-zA-Z0-9]/.test(t)).length;
}

function isMeaningfulReview(title, text) {
  const combined = `${(title || '').trim()} ${(text || '').trim()}`.trim();
  return realWordCount(combined) >= MIN_WORDS;
}

function formatDateDisplay(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function redactReview(raw, index) {
  const date = raw.date ? new Date(raw.date).toISOString() : '';
  return {
    index,
    rating: typeof raw.score === 'number' ? raw.score : parseInt(String(raw.score || 0), 10) || 0,
    text: String(raw.text ?? '').trim(),
    date,
    dateDisplay: formatDateDisplay(date),
    helpfulCount: typeof raw.thumbsUp === 'number' ? raw.thumbsUp : parseInt(String(raw.thumbsUp || 0), 10) || 0,
  };
}

async function fetchWithNum(appId, num) {
  const res = await gplay.reviews({
    appId,
    sort: gplay.sort.NEWEST,
    paginate: false,
    num,
  });
  return res.data || [];
}

async function fetchWithPagination(appId, maxReviews, onProgress) {
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const all = [];
  let token = null;
  while (all.length < maxReviews) {
    const opts = {
      appId,
      sort: gplay.sort.NEWEST,
      paginate: true,
      ...(token && { nextPaginationToken: token }),
    };
    const res = await gplay.reviews(opts);
    const data = res.data || [];
    for (const raw of data) all.push(raw);
    if (typeof onProgress === 'function') onProgress(all.length);
    token = res.nextPaginationToken || null;
    if (!token || data.length === 0) break;
    await delay(PAGE_DELAY_MS);
  }
  return all;
}

export async function fetchReviews({ appId, weeksBack = 10, maxReviews = 500, onProgress } = {}) {
  const cutoffMs = Date.now() - weeksBack * 7 * 24 * 60 * 60 * 1000;
  let rawReviews = [];
  try {
    rawReviews = await fetchWithNum(appId, Math.min(maxReviews, 5000));
    if (typeof onProgress === 'function') onProgress(rawReviews.length, rawReviews.length);
  } catch (e) {
    console.warn('Single-request fetch failed, trying pagination:', e.message);
  }
  if (rawReviews.length < maxReviews) {
    const more = await fetchWithPagination(appId, maxReviews, (n) => { if (typeof onProgress === 'function') onProgress(n, n); });
    const seen = new Set(rawReviews.map((r) => r.id || r.text + r.date).filter(Boolean));
    for (const r of more) {
      const key = r.id || (r.text + r.date);
      if (!key || !seen.has(key)) { seen.add(key); rawReviews.push(r); }
      if (rawReviews.length >= maxReviews) break;
    }
  }
  let redacted = [];
  for (let i = 0; i < rawReviews.length; i++) {
    const raw = rawReviews[i];
    const reviewDate = raw.date ? new Date(raw.date).getTime() : 0;
    if (reviewDate < cutoffMs) continue;
    if (redacted.length >= maxReviews) break;
    redacted.push(redactReview(raw, redacted.length));
  }
  redacted = redacted.filter((r) => isMeaningfulReview('', r.text));
  redacted = redacted.map((r, i) => ({ ...r, index: i }));
  return redacted;
}

export async function writeReviewArtifacts(reviews, outDir = 'reviews') {
  await mkdir(outDir, { recursive: true });
  const dateStr = new Date().toISOString().slice(0, 10);
  const jsonPath = join(outDir, `reviews_${dateStr}.json`);
  const csvPath = join(outDir, `reviews_${dateStr}.csv`);
  await writeFile(jsonPath, JSON.stringify(reviews, null, 2), 'utf8');
  const header = 'index,rating,text,date,dateDisplay,helpfulCount';
  const escape = (s) => {
    const t = String(s ?? '').replace(/"/g, '""');
    return t.includes(',') || t.includes('"') || t.includes('\n') ? `"${t}"` : t;
  };
  const rows = reviews.map((r) =>
    [r.index, r.rating, escape(r.text), escape(r.date), escape(r.dateDisplay), r.helpfulCount].join(',')
  );
  await writeFile(csvPath, [header, ...rows].join('\n'), 'utf8');
  return { jsonPath, csvPath };
}
