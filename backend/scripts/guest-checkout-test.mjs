// Guest checkout (LOOM-363, routes/guest-auth.ts) on a local D1/KV with the
// Telegram Gateway faked. Run: node backend/scripts/guest-checkout-test.mjs
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
const scratch = await mkdtemp(join(tmpdir(), 'loom-guest-'))
await build({ entryPoints: [join(root, 'src/index.ts')], outfile: join(scratch, 'worker.mjs'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022' })

const secret = 'local-guest-test-only'
const jwt = (id) => {
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const raw = `${enc({ alg: 'HS256' })}.${enc({ sub: String(id), role: 'user', iat: now, exp: now + 3600 })}`
  return `${raw}.${createHmac('sha256', secret).update(raw).digest('base64url')}`
}
const CODE = '424242'
async function fakeGateway(req) {
  const url = new URL(req.url)
  const body = await req.json()
  if (url.pathname === '/sendVerificationMessage') return Response.json({ ok: true, result: { request_id: 'rid-1' } })
  return Response.json({ ok: true, result: { request_id: body.request_id, verification_status: { status: body.code === CODE ? 'code_valid' : 'code_invalid' } } })
}
const mf = new Miniflare({ modules: true, modulesRoot: scratch, scriptPath: join(scratch, 'worker.mjs'), compatibilityDate: '2024-09-23', cf: false,
  d1Databases: ['DB'], r2Buckets: ['LOOM_UPLOADS', 'LOOM_MODELS'], kvNamespaces: ['RATE_LIMIT'], outboundService: fakeGateway,
  bindings: { JWT_SECRET: secret, ENVIRONMENT: 'test', TELEGRAM_BOT_TOKEN: '', BOT_USERNAME: '', TELEGRAM_GATEWAY_TOKEN: 'test-gateway-token',
    P2P_CARD_NUMBER: '8600000000000000', P2P_CARD_HOLDER: 'TEST HOLDER' } })

let checks = 0
const cookieOf = (res) => (res.headers.get('set-cookie') || '').match(/user_token=([^;]+)/)?.[1]
async function call(path, { method = 'POST', token, body, headers = {}, status = 200 } = {}) {
  const h = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.0.0.2', ...headers }
  if (token) h.Cookie = `user_token=${token}`
  const res = await mf.dispatchFetch(`http://localhost${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  assert.equal(res.status, status, `${method} ${path}: ${JSON.stringify(data)}`)
  checks++
  return { data, res }
}
const checkout = (token, status) => call('/api/cart/checkout', { token, status, headers: { 'Idempotency-Key': 'test-key-' + Math.random().toString(36).slice(2) },
  body: { paymentMethod: 'p2p', customerName: 'Test', customerPhone: '+998901112233', sessionId: 'sid_test' } })

try {
  const db = await mf.getD1Database('DB')
  for (const file of (await readdir(join(root, 'migrations'))).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = (await readFile(join(root, 'migrations', file), 'utf8')).replace(/--[^\n]*/g, '')
    for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run()
  }
  const now = Date.now()

  // 1. A guest account appears with no phone and no usable password.
  const { data: g, res: gRes } = await call('/api/auth/guest')
  assert.equal(g.guest, true)
  const guest = cookieOf(gRes)
  assert.ok(guest)
  const { data: me } = await call('/api/auth/me', { method: 'GET', token: guest })
  assert.equal(me.is_guest, true)
  assert.equal(me.phone, null)
  assert.equal(me.has_password, false)
  const guestId = me.id

  // 2. A second call with the session reuses it.
  const { res: again } = await call('/api/auth/guest', { token: guest })
  assert.equal(cookieOf(again), undefined)
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM users WHERE email LIKE 'guest-%'").first()).n, 1)

  // 3. Checkout: a guest passes the phone gate (empty cart is the next refusal);
  //    a non-guest account without a verified phone is still refused.
  assert.equal((await checkout(guest, 400)).data.code, 'cart_empty')
  await db.prepare("INSERT INTO users (email, password_hash, phone, role, status, created_at) VALUES ('old@x.uz', 'x', NULL, 'user', 'active', ?)").bind(now).run()
  const oldId = (await db.prepare("SELECT id FROM users WHERE email = 'old@x.uz'").first()).id
  assert.equal((await checkout(jwt(oldId), 403)).data.code, 'phone_not_verified')

  // 4. An existing customer owns +998901234567 and has an order.
  await db.prepare("INSERT INTO users (email, password_hash, phone, telegram_user_id, role, status, created_at) VALUES ('tg1@telegram.loom', 'telegram_auth', '+998901234567', 111, 'user', 'active', ?)").bind(now).run()
  const ownerId = (await db.prepare("SELECT id FROM users WHERE phone = '+998901234567'").first()).id
  const order = (uid) => db.prepare("INSERT INTO orders (user_id, customer_name, customer_phone, design_json, total_price, created_at, updated_at) VALUES (?, 'N', '+998', '{}', 1000, ?, ?)").bind(uid, now, now).run()
  await order(ownerId)
  await order(guestId)

  // The guest sees only their own order; typing a number gives no access.
  const { data: guestOrders } = await call('/api/me/orders', { method: 'GET', token: guest })
  assert.equal((Array.isArray(guestOrders) ? guestOrders : guestOrders.orders).length, 1)

  // 5. The guest confirms that number with a code: their order joins the account,
  //    the verified cookie replaces theirs and the old guest cookie stops working.
  const { data: sent } = await call('/api/auth/code/send', { token: guest, body: { phone: '901234567' } })
  const { res: ok } = await call('/api/auth/code/check', { token: guest, body: { ticket: sent.ticket, code: CODE } })
  const real = cookieOf(ok)
  assert.ok(real)
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM orders WHERE user_id = ?').bind(ownerId).first()).n, 2)
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM orders WHERE user_id = ?').bind(guestId).first()).n, 0)
  await call('/api/auth/me', { method: 'GET', token: guest, status: 401 })
  assert.equal((await call('/api/auth/me', { method: 'GET', token: real })).data.id, ownerId)

  console.log(`guest checkout: ${checks} route checks passed`)
} finally {
  await mf.dispose()
  await rm(scratch, { recursive: true, force: true })
}
