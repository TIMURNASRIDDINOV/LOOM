// GA4 Data API readout for the admin Overview page (LOOM-285).
//
// A read-only Google service account (Viewer on one GA4 property) signs a JWT
// with WebCrypto, trades it for an access token and makes ONE batchRunReports
// call with five aggregate reports. The mapped result is kept in the Workers
// Cache API for 10 minutes per `days` value, so repeat admin loads do not spend
// GA4 quota. Only aggregate dimensions are requested: never userId, clientId or
// a user-scoped custom dimension.
//
// Secrets (wrangler secret put): GA4_PROPERTY_ID (numeric property id, not the
// G- measurement id) and GA4_SA_KEY (the whole service-account JSON key file).

import type { Bindings } from '../types'

const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CACHE_SECONDS = 600

export type Ga4Days = 7 | 28

export class Ga4Error extends Error {
  lastFetchedAt: string | null = null
  constructor(readonly code: string, detail = code) {
    super(detail)
  }
}

// `?days=` is 7 or 28; missing means 28. Anything else is a 400.
export function ga4Days(raw: string | undefined): Ga4Days | null {
  if (raw === undefined || raw === '' || raw === '28') return 28
  return raw === '7' ? 7 : null
}

const eventIs = (value: string, matchType = 'EXACT') => ({ filter: { fieldName: 'eventName', stringFilter: { matchType, value } } })

// Order matters: the response's reports come back in this order.
const REPORTS: { key: string; dimensions: string[]; metrics: string[]; limit: number; filter?: unknown }[] = [
  { key: 'pages', dimensions: ['pagePath'], metrics: ['screenPageViews', 'activeUsers'], limit: 25 },
  {
    key: 'clicks',
    dimensions: ['customEvent:element_id', 'customEvent:element_text', 'customEvent:section', 'pagePath'],
    metrics: ['eventCount'],
    filter: eventIs('ui_click'),
    limit: 50,
  },
  { key: 'sources', dimensions: ['sessionSource', 'sessionMedium', 'sessionCampaignName'], metrics: ['sessions', 'activeUsers'], limit: 25 },
  { key: 'devices', dimensions: ['deviceCategory'], metrics: ['sessions', 'activeUsers'], limit: 10 },
  {
    // Enhanced-measurement scroll (90% depth) and the cfg_* funnel events
    // LOOM-283 mirrors into GA4, per page.
    key: 'events',
    dimensions: ['eventName', 'pagePath'],
    metrics: ['eventCount'],
    filter: { orGroup: { expressions: [eventIs('scroll'), eventIs('cfg_', 'BEGINS_WITH')] } },
    limit: 100,
  },
]

// GA4 names to the short keys the admin UI reads.
const NAMES: Record<string, string> = {
  pagePath: 'path',
  'customEvent:element_id': 'elementId',
  'customEvent:element_text': 'text',
  'customEvent:section': 'section',
  sessionSource: 'source',
  sessionMedium: 'medium',
  sessionCampaignName: 'campaign',
  deviceCategory: 'device',
  eventName: 'event',
  screenPageViews: 'views',
  activeUsers: 'users',
  eventCount: 'count',
  sessions: 'sessions',
}

// Last `days` days including today, in the property's time zone.
function batchBody(days: Ga4Days) {
  return {
    requests: REPORTS.map((r, i) => ({
      dateRanges: [{ startDate: `${days - 1}daysAgo`, endDate: 'today' }],
      dimensions: r.dimensions.map((name) => ({ name })),
      metrics: r.metrics.map((name) => ({ name })),
      ...(r.filter ? { dimensionFilter: r.filter } : {}),
      orderBys: [{ metric: { metricName: r.metrics[0] }, desc: true }],
      limit: r.limit,
      ...(i === 0 ? { returnPropertyQuota: true } : {}),
    })),
  }
}

type Header = { name: string }
type Report = {
  dimensionHeaders?: Header[]
  metricHeaders?: Header[]
  rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[]
}

function mapBatch(data: { reports?: Report[] }): Record<string, Record<string, string | number>[]> {
  const out: Record<string, Record<string, string | number>[]> = {}
  REPORTS.forEach(({ key }, i) => {
    const report = data.reports?.[i] ?? {}
    const dims = (report.dimensionHeaders ?? []).map((h) => NAMES[h.name] ?? h.name)
    const mets = (report.metricHeaders ?? []).map((h) => NAMES[h.name] ?? h.name)
    out[key] = (report.rows ?? []).map((row) => {
      const item: Record<string, string | number> = {}
      dims.forEach((k, j) => { item[k] = row.dimensionValues?.[j]?.value ?? '' })
      mets.forEach((k, j) => { item[k] = Number(row.metricValues?.[j]?.value ?? 0) })
      return item
    })
  })
  return out
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64json = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)))

type ServiceKey = { client_email: string; private_key: string }

function parseKey(raw: string): ServiceKey {
  try {
    const key = JSON.parse(raw)
    if (typeof key.client_email === 'string' && typeof key.private_key === 'string') return key
  } catch { /* fall through */ }
  throw new Ga4Error('ga4_key_invalid', 'GA4_SA_KEY is not a service-account JSON key')
}

async function signServiceJwt(key: ServiceKey, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const input = `${b64json({ alg: 'RS256', typ: 'JWT' })}.${b64json({ iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })}`
  let signer: CryptoKey
  try {
    const der = Uint8Array.from(atob(key.private_key.replace(/-----[^-]+-----|\s/g, '')), (ch) => ch.charCodeAt(0))
    signer = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  } catch {
    throw new Ga4Error('ga4_key_invalid', 'GA4_SA_KEY private_key is not a PKCS#8 RSA key')
  }
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signer, new TextEncoder().encode(input))
  return `${input}.${b64url(new Uint8Array(signature))}`
}

// Logs Google's message for the Worker log; the browser only gets the code.
async function googleError(res: Response, stage: 'token' | 'data'): Promise<Ga4Error> {
  const text = (await res.text().catch(() => '')).slice(0, 500)
  console.error(`ga4 ${stage} HTTP ${res.status}: ${text}`)
  if (stage === 'token') return new Ga4Error('ga4_auth_failed')
  if (res.status === 429) return new Ga4Error('ga4_rate_limited')
  if (res.status === 401 || res.status === 403) return new Ga4Error('ga4_forbidden')
  if (res.status === 400 && text.includes('customEvent:')) return new Ga4Error('ga4_custom_dimensions_missing')
  return new Ga4Error('ga4_request_failed')
}

async function google(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (error) {
    console.error('ga4 fetch failed', error)
    throw new Ga4Error('ga4_request_failed')
  }
}

async function fetchBatch(rawKey: string, propertyId: string, days: Ga4Days): Promise<{ reports?: Report[] }> {
  const assertion = await signServiceJwt(parseKey(rawKey))
  const tokenRes = await google(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  if (!tokenRes.ok) throw await googleError(tokenRes, 'token')
  const { access_token: accessToken } = await tokenRes.json<{ access_token?: string }>()
  if (!accessToken) throw new Ga4Error('ga4_auth_failed')

  const res = await google(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:batchRunReports`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(batchBody(days)),
  })
  if (!res.ok) throw await googleError(res, 'data')
  const data = await res.json<{ reports?: (Report & { propertyQuota?: unknown })[] }>()
  const quota = data.reports?.[0]?.propertyQuota
  if (quota) console.log('ga4 propertyQuota', JSON.stringify(quota))
  return data
}

const cacheEntry = (body: unknown, seconds: number) => new Response(JSON.stringify(body), {
  headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${seconds}` },
})

// `requestUrl` only supplies the cache keys' origin; the paths are internal and
// no route serves them. Call only after requireAdmin + requireCap. A Google
// failure is rethrown with `lastFetchedAt`: the last good fetch for this
// property that this data center remembers (kept up to 7 days, may go sooner).
export async function ga4Report(env: Bindings, days: Ga4Days, requestUrl: string): Promise<Record<string, unknown>> {
  const missing = (['GA4_PROPERTY_ID', 'GA4_SA_KEY'] as const).filter((name) => !env[name]?.trim())
  if (missing.length) return { configured: false, missing }

  const propertyId = env.GA4_PROPERTY_ID!.trim()
  if (!/^\d+$/.test(propertyId)) throw new Ga4Error('ga4_property_invalid', 'GA4_PROPERTY_ID is not numeric')

  const key = (path: string) => new Request(new URL(`/__internal/${path}`, requestUrl).toString())
  const reportKey = key(`ga4-report?property=${propertyId}&days=${days}`)
  const lastKey = key(`ga4-last-good?property=${propertyId}`)
  const hit = await caches.default.match(reportKey)
  if (hit) return { ...(await hit.json<Record<string, unknown>>()), cached: true }

  let data
  try {
    data = await fetchBatch(env.GA4_SA_KEY!, propertyId, days)
  } catch (error) {
    const last = await caches.default.match(lastKey)
    if (error instanceof Ga4Error && last) error.lastFetchedAt = (await last.json<{ fetchedAt: string }>()).fetchedAt
    throw error
  }
  const body = { configured: true, days, propertyId, fetchedAt: new Date().toISOString(), ...mapBatch(data) }
  await caches.default.put(reportKey, cacheEntry(body, CACHE_SECONDS))
  await caches.default.put(lastKey, cacheEntry({ fetchedAt: body.fetchedAt }, 7 * 86400))
  return { ...body, cached: false }
}
