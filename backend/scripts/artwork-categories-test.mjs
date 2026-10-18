// LOOM-241: exercise real Worker routes and SQLite/D1, without remote resources.
// Run: node backend/scripts/artwork-categories-test.mjs
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
const scratch = await mkdtemp(join(tmpdir(), 'loom-241-'))
const secret = 'local-artwork-test-only-not-a-production-secret'
export function token(id, role) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const raw = `${encode({ alg: 'HS256' })}.${encode({ sub: String(id), role, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}`
  return `${raw}.${createHmac('sha256', secret).update(raw).digest('base64url')}`
}
await build({ entryPoints: [join(root, 'src/index.ts')], outfile: join(scratch, 'worker.mjs'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022' })
const serve = process.argv.includes('--serve')
const mf = new Miniflare({ modules: true, modulesRoot: scratch, scriptPath: join(scratch, 'worker.mjs'), compatibilityDate: '2024-09-23',
  ...(serve ? { port: 8787, host: 'localhost' } : {}), d1Databases: ['DB'], r2Buckets: ['LOOM_UPLOADS', 'LOOM_MODELS'], kvNamespaces: ['RATE_LIMIT'],
  bindings: { JWT_SECRET: secret, ENVIRONMENT: 'test', TELEGRAM_BOT_TOKEN: '', BOT_USERNAME: '' } })
let checks = 0
async function request(path, { method = 'GET', body, admin = 1, user, status = 200, anonymous = false } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (!anonymous) {
    if (user) headers.Authorization = `Bearer ${token(user, 'user')}`
    else headers.Cookie = `admin_token=${token(admin, 'admin')}`
  }
  const res = await mf.dispatchFetch(`http://localhost${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const data = await res.json()
  assert.equal(res.status, status, `${method} ${path}: ${JSON.stringify(data)}`)
  checks++
  return data
}
try {
  const db = await mf.getD1Database('DB')
  const bucket = await mf.getR2Bucket('LOOM_UPLOADS')
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j/kcAAAAASUVORK5CYII=', 'base64')
  for (const key of ['legacy.png', 'new.png']) await bucket.put(key, Uint8Array.from(pixel).buffer, { httpMetadata: { contentType: 'image/png' } })
  for (const file of (await readdir(join(root, 'migrations'))).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = (await readFile(join(root, 'migrations', file), 'utf8')).replace(/--[^\n]*/g, '')
    for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run()
  }
  await db.prepare("DELETE FROM admins").run()
  await db.prepare("INSERT INTO admins (id,email,password_hash,role,created_at) VALUES (1,'owner@test.invalid','unused','owner',1),(2,'staff@test.invalid','unused','staff',1)").run()
  await db.prepare("INSERT INTO users (id,email,password_hash,is_designer,designer_handle,created_at) VALUES (1,'designer@test.invalid','unused',1,'@test',1),(2,'buyer@test.invalid','unused',0,NULL,1)").run()
  await db.prepare("INSERT INTO artworks (id,user_id,title,image_key,markup,status,created_at,updated_at) VALUES (1,1,'Legacy','legacy.png',15000,'approved',1,1)").run()
  await db.prepare("INSERT INTO orders (id,user_id,customer_name,customer_phone,design_json,total_price,status,created_at,updated_at) VALUES (1,1,'Test','+998900000000','{}',115000,'delivered',1,1)").run()
  await db.prepare('INSERT INTO artwork_sales (order_id,artwork_id,designer_user_id,quantity,markup,commission_pct,designer_share,created_at) VALUES (1,1,1,1,15000,30,10500,1)').run()
  const before = await db.prepare('SELECT * FROM artwork_sales').all()
  const cats = await request('/api/artwork-categories', { anonymous: true })
  assert.equal(cats.items.length, 6)
  assert.equal((await request('/api/artworks', { anonymous: true })).items[0].category_id, null)
  assert.equal((await request('/api/artworks?category_id=1', { anonymous: true })).total, 0)
  await request('/api/artworks?category_id=1junk', { anonymous: true, status: 400 })
  const category = { name_ru: 'Тест', name_uz: 'Sinov', name_en: 'Test', active: true }
  const { id: categoryId } = await request('/api/admin/artwork-categories', { method: 'POST', body: category, status: 201 })
  await request('/api/admin/artwork-categories', { method: 'POST', admin: 2, body: category, status: 403 })
  await request(`/api/admin/artwork-categories/${categoryId}`, { method: 'PATCH', admin: 2, body: category, status: 403 })
  await request('/api/admin/artwork-categories', { method: 'POST', anonymous: true, body: category, status: 401 })
  await request('/api/admin/artwork-categories', { method: 'POST', body: { ...category, name_uz: ' ' }, status: 400 })
  await request('/api/admin/artwork-categories/999', { method: 'PATCH', body: category, status: 404 })
  const details = { title: 'Updated', tags: 'new, tags', markup: 35000, category_id: categoryId }
  await request('/api/admin/artworks/1', { method: 'PATCH', admin: 2, body: details, status: 403 })
  await request('/api/admin/artworks/1', { method: 'PATCH', anonymous: true, body: details, status: 401 })
  await request('/api/admin/artworks/1', { method: 'PATCH', user: 1, body: details, status: 401 })
  for (const patch of [{ title: ' ' }, { title: 'x'.repeat(81) }, { markup: -1 }, { markup: 200001 }, { markup: 1.5 }, { markup: '100' }, { tags: 'x'.repeat(201) }, { category_id: 999 }, { category_id: null }]) {
    await request('/api/admin/artworks/1', { method: 'PATCH', body: { ...details, ...patch }, status: 400 })
  }
  await request('/api/admin/artworks/1', { method: 'PATCH', body: null, status: 400 })
  const changed = await request('/api/admin/artworks/1', { method: 'PATCH', body: details })
  assert.equal(changed.artwork.status, 'approved')
  assert.equal(changed.artwork.image_key, 'legacy.png')
  assert.equal(changed.artwork.user_id, 1)
  assert.deepEqual((await db.prepare('SELECT * FROM artwork_sales').all()).results, before.results)
  assert.equal((await db.prepare('SELECT total_price FROM orders WHERE id = 1').first()).total_price, 115000)
  // Existing cart totals stay untouched; checkout must stop before creating an
  // order if an admin changed the referenced artwork's price after cart save.
  await db.prepare('UPDATE users SET telegram_user_id = 12345 WHERE id = 1').run()
  await db.prepare('INSERT INTO cart_items (user_id, design_json, unit_price, quantity, created_at, updated_at) VALUES (1, ?, 115000, 1, 1, 1)')
    .bind(JSON.stringify({ version: 2, front: { elements: [{ artworkId: 1 }] } })).run()
  const blocked = await request('/api/cart/checkout', { method: 'POST', user: 1, body: { customerName: 'Test', customerPhone: '+998900000000' }, status: 409 })
  assert.equal(blocked.code, 'artwork_price_changed')
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM orders').first()).n, 1)
  assert.equal((await db.prepare('SELECT unit_price FROM cart_items WHERE user_id = 1').first()).unit_price, 115000)
  const filtered = await request(`/api/artworks?category_id=${categoryId}`, { anonymous: true })
  assert.equal(filtered.total, 1)
  assert.equal(filtered.items[0].title, details.title)
  assert.equal(filtered.items[0].markup, 35000)
  await request(`/api/admin/artwork-categories/${categoryId}`, { method: 'PATCH', body: { ...category, name_en: 'Renamed', active: false } })
  assert.equal((await request('/api/artwork-categories', { anonymous: true })).items.find((c) => c.id === categoryId).name_en, 'Renamed')
  const retained = await request('/api/admin/artworks/1', { method: 'PATCH', body: { ...details, title: 'Keep inactive category' } })
  assert.equal(retained.artwork.price_updated_at, changed.artwork.price_updated_at)
  await db.prepare("INSERT INTO uploads (key,user_id,created_at) VALUES ('new.png',1,1),('other.png',1,1)").run()
  const submission = { ...details, image_key: 'new.png', width: 2000, height: 2000 }
  await request('/api/designer/artworks', { method: 'POST', user: 1, body: submission, status: 400 })
  await request('/api/designer/artworks', { method: 'POST', user: 2, body: { ...submission, category_id: 1 }, status: 403 })
  await request('/api/designer/artworks', { method: 'POST', user: 1, body: { ...submission, category_id: undefined }, status: 400 })
  const artwork = await request('/api/designer/artworks', { method: 'POST', user: 1, body: { ...submission, category_id: 1 }, status: 201 })
  assert.equal((await request('/api/artworks?category_id=1', { anonymous: true })).total, 0)
  const mine = await request('/api/designer/artworks', { user: 1 })
  assert.equal(mine.items.find((a) => a.id === artwork.id).category_id, 1)
  await request(`/api/admin/artworks/${artwork.id}`, { method: 'PATCH', body: { ...details, category_id: categoryId }, status: 400 })
  await request(`/api/admin/artworks/${artwork.id}`, { method: 'PATCH', body: { ...details, category_id: 1, markup: 0 } })
  await db.prepare("INSERT INTO admin_permissions (admin_id, capability, granted, updated_at) VALUES (2, 'artworks.edit', 1, 1)").run()
  await request(`/api/admin/artworks/${artwork.id}`, { method: 'PATCH', admin: 2, body: { ...details, category_id: 1, markup: 0 } })
  await request(`/api/admin/artworks/${artwork.id}/review`, { method: 'POST', admin: 2, body: { decision: 'approve' }, status: 403 })
  await db.prepare('DELETE FROM admin_permissions WHERE admin_id = 2').run()
  await request(`/api/admin/artworks/${artwork.id}/review`, { method: 'POST', body: { decision: 'approve' } })
  assert.equal((await request('/api/artworks?category_id=1', { anonymous: true })).total, 1)
  await request(`/api/admin/artworks/${artwork.id}/review`, { method: 'POST', body: { decision: 'reject', note: 'Test rejection' } })
  assert.equal((await request('/api/artworks?category_id=1', { anonymous: true })).total, 0)
  // Real pagination must count only the selected category.
  for (let i = 0; i < 42; i++) await db.prepare("INSERT INTO artworks (user_id,title,image_key,markup,status,category_id,created_at,updated_at) VALUES (1,?,'legacy.png',0,'approved',1,1,1)").bind(`Page ${i}`).run()
  const first = await request('/api/artworks?category_id=1&page=1', { anonymous: true })
  const second = await request('/api/artworks?category_id=1&page=2', { anonymous: true })
  assert.equal(first.total, 42)
  assert.equal(first.items.length, 40)
  assert.equal(second.items.length, 2)
  assert.equal(new Set([...first.items, ...second.items].map((a) => a.id)).size, 42)
  console.log(`PASS: ${checks} route checks; migrations, permissions, validation, inactive assignments, moderation, pagination, immutable sales/orders.`)
  if (serve) {
    console.log('LOCAL FIXTURE READY http://localhost:8787 (ephemeral DB; no remote data)')
    await new Promise(() => {})
  }
} finally {
  await mf.dispose()
  await rm(scratch, { recursive: true, force: true })
}
