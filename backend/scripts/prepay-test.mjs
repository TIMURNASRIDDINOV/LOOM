// Run: node backend/scripts/prepay-test.mjs
// PRD-216 prepayment by card transfer: real Worker routes and the real
// scheduled() handler on an ephemeral local D1 / R2 / KV. Telegram is stubbed.
// Never connects to remote bindings.
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
const scratch = await mkdtemp(join(tmpdir(), 'loom-prepay-'))
const secret = 'local-prepay-test-only'
const CARD = '8600 0000 0000 0000' // made up, fails the card checksum; spaces are stripped by the Worker
const STAFF_CHAT = '-100777'
function token(id, role = 'user') {
  const encode = (v) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const raw = `${encode({ alg: 'HS256' })}.${encode({ sub: String(id), role, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}`
  return `${raw}.${createHmac('sha256', secret).update(raw).digest('base64url')}`
}
await build({ entryPoints: [join(root, 'src/index.ts')], outfile: join(scratch, 'worker.mjs'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022' })

const telegram = [] // every sendMessage payload the Worker tried to send
const worker = (bindings) => new Miniflare({ modules: true, modulesRoot: scratch, scriptPath: join(scratch, 'worker.mjs'),
  compatibilityDate: '2024-09-23', cf: false, d1Databases: ['DB'], r2Buckets: ['LOOM_UPLOADS', 'LOOM_MODELS'], kvNamespaces: ['RATE_LIMIT'],
  bindings: { JWT_SECRET: secret, ENVIRONMENT: 'test', TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: STAFF_CHAT, BOT_USERNAME: '', ...bindings },
  outboundService: async (request) => {
    telegram.push(await request.json().catch(() => ({})))
    return Response.json({ ok: true, result: { message_id: telegram.length } })
  } })
const mf = worker({ P2P_CARD_NUMBER: CARD, P2P_CARD_HOLDER: 'TEST HOLDER' })
const closed = worker({}) // no card secrets: checkout must be closed

let checks = 0
const ok = (value, message) => { assert.ok(value, message); checks++ }
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++ }
const user = (id) => ({ Authorization: `Bearer ${token(id)}` })
const admin = (id) => ({ Cookie: `admin_token=${token(id, 'admin')}` })
async function call(method, path, { status = 200, headers = {}, body, form, on = mf } = {}) {
  const init = { method, headers: { ...headers } }
  if (form) init.body = form
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json' }
  const res = await on.dispatchFetch(`http://localhost${path}`, init)
  const data = await res.json().catch(() => null)
  assert.equal(res.status, status, `${method} ${path}: ${JSON.stringify(data)}`)
  checks++
  return data
}
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const receipt = (bytes = PNG) => { const f = new FormData(); f.append('file', new Blob([bytes]), 'receipt.png'); return f }
/** Background (waitUntil) work has no handle: poll until it shows. */
async function until(probe, message) {
  for (let i = 0; i < 100; i++) { if (await probe()) return; await new Promise((r) => setTimeout(r, 10)) }
  assert.fail(message)
}
const sentTo = (chat, part) => telegram.filter((m) => String(m.chat_id) === String(chat) && String(m.text).includes(part))

async function migrate(db) {
  for (const file of (await readdir(join(root, 'migrations'))).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = (await readFile(join(root, 'migrations', file), 'utf8')).replace(/--[^\n]*/g, '')
    for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(statement).run()
  }
  await db.prepare("INSERT INTO users (id,email,password_hash,created_at,telegram_user_id) VALUES (1,'buyer@loom.test','unused',1,111),(2,'other@loom.test','unused',1,222),(3,'u3@loom.test','unused',1,333),(4,'u4@loom.test','unused',1,444),(5,'u5@loom.test','unused',1,555),(6,'u6@loom.test','unused',1,666),(7,'u7@loom.test','unused',1,777)").run()
  await db.prepare('DELETE FROM admins').run()
  await db.prepare("INSERT INTO admins (id,email,password_hash,role,created_at) VALUES (1,'owner@loom.test','unused','owner',1),(2,'staff@loom.test','unused','staff',1)").run()
  await db.prepare("INSERT INTO admin_permissions (admin_id,capability,granted,updated_at) VALUES (2,'orders.approve',0,1),(2,'orders.status',1,1),(2,'orders.view',1,1)").run()
  await db.prepare("INSERT INTO products (id,slug,name_ru,price,active,created_at,updated_at) VALUES (1001,'prepay-test','QA',100000,1,1,1)").run()
}

try {
  const db = await mf.getD1Database('DB')
  const uploads = await mf.getR2Bucket('LOOM_UPLOADS')
  await migrate(db)
  await migrate(await closed.getD1Database('DB'))
  const row = (id) => db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first()
  const lastLog = (id) => db.prepare('SELECT * FROM order_status_log WHERE order_id = ? ORDER BY id DESC LIMIT 1').bind(id).first()
  const orderCount = async (on = db) => (await on.prepare('SELECT COUNT(*) AS n FROM orders').first()).n
  const design = JSON.stringify({ size: 'M', shirtColor: '#FFFFFF' })
  const buyer = { customerName: 'QA Buyer', customerPhone: '+998900000000', sessionId: 'web-prepay' }
  let attempt = 0
  /** Fill the bag and check out; returns the checkout response. */
  async function place(uid = 1, extra = {}) {
    await call('POST', '/api/cart', { status: 201, headers: user(uid), body: { productId: 1001, designJson: design } })
    return call('POST', '/api/cart/checkout', { status: 201, headers: { ...user(uid), 'Idempotency-Key': `prepay-test-${++attempt}` },
      body: { ...buyer, paymentMethod: 'p2p', ...extra } })
  }

  // ── Payment methods: card transfer only, and only with the card secrets ──
  eq(await call('GET', '/api/payments/methods'), { cod: false, p2p: true, payme: false, click: false, uzum: false })
  eq((await call('GET', '/api/payments/methods', { on: closed })).p2p, false)
  await call('POST', '/api/cart', { status: 201, headers: user(1), body: { productId: 1001, designJson: design }, on: closed })
  eq((await call('POST', '/api/cart/checkout', { status: 400, on: closed, headers: { ...user(1), 'Idempotency-Key': 'closed-0001' },
    body: { ...buyer, paymentMethod: 'p2p' } })).code, 'payment_method_unavailable')
  eq(await orderCount(await closed.getD1Database('DB')), 0, 'no card secrets: no order')

  // ── The bag shows delivery as its own line ──
  const bag = await call('POST', '/api/cart', { status: 201, headers: user(1), body: { productId: 1001, designJson: design } })
  eq([bag.total, bag.delivery, bag.payable], [100000, 30000, 130000])

  // ── Cash on delivery and every unknown / missing method are refused, no order written ──
  for (const paymentMethod of ['cod', 'payme', 'bitcoin', undefined, 7]) {
    eq((await call('POST', '/api/cart/checkout', { status: 400, headers: { ...user(1), 'Idempotency-Key': `refused-${String(paymentMethod)}-1` },
      body: { ...buyer, paymentMethod } })).code, 'payment_method_unavailable')
  }
  eq(await orderCount(), 0)

  // ── Checkout: the server prices delivery; what the client sends is ignored ──
  const key = { ...user(1), 'Idempotency-Key': 'prepay-first-1' }
  const body = { ...buyer, paymentMethod: 'p2p', deliveryFee: 0, delivery: 0, totalPrice: 1, total: 1, payDeadline: 9e15 }
  const before = Date.now()
  const placed = await call('POST', '/api/cart/checkout', { status: 201, headers: key, body })
  eq([placed.paymentMethod, placed.totalPrice, placed.deliveryFee, placed.paymentUrl], ['p2p', 130000, 30000, null])
  ok(placed.payDeadline >= before + 30 * 60000 && placed.payDeadline <= Date.now() + 30 * 60000, '30-minute window')
  eq((await call('POST', '/api/cart/checkout', { headers: key, body })).id, placed.id, 'retry returns the same order')
  eq(await orderCount(), 1)
  let o = await row(placed.id)
  eq([o.total_price, o.delivery_fee, o.payment_method, o.payment_status, o.status], [130000, 30000, 'p2p', 'unpaid', 'new'])
  const id = placed.id

  // ── The owner sees the card; nobody else sees the order at all ──
  let view = await call('GET', `/api/me/orders/${id}`, { headers: user(1) })
  eq(view.card, { number: CARD.replace(/ /g, ''), holder: 'TEST HOLDER' })
  eq([view.order.receipt, view.order.delivery_fee, view.order.total_price, view.can_revive], [false, 30000, 130000, false])
  ok(!('receipt_key' in view.order) && !('pay_checked_by' in view.order), 'no storage key or staff id for the customer')
  ok(Math.abs(view.now - Date.now()) < 5000, 'server clock is returned')
  await call('GET', `/api/me/orders/${id}`, { status: 404, headers: user(2) })
  await call('GET', `/api/me/orders/${id}`, { status: 401 })
  await call('POST', `/api/me/orders/${id}/receipt`, { status: 404, headers: user(2), form: receipt() })
  await call('POST', `/api/me/orders/${id}/paid`, { status: 404, headers: user(2) })
  await call('POST', `/api/me/orders/${id}/paid`, { status: 401 })
  eq((await call('GET', '/api/me/orders', { headers: user(2) })).orders.length, 0)
  ok(!('receipt_key' in (await call('GET', '/api/me/orders', { headers: user(1) })).orders[0]))

  // ── "Paid" needs a receipt; the receipt must really be an image ──
  eq((await call('POST', `/api/me/orders/${id}/paid`, { status: 409, headers: user(1) })).code, 'receipt_required')
  eq((await call('POST', `/api/me/orders/${id}/receipt`, { status: 400, headers: user(1), form: receipt(new TextEncoder().encode('<html>not an image</html>')) })).code, 'receipt_invalid')
  await call('POST', `/api/me/orders/${id}/receipt`, { status: 400, headers: user(1), body: {} })
  eq((await row(id)).receipt_key, null)
  await call('POST', `/api/me/orders/${id}/receipt`, { status: 201, headers: user(1), form: receipt() })
  const firstKey = (await row(id)).receipt_key
  ok(firstKey.startsWith(`receipts/${id}/`) && firstKey.endsWith('.png'), 'server-made private key')
  ok(await uploads.head(firstKey), 'receipt stored')
  // A customer route never serves a receipt, not even to its owner.
  await call('GET', `/api/uploads/${firstKey}`, { status: 404, headers: user(1) })
  await call('GET', `/api/files/artwork/${firstKey}`, { status: 404 })
  // A second upload replaces the first and removes the old file.
  await call('POST', `/api/me/orders/${id}/receipt`, { status: 201, headers: user(1), form: receipt() })
  const secondKey = (await row(id)).receipt_key
  ok(secondKey !== firstKey && !(await uploads.head(firstKey)) && await uploads.head(secondKey), 'replaced')

  // ── "Paid" is idempotent: one status change, one staff message ──
  eq(await call('POST', `/api/me/orders/${id}/paid`, { headers: user(1) }), { ok: true, status: 'new', payment_status: 'pending' })
  eq(await call('POST', `/api/me/orders/${id}/paid`, { headers: user(1) }), { ok: true, status: 'new', payment_status: 'pending' })
  await until(() => sentTo(STAFF_CHAT, `#${id}`).length > 0, 'staff chat is told about the receipt')
  await new Promise((r) => setTimeout(r, 50))
  eq(sentTo(STAFF_CHAT, 'Чек загружен').length, 1)
  ok(sentTo(STAFF_CHAT, 'Чек загружен')[0].reply_markup.inline_keyboard[0][0].url.endsWith(`/admin/order.html?id=${id}`))
  view = await call('GET', `/api/me/orders/${id}`, { headers: user(1) })
  eq([view.card, view.order.receipt, view.order.payment_status], [null, true, 'pending'])
  eq((await call('POST', `/api/me/orders/${id}/receipt`, { status: 409, headers: user(1), form: receipt() })).code, 'order_not_payable')
  eq((await row(id)).receipt_key, secondKey, 'a receipt being checked cannot be swapped')

  // ── Timeout: an unpaid order past its deadline is cancelled when it is read ──
  const late = (await place()).id
  await db.prepare('UPDATE orders SET pay_deadline = ? WHERE id = ?').bind(Date.now() - 1000, late).run()
  view = await call('GET', `/api/me/orders/${late}`, { headers: user(1) })
  eq([view.order.status, view.order.payment_status, view.can_revive], ['cancelled', 'unpaid', true])
  ok(view.card, 'card stays visible so a late payer can still send the receipt')
  eq((await lastLog(late)).note, 'payment_timeout')
  eq(sentTo(111, `#${late}`).length, 1, 'customer is told once')
  await call('GET', `/api/me/orders/${late}`, { headers: user(1) })
  eq(sentTo(111, `#${late}`).length, 1)
  // ── A late receipt brings it back ──
  eq((await call('POST', `/api/me/orders/${late}/paid`, { status: 409, headers: user(1) })).code, 'receipt_required')
  await call('POST', `/api/me/orders/${late}/receipt`, { status: 201, headers: user(1), form: receipt() })
  eq(await call('POST', `/api/me/orders/${late}/paid`, { headers: user(1) }), { ok: true, status: 'new', payment_status: 'pending' })
  eq([(await lastLog(late)).old_status, (await lastLog(late)).new_status, (await lastLog(late)).note], ['cancelled', 'new', 'payment_revived'])
  eq((await call('GET', `/api/me/orders/${late}`, { headers: user(1) })).can_revive, false)

  // ── An order staff cancelled is not revived by a receipt ──
  const dead = (await place()).id
  await db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").bind(dead).run()
  await db.prepare("INSERT INTO order_status_log (order_id,old_status,new_status,changed_by,changed_at,note) VALUES (?,'new','cancelled',NULL,1,'out of stock')").bind(dead).run()
  view = await call('GET', `/api/me/orders/${dead}`, { headers: user(1) })
  eq([view.can_revive, view.card], [false, null])
  eq((await call('POST', `/api/me/orders/${dead}/receipt`, { status: 409, headers: user(1), form: receipt() })).code, 'order_not_payable')
  eq((await uploads.list({ prefix: `receipts/${dead}/` })).objects.length, 0, 'refused upload leaves no file')

  // ── Old cash-on-delivery orders keep working and never become payable ──
  await db.prepare("INSERT INTO orders (id,user_id,customer_name,customer_phone,design_json,total_price,status,created_at,updated_at) VALUES (9001,1,'Old','+998900000000','{}',150000,'new',1,1)").run()
  view = await call('GET', '/api/me/orders/9001', { headers: user(1) })
  eq([view.order.payment_method, view.order.delivery_fee, view.order.status, view.card], ['cod', 0, 'new', null])
  eq((await call('POST', '/api/me/orders/9001/paid', { status: 409, headers: user(1) })).code, 'order_not_payable')
  eq((await call('POST', '/api/me/orders/9001/receipt', { status: 409, headers: user(1), form: receipt() })).code, 'order_not_payable')
  eq((await row(9001)).status, 'new')

  // ════ Staff side ════
  /** A placed order whose customer sent a receipt and pressed "paid". */
  async function pending(uid) {
    const pid = (await place(uid)).id
    await call('POST', `/api/me/orders/${pid}/receipt`, { status: 201, headers: user(uid), form: receipt() })
    await call('POST', `/api/me/orders/${pid}/paid`, { headers: user(uid) })
    return pid
  }
  const pay = (pid, body, opts = {}) => call('POST', `/api/admin/orders/${pid}/payment`, { headers: admin(1), body, ...opts })
  const setStatus = (pid, status, opts = {}) => call('PATCH', `/api/admin/orders/${pid}/status`, { headers: admin(1), body: { status }, ...opts })
  const logCount = async (pid, note) => (await db.prepare('SELECT COUNT(*) AS n FROM order_status_log WHERE order_id = ? AND note = ?').bind(pid, note).first()).n

  // ── Who may answer a receipt, and with what ──
  const a = await pending(3)
  await pay(a, { action: 'confirm' }, { status: 401, headers: {} })
  await pay(a, { action: 'confirm' }, { status: 401, headers: user(3) })
  await pay(a, { action: 'confirm' }, { status: 403, headers: admin(2) })
  await pay(a, { action: 'approve' }, { status: 400 })
  await pay(a, {}, { status: 400 })
  eq((await pay(a, { action: 'reject' }, { status: 400 })).code, 'reject_reason_required')
  eq((await pay(a, { action: 'reject', reason: 'because' }, { status: 400 })).code, 'reject_reason_required')
  await pay(999999, { action: 'confirm' }, { status: 404 })
  eq((await row(a)).payment_status, 'pending')
  let seen = await call('GET', `/api/admin/orders/${a}`, { headers: admin(1) })
  eq([seen.payment.receiptUrl, seen.payment.canCheck, seen.delivery_fee], [`/api/admin/media/${(await row(a)).receipt_key}`, true, 30000])
  eq((await call('GET', `/api/admin/orders/${a}`, { headers: admin(2) })).payment.canCheck, false)
  const media = await mf.dispatchFetch(`http://localhost${seen.payment.receiptUrl}`, { headers: admin(1) })
  eq([media.status, media.headers.get('content-type'), media.headers.get('x-content-type-options')], [200, 'image/png', 'nosniff'])
  await media.arrayBuffer()
  eq((await mf.dispatchFetch(`http://localhost${seen.payment.receiptUrl}`, { headers: user(3) })).status, 401, 'a customer token opens no receipt')

  // ── Production gate: nothing moves before the money is confirmed ──
  await db.prepare('UPDATE orders SET proof_approved_at = 1, proof_approved_by = 1 WHERE id IN (?, 9001)').bind(a).run()
  for (const status of ['confirmed', 'producing', 'shipped', 'delivered']) {
    eq((await setStatus(a, status, { status: 409 })).code, 'payment_not_confirmed')
  }
  eq((await row(a)).status, 'new')

  // ── Confirm: once, however often it is pressed ──
  eq(await pay(a, { action: 'confirm' }), { ok: true, payment_status: 'paid', status: 'confirmed' })
  eq(await pay(a, { action: 'confirm' }), { ok: true, already: true, payment_status: 'paid', status: 'confirmed' })
  const both = await Promise.all([pay(a, { action: 'confirm' }), pay(a, { action: 'confirm' })])
  ok(both.every((r) => r.already), 'concurrent repeats change nothing')
  o = await row(a)
  eq([o.payment_status, o.status, o.pay_checked_by, o.total_price], ['paid', 'confirmed', 1, 130000])
  ok(o.paid_at >= o.created_at && o.pay_checked_at === o.paid_at)
  eq(await logCount(a, 'payment_confirmed'), 1)
  await until(() => sentTo(333, 'tasdiqlandi').length > 0, 'customer is told the payment is confirmed')
  await new Promise((r) => setTimeout(r, 50))
  eq(sentTo(333, 'tasdiqlandi').length, 1)
  eq((await pay(a, { action: 'reject', reason: 'not_found' }, { status: 409 })).code, 'payment_not_pending')
  eq((await row(a)).payment_status, 'paid', 'a confirmed payment cannot be rejected')
  eq(await call('POST', `/api/me/orders/${a}/paid`, { headers: user(3) }), { ok: true, status: 'confirmed', payment_status: 'paid' })
  await setStatus(a, 'producing')
  eq((await row(a)).status, 'producing')

  // ── An order nobody paid for cannot be confirmed ──
  const unpaid = (await place(3)).id
  eq((await pay(unpaid, { action: 'confirm' }, { status: 409 })).code, 'payment_not_pending')
  eq((await pay(9001, { action: 'confirm' }, { status: 409 })).code, 'payment_not_pending')
  eq([(await row(unpaid)).payment_status, (await row(9001)).payment_status], ['unpaid', 'unpaid'])
  // ── Old cash-on-delivery orders are not held by the payment gate ──
  await setStatus(9001, 'producing')
  eq((await row(9001)).status, 'producing')

  // ── Reject, then a new receipt ──
  const b = await pending(3)
  const rejectedKey = (await row(b)).receipt_key
  const t0 = Date.now()
  eq(await pay(b, { action: 'reject', reason: 'amount_mismatch' }), { ok: true, payment_status: 'failed', status: 'new' })
  eq(await pay(b, { action: 'reject', reason: 'amount_mismatch' }), { ok: true, already: true, payment_status: 'failed', status: 'new' })
  o = await row(b)
  eq([o.payment_status, o.status, o.pay_reject_reason, o.receipt_key, o.paid_at], ['failed', 'new', 'amount_mismatch', null, null])
  ok(o.pay_deadline >= t0 + 30 * 60000, 'a fresh 30 minutes')
  await until(async () => !(await uploads.head(rejectedKey)), 'rejected receipt is removed')
  await until(() => sentTo(333, 'summa mos kelmadi').length > 0, 'customer is told why')
  await new Promise((r) => setTimeout(r, 50))
  eq(sentTo(333, 'summa mos kelmadi').length, 1)
  view = await call('GET', `/api/me/orders/${b}`, { headers: user(3) })
  eq([view.order.payment_status, view.order.pay_reject_reason, view.order.receipt, !!view.card], ['failed', 'amount_mismatch', false, true])
  eq((await pay(b, { action: 'confirm' }, { status: 409 })).code, 'payment_not_pending')
  eq((await call('POST', `/api/me/orders/${b}/paid`, { status: 409, headers: user(3) })).code, 'receipt_required')
  await call('POST', `/api/me/orders/${b}/receipt`, { status: 201, headers: user(3), form: receipt() })
  await call('POST', `/api/me/orders/${b}/paid`, { headers: user(3) })
  eq((await pay(b, { action: 'confirm' })).payment_status, 'paid')
  eq((await row(b)).pay_reject_reason, null)

  // ════ The minute sweep (the real scheduled handler) ════
  const cron = await mf.getWorker()
  const tick = () => cron.scheduled({ cron: '* * * * *', scheduledTime: new Date(60_000) }) // minute 1: no Instagram run
  const soon = (await place(4)).id, overdue = (await place(4)).id, fresh = (await place(4)).id
  await db.prepare('UPDATE orders SET pay_deadline = ? WHERE id = ?').bind(Date.now() + 4 * 60000, soon).run()
  await db.prepare('UPDATE orders SET pay_deadline = ? WHERE id = ?').bind(Date.now() - 1, overdue).run()
  await tick()
  await until(async () => (await row(overdue)).status === 'cancelled' && (await row(soon)).pay_reminded_at, 'sweep ran')
  await until(() => sentTo(444, 'daqiqa qoldi').length > 0 && sentTo(444, 'vaqti tugadi').length > 0, 'reminder and expiry messages')
  await tick()
  await new Promise((r) => setTimeout(r, 100))
  eq([sentTo(444, 'daqiqa qoldi').length, sentTo(444, 'vaqti tugadi').length], [1, 1], 'each message once')
  ok(sentTo(444, 'daqiqa qoldi')[0].text.includes(`#${soon}`) && sentTo(444, 'vaqti tugadi')[0].text.includes(`#${overdue}`))
  ok(sentTo(444, 'vaqti tugadi')[0].reply_markup.inline_keyboard[0][0].url.endsWith(`/order?id=${overdue}`), 'deep link to the order page')
  eq([(await row(soon)).status, (await row(fresh)).status, (await row(fresh)).pay_reminded_at], ['new', 'new', null])
  eq([(await lastLog(overdue)).note, await logCount(overdue, 'payment_timeout')], ['payment_timeout', 1])
  // Not swept: a receipt under review, a paid order, an old cash order.
  await db.prepare('UPDATE orders SET pay_deadline = 1 WHERE id IN (?, ?, 9001)').bind(a, late).run()
  await tick()
  await new Promise((r) => setTimeout(r, 100))
  eq([(await row(a)).status, (await row(late)).status, (await row(9001)).status], ['producing', 'new', 'producing'])
  // A rejected payment whose new window also passed is cancelled like an unpaid one.
  const again = await pending(4)
  await pay(again, { action: 'reject', reason: 'not_found' })
  await db.prepare('UPDATE orders SET pay_deadline = 1 WHERE id = ?').bind(again).run()
  await tick()
  await until(async () => (await row(again)).status === 'cancelled', 'rejected and overdue is cancelled')

  // ════ Sign-in routes ════
  eq((await call('POST', '/api/auth/register', { status: 410, body: { email: 'new@loom.test', password: 'long-enough-1' } })).code, 'sign_in_method_closed')
  eq((await db.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'new@loom.test'").first()).n, 0)
  eq((await call('POST', '/api/auth/oauth/google', { status: 410, body: { code: 'x', redirect_uri: 'x' } })).code, 'sign_in_method_closed')
  eq((await call('GET', '/api/auth/oauth/providers?platform=web')).providers, [])
  await call('POST', '/api/auth/login', { status: 401, body: { email: 'buyer@loom.test', password: 'wrong-password' } }) // still served

  // ════ Account deletion waits for open orders ════
  const open5 = (await place(5)).id
  let del = await call('DELETE', '/api/auth/account', { headers: user(5) })
  eq([del.scheduled, typeof del.delete_requested_at], [true, 'number'])
  eq((await call('GET', '/api/auth/me', { headers: user(5) })).delete_requested_at, del.delete_requested_at)
  eq((await call('DELETE', '/api/auth/account', { headers: user(5) })).delete_requested_at, del.delete_requested_at, 'asking twice keeps the first date')
  eq((await call('POST', '/api/auth/account/restore', { headers: user(5) })).delete_requested_at, null)
  eq((await call('GET', '/api/auth/me', { headers: user(5) })).delete_requested_at, null)
  await setStatus(open5, 'cancelled')
  await new Promise((r) => setTimeout(r, 100))
  eq((await db.prepare('SELECT status FROM users WHERE id = 5').first()).status, 'active', 'restored account survives the order closing')
  const open5b = (await place(5)).id
  await call('DELETE', '/api/auth/account', { headers: user(5) })
  eq((await db.prepare('SELECT status FROM users WHERE id = 5').first()).status, 'active')
  await setStatus(open5b, 'cancelled')
  await until(async () => (await db.prepare('SELECT status FROM users WHERE id = 5').first()).status === 'deleted', 'deletion runs when the last open order closes')
  eq((await call('GET', '/api/auth/me', { status: 401, headers: user(5) })).code, 'account_deleted')
  // The payment timeout closes an order, but the account stays for the
  // late-receipt window: the money may already be on the card.
  const userRow = (id) => db.prepare('SELECT status, delete_requested_at FROM users WHERE id = ?').bind(id).first()
  const open6 = (await place(6)).id
  eq((await call('DELETE', '/api/auth/account', { headers: user(6) })).scheduled, true)
  await db.prepare('UPDATE orders SET pay_deadline = ? WHERE id = ?').bind(Date.now() - 1000, open6).run()
  await tick()
  await until(async () => (await row(open6)).status === 'cancelled' && sentTo(666, 'vaqti tugadi').length > 0, 'timed out and told')
  await tick()
  await new Promise((r) => setTimeout(r, 150))
  let u = await userRow(6)
  eq([u.status, typeof u.delete_requested_at], ['active', 'number'], 'a timed-out order keeps the account for the late receipt')
  await call('POST', `/api/me/orders/${open6}/receipt`, { status: 201, headers: user(6), form: receipt() })
  eq(await call('POST', `/api/me/orders/${open6}/paid`, { headers: user(6) }), { ok: true, status: 'new', payment_status: 'pending' }, 'the late receipt still revives the order')
  await tick()
  await new Promise((r) => setTimeout(r, 150))
  eq((await userRow(6)).status, 'active', 'a revived order holds the deletion back')
  await pay(open6, { action: 'reject', reason: 'not_found' })
  await setStatus(open6, 'cancelled')
  await until(async () => (await userRow(6)).status === 'deleted', 'deletion runs once staff close the order')
  // Asking for deletion with only a freshly timed-out order: scheduled, not at once.
  const open7 = (await place(7)).id
  await db.prepare('UPDATE orders SET pay_deadline = ? WHERE id = ?').bind(Date.now() - 1000, open7).run()
  await tick()
  await until(async () => (await row(open7)).status === 'cancelled', 'timed out')
  eq((await call('DELETE', '/api/auth/account', { headers: user(7) })).scheduled, true)
  // The window passes, but the deletion fails: the request stays and the next sweep retries.
  await db.prepare("CREATE TRIGGER test_block_delete BEFORE UPDATE OF status ON users WHEN NEW.status = 'deleted' BEGIN SELECT RAISE(ABORT, 'test: deletion fails'); END").run()
  await db.prepare('UPDATE orders SET pay_deadline = ? WHERE id = ?').bind(Date.now() - 25 * 3600 * 1000, open7).run()
  await tick()
  await new Promise((r) => setTimeout(r, 200))
  u = await userRow(7)
  eq([u.status, typeof u.delete_requested_at], ['active', 'number'], 'a failed deletion keeps its request')
  await db.prepare('DROP TRIGGER test_block_delete').run()
  await tick()
  await until(async () => (await userRow(7)).status === 'deleted', 'the next sweep retries a failed deletion')
  eq((await call('GET', '/api/auth/me', { status: 401, headers: user(7) })).code, 'account_deleted')
  // No open order: deleted at once.
  eq((await call('DELETE', '/api/auth/account', { headers: user(2) })).scheduled, false)
  eq((await db.prepare('SELECT status, delete_requested_at FROM users WHERE id = 2').first()), { status: 'deleted', delete_requested_at: null })


  console.log(`PASS: ${checks} prepayment checks`)
} finally {
  await mf.dispose()
  await closed.dispose()
  await rm(scratch, { recursive: true, force: true })
}
