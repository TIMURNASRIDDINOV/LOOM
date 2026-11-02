import { STATUSES, type OrderStatusKey } from '../../theme/tokens'
import type { StatusLogEntry } from '../../api/orders'
import type { Order } from '../../api/types'

// The order timeline (W31), built from the order row and its status log.

export type Step = {
  key: OrderStatusKey | 'cancelled'
  state: 'done' | 'current' | 'todo'
  /** Epoch ms of the change; null when the log has no entry for a passed step. */
  at: number | null
}

/**
 * The log only records changes an admin made, so a new order has no `new`
 * entry: that step takes the time the order was placed. A step the order
 * jumped over has no time. A cancelled order stops at the cancellation: the
 * steps it reached, then "cancelled"; nothing pending after it.
 */
export function buildSteps(order: Pick<Order, 'status' | 'created_at' | 'updated_at'>, log: StatusLogEntry[]): Step[] {
  const when = (key: string): number | null => {
    const hits = log.filter((e) => e.new_status === key).map((e) => e.changed_at)
    return hits.length ? Math.max(...hits) : null
  }
  const placed = (key: OrderStatusKey) => when(key) ?? (key === 'new' ? order.created_at : null)

  if (order.status === 'cancelled') {
    const reached = STATUSES.filter((s) => s.k === 'new' || when(s.k) !== null)
    return [
      ...reached.map((s): Step => ({ key: s.k, state: 'done', at: placed(s.k) })),
      { key: 'cancelled', state: 'current', at: when('cancelled') ?? order.updated_at },
    ]
  }

  const now = Math.max(0, STATUSES.findIndex((s) => s.k === order.status))
  // Delivered is the end of the road: nothing is "in progress" any more.
  const finished = order.status === 'delivered'
  return STATUSES.map((s, i): Step => ({
    key: s.k,
    state: i < now || finished ? 'done' : i === now ? 'current' : 'todo',
    at: i <= now ? placed(s.k) : null,
  }))
}
