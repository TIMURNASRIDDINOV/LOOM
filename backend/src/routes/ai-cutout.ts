import { Hono } from 'hono'
import { requireAdmin } from '../middleware/requireAdmin'
import { inspectPng } from '../lib/ai-image'
import type { AiEnv } from '../types'

// Background removal for generated test artwork, so the spike can judge how
// each model's output cuts out for a print — the decision this harness exists
// to inform.
//
// Built on the Images binding rather than a fetch with `cf: { image: ... }`:
// probed against the live service, env.IMAGES.input().transform({segment})
// returns a genuine RGBA PNG (colour type 6). The binding reads the R2 object
// body directly, so there is no R2 custom domain and no self-referential
// authenticated fetch in the path.

const cutout = new Hono<AiEnv>()

/**
 * Only spike artwork may be segmented. Without this the endpoint would happily
 * transform any key in the uploads bucket — customer logos and order print
 * masters live in that same bucket.
 */
const ALLOWED_PREFIX = 'ai-tests/'

// ─── GET /api/ai/cutout/*  (admin-only) ──────────────────────────────────────

cutout.get('/cutout/:key{.+}', requireAdmin, async (c) => {
  const key = c.req.param('key')

  if (!key.startsWith(ALLOWED_PREFIX) || key.includes('..')) {
    return c.json({ error: `Cutout is limited to ${ALLOWED_PREFIX}* keys`, code: 'forbidden_key' }, 403)
  }

  const object = await c.env.LOOM_UPLOADS.get(key)
  if (!object) return c.json({ error: 'Not found' }, 404)

  let bytes: Uint8Array
  try {
    const result = await c.env.IMAGES
      .input(object.body)
      .transform({ segment: 'foreground' })
      .output({ format: 'image/png' })
    bytes = new Uint8Array(await result.response().arrayBuffer())
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[ai/cutout] transform threw for ${key}:`, message)
    return c.json(
      {
        error: 'Background removal failed. Images transformations may not be enabled for this account.',
        code: 'segment_failed',
        detail: message,
      },
      502,
    )
  }

  // A transform that silently no-ops returns the source image untouched, which
  // would look fine on a checkered backdrop and only betray itself as an opaque
  // rectangle on black. Refuse to serve that: an opaque "cutout" is a worse
  // outcome than an error, because it quietly poisons the model comparison.
  const png = inspectPng(bytes)
  if (!png.isPng || !(png.hasAlpha || png.hasTrns)) {
    console.error(
      `[ai/cutout] no alpha channel for ${key} — transform appears to have no-opped ` +
        `(isPng=${png.isPng} colorType=${png.colorType} bytes=${bytes.length})`,
    )
    return c.json(
      {
        error: 'Background removal produced an image with no alpha channel — refusing to serve an opaque cutout.',
        code: 'no_alpha_channel',
        detail: { isPng: png.isPng, colorType: png.colorType, bytes: bytes.length },
      },
      502,
    )
  }

  return new Response(bytes, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'private, max-age=3600',
      // Surfaced in the admin panel so a reviewer can confirm at a glance that
      // they are looking at a real segmentation.
      'x-loom-color-type': String(png.colorType),
    },
  })
})

export default cutout
