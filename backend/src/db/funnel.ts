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

// ─── Ad campaigns and user flow (LOOM-368) ───────────────────────────────────
// UTM lives only inside page_visits.page (track.js sends path + query; tma.js
// adds utm_* for Mini App ads), so attribution is parsed here in TS.

type Range = NonNullable<ReturnType<typeof funnelRange>>
export type Channel = 'miniapp' | 'web' | 'app'
export type VisitRow = {
  session_id: string; page: string; event: string | null; browser: string | null
  device_type: string | null; referrer: string | null; visited_at: number
}
export type Source = { source: string; medium: string; campaign: string }
export type SessionSummary = Source & {
  channel: Channel; opened: boolean; carted: boolean; checkedOut: boolean; orders: number; pages: string[]
}
export type SessionFilter = { channel?: Channel; campaign?: string }

// ponytail: rows are read into the Worker; past this many the answer is partial
// (truncated: true). Move attribution into SQL if real traffic gets near it.
export const VISIT_ROW_LIMIT = 50000
const OWN_HOST = /(^|\.)loomdesign\.uz$|(^|\.)t\.me$|^localhost$/
const clean = (value: string | null) => (value ?? '').trim().slice(0, 64)

/** Path only, no query, no trailing slash (except "/"). */
export function pagePath(page: string) {
  const path = (page || '/').split(/[?#]/)[0] || '/'
  return path.length > 1 ? path.replace(/\/+$/, '') || '/' : path
}

/** utm_* from the first row of the session that has them, else the entry referrer host. */
export function attributeSession(rows: VisitRow[]): Source & { channel: Channel } {
  let source: Source | null = null
  for (const row of rows) {
    const query = (row.page || '').split('?')[1]
    if (!query || !query.includes('utm_')) continue
    const params = new URLSearchParams(query.split('#')[0])
    const utm = { source: clean(params.get('utm_source')), medium: clean(params.get('utm_medium')), campaign: clean(params.get('utm_campaign')) }
    if (utm.source || utm.medium || utm.campaign) {
      source = { source: utm.source || '(none)', medium: utm.medium || '(none)', campaign: utm.campaign || '(none)' }
      break
    }
  }
  if (!source) {
    let host = ''
    const referrer = rows.find((row) => row.referrer)?.referrer
    try { host = referrer ? new URL(referrer).hostname.replace(/^www\./, '') : '' } catch { host = '' }
    source = { source: host && !OWN_HOST.test(host) ? host : '(direct)', medium: '(none)', campaign: '(none)' }
  }
  const telegram = rows.some((row) => row.browser === 'telegram')
  const app = rows.some((row) => row.device_type === 'app' || row.session_id.startsWith('app_'))
  const channel: Channel = telegram || source.medium === 'miniapp' ? 'miniapp' : app ? 'app' : 'web'
  return { ...source, channel }
}

/**
 * One session's rows, oldest first. Steps follow getFunnelStats: each needs the
 * previous one, and a placed order is an order_placed event whose time matches
 * a valid order (not cancelled, not test #54) of that session.
 */
export function summarizeSession(rows: VisitRow[], orderTimes: Set<number>): SessionSummary {
  const first = (event: string, after: number | undefined) => after === undefined ? undefined
    : rows.find((row) => row.event === event && row.visited_at >= after)?.visited_at
  const opened = first('cfg_open', -Infinity)
  const carted = first('cfg_cart', opened)
  const checkedOut = first('cfg_checkout_submit', carted)
  const orders = checkedOut === undefined ? 0 : new Set(rows.filter((row) => row.event === 'order_placed' &&
    row.visited_at >= checkedOut && orderTimes.has(row.visited_at)).map((row) => row.visited_at)).size
  const pages: string[] = []
  for (const row of rows) {
    const path = pagePath(row.page)
    if (pages[pages.length - 1] !== path) pages.push(path)
  }
  return { ...attributeSession(rows), opened: opened !== undefined, carted: carted !== undefined,
    checkedOut: checkedOut !== undefined, orders, pages }
}

/** Query-string filters shared by both routes; null when invalid. */
export function sessionFilter(channel?: string, campaign?: string): SessionFilter | null {
  if (channel && !['miniapp', 'web', 'app'].includes(channel)) return null
  if (campaign && campaign.length > 64) return null
  return { channel: (channel || undefined) as Channel | undefined, campaign: campaign || undefined }
}

async function loadSessions(db: D1Database, range: Range, filter: SessionFilter) {
  const [visits, orders] = await Promise.all([
    db.prepare(`SELECT session_id, page, event, browser, device_type, referrer, visited_at FROM page_visits
      WHERE visited_at >= ?1 AND visited_at < ?2 AND session_id != '' ORDER BY visited_at, id LIMIT ?3`)
      .bind(range.start, range.end, VISIT_ROW_LIMIT + 1).all<VisitRow>(),
    db.prepare(`SELECT session_id, created_at FROM orders WHERE created_at >= ?1 AND created_at < ?2
      AND session_id IS NOT NULL AND status != 'cancelled' AND id != 54`)
      .bind(range.start, range.end).all<{ session_id: string; created_at: number }>(),
  ])
  const truncated = visits.results.length > VISIT_ROW_LIMIT
  const bySession = new Map<string, VisitRow[]>()
  for (const row of visits.results.slice(0, VISIT_ROW_LIMIT)) {
    const list = bySession.get(row.session_id)
    if (list) list.push(row); else bySession.set(row.session_id, [row])
  }
  const orderTimes = new Map<string, Set<number>>()
  for (const o of orders.results) {
    if (!orderTimes.has(o.session_id)) orderTimes.set(o.session_id, new Set())
    orderTimes.get(o.session_id)!.add(o.created_at)
  }
  const sessions = [...bySession].map(([id, rows]) => summarizeSession(rows, orderTimes.get(id) ?? new Set()))
    .filter((s) => (!filter.channel || s.channel === filter.channel) && (!filter.campaign || s.campaign === filter.campaign))
  return { sessions, truncated }
}

const meta = (range: Range, filter: SessionFilter, truncated: boolean) =>
  ({ from: range.from, to: range.to, timezone: 'UTC', channel: filter.channel ?? null, campaign: filter.campaign ?? null, truncated })

/** Every session with a visit in the range, grouped by source / medium / campaign. */
export async function getCampaignFunnel(db: D1Database, range: Range, filter: SessionFilter) {
  const { sessions, truncated } = await loadSessions(db, range, filter)
  const rows = new Map<string, Source & { sessions: number; opens: number; carts: number; checkouts: number; placed: number; orders: number }>()
  for (const s of sessions) {
    const key = `${s.source}\n${s.medium}\n${s.campaign}`
    const row = rows.get(key) ?? { source: s.source, medium: s.medium, campaign: s.campaign, sessions: 0, opens: 0, carts: 0, checkouts: 0, placed: 0, orders: 0 }
    row.sessions++; row.opens += +s.opened; row.carts += +s.carted; row.checkouts += +s.checkedOut
    row.placed += +(s.orders > 0); row.orders += s.orders
    rows.set(key, row)
  }
  const campaigns = [...rows.values()].sort((a, b) => b.sessions - a.sessions || a.campaign.localeCompare(b.campaign))
  return { ...meta(range, filter, truncated), campaigns }
}

/** Top 10 page paths (first 6 steps) and top 10 exit pages. */
export async function getUserFlow(db: D1Database, range: Range, filter: SessionFilter) {
  const { sessions, truncated } = await loadSessions(db, range, filter)
  const top = (counts: Map<string, number>) => [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10)
  const paths = new Map<string, number>(), exits = new Map<string, number>()
  for (const s of sessions) {
    const key = s.pages.slice(0, 6).join('\n')
    paths.set(key, (paths.get(key) ?? 0) + 1)
    const exit = s.pages[s.pages.length - 1]
    exits.set(exit, (exits.get(exit) ?? 0) + 1)
  }
  return { ...meta(range, filter, truncated), sessions: sessions.length,
    paths: top(paths).map(([key, count]) => ({ steps: key.split('\n'), sessions: count })),
    exits: top(exits).map(([page, count]) => ({ page, sessions: count })) }
}
