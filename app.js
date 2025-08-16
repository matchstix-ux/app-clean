document.addEventListener('DOMContentLoaded', () => {
  const $ = (sel) => document.querySelector(sel);
  const form = $("#searchForm");
  const input = $("#query");
  const results = $("#results");
  const cards = $("#cards");
  const statusEl = $("#status");
  const API_URL = "/.netlify/functions/recommend";

  const getSeen = () => { try { return JSON.parse(localStorage.getItem("seenCigars")||"[]"); } catch { return []; } };
  const setSeen = (arr) => { const t = Array.from(new Set(arr)).slice(-50); localStorage.setItem("seenCigars", JSON.stringify(t)); };

  function setBusy(busy, msg="") { form?.querySelector("button") && (form.querySelector("button").disabled = busy); if (statusEl) statusEl.textContent = msg; }
  function dotBar(strength) { const bar = document.createElement("div"); bar.className="bar"; for (let i=1;i<=10;i++){ const d=document.createElement("div"); d.className="dot"+(i<=(strength||5)?" on":""); bar.appendChild(d);} return bar; }
  function cardEl(rec){ const card=document.createElement("article"); card.className="card";
    const h3=document.createElement("h3"); h3.textContent=rec.name||"Unknown cigar"; card.appendChild(h3);
    if (rec.brand){ const b=document.createElement("div"); b.className="brandline"; b.textContent=rec.brand; card.appendChild(b); }
    const s=document.createElement("div"); s.className="strength"; s.textContent="Strength"; card.appendChild(s);
    card.appendChild(dotBar(rec.strength));
    if (rec.priceRange){ const pr=document.createElement("span"); pr.className="badge"; pr.textContent=rec.priceRange; card.appendChild(pr); }
    if (Array.isArray(rec.flavorNotes) && rec.flavorNotes.length){ const wrap=document.createElement("div"); wrap.className="notes";
      rec.flavorNotes.forEach(n=>{ const chip=document.createElement("span"); chip.className="note"; chip.textContent=String(n||"").replace(/^Why Similar:\s*/i,"").replace(/^Key Differences?:\s*/i,"").trim(); wrap.appendChild(chip); });
      card.appendChild(wrap);
    } return card; }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = input?.value?.trim(); if (!q) return;
    setBusy(true, "Finding great matches…");
    try {
      const avoid = getSeen();
      const res = await fetch(API_URL, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ cigar: q, avoid }) });
      const data = await res.json().catch(()=>({}));
      const list = Array.isArray(data?.recommendations) ? data.recommendations : [];
      // update seen list to discourage repeats
      const newNames = list.map(r => String(r?.name||"")).filter(Boolean);
      setSeen([...avoid, ...newNames]);
      cards.innerHTML = ""; list.forEach(r => cards.appendChild(cardEl({
        name: r.name, brand: r.brand, priceRange: r.priceRange,
        strength: Math.max(1, Math.min(10, parseInt(r.strength,10) || 5)),
        flavorNotes: Array.isArray(r.flavorNotes) ? r.flavorNotes : []
      })));
      \1
      // Analytics: count searches (privacy-friendly)
      try { if (window.plausible) window.plausible("search", { props: { q } }); } catch {}

      setBusy(false, list.length ? `Found ${list.length} recommendations.` : "No recommendations found.");
    } catch (err) {
      console.error(err);
      results && (results.hidden = true);
      setBusy(false, "Sorry — something went wrong.");
    }
  });
});
