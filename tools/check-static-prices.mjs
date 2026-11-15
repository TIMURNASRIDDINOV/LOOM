#!/usr/bin/env node
// ─── Static product cards vs the live catalogue (LOOM-328) ─────────────────
//
// catalog.html and index.html ship the on-sale garments as static cards so
// crawlers that do not run JS see names, prices and links. JS replaces them
// with live data, but a crawler keeps whatever the HTML says. This check
// fails when the static cards drift from GET /api/products:
//
//   - a static price differs from the API price;
//   - a static card names a product the API does not list (not on sale);
//   - a product the page shows live has no static card.
//
// The server stays the source of prices; the static cards are display only.
// Needs the network unless --api points at a saved JSON file. Node 18+.
//
// Usage:
//   node tools/check-static-prices.mjs                       # live API
//   node tools/check-static-prices.mjs --api products.json   # saved response

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const i = process.argv.indexOf('--api');
const src = i > 0 ? process.argv[i + 1] : 'https://api.loomdesign.uz/api/products';

const data = /^https?:/.test(src)
  ? await (await fetch(src)).json()
  : JSON.parse(readFileSync(src, 'utf8'));
const live = (data.products || []).filter((p) => p.active !== false && p.active !== 0);

// What each page renders with JS: catalog = every product (products-catalog.js),
// home = garments only, first 6 (assets/home.js loadGarments).
const PAGES = {
  'catalog.html': live,
  'index.html': live.filter((p) => (p.product_type || 'custom') !== 'ready').slice(0, 6),
};

const CARD = /<a class="atl-pc" href="product\.html\?slug=([^"]+)">[\s\S]*?<span class="atl-pc-nm">([^<]*)<\/span><span class="atl-pc-pr">([\s\S]*?)<\/span><\/span><\/a>/g;
const errors = [];

for (const [file, want] of Object.entries(PAGES)) {
  const html = readFileSync(join(root, file), 'utf8');
  const cards = [...html.matchAll(CARD)].map((m) => ({
    slug: decodeURIComponent(m[1]), name: m[2], price: Number(m[3].replace(/<[^>]+>|&nbsp;|\D/g, '')),
  }));
  const bySlug = new Map(want.map((p) => [p.slug, p]));
  for (const c of cards) {
    const p = bySlug.get(c.slug);
    if (!p) errors.push(`${file}: "${c.name}" (${c.slug}) is not in the live catalogue`);
    else if (Number(p.price) !== c.price) errors.push(`${file}: "${c.name}" (${c.slug}) static ${c.price} vs API ${p.price}`);
  }
  for (const p of want) {
    if (!cards.some((c) => c.slug === p.slug)) errors.push(`${file}: "${p.name_ru}" (${p.slug}) has no static card`);
  }
  console.log(`${file}: ${cards.length} static cards, ${want.length} live`);
}

if (errors.length) {
  console.error(errors.map((e) => '✗ ' + e).join('\n'));
  process.exit(1);
}
console.log('✓ static cards match the live catalogue');
