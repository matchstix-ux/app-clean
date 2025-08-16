// netlify/functions/recommend.js
// Netlify Functions v2 (ESM). Single-file version (no imports).

// --- CORS helpers ---
const CORS_HEADERS = {
  "access-control-allow-origin": "*", // tighten to your domain if needed
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "content-type": "application/json"
};
const cors = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, ...extra } });

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

// --- Fallback if OpenAI is unavailable ---
function fallbackRecs(seedStr = "") {
  // simple deterministic shuffle by seed for variety across calls
  const pool = [
    { name:"Liga Privada No. 9", brand:"Drew Estate", priceRange:"$$$", strength:8, flavorNotes:["espresso","dark chocolate","cedar"] },
    { name:"Oliva Serie V Melanio", brand:"Oliva", priceRange:"$$$", strength:7, flavorNotes:["cocoa","toast","leather"] },
    { name:"Perdomo 10th Anniversary Maduro", brand:"Perdomo", priceRange:"$$", strength:6, flavorNotes:["sweet earth","cocoa","molasses"] },
    { name:"Aging Room Quattro Nicaragua", brand:"Aging Room", priceRange:"$$$", strength:7, flavorNotes:["baking spice","dark fruit","oak"] },
    { name:"My Father Le Bijou 1922", brand:"My Father", priceRange:"$$$", strength:8, flavorNotes:["pepper","espresso","cocoa"] },
    { name:"EP Carrillo Pledge", brand:"E.P. Carrillo", priceRange:"$$$", strength:7, flavorNotes:["graham","cocoa","spice"] },
    { name:"Brick House Maduro", brand:"J.C. Newman", priceRange:"$", strength:5, flavorNotes:["cocoa","nutty","sweet spice"] },
    { name:"CAO Brazilia", brand:"CAO", priceRange:"$", strength:6, flavorNotes:["coffee","earth","dark sweetness"] },
  ];
  let seed = 0;
  for (const ch of String(seedStr)) seed = (seed * 33 + ch.charCodeAt(0)) >>> 0;
  for (let i = pool.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 3);
}

// --- Netlify Function ---
export default async (req) => {
  try {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (req.method !== "POST") {
      return cors({ error: "Method not allowed. Use POST." }, 405);
    }

    // Try to parse JSON body; support form posts that forgot the header
    let body = {};
    try {
      body = await req.json();
    } catch {
      // If the client forgot to set content-type, try to read text and parse query-ish strings
      const text = await req.text().catch(() => "");
      if (text && text.trim().startsWith("{")) {
        try { body = JSON.parse(text); } catch { body = {}; }
      } else {
        body = {};
      }
    }

    const cigar = typeof body.cigar === "string" ? body.cigar.trim() : "";
    const avoid = Array.isArray(body.avoid) ? body.avoid.filter(Boolean).slice(0, 50) : [];

    if (!cigar) {
      console.warn("Bad request: missing 'cigar' in body", { bodyPreview: JSON.stringify(body).slice(0, 200) });
      return cors({ error: "Invalid input: provide a 'cigar' string." }, 400);
    }

    const apiKey = process.env.OPENAI_API_KEY;
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

    let modelResponseOk = false;
    let list = [];

    if (!apiKey) {
      console.error("Missing env var: OPENAI_API_KEY");
    } else {
      try {
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "authorization": `Bearer ${apiKey}`
          },
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
          console.error("OpenAI API error:", resp.status, txt);
        } else {
          const raw = await resp.json();
          const content = raw?.choices?.[0]?.message?.content || "{}";
          let parsed; try { parsed = JSON.parse(content); } catch { parsed = {}; }

          list = Array.isArray(parsed?.recommendations) ? parsed.recommendations : [];
          modelResponseOk = list.length > 0;
        }
      } catch (e) {
        console.error("OpenAI fetch failed:", e);
      }
    }

    // Sanitize + enforce schema
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

    // Fallback if we have nothing from the model
    if (!modelResponseOk) {
      list = fallbackRecs(cigar + ":" + seed);
    }

    // Normalize items
    let clean = list.map(it=>{
      const out = {};
      if (it && typeof it === "object") {
        if (it.name!=null) out.name = strip(it.name);
        if (it.brand!=null) out.brand = strip(it.brand);
        if (it.priceRange!=null) out.priceRange = strip(it.priceRange);
        out.strength = Math.max(1, Math.min(10, parseInt(it.strength,10) || 5));
        out.flavorNotes = stripNotes(it.flavorNotes);
      }
      Object.keys(out).forEach(k=>{ if(!ALLOWED.has(k)) delete out[k]; });
      return out;
    });

    // Avoid list
    const avoidSet = new Set(avoid.map(a => a.toLowerCase()));
    clean = clean.filter(it => !avoidSet.has(String(it?.name||"").toLowerCase()));

    // Minimal metadata so US filter can work
    const withMeta = clean.map(it => ({
      ...it,
      metadata: { brand: it.brand || "", name: it.name || "" }
    }));

    // Apply US filter (drop Cuban)
    const usOnly = filterForUSMarket(withMeta).map(({ metadata, ...rest }) => rest);

    // Shuffle for variety
    for (let i = usOnly.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [usOnly[i], usOnly[j]] = [usOnly[j], usOnly[i]];
    }

    // Enforce exactly 3
    let final = usOnly.slice(0, 3);
    while (final.length < 3) {
      final.push({ name:"TBD", brand:"", priceRange:"$$", strength:5, flavorNotes:[] });
    }

    console.log("US filter summary:", {
      cigar,
      input: clean.length,
      output: final.length,
      usedModel: modelResponseOk
    });

    return cors({ recommendations: final }, 200);

  } catch (err) {
    console.error("Function error:", err);
    return cors({ error: "Unexpected server error — please try again later." }, 500);
  }
};
