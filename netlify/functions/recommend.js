// netlify/functions/recommend.js
export default async (req) => {
  try {
    // Only allow POST
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Parse incoming JSON safely
    let cigar = "";
    try {
      const body = await req.json();
      cigar = (body?.cigar || "").trim();
    } catch {
      cigar = "";
    }

    // Handle missing cigar name
    if (!cigar) {
      return new Response(JSON.stringify({ error: "Missing cigar name" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Load local JSON data
    const cigars = await import("../data/cigars.json").then((m) => m.default);
    const brands = await import("../data/brands.json").then((m) => m.default);

    // Simple fuzzy match by cigar name
    const matches = cigars.filter((c) =>
      c.name.toLowerCase().includes(cigar.toLowerCase())
    );

    // Choose pool: exact matches if any, otherwise whole DB
    const pool = matches.length ? matches : cigars;

    // Shuffle + pick top 3 recs
    const recommendations = pool
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
      .map((cigar) => ({
        ...cigar,
        brandInfo: brands[cigar.brand] || {}
      }));

    // Respond with recommendations
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

