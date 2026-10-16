#!/usr/bin/env node
// ─── Post-deploy health check (LOOM-149) ─────────────────────────────────────
//
// Anonymous, read-only smoke check. Two GETs, no cookies, no auth headers:
//
//   GET /api/products  → 200   the public catalogue answers (D1 is reachable;
//                              it does NOT prove the catalogue has products)
//   GET /api/admin/me  → 401   the admin gate rejects anonymous callers
//
// Exits 0 only when BOTH expectations hold; any other status, network error
// or timeout exits 1. Exit 2 means the script was called wrongly (no host, or
// a host that is not http/https) and says nothing about the deployment.
// Safe against staging and prod: it never writes anything and never
// authenticates. Authenticated and admin flows are not part of this check.
//
// Usage:
//   node scripts/health-check.mjs <host>
//   npm run health-check -- https://api.loomdesign.uz
//   npm run health-check -- http://localhost:8787          (wrangler dev --local)
//
// Behind a mandatory egress proxy, Node's fetch ignores HTTPS_PROXY/HTTP_PROXY
// unless NODE_USE_ENV_PROXY=1 is set; run with that variable set, or you will
// see ENOTFOUND for both checks while curl gets 200 and 401.

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
  base = undefined
}

// new URL('localhost:8787') succeeds — it reads `localhost:` as the scheme — so
// the protocol must be checked explicitly, not just the parse.
if (!base || (base.protocol !== 'http:' && base.protocol !== 'https:')) {
  console.error(`FAIL  invalid host: ${host} (expected e.g. https://api.loomdesign.uz)`)
  process.exit(2)
}

const TIMEOUT_MS = 10_000

const CHECKS = [
  { path: '/api/products', expect: 200 },
  { path: '/api/admin/me', expect: 401 },
]

let failed = 0
let networkErrors = 0

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
    networkErrors++
    console.error(`FAIL  ${path} → ${err?.cause?.code ?? err?.name ?? 'error'}: ${err?.message ?? err}`)
  }
}

if (failed) {
  console.error(`\nHealth check FAILED: ${failed}/${CHECKS.length} checks did not pass against ${base.origin}`)
  if (networkErrors) {
    console.error('A network error may be a proxy, not an outage: Node\'s fetch ignores HTTPS_PROXY/HTTP_PROXY.')
    console.error('Re-run with NODE_USE_ENV_PROXY=1, or confirm with curl, before you roll back.')
  }
  process.exit(1)
}

console.log(`\nHealth check passed: ${CHECKS.length}/${CHECKS.length} checks against ${base.origin}`)
