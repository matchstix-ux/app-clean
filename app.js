// app.js — works with IDs: searchForm, query, results, cards, status
// Calls /.netlify/functions/recommend with { cigar, avoid }
// Tracks seen cigars in localStorage to reduce repeats
// Fires Plausible "search" event if available

document.addEventListener('DOMContentLoaded', () => {
  const $ = (sel) => document.querySelector(sel);

  const form     = $('#searchForm');
  const input    = $('#query');
  const results  = $('#results');
  const cards    = $('#cards');
  const statusEl = $('#status');

  const API_URL = '/.netlify/functions/recommend';

  const getSeen = () => {
    try { return JSON.parse(localStorage.getItem('seenCigars') || '[]'); }
    catch { return []; }
  };

  const setSeen = (arr) => {
    const unique = Array.from(new Set(arr)).slice(-50);
    localStorage.setItem('seenCigars', JSON.stringify(unique));
  };

  const setBusy = (busy, msg = '') => {
    const btn = form?.querySelector('button');
    if (btn) btn.disabled = busy;
    if (statusEl) statusEl.textContent = msg;
  };

  const dotBar = (strength) => {
    const bar = document.createElement('div');
    bar.className = 'bar';
    const s = Math.max(1, Math.min(10, parseInt(strength, 10) || 5));
    for (let i = 1; i <= 10; i++) {
      const d = document.createElement('div');
      d.className = 'dot' + (i <= s ? ' on' : '');
      bar.appendChild(d);
    }
    return bar;
  };

  const cleanText = (s) =>
    String(s ?? '')
      .replace(/^Why Similar:\s*/i, '')
      .replace(/^Key Differences?:\s*/i, '')
      .trim();

  const cardEl = (rec) => {
    const card = document.createElement('article');
    card.className = 'card';

    const h3 = document.createElement('h3');
    h3.textContent = cleanText(rec.name) || 'Unknown cigar';
    card.appendChild(h3);

    if (rec.brand) {
      const brand = document.createElement('div');
      brand.className = 'brandline';
      brand.textContent = cleanText(rec.brand);
      card.appendChild(brand);
    }

    const s = document.createElement('div');
    s.className = 'strength';
    s.textContent = 'Strength';
    card.appendChild(s);
    card.appendChild(dotBar(rec.strength));

    if (rec.priceRange) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = cleanText(rec.priceRange);
      card.appendChild(badge);
    }

    if (Array.isArray(rec.flavorNotes) && rec.flavorNotes.length) {
      const wrap = document.createElement('div');
      wrap.className = 'notes';
      rec.flavorNotes.forEach((n) => {
        const chip = document.createElement('span');
        chip.className = 'note';
        chip.textContent = cleanText(n);
        if (chip.textContent) wrap.appendChild(chip);
      });
      card.appendChild(wrap);
    }

    return card;
  };

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const q = input?.value?.trim();
    if (!q) {
      setBusy(false, 'Please enter a cigar name.');
      return;
    }

    setBusy(true, 'Finding great matches…');

    try {
      const avoid = getSeen();

      console.log("DEBUG — Sending to API:", { cigar: q, avoid }); // <-- added for verification

      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cigar: q, avoid }) // ✅ always sends 'cigar'
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(txt || res.statusText);
      }

      const data = await res.json().catch(() => ({}));
      console.log('DEBUG — API response:', data); // <-- added for troubleshooting

      const list = Array.isArray(data?.recommendations) ? data.recommendations : [];

      // Update 'seen' so the next request will avoid these
      const newNames = list.map((r) => String(r?.name || '')).filter(Boolean);
      setSeen([...avoid, ...newNames]);

      // Render results
      cards.innerHTML = '';
      list.forEach((r) =>
        cards.appendChild(
          cardEl({
            name: r.name,
            brand: r.brand,
            priceRange: r.priceRange,
            strength: r.strength,
            flavorNotes: Array.isArray(r.flavorNotes) ? r.flavorNotes : []
          })
        )
      );

      if (results) results.hidden = list.length === 0;

      // Analytics (optional; safe no-op if Plausible isn’t present)
      try {
        if (window.plausible) window.plausible('search', { props: { q } });
      } catch {}

      setBusy(false, list.length ? `Found ${list.length} recommendations.` : 'No recommendations found.');
    } catch (err) {
      console.error('Search error:', err);
      if (results) results.hidden = true;
      setBusy(false, 'Sorry — something went wrong.');
    }
  });
});
