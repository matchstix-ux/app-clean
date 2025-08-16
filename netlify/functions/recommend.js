// netlify/functions/recommend.js
// Netlify Functions v2 (ESM). Single-file version (no imports).

// --- Cuban detector (embedded) ---
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
    return false; // keep ambiguous so US counterparts survive
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

// --- Netlify Function ---
export default async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405, headers: { "content-type": "application/json" }
      });
    }

    const body = await req.json().catch(() => ({}));
    const cigar = typeof body.cigar === "string" ? body.cigar.trim() : "";
    const avoid = Array.isArray(body.avoid) ? body.avoid.filter(Boolean).slice(0, 50) : [];

    if (!cigar) {
      return new Response(JSON.stringify({ error: "Invalid input" }), {
        status: 400, headers: { "content-type": "application/json" }
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("Missing env var: OPENAI_API_KEY");
      return new Response(JSON.stringify({ error: "Server missing API key" }), {
        status: 500, headers: { "content-type": "application/json" }
      });
    }

    const seed = Math.floor(Math.random() * 1_000_000);
    const avoidLine = avoid.length ? `NEVER include any of these AVOID items: ${avoid.join("; ")}.` : "";

    const system = `You are a cigar expert who replies ONLY with JSON.
Random seed: ${seed}.
Always vary your recommendations — avoid repeating the same cigars if asked multiple times about the same input.
${avoidLine}
NEVER include fields named "why", "similarity", "differences", or any prose that starts with "Why Similar" or "Key Differences".
Return ONLY the following fields per item: name, brand, priceRange, strength, flavorNotes.
Output exactly 3 unique recommendations. Ensure the 3 items span at least 2 different brands and, when possible, distinct regions or strength levels.`;

    const user = `Given the cigar "${cigar}", recommend EXACTLY 3 different cigars that someone who enjoys this cigar would also like.
Rules:
- Do not repeat any item from the AVOID list above (if present).
- Prefer a mix of brands/regions/strengths so results differ across calls.
Provide ONLY these fields:
1) name (string)
2) brand (string)
3) priceRange ($, $$, $$$, or $$$$)
4) strength (1-10)
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
        temperature: 0.9,
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
      console.error("OpenAI API error:", txt);
      return new Response(JSON.stringify({ error: "Sorry — our cigar recommender is temporarily unavailable. Please try again later." }), {
        status: 502, headers: { "content-type": "application/json" }
      });
    }

    const raw = await resp.json();
    const content = raw?.choices?.[0]?.message?.content || "{}";
    let parsed; try { parsed = JSON.parse(content); } catch { parsed = {}; }

    // Allow only the specified fields
    const ALLOWED = new Set(["name","brand","priceRange","strength","flavorNotes"]);
    const BAD = [/^why\s+similar/i, /^key\s+differences?/i];
    const strip = (s) => String(s||"")
      .replace(/^Why Similar:\s*/i,"")
      .replace(/^Key Differences?:\s*/i,"")
      .trim();
    const stripNotes = (arr)=> (Array.isArray(arr)?arr:[])
      .map(strip)
      .filter(Boolean)
      .filter(x=>!BAD.some(rx=>rx.test(x)));

    let list = Array.isArray(parsed?.recommendations) ? parsed.recommendations : [];

    // AVOID filtering by name (case-insensitive)
    if (avoid.length) {
      const avoidSet = new Set(avoid.map(a => a.toLowerCase()));
      list = list.filter(it => !avoidSet.has(String(it?.name||"").toLowerCase()));
    }

    // Clean & normalize model output
    let clean = list.map(it=>{
      const out = {};
      if (it && typeof it === "object") {
        if (it.name!=null) out.name = strip(it.name);
        if (it.brand!=null) out.brand = strip(it.brand);
        if (it.priceRange!=null) out.priceRange = strip(it.priceRange);
        out.strength = Math.max(1, Math.min(10
