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
// The same checks run on the generated /uz/ and /en/ copies (LOOM-330), plus:
// a static card name must equal the API name in that page's language.
// Landing pages: see the data-from block below (LOOM-329); JSON-LD offers: LOOM-331.
// Needs the network unless --api points at a saved JSON file. Node 18+.
//
// Usage:
//   node tools/check-static-prices.mjs                       # live API
//   node tools/check-static-prices.mjs --api products.json   # saved response

import { readFileSync, readdirSync } from 'node:fs';
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

const LOCALES = [['', 'ru'], ['uz/', 'uz'], ['en/', 'en']]; // folder, language
const CARD = /<a class="atl-pc" href="\/?product\.html\?slug=([^"]+)">[\s\S]*?<span class="atl-pc-nm"[^>]*>([^<]*)<\/span><span class="atl-pc-pr">([\s\S]*?)<\/span><\/span><\/a>/g;
const errors = [];

for (const [dir, lang] of LOCALES) for (const [page, want] of Object.entries(PAGES)) {
  const file = dir + page;
  const html = readFileSync(join(root, file), 'utf8');
  const cards = [...html.matchAll(CARD)].map((m) => ({
    slug: decodeURIComponent(m[1]), name: m[2], price: Number(m[3].replace(/<[^>]+>|&nbsp;|\D/g, '')),
  }));
  const bySlug = new Map(want.map((p) => [p.slug, p]));
  for (const c of cards) {
    const p = bySlug.get(c.slug);
    if (!p) errors.push(`${file}: "${c.name}" (${c.slug}) is not in the live catalogue`);
    else if (Number(p.price) !== c.price) errors.push(`${file}: "${c.name}" (${c.slug}) static ${c.price} vs API ${p.price}`);
    else if (p[`name_${lang}`] && p[`name_${lang}`].trim() !== c.name) errors.push(`${file}: ${c.slug} static name "${c.name}" vs API name_${lang} "${p[`name_${lang}`]}"`);
    else if (!p[`name_${lang}`]) console.log(`  note: ${c.slug} has no name_${lang} in the API; ${file} shows "${c.name}" from assets/i18n.js`);
  }
  for (const p of want) {
    if (!cards.some((c) => c.slug === p.slug)) errors.push(`${file}: "${p.name_ru}" (${p.slug}) has no static card`);
  }
  console.log(`${file}: ${cards.length} static cards, ${want.length} live`);
}

// Landing pages (LOOM-329): every root page with data-from prices. Each
// <… data-slug="S" data-from="N">…N…</…> must be live price N of product S,
// and every "N сум" amount anywhere in the file (title, description, copy)
// must be one of those prices or the delivery fee.
const DELIVERY = 30000; // site copy: atl.help.a1, privacy.html §4
const bySlugAll = new Map(live.map((p) => [p.slug, p]));
const AMOUNT = /(\d{1,3}(?:(?:&nbsp;|\s)\d{3})+)(?:&nbsp;|\s)*(?:сум|so[‘'ʻ]m|UZS)/g;
const htmlIn = (dir) => readdirSync(join(root, dir)).filter((f) => f.endsWith('.html')).map((f) => dir + f);
for (const file of LOCALES.flatMap(([dir]) => htmlIn(dir))) {
  const html = readFileSync(join(root, file), 'utf8');
  const tags = [...html.matchAll(/data-slug="([^"]+)" data-from="(\d+)">([^<]*)</g)];
  if (!tags.length) continue;
  const allowed = new Set([DELIVERY]);
  for (const [, slug, from, text] of tags) {
    const p = bySlugAll.get(slug);
    if (!p) { errors.push(`${file}: ${slug} is not in the live catalogue`); continue; }
    allowed.add(Number(p.price));
    if (Number(from) !== Number(p.price)) errors.push(`${file}: ${slug} data-from ${from} vs API ${p.price}`);
    if (Number(text.replace(/&nbsp;|\D/g, '')) !== Number(from)) errors.push(`${file}: ${slug} text "${text}" vs data-from ${from}`);
  }
  for (const [, n] of html.matchAll(AMOUNT)) {
    const v = Number(n.replace(/&nbsp;|\D/g, ''));
    if (!allowed.has(v)) errors.push(`${file}: amount ${v} in the page's currency is neither a live price on this page nor delivery`);
  }
  console.log(`${file}: ${tags.length} landing prices`);
}

// JSON-LD (LOOM-331): every block parses, and each Product offer is the live
// price of its sku, in UZS.
for (const file of LOCALES.flatMap(([dir]) => htmlIn(dir))) {
  const html = readFileSync(join(root, file), 'utf8');
  let offers = 0;
  for (const [, json] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let ld;
    try { ld = JSON.parse(json); } catch (e) { errors.push(`${file}: JSON-LD does not parse: ${e.message}`); continue; }
    for (const node of ld['@graph'] || [ld]) {
      if (node['@type'] !== 'Product') continue;
      for (const o of [].concat(node.offers || [])) {
        offers++;
        const p = bySlugAll.get(node.sku);
        if (!p) errors.push(`${file}: JSON-LD Product sku ${node.sku} is not in the live catalogue`);
        else if (Number(o.price) !== Number(p.price)) errors.push(`${file}: JSON-LD ${node.sku} price ${o.price} vs API ${p.price}`);
        if (o.priceCurrency !== 'UZS') errors.push(`${file}: JSON-LD ${node.sku} priceCurrency ${o.priceCurrency}, not UZS`);
      }
    }
  }
  if (offers) console.log(`${file}: ${offers} JSON-LD offer(s)`);
}

if (errors.length) {
  console.error(errors.map((e) => '✗ ' + e).join('\n'));
  process.exit(1);
}
console.log('✓ static cards match the live catalogue');
