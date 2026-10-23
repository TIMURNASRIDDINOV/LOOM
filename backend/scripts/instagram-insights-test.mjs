// LOOM-273: weekly Instagram insights pull on a local D1, Meta and Telegram stubbed.
// Never calls the live Graph API: every request goes to the stub below.
// Run: node backend/scripts/instagram-insights-test.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHmac } from 'node:crypto'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const { build } = require('esbuild')
const { Miniflare } = require('miniflare')
const scratch = await mkdtemp(join(tmpdir(), 'loom-273-'))
const opts = { bundle: true, format: 'esm', platform: 'browser', target: 'es2022' }
await build({ ...opts, entryPoints: [join(root, 'src/index.ts')], outfile: join(scratch, 'worker.mjs') })
await build({ ...opts, entryPoints: [join(root, 'src/lib/instagram-insights.ts')], outfile: join(scratch, 'insights.mjs') })
const { pullInsights, IG_MEDIA_METRICS } = await import(pathToFileURL(join(scratch, 'insights.mjs')).href)

const TOKEN = 'local-test-token-not-real'
const USER = '1784'
const JWT_SECRET = 'loom-273-test-secret'
let outbound = 0
const mf = new Miniflare({ modules: true, modulesRoot: scratch, scriptPath: join(scratch, 'worker.mjs'), compatibilityDate: '2024-09-23', cf: false,
  d1Databases: ['DB'], r2Buckets: ['LOOM_UPLOADS', 'LOOM_MODELS'], kvNamespaces: ['RATE_LIMIT'],
  bindings: { JWT_SECRET, ENVIRONMENT: 'test', TELEGRAM_BOT_TOKEN: '', BOT_USERNAME: '' },
  outboundService: () => { outbound++; return new Response('{}', { status: 500 }) } })

let checks = 0
const ok = (value, msg) => { assert.ok(value, msg); checks++ }
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++ }

// ─── Meta stub ───────────────────────────────────────────────────────────────
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const metaError = (code, status = 400) => json({ error: { code, message: `stub error ${code} ${TOKEN}` } }, status)
const DAY = 86_400_000
// media: (id) => Response; account: (metric) => Response
function stub({ media, account } = {}) {
  const calls = []
  const fetch = async (url, init = {}) => {
    const u = new URL(url)
    calls.push({ method: init.method, path: u.pathname, url: String(url), auth: new Headers(init.headers).get('authorization'), q: Object.fromEntries(u.searchParams) })
    const id = u.pathname.split('/').at(-2)
    if (!u.pathname.endsWith('/insights')) throw new Error(`unexpected stub call ${u.pathname}`)
    if (id === USER) {
      const metric = u.searchParams.get('metric')
      if (account) return account(metric)
      const end = Number(u.searchParams.get('until')) * 1000
      return json({ data: [{ name: metric, period: 'day', values: [1, 2].map((n) => ({ value: n * 10, end_time: new Date(end - n * DAY).toISOString().replace('.000Z', '+0000') })) }] })
    }
    if (media) return media(id)
    return json({ data: u.searchParams.get('metric').split(',').map((name, i) => ({ name, period: 'lifetime', values: [{ value: i + 1 }] })) })
  }
  return { fetch, calls, media: () => calls.filter((c) => !c.path.includes(`/${USER}/`)) }
}

const db = await mf.getD1Database('DB')
for (const file of (await readdir(join(root, 'migrations'))).filter((name) => name.endsWith('.sql')).sort()) {
  const sql = (await readFile(join(root, 'migrations', file), 'utf8')).replace(/--[^\n]*/g, '')
  for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run()
}
await db.prepare('DELETE FROM admins').run()
await db.prepare("INSERT INTO admins (id,email,password_hash,role,created_at) VALUES (1,'owner@test.invalid','x','owner',1),(2,'staff@test.invalid','x','staff',1)").run()

const clock = Date.now()
const iso = (ms) => new Date(ms).toISOString()
const notes = []
const env = { DB: db, IG_ACCESS_TOKEN: TOKEN, IG_USER_ID: USER, TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' }
const run = (s) => pullInsights(env, { fetch: s.fetch, now: () => clock, notify: async (t) => { notes.push(t) } })
async function post({ status = 'published', media = null, at = clock - DAY } = {}) {
  const r = await db.prepare(`INSERT INTO ig_posts (caption_uz, langs, media_url, status, ig_media_id, permalink, published_at, approved_by, created_at, updated_at)
    VALUES ('Salom', 'uz', 'https://x.test/a.jpg', ?, ?, ?, ?, 1, ?, ?)`)
    .bind(status, media, media ? `https://www.instagram.com/p/${media}/` : null, iso(at), iso(at), iso(at)).run()
  return Number(r.meta.last_row_id)
}
const count = async (where = '1') => (await db.prepare(`SELECT COUNT(*) AS n FROM ig_insights WHERE ${where}`).first()).n

// Admin cookie JWT, same as instagram-test.mjs.
function adminToken(id) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const raw = `${encode({ alg: 'HS256' })}.${encode({ sub: String(id), role: 'admin', iat: now, exp: now + 3600 })}`
  return `${raw}.${createHmac('sha256', JWT_SECRET).update(raw).digest('base64url')}`
}

try {
  // AC-1: table and upsert key.
  const cols = (await db.prepare('PRAGMA table_info(ig_insights)').all()).results.map((c) => c.name)
  eq(cols, ['id', 'scope', 'ig_media_id', 'metric', 'period', 'end_time', 'value', 'fetched_at'])

  // AC-3: publishing paused (the migration default) does not stop the read-only pull.
  eq((await db.prepare("SELECT value FROM ig_settings WHERE key = 'publish_paused'").first()).value, '1')
  const fresh = await post({ media: 'm1' })
  const old = await post({ media: 'm-old', at: clock - 91 * DAY })
  await post({ status: 'approved' })
  await post({ status: 'failed', media: 'm-failed' })
  const second = await post({ media: 'm2', at: clock - 30 * DAY })
  let s = stub()
  await run(s)

  // AC-2: per-media metrics only for published posts of the last 90 days; daily account metrics for 7 days.
  eq(s.media().map((c) => c.path.split('/').at(-2)).sort(), ['m1', 'm2'])
  eq(s.media()[0].q.metric, IG_MEDIA_METRICS.join(','))
  const accountCalls = s.calls.filter((c) => c.path.includes(`/${USER}/`))
  eq(accountCalls.map((c) => c.q.metric), ['reach', 'follower_count'])
  ok(accountCalls.every((c) => c.q.period === 'day' && Number(c.q.until) - Number(c.q.since) === 7 * 86400), 'account window is 7 days')
  ok(s.calls.every((c) => c.auth === `Bearer ${TOKEN}` && !c.url.includes(TOKEN)), 'token in header only')
  const perRun = 2 * IG_MEDIA_METRICS.length + 2 * 2
  eq(await count(), perRun)
  eq(await count("scope = 'media' AND ig_media_id = 'm-old'"), 0)
  eq(await count("scope = 'account' AND ig_media_id IS NULL AND end_time IS NOT NULL AND period = 'day'"), 4)
  eq((await db.prepare("SELECT value FROM ig_insights WHERE ig_media_id = 'm1' AND metric = 'reach'").first()).value, 1)

  // AC-2: a second run adds no duplicates; values are refreshed in place.
  await run(stub({ media: () => json({ data: IG_MEDIA_METRICS.map((name) => ({ name, period: 'lifetime', values: [{ value: 50 }] })) }) }))
  eq(await count(), perRun, 'second run added rows')
  eq((await db.prepare("SELECT value FROM ig_insights WHERE ig_media_id = 'm1' AND metric = 'reach'").first()).value, 50)

  // AC-2: empty data is no row, never 0; a refused metric (under 100 followers) skips only itself.
  await db.prepare('DELETE FROM ig_insights').run()
  await run(stub({
    media: (id) => json({ data: id === 'm1' ? [{ name: 'reach', period: 'lifetime', values: [] }, { name: 'likes', period: 'lifetime', values: [{ value: 0 }] }] : [] }),
    account: (metric) => (metric === 'follower_count' ? metaError(100) : json({ data: [] })),
  }))
  eq((await db.prepare('SELECT ig_media_id, metric, value FROM ig_insights').all()).results, [{ ig_media_id: 'm1', metric: 'likes', value: 0 }])
  eq(notes.length, 0)

  // AC-3: token error (190) stops at the first refusal with one Telegram message.
  s = stub({ media: () => metaError(190) })
  await run(s)
  eq(s.calls.length, 1, 'pull continued after token error')
  eq(notes.length, 1)
  ok(notes[0].includes('токен') && !notes[0].includes(TOKEN), notes[0])
  // No token configured: no request at all.
  s = stub()
  await pullInsights({ ...env, IG_ACCESS_TOKEN: undefined }, { fetch: s.fetch })
  eq(s.calls.length, 0)

  // Cron routing: the weekly expression runs the pull, never the publisher (no token here, so no outbound either way).
  const worker = await mf.getWorker()
  await worker.scheduled({ cron: '0 3 * * 1' })
  eq(outbound, 0)

  // AC-4: admin readout.
  await db.prepare('DELETE FROM ig_insights').run()
  await run(stub())
  const owner = adminToken(1)
  const get = async (q, token = owner) => {
    const res = await mf.dispatchFetch(`http://localhost/api/admin/instagram/insights${q}`, { headers: { Cookie: `admin_token=${token}` } })
    return { status: res.status, body: await res.json() }
  }
  let r = await get('?days=30')
  eq(r.status, 200, JSON.stringify(r.body))
  eq(r.body.days, 30)
  eq(r.body.metrics, IG_MEDIA_METRICS)
  eq(r.body.posts.map((p) => p.id), [fresh], 'only posts of the last 30 days')
  eq(r.body.posts[0].metrics, Object.fromEntries(IG_MEDIA_METRICS.map((m, i) => [m, i + 1])))
  eq([r.body.posts[0].ig_media_id, r.body.posts[0].permalink], ['m1', 'https://www.instagram.com/p/m1/'])
  ok(r.body.posts[0].fetched_at, 'fetched_at')
  r = await get('')
  eq(r.body.days, 30, 'default days')
  r = await get('?days=90')
  eq(r.body.posts.map((p) => p.id), [fresh, second])
  ok(!r.body.posts.some((p) => p.id === old), 'older than 90 days')
  eq((await get('?days=0')).status, 400)
  eq((await get('?days=abc')).status, 400)
  eq((await get('?days=91')).status, 400)
  eq((await get('?days=30', adminToken(2))).status, 403)

  // LOOM-274: suggested times read the same stored reach (ranking itself: instagram-times-test.mjs).
  const times = async (token = owner) => {
    const res = await mf.dispatchFetch('http://localhost/api/admin/instagram/suggested-times', { headers: { Cookie: `admin_token=${token}` } })
    return { status: res.status, body: await res.json() }
  }
  r = await times()
  eq(r.status, 200, JSON.stringify(r.body))
  eq([r.body.basis, r.body.posts, r.body.slots.map((x) => [x.weekday, x.hour])], ['default', 2, [[2, 19], [4, 19], [6, 19]]])
  ok(r.body.slots.every((x) => Date.parse(x.next_at) > Date.now()), 'next_at in the future')
  eq((await times(adminToken(2))).status, 403)

  console.log(`instagram insights pull: ${checks} checks passed`)
} finally {
  await mf.dispose()
}
