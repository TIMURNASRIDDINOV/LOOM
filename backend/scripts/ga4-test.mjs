// Run: node backend/scripts/ga4-test.mjs
// Real Worker route + ephemeral local D1, Google stubbed through Miniflare's
// outboundService. No network, no real key: a throwaway RSA key is generated
// per run. `--serve` keeps a stubbed Worker on :8787 (the admin UI's localhost
// API_BASE) for a browser check; GA4_STUB_MODE picks the answer:
// ok | unconfigured | rate | forbidden | customdim | server | token.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHmac, createVerify, generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const { build } = require('esbuild')
const { Miniflare, Response } = require('miniflare')
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const scratch = await mkdtemp(join(tmpdir(), 'loom-ga4-'))
const secret = 'local-ga4-test-only'
const serve = process.argv.includes('--serve')
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})
const saKey = JSON.stringify({ type: 'service_account', client_email: 'reader@loom-test.iam.gserviceaccount.com', private_key: privateKey })
const ALLOWED = new Set(['pagePath', 'eventName', 'sessionSource', 'sessionMedium', 'sessionCampaignName', 'deviceCategory',
  'customEvent:element_id', 'customEvent:element_text', 'customEvent:section'])

function token(id, role = 'admin') {
  const encode = (v) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const raw = `${encode({ alg: 'HS256' })}.${encode({ sub: String(id), role, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}`
  return `${raw}.${createHmac('sha256', secret).update(raw).digest('base64url')}`
}

const report = (dims, mets, rows) => ({
  dimensionHeaders: dims.map((name) => ({ name })),
  metricHeaders: mets.map((name) => ({ name, type: 'TYPE_INTEGER' })),
  rows: rows.map((r) => ({ dimensionValues: r.slice(0, dims.length).map((value) => ({ value })), metricValues: r.slice(dims.length).map((v) => ({ value: String(v) })) })),
})
const fixture = {
  reports: [
    { ...report(['pagePath'], ['screenPageViews', 'activeUsers'], [['/', 120, 80], ['/configurator.html', 64, 41]]), propertyQuota: { tokensPerDay: { consumed: 12, remaining: 199988 } } },
    report(['customEvent:element_id', 'customEvent:element_text', 'customEvent:section', 'pagePath'], ['eventCount'],
      [['hero-cta', 'Create your own', 'hero', '/', 37], ['', 'Add to cart', 'cfg-panel', '/configurator.html', 12]]),
    report(['sessionSource', 'sessionMedium', 'sessionCampaignName'], ['sessions', 'activeUsers'],
      [['instagram', 'social', 'reel-1', 30, 25], ['(direct)', '(none)', '(not set)', 22, 20]]),
    report(['deviceCategory'], ['sessions', 'activeUsers'], [['mobile', 44, 38], ['desktop', 8, 7]]),
    report(['eventName', 'pagePath'], ['eventCount'], [['scroll', '/', 51], ['cfg_open', '/configurator.html', 19], ['cfg_cart', '/configurator.html', 4]]),
  ],
}

// The stub: verifies what the Worker sends to Google and answers per `mode`.
let mode = 'ok'
let stubError = null
const calls = { token: 0, data: 0 }
const bodies = []
// An assertion failing inside the stub reaches the Worker as a fetch error;
// keep it so the run fails with the real reason.
async function google(request) {
  try { return await answer(request) } catch (error) { stubError ??= error; throw error }
}
async function answer(request) {
  const url = new URL(request.url)
  if (url.href === 'https://oauth2.googleapis.com/token') {
    calls.token++
    assert.equal(request.method, 'POST')
    const form = new URLSearchParams(await request.text())
    assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer')
    const [h, p, s] = form.get('assertion').split('.')
    assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', typ: 'JWT' })
    const claims = JSON.parse(Buffer.from(p, 'base64url'))
    assert.equal(claims.iss, 'reader@loom-test.iam.gserviceaccount.com')
    assert.equal(claims.scope, 'https://www.googleapis.com/auth/analytics.readonly')
    assert.equal(claims.aud, 'https://oauth2.googleapis.com/token')
    assert.equal(claims.exp - claims.iat, 3600)
    assert.ok(Math.abs(claims.iat - Date.now() / 1000) < 60)
    assert.ok(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url')), 'JWT signature')
    if (mode === 'token') return json({ error: 'invalid_grant' }, 400)
    return json({ access_token: 'stub-access-token', expires_in: 3599, token_type: 'Bearer' })
  }
  if (url.href === 'https://analyticsdata.googleapis.com/v1beta/properties/123456789:batchRunReports') {
    calls.data++
    assert.equal(request.headers.get('authorization'), 'Bearer stub-access-token')
    bodies.push(await request.json())
    if (mode === 'rate') return json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }, 429)
    if (mode === 'forbidden') return json({ error: { code: 403, status: 'PERMISSION_DENIED' } }, 403)
    if (mode === 'customdim') return json({ error: { code: 400, message: 'Field customEvent:element_id is not a valid dimension.' } }, 400)
    if (mode === 'server') return json({ error: { code: 500 } }, 500)
    return json(fixture)
  }
  throw new Error(`unexpected outbound fetch ${request.url}`)
}

await build({ entryPoints: [join(root, 'src/index.ts')], outfile: join(scratch, 'worker.mjs'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022' })
async function start(extra, port) {
  const mf = new Miniflare({ modules: true, modulesRoot: scratch, scriptPath: join(scratch, 'worker.mjs'), compatibilityDate: '2024-09-23', cf: false,
    ...(port ? { port, host: 'localhost' } : {}), d1Databases: ['DB'], r2Buckets: ['LOOM_UPLOADS', 'LOOM_MODELS'], kvNamespaces: ['RATE_LIMIT'],
    bindings: { JWT_SECRET: secret, ENVIRONMENT: 'test', TELEGRAM_BOT_TOKEN: '', BOT_USERNAME: '', ...extra }, outboundService: google })
  const db = await mf.getD1Database('DB')
  for (const file of (await readdir(join(root, 'migrations'))).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = (await readFile(join(root, 'migrations', file), 'utf8')).replace(/--[^\n]*/g, '')
    for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(statement).run()
  }
  await db.prepare('DELETE FROM admins').run()
  await db.prepare("INSERT INTO admins (id,email,password_hash,role,created_at) VALUES (1,'qa-admin@loom.test','unused','owner',1),(2,'qa-staff@loom.test','unused','staff',1)").run()
  await db.prepare("INSERT INTO admin_permissions (admin_id,capability,granted,updated_at) VALUES (2,'analytics.view',0,1)").run()
  return mf
}

if (serve) {
  // Stop with Ctrl+C. The printed cookie is a throwaway local test token.
  mode = process.env.GA4_STUB_MODE || 'ok'
  await start(mode === 'unconfigured' ? {} : { GA4_PROPERTY_ID: '123456789', GA4_SA_KEY: saKey }, 8787)
  console.log(`GA4 stub Worker on http://localhost:8787 (mode ${mode}); admin cookie: admin_token=${token(1)}`)
  await new Promise(() => {})
}

let checks = 0
async function request(mf, query = '', { status = 200, cookie = token(1) } = {}) {
  const res = await mf.dispatchFetch(`http://localhost/api/admin/analytics/ga4${query}`, {
    headers: cookie ? { Cookie: `admin_token=${cookie}` } : {},
  })
  const data = await res.json()
  assert.equal(res.status, status, JSON.stringify(data))
  if (status !== 401 && status !== 403) assert.equal(res.headers.get('cache-control'), 'no-store')
  checks++
  return data
}

const instances = []
try {
  // Not configured: names the missing secrets, never calls Google.
  const bare = await start({})
  instances.push(bare)
  await request(bare, '', { status: 401, cookie: null })
  await request(bare, '', { status: 401, cookie: token(1, 'user') })
  await request(bare, '', { status: 403, cookie: token(2) })
  assert.deepEqual(await request(bare), { configured: false, missing: ['GA4_PROPERTY_ID', 'GA4_SA_KEY'] })
  assert.deepEqual(calls, { token: 0, data: 0 })

  const mf = await start({ GA4_PROPERTY_ID: '123456789', GA4_SA_KEY: saKey })
  instances.push(mf)
  await request(mf, '', { status: 403, cookie: token(2) })
  assert.deepEqual(calls, { token: 0, data: 0 }, 'capability check runs before any Google call')
  for (const q of ['?days=1', '?days=30', '?days=abc', '?days=07']) assert.equal((await request(mf, q, { status: 400 })).code, 'ga4_days')

  // Error paths: stable codes, 502 (never 401/403), and nothing cached.
  for (const [m, code] of [['token', 'ga4_auth_failed'], ['rate', 'ga4_rate_limited'], ['forbidden', 'ga4_forbidden'],
    ['customdim', 'ga4_custom_dimensions_missing'], ['server', 'ga4_request_failed']]) {
    mode = m
    const before = { ...calls }
    const data = await request(mf, '?days=28', { status: 502 })
    assert.deepEqual(data, { configured: true, error: 'GA4 request failed.', code, lastFetchedAt: null })
    assert.equal(calls.token, before.token + 1)
  }

  // Success: one batch call with five aggregate reports, mapped for the UI.
  mode = 'ok'
  const dataCalls = calls.data
  const ok = await request(mf, '?days=28')
  assert.equal(calls.data, dataCalls + 1)
  const body = bodies.at(-1)
  assert.equal(body.requests.length, 5)
  for (const r of body.requests) {
    assert.deepEqual(r.dateRanges, [{ startDate: '27daysAgo', endDate: 'today' }])
    for (const d of r.dimensions) assert.ok(ALLOWED.has(d.name), `dimension ${d.name} is not on the aggregate allow-list`)
    assert.ok(!JSON.stringify(r).match(/userId|clientId|customUser:/), 'no user- or client-level field')
  }
  assert.deepEqual(body.requests[1].dimensionFilter, { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'ui_click' } } })
  assert.equal(body.requests[0].returnPropertyQuota, true)
  assert.equal(ok.configured, true)
  assert.equal(ok.days, 28)
  assert.equal(ok.cached, false)
  assert.equal(ok.propertyId, '123456789')
  assert.ok(Math.abs(Date.parse(ok.fetchedAt) - Date.now()) < 60000)
  assert.deepEqual(ok.pages, [{ path: '/', views: 120, users: 80 }, { path: '/configurator.html', views: 64, users: 41 }])
  assert.deepEqual(ok.clicks[0], { elementId: 'hero-cta', text: 'Create your own', section: 'hero', path: '/', count: 37 })
  assert.deepEqual(ok.sources[0], { source: 'instagram', medium: 'social', campaign: 'reel-1', sessions: 30, users: 25 })
  assert.deepEqual(ok.devices, [{ device: 'mobile', sessions: 44, users: 38 }, { device: 'desktop', sessions: 8, users: 7 }])
  assert.deepEqual(ok.events.map((e) => e.event), ['scroll', 'cfg_open', 'cfg_cart'])

  // Cache: a repeat (and the default days) is served without Google; 7 is its own entry.
  const again = await request(mf, '')
  assert.equal(calls.data, dataCalls + 1, 'repeat load is a cache hit')
  assert.equal(again.cached, true)
  assert.equal(again.fetchedAt, ok.fetchedAt)
  // A failure after a good fetch says when that was; it is not cached either.
  mode = 'rate'
  assert.equal((await request(mf, '?days=7', { status: 502 })).lastFetchedAt, ok.fetchedAt)
  mode = 'ok'
  const week = await request(mf, '?days=7')
  assert.equal(calls.data, dataCalls + 3)
  assert.equal(week.days, 7)
  assert.equal(bodies.at(-1).requests[0].dateRanges[0].startDate, '6daysAgo')
  assert.equal((await request(mf, '?days=7')).cached, true)
  assert.equal(calls.data, dataCalls + 3)
  if (stubError) throw stubError
  console.log(`PASS: ${checks} route checks; auth and capability before Google, not-configured, days validation, five error codes uncached, last good fetch time, RS256 JWT verified, aggregate-only batch body, response mapping, 10-minute cache per days value.`)
} finally {
  await Promise.all(instances.map((mf) => mf.dispose()))
  await rm(scratch, { recursive: true, force: true })
}
