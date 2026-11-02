const DAY = 86400000

export type FunnelCounts = {
  opens: number
  carts: number
  checkouts: number
  placed: number
  orders: number
}

export type FunnelRow = FunnelCounts & { day: string; platform: 'web' | 'app' }

/** UTC calendar days, inclusive in the UI and half-open in SQL. */
export function funnelRange(from?: string, to?: string, now = Date.now()) {
  const today = Math.floor(now / DAY) * DAY
  const start = from === undefined ? today - 29 * DAY : Date.parse(from)
  const last = to === undefined ? today : Date.parse(to)
  const valid = (raw: string | undefined, value: number) => raw === undefined ||
    (/^\d{4}-\d{2}-\d{2}$/.test(raw) && Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === raw)
  if (!valid(from, start) || !valid(to, last) || start > last || last - start >= 366 * DAY) return null
  return { from: new Date(start).toISOString().slice(0, 10), to: new Date(last).toISOString().slice(0, 10), start, end: last + DAY }
}

export async function getFunnelStats(db: D1Database, range: NonNullable<ReturnType<typeof funnelRange>>) {
  // One row per session/platform, assigned to its first open day in this range.
  // Requiring the previous step keeps every conversion denominator meaningful.
  // Only the server event joined to its order is evidence of a placed order.
  const { results } = await db.prepare(`
    WITH events AS (
      SELECT session_id, event, visited_at,
        CASE WHEN device_type = 'app' OR substr(session_id, 1, 4) = 'app_' THEN 'app' ELSE 'web' END AS platform
      FROM page_visits
      WHERE visited_at >= ?1 AND visited_at < ?2 AND session_id != ''
        AND event IN ('cfg_open', 'cfg_cart', 'cfg_checkout_submit', 'order_placed')
    ), opens AS (
      SELECT session_id, platform, MIN(visited_at) AS opened_at
      FROM events WHERE event = 'cfg_open' GROUP BY session_id, platform
    ), carts AS (
      SELECT s.*, MIN(e.visited_at) AS cart_at
      FROM opens s LEFT JOIN events e ON e.session_id = s.session_id AND e.platform = s.platform
        AND e.event = 'cfg_cart' AND e.visited_at >= s.opened_at
      GROUP BY s.session_id, s.platform
    ), checkouts AS (
      SELECT s.*, MIN(e.visited_at) AS checkout_at
      FROM carts s LEFT JOIN events e ON e.session_id = s.session_id AND e.platform = s.platform
        AND e.event = 'cfg_checkout_submit' AND e.visited_at >= s.cart_at
      GROUP BY s.session_id, s.platform
    ), sessions AS (
      SELECT s.*, COUNT(DISTINCT o.id) AS orders
      FROM checkouts s LEFT JOIN events e ON e.session_id = s.session_id AND e.platform = s.platform
        AND e.event = 'order_placed' AND e.visited_at >= s.checkout_at
      LEFT JOIN orders o ON o.session_id = e.session_id AND o.created_at = e.visited_at
        AND o.status != 'cancelled' AND o.id != 54
      GROUP BY s.session_id, s.platform
    )
    SELECT strftime('%Y-%m-%d', opened_at / 1000, 'unixepoch') AS day, platform,
      COUNT(*) AS opens, SUM(cart_at IS NOT NULL) AS carts,
      SUM(checkout_at IS NOT NULL) AS checkouts, SUM(orders > 0) AS placed, SUM(orders) AS orders
    FROM sessions GROUP BY day, platform ORDER BY day, platform
  `).bind(range.start, range.end).all<FunnelRow>()

  const empty = (): FunnelCounts => ({ opens: 0, carts: 0, checkouts: 0, placed: 0, orders: 0 })
  const totals = { web: empty(), app: empty() }
  const rows = new Map(results.map((row) => [`${row.day}:${row.platform}`, row]))
  const daily: FunnelRow[] = []
  for (let time = range.start; time < range.end; time += DAY) {
    const day = new Date(time).toISOString().slice(0, 10)
    for (const platform of ['web', 'app'] as const) {
      const row = rows.get(`${day}:${platform}`) ?? { day, platform, ...empty() }
      daily.push(row)
      for (const key of Object.keys(empty()) as Array<keyof FunnelCounts>) totals[platform][key] += row[key]
    }
  }
  return { from: range.from, to: range.to, timezone: 'UTC', totals, daily }
}
