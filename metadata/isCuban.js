// metadata/isCuban.js
// Helper to determine if a cigar is Cuban.
// Returns true only if we're confident it's Cuban.

export function isCuban(meta = {}) {
  const origin  = (meta.origin || meta.country || meta.country_of_origin || "").trim().toLowerCase();
  const owner   = (meta.brand_owner || meta.owner || "").trim().toLowerCase();
  const factory = (meta.factory || "").trim().toLowerCase();
  const brand   = (meta.brand || "").trim().toLowerCase();
  const name    = (meta.name || meta.line || "").trim().toLowerCase();

  // 1. Clear signals
  if (origin === "cuba" || origin === "cu") return true;
  if (owner.includes("habanos")) return true; // Cuban state distributor

  // 2. Brands with both Cuban & US lines
  const dualMarketBrands = [
    "cohiba", "montecristo", "romeo y julieta", "h. upmann", "h upmann",
    "partagás", "partagas", "trinidad", "bolivar", "punch", "ramon allones",
    "quai d'orsay"
  ];

  const isDual = dualMarketBrands.some(k => brand.includes(k));

  if (isDual) {
    if (origin && origin !== "cuba" && !owner.includes("habanos")) return false;

    const cubanHints = ["el laguito", "partagas factory", "la corona", "habana", "habano"];
    if (cubanHints.some(h => factory.includes(h) || name.includes(h))) return true;

    return false; // keep ambiguous ones
  }

  if (/(habana|habano)/i.test(name)) return true;

  return false;
}
