// Run: node backend/scripts/funnel-test.mjs
// Real Worker routes + ephemeral local D1. Never connects to remote bindings.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHmac } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const { build } = require('esbuild')
const { Miniflare } = require('miniflare')
const scratch = await mkdtemp(join(tmpdir(), 'loom-funnel-'))
const secret = 'local-funnel-test-only'
function token(id, role = 'admin') {
  const encode = (v) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const raw = `${encode({ alg: 'HS256' })}.${encode({ sub: String(id), role, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}`
  return `${raw}.${createHmac('sha256', secret).update(raw).digest('base64url')}`
}
await build({ entryPoints: [join(root, 'src/index.ts')], outfile: join(scratch, 'worker.mjs'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022' })
const serve = process.argv.includes('--serve')
const mf = new Miniflare({ modules: true, modulesRoot: scratch, scriptPath: join(scratch, 'worker.mjs'), compatibilityDate: '2024-09-23', cf: false,
  ...(serve ? { port: 8790, host: 'localhost' } : {}), d1Databases: ['DB'], r2Buckets: ['LOOM_UPLOADS', 'LOOM_MODELS'], kvNamespaces: ['RATE_LIMIT'],
  bindings: { JWT_SECRET: secret, ENVIRONMENT: 'test', TELEGRAM_BOT_TOKEN: '', BOT_USERNAME: '' } })
let checks = 0
async function request(query = '', { status = 200, cookie = token(1) } = {}) {
  const res = await mf.dispatchFetch(`http://localhost/api/admin/analytics/funnel${query}`, {
    headers: cookie ? { Cookie: `admin_token=${cookie}` } : {},
  })
  const data = await res.json()
  assert.equal(res.status, status, JSON.stringify(data))
  if (status === 200) assert.equal(res.headers.get('cache-control'), 'no-store')
  checks++
  return data
}
try {
  const db = await mf.getD1Database('DB')
  for (const file of (await readdir(join(root, 'migrations'))).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = (await readFile(join(root, 'migrations', file), 'utf8')).replace(/--[^\n]*/g, '')
    for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(statement).run()
  }
  await db.prepare('DELETE FROM admins').run()
  await db.prepare("INSERT INTO admins (id,email,password_hash,role,created_at) VALUES (1,'qa-admin@loom.test','unused','owner',1),(2,'qa-staff@loom.test','unused','staff',1)").run()
  await db.prepare("INSERT INTO users (id,email,password_hash,created_at) VALUES (1,'qa-user@loom.test','unused',1)").run()
  await request('', { status: 401, cookie: null })
  await request('', { status: 401, cookie: token(1, 'user') })
  await request('', { status: 401, cookie: token(999) })
  await db.prepare("INSERT INTO admin_permissions (admin_id,capability,granted,updated_at) VALUES (2,'analytics.view',0,1)").run()
  await request('', { status: 403, cookie: token(2) })
  await db.prepare('DELETE FROM admin_permissions WHERE admin_id = 2').run()
  await request('', { cookie: token(2) })

  const empty = await request()
  assert.equal(empty.daily.length, 60)
  assert.equal(Date.parse(empty.to) - Date.parse(empty.from), 29 * 86400000)
  assert.equal(empty.to, new Date().toISOString().slice(0, 10))
  assert.ok(empty.daily.every((r) => r.opens === 0 && r.placed === 0))
  for (const query of ['?from=bad', '?from=', '?from=2026-02-30', '?from=2026-10-07&to=2026-10-06',
    '?from=2025-01-01&to=2026-01-02', '?to=2026-1-1', '?from=2026-10-01T00:00:00Z']) {
    assert.equal((await request(query, { status: 400 })).code, 'funnel_range')
  }
  assert.equal((await request('?from=2024-01-01&to=2024-12-31')).daily.length, 732)
  const start = Date.parse('2026-10-05'), day = 86400000, end = start + 2 * day
  async function event(session, name, time, device = 'desktop') {
    await db.prepare("INSERT INTO page_visits (session_id,page,device_type,event,visited_at) VALUES (?,'/configurator',?,?,?)")
      .bind(session, device, name, time).run()
  }
  async function order(id, session, time, status = 'new') {
    await db.prepare("INSERT INTO orders (id,user_id,customer_name,customer_phone,design_json,total_price,status,session_id,created_at,updated_at) VALUES (?,1,'QA User','+998900000000','{}',100000,?,?,?,?)")
      .bind(id, status, session, time, time).run()
  }
  async function steps(session, time, device = 'desktop') {
    await event(session, 'cfg_open', time, device)
    await event(session, 'cfg_cart', time + 10, device)
    await event(session, 'cfg_checkout_submit', time + 20, device)
  }
  await steps('web-full', start)
  await event('web-full', 'cfg_open', start + 1)
  await event('web-full', 'cfg_cart', start + 11)
  await order(100, 'web-full', start + 30)
  await event('web-full', 'order_placed', start + 30)
  await event('web-full', 'order_placed', start + 30) // duplicate receipt
  await steps('web-full', start + day) // same session, next day
  await order(101, 'web-full', start + day + 30)
  await event('web-full', 'order_placed', start + day + 30)
  for (const [id, session, status] of [[102, 'cancelled', 'cancelled'], [54, 'known-test', 'new']]) {
    await steps(session, start + 100)
    await order(id, session, start + 130, status)
    await event(session, 'order_placed', start + 130)
  }
  await steps('click-only', start + 200)
  await event('click-only', 'cfg_order', start + 230) // click is never an order
  await steps('unmatched', start + 300)
  await order(103, 'unmatched', start + 331)
  await event('unmatched', 'order_placed', start + 330) // no matching server timestamp
  await event('out-of-order', 'cfg_cart', start + 400)
  await event('out-of-order', 'cfg_open', start + 410)
  await event('out-of-order', 'cfg_checkout_submit', start + 420)
  await event('orphan', 'cfg_cart', start + 500)
  await event('orphan', 'order_placed', start + 510)
  await event('old-session', 'cfg_open', start - 1)
  await event('old-session', 'cfg_cart', start + 1)
  await steps('future', end)
  await order(104, 'future', end + 30)
  await event('future', 'order_placed', end + 30)
  await event('', 'cfg_open', start + 1)
  await steps('app_full', start + 600, 'ios') // legacy app prefix
  await order(105, 'app_full', start + 630)
  await event('app_full', 'order_placed', start + 630, 'app')
  await event('native-device', 'cfg_open', start + 700, 'app')
  await event('native-device', 'cfg_cart', start + day + 700, 'app')
  await event('native-device', 'cfg_checkout_submit', start + day + 710, 'app')
  await order(106, 'native-device', start + day + 720)
  await event('native-device', 'order_placed', start + day + 720, 'app')
  await event('app_quiet', 'cfg_open', start + day + 800, 'app')

  const data = await request('?from=2026-10-05&to=2026-10-06')
  assert.deepEqual(data.totals, {
    web: { opens: 6, carts: 5, checkouts: 5, placed: 1, orders: 2 },
    app: { opens: 3, carts: 2, checkouts: 2, placed: 2, orders: 2 },
  })
  assert.deepEqual(data.daily, [
    { day: '2026-10-05', platform: 'web', ...data.totals.web },
    { day: '2026-10-05', platform: 'app', opens: 2, carts: 2, checkouts: 2, placed: 2, orders: 2 },
    { day: '2026-10-06', platform: 'web', opens: 0, carts: 0, checkouts: 0, placed: 0, orders: 0 },
    { day: '2026-10-06', platform: 'app', opens: 1, carts: 0, checkouts: 0, placed: 0, orders: 0 },
  ])
  // Independent read-only D1 SELECTs verify the range's unique opens and real
  // orders in these fixtures. Cancelled and test rows are deliberately present.
  const opens = await db.prepare("SELECT COUNT(DISTINCT session_id) AS n FROM page_visits WHERE event = 'cfg_open' AND session_id != '' AND visited_at >= ? AND visited_at < ?")
    .bind(start, end).first()
  assert.equal(data.totals.web.opens + data.totals.app.opens, opens.n)
  const placed = await db.prepare(`SELECT COUNT(DISTINCT o.id) AS n FROM orders o
    JOIN page_visits v ON v.session_id = o.session_id AND v.visited_at = o.created_at AND v.event = 'order_placed'
    WHERE o.status != 'cancelled' AND o.id != 54 AND o.created_at >= ? AND o.created_at < ?`).bind(start, end).first()
  assert.equal(data.totals.web.orders + data.totals.app.orders, placed.n)
  assert.equal((await request('?from=2026-10-06&to=2026-10-06')).totals.web.opens, 1)
  await db.prepare("UPDATE orders SET status = 'cancelled' WHERE id IN (100,101)").run()
  assert.equal((await request('?from=2026-10-05&to=2026-10-06')).totals.web.placed, 0)
  await db.prepare("UPDATE orders SET status = 'new' WHERE id IN (100,101)").run()
  // Exercise M2's actual public tracker + cart/atomic checkout writer: the
  // analytics join must work with real server timestamps, including a retry.
  await db.prepare('UPDATE users SET telegram_user_id = 123456 WHERE id = 1').run()
  await db.prepare("INSERT INTO products (id,slug,name_ru,price,active,created_at,updated_at) VALUES (1001,'funnel-test','QA',100000,1,1,1)").run()
  async function post(path, body, status, headers = {}) {
    const res = await mf.dispatchFetch(`http://localhost${path}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
    const data = await res.json()
    assert.equal(res.status, status, JSON.stringify(data))
    if (path === '/api/files/track') {
      // Tracking is written via executionCtx.waitUntil after the response.
      let recorded = false
      for (let attempt = 0; attempt < 50; attempt++) {
        recorded = !!await db.prepare('SELECT 1 FROM page_visits WHERE session_id = ? AND event = ?').bind(body.session_id, body.event).first()
        if (recorded) break
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      assert.ok(recorded, 'background tracker write completed')
    }
    checks++
    return data
  }
  for (const platform of ['web', 'app']) {
    const before = (await request()).totals[platform]
    const sessionId = platform === 'app' ? 'app_live-checkout' : 'web-live-checkout'
    for (const name of ['cfg_open', 'cfg_cart', 'cfg_checkout_submit']) {
      await post('/api/files/track', { session_id: sessionId, page: '/configurator', device_type: platform === 'app' ? 'app' : 'mobile', event: name }, 200)
    }
    const auth = { Authorization: `Bearer ${token(1, 'user')}` }
    await post('/api/cart', { productId: 1001, designJson: JSON.stringify({ size: 'M', shirtColor: '#FFFFFF' }) }, 201, auth)
    const headers = { ...auth, 'Idempotency-Key': `funnel-${platform}-checkout` }
    const body = { customerName: 'QA User', customerPhone: '+998900000000', paymentMethod: 'cod', sessionId, platform }
    const placedOrder = await post('/api/cart/checkout', body, 201, headers)
    assert.equal((await post('/api/cart/checkout', body, 200, headers)).id, placedOrder.id)
    const after = (await request()).totals[platform]
    for (const key of ['opens', 'carts', 'checkouts', 'placed', 'orders']) assert.equal(after[key], before[key] + 1, `${platform}: ${key}`)
    const chain = await db.prepare('SELECT event, COUNT(*) AS n FROM page_visits WHERE session_id = ? GROUP BY event ORDER BY event').bind(sessionId).all()
    assert.deepEqual(chain.results, ['cfg_cart', 'cfg_checkout_submit', 'cfg_open', 'order_placed'].map((event) => ({ event, n: 1 })))
  }
  console.log(`PASS: ${checks} route checks; local D1 matches, default/range boundaries, deduplication, platform attribution, chronology, KR3 exclusions, capability checks, real web/app tracker-to-checkout chains and idempotent retries.`)
  if (serve) {
    console.log('Local funnel fixture ready: http://localhost:8790 (ephemeral D1; qa-admin cookie signed with local-funnel-test-only)')
    await new Promise(() => {})
  }
} finally {
  await mf.dispose()
  await rm(scratch, { recursive: true, force: true })
}
