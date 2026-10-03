import { Hono } from 'hono'
import { trackPageVisit, isArtworkKey } from '../db/queries'
import { serveObject, LEGACY_AVATAR_KEY } from '../lib/r2'
import type { BaseEnv } from '../types'

const files = new Hono<BaseEnv>()

// ─── GET /api/files/models/:key  (public, long-cached) ───────────────────────

files.get('/models/:key{.+}', async (c) => {
  const key = c.req.param('key')
  // Product meshes and thumbnails only; avatars have their own route.
  if (key.startsWith('avatars/')) return c.json({ error: 'Not found' }, 404)
  const object = await c.env.LOOM_MODELS.get(key)
  if (!object) return c.json({ error: 'Not found' }, 404)
  return serveObject(object, key, 'public, max-age=31536000, immutable')
})

// ─── GET /api/files/artwork/:key  (public, long-cached) ──────────────────────
// Designer artwork lives in loom-uploads alongside order logos and print
// files. Only keys that an artwork row points at are served here; anything
// else in the bucket is 404. Pending/rejected submissions stay reachable so
// the designer and the moderation queue can preview them.

files.get('/artwork/:key{.+}', async (c) => {
  const key = c.req.param('key')
  if (!(await isArtworkKey(c.env.DB, key, true))) return c.json({ error: 'Not found' }, 404)
  const object = await c.env.LOOM_UPLOADS.get(key)
  if (!object) return c.json({ error: 'Not found' }, 404)
  return serveObject(object, key, 'public, max-age=31536000, immutable')
})

// ─── GET /api/files/avatars/:key  (public, short-cached) ─────────────────────

files.get('/avatars/:key{.+}', async (c) => {
  // `key` is the full stored key (avatars/…). Keys derived from the user id
  // are not served; current avatar keys carry a random part.
  const key = c.req.param('key')
  if (!key.startsWith('avatars/') || LEGACY_AVATAR_KEY.test(key)) return c.json({ error: 'Not found' }, 404)
  const object = await c.env.LOOM_MODELS.get(key)
  if (!object) return c.json({ error: 'Not found' }, 404)
  return serveObject(object, key, 'public, max-age=86400')
})

// ─── POST /api/track  (public — visitor analytics) ───────────────────────────

files.post('/track', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ ok: true }) }

  const { session_id, page, device_type, os, browser, referrer, event } = body as Record<string, unknown>
  if (!session_id || typeof session_id !== 'string') return c.json({ ok: true })

  // Allow-list, not free text: this endpoint is public and unauthenticated, so
  // an arbitrary string would let anyone write whatever they liked into the
  // analytics table. Unknown values are dropped and the row lands as a pageview.
  const EVENTS = [
    'cfg_open',        // configurator reached
    'cfg_design_add',  // first text or image placed
    'cfg_style',       // colour or size touched
    'cfg_preview_3d',  // flipped to the 3D preview
    'cfg_cart',        // added to cart
    'cfg_order',       // went through to checkout
  ]
  const evt = typeof event === 'string' && EVENTS.includes(event) ? event : null

  // Fire-and-forget — don't await so we don't add latency
  ;(c as unknown as { executionCtx?: { waitUntil: (p: Promise<unknown>) => void } }).executionCtx?.waitUntil(
    trackPageVisit(c.env.DB, {
      session_id: String(session_id).slice(0, 64),
      page: typeof page === 'string' ? page.slice(0, 200) : '/',
      device_type: typeof device_type === 'string' ? device_type : null,
      os: typeof os === 'string' ? os : null,
      browser: typeof browser === 'string' ? browser : null,
      referrer: typeof referrer === 'string' ? referrer.slice(0, 500) : null,
      event: evt,
    }).catch(() => {}),
  )

  return c.json({ ok: true })
})

export default files
