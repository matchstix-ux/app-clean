// netlify/functions/recommend.js — fully fixed
export default async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" }
      });
    }

    const { cigar, avoid = [] } = await req.json();
    if (!cigar || typeof cigar !== 'string') {
      return new Response(JSON.stringify({ error: "Missing cigar name" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Load local JSON
    const cigars = await import("../../data/cigars.json").then(m => m.default);
    
    // Filter duplicates + fuzzy match
    const seen = new Set(avoid);
    const matches = cigars
      .filter(c => c.name.toLowerCase().includes(cigar.toLowerCase()))
      .filter(c => !seen.has(c.name));

    const pool = matches.length ? matches : cigars.filter(c => !seen.has(c.name));

    // Randomize and limit
    const recommendations = pool
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
      .map(cigar => ({
        ...cigar,
        brandInfo: brands[cigar.brand] || {}
      }));

    return new Response(JSON.stringify({ recommendations }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("Function error:", err);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};
