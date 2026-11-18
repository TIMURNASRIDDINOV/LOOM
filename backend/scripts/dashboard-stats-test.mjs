// Admin dashboard figures (LOOM-353) through the real routes on a local D1.
// Run: node backend/scripts/dashboard-stats-test.mjs
// Revenue counts only paid, non-cancelled orders; top products sum order_items
// quantities; new orders split into "can act now" and "awaiting payment";
// customers without a phone count; days are Tashkent days (UTC+5).
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
const scratch = await mkdtemp(join(tmpdir(), 'loom-dashboard-'))
const secret = 'local-dashboard-test-only-not-a-production-secret'
const token = (id) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const raw = `${encode({ alg: 'HS256' })}.${encode({ sub: String(id), role: 'admin', iat: now, exp: now + 3600 })}`
  return `${raw}.${createHmac('sha256', secret).update(raw).digest('base64url')}`
}
await build({ entryPoints: [join(root, 'src/index.ts')], outfile: join(scratch, 'worker.mjs'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022' })
const mf = new Miniflare({ modules: true, modulesRoot: scratch, scriptPath: join(scratch, 'worker.mjs'), compatibilityDate: '2024-09-23', cf: false,
  d1Databases: ['DB'], r2Buckets: ['LOOM_UPLOADS', 'LOOM_MODELS'], kvNamespaces: ['RATE_LIMIT'],
  bindings: { JWT_SECRET: secret, ENVIRONMENT: 'test', TELEGRAM_BOT_TOKEN: '', BOT_USERNAME: '' } })

async function get(path) {
  const res = await mf.dispatchFetch(`http://localhost${path}`, { headers: { Cookie: `admin_token=${token(1)}` } })
  const data = await res.json()
  assert.equal(res.status, 200, `${path}: ${JSON.stringify(data)}`)
  return data
}

const DAY = 86400000, TZ = 5 * 3600000
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10)
const now = Date.now()
const utcMidnight = now - (now % DAY)
const D = utcMidnight - 3 * DAY              // a UTC day three days back
const T0 = D - DAY + 12 * 3600000            // the day before, 12:00 UTC = 17:00 Tashkent, same date
const LATE = D + 21 * 3600000                // 21:00 UTC on D = 02:00 Tashkent on D+1
const tashMidnight = now - ((now + TZ) % DAY) // today 00:00 Tashkent, in UTC ms

try {
  const db = await mf.getD1Database('DB')
  for (const file of (await readdir(join(root, 'migrations'))).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = (await readFile(join(root, 'migrations', file), 'utf8')).replace(/--[^\n]*/g, '')
    for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run()
  }
  await db.prepare('DELETE FROM admins').run()
  await db.prepare("INSERT INTO admins (id,email,password_hash,role,created_at) VALUES (1,'owner@test.invalid','x','owner',1)").run()
  const before = await get('/api/admin/stats')
  assert.equal(Object.values(before.ordersByStatus).reduce((a, b) => a + b, 0), 0, 'migrations seed no orders')

  for (const [id, name] of [[901, 'P1'], [902, 'P2'], [903, 'P3']]) {
    await db.prepare('INSERT INTO products (id,slug,name_ru,price,created_at,updated_at) VALUES (?,?,?,1,1,1)').bind(id, `t-${id}`, name).run()
  }
  // id, status, method, payment_status, total, created_at, lines [product, qty]
  const orders = [
    [1, 'new', 'cod', 'unpaid', 100, T0, [[901, 1]]],                 // cash on delivery: staff acts now, counts as revenue
    [2, 'confirmed', 'p2p', 'paid', 200, T0, [[902, 3], [901, 1]]],   // paid transfer, two-line cart
    [3, 'new', 'p2p', 'unpaid', 400, T0, [[903, 5]]],                 // not paid yet
    [4, 'new', 'p2p', 'pending', 800, T0, [[901, 1]]],                // receipt uploaded, staff must confirm
    [5, 'cancelled', 'cod', 'unpaid', 1600, T0, [[902, 10]]],         // cancelled: nowhere
    [6, 'new', 'p2p', 'failed', 3200, LATE, [[901, 1]]],              // receipt rejected, waits for payment again
  ]
  for (const [id, status, method, pay, total, at, lines] of orders) {
    await db.prepare(`INSERT INTO orders (id,customer_name,customer_phone,design_json,total_price,status,payment_method,payment_status,product_id,created_at,updated_at)
      VALUES (?,'T','+998000000000','{}',?,?,?,?,?,?,?)`).bind(id, total, status, method, pay, lines[0][0], at, at).run()
    for (const [product, qty] of lines) {
      await db.prepare("INSERT INTO order_items (order_id,product_id,design_json,unit_price,quantity,created_at) VALUES (?,?,'{}',1,?,?)").bind(id, product, qty, at).run()
    }
  }
  const usersBefore = before.totalUsers
  await db.prepare("INSERT INTO users (email,password_hash,phone,status,created_at) VALUES ('a@t.invalid','x','+998900000001','active',?)").bind(now).run()
  await db.prepare("INSERT INTO users (email,password_hash,phone,telegram_user_id,status,created_at) VALUES ('b@t.invalid','x',NULL,42,'active',?)").bind(now).run()
  await db.prepare("INSERT INTO users (email,password_hash,phone,status,created_at) VALUES ('c@t.invalid','deleted',NULL,'deleted',?)").bind(now).run()
  await db.prepare("INSERT INTO page_visits (session_id,page,visited_at) VALUES ('yesterday','/',?),('today','/',?)").bind(tashMidnight - 60000, tashMidnight).run()

  const s = await get('/api/admin/stats')
  assert.equal(s.revenueLast30Days, 300, 'revenue: cod + paid p2p only')
  assert.deepEqual(s.topProducts.map((p) => [p.product_id, p.count]), [[903, 5], [901, 4], [902, 3]], 'top products: quantities from order_items, cancelled left out')
  assert.equal(s.ordersByStatus.new, 4)
  assert.equal(s.newToProcess, 2, 'cod new + receipt waiting for staff')
  assert.equal(s.newAwaitingPayment, 2, 'unpaid + rejected transfer')
  assert.equal(s.totalUsers - usersBefore, 2, 'Telegram-only customer counts, deleted does not')
  assert.deepEqual(s.ordersPerDay, [{ day: ymd(T0), count: 5 }, { day: ymd(D + DAY), count: 1 }], '21:00 UTC lands on the next Tashkent day')
  for (const key of ['ordersByStatus', 'revenueLast30Days', 'ordersLast7Days', 'topProducts', 'ordersPerDay', 'recentOrders', 'totalUsers', 'newUsersLast7Days', 'newUsersLast30Days']) {
    assert.ok(key in s, `field ${key} still returned`)
  }

  const v = await get('/api/admin/analytics/visitors')
  assert.equal(v.today, 1, 'today starts at 00:00 Tashkent')
  assert.deepEqual(v.dailyLast30, [{ day: ymd(tashMidnight - 60000 + TZ), count: 1 }, { day: ymd(tashMidnight + TZ), count: 1 }])
  console.log('dashboard-stats-test: all checks passed')
} finally {
  await mf.dispose()
  await rm(scratch, { recursive: true, force: true })
}
