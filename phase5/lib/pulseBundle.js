/**
 * Pulse bundle JSON + fee explainer (Part B parity with phase4/pulse_bundle.py).
 */

const DEFAULT_EXIT_LOAD_URL =
  "https://www.indmoney.com/mutual-funds/hdfc-mid-cap-fund-direct-plan-growth-option-3097";
const DEFAULT_OFFICIAL_SECOND_LINK = "https://www.amfiindia.com/investor-zone/investor-information";

const MIN_FEE_BULLETS = 3;
const MAX_FEE_BULLETS = 6;

const FALLBACK_EXIT_LOAD_BULLETS = [
  "Exit load is a charge some mutual fund schemes apply on redemption within a defined holding period when that term appears in the scheme documents.",
  "The applicable percentage and holding period are stated in the scheme information document and any addenda published for that scheme.",
  "A scheme may disclose nil exit load after a stated minimum holding period.",
  "Disclosure formats include scheme factsheets and offer documents made available by the asset management company.",
  "Registrar and platform pages typically reproduce the exit-load terms supplied for that scheme.",
  "Exit-load calculations follow the conventions (e.g., holding period, rounding) described in the scheme’s stated terms.",
];

export const FEE_SCENARIO_LABEL = "Mutual Fund Exit Load";

function sourceUrls(env) {
  const raw = (env.EXIT_LOAD_SOURCE_URL || "").trim() || DEFAULT_EXIT_LOAD_URL;
  return raw.split(",").map((u) => u.trim()).filter(Boolean);
}

export function normalizeOfficialSourceLinks(urls, env) {
  const out = [];
  for (const u of urls) {
    const s = (u || "").trim();
    if (s && !out.includes(s)) out.push(s);
  }
  const second =
    (env.EXIT_LOAD_SECOND_OFFICIAL_URL || "").trim() || DEFAULT_OFFICIAL_SECOND_LINK;
  if (out.length < 2) {
    for (const extra of [second, DEFAULT_EXIT_LOAD_URL]) {
      if (extra && !out.includes(extra)) out.push(extra);
      if (out.length >= 2) break;
    }
  }
  return out.length >= 2 ? out.slice(0, 2) : out;
}

function isCloudflareChallenge(html) {
  if (!html || html.length < 800) return true;
  const h = html.toLowerCase();
  return h.includes("cf-chl") || h.includes("challenges.cloudflare.com") || h.includes("just a moment");
}

function stripHtmlTags(html) {
  let t = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ");
  t = t.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");
  t = t.replace(/<[^>]+>/g, " ");
  return t.replace(/\s+/g, " ").trim();
}

function capSentence(p, maxLen = 280) {
  const s = p.trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1).replace(/\s+\S*$/, "") + "…";
}

function fallbackExitLoadSentences(fullText, maxBullets = MAX_FEE_BULLETS) {
  if (!fullText) return [];
  const parts = fullText.replace(/\n/g, " ").split(/(?<=[.!?])\s+/);
  const out = [];
  for (const p0 of parts) {
    const p = p0.trim();
    if (p.length < 30) continue;
    const pl = p.toLowerCase();
    const hit =
      (pl.includes("exit") && pl.includes("load")) ||
      (pl.includes("redemption") && (pl.includes("charge") || pl.includes("fee") || pl.includes("load")));
    if (!hit) continue;
    const c = capSentence(p);
    if (!out.includes(c)) out.push(c);
    if (out.length >= maxBullets) break;
  }
  return out;
}

function extractExitLoadBulletsFromHtml(html, maxBullets = MAX_FEE_BULLETS) {
  const text = stripHtmlTags(html);
  if (!text || text.length < 50) return [];
  const low = text.toLowerCase();
  let idx = -1;
  for (const key of ["exit load", "exit-load", "exitload"]) {
    idx = low.indexOf(key);
    if (idx >= 0) break;
  }
  const out = [];
  if (idx >= 0) {
    const window = text.slice(idx, idx + 2200);
    const parts = window.split(/(?<=[.!?])\s+/);
    for (const p0 of parts) {
      const p = p0.trim();
      if (p.length < 25) continue;
      const pl = p.toLowerCase();
      if (!pl.includes("exit") && !pl.includes("load") && !pl.includes("redemp")) continue;
      out.push(capSentence(p));
      if (out.length >= maxBullets) return out;
    }
  }
  if (out.length < maxBullets) {
    for (const extra of fallbackExitLoadSentences(text, maxBullets)) {
      if (!out.includes(extra)) out.push(extra);
      if (out.length >= maxBullets) break;
    }
  }
  return out;
}

async function fetchUrl(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(String(res.status));
    return res.text();
  } finally {
    clearTimeout(t);
  }
}

/** @returns {Promise<[string[], string[]]>} */
export async function getExitLoadBulletsAndLinks(env) {
  const rawUrls = sourceUrls(env);
  let links = normalizeOfficialSourceLinks(rawUrls, env);
  const rawJson = (env.EXIT_LOAD_BULLETS_JSON || "").trim();
  if (rawJson) {
    try {
      const data = JSON.parse(rawJson);
      if (Array.isArray(data) && data.length >= MIN_FEE_BULLETS) {
        let bullets = data.slice(0, MAX_FEE_BULLETS).map((x) => String(x).trim());
        while (bullets.length < MIN_FEE_BULLETS) {
          bullets.push(FALLBACK_EXIT_LOAD_BULLETS[bullets.length % FALLBACK_EXIT_LOAD_BULLETS.length]);
        }
        return [bullets.slice(0, MAX_FEE_BULLETS), links];
      }
    } catch {
      /* fall through */
    }
  }

  let bullets = [];
  for (const url of rawUrls) {
    try {
      const html = await fetchUrl(url);
      if (isCloudflareChallenge(html)) continue;
      bullets = extractExitLoadBulletsFromHtml(html);
      if (bullets.length >= MIN_FEE_BULLETS) return [bullets.slice(0, MAX_FEE_BULLETS), links];
    } catch {
      continue;
    }
  }

  if (bullets.length > 0) {
    const out = [...bullets, ...FALLBACK_EXIT_LOAD_BULLETS].slice(0, MAX_FEE_BULLETS);
    while (out.length < MIN_FEE_BULLETS) {
      out.push(FALLBACK_EXIT_LOAD_BULLETS[out.length % FALLBACK_EXIT_LOAD_BULLETS.length]);
    }
    return [out.slice(0, MAX_FEE_BULLETS), links];
  }
  return [FALLBACK_EXIT_LOAD_BULLETS.slice(0, MAX_FEE_BULLETS), links];
}

export function parseWeeklyPulseMd(content) {
  const themes = [];
  const quotes = [];
  const actionIdeas = [];

  const tm = content.match(/###\s*Top 3 Themes\s*\n([\s\S]*?)(?=^###\s*3 User Quotes\s*$)/m);
  if (tm) {
    for (const line of tm[1].trim().split("\n")) {
      const m = line.trim().match(/^\d+\.\s+\*\*([^*]+)\*\*/);
      if (m) themes.push(m[1].trim().replace(/:\s*$/, "").trim());
    }
  }

  const qm = content.match(/###\s*3 User Quotes\s*\n([\s\S]*?)(?=^###\s*3 Action Ideas\s*$)/m);
  if (qm) {
    for (const line of qm[1].trim().split("\n")) {
      const m = line.trim().match(/^\*\s+"(.+)"\s*$/) || line.trim().match(/^[-*]\s+"(.+)"\s*$/);
      if (m) quotes.push(m[1].trim());
    }
  }

  const am = content.match(/###\s*3 Action Ideas\s*\n([\s\S]*?)(?=^##|\Z)/m);
  if (am) {
    for (const line of am[1].trim().split("\n")) {
      const m = line.trim().match(/^\d+\.\s+\*\*([^*]+)\*\*/);
      if (m) actionIdeas.push(m[1].trim());
    }
  }

  return {
    themes: themes.slice(0, 3),
    quotes: quotes.slice(0, 3),
    action_ideas: actionIdeas.slice(0, 3),
  };
}

function runDateISO() {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

export function mcpNotesAppendPayload(bundle) {
  return {
    date: bundle?.date,
    weekly_pulse: bundle?.weekly_pulse,
    fee_scenario: bundle?.fee_scenario,
    explanation_bullets: bundle?.explanation_bullets,
    source_links: bundle?.source_links,
  };
}

export async function buildPulseBundleFromMarkdown(pulseMarkdown, env) {
  const weekly = parseWeeklyPulseMd(pulseMarkdown);
  let [bullets, links] = await getExitLoadBulletsAndLinks(env);
  while (bullets.length < MIN_FEE_BULLETS) {
    bullets.push(FALLBACK_EXIT_LOAD_BULLETS[bullets.length % FALLBACK_EXIT_LOAD_BULLETS.length]);
  }
  bullets = bullets.slice(0, MAX_FEE_BULLETS);
  links = normalizeOfficialSourceLinks(links, env);
  const dateStr = runDateISO();
  return {
    date: dateStr,
    weekly_pulse: weekly,
    fee_scenario: FEE_SCENARIO_LABEL,
    explanation_bullets: bullets,
    source_links: links,
    last_checked: dateStr,
  };
}

export function feeBlockMarkdown(bundle) {
  const bullets = bundle?.explanation_bullets || [];
  const links = bundle?.source_links || [];
  const label = bundle?.fee_scenario || FEE_SCENARIO_LABEL;
  const checked = bundle?.last_checked || bundle?.date || "";
  const lines = ["", "---", "", `## Fee explanation — ${label}`, ""];
  for (const b of bullets.slice(0, MAX_FEE_BULLETS)) lines.push(`- ${b}`);
  lines.push("", "**Official sources:**");
  for (const u of links) lines.push(`- ${u}`);
  lines.push("");
  if (checked) {
    lines.push(`*Last checked: ${checked}*`);
    lines.push("");
  }
  return lines.join("\n");
}

export function feeBlockPlain(bundle) {
  const bullets = bundle?.explanation_bullets || [];
  const links = bundle?.source_links || [];
  const label = bundle?.fee_scenario || FEE_SCENARIO_LABEL;
  const checked = bundle?.last_checked || bundle?.date || "";
  const lines = [
    "",
    "--------------------------------------------------------------------------------",
    `FEE EXPLANATION — ${label}`,
    "--------------------------------------------------------------------------------",
    "",
  ];
  for (const b of bullets.slice(0, MAX_FEE_BULLETS)) lines.push(`• ${b}`);
  lines.push("", "Official sources:");
  for (const u of links) lines.push(`  ${u}`);
  lines.push("");
  if (checked) {
    lines.push(`Last checked: ${checked}`);
    lines.push("");
  }
  return lines.join("\n");
}
