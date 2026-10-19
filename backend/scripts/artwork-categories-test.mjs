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
const mf = new Miniflare({ modules: true, modulesRoot: scratch, scriptPath: join(scratch, 'worker.mjs'), compatibilityDate: '2024-09-23', cf: false,
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
  await db.prepare("INSERT INTO admins (id,email,password_hash,role,created_at) VALUES (1,'owner@test.invalid','unused','owner',1),(2,'staff@test.invalid','unused','staff',1),(3,'manager@test.invalid','unused','manager',1)").run()
  await db.prepare("INSERT INTO users (id,email,password_hash,is_designer,designer_handle,created_at) VALUES (1,'designer@test.invalid','unused',1,'@test',1),(2,'buyer@test.invalid','unused',0,NULL,1)").run()
  for (const id of [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]) await db.prepare("INSERT INTO users (id,email,password_hash,is_designer,telegram_user_id,created_at) VALUES (?,?,'unused',0,?,1)").bind(id, `buyer${id}@test.invalid`, 1000 + id).run()
  await db.prepare("INSERT INTO artworks (id,user_id,title,image_key,markup,status,created_at,updated_at) VALUES (1,1,'Legacy','legacy.png',15000,'approved',1,1)").run()
  await db.prepare("INSERT INTO orders (id,user_id,customer_name,customer_phone,design_json,total_price,status,created_at,updated_at) VALUES (1,1,'Test','+998900000000','{}',115000,'delivered',1,1)").run()
  await db.prepare('INSERT INTO artwork_sales (order_id,artwork_id,designer_user_id,quantity,markup,commission_pct,designer_share,created_at) VALUES (1,1,1,1,15000,30,10500,1)').run()
  const before = await db.prepare('SELECT * FROM artwork_sales').all()
  const orderCount = async () => (await db.prepare('SELECT COUNT(*) AS n FROM orders').first()).n
  const edits = async () => (await db.prepare("SELECT user_id, metadata FROM user_activity_log WHERE action = 'artwork_edited' ORDER BY id").all())
    .results.map((row) => ({ user_id: row.user_id, ...JSON.parse(row.metadata) }))
  const design = (...elements) => JSON.stringify({ version: 2, front: { elements }, back: { elements: [] } })
  const addToCart = (user, unitPrice, ...elements) => request('/api/cart', { method: 'POST', user, body: { designJson: design(...elements), unitPrice }, status: 201 })
  const checkout = (user, status) => request('/api/cart/checkout', { method: 'POST', user, body: { customerName: 'Test', customerPhone: '+998900000000' }, status })
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
  assert.equal((await request('/api/admin/artwork-categories', { method: 'POST', body: { ...category, name_uz: ' ' }, status: 400 })).code, 'category_names')
  await request('/api/admin/artwork-categories/999', { method: 'PATCH', body: category, status: 404 })
  const details = { title: 'Updated', tags: 'new, tags', markup: 35000, category_id: categoryId }
  await request('/api/admin/artworks/1', { method: 'PATCH', admin: 2, body: details, status: 403 })
  await request('/api/admin/artworks/1', { method: 'PATCH', anonymous: true, body: details, status: 401 })
  await request('/api/admin/artworks/1', { method: 'PATCH', user: 1, body: details, status: 401 })
  const invalid = [
    [{ title: ' ' }, 'artwork_title'], [{ title: 'x'.repeat(81) }, 'artwork_title'],
    [{ markup: -1 }, 'artwork_markup'], [{ markup: 200001 }, 'artwork_markup'], [{ markup: 1.5 }, 'artwork_markup'], [{ markup: '100' }, 'artwork_markup'],
    [{ tags: 'x'.repeat(201) }, 'artwork_tags'], [{ tags: 5 }, 'artwork_tags'], [{ category_id: 999 }, 'artwork_category'], [{ category_id: null }, 'artwork_category'],
  ]
  for (const [patch, code] of invalid) {
    assert.equal((await request('/api/admin/artworks/1', { method: 'PATCH', body: { ...details, ...patch }, status: 400 })).code, code)
  }
  assert.equal((await request('/api/admin/artworks/1', { method: 'PATCH', body: null, status: 400 })).code, 'invalid_json')
  // A cart saved at the old price, before the admin changes it.
  const stale = (await addToCart(10, 115000, { artworkId: 1, artworkPrice: 15000 })).items[0]
  const changed = await request('/api/admin/artworks/1', { method: 'PATCH', body: details })
  assert.equal(changed.artwork.status, 'approved')
  assert.equal(changed.artwork.image_key, 'legacy.png')
  assert.equal(changed.artwork.user_id, 1)
  assert.equal(changed.artwork.tags, 'new, tags')
  assert.deepEqual((await db.prepare('SELECT * FROM artwork_sales').all()).results, before.results)
  assert.equal((await db.prepare('SELECT total_price FROM orders WHERE id = 1').first()).total_price, 115000)
  assert.deepEqual(await edits(), [{ user_id: 1, artwork_id: 1, title: 'Legacy', by_admin_id: 1, changes: {
    title: { from: 'Legacy', to: 'Updated' }, markup: { from: 15000, to: 35000 }, tags: { from: null, to: 'new, tags' }, category_id: { from: null, to: categoryId },
  } }])
  await request('/api/admin/artworks/1', { method: 'PATCH', body: details })
  assert.equal((await edits()).length, 1)
  // Existing cart totals stay untouched; checkout must stop before creating an
  // order if an admin changed the referenced artwork's price after cart save.
  await db.prepare('UPDATE users SET telegram_user_id = 12345 WHERE id = 1').run()
  await db.prepare('INSERT INTO cart_items (user_id, design_json, unit_price, quantity, created_at, updated_at) VALUES (1, ?, 115000, 1, 1, 1)')
    .bind(JSON.stringify({ version: 2, front: { elements: [{ artworkId: 1 }] } })).run()
  const blocked = await request('/api/cart/checkout', { method: 'POST', user: 1, body: { customerName: 'Test', customerPhone: '+998900000000' }, status: 409 })
  assert.deepEqual([blocked.code, blocked.artworkTitle, blocked.currentPrice], ['artwork_price_changed', 'Updated', 35000])
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM orders').first()).n, 1)
  assert.equal((await db.prepare('SELECT unit_price FROM cart_items WHERE user_id = 1').first()).unit_price, 115000)
  // The recorded price decides, whether the old item is re-saved from the bag or re-sent by an app sync.
  const refused = await checkout(10, 409)
  assert.deepEqual({ ...refused, error: typeof refused.error }, { error: 'string', code: 'artwork_price_changed', itemId: stale.id, artworkId: 1, artworkTitle: 'Updated', currentPrice: 35000 })
  await addToCart(10, 115000, { artworkId: 1, artworkPrice: 15000 })
  await request(`/api/cart/${stale.id}`, { method: 'DELETE', user: 10 })
  assert.equal((await checkout(10, 409)).code, 'artwork_price_changed')
  await request('/api/cart', { method: 'DELETE', user: 10 })
  await addToCart(10, 115000, { artworkId: 1, artworkPrice: 15000 })
  assert.equal((await checkout(10, 409)).artworkId, 1)
  assert.equal(await orderCount(), 1)
  await request('/api/cart', { method: 'DELETE', user: 10 })
  await addToCart(10, 150000, { artworkId: 1, artworkPrice: 35000 })
  const paid = await checkout(10, 201)
  assert.equal((await db.prepare('SELECT unit_price FROM order_items WHERE order_id = ?').bind(paid.id).first()).unit_price, 150000)
  assert.deepEqual(await db.prepare('SELECT artwork_id, markup, designer_share FROM artwork_sales WHERE order_id = ?').bind(paid.id).first(), { artwork_id: 1, markup: 35000, designer_share: 24500 })
  await db.prepare('INSERT INTO cart_items (user_id, design_json, unit_price, quantity, created_at, updated_at) VALUES (11, ?, 150000, 1, 1, 1)')
    .bind(design({ artworkId: 1, artworkPrice: 35000 })).run()
  await checkout(11, 201)
  await addToCart(12, 150000, { artworkId: 1 })
  await checkout(12, 201)
  await addToCart(13, 115000, { type: 'text', content: 'Text only' })
  await checkout(13, 201)
  const filtered = await request(`/api/artworks?category_id=${categoryId}`, { anonymous: true })
  assert.equal(filtered.total, 1)
  assert.equal(filtered.items[0].title, details.title)
  assert.equal(filtered.items[0].markup, 35000)
  assert.equal(filtered.items[0].tags, 'new, tags')
  // Edits that leave the markup alone keep cart items valid.
  await addToCart(14, 150000, { artworkId: 1, artworkPrice: 35000 })
  await addToCart(14, 150000, { artworkId: 1 })
  const { id: otherCategoryId } = await request('/api/admin/artwork-categories', { method: 'POST', body: { name_ru: 'Другая', name_uz: 'Boshqa', name_en: 'Other' }, status: 201 })
  let edited = details
  for (const patch of [{ title: 'Title only' }, { tags: 'tags only' }, { category_id: otherCategoryId }, { category_id: categoryId }]) {
    edited = { ...edited, ...patch }
    assert.equal((await request('/api/admin/artworks/1', { method: 'PATCH', body: edited })).artwork.price_updated_at, changed.artwork.price_updated_at)
  }
  assert.equal((await checkout(14, 201)).itemCount, 2)
  await request(`/api/admin/artwork-categories/${categoryId}`, { method: 'PATCH', body: { ...category, name_en: 'Renamed', active: false } })
  const { id: emptyId } = await request('/api/admin/artwork-categories', { method: 'POST', body: { ...category, active: false }, status: 201 })
  let listed = (await request('/api/artwork-categories', { anonymous: true })).items
  assert.equal(listed.find((c) => c.id === categoryId).name_en, 'Renamed')
  assert.equal(listed.find((c) => c.id === categoryId).active, 0)
  assert.equal(listed.some((c) => c.id === emptyId), false)
  for (const active of ['yes', 1, null]) {
    assert.equal((await request('/api/admin/artwork-categories', { method: 'POST', body: { ...category, active }, status: 400 })).code, 'category_names')
    assert.equal((await request(`/api/admin/artwork-categories/${emptyId}`, { method: 'PATCH', body: { ...category, name_en: 'Bad', active }, status: 400 })).code, 'category_names')
  }
  const names = { name_ru: 'Имя', name_uz: 'Nom', name_en: 'Name' }
  await request(`/api/admin/artwork-categories/${categoryId}`, { method: 'PATCH', body: names })
  await request(`/api/admin/artwork-categories/${otherCategoryId}`, { method: 'PATCH', body: names })
  const stored = async () => Object.fromEntries((await request('/api/admin/artwork-categories', { admin: 2 })).items.map((c) => [c.id, [c.name_en, c.active]]))
  let rows = await stored()
  assert.deepEqual([rows[categoryId], rows[otherCategoryId], rows[emptyId]], [['Name', 0], ['Name', 1], ['Test', 0]])
  await request(`/api/admin/artwork-categories/${emptyId}`, { method: 'PATCH', body: { ...category, active: true } })
  assert.equal((await stored())[emptyId][1], 1)
  assert.equal((await request('/api/artwork-categories', { anonymous: true })).items.some((c) => c.id === emptyId), true)
  await request(`/api/admin/artwork-categories/${emptyId}`, { method: 'PATCH', body: { ...category, active: false } })
  assert.equal((await stored())[emptyId][1], 0)
  await db.prepare("INSERT INTO admin_permissions (admin_id, capability, granted, updated_at) VALUES (2, 'artworks.view', 0, 1)").run()
  assert.equal((await request('/api/admin/artwork-categories', { admin: 2, status: 403 })).code, 'forbidden')
  await db.prepare('DELETE FROM admin_permissions WHERE admin_id = 2').run()
  await request('/api/admin/artwork-categories', { anonymous: true, status: 401 })
  const retained = await request('/api/admin/artworks/1', { method: 'PATCH', body: { ...details, title: 'Keep inactive category' } })
  assert.equal(retained.artwork.price_updated_at, changed.artwork.price_updated_at)
  await db.prepare("INSERT INTO uploads (key,user_id,created_at) VALUES ('new.png',1,1),('other.png',1,1)").run()
  const submission = { ...details, image_key: 'new.png', width: 2000, height: 2000 }
  await request('/api/designer/artworks', { method: 'POST', user: 1, body: submission, status: 400 })
  await request('/api/designer/artworks', { method: 'POST', user: 2, body: { ...submission, category_id: 1 }, status: 403 })
  await request('/api/designer/artworks', { method: 'POST', user: 1, body: { ...submission, category_id: undefined }, status: 400 })
  const artwork = await request('/api/designer/artworks', { method: 'POST', user: 1, body: { ...submission, category_id: 1 }, status: 201 })
  const hidden = async () => {
    for (const path of ['/api/artworks', '/api/artworks?category_id=1']) assert.equal((await request(path, { anonymous: true })).items.some((a) => a.id === artwork.id), false)
    assert.equal((await request('/api/artworks?category_id=1', { anonymous: true })).total, 0)
  }
  await hidden()
  const mine = await request('/api/designer/artworks', { user: 1 })
  assert.equal(mine.items.find((a) => a.id === artwork.id).category_id, 1)
  assert.equal((await request('/api/admin/artworks?status=pending', { admin: 2 })).items.find((a) => a.id === artwork.id).category_id, 1)
  await request(`/api/admin/artworks/${artwork.id}`, { method: 'PATCH', body: { ...details, category_id: categoryId }, status: 400 })
  const limits = await request(`/api/admin/artworks/${artwork.id}`, { method: 'PATCH', body: { ...details, category_id: 1, title: 'x'.repeat(80), markup: 200000 } })
  assert.deepEqual([limits.artwork.status, limits.artwork.title.length, limits.artwork.markup], ['pending', 80, 200000])
  const free = await request(`/api/admin/artworks/${artwork.id}`, { method: 'PATCH', admin: 3, body: { ...details, category_id: 1, markup: 0 } })
  assert.deepEqual([free.artwork.status, free.artwork.markup], ['pending', 0])
  assert.deepEqual(Object.keys((await edits()).at(-1).changes).sort(), ['markup', 'title'])
  assert.equal((await edits()).at(-1).by_admin_id, 3)
  await db.prepare("INSERT INTO admin_permissions (admin_id, capability, granted, updated_at) VALUES (2, 'artworks.edit', 1, 1)").run()
  const byStaff = await request(`/api/admin/artworks/${artwork.id}`, { method: 'PATCH', admin: 2, body: { ...details, category_id: 1, markup: 0, tags: 'staff' } })
  assert.deepEqual([byStaff.artwork.status, byStaff.artwork.tags], ['pending', 'staff'])
  assert.deepEqual((await edits()).at(-1), { user_id: 1, artwork_id: artwork.id, title: details.title, by_admin_id: 2, changes: { tags: { from: 'new, tags', to: 'staff' } } })
  await request(`/api/admin/artworks/${artwork.id}/review`, { method: 'POST', admin: 2, body: { decision: 'approve' }, status: 403 })
  await db.prepare('DELETE FROM admin_permissions WHERE admin_id = 2').run()
  await hidden()
  await request(`/api/admin/artworks/${artwork.id}/review`, { method: 'POST', body: { decision: 'approve' } })
  assert.equal((await request('/api/artworks?category_id=1', { anonymous: true })).total, 1)
  await request(`/api/admin/artworks/${artwork.id}/review`, { method: 'POST', body: { decision: 'reject', note: 'Test rejection' } })
  await hidden()
  // Real pagination must count only the selected category.
  for (let i = 0; i < 42; i++) await db.prepare("INSERT INTO artworks (user_id,title,image_key,markup,status,category_id,created_at,updated_at) VALUES (1,?,'legacy.png',0,'approved',1,1,1)").bind(`Page ${i}`).run()
  const first = await request('/api/artworks?category_id=1&page=1', { anonymous: true })
  const second = await request('/api/artworks?category_id=1&page=2', { anonymous: true })
  assert.equal(first.total, 42)
  assert.equal(first.items.length, 40)
  assert.equal(second.items.length, 2)
  assert.equal(new Set([...first.items, ...second.items].map((a) => a.id)).size, 42)
  assert.deepEqual(await request('/api/artworks?category_id=1&page=3', { anonymous: true }), { items: [], page: 3, total: 42 })
  const approved = (await db.prepare("SELECT COUNT(*) AS n FROM artworks WHERE status = 'approved'").first()).n
  assert.deepEqual(await request('/api/artworks?page=9', { anonymous: true }), { items: [], page: 9, total: approved })
  // Offset paging shifts by one when newer work is approved; clients drop the repeat.
  await db.prepare("INSERT INTO artworks (user_id,title,image_key,markup,status,category_id,created_at,updated_at) VALUES (1,'Newest','legacy.png',0,'approved',1,2,2)").run()
  assert.equal((await request('/api/artworks?category_id=1&page=2', { anonymous: true })).items[0].id, first.items[39].id)
  // Only the repriced artwork of a two-artwork item is refused, before any order is written.
  await db.prepare("INSERT INTO artworks (id,user_id,title,image_key,markup,status,category_id,created_at,updated_at) VALUES (900,1,'Second','legacy.png',20000,'approved',1,1,1)").run()
  await addToCart(15, 170000, { artworkId: 1, artworkPrice: 35000 }, { artworkId: 900, artworkPrice: 20000 })
  await request('/api/admin/artworks/900', { method: 'PATCH', body: { title: 'Second', markup: 25000, category_id: 1 } })
  const orders = await orderCount()
  const twice = await checkout(15, 409)
  assert.deepEqual([twice.code, twice.artworkId, twice.artworkTitle, twice.currentPrice], ['artwork_price_changed', 900, 'Second', 25000])
  assert.equal(await orderCount(), orders)
  // Re-adding at the price the refusal names goes through, and the sale uses it.
  await request('/api/cart', { method: 'DELETE', user: 15 })
  await addToCart(15, 175000, { artworkId: 1, artworkPrice: 35000 }, { artworkId: 900, artworkPrice: twice.currentPrice })
  const repriced = await checkout(15, 201)
  assert.deepEqual((await db.prepare('SELECT artwork_id, markup FROM artwork_sales WHERE order_id = ? ORDER BY artwork_id').bind(repriced.id).all()).results,
    [{ artwork_id: 1, markup: 35000 }, { artwork_id: 900, markup: 25000 }])
  // One cart row with an exact design_json text and age.
  const seed = async (user, json, createdAt) => {
    await db.prepare('DELETE FROM cart_items WHERE user_id = ?').bind(user).run()
    return (await db.prepare('INSERT INTO cart_items (user_id, design_json, unit_price, quantity, created_at, updated_at) VALUES (?, ?, 150000, 1, ?, ?)')
      .bind(user, json, createdAt, createdAt).run()).meta.last_row_id
  }
  // Unpublished artworks are still refused, but without their title or markup.
  await db.prepare("INSERT INTO artworks (id,user_id,title,image_key,markup,status,category_id,created_at,updated_at,price_updated_at) VALUES (901,1,'Pending','legacy.png',10000,'pending',1,1,1,?1),(902,1,'Rejected','legacy.png',10000,'rejected',1,1,1,?1)")
    .bind(Date.now()).run()
  for (const [user, id, old] of [[16, 901, 5000], [17, 902, 5000], [18, artwork.id, 200000]]) {
    for (const [element, createdAt] of [[{ artworkId: id, artworkPrice: old }, Date.now()], [{ artworkId: id }, 1]]) {
      const itemId = await seed(user, design(element), createdAt)
      const count = await orderCount()
      const body = await checkout(user, 409)
      assert.deepEqual({ ...body, error: typeof body.error }, { error: 'string', code: 'artwork_price_changed', itemId, artworkId: id })
      assert.equal(await orderCount(), count)
    }
  }
  // A recorded price that is not a finite number counts as unrecorded: the row's age decides.
  for (const raw of ['"35000"', 'null', '1e999', '"NaN"']) {
    const json = `{"version":2,"front":{"elements":[{"artworkId":1,"artworkPrice":${raw}}]},"back":{"elements":[]}}`
    await seed(19, json, 1)
    assert.equal((await checkout(19, 409)).currentPrice, 35000, raw)
    await seed(19, json, Date.now())
    await checkout(19, 201)
  }
  // A negative recorded price is compared as a price, so a fresh row is still refused.
  await seed(15, design({ artworkId: 1, artworkPrice: -1 }), Date.now())
  assert.equal((await checkout(15, 409)).currentPrice, 35000)
  console.log(`PASS: ${checks} route checks; migrations, permissions, validation, inactive assignments, moderation, pagination, immutable sales/orders, stale-price checkout.`)
  if (serve) {
    console.log('LOCAL FIXTURE READY http://localhost:8787 (ephemeral DB; no remote data)')
    await new Promise(() => {})
  }
} finally {
  await mf.dispose()
  await rm(scratch, { recursive: true, force: true })
}
