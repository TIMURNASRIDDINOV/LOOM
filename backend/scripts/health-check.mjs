#!/usr/bin/env node
// ─── Post-deploy health check (LOOM-149) ─────────────────────────────────────
//
// Anonymous, read-only smoke check. Two GETs, no cookies, no auth headers:
//
//   GET /api/products  → 200   the public catalogue is up and D1 answers
//   GET /api/admin/me  → 401   the admin gate rejects anonymous callers
//
// Exits 0 only when BOTH expectations hold; any other status, network error
// or timeout exits 1. Safe against staging and prod: it never writes anything
// and never authenticates. Authenticated / admin flows are localhost-only with
// seeded test accounts — see docs/prd/README.md.
//
// Usage:
//   node scripts/health-check.mjs <host>
//   npm run health-check -- https://api.loomdesign.uz
//   npm run health-check -- http://localhost:8787          (wrangler dev --local)

const host = process.argv[2]

if (!host) {
  console.error('Usage: node scripts/health-check.mjs <host>')
  console.error('  e.g. node scripts/health-check.mjs https://api.loomdesign.uz')
  console.error('       node scripts/health-check.mjs http://localhost:8787')
  process.exit(2)
}

let base
try {
  base = new URL(host)
} catch {
  console.error(`FAIL  invalid host: ${host} (expected e.g. https://api.loomdesign.uz)`)
  process.exit(2)
}

const TIMEOUT_MS = 10_000

const CHECKS = [
  { path: '/api/products', expect: 200 },
  { path: '/api/admin/me', expect: 401 },
]

let failed = 0

for (const { path, expect } of CHECKS) {
  const url = new URL(path, base).toString()
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Anonymous on purpose: no Authorization header, no Cookie header.
    })
    if (res.status === expect) {
      console.log(`ok    ${path} → ${res.status}`)
    } else {
      failed++
      console.error(`FAIL  ${path} → ${res.status} (expected ${expect})`)
    }
  } catch (err) {
    failed++
    console.error(`FAIL  ${path} → ${err?.cause?.code ?? err?.name ?? 'error'}: ${err?.message ?? err}`)
  }
}

if (failed) {
  console.error(`\nHealth check FAILED: ${failed}/${CHECKS.length} checks did not pass against ${base.origin}`)
  process.exit(1)
}

console.log(`\nHealth check passed: ${CHECKS.length}/${CHECKS.length} checks against ${base.origin}`)
