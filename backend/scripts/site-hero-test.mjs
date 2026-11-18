// Home-page hero picture set from the admin panel (migration 0032,
// routes/site.ts) on a local D1/R2. Run: node backend/scripts/site-hero-test.mjs
// `--serve` keeps the Worker on :8787 (the localhost API_BASE of the site and
// the admin panel) with migrations applied and prints a throwaway owner cookie.
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
const scratch = await mkdtemp(join(tmpdir(), 'loom-hero-'))
const secret = 'local-site-hero-test-only-not-a-production-secret'
const token = (id) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const raw = `${encode({ alg: 'HS256' })}.${encode({ sub: String(id), role: 'admin', iat: now, exp: now + 3600 })}`
  return `${raw}.${createHmac('sha256', secret).update(raw).digest('base64url')}`
}
await build({ entryPoints: [join(root, 'src/index.ts')], outfile: join(scratch, 'worker.mjs'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022' })
const serve = process.argv.includes('--serve')
const mf = new Miniflare({ modules: true, ...(serve ? { port: 8787 } : {}), modulesRoot: scratch, scriptPath: join(scratch, 'worker.mjs'), compatibilityDate: '2024-09-23', cf: false,
  d1Databases: ['DB'], r2Buckets: ['LOOM_UPLOADS', 'LOOM_MODELS'], kvNamespaces: ['RATE_LIMIT'],
  bindings: { JWT_SECRET: secret, ENVIRONMENT: 'test', TELEGRAM_BOT_TOKEN: '', BOT_USERNAME: '' } })

const OWNER = 1, STAFF = 2
let checks = 0
async function call(path, { method = 'GET', form, admin = OWNER, status = 200 } = {}) {
  const headers = admin ? { Cookie: `admin_token=${token(admin)}` } : {}
  let payload
  if (form) { // Miniflare 4 does not serialise a Node FormData: encode the multipart body here.
    const encoded = new Response(form)
    headers['Content-Type'] = encoded.headers.get('content-type')
    payload = Buffer.from(await encoded.arrayBuffer())
  }
  const res = await mf.dispatchFetch(`http://localhost${path}`, { method, headers, body: payload })
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : res
  assert.equal(res.status, status, `${method} ${path}: ${JSON.stringify(data)}`)
  checks++
  return { data, res }
}
const put = (bytes, alt, opts = {}) => {
  const form = new FormData()
  form.append('image', new Blob([bytes]), 'hero.bin')
  if (alt !== undefined) form.append('alt', alt)
  return call('/api/admin/site/hero', { method: 'PUT', form, ...opts })
}
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x10, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(8)])

try {
  const db = await mf.getD1Database('DB')
  for (const file of (await readdir(join(root, 'migrations'))).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = (await readFile(join(root, 'migrations', file), 'utf8')).replace(/--[^\n]*/g, '')
    for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run()
  }
  await db.prepare('DELETE FROM admins').run()
  await db.prepare("INSERT INTO admins (id,email,password_hash,role,created_at) VALUES (1,'owner@test.invalid','x','owner',1),(2,'staff@test.invalid','x','staff',1)").run()
  if (serve) {
    console.log(`Worker on http://localhost:8787; owner cookie: admin_token=${token(OWNER)}`)
    await new Promise(() => {})
  }

  // No row: public answer is null and short-cached.
  let pub = await call('/api/site/hero', { admin: 0 })
  assert.equal(pub.data, null)
  assert.equal(pub.res.headers.get('cache-control'), 'public, max-age=60')

  // Gate: signed out 401, staff (no products.edit) 403.
  await call('/api/admin/site/hero', { admin: 0, status: 401 })
  await call('/api/admin/site/hero', { admin: STAFF, status: 403 })
  await put(webp, '', { admin: STAFF, status: 403 })

  // Content is sniffed, not trusted; size is capped at 3 MB.
  await put(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), '', { status: 415 })
  await put(Buffer.concat([webp, Buffer.alloc(3 * 1024 * 1024)]), '', { status: 413 })
  await put(webp, 'x'.repeat(201), { status: 400 })
  await call('/api/admin/site/hero', { method: 'PUT', form: new FormData(), status: 400 })

  // Upload: fresh key per upload, served from /api/files/models immutably.
  const first = (await put(webp, ' Худи LOOM ')).data.hero
  assert.match(first.url, /^http:\/\/localhost\/api\/files\/models\/site\/hero\/[0-9a-f-]{36}\.webp$/)
  assert.equal(first.alt, 'Худи LOOM')
  const file = await call(new URL(first.url).pathname, { admin: 0 })
  assert.equal(file.res.headers.get('content-type'), 'image/webp')
  assert.match(file.res.headers.get('cache-control'), /immutable/)
  pub = await call('/api/site/hero', { admin: 0 })
  assert.deepEqual(pub.data, first)
  assert.equal((await db.prepare("SELECT updated_by FROM site_settings WHERE key = 'home_hero'").first()).updated_by, OWNER)

  const second = (await put(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]))).data.hero
  assert.match(second.url, /\.jpg$/)
  assert.notEqual(second.url, first.url)
  assert.deepEqual((await call('/api/admin/site/hero')).data.hero, second)

  // No file while a hero exists: only the alt text changes (B26).
  const altOnly = new FormData()
  altOnly.append('alt', 'Новое описание')
  assert.deepEqual((await call('/api/admin/site/hero', { method: 'PUT', form: altOnly })).data.hero, { url: second.url, alt: 'Новое описание' })

  // Reset: back to the static default.
  assert.equal((await call('/api/admin/site/hero', { method: 'DELETE' })).data.hero, null)
  assert.equal((await call('/api/site/hero', { admin: 0 })).data, null)
  await call('/api/admin/site/hero', { method: 'DELETE', admin: STAFF, status: 403 })

  console.log(`site hero API: ${checks} route checks passed`)
} finally {
  await mf.dispose()
  await rm(scratch, { recursive: true, force: true })
}
