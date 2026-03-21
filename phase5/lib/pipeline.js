/**
 * Node.js pipeline for Weekly Pulse (runs on Vercel).
 * Replicates Phase 1–3: fetch reviews → theme discovery → classify → one-pager.
 */

const APP_ID = "in.indwealth";
const MAX_THEMES = 5;
const NUM_BATCHES = 2;
const MAX_CHARS_PER_REVIEW = 400;
const MAX_PROMPT_REVIEW_CHARS = 80_000;
const CHUNK_SIZE = 50;
const TOP_THEMES = 3;
const MAX_WORDS = 450;
const DEFAULT_THEMES = [
  { label: "UX/Usability", description: "Ease of use, navigation, and interface feedback" },
  { label: "Performance", description: "App speed, responsiveness, and stability" },
  { label: "Features", description: "Requests or feedback about functionality" },
  { label: "Support", description: "Customer support and resolution" },
  { label: "Bugs/Issues", description: "Defects, errors, and technical problems" },
];

function realWordCount(text) {
  if (!text || typeof text !== "string") return 0;
  return text.split(/\s+/).filter((t) => /[a-zA-Z0-9]/.test(t)).length;
}

function isMeaningfulReview(text) {
  return realWordCount((text || "").trim()) >= 5;
}

function formatDateDisplay(isoDate) {
  if (!isoDate) return "";
  return new Date(isoDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

const GROQ_RETRY_ATTEMPTS = 4;
const GROQ_INITIAL_BACKOFF_MS = 2000;
const GROQ_DELAY_BETWEEN_CALLS_MS = 1500;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Call Groq with retry on 429 (rate limit). Uses exponential backoff. */
async function groqWithRetry(client, options) {
  let lastErr;
  for (let attempt = 0; attempt < GROQ_RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await client.chat.completions.create(options);
      return res;
    } catch (e) {
      lastErr = e;
      const status = e?.status ?? e?.statusCode ?? e?.response?.status;
      const is429 = status === 429 || (e?.message && /429|rate limit/i.test(String(e.message)));
      if (is429 && attempt < GROQ_RETRY_ATTEMPTS - 1) {
        const waitMs = GROQ_INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        await sleep(waitMs);
      } else {
        throw e;
      }
    }
  }
  throw lastErr;
}

/** Phase 1: Fetch reviews using google-play-scraper */
async function fetchReviews({ appId = APP_ID, weeksBack = 10, maxReviews = 1000 } = {}) {
  const gplay = (await import("google-play-scraper")).default;
  const cutoffMs = Date.now() - weeksBack * 7 * 24 * 60 * 60 * 1000;
  let raw = [];
  try {
    const res = await gplay.reviews({
      appId,
      sort: gplay.sort.NEWEST,
      paginate: false,
      num: Math.min(maxReviews * 2, 500),
    });
    raw = res.data || [];
  } catch (e) {
    const res = await gplay.reviews({
      appId,
      sort: gplay.sort.NEWEST,
      paginate: true,
    });
    raw = res.data || [];
    let token = res.nextPaginationToken;
    while (token && raw.length < maxReviews * 2) {
      await new Promise((r) => setTimeout(r, 800));
      const next = await gplay.reviews({ appId, sort: gplay.sort.NEWEST, paginate: true, nextPaginationToken: token });
      raw = raw.concat(next.data || []);
      token = next.nextPaginationToken;
    }
  }
  const reviews = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const dateMs = r.date ? new Date(r.date).getTime() : 0;
    if (dateMs < cutoffMs) continue;
    if (reviews.length >= maxReviews) break;
    const text = String(r.text ?? "").trim();
    if (!isMeaningfulReview(text)) continue;
    reviews.push({
      index: reviews.length,
      rating: typeof r.score === "number" ? r.score : parseInt(String(r.score || 0), 10) || 0,
      text,
      date: r.date ? new Date(r.date).toISOString() : "",
      dateDisplay: formatDateDisplay(r.date),
      helpfulCount: typeof r.thumbsUp === "number" ? r.thumbsUp : parseInt(String(r.thumbsUp || 0), 10) || 0,
    });
  }
  return reviews;
}

const GROQ_MODEL = "llama-3.3-70b-versatile";

/** Phase 2a: Theme discovery via Groq (2 batches, merge) */
async function themeDiscovery(reviewTexts, groqKey) {
  const Groq = (await import("groq-sdk")).default;
  const client = new Groq({ apiKey: groqKey });

  function parseThemes(text) {
    const themes = [];
    const lines = text.split("\n").map((l) => l.replace(/^[\d.)\-\*]+\s*/, "").trim()).filter(Boolean);
    for (let i = 0; i < lines.length && themes.length < MAX_THEMES; i += 2) {
      const label = lines[i];
      const description = lines[i + 1] || "";
      if (label && label.length >= 2) themes.push({ label, description });
    }
    return themes;
  }

  const batchSize = Math.ceil(reviewTexts.length / NUM_BATCHES);
  const batches = [];
  for (let b = 0; b < NUM_BATCHES; b++) {
    const start = b * batchSize;
    const chunk = reviewTexts.slice(start, start + batchSize).filter(Boolean);
    let combined = "";
    let n = 0;
    for (const t of chunk) {
      const line = `[Review ${n + 1}]\n${(t || "").slice(0, MAX_CHARS_PER_REVIEW)}`;
      if (combined.length + line.length + 2 > MAX_PROMPT_REVIEW_CHARS) break;
      combined = combined ? combined + "\n\n" + line : line;
      n++;
    }
    const prompt = `Given these app store reviews, identify 3 to 5 distinct themes (e.g. UX/Usability, Performance, Features, Support, Bugs/Issues).
For each theme, give the theme label on one line, then a short one-line description on the next line. No numbering. Maximum ${MAX_THEMES} themes.

Reviews:
${combined}`;
    if (b > 0) await sleep(GROQ_DELAY_BETWEEN_CALLS_MS);
    const res = await groqWithRetry(client, {
      model: GROQ_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 400,
    });
    const content = (res.choices?.[0]?.message?.content || "").trim();
    batches.push(parseThemes(content).length ? parseThemes(content) : DEFAULT_THEMES.slice(0, MAX_THEMES));
  }

  if (batches.length === 1) return batches[0];
  await sleep(GROQ_DELAY_BETWEEN_CALLS_MS);
  const combined = batches.map((list, i) => `Batch ${i + 1}:\n${list.map((t) => `  ${t.label}: ${t.description}`).join("\n")}`).join("\n\n");
  const mergeRes = await groqWithRetry(client, {
    model: GROQ_MODEL,
    messages: [{
      role: "user",
      content: `These theme lists were generated from different batches of the same app's reviews. Merge them into a single list of 3 to 5 distinct themes. For each final theme, give the theme label on one line, then a short one-line description on the next line. No numbering.\n\n${combined}`,
    }],
    temperature: 0.2,
    max_tokens: 400,
  });
  const merged = parseThemes((mergeRes.choices?.[0]?.message?.content || "").trim());
  return merged.length ? merged : batches[0];
}

/** Phase 2b: Classify reviews by theme via Groq */
async function classifyReviews(reviews, themes, groqKey) {
  const Groq = (await import("groq-sdk")).default;
  const client = new Groq({ apiKey: groqKey });
  const themeLabels = themes.map((t) => (typeof t === "object" ? t.label : t));

  function normalizeLabel(returned) {
    const r = (returned || "").trim();
    for (const label of themeLabels) {
      if (label === r || label.toLowerCase() === r.toLowerCase()) return label;
    }
    for (const label of themeLabels) {
      if (label.toLowerCase().includes(r.toLowerCase()) || r.toLowerCase().includes(label.toLowerCase())) return label;
    }
    return themeLabels[0];
  }

  const reviewIdToTheme = {};
  for (let i = 0; i < reviews.length; i += CHUNK_SIZE) {
    const chunk = reviews.slice(i, i + CHUNK_SIZE);
    const lines = chunk.map((r) => `Index ${r.index}: ${(r.text || "").slice(0, 400)}`).join("\n");
    const prompt = `Themes (use exactly one per review): ${themeLabels.join(", ")}

For each review below, assign exactly one theme from the list. Reply with a JSON object mapping index to theme label, e.g. {"0": "UX/Usability", "1": "Performance"}. Use string keys. Return only the JSON object.

Reviews:
${lines}`;
    if (i > 0) await sleep(GROQ_DELAY_BETWEEN_CALLS_MS);
    const res = await groqWithRetry(client, {
      model: GROQ_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 1024,
    });
    const text = (res.choices?.[0]?.message?.content || "").trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const obj = JSON.parse(match[0]);
        for (const [k, v] of Object.entries(obj)) reviewIdToTheme[k] = normalizeLabel(v);
      } catch (_) {}
    }
  }
  return reviewIdToTheme;
}

function buildThemesWithReviews(themes, reviews, reviewIdToTheme) {
  const themeLabels = themes.map((t) => (typeof t === "object" ? t.label : t));
  const byId = {};
  for (const r of reviews) byId[String(r.index)] = r;
  const themeToReviews = {};
  for (const l of themeLabels) themeToReviews[l] = [];
  for (const [rid, label] of Object.entries(reviewIdToTheme)) {
    if (themeToReviews[label] && byId[rid]) themeToReviews[label].push(byId[rid]);
  }
  return themes.map((t) => {
    const label = typeof t === "object" ? t.label : t;
    const description = typeof t === "object" ? (t.description || "") : "";
    return { theme: { label, description }, reviews: themeToReviews[label] || [] };
  });
}

/** Phase 3: Generate one-pager via Groq */
async function generateOnePager(themesWithReviews, groqKey, env) {
  const Groq = (await import("groq-sdk")).default;
  const client = new Groq({ apiKey: groqKey });

  const entries = themesWithReviews
    .map((e) => ({ label: e.theme?.label || "", description: e.theme?.description || "", count: (e.reviews || []).length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_THEMES);
  const themeSummary = entries.map((t, i) => `${i + 1}. ${t.label} (${t.count} reviews): ${t.description || "N/A"}`).join("\n");
  const quotes = [];
  for (const e of themesWithReviews) {
    const label = e.theme?.label || "";
    for (const r of (e.reviews || []).slice(0, 5)) {
      const text = (r.text || "").trim();
      if (text.length >= 10) quotes.push(`[${label}] "${text.slice(0, 200)}${text.length > 200 ? "..." : ""}"`);
    }
  }
  const quotesBlock = quotes.slice(0, 20).join("\n");

  const prompt = `Generate a weekly one-page note for product leadership from the app store review data below. Use ONLY this data. No PII.

**Theme summary (top 3 by volume):**
${themeSummary}

**Sample anonymized quotes (choose from these only):**
${quotesBlock}

**REQUIRED OUTPUT — copy this structure exactly. Every line below shows mandatory markdown.**

## Weekly One-Page Note

### Top 3 Themes
1. **Theme label (N reviews):** One or two sentences summarising what users say. Use the real theme names and counts from the theme summary.
2. **Theme label (N reviews):** One or two sentences.
3. **Theme label (N reviews):** One or two sentences.

### 3 User Quotes
Use exactly three lines. Each line MUST start with an asterisk, a space, then a double-quoted string:
* "First quote here."
* "Second quote here."
* "Third quote here."

### 3 Action Ideas
1. **Short action title:** One or two sentences (concrete next step).
2. **Short action title:** One or two sentences.
3. **Short action title:** One or two sentences.

---
Rules: Output ONLY from "## Weekly One-Page Note" through the three action items. Keep ### section headers exactly as shown. Do not merge quotes into one paragraph. Do not remove **bold** around theme names or action titles. Aim for 300–${MAX_WORDS} words. Professional tone. No sign-off.`;

  const res = await groqWithRetry(client, {
    model: GROQ_MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.25,
    max_tokens: 2048,
  });
  const raw = (res.choices?.[0]?.message?.content || "").trim();
  if (!raw) throw new Error("Groq returned no text");

  const words = raw.split(/\s+/).length;
  const pulse = words > MAX_WORDS + 100 ? raw.split(/\s+/).slice(0, MAX_WORDS).join(" ") : raw;
  const weekHeader = `Week of ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
  const contentWithHeader = `${weekHeader}\n\n${pulse}`;

  let themeLegend = "";
  for (const e of themesWithReviews) {
    const t = e.theme || {};
    themeLegend += `## ${t.label || ""}\n${(t.description || "") + "\n"}*${(e.reviews || []).length} reviews*\n\n`;
  }

  const { buildPulseBundleFromMarkdown, feeBlockMarkdown, feeBlockPlain } = await import("./pulseBundle.js");
  const pulseBundle = await buildPulseBundleFromMarkdown(contentWithHeader, env || process.env);
  const feeMd = feeBlockMarkdown(pulseBundle);
  const feePlain = feeBlockPlain(pulseBundle);

  return {
    pulse: contentWithHeader,
    themeLegend: themeLegend.trim(),
    pulseBundle,
    feeBlockMarkdown: feeMd,
    feeBlockPlain: feePlain,
  };
}

/** Run full pipeline; returns { pulse, themeLegend, pulseBundle, feeBlockMarkdown, feeBlockPlain } */
export async function runNodePipeline(env) {
  const appId = env.APP_ID || APP_ID;
  const weeksBack = Math.max(8, Math.min(12, parseInt(env.WEEKS_BACK || "10", 10) || 10));
  const maxReviews = parseInt(env.MAX_REVIEWS || "1000", 10) || 1000;
  const groqKey = (env.GROQ_API_KEY || "").trim();
  if (!groqKey) throw new Error("GROQ_API_KEY is not set. Add it in Vercel Environment Variables.");

  const reviews = await fetchReviews({ appId, weeksBack, maxReviews });
  if (reviews.length === 0) throw new Error("No reviews fetched. Try different weeks or check the app ID.");

  const texts = reviews.map((r) => r.text).filter(Boolean);
  const themes = await themeDiscovery(texts, groqKey);
  const reviewIdToTheme = await classifyReviews(reviews, themes, groqKey);
  const themesWithReviews = buildThemesWithReviews(themes, reviews, reviewIdToTheme);
  return generateOnePager(themesWithReviews, groqKey, env);
}
