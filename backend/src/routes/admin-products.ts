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
import { requireAdmin, requireRole } from '../middleware/requireAdmin'
import type { AdminEnv } from '../types'

// Product writes require manager or owner (staff is read-only here).
const MANAGER = requireRole('owner', 'manager')

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

// ─── Router ───────────────────────────────────────────────────────────────────

const router = new Hono<AdminEnv>()

// ─── GET /api/admin/products ──────────────────────────────────────────────────

router.get('/products', requireAdmin, async (c) => {
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

router.get('/products/:id', requireAdmin, async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  const product = await getProductById(c.env.DB, id)
  if (!product) return c.json({ error: 'Not found' }, 404)

  return c.json(withUrls(c.req.url, product as unknown as Record<string, unknown>))
})

// ─── POST /api/admin/products ─────────────────────────────────────────────────

router.post('/products', requireAdmin, MANAGER, async (c) => {
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
      thumbnail_key = `thumbnails/${slug}.${thumbResult.ext}`
      await c.env.LOOM_MODELS.put(thumbnail_key, thumbFile.stream(), {
        httpMetadata: { contentType: thumbFile.type },
      })
    }

    // Upload GLB (absent only for ready-made designs — checked above)
    let glb_key: string | null = null
    if (glbFile) {
      const glbExt = glbFile.name.split('.').pop()?.toLowerCase() ?? 'glb'
      glb_key = `glb/${slug}.${glbExt}`
      await c.env.LOOM_MODELS.put(glb_key, glbFile.stream(), {
        httpMetadata: { contentType: glbFile.type || 'model/gltf-binary' },
      })
    }

    const id = await createProduct(c.env.DB, {
      slug, name_ru, name_en, description_ru, price,
      glb_key, thumbnail_key, base_colors, product_type, active, display_order,
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

router.patch('/products/:id', requireAdmin, MANAGER, async (c) => {
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

  // New GLB
  const glbFile = getFileField(formData, 'glb')
  if (glbFile) {
    const glbError = validateGlb(glbFile)
    if (glbError) return c.json({ error: glbError }, 400)
    const glbExt = glbFile.name.split('.').pop()?.toLowerCase() ?? 'glb'
    const glb_key = `glb/${effectiveSlug}.${glbExt}`
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
    const thumbnail_key = `thumbnails/${effectiveSlug}.${thumbResult.ext}`
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

router.delete('/products/:id', requireAdmin, MANAGER, async (c) => {
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
