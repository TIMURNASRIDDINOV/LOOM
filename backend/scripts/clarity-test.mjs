// Run: node backend/scripts/clarity-test.mjs
// Real Worker (the admin route and scheduled()) on Miniflare with an ephemeral
// local D1 and every migration applied; Clarity and Telegram stubbed through
// Miniflare's outboundService. No network, no real token. `--serve` keeps a
// seeded Worker on :8787 (the admin UI's localhost API_BASE) for a browser
// check; CLARITY_STUB_MODE picks the state: ok | unconfigured | empty | error.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHmac } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const { build } = require('esbuild')
const { Miniflare, Response } = require('miniflare')
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const scratch = await mkdtemp(join(tmpdir(), 'loom-clarity-'))
const secret = 'local-clarity-test-only'
const CLARITY_TOKEN = 'local-clarity-token'
const CRON = '0 2 * * *'
const ENDPOINT = 'https://www.clarity.ms/export-data/api/v1/project-live-insights'
const serve = process.argv.includes('--serve')

function token(id, role = 'admin') {
  const encode = (v) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const raw = `${encode({ alg: 'HS256' })}.${encode({ sub: String(id), role, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}`
  return `${raw}.${createHmac('sha256', secret).update(raw).digest('base64url')}`
}

// Fixtures in the documented shape, with the drift the docs allow: metric names
// with and without spaces, numeric strings, unknown metrics and fields, junk.
const totalsBody = (rage = '7', dead = '11') => [
  { metricName: 'Traffic', information: [{ totalSessionCount: '120', totalBotSessionCount: '3', distinctUserCount: '98', pagesPerSessionPercentage: 1.8 }] },
  { metricName: 'Rage Click Count', information: [{ sessionsCount: '120', sessionsWithMetricPercentage: 2.5, pagesViews: '210', subTotal: rage }] },
  { metricName: 'DeadClickCount', information: [{ sessionsCount: '120', sessionsWithMetricPercentage: 5, pagesViews: '210', subTotal: dead }] },
  { metricName: 'ScrollDepth', information: [{ averageScrollDepth: 46.2 }] },
  { metricName: 'EngagementTime', information: [{ totalTime: '5400', activeTime: '2100' }] },
  { metricName: 'PopularPages', information: [
    { url: 'https://loomdesign.uz/', visitsCount: '120' },
    { url: 'https://loomdesign.uz/configurator.html?utm_source=ig&fbclid=SECRET#cart', visitsCount: '64' },
  ] },
  { metricName: 'Referrer URL', information: [{ name: 'https://l.instagram.com/?u=https%3A%2F%2Floomdesign.uz&e=SECRET', sessionsCount: '30' }] },
  { metricName: 'FutureMetric', information: [{ nested: { url: 'https://x.test/?SECRET' }, list: [1], flag: true, none: null }, 'junk', 7] },
  'not a metric', { information: [] }, { metricName: 'NoInformation' },
]
const urlBody = [
  { metricName: 'Scroll Depth', information: [{ URL: 'https://loomdesign.uz/configurator.html?x=SECRET', averageScrollDepth: 51 }, { URL: 'https://loomdesign.uz/', averageScrollDepth: 38 }] },
  { metricName: 'RageClickCount', information: [{ URL: '/configurator.html?ref=SECRET#top', subTotal: '5', sessionsCount: '40' }] },
  { metricName: 'Dead Click Count', information: [{ URL: 'loomdesign.uz/shop.html?SECRET', subTotal: '2', sessionsCount: '12' }] },
]
const deviceBody = [{ metricName: 'Traffic', information: [{ Device: 'Mobile', totalSessionCount: '100' }, { Device: 'PC', totalSessionCount: '20' }] }]
const sourceBody = [{ metricName: 'Traffic', information: [{ Source: 'instagram', Medium: 'social', Campaign: 'reel-1', totalSessionCount: '40' }, { Source: 'google', Medium: 'organic', Campaign: '', totalSessionCount: '9' }] }]
const OK = { '': () => json(totalsBody()), URL: () => json(urlBody), Device: () => json(deviceBody), 'Source,Medium,Campaign': () => json(sourceBody) }

// The stub: records what the Worker sends and answers from `answers`, keyed
// by the comma-joined dimension list.
let answers = OK
let stubError = null
const calls = []
const telegrams = []
async function outbound(request) {
  try { return await answer(request) } catch (error) { stubError ??= error; throw error }
}
async function answer(request) {
  const url = new URL(request.url)
  if (url.href.startsWith('https://api.telegram.org/')) {
    assert.equal(url.pathname, '/bottest-bot/sendMessage')
    telegrams.push((await request.json()).text)
    return json({ ok: true, result: { message_id: telegrams.length } })
  }
  assert.equal(`${url.origin}${url.pathname}`, ENDPOINT, `unexpected outbound fetch ${request.url}`)
  assert.equal(request.method, 'GET')
  assert.equal(request.headers.get('authorization'), `Bearer ${CLARITY_TOKEN}`)
  const dims = ['dimension1', 'dimension2', 'dimension3'].map((k) => url.searchParams.get(k)).filter(Boolean).join(',')
  calls.push({ dims, params: [...url.searchParams.keys()].sort().join(','), numOfDays: url.searchParams.get('numOfDays') })
  const reply = answers[dims] ?? OK[dims]
  if (!reply) throw new Error(`unexpected dimensions ${dims}`)
  return reply()
}

await build({ entryPoints: [join(root, 'src/index.ts')], outfile: join(scratch, 'worker.mjs'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022' })
await build({ entryPoints: [join(root, 'src/lib/clarity.ts')], outfile: join(scratch, 'clarity.mjs'), bundle: true, format: 'esm', platform: 'neutral', target: 'es2022' })
const lib = await import(pathToFileURL(join(scratch, 'clarity.mjs')).href)

async function start(extra, port) {
  const mf = new Miniflare({ modules: true, modulesRoot: scratch, scriptPath: join(scratch, 'worker.mjs'), compatibilityDate: '2024-09-23', cf: false,
    ...(port ? { port, host: 'localhost' } : {}), d1Databases: ['DB'], r2Buckets: ['LOOM_UPLOADS', 'LOOM_MODELS'], kvNamespaces: ['RATE_LIMIT'],
    bindings: { JWT_SECRET: secret, ENVIRONMENT: 'test', TELEGRAM_BOT_TOKEN: 'test-bot', TELEGRAM_CHAT_ID: '42', BOT_USERNAME: '', ...extra }, outboundService: outbound })
  const db = await mf.getD1Database('DB')
  for (const file of (await readdir(join(root, 'migrations'))).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = (await readFile(join(root, 'migrations', file), 'utf8')).replace(/--[^\n]*/g, '')
    for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(statement).run()
  }
  await db.prepare('DELETE FROM admins').run()
  await db.prepare("INSERT INTO admins (id,email,password_hash,role,created_at) VALUES (1,'qa-admin@loom.test','unused','owner',1),(2,'qa-staff@loom.test','unused','staff',1)").run()
  await db.prepare("INSERT INTO admin_permissions (admin_id,capability,granted,updated_at) VALUES (2,'analytics.view',0,1)").run()
  return { mf, db }
}

async function runCron(mf) {
  const worker = await mf.getWorker()
  await worker.scheduled({ cron: CRON, scheduledTime: new Date() })
}

// History for the trend: one totals snapshot per day at 02:00 UTC, `days` back.
async function seedHistory(db, days) {
  for (let i = days; i >= 1; i--) {
    const at = new Date(Date.now() - i * 86400000)
    at.setUTCHours(2, 0, 0, 0)
    await db.prepare("INSERT INTO clarity_snapshots (fetched_at, dimensions, num_days, status, body) VALUES (?, '', 1, 200, ?)")
      .bind(at.toISOString(), JSON.stringify(totalsBody(String(3 + (i * 7) % 9), String(6 + (i * 5) % 11)))).run()
  }
}

if (serve) {
  // Stop with Ctrl+C. The printed cookie is a throwaway local test token.
  const mode = process.env.CLARITY_STUB_MODE || 'ok'
  const { mf, db } = await start(mode === 'unconfigured' ? {} : { CLARITY_API_TOKEN: CLARITY_TOKEN }, 8787)
  if (mode === 'ok' || mode === 'error') {
    await seedHistory(db, 14)
    await runCron(mf)
  }
  if (mode === 'error') {
    answers = { ...OK, URL: () => json({ message: 'Exceeded daily limit' }, 429) }
    await runCron(mf)
  }
  console.log(`Clarity stub Worker on http://localhost:8787 (mode ${mode}); admin cookie: admin_token=${token(1)}`)
  await new Promise(() => {})
}

let checks = 0
async function readout(mf, { status = 200, cookie = token(1) } = {}) {
  const res = await mf.dispatchFetch('http://localhost/api/admin/analytics/clarity', { headers: cookie ? { Cookie: `admin_token=${cookie}` } : {} })
  const data = await res.json()
  assert.equal(res.status, status, JSON.stringify(data))
  if (status === 200) assert.equal(res.headers.get('cache-control'), 'no-store')
  checks++
  return data
}
const rows = (db) => db.prepare('SELECT id, fetched_at, dimensions, num_days, status, body FROM clarity_snapshots ORDER BY id').all().then((r) => r.results)

const instances = []
try {
  // Pure helpers: request building, path stripping, defensive parsing.
  assert.deepEqual(lib.CLARITY_REQUESTS.map((r) => lib.clarityRequestUrl(r.dimensions)), [
    `${ENDPOINT}?numOfDays=1`,
    `${ENDPOINT}?numOfDays=1&dimension1=URL`,
    `${ENDPOINT}?numOfDays=1&dimension1=Device`,
    `${ENDPOINT}?numOfDays=1&dimension1=Source&dimension2=Medium&dimension3=Campaign`,
  ])
  assert.equal(lib.CLARITY_CRON, CRON)
  for (const [input, path] of [['https://loomdesign.uz/configurator.html?utm_source=ig#cart', '/configurator.html'], ['https://loomdesign.uz', '/'],
    ['/shop.html?id=1', '/shop.html'], ['/a#b', '/a'], ['loomdesign.uz/x?y', 'loomdesign.uz/x'], ['Mobile', 'Mobile'], ['', '']]) {
    assert.equal(lib.toPath(input), path, input)
  }
  for (const junk of [null, undefined, {}, 'text', 42, [null, 'x', 3, [], { information: [] }]]) assert.deepEqual(lib.sanitize(junk), [])
  assert.deepEqual(lib.sanitize([{ metricName: 'M', information: 'not a list' }]), [{ metricName: 'M', information: [] }])
  assert.deepEqual(lib.sanitize([{ metricName: 'M', information: [{ a: '1', b: 2, c: null, d: true, e: {}, f: [], href: 'x?y', title: 'Why LOOM?' }, 'junk'] }]),
    [{ metricName: 'M', information: [{ a: '1', b: 2, c: null, d: true, href: 'x', title: 'Why LOOM?' }] }])
  for (const [item, count] of [[{ subTotal: '7' }, 7], [{ SubTotal: 3 }, 3], [{ sessionsCount: '9', count: 2 }, 2], [{ subTotal: '' , total: '4' }, 4],
    [{ subTotal: 'n/a' }, null], [{ sessionsCount: '9' }, null], [{}, null], [null, null], ['7', null], [[7], null]]) {
    assert.equal(lib.pickCount(item), count, JSON.stringify(item))
  }

  // Not configured: the cron makes no request and the readout says so.
  const bare = await start({})
  instances.push(bare.mf)
  await readout(bare.mf, { status: 401, cookie: null })
  await readout(bare.mf, { status: 401, cookie: token(1, 'user') })
  assert.equal((await readout(bare.mf, { status: 403, cookie: token(2) })).code, 'forbidden')
  assert.deepEqual(await readout(bare.mf), { configured: false, missing: ['CLARITY_API_TOKEN'] })
  await runCron(bare.mf)
  assert.equal(calls.length, 0, 'no token, no Clarity request')
  assert.deepEqual(await rows(bare.db), [])

  const { mf, db } = await start({ CLARITY_API_TOKEN: CLARITY_TOKEN })
  instances.push(mf)
  const index = await db.prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_clarity_snapshots_dims'").first()
  assert.match(index.sql, /\(dimensions, fetched_at\)/)
  await readout(mf, { status: 401, cookie: null })
  assert.equal((await readout(mf, { status: 403, cookie: token(2) })).code, 'forbidden', 'capability checked before any work')
  const empty = await readout(mf)
  assert.deepEqual(empty, { configured: true, project: 'z3lrdtn5pv',
    links: { dashboard: 'https://clarity.microsoft.com/projects/view/z3lrdtn5pv/dashboard', heatmaps: 'https://clarity.microsoft.com/projects/view/z3lrdtn5pv/heatmaps' },
    latest: { totals: null, url: null, device: null, source: null }, trend: [], lastError: null })
  assert.equal(calls.length, 0, 'the readout never calls Clarity')

  // A good run: exactly 4 requests, numOfDays=1, one row each, URLs reduced to paths.
  await runCron(mf)
  assert.deepEqual(calls.map((c) => c.dims), ['', 'URL', 'Device', 'Source,Medium,Campaign'])
  assert.ok(calls.every((c) => c.numOfDays === '1'))
  assert.deepEqual(calls.map((c) => c.params), ['numOfDays', 'dimension1,numOfDays', 'dimension1,numOfDays', 'dimension1,dimension2,dimension3,numOfDays'])
  let stored = await rows(db)
  assert.deepEqual(stored.map((r) => [r.dimensions, r.num_days, r.status]), [['', 1, 200], ['URL', 1, 200], ['Device', 1, 200], ['Source,Medium,Campaign', 1, 200]])
  assert.equal(new Set(stored.map((r) => r.fetched_at)).size, 1)
  assert.ok(Math.abs(Date.parse(stored[0].fetched_at) - Date.now()) < 60000)
  assert.match(stored[0].fetched_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
  for (const r of stored) assert.ok(!/SECRET|utm_|fbclid|[?#]|https?:/.test(r.body), `query, fragment or origin left in ${r.body}`)
  assert.deepEqual(telegrams, [])

  const first = await readout(mf)
  const t = first.latest.totals
  assert.equal(t.fetchedAt, stored[0].fetched_at)
  assert.equal(t.numDays, 1)
  assert.deepEqual(t.metrics.rageclickcount, [{ sessionsCount: 120, sessionsWithMetricPercentage: 2.5, pagesViews: 210, subTotal: 7 }])
  assert.deepEqual(t.metrics.popularpages, [{ url: '/', visitsCount: 120 }, { url: '/configurator.html', visitsCount: 64 }])
  assert.deepEqual(t.metrics.referrerurl, [{ name: '/', sessionsCount: 30 }])
  assert.deepEqual(t.metrics.futuremetric, [{ flag: true, none: null }])
  assert.deepEqual(Object.keys(t.metrics).sort(), ['deadclickcount', 'engagementtime', 'futuremetric', 'noinformation', 'popularpages', 'rageclickcount', 'referrerurl', 'scrolldepth', 'traffic'])
  assert.deepEqual(first.latest.url.metrics.scrolldepth.map((i) => i.URL), ['/configurator.html', '/'])
  assert.deepEqual(first.latest.url.metrics.rageclickcount, [{ URL: '/configurator.html', subTotal: 5, sessionsCount: 40 }])
  assert.deepEqual(first.latest.url.metrics.deadclickcount[0].URL, 'loomdesign.uz/shop.html')
  assert.deepEqual(first.latest.device.metrics.traffic.map((i) => i.Device), ['Mobile', 'PC'])
  assert.deepEqual(first.latest.source.metrics.traffic[0], { Source: 'instagram', Medium: 'social', Campaign: 'reel-1', totalSessionCount: 40 })
  assert.deepEqual(first.trend, [{ fetchedAt: t.fetchedAt, rageClicks: 7, deadClicks: 11 }])
  assert.equal(first.lastError, null)

  // 429 on the second request: the run stops, nothing is retried, one Telegram
  // message, the error row is stored and earlier snapshots stay.
  answers = { ...OK, URL: () => json({ message: 'Exceeded daily limit' }, 429) }
  let before = calls.length
  await runCron(mf)
  assert.deepEqual(calls.slice(before).map((c) => c.dims), ['', 'URL'], '429 stops the run without a retry')
  stored = await rows(db)
  assert.deepEqual(stored.slice(4).map((r) => [r.dimensions, r.status, r.body]), [['', 200, stored[4].body], ['URL', 429, null]])
  assert.equal(telegrams.length, 1)
  assert.match(telegrams[0], /url: HTTP 429/)
  assert.match(telegrams[0], /10 запросов/)
  const limited = await readout(mf)
  assert.deepEqual(limited.lastError, { fetchedAt: stored[5].fetched_at, request: 'url', status: 429 })
  assert.equal(limited.latest.url.fetchedAt, stored[1].fetched_at, 'the last good URL snapshot stays')
  assert.equal(limited.latest.totals.fetchedAt, stored[4].fetched_at)
  assert.equal(limited.trend.length, 2)

  // 401 and 403 on the first request stop the run the same way.
  for (const status of [401, 403]) {
    answers = { ...OK, '': () => json({}, status) }
    before = calls.length
    const sent = telegrams.length
    await runCron(mf)
    assert.equal(calls.length, before + 1)
    assert.equal(telegrams.length, sent + 1)
    assert.match(telegrams.at(-1), new RegExp(`totals: HTTP ${status}`))
    assert.match(telegrams.at(-1), /CLARITY_API_TOKEN/)
    assert.equal((await readout(mf)).lastError.status, status)
  }

  // Other failures do not stop the run: a 200 that is not JSON, a 500 and a
  // 503 are each stored, and the run sends one message for all three.
  answers = {
    URL: () => new Response('<html>oops</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    Device: () => json({ error: 'server' }, 500),
    'Source,Medium,Campaign': () => json({ error: 'unavailable' }, 503),
  }
  before = calls.length
  let sent = telegrams.length
  await runCron(mf)
  assert.equal(calls.length, before + 4)
  stored = await rows(db)
  assert.deepEqual(stored.slice(-4).map((r) => [r.dimensions, r.status, r.body === null]), [['', 200, false], ['URL', 200, true], ['Device', 500, true], ['Source,Medium,Campaign', 503, true]])
  assert.equal(telegrams.length, sent + 1)
  assert.match(telegrams.at(-1), /url: HTTP 200, device: HTTP 500, source: HTTP 503/)
  const mixed = await readout(mf)
  assert.deepEqual(mixed.lastError, { fetchedAt: stored.at(-1).fetched_at, request: 'source', status: 503 })
  assert.equal(mixed.latest.device.fetchedAt, stored[2].fetched_at)

  // No answer at all (Miniflare's stub cannot drop a connection, so the run is
  // called directly with a failing fetch): status 0, one message.
  const notes = []
  await lib.pullClarity({ DB: db, CLARITY_API_TOKEN: CLARITY_TOKEN },
    { fetch: async () => { throw new TypeError('connection reset') }, notify: async (text) => { notes.push(text) } })
  stored = await rows(db)
  assert.deepEqual(stored.slice(-4).map((r) => [r.status, r.body]), [[0, null], [0, null], [0, null], [0, null]])
  assert.equal(notes.length, 1)
  assert.match(notes[0], /totals: HTTP 0, url: HTTP 0, device: HTTP 0, source: HTTP 0/)

  // Shape drift on a 200 is stored, not thrown: an object instead of a list,
  // and an answer large enough to near D1's row limit is capped per metric.
  const big = [{ metricName: 'PopularPages', information: Array.from({ length: 1000 }, (_, i) => ({ url: `https://loomdesign.uz/p/${i}/${'x'.repeat(2000)}?q=SECRET`, visitsCount: String(1000 - i) })) }]
  answers = { ...OK, '': () => json({ unexpected: 'object' }), URL: () => json(big) }
  sent = telegrams.length
  await runCron(mf)
  stored = await rows(db)
  assert.deepEqual(stored.slice(-4).map((r) => r.status), [200, 200, 200, 200])
  assert.equal(stored.at(-4).body, '[]')
  const capped = JSON.parse(stored.at(-3).body)
  assert.equal(capped[0].information.length, 100)
  assert.ok(stored.at(-3).body.length < 1_500_000 && !stored.at(-3).body.includes('SECRET'))
  assert.equal(telegrams.length, sent, 'a drifted 200 is not a failed run')
  const drift = await readout(mf)
  assert.deepEqual(drift.latest.totals.metrics, {})
  assert.equal(drift.latest.url.metrics.popularpages[0].url, `/p/0/${'x'.repeat(2000)}`)
  assert.ok(drift.trend.every((p) => p.fetchedAt !== stored.at(-4).fetched_at), 'a totals answer without click metrics adds no trend point')

  // The trend: the 30 newest totals snapshots, oldest first. The drifted one
  // above has no click metrics, so 30 snapshots give 29 points.
  await seedHistory(db, 35)
  const month = await readout(mf)
  assert.equal(month.trend.length, 29)
  assert.deepEqual(month.trend.map((p) => p.fetchedAt), [...month.trend.map((p) => p.fetchedAt)].sort())
  assert.ok(month.trend.every((p) => Number.isInteger(p.rageClicks) && Number.isInteger(p.deadClicks)))
  assert.ok(Date.parse(month.trend[0].fetchedAt) > Date.now() - 31 * 86400000)
  if (stubError) throw stubError
  console.log(`PASS: ${checks} route checks; sign-in and capability before any work, not-configured (no request), 4 requests with numOfDays=1, paths without query or fragment, defensive parsing, 429/401/403 stop without retry, one Telegram message per failed run, earlier snapshots kept, row cap, 30-day trend.`)
} finally {
  await Promise.all(instances.map((mf) => mf.dispose()))
  await rm(scratch, { recursive: true, force: true })
}
