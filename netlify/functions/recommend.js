// netlify/functions/recommend.js
// Netlify Functions v2 (ESM). No external imports needed. Assumes cigars.json in /netlify/data.

import cigars from '../data/cigars.json'; // Update path if needed

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
  "content-type": "application/json"
};

// Helper: Simple case-insensitive search
function matchCigar(cigar, query) {
  query = query.toLowerCase();
  return (
    cigar.name?.toLowerCase().includes(query) ||
    cigar.brand?.toLowerCase().includes(query) ||
    (Array.isArray(cigar.flavorNotes) && cigar.flavorNotes.some(note => note.toLowerCase().includes(query)))
  );
}

// Helper: Remove Cubans by simple filter (edit as needed)
function isUS(cigar) {
  if (!cigar.brand) return true;
  const forbidden = ['cohiba', 'montecristo', 'romeo', 'hoyo de monterrey', 'bolivar', 'partagas', 'trinidad', 'ramon allones', 'cuaba', 'quai d\'orsay', 'sancho panza', 'veguero', 'punch', 'por larranaga', 'juan lopez', 'el rey del mundo', 'h.upmann', 'hoyo', 'jose piedra', 'vegueros', 'quintero', 'la gloria cubana', 'diplomaticos'];
  return !forbidden.some(f => cigar.brand.toLowerCase().includes(f));
}

// Fisher-Yates shuffle
function shuffle(arr) {
  let a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });
    }

    const { cigarName } = await req.json();
    if (!cigarName) {
      return new Response(JSON.stringify({ error: "Missing cigar name" }), { status: 400, headers: CORS });
    }

    // Only US-legal cigars
    const usCigars = cigars.filter(isUS);

    // Try direct match by name or brand or flavor notes
    let recs = usCigars.filter(cigar => matchCigar(cigar, cigarName));

    // Shuffle and pick 3
    recs = shuffle(recs).slice(0, 3);

    // Fallback: 3 random US cigars
    if (!recs.length) recs = shuffle(usCigars).slice(0, 3);

    return new Response(JSON.stringify(recs), { status: 200, headers: CORS });
  } catch (err) {
    console.error('Recommend error:', err);
    return new Response(JSON.stringify({ error: "Server error", details: err.message }), { status: 500, headers: CORS });
  }
};
