// netlify/functions/recommend.js
export default async (req) => {
  try {
    // Allow only POST requests
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Parse request body safely
    let cigar = "";
    try {
      const body = await req.json();
      cigar = (body?.cigar || body?.cigarName || "").trim();
    } catch {
      cigar = "";
    }

    // Require cigar name
    if (!cigar) {
      return new Response(JSON.stringify({ error: "Missing cigar name" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Load local data
    const cigars = await import("../data/cigars.json").then((m) => m.default);
    const brands = await import("../data/brands.json").then((m) => m.default);

    // Fuzzy match: find any cigars whose name contains the input
    const matches = cigars.filter((c) =>
      c.name.toLowerCase().includes(cigar.toLowerCase())
    );

    // Pick from matches if found, otherwise from full DB
    const pool = matches.length ? matches : cigars;

    // Shuffle + pick top 3 recommendations
    const recommendations = pool
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
      .map((cigar) => ({
        ...cigar,
        brandInfo: brands[cigar.brand] || {}
      }));

    // Send response
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

