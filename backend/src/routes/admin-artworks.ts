import { Hono } from 'hono'
import {
  getArtworkById,
  getArtworkSalesCounts,
  getArtworksForReview,
  getUserById,
  insertNotification,
  insertUserActivity,
  reviewArtwork,
} from '../db/queries'
import { requireAdmin, requireCap } from '../middleware/requireAdmin'
import { sendTelegramMessage } from '../lib/telegram'
import type { AdminEnv } from '../types'

// Moderation of designer artwork (migration 0017).
//
// Nothing a designer uploads reaches the marketplace until someone here
// approves it — the app says so on the submit screen, and until this file
// existed there was no way to actually do it, so every upload sat in
// `pending` forever and the marketplace stayed empty.

const router = new Hono<AdminEnv>()

const STATUSES = new Set(['pending', 'approved', 'rejected'])

function artworkUrl(requestUrl: string, key: string): string {
  const { protocol, host } = new URL(requestUrl)
  return `${protocol}//${host}/api/files/artwork/${key}`
}

// ─── GET /api/admin/artworks?status=pending&page=1 ───────────────────────────

router.get('/artworks', requireAdmin, requireCap('artworks.view'), async (c) => {
  const statusQ = c.req.query('status')
  const status = statusQ && STATUSES.has(statusQ) ? statusQ : null
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '30', 10)))

  const { items, total } = await getArtworksForReview(c.env.DB, status, page, limit)
  const sold = await getArtworkSalesCounts(c.env.DB, items.map((a) => a.id))

  // The pending count drives the sidebar badge regardless of which tab is open.
  const pending = status === 'pending' ? total : (await getArtworksForReview(c.env.DB, 'pending', 1, 1)).total

  return c.json({
    items: items.map((a) => ({
      id: a.id,
      user_id: a.user_id,
      title: a.title,
      tags: a.tags,
      markup: a.markup,
      width: a.width,
      height: a.height,
      status: a.status,
      reject_note: a.reject_note,
      reviewed_at: a.reviewed_at,
      created_at: a.created_at,
      image_url: artworkUrl(c.req.url, a.image_key),
      author: a.author_handle ?? a.author_name ?? `#${a.user_id}`,
      author_name: a.author_name,
      sold: sold[a.id] ?? 0,
    })),
    total,
    pending,
    page,
    limit,
  })
})

// ─── POST /api/admin/artworks/:id/review  { decision: approve|reject, note? } ─

router.post('/artworks/:id/review', requireAdmin, requireCap('artworks.review'), async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  let body: Record<string, unknown>
  try {
    body = (await c.req.json()) as Record<string, unknown>
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const decision = body.decision
  if (decision !== 'approve' && decision !== 'reject') {
    return c.json({ error: 'decision must be approve or reject' }, 400)
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) || null : null
  if (decision === 'reject' && !note) {
    // A rejection with no reason is a dead end for the designer.
    return c.json({ error: 'Укажите причину отклонения — дизайнер увидит её в приложении.' }, 400)
  }

  const artwork = await getArtworkById(c.env.DB, id)
  if (!artwork) return c.json({ error: 'Not found' }, 404)

  const status = decision === 'approve' ? 'approved' : 'rejected'
  const adminId = c.get('adminId')
  await reviewArtwork(c.env.DB, id, status, adminId, decision === 'reject' ? note : null)

  await insertUserActivity(c.env.DB, {
    user_id: artwork.user_id,
    action: status === 'approved' ? 'artwork_approved' : 'artwork_rejected',
    metadata: { artwork_id: id, title: artwork.title, by_admin_id: adminId, note },
  })

  // Tell the designer — the app promises "ответ придёт в Telegram". Best effort:
  // a designer who signed in with Google has no chat to write to, and the app
  // shows the status on their works page either way.
  const designer = await getUserById(c.env.DB, artwork.user_id)
  if (designer?.telegram_user_id && c.env.TELEGRAM_BOT_TOKEN) {
    const text =
      status === 'approved'
        ? `✅ <b>Работа опубликована</b>\n\n«${escape(artwork.title)}» прошла проверку и уже в каталоге дизайнеров LOOM. Вы получаете процент с каждой продажи.`
        : `↩️ <b>Работа отклонена</b>\n\n«${escape(artwork.title)}» пока не прошла проверку.\n\nПричина: ${escape(note ?? '')}\n\nИсправьте и загрузите снова — мы посмотрим ещё раз.`
    c.executionCtx.waitUntil(
      (async () => {
        const result = await sendTelegramMessage(c.env.TELEGRAM_BOT_TOKEN, designer.telegram_user_id!, text, {
          label: 'Открыть мои работы',
          url: 'https://loomdesign.uz/account.html',
        })
        await insertNotification(c.env.DB, {
          user_id: designer.id,
          message: text,
          button_label: 'Открыть мои работы',
          button_url: 'https://loomdesign.uz/account.html',
          telegram_message_id: result.messageId,
          sent_by_admin_id: adminId,
          status: result.ok ? 'sent' : 'failed',
          error_detail: result.error,
        }).catch(() => {})
      })(),
    )
  }

  const updated = await getArtworkById(c.env.DB, id)
  return c.json({ ok: true, artwork: updated })
})

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export default router
