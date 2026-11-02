// LOOM-271: Instagram publishing cron on a local D1, Meta and Telegram stubbed.
// Never calls the live Graph API: every request goes to the stub below.
// Run: node backend/scripts/instagram-publish-test.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const { build } = require('esbuild')
const { Miniflare } = require('miniflare')
const scratch = await mkdtemp(join(tmpdir(), 'loom-271-'))
const opts = { bundle: true, format: 'esm', platform: 'browser', target: 'es2022' }
await build({ ...opts, entryPoints: [join(root, 'src/index.ts')], outfile: join(scratch, 'worker.mjs') })
await build({ ...opts, entryPoints: [join(root, 'src/lib/instagram-publish.ts')], outfile: join(scratch, 'publish.mjs') })
const { publishDuePosts } = await import(pathToFileURL(join(scratch, 'publish.mjs')).href)

const TOKEN = 'local-test-token-not-real'
const USER = '1784'
let outbound = 0
const mf = new Miniflare({ modules: true, modulesRoot: scratch, scriptPath: join(scratch, 'worker.mjs'), compatibilityDate: '2024-09-23', cf: false,
  d1Databases: ['DB'], r2Buckets: ['LOOM_UPLOADS', 'LOOM_MODELS'], kvNamespaces: ['RATE_LIMIT'],
  bindings: { JWT_SECRET: 'x', ENVIRONMENT: 'test', TELEGRAM_BOT_TOKEN: '', BOT_USERNAME: '', IG_ACCESS_TOKEN: TOKEN, IG_USER_ID: USER },
  outboundService: () => { outbound++; return new Response('{}', { status: 500 }) } })

let checks = 0
const ok = (value, msg) => { assert.ok(value, msg); checks++ }
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++ }

// ─── Meta stub ───────────────────────────────────────────────────────────────
// routes: { media, status: [..status_code per poll], publish, permalink, limit } each a value or (call) => Response
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const metaError = (code, status = 400, message = `stub error ${code} ${TOKEN}`) => json({ error: { code, message } }, status)
function stub(routes = {}) {
  const calls = []
  let poll = 0
  const fetch = async (url, init = {}) => {
    const u = new URL(url)
    const body = init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : {}
    calls.push({ method: init.method, path: u.pathname, url: String(url), auth: new Headers(init.headers).get('authorization'), body })
    await new Promise((r) => setTimeout(r, 2)) // let parallel runs interleave
    const pick = (route, fallback) => (typeof route === 'function' ? route(body) : route ?? fallback)
    if (u.pathname.endsWith('/content_publishing_limit')) return pick(routes.limit, json({ data: [{ quota_usage: 0, config: { quota_total: 100 } }] }))
    if (u.pathname.endsWith(`/${USER}/media`)) return pick(routes.media, json({ id: `c${calls.length}` }))
    if (u.pathname.endsWith('/media_publish')) return pick(routes.publish, json({ id: `m-${body.creation_id}` }))
    if (u.searchParams.get('fields') === 'permalink') return pick(routes.permalink, json({ permalink: `https://www.instagram.com/p/${u.pathname.split('/').pop()}/` }))
    if (u.searchParams.get('fields') === 'status_code,status') {
      const codes = routes.status ?? ['FINISHED']
      const code = codes[Math.min(poll++, codes.length - 1)]
      return typeof code === 'function' ? code() : json({ status_code: code, status: `${code} detail` })
    }
    throw new Error(`unexpected stub call ${u.pathname}`)
  }
  return { fetch, calls, count: (suffix) => calls.filter((c) => c.path.endsWith(suffix)).length }
}

const db = await mf.getD1Database('DB')
for (const file of (await readdir(join(root, 'migrations'))).filter((name) => name.endsWith('.sql')).sort()) {
  const sql = (await readFile(join(root, 'migrations', file), 'utf8')).replace(/--[^\n]*/g, '')
  for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run()
}
await db.prepare('DELETE FROM admins').run()
await db.prepare("INSERT INTO admins (id,email,password_hash,role,created_at) VALUES (1,'owner@test.invalid','x','owner',1)").run()

let clock = Date.parse('2026-11-05T14:00:00.000Z')
const iso = (ms) => new Date(ms).toISOString()
const notes = []
const env = { DB: db, IG_ACCESS_TOKEN: TOKEN, IG_USER_ID: USER, TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' }
const run = (s, extra = {}) => publishDuePosts(env, { fetch: s.fetch, now: () => clock, sleep: async (ms) => { clock += ms }, notify: async (t) => { notes.push(t) }, ...extra })
const setPaused = (v) => db.prepare("UPDATE ig_settings SET value = ? WHERE key = 'publish_paused'").bind(v).run()
async function post({ status = 'approved', approved_by = 1, at = clock - 60_000, attempts = 0, container = null } = {}) {
  const r = await db.prepare(`INSERT INTO ig_posts (caption_uz, caption_ru, caption_en, langs, media_key, media_url, publish_at, status, attempts, ig_container_id, approved_by, created_at, updated_at)
    VALUES ('Salom', 'Привет', 'Hi', 'uz,ru,en', 'instagram/x.jpg', 'https://api.example.test/api/files/instagram/x.jpg', ?, ?, ?, ?, ?, ?, ?)`)
    .bind(iso(at), status, attempts, container, approved_by, iso(clock - 600_000), iso(clock - 600_000)).run()
  return Number(r.meta.last_row_id)
}
const row = (id) => db.prepare('SELECT * FROM ig_posts WHERE id = ?').bind(id).first()
const reset = async () => { await db.prepare('DELETE FROM ig_posts').run(); notes.length = 0; await setPaused('0') }

try {
  // AC-1: the bundled Worker exports a scheduled handler.
  const worker = await mf.getWorker()
  // AC-2: paused (the migration default) → the real scheduled handler makes no outbound request.
  const due = await post()
  await worker.scheduled({ cron: '*/5 * * * *' })
  eq(outbound, 0, 'paused cron made a request')
  eq((await row(due)).status, 'approved')
  let s = stub()
  await run(s)
  eq(s.calls.length, 0, 'paused: injected fetch called')
  await reset()
  await publishDuePosts({ ...env, IG_ACCESS_TOKEN: undefined }, { fetch: s.fetch })
  eq(s.calls.length, 0, 'no token: no call to Meta')

  // AC-3: only approved + approved_by + due; at most 5 per run.
  const skip = {
    draft: await post({ status: 'draft' }),
    future: await post({ at: clock + 3_600_000 }),
    unapproved: await post({ approved_by: null }),
    published: await post({ status: 'published' }),
    failed: await post({ status: 'failed' }),
    rejected: await post({ status: 'rejected' }),
  }
  const dueIds = []
  for (let i = 0; i < 6; i++) dueIds.push(await post())
  s = stub()
  await run(s)
  eq(s.count('/media_publish'), 5, 'at most 5 per run')
  const statuses = await Promise.all(dueIds.map(async (id) => (await row(id)).status))
  eq(statuses.filter((x) => x === 'published').length, 5)
  eq(statuses.filter((x) => x === 'approved').length, 1)
  const untouched = { draft: 'draft', future: 'approved', unapproved: 'approved', published: 'published', failed: 'failed', rejected: 'rejected' }
  for (const [name, id] of Object.entries(skip)) eq([(await row(id)).status, (await row(id)).ig_container_id], [untouched[name], null], name)
  eq(s.count(`/${USER}/media`), 5)
  // Token only in the header, never in a URL.
  ok(s.calls.every((c) => c.auth === `Bearer ${TOKEN}` && !c.url.includes(TOKEN)), 'token in header only')
  ok(s.calls.filter((c) => c.path.endsWith(`/${USER}/media`)).every((c) => c.body.caption === 'Salom\n\nПривет\n\nHi' && c.body.image_url.endsWith('x.jpg')), 'caption + image sent')

  // AC-3: two overlapping runs publish each post once.
  await reset()
  const pair = [await post(), await post(), await post()]
  s = stub()
  await Promise.all([run(s), run(s)])
  eq(s.count('/media_publish'), 3, 'overlapping runs published a post twice')
  eq(s.count(`/${USER}/media`), 3)
  for (const id of pair) eq((await row(id)).status, 'published')

  // AC-4: happy path with IN_PROGRESS then FINISHED.
  await reset()
  let id = await post()
  s = stub({ status: ['IN_PROGRESS', 'FINISHED'] })
  await run(s)
  let r = await row(id)
  eq([r.status, r.ig_container_id, r.ig_media_id, r.attempts, r.error], ['published', 'c2', 'm-c2', 0, null])
  eq(r.permalink, 'https://www.instagram.com/p/m-c2/')
  ok(r.published_at, 'published_at set')

  // AC-4: still IN_PROGRESS at the end of the budget → stays publishing, polled next run, never re-created.
  await reset()
  id = await post()
  s = stub({ status: ['IN_PROGRESS'] })
  await run(s)
  r = await row(id)
  eq([r.status, r.ig_container_id], ['publishing', 'c2'])
  await run(s) // a run inside the lease leaves it alone
  const polls = s.calls.length
  clock += 5 * 60_000 // next cron tick
  s.calls.length = 0
  const s2 = stub({ status: ['FINISHED'] })
  await run(s2)
  r = await row(id)
  eq(s2.count(`/${USER}/media`), 0, 'container re-created')
  eq([r.status, r.ig_container_id, r.ig_media_id], ['published', 'c2', 'm-c2'])
  ok(polls > 3, 'polled within the budget')

  // AC-5: 5xx, timeout, rate limit → attempts up, back to approved; 3rd attempt → failed.
  await reset()
  id = await post()
  await run(stub({ media: json({ error: { message: 'boom' } }, 503) }))
  r = await row(id)
  eq([r.status, r.attempts], ['approved', 1])
  await run(stub({ media: () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }) } }))
  r = await row(id)
  eq([r.status, r.attempts], ['approved', 2])
  eq(notes.length, 0)
  await run(stub({ media: metaError(4) }))
  r = await row(id)
  eq([r.status, r.attempts], ['failed', 3])
  ok(r.error.includes('code 4') && !r.error.includes(TOKEN), 'Meta error kept, token removed')
  // AC-6: exactly one Telegram message with the post id.
  eq(notes.length, 1)
  ok(notes[0].includes(`#${id}`) && notes[0].includes('code 4') && !notes[0].includes(TOKEN), notes[0])

  // AC-5: any 4xx, ERROR, EXPIRED → failed at once.
  for (const [label, routes] of [['4xx', { media: metaError(100) }], ['ERROR', { status: ['ERROR'] }], ['EXPIRED', { status: ['EXPIRED'] }]]) {
    await reset()
    id = await post()
    await run(stub(routes))
    r = await row(id)
    eq([r.status, r.attempts], ['failed', 1], label)
    eq(notes.length, 1, label)
  }
  // A container Meta already published is never published again.
  await reset()
  id = await post({ container: 'c-old' })
  s = stub({ status: ['PUBLISHED'] })
  await run(s)
  eq([(await row(id)).status, s.count('/media_publish'), s.count(`/${USER}/media`)], ['failed', 0, 0])

  // AC-5: no quota left → posts wait without spending an attempt.
  await reset()
  id = await post()
  s = stub({ limit: json({ data: [{ quota_usage: 100, config: { quota_total: 100 } }] }) })
  await run(s)
  r = await row(id)
  eq([r.status, r.attempts, s.calls.length], ['approved', 0, 1])

  // AC-7: token error (190) → paused, post approved, attempts unchanged, one message, next run silent.
  await reset()
  id = await post({ attempts: 1 })
  const id2 = await post()
  s = stub({ media: metaError(190) })
  await run(s)
  r = await row(id)
  eq([r.status, r.attempts], ['approved', 1])
  eq((await row(id2)).status, 'approved')
  eq((await db.prepare("SELECT value FROM ig_settings WHERE key = 'publish_paused'").first()).value, '1')
  eq(notes.length, 1)
  ok(notes[0].includes('токен') && !notes[0].includes(TOKEN), notes[0])
  s = stub()
  await run(s)
  eq(s.calls.length, 0, 'paused after token error')
  // Token refused on the quota check: same pause, one message.
  await reset()
  await post()
  await run(stub({ limit: metaError(190) }))
  eq(notes.length, 1)
  eq((await db.prepare("SELECT value FROM ig_settings WHERE key = 'publish_paused'").first()).value, '1')

  console.log(`instagram publishing cron: ${checks} checks passed`)
} finally {
  await mf.dispose()
}
