// netlify/functions/recommend.js
// Netlify Functions v2 (ESM). Single-file version (no imports).

// ---------- CORS ----------
const CORS_HEADERS = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "Content-Type, Authorization",
};

// ---------- Cuban detector (embedded) ----------
function isCuban(meta = {}) {
  const origin  = (meta.origin || meta.country || meta.country_of_origin || "").trim().toLowerCase();
  const owner   = (meta.brand_owner || meta.owner || "").trim().toLowerCase();
  const factory = (meta.factory || "").trim().toLowerCase();
  const brand   = (meta.brand || "").trim().toLowerCase();
  const name    = (meta.name || meta.line || "").trim().toLowerCase();

  if (origin === "cuba" || origin === "cu") return true;
  if (owner.includes("habanos")) return true;

  const dualMarketBrands = [
    "cohiba", "montecristo", "romeo y julieta", "h. upmann", "h upmann",
    "partagás", "partagas", "trinidad", "bolivar", "punch", "ramon allones",
    "quai d'orsay"
  ];
  const isDual = dualMarketBrands.some(k => brand.includes(k));

  if (isDual) {
    if (origin && origin !== "cuba" && !owner.includes("habanos")) return false;
    const hints = ["el laguito", "partagas factory", "la corona", "habana", "habano"];
    if (hints.some(h => factory.includes(h) || name.includes(h))) return true;
    return false;
  }

  if (/(habana|habano)/i.test(name)) return true;
  return false;
}

function filterForUSMarket(results = []) {
  try {
    return results.filter(r => !isCuban(r?.metadata || {}));
  } catch (e) {
    console.error("Market filter error", e);
    return results; // fail-open
  }
}

// ---------- helpers: coercion & cleaning ----------
function coercePriceRange(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (["$", "$$", "$$$", "$$$$"].includes(s)) return s;
  if (/\b(budget|value|cheap|inexpensive|affordable|entry)\b/.test(s)) return "$";
  if (/\b(mid|moderate|$$|midrange|middle)\b/.test(s)) return "$$";
  if (/\b(premium|expensive|luxury|high-end|$$$)\b/.test(s)) return "$$$";
  if (/\b(ultra|prestige|$$$$|very premium)\b/.test(s)) return "$$$$";
  // unknown → sensible default
  return "$$";
}

function coerceStrength(v) {
  if (Number.isFinite(v)) return Math.max(1, Math.min(10, v));
  const s = String(v ?? "").trim().toLowerCase();
  const map = [
    [/^(very\s+)?mild$/, 2],
    [/^mild-?medium$/, 4],
    [/^medium$/, 5],
    [/^medium-?full$/, 7],
    [/^full$/, 9],
    [/^very\s+full$/, 10],
  ];
  for (const [rx, val] of map) if (rx.test(s)) return val;
  // try to pull a digit
  const n = parseInt(s.replace(/[^\d]/g, ""), 10);
  if (Number.isFinite(n)) return Math.max(1, Math.min(10, n));
  return 5;
}

function splitNotes(v) {
  if (Array.isArray(v)) return v;
  const s = String(v ?? "").trim();
  if (!s) return [];
  return s.split(/[;,]/g).map(x => x.trim()).filter(Boolean);
}

function stripText(s) {
  return String(s ?? "")
    .replace(/^Why Similar:\s*/i, "")
    .replace(/^Key Differences?:\s*/i, "")
    .trim();
}

function normalizeItem(it = {}) {
  const out = {};
  out.name = stripText(it.name || "");
  out.brand = stripText(it.brand || "");
  out.priceRange = coercePriceRange(it.priceRange);
  out.strength = coerceStrength(it.strength);
  out.flavorNotes = splitNotes(it.flavorNotes).map(stripText).filter(Boolean).slice(0, 4);
  // enforce 3–4 notes (pad with generic if model only returns 1–2)
  const generics = ["cedar", "cocoa", "spice", "earth"];
  while (out.flavorNotes.length < 3) out.flavorNotes.push(generics[out.flavorNotes.length % generics.length]);
  return out;
}

function dedupeByNameBrand(items) {
  const seen = new Set();
  return items.filter(it => {
    const k = `${(it.name||"").toLowerCase()}|${(it.brand||"").toLowerCase()}`;
    if (!it.name || !it.brand) return false;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function ensureBrandDiversity(items) {
  const brands = new Set(items.map(i => i.brand.toLowerCase()));
  if (items.length >= 3 && brands.size >= 2) return items;
  // Try to swap-in different-brand candidates if we have them (callers provide a pool)
  return items;
}

// ---------- Netlify Function ----------
export default async (req) => {
  try {
    // Preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405, headers: CORS_HEADERS
      });
    }

    const body = await req.json().catch(() => ({}));
    const cigar = typeof body.cigar === "string" ? body.cigar.trim() : "";
    const avoid = Array.isArray(body.avoid) ? body.avoid.filter(Boolean).slice(0, 50) : [];
    if (!cigar) {
      return new Response(JSON.stringify({ error: "Invalid input" }), {
        status: 400, headers: CORS_HEADERS
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("Missing env var: OPENAI_API_KEY");
      return new Response(JSON.stringify({ error: "Server missing API key" }), {
        status: 500, headers: CORS_HEADERS
      });
    }

    // Slight prompt shuffle to encourage variety across calls
    const varietyDirectives = [
      "Aim for a spread across Nicaragua, Dominican Republic, Honduras when relevant.",
      "Prefer one lighter, one medium, one fuller option, when sensible.",
      "Avoid repeating the same brands across different runs when reasonable.",
      "Mix classic and boutique producers where appropriate.",
    ];
    const spice = varietyDirectives[Math.floor(Math.random() * varietyDirectives.length)];

    const avoidLine = avoid.length ? `NEVER include any of these AVOID items by name: ${avoid.join("; ")}.` : "";

    const system = `You are a cigar expert who replies ONLY with JSON (no prose).
${avoidLine}
NEVER include fields named "why", "similarity", "differences", or any prose that starts with "Why Similar" or "Key Differences".
Return ONLY the following fields per item: name, brand, priceRange, strength, flavorNotes.
Output exactly 3 unique recommendations. Ensure the 3 items span at least 2 different brands and, when possible, distinct regions or strength levels.
${spice}`;

    const user = `Given the cigar "${cigar}", recommend EXACTLY 3 different cigars that someone who enjoys this cigar would also like.
Rules:
- Do not repeat any item from the AVOID list above (if present).
- Prefer a mix of brands/regions/strengths so results differ across calls.
Provide ONLY these fields:
1) name (string)
2) brand (string)
3) priceRange ($, $$, $$$, or $$$$)
4) strength (1-10) — if you think in words, convert to a 1–10 estimate
5) flavorNotes (array of 3-4 short notes)

Respond ONLY with a JSON object in this shape:
{
  "recommendations": [
    {
      "name": "string",
      "brand": "string",
      "priceRange": "string",
      "strength": number,
      "flavorNotes": ["note1","note2","note3"]
    }
  ]
}`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 1.15,
        top_p: 0.92,
        presence_penalty: 0.6,
        frequency_penalty: 0.3,
        max_tokens: 700,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      console.error("OpenAI API error:", resp.status, txt);
      return new Response(JSON.stringify({ error: "Sorry — our cigar recommender is temporarily unavailable. Please try again later." }), {
        status: 502, headers: CORS_HEADERS
      });
    }

    const raw = await resp.json().catch(() => ({}));
    const content = raw?.choices?.[0]?.message?.content || "{}";

    let parsed;
    try { parsed = JSON.parse(content); } catch (e) {
      console.error("Model returned non-JSON:", content);
      parsed = {};
    }

    // Pull list and normalize
    let list = Array.isArray(parsed?.recommendations) ? parsed.recommendations : [];

    // AVOID filtering by name (case-insensitive) right away
    if (avoid.length) {
      const avoidSet = new Set(avoid.map(a => a.toLowerCase()));
      list = list.filter(it => !avoidSet.has(String(it?.name||"").toLowerCase()));
    }

    // Normalize everything into our exact shape
    let clean = list.map(normalizeItem);
    clean = dedupeByNameBrand(clean);

    // Build minimal metadata so the filter can work on brand/name
    const withMeta = clean.map(it => ({
      ...it,
      metadata: { brand: it.brand || "", name: it.name || "" }
    }));

    // Apply US-market filter
    let usOnly = filterForUSMarket(withMeta).map(({ metadata, ...rest }) => rest);

    // Shuffle both pools for variety
    const shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };
    shuffle(usOnly);
    shuffle(clean);

    // Pick exactly 3 with diversity
    const pickKey = (it) => `${(it.name||"").toLowerCase()}|${(it.brand||"").toLowerCase()}`;
    const chosen = [];
    const chosenSet = new Set();
    const addIfNew = (it) => {
      const k = pickKey(it);
      if (!k || chosenSet.has(k)) return false;
      chosen.push(it);
      chosenSet.add(k);
      return true;
    };

    // 1) prefer US-only
    for (const it of usOnly) if (chosen.length < 3) addIfNew(it);
    // 2) backfill from clean if short
    for (const it of clean) if (chosen.length < 3) addIfNew(it);

    // Try to improve brand diversity if we ended with 3 of 1 brand
    const brands = new Map();
    chosen.forEach(it => brands.set(it.brand.toLowerCase(), (brands.get(it.brand.toLowerCase())||0)+1));
    if (brands.size < 2) {
      // try to swap last item with a different-brand candidate from clean
      const existingBrands = new Set(chosen.map(it => it.brand.toLowerCase()));
      const candidate = clean.find(it => !existingBrands.has(it.brand.toLowerCase()) && !chosenSet.has(pickKey(it)));
      if (candidate) {
        chosen.pop();
        chosenSet.delete(pickKey(chosen[chosen.length-1] || {}));
        addIfNew(candidate);
      }
    }

    // Final pad if still short
    while (chosen.length < 3) {
      chosen.push({ name:"TBD", brand:"", priceRange:"$$", strength:5, flavorNotes:["cedar","cocoa","spice"] });
    }

    console.log("US filter summary:", { input: clean.length, usOnly: usOnly.length, output: chosen.length });

    return new Response(JSON.stringify({ recommendations: chosen.slice(0,3) }), {
      status: 200, headers: CORS_HEADERS
    });

  } catch (err) {
    console.error("Function error:", err);
    return new Response(JSON.stringify({ error: "Unexpected server error — please try again later." }), {
      status: 500, headers: CORS_HEADERS
    });
  }
};
