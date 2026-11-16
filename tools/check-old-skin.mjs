#!/usr/bin/env node
// ─── Old-skin gate (LOOM-341) ───────────────────────────────────────────────
//
// Customer pages are Atelye (assets/atelye.css or assets/cfg-atelye.css). This
// fails when a customer HTML file (everything outside admin/) references a
// file of the old maximalist skin or carries its inline MAXIMALIST SKIN block,
// unless the page is on ALLOW below for exactly those references. An allowed
// page must also carry the pre-paint marker in its <head>, so the Atelye class
// lands before the old skin can paint (the flash LOOM-341 fixed).
//
// Usage: node tools/check-old-skin.mjs        Exit: 0 clean · 1 findings

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OLD = ['theme.css', 'nav.css', 'auth.css', 'login-modal.css', 'motion.js', 'MAXIMALIST SKIN']
const MARKER = 'LOOM-341 atelye-prepaint'
// The configurator still runs on the old stylesheets under its Atelye layer.
// Shrink this list as that layer is removed; never add motion.js back.
const ALLOW = {
  'configurator.html': ['theme.css', 'nav.css', 'auth.css', 'login-modal.css', 'MAXIMALIST SKIN'],
}

function htmlFiles(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'admin' || e.name === 'backend') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...htmlFiles(p))
    else if (e.name.endsWith('.html')) out.push(p)
  }
  return out
}

const problems = []
for (const file of htmlFiles(ROOT)) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/')
  const src = fs.readFileSync(file, 'utf8')
  const allowed = ALLOW[rel] || []
  for (const o of OLD) {
    const hit = o.includes(' ') ? src.includes(o) : new RegExp(`[/"']${o.replace('.', '\\.')}`).test(src)
    if (hit && !allowed.includes(o)) problems.push(`${rel}: references old skin ${o}`)
  }
  if (ALLOW[rel]) {
    const head = src.slice(0, src.indexOf('</head>'))
    if (!head.includes(MARKER)) problems.push(`${rel}: allow-listed for the old skin but has no "${MARKER}" marker in <head>`)
  }
}

if (problems.length) {
  console.error('old-skin gate: FAIL\n  ' + problems.join('\n  '))
  process.exit(1)
}
console.log('old-skin gate: ok (customer pages reference no old-skin file outside the allow-list)')
