// Code sign-in through Telegram Gateway (LOOM-362, routes/code-auth.ts) on a
// local D1/KV with the Gateway faked. Run: node backend/scripts/code-auth-test.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const { build } = require('esbuild')
const { Miniflare } = require('miniflare')
const scratch = await mkdtemp(join(tmpdir(), 'loom-code-'))
await build({ entryPoints: [join(root, 'src/index.ts')], outfile: join(scratch, 'worker.mjs'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022' })

const CODE = '424242'
const gatewayCalls = []
async function fakeGateway(req) { // stands in for https://gatewayapi.telegram.org/
  const url = new URL(req.url)
  assert.equal(url.hostname, 'gatewayapi.telegram.org')
  assert.equal(req.headers.get('authorization'), 'Bearer test-gateway-token')
  const body = await req.json()
  gatewayCalls.push([url.pathname, body])
  if (url.pathname === '/sendVerificationMessage') {
    if (body.phone_number === '+998900000000') return Response.json({ ok: false, error: 'PHONE_NUMBER_NOT_FOUND' })
    return Response.json({ ok: true, result: { request_id: 'rid-1' } })
  }
  if (url.pathname === '/checkVerificationStatus') {
    return Response.json({ ok: true, result: { request_id: body.request_id, verification_status: { status: body.code === CODE ? 'code_valid' : 'code_invalid' } } })
  }
  return Response.json({ ok: false, error: 'METHOD_NOT_FOUND' })
}

const base = { modules: true, modulesRoot: scratch, scriptPath: join(scratch, 'worker.mjs'), compatibilityDate: '2024-09-23', cf: false,
  d1Databases: ['DB'], r2Buckets: ['LOOM_UPLOADS', 'LOOM_MODELS'], kvNamespaces: ['RATE_LIMIT'], outboundService: fakeGateway }
const vars = { JWT_SECRET: 'local-code-auth-test-only', ENVIRONMENT: 'test', TELEGRAM_BOT_TOKEN: '', BOT_USERNAME: '' }
const off = new Miniflare({ ...base, bindings: vars })
const mf = new Miniflare({ ...base, bindings: { ...vars, TELEGRAM_GATEWAY_TOKEN: 'test-gateway-token' } })

let checks = 0
async function post(m, path, body, status = 200) {
  const res = await m.dispatchFetch(`http://localhost${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.0.0.1' }, body: JSON.stringify(body) })
  const data = await res.json()
  assert.equal(res.status, status, `${path}: ${JSON.stringify(data)}`)
  checks++
  return { data, res }
}

try {
  const db = await mf.getD1Database('DB')
  for (const file of (await readdir(join(root, 'migrations'))).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = (await readFile(join(root, 'migrations', file), 'utf8')).replace(/--[^\n]*/g, '')
    for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run()
  }

  // No secret: the site falls back to the bot.
  assert.equal((await post(off, '/api/auth/code/send', { phone: '+998901234567' }, 503)).data.error, 'gateway_off')

  await post(mf, '/api/auth/code/send', { phone: '12345' }, 400)
  assert.equal((await post(mf, '/api/auth/code/send', { phone: '+998900000000' }, 422)).data.error, 'no_telegram')

  const { data: sent } = await post(mf, '/api/auth/code/send', { phone: '90 123 45 67' })
  assert.ok(sent.ticket)
  assert.deepEqual(gatewayCalls.at(-1), ['/sendVerificationMessage', { phone_number: '+998901234567', code_length: 6, ttl: 300 }])

  assert.equal((await post(mf, '/api/auth/code/check', { ticket: sent.ticket, code: '111111' })).data.status, 'code_invalid')
  assert.equal((await post(mf, '/api/auth/code/check', { ticket: 'nope', code: CODE })).data.status, 'expired')

  const { data: ok, res } = await post(mf, '/api/auth/code/check', { ticket: sent.ticket, code: CODE })
  assert.equal(ok.status, 'verified')
  assert.match(res.headers.get('set-cookie') ?? '', /user_token=.+HttpOnly/i)
  const user = await db.prepare('SELECT id, phone, role, status FROM users WHERE phone = ?').bind('+998901234567').first()
  assert.equal(user.role, 'user')
  assert.ok(await db.prepare("SELECT 1 FROM user_identities WHERE user_id = ? AND provider = 'tg_code'").bind(user.id).first(), 'code sign-in marks the phone verified')

  // One sign-in per code; a second sign-in reuses the same account.
  assert.equal((await post(mf, '/api/auth/code/check', { ticket: sent.ticket, code: CODE })).data.status, 'expired')
  const { data: again } = await post(mf, '/api/auth/code/send', { phone: '901234567' })
  await post(mf, '/api/auth/code/check', { ticket: again.ticket, code: CODE })
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM users WHERE phone = ?').bind('+998901234567').first()).n, 1)

  console.log(`code sign-in API: ${checks} route checks passed`)
} finally {
  await Promise.all([mf.dispose(), off.dispose()])
  await rm(scratch, { recursive: true, force: true })
}
