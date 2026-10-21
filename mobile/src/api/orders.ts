import { api } from './client'
import type { Order } from './types'

// `GET /api/me/orders/:id` (LOOM-251) and the cart call behind "Takrorlash".
// The order list stays in catalog.ts (`fetchMyOrders`).

/** One line of an order (`order_items`). */
export type OrderItem = {
  id: number
  order_id: number
  product_id: number | null
  /** Russian name at the time of the order. */
  product_name: string | null
  design_json: string
  logo_key: string | null
  unit_price: number
  quantity: number
  created_at: number
  front_mockup_key: string | null
  back_mockup_key: string | null
}

/** A status change, oldest first. Times are epoch ms. */
export type StatusLogEntry = {
  old_status: string | null
  new_status: string
  changed_at: number
  note: string | null
}

export type OrderDetail = { order: Order; items: OrderItem[]; status_log: StatusLogEntry[] }

/** 401 signed out · 404 not the caller's order (or no such order). */
export function fetchOrder(id: number | string) {
  return api<OrderDetail>(`/api/me/orders/${encodeURIComponent(String(id))}`, { auth: true })
}

/** Puts one past order line back in the server cart; the server re-checks product, size and colour. */
export function addOrderItemToCart(it: OrderItem) {
  return api('/api/cart', {
    method: 'POST',
    auth: true,
    body: {
      productId: it.product_id ?? undefined,
      designJson: it.design_json,
      unitPrice: it.unit_price,
      quantity: it.quantity,
      logoKey: it.logo_key ?? undefined,
      frontMockupKey: it.front_mockup_key ?? undefined,
      backMockupKey: it.back_mockup_key ?? undefined,
    },
  })
}
