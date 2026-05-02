import { Hono } from 'hono'
import type { BaseEnv } from '../types'

const files = new Hono<BaseEnv>()

// ─── GET /api/files/models/:key  (public, long-cached) ───────────────────────
// Serves GLB models and thumbnails from loom-models R2 bucket.

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

export default files
