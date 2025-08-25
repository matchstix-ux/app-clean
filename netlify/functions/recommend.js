// netlify/functions/recommend.js

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type",
  "content-type": "application/json"
};

// US market: filter out Cuban brands
const isCuban = (c) => {
  // Brand check: expand this if you want more strict
  const cubanBrands = [
    "cohiba", "montecristo", "romeo y julieta", "partagas", "hoyo de monterrey", "bolivar", "trinidad", "quintero", "ramon allones", "veguero", "punch", "juan lopez"
  ];
  const brand = c.brand?.toLowerCase?.() || "";
  // Check for telltale Cuban only
  return cubanBrands.some(cb => brand === cb || brand.startsWith(cb + " (cuba"));
};

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export default async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS });

  if (req.method !== "POST")
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });

  let cigarName = "";
  try {
    const body = await req.json();
    cigarName = body.cigarName?.toLowerCase?.().trim() || "";
    if (!cigarName) throw new Error();
  } catch {
    return new Response(JSON.stringify({ error: "Missing cigar name" }), { status: 400, headers: CORS });
  }

  const cigars = await import("../../data/cigars.json").then(m => m.default);

  // US market only
  const usCigars = cigars.filter(c => !isCuban(c));

  // Brand or name match
  let recs = usCigars.filter(
    c =>
      c.name?.toLowerCase().includes(cigarName) ||
      c.brand?.toLowerCase().includes(cigarName)
  );

  // If no match, try flavor notes
  if (!recs.length) {
    recs = usCigars.filter(
      c =>
        Array.isArray(c.flavorNotes) &&
        c.flavorNotes.some(note => cigarName.includes(note.toLowerCase()))
    );
  }

  // Shuffle for randomness, grab up to 3
  recs = shuffle(recs).slice(0, 3);

  // Fallback: 3 random US-market cigars
  if (!recs.length) recs = shuffle(usCigars).slice(0, 3);
return new Response(JSON.stringify({ recommendations: recs }), { status: 200, headers: CORS });

};
