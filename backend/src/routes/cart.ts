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
} from '../db/queries'
import { sendOrderNotification } from '../lib/telegram'
import type { UserEnv } from '../types'

// Account-bound cart + multi-item checkout. All routes require a logged-in user.
const router = new Hono<UserEnv>()
router.use('*', requireAuth)

function cartTotal(items: { unit_price: number; quantity: number }[]): number {
  return items.reduce((s, i) => s + i.unit_price * i.quantity, 0)
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

  await addCartItem(c.env.DB, {
    user_id: c.get('userId'),
    product_id: productId,
    design_json: b.designJson,
    logo_key: typeof b.logoKey === 'string' ? b.logoKey : null,
    unit_price: b.unitPrice,
    quantity,
    // Proofs are captured while the design is live (here); copied to order_items at checkout.
    front_print_key: typeof b.frontPrintKey === 'string' ? b.frontPrintKey : null,
    back_print_key: typeof b.backPrintKey === 'string' ? b.backPrintKey : null,
    front_mockup_key: typeof b.frontMockupKey === 'string' ? b.frontMockupKey : null,
    back_mockup_key: typeof b.backMockupKey === 'string' ? b.backMockupKey : null,
    back_logo_key: typeof b.backLogoKey === 'string' ? b.backLogoKey : null,
    model_key: typeof b.modelKey === 'string' ? b.modelKey : null,
  })

  const items = await getCartItems(c.env.DB, c.get('userId'))
  return c.json({ items, total: cartTotal(items) }, 201)
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
  const coordinates = typeof b.coordinates === 'string' ? b.coordinates.trim() : null
  const comment = typeof b.comment === 'string' ? b.comment.trim() : null

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
  })

  // Line items
  for (const it of items) {
    const p = it.product_id ? await getProductById(c.env.DB, it.product_id) : null
    await createOrderItem(c.env.DB, {
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

  return c.json({ id: orderId, status: 'new', itemCount: items.length }, 201)
})

export default router
