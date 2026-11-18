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
const token = (id, role = 'admin') => {
  const encode = (v) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const raw = `${encode({ alg: 'HS256' })}.${encode({ sub: String(id), role, iat: now, exp: now + 3600 })}`
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
const fresh = worker() // every migration, only the admin row seeded by 0002

let checks = 0
const eq = (actual, expected, message = `check ${checks + 1}`) => { assert.deepEqual(actual, expected, message); checks++ }
async function call(method, path, { status = 200, admin = 1, cookie, user, body, form, on = mf } = {}) {
  const headers = user ? { Authorization: `Bearer ${token(user, 'user')}` } : { Cookie: cookie ?? (admin ? `admin_token=${token(admin)}` : '') }
  let payload = body === undefined ? undefined : JSON.stringify(body)
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (form) { // { name: string | Uint8Array }. Encoded by hand: a Node FormData does not survive Miniflare 4.
    const b = 'loomtestboundary'
    payload = Buffer.concat([...Object.entries(form).flatMap(([name, v]) => [
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${name}"${typeof v === 'string' ? '' : '; filename="f.png"\r\nContent-Type: application/octet-stream'}\r\n\r\n`),
      Buffer.from(v), Buffer.from('\r\n')]), Buffer.from(`--${b}--\r\n`)])
    headers['Content-Type'] = `multipart/form-data; boundary=${b}`
  }
  const res = await on.dispatchFetch(`http://localhost${path}`, { method, headers, body: payload })
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null
  assert.equal(res.status, status, `${method} ${path}: ${JSON.stringify(data)}`)
  checks++
  return { data, res }
}
async function login(email, password, status = 200, on = mf) {
  const { res, data } = await call('POST', '/api/admin/login', { admin: 0, body: { email, password }, status, on })
  return status === 200 ? res.headers.get('set-cookie').split(';')[0] : data
}

async function migrate(db, below = '9999', seed = true) {
  for (const file of (await readdir(join(root, 'migrations'))).filter((n) => n.endsWith('.sql') && n < below).sort()) {
    const sql = (await readFile(join(root, 'migrations', file), 'utf8')).replace(/--[^\n]*/g, '')
    for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(statement).run()
  }
  assert.equal((await db.prepare('PRAGMA foreign_keys').first()).foreign_keys, 1, 'foreign keys must be enforced, as in D1')
  if (!seed) return
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

  // The minute sweep (real scheduled handler) leaves the reopened order alone.
  // Order 16 is overdue: it shows that the sweep ran.
  await insertOrder(16, 'new', 'p2p', 'unpaid', 70, String(Date.now() - 1000))
  await (await mf.getWorker()).scheduled({ cron: '* * * * *', scheduledTime: new Date(60_000) })
  for (let i = 0; i < 100 && (await order(16)).status !== 'cancelled'; i++) await new Promise((r) => setTimeout(r, 10))
  eq([(await order(16)).status, (await order(15)).status], ['cancelled', 'new'], 'sweep cancels the overdue order only')

  // ── C6 + late receipt: a same-status save on a timed-out order does not stop
  // a late receipt from bringing it back ──
  eq((await call('PATCH', '/api/admin/orders/16/status', { body: { status: 'cancelled' } })).data, { ok: true, unchanged: true })
  await call('POST', '/api/me/orders/16/receipt', { user: 1, status: 201, form: { file: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]) } })
  await call('POST', '/api/me/orders/16/paid', { user: 1 })
  eq([(await order(16)).status, (await order(16)).payment_status], ['new', 'pending'], 'late receipt revives the order')

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
  await call('PUT', `/api/admin/admins/${ids['busy@loom.test']}/permissions`, { body: { overrides: { 'ai.use': true } } })
  eq((await call('DELETE', `/api/admin/admins/${ids['fresh@loom.test']}`)).data, { ok: true, mode: 'deleted' })
  eq((await call('DELETE', `/api/admin/admins/${ids['busy@loom.test']}`)).data, { ok: true, mode: 'disabled' })
  eq((await db.prepare('SELECT COUNT(*) AS n FROM order_status_log WHERE changed_by = ?').bind(ids['busy@loom.test']).first()).n, 1, 'history kept')
  eq((await call('GET', '/api/admin/admins')).data.admins.map((a) => a.email).sort(), ['owner@loom.test', 'staff@loom.test'])
  // ── A disabled admin is not a target for role, permission or delete changes ──
  const busy = ids['busy@loom.test']
  eq((await call('PATCH', `/api/admin/admins/${busy}/role`, { status: 404, body: { role: 'manager' } })).data.error, 'Админ не найден')
  eq((await call('PUT', `/api/admin/admins/${busy}/permissions`, { status: 404, body: { overrides: { 'ai.use': true } } })).data.error, 'Админ не найден')
  eq((await call('DELETE', `/api/admin/admins/${busy}`, { status: 404 })).data.error, 'Админ не найден')
  eq((await db.prepare('SELECT role, disabled_at > 0 AS off FROM admins WHERE id = ?').bind(busy).first()), { role: 'staff', off: 1 })
  await call('GET', '/api/admin/me', { cookie: busyCookie, status: 401 })
  eq((await login('busy@loom.test', 'password-2', 401)).error, 'Неверный email или пароль')
  // Adding the same email again brings the row back with the new password.
  eq((await call('POST', '/api/admin/admins', { body: { email: 'busy@loom.test', password: 'password-3' } })).data.id, ids['busy@loom.test'])
  await call('GET', '/api/admin/me', { cookie: await login('busy@loom.test', 'password-3') })
  eq((await db.prepare('SELECT COUNT(*) AS n FROM admin_permissions WHERE admin_id = ?').bind(ids['busy@loom.test']).first()).n, 0, 'old permissions cleared on re-add')

  // ── P1: the generic customer PATCH needs the same rights as /status and /role ──
  await db.prepare("INSERT INTO admin_permissions (admin_id,capability,granted,updated_at) VALUES (2,'users.edit',1,1)").run()
  eq((await call('PATCH', '/api/admin/users/1', { admin: 2, status: 403, body: { status: 'banned' } })).data.missing, ['users.status'])
  eq((await call('PATCH', '/api/admin/users/1', { admin: 2, status: 403, body: { role: 'admin' } })).data.missing, ['users.role'])
  eq((await db.prepare('SELECT status, role FROM users WHERE id = 1').first()), { status: 'active', role: 'customer' }, 'no change without the rights')
  eq((await call('PATCH', '/api/admin/users/1', { body: { status: 'banned' } })).data.status, 'banned', 'owner may')

  // ── Customer profile: phone and email are checked only when they change ──
  const userRow = () => db.prepare('SELECT phone, email, first_name, tokens_valid_after AS tva FROM users WHERE id = 1').first()
  await db.prepare("INSERT INTO users (id,email,password_hash,created_at,phone) VALUES (2,'Other@loom.test','x',1,'+998901112233')").run()
  await db.prepare("UPDATE users SET phone = '8 (90) 123-45-67', email = 'Buyer@loom.test', tokens_valid_after = 5 WHERE id = 1").run()
  await call('PATCH', '/api/admin/users/1/profile', { body: { first_name: 'Aziza', last_name: null, email: 'Buyer@loom.test', phone: '8 (90) 123-45-67' } })
  eq(await userRow(), { phone: '8 (90) 123-45-67', email: 'Buyer@loom.test', first_name: 'Aziza', tva: 5 }, 'old-form phone resent unchanged saves')
  await db.prepare("UPDATE users SET phone = '+998901234567' WHERE id = 1").run()
  await call('PATCH', '/api/admin/users/1/profile', { body: { first_name: 'Aziza', phone: '+998 90 123 45 67', email: 'buyer@LOOM.test' } })
  eq(await userRow(), { phone: '+998901234567', email: 'Buyer@loom.test', first_name: 'Aziza', tva: 5 }, 'masked phone and case-only email are no change')
  eq((await call('PATCH', '/api/admin/users/1/profile', { status: 400, body: { phone: '8 (90) 1' } })).data.code, 'phone_invalid')
  eq((await call('PATCH', '/api/admin/users/1/profile', { status: 409, body: { phone: '+998 90 111 22 33' } })).data.code, 'phone_taken')
  eq((await call('PATCH', '/api/admin/users/1/profile', { status: 409, body: { email: 'OTHER@loom.test' } })).data.code, 'email_taken')
  await call('PATCH', '/api/admin/users/1/profile', { body: { email: ' New@Loom.Test ' } })
  const changed = await userRow()
  eq([changed.email, changed.tva > 5], ['new@loom.test', true], 'new email stored lowercased, sessions ended')

  // ── Product save: stored colours in an older form do not block other edits ──
  await db.prepare(`INSERT INTO products (id,slug,name_ru,price,active,created_at,updated_at,base_colors) VALUES (4,'p-colors','D',1,1,1,1,'["#fff"]')`).run()
  await call('PATCH', '/api/admin/products/4', { form: { name_ru: 'Новое', base_colors: '[ "#fff" ]' } })
  eq(await db.prepare('SELECT name_ru, base_colors FROM products WHERE id = 4').first(), { name_ru: 'Новое', base_colors: '["#fff"]' })
  eq((await call('PATCH', '/api/admin/products/4', { status: 400, form: { base_colors: '["#fff","#000000"]' } })).data.error, 'base_colors: нужен список цветов #RRGGBB')
  await call('PATCH', '/api/admin/products/4', { form: { base_colors: '["#FFFFFF","#000000"]' } })
  eq((await db.prepare('SELECT base_colors FROM products WHERE id = 4').first()).base_colors, '["#FFFFFF","#000000"]')

  // ── Before migrations 0032 / 0033: clear answers, sign-in unaffected ──
  await oldDb.prepare("INSERT INTO orders (id,customer_name,customer_phone,design_json,total_price,created_at,updated_at) VALUES (1,'QA','+998','{}',1,1,1)").run()
  await oldDb.prepare("INSERT INTO order_status_log (order_id,new_status,changed_by,changed_at) VALUES (1,'new',2,1)").run()
  await call('GET', '/api/admin/me', { on: old })
  eq((await call('GET', '/api/admin/admins', { on: old })).data.admins.length, 2)
  eq((await call('DELETE', '/api/admin/admins/2', { on: old, status: 409 })).data.error, 'Сначала примените миграцию 0033')
  eq((await call('GET', '/api/admin/site/hero', { on: old, status: 503 })).data.code, 'migration_0032')

  // Sign-in before 0033: a real login and /me work without the column.
  await call('POST', '/api/admin/admins', { on: old, body: { email: 'pre@loom.test', password: 'password-4', role: 'staff' } })
  await call('GET', '/api/admin/me', { on: old, cookie: await login('pre@loom.test', 'password-4', 200, old) })

  // ── Setup: only for the placeholder row seeded by migration 0002 ──
  const setup = (email, on) => call('POST', '/api/admin/setup', { admin: 0, on, status: 403, body: { email, password: 'first-password' } })
  await setup('owner@loom.test', mf) // real admins exist
  const freshDb = await fresh.getD1Database('DB')
  await migrate(freshDb, '9999', false)
  eq((await freshDb.prepare('SELECT email, password_hash FROM admins').all()).results, [{ email: 'admin@loomdesign.uz', password_hash: 'PLACEHOLDER_USE_SETUP_ENDPOINT' }])
  await setup('someone@loom.test', fresh)
  // Two racing requests for the placeholder: exactly one sets the password.
  const race = await Promise.all([1, 2].map((n) => fresh.dispatchFetch('http://localhost/api/admin/setup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@loomdesign.uz', password: `first-password-${n}` }) })))
  eq(race.map((r) => r.status).sort(), [200, 403], 'one setup wins')
  await setup('admin@loomdesign.uz', fresh)
  await Promise.all(race.map((r) => r.arrayBuffer()))
  const winner = race.findIndex((r) => r.status === 200) + 1
  await call('GET', '/api/admin/me', { on: fresh, cookie: await login('admin@loomdesign.uz', `first-password-${winner}`, 200, fresh) })

  console.log(`PASS: ${checks} admin back-end checks`)
} finally {
  await mf.dispose()
  await old.dispose()
  await fresh.dispose()
  await rm(scratch, { recursive: true, force: true })
}
