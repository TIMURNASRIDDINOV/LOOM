// Run: node backend/scripts/admin-fixes-test.mjs
// LOOM-352 admin back-end fixes: real Worker routes on an ephemeral local
// D1 / R2 / KV (foreign keys on, as in D1). Telegram is stubbed. Covers the
// order-status paths, customer totals, product and admin deletes, the
// customer-route permission split, and the guards for migrations 0032/0033
// not applied yet. Never connects to remote bindings.
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
const { Miniflare, Response } = require('miniflare')
const scratch = await mkdtemp(join(tmpdir(), 'loom-admin-fixes-'))
const secret = 'local-admin-fixes-test-only'
const token = (id) => {
  const encode = (v) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const raw = `${encode({ alg: 'HS256' })}.${encode({ sub: String(id), role: 'admin', iat: now, exp: now + 3600 })}`
  return `${raw}.${createHmac('sha256', secret).update(raw).digest('base64url')}`
}
await build({ entryPoints: [join(root, 'src/index.ts')], outfile: join(scratch, 'worker.mjs'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022' })

const telegram = []
const worker = () => new Miniflare({ modules: true, modulesRoot: scratch, scriptPath: join(scratch, 'worker.mjs'),
  compatibilityDate: '2024-09-23', cf: false, d1Databases: ['DB'], r2Buckets: ['LOOM_UPLOADS', 'LOOM_MODELS'], kvNamespaces: ['RATE_LIMIT'],
  bindings: { JWT_SECRET: secret, ENVIRONMENT: 'test', TELEGRAM_BOT_TOKEN: 'test-token', BOT_USERNAME: '' },
  outboundService: async (request) => {
    telegram.push(await request.json().catch(() => ({})))
    return Response.json({ ok: true, result: { message_id: telegram.length } })
  } })
const mf = worker()
const old = worker() // migrations 0032 and 0033 not applied yet

let checks = 0
const eq = (actual, expected, message = `check ${checks + 1}`) => { assert.deepEqual(actual, expected, message); checks++ }
async function call(method, path, { status = 200, admin = 1, cookie, body, on = mf } = {}) {
  const headers = { Cookie: cookie ?? (admin ? `admin_token=${token(admin)}` : '') }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await on.dispatchFetch(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null
  assert.equal(res.status, status, `${method} ${path}: ${JSON.stringify(data)}`)
  checks++
  return { data, res }
}
async function login(email, password, status = 200) {
  const { res, data } = await call('POST', '/api/admin/login', { admin: 0, body: { email, password }, status })
  return status === 200 ? res.headers.get('set-cookie').split(';')[0] : data
}

async function migrate(db, below = '9999') {
  for (const file of (await readdir(join(root, 'migrations'))).filter((n) => n.endsWith('.sql') && n < below).sort()) {
    const sql = (await readFile(join(root, 'migrations', file), 'utf8')).replace(/--[^\n]*/g, '')
    for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(statement).run()
  }
  assert.equal((await db.prepare('PRAGMA foreign_keys').first()).foreign_keys, 1, 'foreign keys must be enforced, as in D1')
  await db.prepare('DELETE FROM admins').run()
  await db.prepare("INSERT INTO admins (id,email,password_hash,role,created_at) VALUES (1,'owner@loom.test','x','owner',1),(2,'staff@loom.test','x','staff',1)").run()
  await db.prepare("INSERT INTO users (id,email,password_hash,created_at,telegram_user_id) VALUES (1,'buyer@loom.test','x',1,111)").run()
}

try {
  const db = await mf.getD1Database('DB')
  const oldDb = await old.getD1Database('DB')
  await migrate(db)
  await migrate(oldDb, '0032')
  const order = (id) => db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first()
  const logRows = async (id) => (await db.prepare('SELECT COUNT(*) AS n FROM order_status_log WHERE order_id = ?').bind(id).first()).n
  await db.prepare("INSERT INTO products (id,slug,name_ru,price,active,created_at,updated_at) VALUES (1,'p-order-item','A',1,1,1,1),(2,'p-cart','B',1,1,1,1),(3,'p-free','C',1,1,1,1)").run()
  const insertOrder = (id, status, method, payStatus, total, extra = '') => db.prepare(
    `INSERT INTO orders (id,user_id,customer_name,customer_phone,design_json,total_price,status,payment_method,payment_status,created_at,updated_at${extra ? ',pay_deadline' : ''})
     VALUES (?,1,'QA','+998 90 123-45-67','{}',?,?,?,?,1,1${extra ? ',?' : ''})`).bind(...[id, total, status, method, payStatus, ...(extra ? [extra] : [])]).run()

  // ── C8: customer totals skip cancelled and unconfirmed card-transfer orders ──
  await insertOrder(10, 'delivered', 'cod', 'unpaid', 100)
  await insertOrder(11, 'cancelled', 'cod', 'unpaid', 50)
  await insertOrder(12, 'new', 'p2p', 'unpaid', 70, String(Date.now() + 60000))
  await insertOrder(13, 'confirmed', 'p2p', 'paid', 30)
  const card = (await call('GET', '/api/admin/users/1')).data
  eq([card.orders_count, card.total_spent], [2, 130], 'customer card')
  const list = (await call('GET', '/api/admin/users?page=abc&limit=xyz')).data // C20: NaN page falls back
  eq([list.page, list.limit, list.users[0].orders_count, list.users[0].total_spent], [1, 25, 2, 130], 'customer list')
  await db.prepare("UPDATE users SET phone = '+998 90 123 45 67', last_name = 'Qodirova' WHERE id = 1").run()
  eq((await call('GET', '/api/admin/users?q=901234567')).data.total, 1, 'phone search ignores spacing (C19)')
  eq((await call('GET', '/api/admin/users?q=Qodir')).data.total, 1, 'last name is searched (C19)')
  eq((await call('GET', '/api/admin/orders?q=90%20123%2045&page=x')).data.total, 4, 'phone search ignores spacing (C19)')

  // ── C6: same status is a no-op: no log row, no customer message ──
  let sent = telegram.length
  eq((await call('PATCH', '/api/admin/orders/10/status', { body: { status: 'delivered' } })).data, { ok: true, unchanged: true })
  eq(await logRows(10), 0)
  eq(telegram.length, sent)

  // ── C7: cancelling while a receipt waits is refused ──
  await insertOrder(14, 'new', 'p2p', 'pending', 70, String(Date.now() + 60000))
  eq((await call('PATCH', '/api/admin/orders/14/status', { status: 409, body: { status: 'cancelled' } })).data.code, 'receipt_pending')
  eq((await order(14)).status, 'new')

  // ── C5: a timed-out order moved back to new gets a fresh payment window ──
  await insertOrder(15, 'cancelled', 'p2p', 'unpaid', 70, String(Date.now() - 1000))
  await db.prepare('UPDATE orders SET pay_reminded_at = 1 WHERE id = 15').run()
  await call('PATCH', '/api/admin/orders/15/status', { body: { status: 'new' } })
  const revived = await order(15)
  eq([revived.status, revived.pay_reminded_at, revived.pay_deadline > Date.now() + 25 * 60000], ['new', null, true])

  // ── C3: a product referenced only by order lines or carts is archived, not a 500 ──
  await db.prepare("INSERT INTO order_items (order_id,product_id,design_json,unit_price,quantity,created_at) VALUES (10,1,'{}',1,1,1)").run()
  await db.prepare("INSERT INTO cart_items (user_id,product_id,design_json,unit_price,quantity,created_at,updated_at) VALUES (1,2,'{}',1,1,1,1)").run()
  eq((await call('DELETE', '/api/admin/products/1')).data, { ok: true, mode: 'archived', orders: 1 })
  eq((await call('DELETE', '/api/admin/products/2')).data, { ok: true, mode: 'archived', orders: 1 })
  eq((await call('DELETE', '/api/admin/products/3')).data, { ok: true, mode: 'deleted' })
  eq(await db.prepare('SELECT id, active FROM products ORDER BY id').all().then((r) => r.results), [{ id: 1, active: 0 }, { id: 2, active: 0 }])

  // ── C4: admin delete keeps history ──
  await call('POST', '/api/admin/admins', { body: { email: 'fresh@loom.test', password: 'password-1', role: 'staff' } })
  await call('POST', '/api/admin/admins', { body: { email: 'busy@loom.test', password: 'password-2', role: 'staff' } })
  const ids = Object.fromEntries((await db.prepare('SELECT id, email FROM admins').all()).results.map((a) => [a.email, a.id]))
  const busyCookie = await login('busy@loom.test', 'password-2')
  await db.prepare("INSERT INTO order_status_log (order_id,old_status,new_status,changed_by,changed_at) VALUES (10,'new','delivered',?,1)").bind(ids['busy@loom.test']).run()
  eq((await call('DELETE', `/api/admin/admins/${ids['fresh@loom.test']}`)).data, { ok: true, mode: 'deleted' })
  eq((await call('DELETE', `/api/admin/admins/${ids['busy@loom.test']}`)).data, { ok: true, mode: 'disabled' })
  eq((await db.prepare('SELECT COUNT(*) AS n FROM order_status_log WHERE changed_by = ?').bind(ids['busy@loom.test']).first()).n, 1, 'history kept')
  eq((await call('GET', '/api/admin/admins')).data.admins.map((a) => a.email).sort(), ['owner@loom.test', 'staff@loom.test'])
  await call('GET', '/api/admin/me', { cookie: busyCookie, status: 401 })
  eq((await login('busy@loom.test', 'password-2', 401)).error, 'Неверный email или пароль')
  // Adding the same email again brings the row back with the new password.
  eq((await call('POST', '/api/admin/admins', { body: { email: 'busy@loom.test', password: 'password-3' } })).data.id, ids['busy@loom.test'])
  await call('GET', '/api/admin/me', { cookie: await login('busy@loom.test', 'password-3') })

  // ── P1: the generic customer PATCH needs the same rights as /status and /role ──
  await db.prepare("INSERT INTO admin_permissions (admin_id,capability,granted,updated_at) VALUES (2,'users.edit',1,1)").run()
  eq((await call('PATCH', '/api/admin/users/1', { admin: 2, status: 403, body: { status: 'banned' } })).data.missing, ['users.status'])
  eq((await call('PATCH', '/api/admin/users/1', { admin: 2, status: 403, body: { role: 'admin' } })).data.missing, ['users.role'])
  eq((await db.prepare('SELECT status, role FROM users WHERE id = 1').first()), { status: 'active', role: 'customer' }, 'no change without the rights')
  eq((await call('PATCH', '/api/admin/users/1', { body: { status: 'banned' } })).data.status, 'banned', 'owner may')

  // ── Before migrations 0032 / 0033: clear answers, sign-in unaffected ──
  await oldDb.prepare("INSERT INTO orders (id,customer_name,customer_phone,design_json,total_price,created_at,updated_at) VALUES (1,'QA','+998','{}',1,1,1)").run()
  await oldDb.prepare("INSERT INTO order_status_log (order_id,new_status,changed_by,changed_at) VALUES (1,'new',2,1)").run()
  await call('GET', '/api/admin/me', { on: old })
  eq((await call('GET', '/api/admin/admins', { on: old })).data.admins.length, 2)
  eq((await call('DELETE', '/api/admin/admins/2', { on: old, status: 409 })).data.error, 'Сначала примените миграцию 0033')
  eq((await call('GET', '/api/admin/site/hero', { on: old, status: 503 })).data.code, 'migration_0032')

  console.log(`PASS: ${checks} admin back-end checks`)
} finally {
  await mf.dispose()
  await old.dispose()
  await rm(scratch, { recursive: true, force: true })
}
