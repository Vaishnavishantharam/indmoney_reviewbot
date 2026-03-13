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

/** Phase 2a: Theme discovery via Groq (2 batches, merge) */
async function themeDiscovery(reviewTexts, groqKey) {
  const Groq = (await import("groq-sdk")).default;
  const client = new Groq({ apiKey: groqKey });
  const model = "llama-3.3-70b-versatile";

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
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 400,
    });
    const content = (res.choices?.[0]?.message?.content || "").trim();
    batches.push(parseThemes(content).length ? parseThemes(content) : DEFAULT_THEMES.slice(0, MAX_THEMES));
  }

  if (batches.length === 1) return batches[0];
  const combined = batches.map((list, i) => `Batch ${i + 1}:\n${list.map((t) => `  ${t.label}: ${t.description}`).join("\n")}`).join("\n\n");
  const mergeRes = await client.chat.completions.create({
    model,
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
    const res = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
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

/** Phase 3: Generate one-pager via Gemini */
async function generateOnePager(themesWithReviews, geminiKey) {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(geminiKey);

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

**REQUIRED OUTPUT FORMAT:**
## Weekly One-Page Note
### Top 3 Themes
Write exactly 3 themes. For each: theme name, review count in parentheses, then 1–2 sentences on what users are saying.
### 3 User Quotes
Write exactly 3 user quotes. Use or lightly paraphrase from the sample quotes above. One line per quote.
### 3 Action Ideas
Write exactly 3 action ideas. Each must be a concrete, actionable next step for product or support.
---
Output ONLY the markdown above. Aim for 300–${MAX_WORDS} words. Professional tone. No extra intro or sign-off.`;

  // Use current Gemini model IDs (1.5-flash-001 is deprecated/removed for v1beta).
  const modelCandidates = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
  ];
  let raw = "";
  let lastErr = null;
  for (const modelName of modelCandidates) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      raw = (result.response?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
      if (raw) break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!raw) {
    const msg = lastErr?.message || "Gemini returned no text";
    throw new Error(msg);
  }
  const words = raw.split(/\s+/).length;
  const pulse = words > MAX_WORDS + 100 ? raw.split(/\s+/).slice(0, MAX_WORDS).join(" ") : raw;
  const dateStr = new Date().toISOString().slice(0, 10);
  const weekHeader = `Week of ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
  const contentWithHeader = `${weekHeader}\n\n${pulse}`;

  let themeLegend = "";
  for (const e of themesWithReviews) {
    const t = e.theme || {};
    themeLegend += `## ${t.label || ""}\n${(t.description || "") + "\n"}*${(e.reviews || []).length} reviews*\n\n`;
  }

  return { pulse: contentWithHeader, themeLegend: themeLegend.trim() };
}

/** Run full pipeline; returns { pulse, themeLegend } */
export async function runNodePipeline(env) {
  const appId = env.APP_ID || APP_ID;
  const weeksBack = Math.max(8, Math.min(12, parseInt(env.WEEKS_BACK || "10", 10) || 10));
  const maxReviews = parseInt(env.MAX_REVIEWS || "1000", 10) || 1000;
  const groqKey = (env.GROQ_API_KEY || "").trim();
  const geminiKey = (env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "").trim();
  if (!groqKey) throw new Error("GROQ_API_KEY is not set. Add it in Vercel Environment Variables.");
  if (!geminiKey) throw new Error("GEMINI_API_KEY is not set. Add it in Vercel Environment Variables.");

  const reviews = await fetchReviews({ appId, weeksBack, maxReviews });
  if (reviews.length === 0) throw new Error("No reviews fetched. Try different weeks or check the app ID.");

  const texts = reviews.map((r) => r.text).filter(Boolean);
  const themes = await themeDiscovery(texts, groqKey);
  const reviewIdToTheme = await classifyReviews(reviews, themes, groqKey);
  const themesWithReviews = buildThemesWithReviews(themes, reviews, reviewIdToTheme);
  const { pulse, themeLegend } = await generateOnePager(themesWithReviews, geminiKey);
  return { pulse, themeLegend };
}
