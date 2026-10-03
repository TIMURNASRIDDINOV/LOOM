import { Hono } from 'hono'
import {
  getAdminProducts,
  getProductById,
  createProduct,
  updateProduct,
  softDeleteProduct,
  hardDeleteProduct,
  countOrdersForProduct,
  AdminProductsFilter,
} from '../db/queries'
import { requireAdmin, requireCap } from '../middleware/requireAdmin'
import type { AdminEnv } from '../types'

// Product writes require manager or owner (staff is read-only here).

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildFileUrl(requestUrl: string, key: string): string {
  const { protocol, host } = new URL(requestUrl)
  return `${protocol}//${host}/api/files/models/${key}`
}

function withUrls(requestUrl: string, p: Record<string, unknown>) {
  return {
    ...p,
    glb_url: p.glb_key ? buildFileUrl(requestUrl, p.glb_key as string) : null,
    thumbnail_url: p.thumbnail_key ? buildFileUrl(requestUrl, p.thumbnail_key as string) : null,
  }
}

// Every upload gets a fresh key: files are served immutable for a year, so a
// reused key would leave customers on the old file. Old objects are kept;
// rows that still hold a legacy key (glb/<slug>.glb) keep resolving as-is.
function newAssetKey(prefix: 'glb' | 'thumbnails', slug: string, ext: string): string {
  return `${prefix}/${slug}/${crypto.randomUUID()}.${ext}`
}

type FileField = { name: string; type: string; size: number; stream: () => ReadableStream; arrayBuffer: () => Promise<ArrayBuffer> }

function getFileField(formData: FormData, key: string): FileField | null {
  const f = formData.get(key)
  if (!f || typeof (f as { name?: unknown }).name !== 'string') return null
  return f as unknown as FileField
}

function validateGlb(f: FileField): string | null {
  const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
  const allowedExts = new Set(['glb', 'gltf'])
  // Accept any content-type when the extension is valid — browsers often send
  // application/octet-stream or empty string for .glb files.
  if (!allowedExts.has(ext)) return 'GLB file must have .glb or .gltf extension'
  if (f.size > 20 * 1024 * 1024) return 'GLB file must be ≤ 20 MB'
  if (f.size <= 0) return 'Invalid GLB file size'
  return null
}

const THUMB_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

function validateThumbnail(f: FileField): { ext: string } | { error: string } {
  const ext = THUMB_TYPES[f.type]
  if (!ext) return { error: 'Thumbnail must be image/png, image/jpeg, or image/webp' }
  if (f.size > 2 * 1024 * 1024) return { error: 'Thumbnail must be ≤ 2 MB' }
  if (f.size <= 0) return { error: 'Invalid thumbnail file size' }
  return { ext }
}

function parseColors(val: unknown): string | null | { error: string } {
  if (val == null || val === '') return null
  if (typeof val !== 'string') return { error: 'base_colors must be a JSON string' }
  try {
    const parsed = JSON.parse(val)
    if (!Array.isArray(parsed)) return { error: 'base_colors must be a JSON array' }
    return val
  } catch {
    return { error: 'base_colors must be valid JSON' }
  }
}

// ─── Configurator config (LOOM-165) ───────────────────────────────────────────
// Each field arrives as a JSON string. It is parsed, checked, and re-serialised
// from the checked values only, so unknown keys never reach the DB. Absent
// field = leave as is; present but empty = rejected (the configurator needs it).

type ConfigField = 'sizes_json' | 'colors_json' | 'print_area_json' | 'flat_art_json'
type Checked = { value: unknown } | { error: string }

const HEX_RE = /^#[0-9A-Fa-f]{6}$/
const SIZE_RE = /^[A-Za-z0-9]{1,8}$/
// Site-relative path or R2-style key: no scheme, no "..", no leading slash.
const ART_KEY_RE = /^[A-Za-z0-9_-][A-Za-z0-9._/-]{0,199}$/

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isFrac = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1

function shortText(v: unknown, field: string): string | { error: string } {
  if (typeof v !== 'string' || !v.trim() || v.length > 60) return { error: `${field} must be 1–60 characters` }
  return v.trim()
}

function checkSizes(v: unknown): Checked {
  if (!Array.isArray(v) || v.length < 1 || v.length > 20) return { error: 'sizes must be a list of 1–20 sizes' }
  const out: string[] = []
  for (const s of v) {
    if (typeof s !== 'string' || !SIZE_RE.test(s.trim())) return { error: `invalid size "${String(s)}" (letters/digits, ≤ 8)` }
    const size = s.trim().toUpperCase()
    if (out.includes(size)) return { error: `duplicate size "${size}"` }
    out.push(size)
  }
  return { value: out }
}

function checkColors(v: unknown): Checked {
  if (!Array.isArray(v) || v.length < 1 || v.length > 30) return { error: 'colors must be a list of 1–30 colours' }
  const out: { hex: string; name_uz: string; name_ru: string; name_en: string; available: boolean }[] = []
  for (const c of v) {
    if (!isObj(c)) return { error: 'each colour must be an object' }
    if (typeof c.hex !== 'string' || !HEX_RE.test(c.hex)) return { error: `invalid hex "${String(c.hex)}" (expected #RRGGBB)` }
    const hex = c.hex.toUpperCase()
    if (out.some((o) => o.hex === hex)) return { error: `duplicate colour ${hex}` }
    const names: Record<string, string> = {}
    for (const k of ['name_uz', 'name_ru', 'name_en']) {
      const n = shortText(c[k], `${hex} ${k}`)
      if (typeof n !== 'string') return n
      names[k] = n
    }
    if (typeof c.available !== 'boolean') return { error: `${hex} available must be true or false` }
    out.push({ hex, name_uz: names.name_uz, name_ru: names.name_ru, name_en: names.name_en, available: c.available })
  }
  if (!out.some((c) => c.available)) return { error: 'at least one colour must be available' }
  return { value: out }
}

function checkPrintArea(v: unknown): Checked {
  if (!isObj(v) || !isObj(v.platen_cm)) return { error: 'print_area must be {platen_cm:{w,h}, width_frac, top_frac}' }
  const { w, h } = v.platen_cm
  const cm = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 100
  if (!cm(w) || !cm(h)) return { error: 'platen_cm w and h must be numbers in (0, 100]' }
  if (!isFrac(v.width_frac) || v.width_frac === 0) return { error: 'width_frac must be a number in (0, 1]' }
  if (!isFrac(v.top_frac)) return { error: 'top_frac must be a number in [0, 1]' }
  return { value: { platen_cm: { w, h }, width_frac: v.width_frac, top_frac: v.top_frac } }
}

function checkFlatArt(v: unknown): Checked {
  if (!isObj(v)) return { error: 'flat_art must be {front:{src,src_small}, back:{src,src_small}}' }
  const out: Record<string, { src: string; src_small: string }> = {}
  for (const face of ['front', 'back']) {
    const f = v[face]
    if (!isObj(f)) return { error: `flat_art.${face} is required` }
    for (const k of ['src', 'src_small']) {
      const key = f[k]
      if (typeof key !== 'string' || !ART_KEY_RE.test(key) || key.includes('..')) {
        return { error: `flat_art.${face}.${k} must be a relative path (letters, digits, . _ - /)` }
      }
    }
    out[face] = { src: f.src as string, src_small: f.src_small as string }
  }
  return { value: out }
}

const CONFIG_CHECKS: Record<ConfigField, (v: unknown) => Checked> = {
  sizes_json: checkSizes,
  colors_json: checkColors,
  print_area_json: checkPrintArea,
  flat_art_json: checkFlatArt,
}

type ConfigUpdates = Partial<Record<ConfigField, string>> & { description_uz?: string | null; description_en?: string | null }

/** Validated config + uz/en description fields present in the form. */
function parseProductConfig(formData: FormData): { updates: ConfigUpdates } | { field: string; error: string } {
  const updates: ConfigUpdates = {}
  for (const field of ['description_uz', 'description_en'] as const) {
    const raw = formData.get(field)
    if (raw === null) continue
    if (typeof raw !== 'string' || raw.length > 5000) return { field, error: `${field} must be text ≤ 5000 characters` }
    updates[field] = raw.trim() || null
  }
  for (const field of Object.keys(CONFIG_CHECKS) as ConfigField[]) {
    const raw = formData.get(field)
    if (raw === null) continue
    if (typeof raw !== 'string' || raw.length > 20000) return { field, error: `${field} must be a JSON string` }
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { return { field, error: `${field} must be valid JSON` } }
    const checked = CONFIG_CHECKS[field](parsed)
    if ('error' in checked) return { field, error: checked.error }
    updates[field] = JSON.stringify(checked.value)
  }
  return { updates }
}

// ─── Router ───────────────────────────────────────────────────────────────────

const router = new Hono<AdminEnv>()

// ─── GET /api/admin/products ──────────────────────────────────────────────────

router.get('/products', requireAdmin, requireCap('products.view'), async (c) => {
  const active = c.req.query('active') ?? ''
  const q = c.req.query('q') || undefined
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '50', 10)))

  const filter: AdminProductsFilter = { active, q, page, limit }
  const { products, total } = await getAdminProducts(c.env.DB, filter)
  const url = c.req.url

  return c.json({
    products: products.map((p) => withUrls(url, p as unknown as Record<string, unknown>)),
    total,
    page,
    limit,
  })
})

// ─── GET /api/admin/products/:id ─────────────────────────────────────────────

router.get('/products/:id', requireAdmin, requireCap('products.view'), async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  const product = await getProductById(c.env.DB, id)
  if (!product) return c.json({ error: 'Not found' }, 404)

  return c.json(withUrls(c.req.url, product as unknown as Record<string, unknown>))
})

// ─── POST /api/admin/products ─────────────────────────────────────────────────

router.post('/products', requireAdmin, requireCap('products.edit'), async (c) => {
  let formData: FormData
  try {
    formData = await c.req.formData()
  } catch {
    return c.json({ ok: false, error: { code: 'INVALID_CONTENT_TYPE', message: 'Expected multipart/form-data' } }, 400)
  }

  // Required text fields
  const slug = (formData.get('slug') as string | null)?.trim() ?? ''
  const name_ru = (formData.get('name_ru') as string | null)?.trim() ?? ''
  const name_en = (formData.get('name_en') as string | null)?.trim() || null
  const name_uz = (formData.get('name_uz') as string | null)?.trim() || null
  const description_ru = (formData.get('description_ru') as string | null)?.trim() || null

  if (!slug) return c.json({ ok: false, error: { code: 'REQUIRED', message: 'slug is required', field: 'slug' } }, 400)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return c.json({ ok: false, error: { code: 'INVALID', message: 'slug must be kebab-case (a-z, 0-9, hyphens)', field: 'slug' } }, 400)
  }
  if (!name_ru) return c.json({ ok: false, error: { code: 'REQUIRED', message: 'name_ru is required', field: 'name_ru' } }, 400)

  const priceRaw = formData.get('price')
  const price = parseInt(String(priceRaw ?? ''), 10)
  if (Number.isNaN(price) || price < 0) {
    return c.json({ ok: false, error: { code: 'INVALID', message: 'price must be a non-negative integer', field: 'price' } }, 400)
  }

  const display_order = parseInt(String(formData.get('display_order') ?? '0'), 10) || 0
  const active = formData.get('active') === '0' ? 0 : 1

  const product_type = ((formData.get('product_type') as string | null)?.trim() || 'custom')
  if (product_type !== 'custom' && product_type !== 'ready') {
    return c.json({ ok: false, error: { code: 'INVALID', message: "product_type must be 'custom' or 'ready'", field: 'product_type' } }, 400)
  }

  const colorsResult = parseColors(formData.get('base_colors'))
  if (colorsResult !== null && typeof colorsResult === 'object' && 'error' in colorsResult) {
    return c.json({ ok: false, error: { code: 'INVALID', message: colorsResult.error, field: 'base_colors' } }, 400)
  }
  const base_colors = colorsResult as string | null

  const config = parseProductConfig(formData)
  if ('error' in config) {
    return c.json({ ok: false, error: { code: 'INVALID', message: config.error, field: config.field } }, 400)
  }

  // GLB — required for configurator products; ready-made designs are
  // bought as-is and never open the 3D scene, so the model is optional
  const glbFile = getFileField(formData, 'glb')
  if (!glbFile && product_type !== 'ready') {
    return c.json({ ok: false, error: { code: 'REQUIRED', message: 'glb file is required', field: 'glb' } }, 400)
  }
  if (glbFile) {
    const glbError = validateGlb(glbFile)
    if (glbError) return c.json({ ok: false, error: { code: 'INVALID', message: glbError, field: 'glb' } }, 400)
  }

  try {
    // Thumbnail (optional)
    const thumbFile = getFileField(formData, 'thumbnail')
    let thumbnail_key: string | null = null
    if (thumbFile) {
      const thumbResult = validateThumbnail(thumbFile)
      if ('error' in thumbResult) {
        return c.json({ ok: false, error: { code: 'INVALID', message: thumbResult.error, field: 'thumbnail' } }, 400)
      }
      thumbnail_key = newAssetKey('thumbnails', slug, thumbResult.ext)
      await c.env.LOOM_MODELS.put(thumbnail_key, thumbFile.stream(), {
        httpMetadata: { contentType: thumbFile.type },
      })
    }

    // Upload GLB (absent only for ready-made designs — checked above)
    let glb_key: string | null = null
    if (glbFile) {
      const glbExt = glbFile.name.split('.').pop()?.toLowerCase() ?? 'glb'
      glb_key = newAssetKey('glb', slug, glbExt)
      await c.env.LOOM_MODELS.put(glb_key, glbFile.stream(), {
        httpMetadata: { contentType: glbFile.type || 'model/gltf-binary' },
      })
    }

    const id = await createProduct(c.env.DB, {
      slug, name_ru, name_en, name_uz, description_ru, price,
      glb_key, thumbnail_key, base_colors, product_type, active, display_order,
      ...config.updates,
    })

    const product = await getProductById(c.env.DB, id)
    return c.json({ ok: true, product: withUrls(c.req.url, product as unknown as Record<string, unknown>) }, 201)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[admin-products] POST /products failed:', msg)

    // Detect duplicate slug
    if (msg.includes('UNIQUE constraint failed') || msg.includes('unique')) {
      return c.json({ ok: false, error: { code: 'SLUG_EXISTS', message: `A product with slug "${slug}" already exists`, field: 'slug' } }, 409)
    }

    return c.json({ ok: false, error: { code: 'INTERNAL', message: 'Failed to create product. Check server logs.' } }, 500)
  }
})

// ─── PATCH /api/admin/products/:id ───────────────────────────────────────────

router.patch('/products/:id', requireAdmin, requireCap('products.edit'), async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  const existing = await getProductById(c.env.DB, id)
  if (!existing) return c.json({ error: 'Not found' }, 404)

  let formData: FormData
  try {
    formData = await c.req.formData()
  } catch {
    return c.json({ error: 'Expected multipart/form-data' }, 400)
  }

  const updates: Parameters<typeof updateProduct>[2] = {}

  const slug = (formData.get('slug') as string | null)?.trim()
  if (slug != null) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return c.json({ error: 'slug must be kebab-case' }, 400)
    updates.slug = slug
  }
  const effectiveSlug = updates.slug ?? existing.slug

  const name_ru = (formData.get('name_ru') as string | null)?.trim()
  if (name_ru != null) updates.name_ru = name_ru

  const name_en = formData.get('name_en') as string | null
  if (name_en !== null) updates.name_en = name_en.trim() || null

  const name_uz = formData.get('name_uz') as string | null
  if (name_uz !== null) updates.name_uz = name_uz.trim() || null

  const description_ru = formData.get('description_ru') as string | null
  if (description_ru !== null) updates.description_ru = description_ru.trim() || null

  const priceRaw = formData.get('price') as string | null
  if (priceRaw !== null) {
    const price = parseInt(priceRaw, 10)
    if (Number.isNaN(price) || price < 0) return c.json({ error: 'price must be a non-negative integer' }, 400)
    updates.price = price
  }

  const displayOrderRaw = formData.get('display_order') as string | null
  if (displayOrderRaw !== null) updates.display_order = parseInt(displayOrderRaw, 10) || 0

  const activeRaw = formData.get('active') as string | null
  if (activeRaw !== null) updates.active = activeRaw === '0' ? 0 : 1

  const typeRaw = (formData.get('product_type') as string | null)?.trim()
  if (typeRaw != null) {
    if (typeRaw !== 'custom' && typeRaw !== 'ready') return c.json({ error: "product_type must be 'custom' or 'ready'" }, 400)
    updates.product_type = typeRaw
  }

  const colorsRaw = formData.get('base_colors')
  if (colorsRaw !== null) {
    const result = parseColors(colorsRaw)
    if (result !== null && typeof result === 'object' && 'error' in result) return c.json({ error: result.error }, 400)
    updates.base_colors = result as string | null
  }

  const config = parseProductConfig(formData)
  if ('error' in config) return c.json({ error: `${config.field}: ${config.error}` }, 400)
  Object.assign(updates, config.updates)

  // New GLB
  const glbFile = getFileField(formData, 'glb')
  if (glbFile) {
    const glbError = validateGlb(glbFile)
    if (glbError) return c.json({ error: glbError }, 400)
    const glbExt = glbFile.name.split('.').pop()?.toLowerCase() ?? 'glb'
    const glb_key = newAssetKey('glb', effectiveSlug, glbExt)
    await c.env.LOOM_MODELS.put(glb_key, glbFile.stream(), {
      httpMetadata: { contentType: glbFile.type || 'model/gltf-binary' },
    })
    updates.glb_key = glb_key
  }

  // New thumbnail
  const thumbFile = getFileField(formData, 'thumbnail')
  if (thumbFile) {
    const thumbResult = validateThumbnail(thumbFile)
    if ('error' in thumbResult) return c.json({ error: thumbResult.error }, 400)
    const thumbnail_key = newAssetKey('thumbnails', effectiveSlug, thumbResult.ext)
    await c.env.LOOM_MODELS.put(thumbnail_key, thumbFile.stream(), {
      httpMetadata: { contentType: thumbFile.type },
    })
    updates.thumbnail_key = thumbnail_key
  }

  await updateProduct(c.env.DB, id, updates)

  const product = await getProductById(c.env.DB, id)
  return c.json(withUrls(c.req.url, product as unknown as Record<string, unknown>))
})

// ─── DELETE /api/admin/products/:id ──────────────────────────────────────────
// Permanently deletes a product when it is safe to do so (no orders reference
// it): the DB row and its R2 assets are removed. If orders DO reference it, the
// row is kept and archived (active = 0) instead, so order history stays intact.
// Response: { ok, mode: 'deleted' | 'archived', orders? }

router.delete('/products/:id', requireAdmin, requireCap('products.edit'), async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  const existing = await getProductById(c.env.DB, id) as unknown as
    { glb_key?: string | null; thumbnail_key?: string | null } | null
  if (!existing) return c.json({ error: 'Not found' }, 404)

  // Referential integrity: a product referenced by orders cannot be removed
  // without orphaning that order history — archive it instead.
  const orderCount = await countOrdersForProduct(c.env.DB, id)
  if (orderCount > 0) {
    await softDeleteProduct(c.env.DB, id)
    return c.json({ ok: true, mode: 'archived', orders: orderCount })
  }

  // No orders → permanently delete. Best-effort R2 cleanup first (don't fail the
  // delete if an asset is already gone), then remove the row.
  try {
    if (existing.glb_key) await c.env.LOOM_MODELS.delete(existing.glb_key)
    if (existing.thumbnail_key) await c.env.LOOM_MODELS.delete(existing.thumbnail_key)
  } catch (err) {
    console.warn('[admin-products] R2 cleanup during delete failed (non-fatal):', err)
  }
  await hardDeleteProduct(c.env.DB, id)
  return c.json({ ok: true, mode: 'deleted' })
})

export default router
