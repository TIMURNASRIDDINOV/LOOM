import { Hono } from 'hono'
import { requireAuth } from '../middleware/requireAuth'
import {
  becomeDesigner,
  createArtwork,
  getApprovedArtworks,
  getArtworksByUser,
  getDesignerByHandle,
  getUserById,
} from '../db/queries'
import type { BaseEnv, UserEnv } from '../types'

// The designer marketplace: opting in, uploading artwork, and the public list
// of what moderation has approved.
//
// Uploading is gated on `users.is_designer` — the app must not offer the upload
// flow to a plain shopper, which is why `POST /artworks` returns 403 rather
// than silently accepting.

const router = new Hono<BaseEnv>()

function artworkUrl(requestUrl: string, key: string): string {
  const { protocol, host } = new URL(requestUrl)
  return `${protocol}//${host}/api/files/artwork/${key}`
}

// ─── GET /api/artworks — public marketplace ──────────────────────────────────

router.get('/artworks', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10))
  const { items, total } = await getApprovedArtworks(c.env.DB, page, 40)
  return c.json({
    items: items.map((a) => ({
      id: a.id,
      title: a.title,
      tags: a.tags,
      markup: a.markup,
      width: a.width,
      height: a.height,
      image_url: artworkUrl(c.req.url, a.image_key),
      author: a.author_handle ?? a.author_name ?? 'LOOM',
      created_at: a.created_at,
    })),
    page,
    total,
  })
})

// ─── Designer-only routes ────────────────────────────────────────────────────

const me = new Hono<UserEnv>()
me.use('*', requireAuth)

/** POST /api/designer/apply — opt in and claim a handle. */
me.post('/apply', async (c) => {
  let body: Record<string, unknown>
  try {
    body = (await c.req.json()) as Record<string, unknown>
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const raw = typeof body.handle === 'string' ? body.handle.trim().replace(/^@/, '') : ''
  if (!/^[a-z0-9_.]{3,24}$/i.test(raw)) {
    return c.json(
      { error: 'Ник: 3–24 символа, латиница, цифры, точка или подчёркивание.' },
      400,
    )
  }
  const handle = `@${raw.toLowerCase()}`

  const taken = await getDesignerByHandle(c.env.DB, handle)
  if (taken && taken.id !== c.get('userId')) {
    return c.json({ error: 'Этот ник уже занят' }, 409)
  }

  const bio = typeof body.bio === 'string' ? body.bio.trim().slice(0, 280) || null : null
  await becomeDesigner(c.env.DB, c.get('userId'), handle, bio)

  return c.json({ ok: true, is_designer: 1, designer_handle: handle, designer_bio: bio })
})

/** GET /api/designer/artworks — the designer's own submissions, any status. */
me.get('/artworks', async (c) => {
  const user = await getUserById(c.env.DB, c.get('userId'))
  if (!user?.is_designer) return c.json({ error: 'Вы ещё не дизайнер', code: 'not_designer' }, 403)

  const items = await getArtworksByUser(c.env.DB, c.get('userId'))
  return c.json({
    items: items.map((a) => ({
      id: a.id,
      title: a.title,
      tags: a.tags,
      markup: a.markup,
      status: a.status,
      reject_note: a.reject_note,
      image_url: artworkUrl(c.req.url, a.image_key),
      created_at: a.created_at,
    })),
  })
})

/**
 * POST /api/designer/artworks — submit a graphic for moderation.
 * The file itself goes through `POST /api/uploads` first; this takes the key.
 */
me.post('/artworks', async (c) => {
  const user = await getUserById(c.env.DB, c.get('userId'))
  if (!user?.is_designer) return c.json({ error: 'Вы ещё не дизайнер', code: 'not_designer' }, 403)
  if (user.status === 'banned') return c.json({ error: 'Ваш аккаунт заблокирован' }, 403)

  let body: Record<string, unknown>
  try {
    body = (await c.req.json()) as Record<string, unknown>
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const imageKey = typeof body.image_key === 'string' ? body.image_key.trim() : ''
  if (!title) return c.json({ error: 'Укажите название работы' }, 400)
  if (!imageKey) return c.json({ error: 'Сначала загрузите файл' }, 400)

  const width = typeof body.width === 'number' ? Math.round(body.width) : null
  const height = typeof body.height === 'number' ? Math.round(body.height) : null
  // Same floor the app enforces before it offers the upload — restated here so
  // the rule survives a client that skips the check.
  if (width && height && Math.max(width, height) < 1500) {
    return c.json({ error: 'Минимум 1500 px по длинной стороне' }, 400)
  }

  const markupRaw = typeof body.markup === 'number' ? Math.round(body.markup) : 0
  const markup = Math.min(200000, Math.max(0, markupRaw))

  const id = await createArtwork(c.env.DB, {
    user_id: c.get('userId'),
    title: title.slice(0, 80),
    tags: typeof body.tags === 'string' ? body.tags.trim().slice(0, 200) || null : null,
    image_key: imageKey,
    width,
    height,
    markup,
  })

  return c.json({ id, status: 'pending' }, 201)
})

router.route('/designer', me)

export default router
