// ─── Configurator preview share (PRD-215 R-4, LOOM-315) ─────────────────────
//
// Paste into the browser console on configurator.html (any state). Returns the
// share of the screen the garment preview owns, as a whole number:
//
//   100 × (1 − Σ area of visible [data-ov] boxes, clipped to the base ÷ base)
//
// - Base: the viewport (innerWidth × innerHeight). Inside the Telegram Mini App
//   it is the Mini App area: innerWidth × Telegram.WebApp.viewportStableHeight
//   (Telegram's own header and MainButton are outside it, so not counted).
// - Nested overlays count once: a [data-ov] inside another [data-ov] in the
//   DOM, or a box drawn wholly inside another overlay's box (the outer counts).
// - Visible: not [hidden], display/visibility shown, opacity > 0, has a box.
// - Overlays that only partly overlap are summed, as the design (D-12) does.
// - No [data-ov] at all: returns 100 and warns (the page has no overlays, or it
//   is not the Atelye phone configurator).
//
// `cfgPreviewPct.detail` holds the per-overlay boxes of the last run.
// Read-only, no dependencies. Not loaded by any page.
(() => {
  const all = [...document.querySelectorAll('[data-ov]')];
  const run = () => {
    if (!all.length) {
      console.warn('cfg-preview-pct: no [data-ov] element on this page');
      return 100;
    }
    const tg = window.Telegram && window.Telegram.WebApp;
    // The SDK reports platform 'unknown' outside a Telegram client.
    const inTg = !!(tg && tg.platform && tg.platform !== 'unknown');
    const W = innerWidth;
    const H = inTg && tg.viewportStableHeight ? tg.viewportStableHeight : innerHeight;
    const shown = (e) => {
      for (let n = e; n && n !== document.documentElement; n = n.parentElement) {
        if (n.hidden) return false;
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
      }
      return e.getClientRects().length > 0;
    };
    const boxes = [];
    for (const e of all) {
      if (e.parentElement.closest('[data-ov]') || !shown(e)) continue;
      const r = e.getBoundingClientRect();
      const b = { id: e.id || e.className, l: Math.max(r.left, 0), t: Math.max(r.top, 0), r: Math.min(r.right, W), b: Math.min(r.bottom, H) };
      if (b.r > b.l && b.b > b.t) boxes.push(b);
    }
    // A box drawn wholly inside another (e.g. the model credit in the top row)
    // is nested on screen even when not in the DOM: count it once.
    const inside = (a, o) => a !== o && a.l >= o.l && a.t >= o.t && a.r <= o.r && a.b <= o.b;
    const detail = [];
    let area = 0;
    for (const [i, b] of boxes.entries()) {
      // Two equal boxes are inside each other: keep the first.
      if (boxes.some((o, j) => inside(b, o) && !(inside(o, b) && j > i))) continue;
      const w = b.r - b.l, h = b.b - b.t;
      area += w * h;
      detail.push({ id: b.id, w: Math.round(w), h: Math.round(h) });
    }
    window.cfgPreviewPct = { detail, base: [W, Math.round(H)], telegram: inTg };
    return Math.round(100 * (1 - area / (W * H)));
  };
  const pct = run();
  if (window.cfgPreviewPct) window.cfgPreviewPct.pct = pct;
  return pct;
})();
