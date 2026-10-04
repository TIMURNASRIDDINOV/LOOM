import { Hono } from 'hono'
import {
  getActiveProducts, createOrder, getProductById, getProductBySlug, getOrdersByUserId,
  getUserNotifications, recordUpload, isOwnUpload, firstForeignKey,
} from '../db/queries'
import { validateUpload, generateLogoKey, serveObject } from '../lib/r2'
import { requireAuth, authenticateUser, userTokenFrom } from '../middleware/requireAuth'
import { clientIp, isRateLimited } from '../lib/rateLimit'
import { sendOrderNotification } from '../lib/telegram'
import type { BaseEnv, UserEnv } from '../types'

const pub = new Hono<BaseEnv>()

function buildFileUrl(requestUrl: string, key: string): string {
  const { protocol, host } = new URL(requestUrl)
  return `${protocol}//${host}/api/files/models/${key}`
}

/**
 * Configurator config (LOOM-165, migration 0022) as one parsed object:
 *   { sizes: string[],
 *     colors: {hex, name_uz, name_ru, name_en, available}[],
 *     print_area: {platen_cm: {w, h}, width_frac, top_frac},
 *     flat_art: {front: {src, src_small}, back: {src, src_small}} }
 * null when the row has no config (DB before 0022) or a column is not valid
 * JSON; clients then keep their built-in defaults.
 */
function productConfig(p: Record<string, unknown>) {
  try {
    const [sizes, colors, print_area, flat_art] =
      ['sizes_json', 'colors_json', 'print_area_json', 'flat_art_json'].map((k) => JSON.parse(p[k] as string))
    return sizes && colors && print_area && flat_art ? { sizes, colors, print_area, flat_art } : null
  } catch {
    return null
  }
}

function withUrls(requestUrl: string, p: Record<string, unknown>) {
  // The raw *_json columns are served only as the parsed `config`.
  const { sizes_json, colors_json, print_area_json, flat_art_json, ...rest } = p
  return {
    ...rest,
    glb_url: p.glb_key ? buildFileUrl(requestUrl, p.glb_key as string) : null,
    thumbnail_url: p.thumbnail_key ? buildFileUrl(requestUrl, p.thumbnail_key as string) : null,
    config: productConfig(p),
  }
}

// ─── GET /api/products ────────────────────────────────────────────────────────

pub.get('/products', async (c) => {
  const products = await getActiveProducts(c.env.DB)
  const url = c.req.url
  return c.json({ products: products.map((p) => withUrls(url, p as unknown as Record<string, unknown>)) })
})

// ─── GET /api/products/:slug ──────────────────────────────────────────────────

pub.get('/products/:slug', async (c) => {
  const slug = c.req.param('slug')
  const product = await getProductBySlug(c.env.DB, slug)
  if (!product || !product.active) return c.json({ error: 'Not found' }, 404)
  return c.json(withUrls(c.req.url, product as unknown as Record<string, unknown>))
})

// ─── POST /api/orders ─────────────────────────────────────────────────────────

pub.post('/orders', async (c) => {
  if (await isRateLimited(c.env.RATE_LIMIT, `orders:${clientIp(c)}`, 5, 60)) {
    return c.json({ error: 'Too many requests. Please wait a minute before placing another order.' }, 429)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const b = body as Record<string, unknown>

  // Required fields
  if (typeof b.customerName !== 'string' || !b.customerName.trim()) {
    return c.json({ error: 'customerName is required' }, 400)
  }
  if (typeof b.customerPhone !== 'string' || !b.customerPhone.trim()) {
    return c.json({ error: 'customerPhone is required' }, 400)
  }
  if (typeof b.designJson !== 'string' || !b.designJson.trim()) {
    return c.json({ error: 'designJson is required' }, 400)
  }
  if (typeof b.totalPrice !== 'number' || b.totalPrice < 0) {
    return c.json({ error: 'totalPrice must be a non-negative number' }, 400)
  }

  // Required auth (same checks as requireAuth: deleted, banned, revoked).
  const auth = await authenticateUser(c.env, userTokenFrom(c))
  if (!auth.ok) return c.json(auth.body, auth.status)
  const userRecord = auth.user
  const userId = userRecord.id
  // Require a Telegram-verified phone number before an order can be placed.
  if (!userRecord.telegram_user_id) {
    return c.json({ error: 'Подтвердите номер телефона через Telegram, чтобы оформить заказ.', code: 'phone_not_verified' }, 403)
  }

  // Optional: validate productId
  let productId: number | null = null
  if (typeof b.productId === 'number') {
    const product = await getProductById(c.env.DB, b.productId)
    if (!product) return c.json({ error: 'Product not found' }, 400)
    productId = product.id
  }

  const keyField = (v: unknown) => (typeof v === 'string' ? v : null)
  const keys = {
    logo_key: keyField(b.logoKey),
    front_print_key: keyField(b.frontPrintKey),
    back_print_key: keyField(b.backPrintKey),
    front_mockup_key: keyField(b.frontMockupKey),
    back_mockup_key: keyField(b.backMockupKey),
    back_logo_key: keyField(b.backLogoKey),
    model_key: keyField(b.modelKey),
  }
  if (await firstForeignKey(c.env.DB, userId, Object.values(keys))) {
    return c.json({ error: 'Unknown file reference', code: 'invalid_file_key' }, 400)
  }

  const orderId = await createOrder(c.env.DB, {
    user_id: userId,
    product_id: productId,
    customer_name: (b.customerName as string).trim(),
    customer_phone: (b.customerPhone as string).trim(),
    address: typeof b.address === 'string' ? b.address.trim() : null,
    coordinates: typeof b.coordinates === 'string' ? b.coordinates.trim() : null,
    comment: typeof b.comment === 'string' ? b.comment.trim() : null,
    design_json: b.designJson as string,
    total_price: b.totalPrice as number,
    ...keys,
  })

  // Send Telegram notification without blocking the response
  if (c.env.TELEGRAM_BOT_TOKEN && c.env.TELEGRAM_CHAT_ID) {
    const product = productId ? await getProductById(c.env.DB, productId) : null
    c.executionCtx.waitUntil(
      sendOrderNotification(c.env.TELEGRAM_BOT_TOKEN, c.env.TELEGRAM_CHAT_ID, {
        id: orderId,
        customerName: (b.customerName as string).trim(),
        customerPhone: (b.customerPhone as string).trim(),
        address: typeof b.address === 'string' ? b.address : null,
        coordinates: typeof b.coordinates === 'string' ? b.coordinates : null,
        comment: typeof b.comment === 'string' ? b.comment : null,
        totalPrice: b.totalPrice as number,
        designJson: b.designJson as string,
        productName: product?.name_ru ?? null,
      }),
    )
  }

  return c.json({ id: orderId, status: 'new' }, 201)
})

// ─── POST /api/uploads  (signed-in users) ────────────────────────────────────
// Direct multipart upload; Worker writes blob to R2 loom-uploads and records
// the uploader, so later routes can check a submitted key belongs to them.

const uploads = new Hono<UserEnv>()

uploads.post('/', requireAuth, async (c) => {
  const userId = c.get('userId')
  // An order uploads up to 7 assets (2 prints + 2 mockups + 2 logos + model), so allow 30/min.
  if (
    (await isRateLimited(c.env.RATE_LIMIT, `uploads:${clientIp(c)}`, 30, 60)) ||
    (await isRateLimited(c.env.RATE_LIMIT, `uploads:user:${userId}`, 30, 60))
  ) {
    return c.json({ error: 'Too many uploads. Please wait a minute before trying again.' }, 429)
  }

  let formData: FormData
  try {
    formData = await c.req.formData()
  } catch {
    return c.json({ error: 'Expected multipart/form-data' }, 400)
  }

  const file = formData.get('file')
  // File is available as a global in Cloudflare Workers runtime
  if (!file || typeof (file as { name?: unknown }).name !== 'string') {
    return c.json({ error: 'file field is required' }, 400)
  }
  const fileObj = file as unknown as { size: number; arrayBuffer: () => Promise<ArrayBuffer> }
  if (fileObj.size > 15 * 1024 * 1024) return c.json({ error: 'File must be ≤ 15 MB' }, 400)

  // Type is decided by the file's content, not the declared MIME type or name.
  const bytes = new Uint8Array(await fileObj.arrayBuffer())
  const validation = validateUpload(bytes)
  if (!validation.ok) return c.json({ error: validation.error }, 400)

  const key = generateLogoKey(validation.type.ext)
  await c.env.LOOM_UPLOADS.put(key, bytes, {
    httpMetadata: { contentType: validation.type.mime },
  })
  await recordUpload(c.env.DB, key, userId)

  return c.json({ key }, 201)
})

// ─── GET /api/uploads/:key  (the uploader only) ──────────────────────────────
// Lets the configurator re-load a logo the user uploaded earlier.

uploads.get('/:key{.+}', requireAuth, async (c) => {
  const key = c.req.param('key')
  if (!(await isOwnUpload(c.env.DB, key, c.get('userId')))) return c.json({ error: 'Not found' }, 404)
  const object = await c.env.LOOM_UPLOADS.get(key)
  if (!object) return c.json({ error: 'Not found' }, 404)
  return serveObject(object, key, 'private, max-age=3600')
})

pub.route('/uploads', uploads)

// ─── GET /api/me/orders  (requires Bearer token) ─────────────────────────────
// Cast to UserEnv just for this handler — requireAuth guarantees userId is set

const meRouter = new Hono<UserEnv>()

meRouter.get('/orders', requireAuth, async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10))
  const limit = 20
  const { orders, total } = await getOrdersByUserId(c.env.DB, c.get('userId'), page, limit)
  return c.json({ orders, page, limit, total })
})

meRouter.get('/notifications', requireAuth, async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10))
  const limit = 25
  const { items, total } = await getUserNotifications(c.env.DB, c.get('userId'), page, limit)
  return c.json({ items, page, limit, total })
})

pub.route('/me', meRouter)

export default pub
