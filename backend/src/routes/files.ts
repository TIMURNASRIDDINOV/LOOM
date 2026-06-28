import { Hono } from 'hono'
import { trackPageVisit } from '../db/queries'
import type { BaseEnv } from '../types'

const files = new Hono<BaseEnv>()

// ─── GET /api/files/models/:key  (public, long-cached) ───────────────────────

files.get('/models/:key{.+}', async (c) => {
  const key = c.req.param('key')
  const object = await c.env.LOOM_MODELS.get(key)
  if (!object) return c.json({ error: 'Not found' }, 404)

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('cache-control', 'public, max-age=31536000, immutable')

  return new Response(object.body, { headers })
})

// ─── GET /api/files/avatars/:key  (public, short-cached) ─────────────────────

files.get('/avatars/:key{.+}', async (c) => {
  const key = c.req.param('key')
  const object = await c.env.LOOM_MODELS.get(key)
  if (!object) return c.json({ error: 'Not found' }, 404)

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('cache-control', 'public, max-age=86400')

  return new Response(object.body, { headers })
})

// ─── POST /api/track  (public — visitor analytics) ───────────────────────────

files.post('/track', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ ok: true }) }

  const { session_id, page, device_type, os, browser, referrer } = body as Record<string, unknown>
  if (!session_id || typeof session_id !== 'string') return c.json({ ok: true })

  // Fire-and-forget — don't await so we don't add latency
  ;(c as unknown as { executionCtx?: { waitUntil: (p: Promise<unknown>) => void } }).executionCtx?.waitUntil(
    trackPageVisit(c.env.DB, {
      session_id: String(session_id).slice(0, 64),
      page: typeof page === 'string' ? page.slice(0, 200) : '/',
      device_type: typeof device_type === 'string' ? device_type : null,
      os: typeof os === 'string' ? os : null,
      browser: typeof browser === 'string' ? browser : null,
      referrer: typeof referrer === 'string' ? referrer.slice(0, 500) : null,
    }).catch(() => {}),
  )

  return c.json({ ok: true })
})

export default files
