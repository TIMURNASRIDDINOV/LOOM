// LOOM-269: Instagram posts admin API on a local D1/R2, no Meta calls.
// Covers the migration, capabilities, status moves, caption limits, media
// upload and the kill switch. Run: node backend/scripts/instagram-test.mjs
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
const scratch = await mkdtemp(join(tmpdir(), 'loom-269-'))
const secret = 'local-instagram-test-only-not-a-production-secret'
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

const OWNER = 1, STAFF = 2, MANAGER = 3
let checks = 0
async function call(path, { method = 'GET', body, form, admin = OWNER, status = 200 } = {}) {
  const headers = admin ? { Cookie: `admin_token=${token(admin)}` } : {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let payload = body === undefined ? undefined : JSON.stringify(body)
  if (form) { // Miniflare 4 does not serialise a Node FormData: encode the multipart body here.
    const encoded = new Response(form)
    headers['Content-Type'] = encoded.headers.get('content-type')
    payload = Buffer.from(await encoded.arrayBuffer())
  }
  const res = await mf.dispatchFetch(`http://localhost${path}`, { method, headers, body: payload })
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : res
  assert.equal(res.status, status, `${method} ${path}: ${JSON.stringify(data)}`)
  checks++
  return data
}
const upload = (bytes, opts = {}) => {
  const form = new FormData()
  form.append('file', new Blob([bytes]), 'x.jpg')
  return call('/api/admin/instagram/media', { method: 'POST', form, ...opts })
}

try {
  const db = await mf.getD1Database('DB')
  for (const file of (await readdir(join(root, 'migrations'))).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = (await readFile(join(root, 'migrations', file), 'utf8')).replace(/--[^\n]*/g, '')
    for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run()
  }
  await db.prepare('DELETE FROM admins').run()
  await db.prepare("INSERT INTO admins (id,email,password_hash,role,created_at) VALUES (1,'owner@test.invalid','x','owner',1),(2,'staff@test.invalid','x','staff',1),(3,'manager@test.invalid','x','manager',1)").run()

  // AC-1: schema and the paused-by-default seed.
  const cols = (await db.prepare('PRAGMA table_info(ig_posts)').all()).results.map((r) => r.name)
  for (const col of ['id', 'caption_uz', 'caption_ru', 'caption_en', 'langs', 'media_key', 'media_url', 'publish_at', 'status', 'source', 'attempts', 'error',
    'ig_container_id', 'ig_media_id', 'permalink', 'created_by', 'approved_by', 'approved_at', 'published_at', 'created_at', 'updated_at']) assert.ok(cols.includes(col), col)
  assert.equal((await db.prepare("SELECT value FROM ig_settings WHERE key = 'publish_paused'").first()).value, '1')

  // AC-2: catalogue and presets.
  const catalog = await call('/api/admin/permissions/catalog')
  assert.ok(catalog.groups.some((g) => g.id === 'instagram'))
  for (const id of ['instagram.edit', 'instagram.approve']) assert.ok(catalog.capabilities.find((c) => c.id === id && c.group === 'instagram' && c.label))
  assert.ok(catalog.presets.manager.includes('instagram.edit') && !catalog.presets.manager.includes('instagram.approve'))
  assert.ok(!catalog.presets.staff.some((c) => c.startsWith('instagram.')))

  // AC-6: JPEG only, public URL.
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9])
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j/kcAAAAASUVORK5CYII=', 'base64')
  await upload(png, { status: 415 })
  await upload(Buffer.from('not a jpeg'), { status: 415 })
  await upload(jpeg, { admin: STAFF, status: 403 })
  const media = await upload(jpeg, { status: 201 })
  assert.match(media.key, /^instagram\/[0-9a-f-]{36}\.jpg$/)
  const served = await call(new URL(media.url).pathname, { admin: 0 })
  assert.equal(served.headers.get('content-type'), 'image/jpeg')
  await call('/api/files/instagram/not-a-uuid.jpg', { admin: 0, status: 404 })

  // AC-3: create is always a draft; no capability, no access.
  const future = new Date(Date.now() + 86400000).toISOString()
  await call('/api/admin/instagram/posts', { admin: STAFF, status: 403 })
  await call('/api/admin/instagram/posts', { method: 'POST', admin: STAFF, body: {}, status: 403 })
  const { post } = await call('/api/admin/instagram/posts', { method: 'POST', admin: MANAGER, status: 201,
    body: { caption_uz: 'Salom #loom', caption_ru: 'Привет', caption_en: '', langs: ['en', 'uz', 'ru', 'xx'], media_key: media.key, publish_at: future, status: 'approved' } })
  assert.equal(post.status, 'draft')
  assert.equal(post.source, 'manual')
  assert.deepEqual(post.langs, ['uz', 'ru', 'en'])
  assert.equal(post.media_url, media.url)
  // AC-5: one composer — uz, blank line, ru; empty en skipped.
  assert.equal(post.caption, 'Salom #loom\n\nПривет')
  const base = `/api/admin/instagram/posts/${post.id}`
  assert.equal((await call(`${base}`, { method: 'PATCH', body: { langs: ['ru'] } })).post.caption, 'Привет')
  await call(base, { method: 'PATCH', body: { langs: ['uz', 'ru'] } })
  assert.equal((await call(base, { method: 'PATCH', body: { media_key: 'instagram/00000000-0000-0000-0000-000000000000.jpg' }, status: 400 })).code, 'ig_media_key')

  // AC-4: approval is owner-only by default and checks the post.
  await call(`${base}/approve`, { method: 'POST', admin: MANAGER, status: 403 })
  const approved = (await call(`${base}/approve`, { method: 'POST' })).post
  assert.equal(approved.status, 'approved')
  assert.equal(approved.approved_by, OWNER)
  assert.ok(approved.approved_at)
  await call(`${base}/approve`, { method: 'POST', status: 409 })
  // An unchanged save keeps the approval; a real edit drops it.
  assert.equal((await call(base, { method: 'PATCH', body: { caption_ru: 'Привет' } })).post.status, 'approved')
  const edited = (await call(base, { method: 'PATCH', admin: MANAGER, body: { caption_ru: 'Привет, ты!' } })).post
  assert.deepEqual([edited.status, edited.approved_by, edited.approved_at], ['draft', null, null])

  const refuse = async (patch, code) => {
    await call(base, { method: 'PATCH', body: patch })
    assert.equal((await call(`${base}/approve`, { method: 'POST', status: 422 })).code, code)
  }
  const ok = { caption_uz: 'Salom', caption_ru: '', caption_en: '', langs: ['uz', 'ru', 'en'], media_key: media.key, publish_at: future }
  await refuse({ ...ok, caption_uz: 'x'.repeat(2201) }, 'ig_caption_too_long')
  // The limit is on the composed text: 1100 + 2 + 1099 = 2201.
  await refuse({ ...ok, caption_uz: 'x'.repeat(1100), caption_ru: 'y'.repeat(1099) }, 'ig_caption_too_long')
  await refuse({ ...ok, caption_uz: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ') }, 'ig_too_many_hashtags')
  await refuse({ ...ok, caption_uz: Array.from({ length: 21 }, (_, i) => `@u${i}`).join(' ') }, 'ig_too_many_mentions')
  await refuse({ ...ok, langs: [] }, 'ig_no_language')
  await refuse({ ...ok, caption_uz: '   ' }, 'ig_no_language')
  await refuse({ ...ok, media_key: null }, 'ig_no_media')
  await refuse({ ...ok, publish_at: new Date(Date.now() - 60000).toISOString() }, 'ig_publish_at_past')
  // At the limits exactly it passes; an e-mail is not a mention.
  await call(base, { method: 'PATCH', body: { ...ok, caption_uz: `${Array.from({ length: 30 }, (_, i) => `#t${i}`).join(' ')} hi@loomdesign.uz`.padEnd(2200, '.') } })
  assert.equal((await call(`${base}/approve`, { method: 'POST' })).post.status, 'approved')

  // Cron-owned states are locked; failed → retry → draft; reject; back to draft.
  await db.prepare("UPDATE ig_posts SET status = 'publishing' WHERE id = ?").bind(post.id).run()
  assert.equal((await call(base, { method: 'PATCH', body: ok, status: 409 })).code, 'ig_locked')
  await call(`${base}/reject`, { method: 'POST', status: 409 })
  await db.prepare("UPDATE ig_posts SET status = 'published' WHERE id = ?").bind(post.id).run()
  await call(base, { method: 'PATCH', body: ok, status: 409 })
  await db.prepare("UPDATE ig_posts SET status = 'failed', attempts = 3, error = 'x' WHERE id = ?").bind(post.id).run()
  await call(`${base}/retry`, { method: 'POST', admin: MANAGER, status: 403 })
  const retried = (await call(`${base}/retry`, { method: 'POST' })).post
  assert.deepEqual([retried.status, retried.attempts, retried.error, retried.approved_by], ['draft', 0, null, null])
  assert.equal((await call(`${base}/reject`, { method: 'POST', admin: MANAGER })).post.status, 'rejected')
  await call(`${base}/approve`, { method: 'POST', status: 409 })
  assert.equal((await call(`${base}/draft`, { method: 'POST', admin: MANAGER })).post.status, 'draft')
  assert.equal((await call('/api/admin/instagram/posts?status=draft')).items.length, 1)
  assert.equal((await call('/api/admin/instagram/posts?status=approved')).items.length, 0)
  await call('/api/admin/instagram/posts/999/approve', { method: 'POST', status: 404 })

  // AC-7: kill switch.
  const settings = await call('/api/admin/instagram/settings', { admin: MANAGER })
  assert.deepEqual([settings.publish_paused, settings.token_configured], [true, false])
  await call('/api/admin/instagram/settings', { method: 'PUT', admin: MANAGER, body: { publish_paused: false }, status: 403 })
  await call('/api/admin/instagram/settings', { method: 'PUT', body: { publish_paused: 0 }, status: 400 })
  await call('/api/admin/instagram/settings', { method: 'PUT', body: { publish_paused: false } })
  const after = await call('/api/admin/instagram/settings')
  assert.deepEqual([after.publish_paused, after.updated_by], [false, OWNER])
  await call('/api/admin/instagram/settings', { admin: 0, status: 401 })

  console.log(`instagram admin API: ${checks} route checks passed`)
} finally {
  await mf.dispose()
  await rm(scratch, { recursive: true, force: true })
}
