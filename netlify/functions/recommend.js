// netlify/functions/recommend.js
export default async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" }
      });
    }

    const { cigarName } = await req.json();
    if (!cigarName) {
      return new Response(JSON.stringify({ error: "Missing cigar name" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Load local JSON
    const cigars = await import("../data/cigars.json").then(m => m.default);
    const brands = await import("../data/brands.json").then(m => m.default);

    // Simple fuzzy match
    const matches = cigars.filter(c =>
      c.name.toLowerCase().includes(cigarName.toLowerCase())
    );

    const recommendations = (matches.length ? matches : cigars)
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
