import { Hono } from 'hono'
import {
  getAdminUsers,
  getAdminUserById,
  updateUserRoleAndStatus,
  updateUserProfile,
  updateUserPassword,
  getOrdersByUserId,
  getUserActivity,
  insertUserActivity,
  insertNotification,
  getNotifications,
  getAdminStatsExtended,
  getUsersWithRole,
  setUserRole,
} from '../db/queries'
import { hashPassword } from '../lib/password'
import { requireAdmin } from '../middleware/requireAdmin'
import type { AdminEnv } from '../types'

const router = new Hono<AdminEnv>()

const ALLOWED_ROLES = new Set(['user', 'admin', 'super_admin', 'owner'])
const ALLOWED_STATUSES = new Set(['active', 'banned'])

// ─── GET /api/admin/stats (extended) ─────────────────────────────────────────

router.get('/stats', requireAdmin, async (c) => {
  const stats = await getAdminStatsExtended(c.env.DB)
  return c.json(stats)
})

// ─── GET /api/admin/users ─────────────────────────────────────────────────────

router.get('/users', requireAdmin, async (c) => {
  const q = c.req.query('q') || undefined
  const role = c.req.query('role') || undefined
  const status = c.req.query('status') || undefined
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '25', 10)))

  const { users, total } = await getAdminUsers(c.env.DB, { q, role, status, page, limit })
  return c.json({ users, total, page, limit })
})

// ─── GET /api/admin/users/:id ─────────────────────────────────────────────────

router.get('/users/:id', requireAdmin, async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  const user = await getAdminUserById(c.env.DB, id)
  if (!user) return c.json({ error: 'Not found' }, 404)

  return c.json(user)
})

// ─── PATCH /api/admin/users/:id ───────────────────────────────────────────────

router.patch('/users/:id', requireAdmin, async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  let body: unknown
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { role, status } = body as Record<string, unknown>

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

router.patch('/users/:id/role', requireAdmin, async (c) => {
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

router.patch('/users/:id/status', requireAdmin, async (c) => {
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

router.get('/users/:id/orders', requireAdmin, async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10))
  const { orders, total } = await getOrdersByUserId(c.env.DB, id, page, 25)
  return c.json({ orders, total, page, limit: 25 })
})

// ─── GET /api/admin/users/:id/activity ───────────────────────────────────────

router.get('/users/:id/activity', requireAdmin, async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10))
  const { items, total } = await getUserActivity(c.env.DB, id, page, 25)
  return c.json({ items, total, page, limit: 25 })
})

// ─── POST /api/admin/notifications ───────────────────────────────────────────

router.post('/notifications', requireAdmin, async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { user_id, message, button_label, button_url } = body as Record<string, unknown>

  if (typeof user_id !== 'number' && typeof user_id !== 'string') {
    return c.json({ error: 'user_id is required' }, 400)
  }
  if (typeof message !== 'string' || !message.trim()) {
    return c.json({ error: 'message is required' }, 400)
  }
  if (message.length > 4096) {
    return c.json({ error: 'message must be ≤ 4096 characters' }, 400)
  }
  if (button_label !== undefined && typeof button_label !== 'string') {
    return c.json({ error: 'button_label must be a string' }, 400)
  }
  if (button_url !== undefined && typeof button_url !== 'string') {
    return c.json({ error: 'button_url must be a string' }, 400)
  }

  const userId = parseInt(String(user_id), 10)
  if (Number.isNaN(userId)) return c.json({ error: 'Invalid user_id' }, 400)

  const user = await getAdminUserById(c.env.DB, userId)
  if (!user) return c.json({ error: 'User not found' }, 404)

  if (!user.telegram_user_id) {
    return c.json({ error: 'User has no Telegram account linked' }, 422)
  }

  const botToken = c.env.TELEGRAM_BOT_TOKEN
  if (!botToken) return c.json({ error: 'Bot not configured' }, 503)

  const adminId = c.get('adminId')
  let telegramMessageId: number | null = null
  let status = 'sent'
  let errorDetail: string | null = null

  try {
    const payload: Record<string, unknown> = {
      chat_id: user.telegram_user_id,
      text: message,
      parse_mode: 'HTML',
    }
    if (button_label && button_url) {
      payload.reply_markup = {
        inline_keyboard: [[{ text: button_label, url: button_url }]],
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
    button_url: typeof button_url === 'string' ? button_url.trim() : null,
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

router.patch('/users/:id/profile', requireAdmin, async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  let body: unknown
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { name, email, phone, first_name, last_name } = body as Record<string, unknown>

  const params: { name?: string | null; email?: string | null; phone?: string | null; first_name?: string | null; last_name?: string | null } = {}

  if ('name' in (body as object)) params.name = typeof name === 'string' ? name.trim() || null : null
  if ('email' in (body as object)) params.email = typeof email === 'string' ? email.trim() || null : null
  if ('phone' in (body as object)) params.phone = typeof phone === 'string' ? phone.trim() || null : null
  if ('first_name' in (body as object)) params.first_name = typeof first_name === 'string' ? first_name.trim() || null : null
  if ('last_name' in (body as object)) params.last_name = typeof last_name === 'string' ? last_name.trim() || null : null

  if (!Object.keys(params).length) return c.json({ error: 'No valid fields' }, 400)

  const existing = await getAdminUserById(c.env.DB, id)
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await updateUserProfile(c.env.DB, id, params)

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

router.patch('/users/:id/location', requireAdmin, async (c) => {
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

router.patch('/users/:id/password', requireAdmin, async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  let body: unknown
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { password } = body as Record<string, unknown>
  if (typeof password !== 'string' || password.length < 6) {
    return c.json({ error: 'password must be at least 6 characters' }, 400)
  }

  const existing = await getAdminUserById(c.env.DB, id)
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const hashed = await hashPassword(password)
  await updateUserPassword(c.env.DB, id, hashed)

  const adminId = c.get('adminId')
  await insertUserActivity(c.env.DB, {
    user_id: id,
    action: 'password_reset',
    metadata: { by_admin_id: adminId },
  })

  return c.json({ ok: true })
})

// ─── GET /api/admin/notifications ────────────────────────────────────────────

router.get('/notifications', requireAdmin, async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '25', 10)))
  const { items, total } = await getNotifications(c.env.DB, page, limit)
  return c.json({ items, total, page, limit })
})

export default router
