import { Hono, type Context } from 'hono'
import {
  getActiveProducts, getProductBySlug, getOrdersByUserId,
  getOrderById, getOrderItemsByOrderId, getOrderStatusLog,
  getUserNotifications, recordUpload, isOwnUpload,
} from '../db/queries'
import { validateUpload, generateLogoKey, serveObject, AVATAR_TYPES } from '../lib/r2'
import { requireAuth } from '../middleware/requireAuth'
import { clientIp, isRateLimited } from '../lib/rateLimit'
import { p2pCard, type PaymentEnvVars } from '../lib/payments'
import { expireOverdue, notifyStaffReceipt, TIMED_OUT_SQL, TIMEOUT_NOTE } from '../lib/prepay'
import type { Order } from '../db/schema'
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
 *     flat_art: {front: {src, src_small, print?: {x, y, w}}, back: {same}} }
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

// ─── POST /api/uploads  (signed-in users) ────────────────────────────────────
// Direct multipart upload; Worker writes blob to R2 loom-uploads and records
// the uploader, so later routes can check a submitted key belongs to them.

const uploads = new Hono<UserEnv>()

// An order uploads up to 7 assets (2 prints + 2 mockups + 2 logos + model), so allow 30/min.
// A model key reservation counts as an upload.
const uploadsLimited = async (c: Context<UserEnv>, userId: number) =>
  (await isRateLimited(c.env.RATE_LIMIT, `uploads:${clientIp(c)}`, 30, 60)) ||
  (await isRateLimited(c.env.RATE_LIMIT, `uploads:user:${userId}`, 30, 60))
const TOO_MANY_UPLOADS = 'Too many uploads. Please wait a minute before trying again.'

uploads.post('/', requireAuth, async (c) => {
  const userId = c.get('userId')
  if (await uploadsLimited(c, userId)) return c.json({ error: TOO_MANY_UPLOADS }, 429)

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

// ─── POST /api/uploads/model  (signed-in users) ──────────────────────────────
// Reserves the key of the 3D review model (LOOM-206). The bag item and the
// order carry the key at once; the ~6 MB .glb follows with PUT in the
// background, so add-to-cart never waits on a slow uplink.

uploads.post('/model', requireAuth, async (c) => {
  const userId = c.get('userId')
  if (await uploadsLimited(c, userId)) return c.json({ error: TOO_MANY_UPLOADS }, 429)
  const key = generateLogoKey('glb')
  await recordUpload(c.env.DB, key, userId)
  return c.json({ key }, 201)
})

// ─── PUT /api/uploads/:key  (the uploader only) ──────────────────────────────
// Fills a reserved model key with its .glb bytes, once. A stored object is
// never replaced.

uploads.put('/:key{.+}', requireAuth, async (c) => {
  const key = c.req.param('key')
  if (!key.endsWith('.glb') || !(await isOwnUpload(c.env.DB, key, c.get('userId')))) {
    return c.json({ error: 'Not found' }, 404)
  }
  if (await c.env.LOOM_UPLOADS.head(key)) return c.json({ error: 'Already uploaded' }, 409)
  const bytes = new Uint8Array(await c.req.arrayBuffer())
  const validation = validateUpload(bytes, new Set(['model/gltf-binary']))
  if (!validation.ok) return c.json({ error: validation.error }, 400)
  await c.env.LOOM_UPLOADS.put(key, bytes, { httpMetadata: { contentType: validation.type.mime } })
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

/** An order as its owner may see it: no storage key, no staff id. */
function customerOrder(order: Order) {
  const { receipt_key, pay_checked_by, ...rest } = order
  return { ...rest, receipt: !!receipt_key }
}

/** The caller's own order, or null. Never tells a missing id from someone else's. */
async function ownOrder(c: Context<UserEnv>): Promise<Order | null> {
  const order = await getOrderById(c.env.DB, parseInt(c.req.param('id') ?? '', 10))
  return order && order.user_id === c.get('userId') ? order : null
}

const payActionsLimited = (c: Context<UserEnv>) =>
  isRateLimited(c.env.RATE_LIMIT, `pay:user:${c.get('userId')}`, 20, 10 * 60)

meRouter.get('/orders', requireAuth, async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1)
  const limit = 20
  await expireOverdue(c.env, { userId: c.get('userId') })
  const { orders, total } = await getOrdersByUserId(c.env.DB, c.get('userId'), page, limit)
  return c.json({ orders: orders.map(customerOrder), page, limit, total })
})

// One order of the caller: the row, its line items and its status history.
// Someone else's order and a missing order both answer 404, so an id never
// reveals whether another customer's order exists.
//
// For a card-transfer order this is also the payment screen's data:
//   order.total_price    what to transfer (items + order.delivery_fee)
//   order.pay_deadline   ms; compare with `now` (server clock), not the device's
//   order.payment_status unpaid | pending (receipt sent) | paid | failed (rejected)
//   order.receipt        a receipt is stored
//   can_revive           cancelled by the timeout: a receipt brings it back
//   card                 {number, holder} only while the owner still has to pay
meRouter.get('/orders/:id{[0-9]+}', requireAuth, async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  await expireOverdue(c.env, { orderId: id, userId: c.get('userId') })
  const order = await ownOrder(c)
  if (!order) return c.json({ error: 'Not found' }, 404)
  const [items, log] = await Promise.all([getOrderItemsByOrderId(c.env.DB, id), getOrderStatusLog(c.env.DB, id)])
  // The log's `changed_by` is an admin id and stays on the server; `note` is the
  // text the customer already got in Telegram with the status change.
  const status_log = log.map(({ old_status, new_status, changed_at, note }) => ({ old_status, new_status, changed_at, note }))
  const canRevive = order.status === 'cancelled' && log[log.length - 1]?.note === TIMEOUT_NOTE
  const owes = order.payment_method === 'p2p' && (order.payment_status === 'unpaid' || order.payment_status === 'failed') &&
    (order.status === 'new' || canRevive)
  return c.json({
    order: customerOrder(order), items, status_log, now: Date.now(), can_revive: canRevive,
    card: owes ? p2pCard(c.env as unknown as PaymentEnvVars) : null,
  })
})

// ─── POST /api/me/orders/:id/receipt  (the owner, multipart `file`) ──────────
// The transfer screenshot. Stored under a random private key that only the
// admin media route serves. Replaces an earlier receipt while staff have not
// taken it yet; refused once the payment is being checked or is confirmed.
const RECEIPT_MAX_BYTES = 10 * 1024 * 1024
const PAYABLE_SQL = `payment_method = 'p2p' AND payment_status IN ('unpaid','failed')
  AND (status = 'new' OR ${TIMED_OUT_SQL})`

meRouter.post('/orders/:id{[0-9]+}/receipt', requireAuth, async (c) => {
  if (await payActionsLimited(c)) return c.json({ error: 'Too many attempts. Please wait a few minutes.', code: 'rate_limited' }, 429)
  const order = await ownOrder(c)
  if (!order) return c.json({ error: 'Not found' }, 404)

  // Refuse an oversized body before it is read into memory.
  if (Number(c.req.header('Content-Length') ?? 0) > RECEIPT_MAX_BYTES + 64 * 1024) {
    return c.json({ error: 'File must be ≤ 10 MB', code: 'receipt_too_large' }, 400)
  }
  let formData: FormData
  try { formData = await c.req.formData() } catch { return c.json({ error: 'Expected multipart/form-data' }, 400) }
  const file = formData.get('file') as unknown as { size?: number; arrayBuffer?: () => Promise<ArrayBuffer> } | null
  if (!file || typeof file.arrayBuffer !== 'function') return c.json({ error: 'file field is required' }, 400)
  if ((file.size ?? 0) > RECEIPT_MAX_BYTES) return c.json({ error: 'File must be ≤ 10 MB', code: 'receipt_too_large' }, 400)
  // Type is decided by the file's content, not the declared MIME type or name.
  const bytes = new Uint8Array(await file.arrayBuffer())
  const check = validateUpload(bytes, AVATAR_TYPES, RECEIPT_MAX_BYTES)
  if (!check.ok) return c.json({ error: 'Receipt must be a PNG, JPG or WebP image up to 10 MB', code: 'receipt_invalid' }, 400)

  const key = `receipts/${order.id}/${crypto.randomUUID()}.${check.type.ext}`
  await c.env.LOOM_UPLOADS.put(key, bytes, { httpMetadata: { contentType: check.type.mime } })
  const now = Date.now()
  const r = await c.env.DB.prepare(
    `UPDATE orders SET receipt_key = ?, receipt_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND ${PAYABLE_SQL}`,
  ).bind(key, now, now, order.id, c.get('userId')).run()
  if (!r.meta.changes) {
    await c.env.LOOM_UPLOADS.delete(key)
    return c.json({ error: 'This order is not waiting for a payment', code: 'order_not_payable' }, 409)
  }
  if (order.receipt_key) await c.env.LOOM_UPLOADS.delete(order.receipt_key)
  return c.json({ ok: true, receipt: true, receipt_at: now }, 201)
})

// ─── POST /api/me/orders/:id/paid  (the owner) ───────────────────────────────
// "I have paid": hands the order to staff. Needs a stored receipt. A repeat, or
// a call after staff already confirmed, changes nothing and answers 200. On an
// order the timeout cancelled this also brings it back to 'new'; the money may
// already be on the card, so a late receipt is never refused for being late.
meRouter.post('/orders/:id{[0-9]+}/paid', requireAuth, async (c) => {
  if (await payActionsLimited(c)) return c.json({ error: 'Too many attempts. Please wait a few minutes.', code: 'rate_limited' }, 429)
  const order = await ownOrder(c)
  if (!order) return c.json({ error: 'Not found' }, 404)
  const answer = (o: Order) => c.json({ ok: true, status: o.status, payment_status: o.payment_status })
  if (order.payment_method === 'p2p' && (order.payment_status === 'pending' || order.payment_status === 'paid')) return answer(order)
  if (order.payment_method === 'p2p' && !order.receipt_key) {
    return c.json({ error: 'Upload the payment receipt first', code: 'receipt_required' }, 409)
  }

  const now = Date.now()
  const [update] = await c.env.DB.batch([
    // The log row is written first and only for a revival, while the row still
    // reads 'cancelled'; both statements commit together.
    c.env.DB.prepare(
      `INSERT INTO order_status_log (order_id, old_status, new_status, changed_by, changed_at, note)
       SELECT id, 'cancelled', 'new', NULL, ?, 'payment_revived' FROM orders
       WHERE id = ? AND user_id = ? AND receipt_key IS NOT NULL AND payment_method = 'p2p'
         AND payment_status IN ('unpaid','failed') AND ${TIMED_OUT_SQL}`,
    ).bind(now, order.id, c.get('userId')),
    c.env.DB.prepare(
      `UPDATE orders SET payment_status = 'pending', status = 'new', updated_at = ?
       WHERE id = ? AND user_id = ? AND receipt_key IS NOT NULL AND payment_method = 'p2p'
         AND payment_status IN ('unpaid','failed')
         AND (status = 'new' OR (status = 'cancelled' AND
           (SELECT note FROM order_status_log WHERE order_id = orders.id ORDER BY id DESC LIMIT 1) = 'payment_revived'))`,
    ).bind(now, order.id, c.get('userId')),
  ]).then((results) => [results[1]])
  const fresh = (await getOrderById(c.env.DB, order.id))!
  if (!update.meta.changes) {
    // Lost a race with the same request, or the order is not payable at all.
    if (fresh.payment_method === 'p2p' && (fresh.payment_status === 'pending' || fresh.payment_status === 'paid')) return answer(fresh)
    return c.json({ error: 'This order is not waiting for a payment', code: 'order_not_payable' }, 409)
  }
  c.executionCtx.waitUntil(notifyStaffReceipt(c.env, fresh))
  return answer(fresh)
})

meRouter.get('/notifications', requireAuth, async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10))
  const limit = 25
  const { items, total } = await getUserNotifications(c.env.DB, c.get('userId'), page, limit)
  return c.json({ items, page, limit, total })
})

pub.route('/me', meRouter)

export default pub
