import { Hono } from 'hono'
import {
  getAdminUsers,
  getAdminUserById,
  updateUserRoleAndStatus,
  updateUserProfile,
  getOrdersByUserId,
  getUserActivity,
  insertUserActivity,
  insertNotification,
  getNotifications,
  getAdminStatsExtended,
  getUsersWithRole,
  setUserRole,
  getUserByEmail,
  getUserByPhone,
  revokeUserTokens,
} from '../db/queries'
import { requireAdmin, requireCap } from '../middleware/requireAdmin'
import type { AdminEnv } from '../types'

const router = new Hono<AdminEnv>()

// Writes need manager or owner; reads are open to any admin (incl. staff).

const ALLOWED_ROLES = new Set(['user', 'admin', 'super_admin', 'owner'])
const ALLOWED_STATUSES = new Set(['active', 'banned'])

// A deleted account is anonymised for good (queries.ts anonymizeUser).
const DELETED_FINAL = { error: 'Аккаунт удалён — изменить его статус нельзя', code: 'account_deleted' }

const NO_RIGHTS = 'Недостаточно прав для этого действия. Обратитесь к владельцу аккаунта.'

/** Phone as +<9–15 digits>; spaces, brackets and dashes of the input mask are dropped. */
function normalizeAdminPhone(raw: string): string | null {
  const p = raw.replace(/[\s()\-]/g, '')
  return /^\+\d{9,15}$/.test(p) ? p : null
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** page / limit query values; anything unparsable falls back to the default. */
const pageParam = (raw: string | undefined) => Math.max(1, parseInt(raw ?? '1', 10) || 1)
const limitParam = (raw: string | undefined, def: number) => Math.min(100, Math.max(1, parseInt(raw ?? String(def), 10) || def))

// ─── GET /api/admin/stats (extended) ─────────────────────────────────────────

router.get('/stats', requireAdmin, requireCap('analytics.view'), async (c) => {
  const stats = await getAdminStatsExtended(c.env.DB)
  return c.json(stats)
})

// ─── GET /api/admin/users ─────────────────────────────────────────────────────

router.get('/users', requireAdmin, requireCap('users.view'), async (c) => {
  const q = c.req.query('q') || undefined
  const role = c.req.query('role') || undefined
  const status = c.req.query('status') || undefined
  const page = pageParam(c.req.query('page'))
  const limit = limitParam(c.req.query('limit'), 25)

  const { users, total } = await getAdminUsers(c.env.DB, { q, role, status, page, limit })
  return c.json({ users, total, page, limit })
})

// ─── GET /api/admin/users/:id ─────────────────────────────────────────────────

router.get('/users/:id', requireAdmin, requireCap('users.view'), async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  const user = await getAdminUserById(c.env.DB, id)
  if (!user) return c.json({ error: 'Not found' }, 404)

  return c.json(user)
})

// ─── PATCH /api/admin/users/:id ───────────────────────────────────────────────

router.patch('/users/:id', requireAdmin, requireCap('users.edit'), async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  let body: unknown
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { role, status } = body as Record<string, unknown>

  // The same capabilities as the dedicated /role and /status routes.
  const caps = c.get('adminCaps')
  const missing = [
    ...(role !== undefined && !caps.has('users.role') ? ['users.role'] : []),
    ...(status !== undefined && !caps.has('users.status') ? ['users.status'] : []),
  ]
  if (missing.length) return c.json({ error: NO_RIGHTS, code: 'forbidden', missing }, 403)

  const updates: { role?: string; status?: string } = {}

  if (role !== undefined) {
    if (typeof role !== 'string' || !ALLOWED_ROLES.has(role)) {
      return c.json({ error: `role must be one of: ${[...ALLOWED_ROLES].join(', ')}` }, 400)
    }
    updates.role = role
  }
  if (status !== undefined) {
    if (typeof status !== 'string' || !ALLOWED_STATUSES.has(status)) {
      return c.json({ error: `status must be one of: ${[...ALLOWED_STATUSES].join(', ')}` }, 400)
    }
    updates.status = status
  }

  if (!Object.keys(updates).length) {
    return c.json({ error: 'No valid fields to update' }, 400)
  }

  const existing = await getAdminUserById(c.env.DB, id)
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (updates.status && existing.status === 'deleted') return c.json(DELETED_FINAL, 409)

  await updateUserRoleAndStatus(c.env.DB, id, updates)

  // Log the admin action
  const adminId = c.get('adminId')
  if (updates.status && updates.status !== existing.status) {
    const action = updates.status === 'banned' ? 'banned' : 'unbanned'
    await insertUserActivity(c.env.DB, {
      user_id: id,
      action,
      metadata: { by_admin_id: adminId, previous_status: existing.status },
    })
  }
  if (updates.role && updates.role !== existing.role) {
    await insertUserActivity(c.env.DB, {
      user_id: id,
      action: 'role_changed',
      metadata: { by_admin_id: adminId, from_role: existing.role, to_role: updates.role },
    })
  }

  const updated = await getAdminUserById(c.env.DB, id)
  return c.json(updated)
})

// ─── PATCH /api/admin/users/:id/role ─────────────────────────────────────────

router.patch('/users/:id/role', requireAdmin, requireCap('users.role'), async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  let body: unknown
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { role } = body as Record<string, unknown>
  if (typeof role !== 'string' || !ALLOWED_ROLES.has(role)) {
    return c.json({ error: `role must be one of: ${[...ALLOWED_ROLES].join(', ')}` }, 400)
  }

  const existing = await getAdminUserById(c.env.DB, id)
  if (!existing) return c.json({ error: 'Not found' }, 404)

  if (role === 'owner') {
    // Find existing owner and demote to 'user' first
    const owners = await getUsersWithRole(c.env.DB, 'owner')
    for (const owner of owners) {
      if (owner.id !== id) {
        await setUserRole(c.env.DB, owner.id, 'user')
        const adminId = c.get('adminId')
        await insertUserActivity(c.env.DB, {
          user_id: owner.id,
          action: 'role_changed',
          metadata: { by_admin_id: adminId, from_role: 'owner', to_role: 'user', reason: 'owner_transfer' },
        })
      }
    }
  }

  await setUserRole(c.env.DB, id, role)

  const adminId = c.get('adminId')
  if (role !== existing.role) {
    await insertUserActivity(c.env.DB, {
      user_id: id,
      action: 'role_changed',
      metadata: { by_admin_id: adminId, from_role: existing.role, to_role: role },
    })
  }

  return c.json({ ok: true, role })
})

// ─── PATCH /api/admin/users/:id/status ────────────────────────────────────────
// Explicit status-only endpoint (convenience wrapper over PATCH /users/:id)

router.patch('/users/:id/status', requireAdmin, requireCap('users.status'), async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  let body: unknown
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { status } = body as Record<string, unknown>
  if (typeof status !== 'string' || !ALLOWED_STATUSES.has(status)) {
    return c.json({ error: `status must be one of: ${[...ALLOWED_STATUSES].join(', ')}` }, 400)
  }

  const existing = await getAdminUserById(c.env.DB, id)
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.status === 'deleted') return c.json(DELETED_FINAL, 409)

  await updateUserRoleAndStatus(c.env.DB, id, { status })

  const adminId = c.get('adminId')
  if (status !== existing.status) {
    const action = status === 'banned' ? 'banned' : 'unbanned'
    await insertUserActivity(c.env.DB, {
      user_id: id,
      action,
      metadata: { by_admin_id: adminId, previous_status: existing.status },
    })
  }

  return c.json({ ok: true, status })
})

// ─── GET /api/admin/users/:id/orders ─────────────────────────────────────────

router.get('/users/:id/orders', requireAdmin, requireCap('users.view'), async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  const page = pageParam(c.req.query('page'))
  const { orders, total } = await getOrdersByUserId(c.env.DB, id, page, 25)
  return c.json({ orders, total, page, limit: 25 })
})

// ─── GET /api/admin/users/:id/activity ───────────────────────────────────────

router.get('/users/:id/activity', requireAdmin, requireCap('users.view'), async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  const page = pageParam(c.req.query('page'))
  const since = c.req.query('since') ?? undefined
  const { items, total } = await getUserActivity(c.env.DB, id, page, 100, since)
  return c.json({ items, total, page, limit: 100 })
})

// ─── POST /api/admin/notifications ───────────────────────────────────────────

function isButtonUrl(u: string): boolean {
  if (u.length > 500 || !/^https:\/\/\S+$/i.test(u)) return false
  try { return new URL(u).protocol === 'https:' } catch { return false }
}

router.post('/notifications', requireAdmin, requireCap('notifications.send'), async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { user_id, message, button_label, button_url, category } = body as Record<string, unknown>

  if (typeof user_id !== 'number' && typeof user_id !== 'string') {
    return c.json({ error: 'Укажите ID клиента' }, 400)
  }
  if (typeof message !== 'string' || !message.trim()) {
    return c.json({ error: 'Введите текст сообщения' }, 400)
  }
  if (message.length > 4096) {
    return c.json({ error: 'Сообщение — до 4096 символов' }, 400)
  }
  if (button_label != null && typeof button_label !== 'string') {
    return c.json({ error: 'Текст кнопки должен быть строкой' }, 400)
  }
  if (button_url != null && (typeof button_url !== 'string' || (button_url.trim() !== '' && !isButtonUrl(button_url.trim())))) {
    return c.json({ error: 'Ссылка кнопки должна начинаться с https:// (до 500 символов)', code: 'button_url' }, 400)
  }

  const userId = parseInt(String(user_id), 10)
  if (Number.isNaN(userId)) return c.json({ error: 'Некорректный ID клиента' }, 400)

  const user = await getAdminUserById(c.env.DB, userId)
  if (!user) return c.json({ error: 'Клиент не найден' }, 404)

  if (!user.telegram_user_id) {
    return c.json({ error: 'У клиента не привязан Telegram', code: 'no_telegram' }, 422)
  }

  // The customer's switches (0019) are the point of having them: refuse rather
  // than send. `order` is the default so anything the panel already sends —
  // which is order-related — keeps working unchanged.
  const kind = category === 'promo' ? 'promo' : 'order'
  const optedIn = kind === 'promo' ? (user.notify_promo ?? 1) : (user.notify_orders ?? 1)
  if (!optedIn) {
    return c.json(
      {
        error: kind === 'promo'
          ? 'Пользователь отключил рассылки об акциях'
          : 'Пользователь отключил уведомления о заказах',
        code: 'notifications_opted_out',
      },
      422,
    )
  }

  const botToken = c.env.TELEGRAM_BOT_TOKEN
  if (!botToken) return c.json({ error: 'Telegram-бот не настроен' }, 503)

  const adminId = c.get('adminId')
  let telegramMessageId: number | null = null
  let status = 'sent'
  let errorDetail: string | null = null

  try {
    // Plain text: the panel sends no markup, and with parse_mode HTML a "<"
    // in the message made Telegram refuse it.
    const payload: Record<string, unknown> = {
      chat_id: user.telegram_user_id,
      text: message,
    }
    if (typeof button_label === 'string' && button_label.trim() && typeof button_url === 'string' && button_url.trim()) {
      payload.reply_markup = {
        inline_keyboard: [[{ text: button_label.trim(), url: button_url.trim() }]],
      }
    }

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json() as { ok: boolean; result?: { message_id: number }; description?: string }

    if (data.ok) {
      telegramMessageId = data.result?.message_id ?? null
    } else {
      status = 'failed'
      errorDetail = data.description ?? 'Telegram API error'
    }
  } catch (err) {
    status = 'failed'
    errorDetail = err instanceof Error ? err.message : String(err)
  }

  const notifId = await insertNotification(c.env.DB, {
    user_id: userId,
    message: (message as string).trim(),
    button_label: typeof button_label === 'string' ? button_label.trim() : null,
    button_url: typeof button_url === 'string' ? button_url.trim() || null : null,
    telegram_message_id: telegramMessageId,
    sent_by_admin_id: adminId,
    status,
    error_detail: errorDetail,
  })

  // Log to user activity
  await insertUserActivity(c.env.DB, {
    user_id: userId,
    action: 'notified',
    metadata: { by_admin_id: adminId, status, notification_id: notifId },
  })

  if (status === 'failed') {
    return c.json({ ok: false, error: errorDetail, id: notifId }, 422)
  }

  return c.json({ ok: true, id: notifId, telegram_message_id: telegramMessageId })
})

// ─── PATCH /api/admin/users/:id/profile ──────────────────────────────────────

router.patch('/users/:id/profile', requireAdmin, requireCap('users.edit'), async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  let body: unknown
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { name, email, phone, first_name, last_name } = body as Record<string, unknown>

  const params: { name?: string | null; email?: string | null; phone?: string | null; first_name?: string | null; last_name?: string | null } = {}

  if ('name' in (body as object)) params.name = typeof name === 'string' ? name.trim() || null : null
  // email is NOT NULL: a blank or null value keeps the stored one.
  if (typeof email === 'string' && email.trim()) {
    const e = email.trim()
    if (e.length > 254 || !EMAIL_RE.test(e)) return c.json({ error: 'Введите корректный email', code: 'email_invalid', field: 'email' }, 400)
    params.email = e
  }
  if ('phone' in (body as object)) {
    if (typeof phone === 'string' && phone.trim()) {
      const p = normalizeAdminPhone(phone)
      if (!p) return c.json({ error: 'Телефон в формате +998 90 123 45 67', code: 'phone_invalid', field: 'phone' }, 400)
      params.phone = p
    } else {
      params.phone = null
    }
  }
  if ('first_name' in (body as object)) params.first_name = typeof first_name === 'string' ? first_name.trim() || null : null
  if ('last_name' in (body as object)) params.last_name = typeof last_name === 'string' ? last_name.trim() || null : null

  if (!Object.keys(params).length) return c.json({ error: 'No valid fields' }, 400)

  const existing = await getAdminUserById(c.env.DB, id)
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const phoneChanged = 'phone' in params && params.phone !== existing.phone
  const emailChanged = 'email' in params && params.email !== existing.email
  if (phoneChanged && params.phone) {
    const other = await getUserByPhone(c.env.DB, params.phone)
    if (other && other.id !== id) return c.json({ error: 'Этот телефон уже используется', code: 'phone_taken', field: 'phone' }, 409)
  }
  if (emailChanged && params.email) {
    const other = await getUserByEmail(c.env.DB, params.email)
    if (other && other.id !== id) return c.json({ error: 'Этот email уже используется', code: 'email_taken', field: 'email' }, 409)
  }

  await updateUserProfile(c.env.DB, id, params)
  // A new phone or email changes how the account signs in: end its sessions.
  if (phoneChanged || emailChanged) await revokeUserTokens(c.env.DB, id)

  const adminId = c.get('adminId')
  await insertUserActivity(c.env.DB, {
    user_id: id,
    action: 'profile_updated',
    metadata: { by_admin_id: adminId, fields: Object.keys(params) },
  })

  const updated = await getAdminUserById(c.env.DB, id)
  return c.json(updated)
})

// ─── PATCH /api/admin/users/:id/location ─────────────────────────────────────

router.patch('/users/:id/location', requireAdmin, requireCap('users.edit'), async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  let body: unknown
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { location_preset } = body as Record<string, unknown>
  let preset: string | null
  if (location_preset === null || location_preset === undefined) {
    preset = null
  } else if (typeof location_preset === 'object') {
    preset = JSON.stringify(location_preset)
  } else if (typeof location_preset === 'string') {
    preset = location_preset.trim() || null
  } else {
    return c.json({ error: 'location_preset must be an object, string, or null' }, 400)
  }

  const existing = await getAdminUserById(c.env.DB, id)
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await updateUserProfile(c.env.DB, id, { location_preset: preset })

  const adminId = c.get('adminId')
  await insertUserActivity(c.env.DB, {
    user_id: id,
    action: 'location_updated',
    metadata: { by_admin_id: adminId, location_preset: preset },
  })

  return c.json({ ok: true, location_preset: preset })
})

// ─── PATCH /api/admin/users/:id/password ─────────────────────────────────────

// Trigger a Telegram self-reset for the user. The admin NEVER sees or sets a
// password — they only ask the user to reset it via the bot.
router.patch('/users/:id/password', requireAdmin, requireCap('users.password'), async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  const existing = await getAdminUserById(c.env.DB, id)
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!existing.telegram_user_id) {
    return c.json({ error: 'У пользователя не привязан Telegram — отправить сброс невозможно.', code: 'no_telegram' }, 422)
  }

  const botToken = c.env.TELEGRAM_BOT_TOKEN
  let sent = false
  let errorDetail: string | null = null
  if (botToken) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: existing.telegram_user_id,
          text: '🔐 LOOM: запрошен сброс пароля.\n\nОткройте loomdesign.uz → «Войти» → «Забыли пароль?», введите свой номер и подтвердите его в этом боте, затем задайте новый пароль.',
        }),
      })
      const data = (await res.json()) as { ok: boolean; description?: string }
      sent = !!data.ok
      if (!data.ok) errorDetail = data.description ?? 'Telegram error'
    } catch (err) {
      errorDetail = err instanceof Error ? err.message : String(err)
    }
  } else {
    errorDetail = 'bot not configured'
  }

  await insertUserActivity(c.env.DB, {
    user_id: id,
    action: 'password_reset_requested',
    metadata: { by_admin_id: c.get('adminId'), sent },
  })

  if (!sent) {
    return c.json({ error: 'Не удалось отправить сообщение в Telegram: ' + (errorDetail || ''), code: 'send_failed' }, 502)
  }
  return c.json({ ok: true, sent: true })
})

// ─── GET /api/admin/notifications ────────────────────────────────────────────

router.get('/notifications', requireAdmin, requireCap('notifications.view'), async (c) => {
  const page = pageParam(c.req.query('page'))
  const limit = limitParam(c.req.query('limit'), 25)
  const { items, total } = await getNotifications(c.env.DB, page, limit)
  return c.json({ items, total, page, limit })
})

export default router
