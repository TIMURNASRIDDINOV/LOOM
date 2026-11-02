import { getOrderItemsByOrderId, type CartItem } from '../db/queries'
import { artworkIdsIn } from './pricing'

export type CheckoutOrder = {
  id: number; user_id: number; status: string; total_price: number
  payment_method: string; session_id: string | null
}

export function findCheckout(db: D1Database, userId: number, key: string) {
  return db.prepare('SELECT * FROM orders WHERE user_id = ? AND idempotency_key = ?')
    .bind(userId, key).first<CheckoutOrder>()
}

export async function checkoutItems(db: D1Database, id: number) {
  return getOrderItemsByOrderId(db, id)
}

type CheckoutInput = {
  userId: number; key: string; sessionId: string | null; platform?: 'web' | 'app'; items: CartItem[]; total: number
  customerName: string; customerPhone: string; address: string | null
  coordinates: string | null; comment: string | null; paymentMethod: string
  lat: number | null; lng: number | null; addressDetails: string | null; commission: number
}

/** Header, lines, attribution and removal of exactly these bag rows commit together. */
export async function writeCheckout(db: D1Database, input: CheckoutInput) {
  const { userId, key, items } = input
  const now = Date.now()
  const orderId = '(SELECT id FROM orders WHERE user_id = ? AND idempotency_key = ?)'
  const guard = JSON.stringify(items.map((item) => ({ id: item.id, quantity: item.quantity,
    unitPrice: item.unit_price, artworkIds: artworkIdsIn(item.design_json) })))
  const statements: D1PreparedStatement[] = [db.prepare(`
    INSERT INTO orders (user_id, product_id, customer_name, customer_phone, address, coordinates,
      comment, design_json, logo_key, total_price, status, created_at, updated_at,
      payment_method, address_lat, address_lng, address_details, idempotency_key, session_id)
    SELECT ?,?,?,?,?,?,?,?,?,?,'new',?,?,?,?,?,?,?,?
    WHERE NOT EXISTS (
      SELECT 1 FROM json_each(?) AS line
      LEFT JOIN cart_items ci ON ci.id = json_extract(line.value, '$.id') AND ci.user_id = ?
      LEFT JOIN products p ON p.id = ci.product_id
      WHERE ci.id IS NULL OR p.id IS NULL OR p.active != 1
        OR ci.quantity != json_extract(line.value, '$.quantity')
        OR ci.unit_price != json_extract(line.value, '$.unitPrice')
        OR p.price + COALESCE((SELECT SUM(a.markup) FROM artworks a WHERE a.status = 'approved'
          AND a.id IN (SELECT value FROM json_each(json_extract(line.value, '$.artworkIds')))), 0) != ci.unit_price
    )`).bind(userId, items[0].product_id, input.customerName, input.customerPhone, input.address,
      input.coordinates, input.comment, JSON.stringify({ multi: true, itemCount: items.length }),
      items[0].logo_key, input.total, now, now, input.paymentMethod, input.lat, input.lng,
      input.addressDetails, key, input.sessionId, guard, userId)]
  for (const item of items) {
    statements.push(db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, design_json, logo_key, unit_price,
        quantity, created_at, front_print_key, back_print_key, front_mockup_key, back_mockup_key,
        back_logo_key, model_key, source_cart_item_id)
      SELECT ${orderId}, ?, (SELECT name_ru FROM products WHERE id = ?), ?,?,?,?,?,?,?,?,?,?,?,?
      WHERE EXISTS (SELECT 1 FROM orders WHERE user_id = ? AND idempotency_key = ?)`)
      .bind(userId, key, item.product_id, item.product_id, item.design_json, item.logo_key,
        item.unit_price, item.quantity, now, item.front_print_key, item.back_print_key,
        item.front_mockup_key, item.back_mockup_key, item.back_logo_key, item.model_key, item.id, userId, key))
    for (const artId of artworkIdsIn(item.design_json)) {
      statements.push(db.prepare(`
        INSERT INTO artwork_sales (order_id, order_item_id, artwork_id, designer_user_id, quantity,
          markup, commission_pct, designer_share, created_at)
        SELECT oi.order_id, oi.id, a.id, a.user_id, ?, a.markup, ?,
          CAST(ROUND(a.markup * ? * (100 - ?) / 100.0) AS INTEGER), ?
        FROM order_items oi JOIN artworks a ON a.id = ? AND a.status = 'approved'
        WHERE oi.order_id = ${orderId} AND oi.source_cart_item_id = ?`)
        .bind(item.quantity, input.commission, item.quantity, input.commission, now,
          artId, userId, key, item.id))
    }
  }
  if (input.sessionId) {
    statements.push(db.prepare(`INSERT INTO page_visits (session_id, page, device_type, os, browser, referrer, event, visited_at)
      SELECT ?, '/checkout', ?, NULL, NULL, NULL, 'order_placed', ?
      WHERE EXISTS (SELECT 1 FROM orders WHERE user_id = ? AND idempotency_key = ?)`)
      .bind(input.sessionId, input.platform ?? (input.sessionId.startsWith('app_') ? 'app' : 'web'), now, userId, key))
  }
  statements.push(db.prepare(`DELETE FROM cart_items WHERE user_id = ?
    AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?))
    AND EXISTS (SELECT 1 FROM orders WHERE user_id = ? AND idempotency_key = ?)`)
    .bind(userId, guard, userId, key))
  try {
    const results = await db.batch(statements)
    return { order: await findCheckout(db, userId, key), created: results[0].meta.changes > 0 }
  } catch (error) {
    // Another request with this key may have committed first, or a response
    // may have been lost after commit. A failed batch leaves no partial rows.
    const existing = await findCheckout(db, userId, key)
    if (existing) return { order: existing, created: false }
    throw error
  }
}
