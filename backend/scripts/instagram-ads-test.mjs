// LOOM-276: paused, capped Instagram ads on a local D1, Marketing API and Telegram stubbed.
// Never calls the live Marketing API: every request goes to the stub below.
// Run: node backend/scripts/instagram-ads-test.mjs
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
const scratch = await mkdtemp(join(tmpdir(), 'loom-276-'))
const opts = { bundle: true, format: 'esm', platform: 'browser', target: 'es2022' }
await build({ ...opts, entryPoints: [join(root, 'src/index.ts')], outfile: join(scratch, 'worker.mjs') })
await build({ ...opts, entryPoints: [join(root, 'src/lib/instagram-ads.ts')], outfile: join(scratch, 'ads.mjs') })
const ads = await import(pathToFileURL(join(scratch, 'ads.mjs')).href)

const secret = 'local-instagram-ads-test-only-not-a-production-secret'
const jwt = (id) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const raw = `${encode({ alg: 'HS256' })}.${encode({ sub: String(id), role: 'admin', iat: now, exp: now + 3600 })}`
  return `${raw}.${createHmac('sha256', secret).update(raw).digest('base64url')}`
}
let outbound = 0
// The Worker under Miniflare has no Meta secrets: the routes must answer 503 without any request.
const mf = new Miniflare({ modules: true, modulesRoot: scratch, scriptPath: join(scratch, 'worker.mjs'), compatibilityDate: '2024-09-23', cf: false,
  d1Databases: ['DB'], r2Buckets: ['LOOM_UPLOADS', 'LOOM_MODELS'], kvNamespaces: ['RATE_LIMIT'],
  bindings: { JWT_SECRET: secret, ENVIRONMENT: 'test', TELEGRAM_BOT_TOKEN: '', BOT_USERNAME: '' },
  outboundService: () => { outbound++; return new Response('{}', { status: 500 }) } })

let checks = 0
const ok = (value, msg) => { assert.ok(value, msg); checks++ }
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++ }

const OWNER = 1, STAFF = 2
async function call(path, { method = 'GET', body, admin = OWNER, status = 200 } = {}) {
  const headers = { Cookie: `admin_token=${jwt(admin)}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await mf.dispatchFetch(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await res.json()
  eq(res.status, status, `${method} ${path}: ${JSON.stringify(data)}`)
  return data
}

// ─── Marketing API stub: records every request, body included ───────────────
const TOKEN = 'local-ads-token-not-real'
const ACCOUNT = '999'
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
function stub(routes = {}) {
  const calls = []
  const fetch = async (url, init = {}) => {
    const u = new URL(url)
    const body = init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : {}
    calls.push({ method: init.method, path: u.pathname, url: String(url), auth: new Headers(init.headers).get('authorization'), body })
    const pick = (route, fallback) => (typeof route === 'function' ? route(body) : route ?? fallback)
    if (init.method === 'POST') {
      const edge = u.pathname.split('/').pop()
      return pick(routes[edge], json({ id: `${edge}-${calls.length}` }))
    }
    if (u.pathname.endsWith(`/act_${ACCOUNT}`)) return pick(routes.account, json({ currency: 'USD', id: `act_${ACCOUNT}` }))
    if (u.pathname.endsWith('/insights')) return pick(routes.insights, json({ data: [{ spend: '40.00' }] }))
    if (u.searchParams.get('ids')) return pick(routes.ids, json({}))
    throw new Error(`unexpected stub call ${init.method} ${u.pathname}`)
  }
  return { fetch, calls, posts: () => calls.filter((c) => c.method === 'POST') }
}

const db = await mf.getD1Database('DB')
for (const file of (await readdir(join(root, 'migrations'))).filter((name) => name.endsWith('.sql')).sort()) {
  const sql = (await readFile(join(root, 'migrations', file), 'utf8')).replace(/--[^\n]*/g, '')
  for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run()
}
await db.prepare('DELETE FROM admins').run()
await db.prepare("INSERT INTO admins (id,email,password_hash,role,created_at) VALUES (1,'owner@test.invalid','x','owner',1),(2,'staff@test.invalid','x','staff',1)").run()

let clock = Date.parse('2026-11-05T14:00:00.000Z')
const iso = (ms) => new Date(ms).toISOString()
const notes = []
const env = { DB: db, IG_USER_ID: '1784', META_AD_ACCOUNT_ID: ACCOUNT, META_ADS_ACCESS_TOKEN: TOKEN, META_PAGE_ID: '555', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' }
const deps = (s) => ({ fetch: s.fetch, now: () => clock, notify: async (t) => { notes.push(t) } })
const create = (s, input = {}) => ads.createIgAd(env, { post_id: postId, budget_usd: 20, days: 5, ...input }, OWNER, deps(s))
const setPaused = (v) => db.prepare("UPDATE ig_settings SET value = ? WHERE key = 'publish_paused'").bind(v).run()
const rows = async () => (await db.prepare('SELECT * FROM ig_ads ORDER BY id').all()).results
const reset = async () => { await db.prepare('DELETE FROM ig_ads').run(); notes.length = 0 }
const postId = Number((await db.prepare(`INSERT INTO ig_posts (caption_uz, langs, status, ig_media_id, approved_by, created_at, updated_at)
  VALUES ('Salom', 'uz', 'published', 'media-77', 1, ?, ?)`).bind(iso(clock), iso(clock)).run()).meta.last_row_id)
const draftId = Number((await db.prepare(`INSERT INTO ig_posts (caption_uz, langs, status, created_at, updated_at)
  VALUES ('Salom', 'uz', 'draft', ?, ?)`).bind(iso(clock), iso(clock)).run()).meta.last_row_id)

try {
  // AC-1: schema and seeds.
  const cols = (await db.prepare('PRAGMA table_info(ig_ads)').all()).results.map((r) => r.name)
  for (const col of ['id', 'ig_post_id', 'campaign_id', 'adset_id', 'ad_id', 'budget_usd_cents', 'budget_type', 'start_at', 'end_at', 'status_seen', 'created_by', 'created_at', 'error']) ok(cols.includes(col), col)
  eq((await db.prepare("SELECT value FROM ig_settings WHERE key = 'ads_monthly_cap_usd'").first()).value, '60')
  eq(ads.parseTargeting((await db.prepare("SELECT value FROM ig_settings WHERE key = 'ads_targeting'").first()).value),
    { countries: ['UZ'], age_min: 18, age_max: 35, genders: [], interests: [] })

  // AC-2: no file under backend/src contains the word that would switch an ad on.
  const walk = async (dir) => (await Promise.all((await readdir(dir, { withFileTypes: true }))
    .map((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])))).flat()
  for (const file of await walk(join(root, 'src'))) ok(!(await readFile(file, 'utf8')).includes('ACTIVE'), `ACTIVE in ${file}`)

  // AC-3: the cap function, ticket examples and the hard ceiling.
  const cap = ads.capCents('60')
  eq(cap, 6000)
  eq(ads.overCap(4000, 1000, 1500, cap), true, 'spent 40 + committed 10 + new 15')
  eq(ads.overCap(4000, 0, 2000, cap), false, 'spent 40 + new 20')
  eq([ads.capCents('100'), ads.capCents('30'), ads.capCents('abc'), ads.capCents(null), ads.capCents('-5')], [6000, 3000, 0, 0, 0])

  // Routes: not configured → 503 and no request; staff → 403; cap above 60 refused.
  await call('/api/admin/instagram/ads', { status: 503 })
  await call('/api/admin/instagram/ads', { method: 'POST', body: { post_id: postId, budget_usd: 5, days: 3 }, status: 503 })
  await call('/api/admin/instagram/ads', { admin: STAFF, status: 403 })
  eq(outbound, 0, 'unconfigured routes made a request')
  ok((await call('/api/admin/instagram/settings')).ads_configured === false, 'ads_configured false')
  await call('/api/admin/instagram/ads/settings', { method: 'PUT', body: { ads_monthly_cap_usd: 61 }, status: 400 })
  await call('/api/admin/instagram/ads/settings', { method: 'PUT', body: { ads_monthly_cap_usd: 50 } })
  eq((await db.prepare("SELECT value FROM ig_settings WHERE key = 'ads_monthly_cap_usd'").first()).value, '50')
  await call('/api/admin/instagram/ads/settings', { method: 'PUT', body: { ads_monthly_cap_usd: 60, ads_targeting: { countries: ['UZ', 'KZ'], age_min: 18, age_max: 30, genders: [2], interests: [{ id: '6003', name: 'Fashion' }] } } })
  await call('/api/admin/instagram/ads/settings', { method: 'PUT', body: { ads_targeting: { countries: ['uz'], age_min: 18, age_max: 30 } }, status: 400 })
  await call('/api/admin/instagram/ads/settings', { method: 'PUT', body: { ads_targeting: { countries: ['UZ'], age_min: 13, age_max: 30 } }, status: 400 })
  // LOOM-277: the admin Ads tab reads stored targeting from settings, even before Meta is connected.
  eq((await call('/api/admin/instagram/settings')).ads_targeting, { countries: ['UZ', 'KZ'], age_min: 18, age_max: 30, genders: [2], interests: [{ id: '6003', name: 'Fashion' }] })

  // AC-4: kill switch (the migration default) → 423 and no call.
  let s = stub()
  let r = await create(s)
  eq([r.status, r.body.code, s.calls.length], [423, 'ig_ads_paused', 0])
  await setPaused('0')

  // Input and post checks make no create call.
  for (const [input, code] of [[{ budget_usd: 0.5 }, 'ig_ads_input'], [{ days: 31 }, 'ig_ads_input'], [{ post_id: draftId }, 'ig_ads_post_not_published'], [{ post_id: 9999 }, 'not_found']]) {
    r = await create(s, input)
    eq([r.body.code, s.calls.length], [code, 0], code)
  }

  // Happy path: spent 40 + new 20 = cap → created; three creates, each PAUSED.
  s = stub()
  r = await create(s)
  eq(r.status, 201, JSON.stringify(r.body))
  const posts = s.posts()
  eq(posts.map((c) => c.path.split('/').pop()), ['campaigns', 'adsets', 'ads'])
  ok(posts.every((c) => c.body.status === 'PAUSED'), 'every create sends PAUSED')
  ok(s.calls.every((c) => c.auth === `Bearer ${TOKEN}` && !c.url.includes(TOKEN)), 'token in header only')
  const [campaign, adset, ad] = posts.map((c) => c.body)
  eq([campaign.objective, campaign.special_ad_categories], ['OUTCOME_AWARENESS', '[]'])
  eq([adset.campaign_id, adset.lifetime_budget, adset.end_time - adset.start_time], [r.body.ad.campaign_id, '2000', 5 * 86400])
  const targeting = JSON.parse(adset.targeting)
  eq([targeting.geo_locations.countries, targeting.age_max, targeting.genders, targeting.publisher_platforms, targeting.flexible_spec[0].interests[0].id],
    [['UZ', 'KZ'], 30, [2], ['instagram'], '6003'])
  eq(JSON.parse(ad.creative), { object_id: '555', instagram_user_id: '1784', source_instagram_media_id: 'media-77' })
  eq(ad.adset_id, r.body.ad.adset_id)
  const made = r.body.ad
  eq([made.budget_usd_cents, made.budget_type, made.status_seen, made.error, Boolean(made.campaign_id && made.adset_id && made.ad_id)], [2000, 'lifetime', 'PAUSED', null, true])

  // AC-3: that 20 is now committed: spent 40 + committed 20 + new 1 → 422, no create.
  s = stub()
  r = await create(s, { budget_usd: 1 })
  eq([r.status, r.body.code, r.body.committed_usd, s.posts().length], [422, 'ig_ads_over_cap', 20, 0])
  // Ticket example: spent 40 + committed 10 + new 15 → 422.
  await reset()
  await db.prepare(`INSERT INTO ig_ads (ig_post_id, adset_id, budget_usd_cents, start_at, end_at, created_at) VALUES (?, 'x', 1000, ?, ?, ?)`)
    .bind(postId, iso(clock), iso(clock + 86400000), iso(clock)).run()
  s = stub()
  r = await create(s, { budget_usd: 15 })
  eq([r.status, r.body.code, s.posts().length], [422, 'ig_ads_over_cap', 0])
  // An ended ad no longer counts; a lowered cap is respected.
  clock += 2 * 86400000
  r = await create(stub(), { budget_usd: 15 })
  eq(r.status, 201)
  await reset()
  await db.prepare("UPDATE ig_settings SET value = '45' WHERE key = 'ads_monthly_cap_usd'").run()
  r = await create(stub(), { budget_usd: 10 })
  eq([r.status, r.body.cap_usd], [422, 45])
  // A cap edited above 60 behind the API still counts as 60.
  await db.prepare("UPDATE ig_settings SET value = '500' WHERE key = 'ads_monthly_cap_usd'").run()
  r = await create(stub(), { budget_usd: 21 })
  eq([r.status, r.body.cap_usd], [422, 60])
  await db.prepare("UPDATE ig_settings SET value = '60' WHERE key = 'ads_monthly_cap_usd'").run()

  // Account not in USD, or spend unreadable → refused before any create.
  s = stub({ account: json({ currency: 'UZS' }) })
  r = await create(s)
  eq([r.status, r.body.code, s.posts().length], [422, 'ig_ads_currency', 0])
  s = stub({ insights: json({ error: { code: 1, message: `boom ${TOKEN}` } }, 500) })
  r = await create(s)
  eq([r.status, r.body.code, s.posts().length], [502, 'ig_ads_meta', 0])
  ok(!r.body.error.includes(TOKEN), 'token removed from Meta error')
  eq((await rows()).length, 0)

  // AC-5: ad set create fails after the campaign → ids so far + error stored, one Telegram message, no ad create.
  s = stub({ adsets: json({ error: { code: 100, message: 'Invalid parameter' } }, 400) })
  r = await create(s)
  eq([r.status, r.body.code], [502, 'ig_ads_meta'])
  const [partial] = await rows()
  ok(partial.campaign_id && !partial.adset_id && !partial.ad_id, 'campaign id kept')
  ok(partial.error.includes('ad set') && partial.error.includes('code 100'), partial.error)
  eq(s.posts().map((c) => c.path.split('/').pop()), ['campaigns', 'adsets'])
  ok(s.posts().every((c) => c.body.status === 'PAUSED'))
  eq(notes.length, 1)
  ok(notes[0].includes(`#${partial.id}`) && notes[0].includes('паузе'), notes[0])
  // A failed attempt without an ad set commits nothing: the next one is not blocked by it.
  r = await create(stub())
  eq(r.status, 201)

  // AC-6: list with Meta status, spend to date and the month against the cap.
  const adId = r.body.ad.ad_id
  s = stub({ ids: json({ [adId]: { id: adId, effective_status: 'CAMPAIGN_PAUSED', insights: { data: [{ spend: '3.25' }] } } }), insights: json({ data: [{ spend: '12.50' }] }) })
  r = await ads.listIgAdsWithSpend(env, deps(s))
  eq(r.status, 200)
  const listed = r.body.items.find((i) => i.ad_id === adId)
  eq([listed.status_seen, listed.spend_usd, listed.budget_usd], ['CAMPAIGN_PAUSED', 3.25, 20])
  eq(r.body.month, { spent_usd: 12.5, committed_usd: 20, cap_usd: 60, cap_max_usd: 60 })
  eq(r.body.meta_error, null)
  eq(s.posts().length, 0, 'list made a write')
  ok(s.calls.some((c) => c.url.includes(`ids=${adId}`)), 'statuses read by id')
  eq((await db.prepare('SELECT status_seen FROM ig_ads WHERE ad_id = ?').bind(adId).first()).status_seen, 'CAMPAIGN_PAUSED')
  // Meta down: rows still listed with the last status seen.
  r = await ads.listIgAdsWithSpend(env, deps(stub({ ids: json({ error: { message: 'down' } }, 503) })))
  eq([r.status, r.body.items.length, r.body.month.spent_usd], [200, 2, null])
  ok(r.body.meta_error.includes('down'), 'meta_error shown')

  console.log(`instagram ads: ${checks} checks passed`)
} finally {
  await mf.dispose()
}
