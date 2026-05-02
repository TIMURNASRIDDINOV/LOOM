import { Hono } from 'hono'
import { getActiveProducts, createOrder, getProductById, getProductBySlug, getOrdersByUserId } from '../db/queries'
import { validateUpload, generateLogoKey } from '../lib/r2'
import { verifyToken } from '../lib/jwt'
import { requireAuth } from '../middleware/requireAuth'
import { sendOrderNotification } from '../lib/telegram'
import type { BaseEnv, UserEnv } from '../types'

// TODO: add rate limiting on /api/orders and /api/uploads
// Recommended: use Cloudflare KV for per-IP counters with TTL

const pub = new Hono<BaseEnv>()

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

  // Optional: resolve user_id from Bearer token if present
  let userId: number | null = null
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const payload = await verifyToken(authHeader.slice(7), c.env.JWT_SECRET)
    if (payload?.role === 'user') userId = parseInt(payload.sub, 10)
  }

  // Optional: validate productId
  let productId: number | null = null
  if (typeof b.productId === 'number') {
    const product = await getProductById(c.env.DB, b.productId)
    if (!product) return c.json({ error: 'Product not found' }, 400)
    productId = product.id
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
    logo_key: typeof b.logoKey === 'string' ? b.logoKey : null,
    total_price: b.totalPrice as number,
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

// ─── POST /api/uploads ────────────────────────────────────────────────────────
// Direct multipart upload; Worker writes blob to R2 loom-uploads.

pub.post('/uploads', async (c) => {
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
  const fileObj = file as unknown as { name: string; type: string; size: number; stream: () => ReadableStream }

  const validation = validateUpload(fileObj.type, fileObj.size)
  if (!validation.ok) return c.json({ error: validation.error }, 400)

  const key = generateLogoKey(validation.ext)
  await c.env.LOOM_UPLOADS.put(key, fileObj.stream(), {
    httpMetadata: { contentType: fileObj.type },
  })

  return c.json({ key }, 201)
})

// ─── GET /api/me/orders  (requires Bearer token) ─────────────────────────────
// Cast to UserEnv just for this handler — requireAuth guarantees userId is set

const meRouter = new Hono<UserEnv>()

meRouter.get('/orders', requireAuth, async (c) => {
  const orders = await getOrdersByUserId(c.env.DB, c.get('userId'))
  return c.json({ orders })
})

pub.route('/me', meRouter)

export default pub
