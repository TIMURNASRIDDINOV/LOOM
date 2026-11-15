#!/usr/bin/env node
// ─── Static pages per language (LOOM-330) ───────────────────────────────────
//
// The site has no build step, and the language used to live only in the
// browser (assets/i18n.js swaps data-i18n text on the same URL), so crawlers
// never saw Uzbek or English. This script writes the text into the HTML:
//
//   <page>.html      Russian, the source. Rewritten in place: lang="ru",
//                    Russian text in every data-i18n node, head tags and the
//                    hreflang set. Markup, styles and scripts are edited here.
//   uz/<page>.html   generated copy in Uzbek   — never edit by hand
//   en/<page>.html   generated copy in English — never edit by hand
//   sitemap.xml      one <url> per language version, with xhtml:link alternates
//
// One dictionary: every string comes from assets/i18n.js, including titles
// and descriptions (seo.<page>.title / seo.<page>.desc). The page list is
// PAGES in assets/i18n.js. A key that lacks ru, uz or en fails the run and
// is named; so does Russian text left in a uz/en page.
//
// Generated pages carry <base href="/"> (scripts build asset URLs relative to
// the root) and root-absolute URLs in the HTML; links to pages in PAGES point
// to the same language.
//
// No dependencies, no network. Node 18+.
//
// Usage:
//   node tools/build-locales.mjs           # write the files
//   node tools/build-locales.mjs --check   # CI: fail when a file on disk is stale

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const ORIGIN = 'https://loomdesign.uz';
const LANGS = ['ru', 'uz', 'en']; // ru first: it is the source and x-default
const OG_LOCALE = { ru: 'ru_RU', uz: 'uz_UZ', en: 'en_US' };
// Cyrillic that may stay in a uz/en page (none today; brand or proper nouns only).
const CYRILLIC_OK = new Set([]);

// ── the dictionary: run assets/i18n.js with a stub browser ──────────────────
const win = {};
vm.runInNewContext(readFileSync(join(root, 'assets/i18n.js'), 'utf8'), {
  window: win,
  location: { pathname: '/', search: '', hash: '' },
  document: { readyState: 'complete', documentElement: { setAttribute() {} }, querySelectorAll: () => [], addEventListener() {} },
});
const I18N = win.LOOM_I18N;
const PAGES = I18N.PAGES;

const errors = new Set();
const fail = (m) => errors.add(m);

function t(key, lang) {
  const entry = I18N.entry(key);
  // every language is checked on every run, whichever one is being written
  for (const l of LANGS) {
    if (!entry || typeof entry[l] !== 'string' || !entry[l].trim()) fail(`missing translation: ${key} [${l}]`);
  }
  return (entry && entry[lang]) || '';
}

const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');
const pageUrl = (page, lang) => (lang === 'ru' ? '/' : `/${lang}/`) + (page === 'index' ? '' : page);

// "265 000 so‘m" with non-breaking thousands, as the pages write prices
const money = (n, lang) => String(n).replace(/\B(?=(\d{3})+$)/g, '&nbsp;') + ' ' + escText(t('cfg.currency', lang));

// Set one head tag. `re` has two groups around the value.
function setTag(html, re, value, what, file, optional) {
  if (!re.test(html)) {
    if (!optional) fail(`${file}: no ${what} tag in <head>`);
    return html;
  }
  return html.replace(re, (_, a, b) => a + value + b);
}

function render(page, lang) {
  const file = `${page}.html`;
  let html = readFileSync(join(root, file), 'utf8');
  const self = ORIGIN + pageUrl(page, lang);

  // JSON-LD first (it is a <script>, masked below)
  html = html.replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g, (_, a, json, b) => a + json
    .replace(/("inLanguage": ")[^"]*(")/g, (_m, x, y) => x + lang + y)
    .replace(/("description": ")[^"]*(")/g, (_m, x, y) => x + JSON.stringify(t('seo.org.desc', lang)).slice(1, -1) + y) + b);

  // inline scripts, styles and comments are not markup to translate
  // (<script src> stays: its URL is rewritten below)
  const masked = [];
  html = html.replace(/<script\b(?![^>]*\ssrc=)[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, (m) => {
    masked.push(m);
    return `\u0000${masked.length - 1}\u0000`;
  });

  // ── text ──
  // ponytail: regex, not an HTML parser. Holds while a data-i18n node has only
  // text inside and attributes use double quotes; the count check below fails
  // the run when a page breaks that, so it cannot go wrong silently.
  if (/\sdata-i18n-html=/.test(html)) fail(`${file}: data-i18n-html is not supported by tools/build-locales.mjs`);
  html = html.replace(/<[a-zA-Z][^>]*\sdata-i18n-attr="([^"]*)"[^>]*>/g, (tag, spec) => {
    for (const pair of spec.split(';').map((s) => s.trim()).filter(Boolean)) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      const re = new RegExp(`(\\s${attr}=")[^"]*(")`);
      if (!re.test(tag)) { fail(`${file}: ${key} sets ${attr}, which the tag does not have`); continue; }
      const value = escAttr(t(key, lang));
      tag = tag.replace(re, (_, a, b) => a + value + b);
    }
    return tag;
  });
  let nodes = 0;
  html = html.replace(/(<([a-zA-Z0-9]+)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>)[^<]*(<\/\2>)/g, (_, open, _tag, key, close) => {
    nodes++;
    return open + escText(t(key, lang)) + close;
  });
  const want = (html.match(/\sdata-i18n="/g) || []).length;
  if (nodes !== want) fail(`${file}: ${want - nodes} data-i18n node(s) hold markup, not plain text`);
  // "from <price>" lines (landing pages); the number stays the static data-from
  html = html.replace(/(data-slug="[^"]+" data-from="(\d+)">)[^<]*</g, (_, open, n) =>
    open + escText(t('atl.land.from', lang)).replace('{price}', money(n, lang)) + '<');
  // phone top bar title (assets/shell.js reads data-title)
  html = html.replace(/(<body\b[^>]*\sdata-title=")[^"]*("[^>]*\sdata-title-key="([^"]+)")/, (_, a, b, key) => a + escAttr(t(key, lang)) + b);

  // ── head ──
  const title = t(`seo.${page}.title`, lang);
  const desc = escAttr(t(`seo.${page}.desc`, lang));
  html = html.replace(/<html lang="[^"]*"/, `<html lang="${lang}"`);
  html = setTag(html, /(<title>)[^<]*(<\/title>)/, escText(title), 'title', file);
  html = setTag(html, /(<meta name="description" content=")[^"]*(")/, desc, 'description', file);
  html = setTag(html, /(<meta property="og:title" content=")[^"]*(")/, escAttr(title), 'og:title', file);
  html = setTag(html, /(<meta property="og:description" content=")[^"]*(")/, desc, 'og:description', file);
  html = setTag(html, /(<meta property="og:url" content=")[^"]*(")/, self, 'og:url', file);
  html = setTag(html, /(<meta name="twitter:title" content=")[^"]*(")/, escAttr(title), 'twitter:title', file, true);
  html = setTag(html, /(<meta name="twitter:description" content=")[^"]*(")/, desc, 'twitter:description', file, true);
  html = html.replace(/^[ \t]*<meta property="og:locale" content="[^"]*" \/>\n/m, '');
  html = setTag(html, /(<meta property="og:site_name" content="LOOM" \/>\n)()/, `  <meta property="og:locale" content="${OG_LOCALE[lang]}" />\n`, 'og:site_name', file);
  html = html.replace(/^[ \t]*<link rel="alternate" hreflang="[^"]*" href="[^"]*" \/>\n/gm, '');
  const alternates = [...LANGS.map((l) => [l, l]), ['x-default', 'ru']]
    .map(([code, l]) => `  <link rel="alternate" hreflang="${code}" href="${ORIGIN}${pageUrl(page, l)}" />\n`).join('');
  html = setTag(html, /(<link rel="canonical" href=")[^"]*(" \/>\n)/, self, 'canonical', file);
  html = html.replace(/(<link rel="canonical" href="[^"]*" \/>\n)/, (m) => m + alternates);

  if (lang !== 'ru') {
    // ── URLs: the file lives one folder down ──
    html = html.replace(/(\s(?:href|src|data-back)=")([^"]*)(")/g, (m, a, raw, b) => {
      if (!raw || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(raw)) return m;
      const [, path, rest] = /^\/?([^?#]*)(.*)$/.exec(raw);
      const name = path.replace(/\.html$/, '') || 'index';
      const isPage = PAGES.includes(name) && !/\.(?!html$)[a-z0-9]+$/i.test(path);
      return a + (isPage ? pageUrl(name, lang) : '/' + path) + rest + b;
    });
    html = html.replace(/(<meta charset="[^"]*" \/>\n)/, (m) => m + '  <base href="/" />\n');
    html = html.replace(/^(<!DOCTYPE html>\n)/i, (m) => m +
      `<!-- GENERATED by tools/build-locales.mjs from /${file} and assets/i18n.js. Do not edit: change those and run the script. -->\n`);
    if (!html.includes('<base href="/" />')) fail(`${file}: no <meta charset> line to put <base> after`);
    // no Russian left behind
    const left = (html.replace(/\u0000\d+\u0000/g, '').match(/[^\s<>"]*[А-Яа-яЁё][^\s<>"]*/g) || []).filter((w) => !CYRILLIC_OK.has(w));
    if (left.length) fail(`${lang}/${file}: ${left.length} Russian word(s) with no translation key, e.g. "${left.slice(0, 6).join(' ')}"`);
  }

  return html.replace(/\u0000(\d+)\u0000/g, (_, i) => masked[+i]);
}

// ── sitemap: one <url> per language version, alternates on each ─────────────
function sitemap() {
  let xml = readFileSync(join(root, 'sitemap.xml'), 'utf8');
  xml = xml.replace(/<urlset [^>]*>/, '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">');
  const seen = new Set();
  xml = xml.replace(/  <url>\n[\s\S]*?  <\/url>\n/g, (block) => {
    const loc = /<loc>([^<]*)<\/loc>/.exec(block)[1];
    if (/^\/(uz|en)(\/|$)/.test(loc.slice(ORIGIN.length))) return ''; // rebuilt from its ru entry
    const page = loc.slice(ORIGIN.length + 1) || 'index';
    if (!PAGES.includes(page)) return block;
    seen.add(page);
    const alternates = [...LANGS.map((l) => [l, l]), ['x-default', 'ru']]
      .map(([code, l]) => `    <xhtml:link rel="alternate" hreflang="${code}" href="${ORIGIN}${pageUrl(page, l)}" />\n`).join('');
    const rest = block.replace(/^\s*<xhtml:link [^\n]*\n/gm, '');
    return LANGS.map((l) => rest
      .replace(/<loc>[^<]*<\/loc>/, `<loc>${ORIGIN}${pageUrl(page, l)}</loc>`)
      .replace(/  <\/url>\n$/, alternates + '  </url>\n')).join('');
  });
  for (const page of PAGES) if (!seen.has(page)) fail(`sitemap.xml: no <url> for ${ORIGIN}${pageUrl(page, 'ru')}`);
  return xml;
}

// ── run ─────────────────────────────────────────────────────────────────────
const out = new Map(); // path relative to the repo root -> content
for (const page of PAGES) {
  for (const lang of LANGS) out.set(lang === 'ru' ? `${page}.html` : `${lang}/${page}.html`, render(page, lang));
}
out.set('sitemap.xml', sitemap());

if (errors.size) {
  console.error([...errors].sort().map((e) => '✗ ' + e).join('\n'));
  console.error(`\n${errors.size} problem(s). Nothing was written.`);
  process.exit(1);
}

const stale = [];
for (const [file, content] of out) {
  const path = join(root, file);
  if (existsSync(path) && readFileSync(path, 'utf8') === content) continue;
  stale.push(file);
  if (!check) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}
// a page dropped from PAGES must not stay online
for (const lang of LANGS.slice(1)) {
  const dir = join(root, lang);
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    if (!out.has(`${lang}/${f}`)) { stale.push(`${lang}/${f} (not in PAGES: delete it)`); }
  }
}

if (check && stale.length) {
  console.error(stale.map((f) => '✗ stale: ' + f).join('\n'));
  console.error('\nRun `node tools/build-locales.mjs` and commit the result.');
  process.exit(1);
}
console.log(`${check ? '✓ up to date' : stale.length ? '✓ wrote ' + stale.length + ' file(s)' : '✓ nothing to change'}: ` +
  `${PAGES.length} pages × ${LANGS.length} languages + sitemap.xml`);
if (!check) for (const f of stale) console.log('  ' + f);
