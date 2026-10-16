#!/usr/bin/env node
// ─── Asset ?v= drift gate ───────────────────────────────────────────────────
//
// `_headers` serves /assets/*, /admin/assets/* and the root bundles
// (configurator.js, products-catalog.js, products-catalog.css) `immutable` for
// a year. The ?v= query string is part of the browser cache key, so it is the
// only thing that ships a change to those files. Two ways to get that wrong,
// both silent in production:
//
//   1. one asset referenced with different ?v= values in different HTML files
//      — the pages with the lower number keep serving the old file for a year;
//   2. an asset edited without bumping its ?v= anywhere — returning visitors
//      keep the old copy for a year.
//
// This gate fails on either, and also when an immutably cached asset is
// referenced from HTML with no ?v= at all (there is nothing to bump).
//
// No dependencies, read-only, no network. Node 18+.
//
// Usage:
//   node tools/check-asset-versions.mjs                       # base: origin/main
//   node tools/check-asset-versions.mjs --base main
//   node tools/check-asset-versions.mjs --base "$BASE_SHA"     # CI: the PR base
//
// Scanned surfaces (LOOM-150): every site HTML file (the repo root, admin/,
// auth/), plus the refs embedded in the root bundles and in
// mobile/src/lib/scene-html.ts — the file that wraps the same vendor scripts as
// configurator.js, so the two can drift apart with no HTML involved.
//
// The base is the commit the branch started from: the comparison is the merge
// base, so commits that landed on main after the branch was cut are not this
// branch's problem. In CI the workflow passes the PR base sha; locally
// `origin/main` (the default) is the honest choice.
//
// Exit codes: 0 all checks pass · 1 a check failed · 2 setup problem (not a git
// checkout, unknown argument, base ref missing, nothing to check).

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// ─── git plumbing ───────────────────────────────────────────────────────────

let repoRoot
try {
  repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
} catch {
  console.error('FAIL  not a git checkout — run this from the LOOM repository')
  process.exit(2)
}

const git = (...args) =>
  execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

const hasRef = (ref) => {
  try {
    git('rev-parse', '--verify', '--quiet', ref)
    return true
  } catch {
    return false
  }
}

// ─── arguments ──────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
let base = null

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]
  if (arg === '--base') base = argv[++i] ?? null
  else if (arg.startsWith('--base=')) base = arg.slice('--base='.length)
  else if (arg === '--help' || arg === '-h') {
    console.log('Usage: node tools/check-asset-versions.mjs [--base <git-ref>]')
    console.log('  --base   commit/ref to compare against (default: origin/main, then main)')
    process.exit(0)
  } else {
    console.error(`FAIL  unknown argument: ${arg} (try --help)`)
    process.exit(2)
  }
}

if (!base) base = ['origin/main', 'main'].find(hasRef) ?? null

if (!base) {
  console.error('FAIL  no base ref — this checkout has neither origin/main nor main')
  console.error('      run `git fetch origin main` first, or pass --base <ref>')
  process.exit(2)
}

if (!hasRef(base)) {
  console.error(`FAIL  base ref not found: ${base}`)
  console.error('      run `git fetch origin main` first, or pass --base <ref>')
  process.exit(2)
}

// The merge base is what the branch actually changed. A shallow CI checkout
// cannot compute one; there the PR base sha *is* the branch point, so diffing
// it directly is the same comparison.
let baseCommit = base
let baseIsMergeBase = false
try {
  const mb = git('merge-base', base, 'HEAD').trim()
  if (mb) {
    baseCommit = mb
    baseIsMergeBase = mb !== base
  }
} catch {
  /* shallow clone: fall back to the ref itself */
}

// ─── the immutable cache contract, read from _headers ───────────────────────
//
// Read rather than hard-coded: if a new bundle gains `immutable` in _headers,
// this gate starts requiring a ?v= for it too, with no second place to edit.

function immutablePatternsFromHeaders() {
  let text
  try {
    text = fs.readFileSync(path.join(repoRoot, '_headers'), 'utf8')
  } catch {
    return []
  }
  const patterns = []
  let current = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (!/^\s/.test(rawLine)) {
      current = line // a rule block starts with its path pattern in column 0
      continue
    }
    if (current && /^cache-control\s*:/i.test(line) && /\bimmutable\b/i.test(line)) {
      patterns.push(current)
    }
  }
  return patterns
}

const immutablePatterns = immutablePatternsFromHeaders()

if (immutablePatterns.length === 0) {
  console.error('FAIL  no `Cache-Control: … immutable` rules found in _headers')
  console.error('      this gate cannot tell which assets are versioned — fix _headers first')
  process.exit(2)
}

const isImmutable = (asset) => {
  const sitePath = `/${asset}`
  return immutablePatterns.some((pattern) =>
    pattern.endsWith('/*') ? sitePath.startsWith(pattern.slice(0, -1)) : sitePath === pattern,
  )
}

// ─── HTML scanning ──────────────────────────────────────────────────────────

const SUBPROJECT_PACKAGE = path.posix.basename('package.json')
// ─── refs embedded in JS / TS ───────────────────────────────────────────────
//
// HTML is not the only place a versioned reference lives. mobile/src/lib/
// scene-html.ts builds `${SITE_ORIGIN}/assets/vendor/${f}?v=1` over a VENDOR
// list — the same files configurator.js loads as THREE_CHUNKS — so the two can
// disagree while every HTML file is consistent. A reference inside such a
// template counts once per listed file (A-2).

const EMBEDDED_SOURCE = /\.(?:js|mjs|cjs|jsx|ts|tsx)$/i
const EMBEDDED_ALWAYS = ['mobile/src/lib/scene-html.ts']
const NOT_SITE = /^(?:tools|docs|\.github|node_modules)\//
const EMBEDDED_EXT = new Set([
  'js', 'mjs', 'cjs', 'css', 'glb', 'gltf',
  'jpg', 'jpeg', 'png', 'webp', 'avif', 'svg', 'woff', 'woff2', 'ttf',
])
// A list literal feeding a `.map((f) => ...)` — the VENDOR shape of A-2.
const LIST_LITERAL =
  /\[\s*((?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*(?:,\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*)*,?)\s*\]\s*\.map\(\s*\(?\s*([A-Za-z_$][\w$]*)/g
// `<origin interpolation>?<path>?v=<n>`, the path possibly interpolated.
const EMBEDDED_REF =
  /(?:\$\{[A-Za-z_$][\w$.]*\}\/)?((?:[A-Za-z0-9_./-]|\$\{[A-Za-z_$][\w$.]*\})+?)(?:\.([A-Za-z0-9]+))?\?v=(\d+)/g

const scannedEmbedded = new Set()
const skippedTemplateRefs = new Set()

const embeddedRefFiles = (files, dirs) =>
  files
    .filter(
      (file) =>
        EMBEDDED_SOURCE.test(file) &&
        !NOT_SITE.test(file) &&
        (EMBEDDED_ALWAYS.includes(file) || !inSubproject(file, dirs)),
    )
    .sort()

function scanEmbedded(text, file) {
  const lists = new Map() // map-param name -> the literals it iterates
  for (const m of text.matchAll(LIST_LITERAL)) {
    const items = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1])
    if (items.length) lists.set(m[2], items)
  }

  const refs = []
  for (const m of text.matchAll(EMBEDDED_REF)) {
    const [, template, ext, version] = m
    if (ext && !EMBEDDED_EXT.has(ext.toLowerCase())) continue
    if (template.startsWith('//')) continue // an absolute URL, not a site asset
    const names = [...template.matchAll(/\$\{([A-Za-z_$][\w$.]*)\}/g)].map((x) => x[1])
    const unknown = names.filter((name) => !lists.has(name))
    if (unknown.length) {
      // Rather than guess what the interpolation holds, say so: a silent skip
      // is how a gate stops being a gate.
      skippedTemplateRefs.add(`${file}: ${template} (${unknown.join(', ')} is not a literal list)`)
      continue
    }
    let paths = [template]
    for (const name of names) {
      paths = paths.flatMap((p) => lists.get(name).map((item) => p.split('${' + name + '}').join(item)))
    }
    for (const p of paths) {
      // The extension is either the literal one after the path or, for
      // `assets/vendor/${f}`, part of what the interpolation expands to.
      const concrete = ext ? `${p}.${ext}` : p
      const tail = /\.([A-Za-z0-9]+)$/.exec(concrete)
      if (!tail || !EMBEDDED_EXT.has(tail[1].toLowerCase())) continue
      const asset = path.posix.normalize(concrete.replace(/^\/+/, ''))
      if (!asset || asset.startsWith('..')) continue
      refs.push({ asset, file, v: Number(version) })
    }
  }
  return refs
}

// The same bookkeeping collect() does for HTML, so one asset seen from HTML and
// from a bundle lands in one map — which is what AC-1 asks for.
function recordRef(tree, { asset, file, v }) {
  if (!tree.versioned.has(asset)) tree.versioned.set(asset, new Map())
  const versions = tree.versioned.get(asset)
  if (!versions.has(v)) versions.set(v, new Set())
  versions.get(v).add(file)

  if (!tree.byAsset.has(asset)) tree.byAsset.set(asset, new Map())
  tree.byAsset.get(asset).set(file, v)
}

function withEmbeddedRefs(tree, files, dirs, read) {
  for (const file of embeddedRefFiles(files, dirs)) {
    let text
    try {
      text = read(file)
    } catch {
      continue // not present in this tree (renamed or removed)
    }
    scannedEmbedded.add(file)
    for (const ref of scanEmbedded(text, file)) recordRef(tree, ref)
  }
  return tree
}

const ATTR = /(?:^|\s)(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
const COMMENT = /<!--[\s\S]*?-->/g
const VERSION = /(?:^|&)v=(\d+)(?:&|$)/

const listFiles = (ref) =>
  (ref === null
    ? git('ls-files', '--cached', '--others', '--exclude-standard')
    : git('ls-tree', '-r', '--name-only', ref)
  )
    .split('\n')
    .filter(Boolean)

// A directory holding its own package.json is a separate project (backend,
// cloudflare-worker, mobile, tools/glb-inspect) — its files are not the site.
const subprojectDirs = (files) => {
  const dirs = new Set()
  for (const file of files) {
    if (path.posix.basename(file) === SUBPROJECT_PACKAGE) {
      const dir = path.posix.dirname(file)
      if (dir !== '.') dirs.add(dir)
    }
  }
  return dirs
}

const inSubproject = (file, dirs) => [...dirs].some((dir) => file.startsWith(`${dir}/`))

const htmlFiles = (files, dirs) =>
  files.filter((file) => file.endsWith('.html') && !inSubproject(file, dirs)).sort()

function scanHtml(html, file) {
  const dir = path.posix.dirname(file)
  const found = { versioned: [], unversioned: [] }

  for (const match of html.replace(COMMENT, '').matchAll(ATTR)) {
    const raw = (match[1] ?? match[2] ?? '').trim()
    // Skip anything the browser does not resolve against this site.
    if (!raw || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(raw)) continue

    const cut = raw.search(/[?#]/)
    const pathPart = cut === -1 ? raw : raw.slice(0, cut)
    if (!/\.(?:js|css)$/i.test(pathPart)) continue

    const asset = path.posix.normalize(
      pathPart.startsWith('/') ? pathPart.slice(1) : path.posix.join(dir === '.' ? '' : dir, pathPart),
    )
    if (asset.startsWith('..')) continue

    const version = /^[^#]*/.exec(cut === -1 ? '' : raw.slice(cut + 1))[0]
    const v = VERSION.exec(version)
    const entry = { asset, file, v: v ? Number(v[1]) : null }
    found[v ? 'versioned' : 'unversioned'].push(entry)
  }

  return found
}

// Collect what every HTML file references, and which ?v= each file uses.
function collect(files, read) {
  const versioned = new Map() // asset -> Map(version -> Set(html))
  const unversioned = new Map() // asset -> Set(html)
  const byAsset = new Map() // asset -> Map(html -> version)

  for (const file of files) {
    let html
    try {
      html = read(file)
    } catch {
      continue // not present in this tree (renamed or removed)
    }

    const { versioned: withVersion, unversioned: without } = scanHtml(html, file)

    for (const { asset, v } of withVersion) {
      if (!versioned.has(asset)) versioned.set(asset, new Map())
      const versions = versioned.get(asset)
      if (!versions.has(v)) versions.set(v, new Set())
      versions.get(v).add(file)

      if (!byAsset.has(asset)) byAsset.set(asset, new Map())
      byAsset.get(asset).set(file, v)
    }

    for (const { asset } of without) {
      if (!unversioned.has(asset)) unversioned.set(asset, new Set())
      unversioned.get(asset).add(file)
    }
  }

  return { versioned, unversioned, byAsset }
}

const headFiles = listFiles(null)
const baseFiles = listFiles(baseCommit)

const headHtml = htmlFiles(headFiles, subprojectDirs(headFiles))
const baseHtml = htmlFiles(baseFiles, subprojectDirs(baseFiles))

if (headHtml.length === 0) {
  console.error('FAIL  no site HTML files found — the site/subproject split in this script no longer')
  console.error('      matches the repository layout, so the gate would be a silent no-op')
  process.exit(2)
}

const readHead = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8')
const readBase = (file) => git('show', `${baseCommit}:${file}`)

const head = withEmbeddedRefs(
  collect(headHtml, readHead),
  headFiles,
  subprojectDirs(headFiles),
  readHead,
)
const baseTree = withEmbeddedRefs(
  collect(baseHtml, readBase),
  baseFiles,
  subprojectDirs(baseFiles),
  readBase,
)

// ─── the three checks ───────────────────────────────────────────────────────

const checks = []

// 1. one asset, one ?v= everywhere
{
  const problems = []
  let inconsistent = 0

  for (const asset of [...head.versioned.keys()].sort()) {
    const versions = head.versioned.get(asset)
    if (versions.size < 2) continue
    inconsistent++
    const detail = [...versions]
      .sort((a, b) => a[0] - b[0])
      .map(([v, files]) => `v=${v} in ${[...files].sort().join(', ')}`)
      .join('; ')
    problems.push(`${asset} is referenced with different ?v= values — ${detail}`)
  }

  checks.push({
    label: `consistent  ${head.versioned.size} versioned asset(s), ${inconsistent} with conflicting ?v=`,
    problems,
  })
}

// 2. a changed immutable asset has its ?v= bumped wherever it is referenced
{
  const problems = []
  const changed = new Set(
    [
      ...git('diff', '--name-only', '--diff-filter=ACMR', baseCommit).split('\n'),
      ...git('ls-files', '--others', '--exclude-standard').split('\n'),
    ].filter(Boolean),
  )
  const changedAssets = [...changed].filter(isImmutable).sort()
  let unreferenced = 0

  for (const asset of changedAssets) {
    const references = head.byAsset.get(asset)
    if (!references) {
      unreferenced++ // not loaded from HTML (or only without ?v=, check 3's business)
      continue
    }
    for (const [file, version] of [...references].sort()) {
      const before = baseTree.byAsset.get(asset)?.get(file)
      if (before === undefined) continue // the reference itself is new here
      // A-3: the value only counts as a bump when it went *up* — an unchanged
      // or lowered value both leave returning visitors on the old file.
      if (!(version > before)) {
        problems.push(
          `${asset} changed since the base (v=${before}) but ${file} has v=${version} — the value must rise`,
        )
      }
    }
  }

  checks.push({
    label: `bumped      ${changedAssets.length} changed immutable asset(s)${
      unreferenced ? `, ${unreferenced} not referenced from HTML or JS` : ''
    }`,
    problems,
  })
}

// 3. an immutable asset is never referenced without a ?v=
{
  const problems = []

  for (const asset of [...head.unversioned.keys()].sort()) {
    if (!isImmutable(asset)) continue
    if (!fs.existsSync(path.join(repoRoot, asset))) continue
    problems.push(
      `${asset} is cached immutably but referenced without ?v= in ${[...head.unversioned
        .get(asset)]
        .sort()
        .join(', ')}`,
    )
  }

  checks.push({ label: `versioned   every immutable reference carries a ?v=`, problems })
}

// ─── report ─────────────────────────────────────────────────────────────────

const baseLabel = `${base}${baseIsMergeBase ? ` (merge-base ${baseCommit.slice(0, 7)})` : ''}`
const problems = checks.flatMap((check) => check.problems)

for (const problem of problems) console.error(`FAIL  ${problem}`)

console.log(
  `\nAsset ?v= check — base ${baseLabel}, ${headHtml.length} HTML file(s) and ${scannedEmbedded.size} JS/TS file(s) scanned`,
)

for (const check of checks) {
  const marker = check.problems.length ? 'FAIL' : 'ok  '
  console.log(`${marker}  ${check.label}`)
}

// One value per asset, and where it comes from: the reading the ticket's P1
// probe takes from this output.
if (head.versioned.size) {
  console.log('\nVersioned assets:')
  for (const asset of [...head.versioned.keys()].sort()) {
    const versions = [...head.versioned.get(asset)].sort((a, b) => a[0] - b[0])
    const files = [...new Set(versions.flatMap(([, set]) => [...set]))].sort()
    console.log(`  ${asset}  ${versions.map(([v]) => `v=${v}`).join(', ')}  <- ${files.join(', ')}`)
  }
}

if (skippedTemplateRefs.size) {
  console.log(`\nNot parsed — the interpolation is not a literal list: ${skippedTemplateRefs.size}`)
  for (const note of [...skippedTemplateRefs].sort()) console.log(`  ${note}`)
}

if (problems.length) {
  console.error(`\nAsset ?v= check FAILED: ${problems.length} problem(s) against ${baseLabel}`)
  console.error('Bump the ?v= in every HTML file that references the asset, then run this again.')
  process.exit(1)
}

console.log(`\nAsset ?v= check passed: ${checks.length}/${checks.length} checks against ${baseLabel}`)
