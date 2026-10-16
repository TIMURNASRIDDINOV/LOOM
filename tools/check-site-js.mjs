#!/usr/bin/env node
// ─── Site JS parses (node --check) ──────────────────────────────────────────
//
// The Pages site has no build step: whatever is committed is what the browser
// gets, so a syntax error in any served JS file reaches production untouched.
// This gate parses every one of them on the PR instead.
//
// "The site" is the deploy root — the repository root, assets/, admin/, auth/.
// A file belongs to the site when no package.json sits above it inside the
// repo: backend/ (the Worker, typechecked by tsc), cloudflare-worker/ (bundled
// by wrangler), mobile/ and tools/* are separate projects with their own
// toolchains and their own checks.
//
// No dependencies, read-only, no network. Node 18+.
//
// Usage:
//   node tools/check-site-js.mjs
//
// Exit codes: 0 every file parses · 1 at least one does not · 2 setup problem
// (not a git checkout, or no site JS files found at all).

import { execFileSync } from 'node:child_process'
import path from 'node:path'

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

const subprojectDirs = (files) => {
  const dirs = new Set()
  for (const file of files) {
    if (path.posix.basename(file) === 'package.json') {
      const dir = path.posix.dirname(file)
      if (dir !== '.') dirs.add(dir)
    }
  }
  return dirs
}

const listed = git('ls-files', '--cached', '--others', '--exclude-standard').split('\n').filter(Boolean)
const dirs = subprojectDirs(listed)

const files = listed
  .filter((file) => file.endsWith('.js') && ![...dirs].some((dir) => file.startsWith(`${dir}/`)))
  .sort()

if (files.length === 0) {
  console.error('FAIL  no site JS files found — the site/subproject split in this script no longer')
  console.error('      matches the repository layout, so the gate would be a silent no-op')
  process.exit(2)
}

// `node --check` reports `<path>:<line>` followed by the error itself; keep
// both, so the log says which line and what is wrong.
function describe(err) {
  const text = err?.stderr ? err.stderr.toString() : String(err)
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const message = lines.find((line) => /(?:Syntax)?Error:/.test(line)) ?? lines[0] ?? 'node --check failed'
  const location = lines.find((line) => /:\d+$/.test(line))
  const lineNumber = location ? location.replace(/^.*:(\d+)$/, '$1') : null
  return lineNumber ? `${message} (line ${lineNumber})` : message
}

const failures = []

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    failures.push({ file, message: describe(err) })
  }
}

for (const { file, message } of failures) console.error(`FAIL  ${file} — ${message}`)

if (failures.length) {
  console.error(`\nSite JS check FAILED: ${failures.length}/${files.length} file(s) do not parse`)
  process.exit(1)
}

console.log(`Site JS check passed: ${files.length}/${files.length} file(s) parse with node --check`)
