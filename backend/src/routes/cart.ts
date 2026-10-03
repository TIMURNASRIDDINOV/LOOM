import { Hono } from 'hono'
import { requireAuth } from '../middleware/requireAuth'
import {
  getCartItems,
  getCartItemById,
  addCartItem,
  updateCartItemQty,
  deleteCartItem,
  clearCart,
  getProductById,
  getUserById,
  createOrder,
  createOrderItem,
  getArtworkById,
  recordArtworkSale,
  firstForeignKey,
} from '../db/queries'
import { serveObject } from '../lib/r2'
import { isRateLimited, TOO_MANY } from '../lib/rateLimit'
import { sendOrderNotification } from '../lib/telegram'
import { isValidMethod, providerConfigured, createPaymentUrl, type PaymentEnvVars } from '../lib/payments'
import { DESIGNER_COMMISSION_PCT } from './designers'
import type { UserEnv } from '../types'

// Account-bound cart + multi-item checkout. All routes require a logged-in user.
const router = new Hono<UserEnv>()
router.use('*', requireAuth)

function cartTotal(items: { unit_price: number; quantity: number }[]): number {
  return items.reduce((s, i) => s + i.unit_price * i.quantity, 0)
}

/** Distinct marketplace artwork ids referenced by a design_json v2 document. */
function artworkIdsIn(designJson: string): number[] {
  let d: Record<string, unknown>
  try {
    d = JSON.parse(designJson) as Record<string, unknown>
  } catch {
    return []
  }
  const ids = new Set<number>()
  for (const view of ['front', 'back']) {
    const v = d[view] as { elements?: { artworkId?: unknown }[] } | undefined
    for (const el of v?.elements ?? []) {
      const id = typeof el.artworkId === 'number' ? el.artworkId : parseInt(String(el.artworkId ?? ''), 10)
      if (Number.isInteger(id) && id > 0) ids.add(id)
    }
  }
  return [...ids]
}

// GET /api/cart — current user's cart
router.get('/', async (c) => {
  const items = await getCartItems(c.env.DB, c.get('userId'))
  return c.json({ items, total: cartTotal(items) })
})

// POST /api/cart — add a design to the cart
router.post('/', async (c) => {
  let b: Record<string, unknown>
  try { b = (await c.req.json()) as Record<string, unknown> } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  if (typeof b.designJson !== 'string' || !b.designJson.trim()) {
    return c.json({ error: 'designJson is required' }, 400)
  }
  if (typeof b.unitPrice !== 'number' || b.unitPrice < 0) {
    return c.json({ error: 'unitPrice must be a non-negative number' }, 400)
  }

  let productId: number | null = null
  if (typeof b.productId === 'number') {
    const p = await getProductById(c.env.DB, b.productId)
    if (p) productId = p.id
  }
  const quantity = Math.max(1, Math.min(99, parseInt(String(b.quantity ?? 1), 10) || 1))

  // Proofs are captured while the design is live (here); copied to order_items at checkout.
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
  // Only files this user uploaded, or approved marketplace artwork.
  if (await firstForeignKey(c.env.DB, c.get('userId'), Object.values(keys))) {
    return c.json({ error: 'Unknown file reference', code: 'invalid_file_key' }, 400)
  }

  await addCartItem(c.env.DB, {
    user_id: c.get('userId'),
    product_id: productId,
    design_json: b.designJson,
    unit_price: b.unitPrice,
    quantity,
    ...keys,
  })

  const items = await getCartItems(c.env.DB, c.get('userId'))
  return c.json({ items, total: cartTotal(items) }, 201)
})

// GET /api/cart/:id — one item (edit-from-cart rehydration)
router.get('/:id{[0-9]+}', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  const item = await getCartItemById(c.env.DB, id)
  if (!item || item.user_id !== c.get('userId')) return c.json({ error: 'Not found' }, 404)
  return c.json(item)
})

// GET /api/cart/:id/file/:field — stream the caller's OWN cart-item asset
// (mockup thumbnails in the bag, logo pixels for edit-from-cart rehydration).
// Ownership-checked: the key is read from the caller's row, never from the URL.
const CART_FILE_FIELDS: Record<string, 'front_mockup_key' | 'back_mockup_key' | 'logo_key' | 'back_logo_key'> = {
  'front-mockup': 'front_mockup_key',
  'back-mockup': 'back_mockup_key',
  'logo': 'logo_key',
  'back-logo': 'back_logo_key',
}
router.get('/:id{[0-9]+}/file/:field', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  const field = CART_FILE_FIELDS[c.req.param('field')]
  if (!field) return c.json({ error: 'Unknown field' }, 400)
  const item = await getCartItemById(c.env.DB, id)
  if (!item || item.user_id !== c.get('userId')) return c.json({ error: 'Not found' }, 404)
  const key = item[field]
  if (!key) return c.json({ error: 'No file' }, 404)
  const object = await c.env.LOOM_UPLOADS.get(key)
  if (!object) return c.json({ error: 'Not found' }, 404)
  return serveObject(object, key, 'private, max-age=3600')
})

// PATCH /api/cart/:id — change quantity
router.patch('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)
  const item = await getCartItemById(c.env.DB, id)
  if (!item || item.user_id !== c.get('userId')) return c.json({ error: 'Not found' }, 404)

  let b: Record<string, unknown>
  try { b = (await c.req.json()) as Record<string, unknown> } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  const quantity = Math.max(1, Math.min(99, parseInt(String(b.quantity ?? 1), 10) || 1))
  await updateCartItemQty(c.env.DB, id, quantity)

  const items = await getCartItems(c.env.DB, c.get('userId'))
  return c.json({ items, total: cartTotal(items) })
})

// DELETE /api/cart/:id — remove one item
router.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)
  const item = await getCartItemById(c.env.DB, id)
  if (!item || item.user_id !== c.get('userId')) return c.json({ error: 'Not found' }, 404)
  await deleteCartItem(c.env.DB, id)
  const items = await getCartItems(c.env.DB, c.get('userId'))
  return c.json({ items, total: cartTotal(items) })
})

// DELETE /api/cart — clear the whole cart
router.delete('/', async (c) => {
  await clearCart(c.env.DB, c.get('userId'))
  return c.json({ items: [], total: 0 })
})

// POST /api/cart/checkout — turn the cart into ONE multi-item order
router.post('/checkout', async (c) => {
  if (await isRateLimited(c.env.RATE_LIMIT, `checkout:user:${c.get('userId')}`, 10, 10 * 60)) {
    return c.json(TOO_MANY, 429)
  }
  let b: Record<string, unknown>
  try { b = (await c.req.json()) as Record<string, unknown> } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  if (typeof b.customerName !== 'string' || !b.customerName.trim()) {
    return c.json({ error: 'customerName is required' }, 400)
  }
  if (typeof b.customerPhone !== 'string' || !b.customerPhone.trim()) {
    return c.json({ error: 'customerPhone is required' }, 400)
  }

  const userId = c.get('userId')
  const user = await getUserById(c.env.DB, userId)
  if (user?.status === 'banned') return c.json({ error: 'Your account has been blocked' }, 403)
  // Require a Telegram-verified phone number before an order can be placed.
  if (!user?.telegram_user_id) {
    return c.json({ error: 'Подтвердите номер телефона через Telegram, чтобы оформить заказ.', code: 'phone_not_verified' }, 403)
  }

  const items = await getCartItems(c.env.DB, userId)
  if (!items.length) return c.json({ error: 'Cart is empty' }, 400)

  const total = cartTotal(items)
  const customerName = (b.customerName as string).trim()
  const customerPhone = (b.customerPhone as string).trim()
  const address = typeof b.address === 'string' ? b.address.trim() : null
  const comment = typeof b.comment === 'string' ? b.comment.trim() : null

  // Structured coordinates (migration 0011). `coordinates` stays mirrored for
  // backward compat with older admin builds.
  const lat = typeof b.addressLat === 'number' && isFinite(b.addressLat) ? b.addressLat : null
  const lng = typeof b.addressLng === 'number' && isFinite(b.addressLng) ? b.addressLng : null
  const coordinates =
    lat != null && lng != null
      ? `${lat.toFixed(6)}, ${lng.toFixed(6)}`
      : typeof b.coordinates === 'string' ? b.coordinates.trim() : null
  // {entrance, apartment, floor, intercom, note} — free-form, size-capped
  let addressDetails: string | null = null
  if (b.addressDetails && typeof b.addressDetails === 'object') {
    const s = JSON.stringify(b.addressDetails)
    if (s.length <= 1000) addressDetails = s
  }

  // Payment method — order is created first; online providers redirect after.
  const paymentMethod = isValidMethod(b.paymentMethod) ? b.paymentMethod : 'cod'
  const payEnv = c.env as unknown as PaymentEnvVars
  if (paymentMethod !== 'cod' && !providerConfigured(paymentMethod, payEnv)) {
    return c.json(
      { error: 'Этот способ оплаты пока недоступен. Выберите оплату при получении.', code: 'payment_method_unavailable' },
      400,
    )
  }

  // Order header — design_json carries a multi-item summary (NOT NULL column).
  const orderId = await createOrder(c.env.DB, {
    user_id: userId,
    product_id: items[0].product_id ?? null,
    customer_name: customerName,
    customer_phone: customerPhone,
    address,
    coordinates,
    comment,
    design_json: JSON.stringify({ multi: true, itemCount: items.length }),
    logo_key: items[0].logo_key ?? null,
    total_price: total,
    payment_method: paymentMethod,
    address_lat: lat,
    address_lng: lng,
    address_details: addressDetails,
  })

  // Line items
  for (const it of items) {
    const p = it.product_id ? await getProductById(c.env.DB, it.product_id) : null
    const itemId = await createOrderItem(c.env.DB, {
      order_id: orderId,
      product_id: it.product_id,
      product_name: p?.name_ru ?? null,
      design_json: it.design_json,
      logo_key: it.logo_key,
      unit_price: it.unit_price,
      quantity: it.quantity,
      front_print_key: it.front_print_key,
      back_print_key: it.back_print_key,
      front_mockup_key: it.front_mockup_key,
      back_mockup_key: it.back_mockup_key,
      back_logo_key: it.back_logo_key,
      model_key: it.model_key,
    })

    // Designer attribution (migration 0018): every marketplace artwork on this
    // item earns its designer a share. The markup is re-read from the artwork
    // row rather than trusted from the client.
    for (const artworkId of artworkIdsIn(it.design_json)) {
      const art = await getArtworkById(c.env.DB, artworkId)
      if (!art || art.status !== 'approved') continue
      await recordArtworkSale(c.env.DB, {
        order_id: orderId,
        order_item_id: itemId,
        artwork_id: art.id,
        designer_user_id: art.user_id,
        quantity: it.quantity,
        markup: art.markup,
        commission_pct: DESIGNER_COMMISSION_PCT,
      })
    }
  }

  await clearCart(c.env.DB, userId)

  // Telegram notification (non-blocking)
  if (c.env.TELEGRAM_BOT_TOKEN && c.env.TELEGRAM_CHAT_ID) {
    const totalQty = items.reduce((s, i) => s + i.quantity, 0)
    c.executionCtx.waitUntil(
      sendOrderNotification(c.env.TELEGRAM_BOT_TOKEN, c.env.TELEGRAM_CHAT_ID, {
        id: orderId,
        customerName,
        customerPhone,
        address,
        coordinates,
        comment,
        totalPrice: total,
        designJson: `Корзина: ${items.length} позиц., ${totalQty} шт.`,
        productName: `Заказ из корзины (${items.length})`,
      }),
    )
  }

  // Online methods: hand back the provider redirect; COD ships with none.
  const paymentUrl = createPaymentUrl(paymentMethod, { id: orderId, totalPrice: total }, payEnv)

  return c.json(
    { id: orderId, status: 'new', itemCount: items.length, paymentMethod, paymentUrl },
    201,
  )
})

export default router
