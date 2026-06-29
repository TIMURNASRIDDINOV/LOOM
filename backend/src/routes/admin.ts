import { Hono } from 'hono'
import { setCookie, deleteCookie, getCookie } from 'hono/cookie'
import {
  getAdminByEmail,
  getAdminById,
  countAdmins,
  createAdmin,
  updateAdminPassword,
  getAdminOrders,
  getOrderById,
  getOrderStatusLog,
  getOrderItemsByOrderId,
  updateOrderStatus,
  setOrderProofApproval,
  insertOrderStatusLog,
  getVisitorStats,
  getUserById,
  insertNotification,
  listAdmins,
  updateAdminRole,
  deleteAdmin,
  countAdminsByRole,
} from '../db/queries'
import { hashPassword, verifyPassword } from '../lib/password'
import { signToken, verifyToken } from '../lib/jwt'
import { requireAdmin, requireRole } from '../middleware/requireAdmin'
import { ORDER_STATUSES, ADMIN_ROLES } from '../db/schema'
import type { AdminEnv, BaseEnv, Bindings } from '../types'

const COOKIE_MAX_AGE = 12 * 60 * 60 // 12 hours in seconds

const admin = new Hono<AdminEnv>()

// ─── POST /api/admin/setup ────────────────────────────────────────────────────
// One-time endpoint to set the first admin's password.
// Only works when the admins table has rows with placeholder passwords.

const setupRouter = new Hono<BaseEnv>()
setupRouter.post('/setup', async (c) => {
  const adminCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM admins'
  ).first<{ count: number }>();

  if (adminCount && adminCount.count > 0) {
    return c.json({ error: 'Setup already completed' }, 403);
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { email, password } = body as Record<string, unknown>
  if (typeof email !== 'string' || typeof password !== 'string') {
    return c.json({ error: 'email and password required' }, 400)
  }
  if (password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400)
  }

  const normalizedEmail = email.toLowerCase()
  const total = await countAdmins(c.env.DB)

  if (total === 0) {
    // No admins at all — allow creating the first one
    const hash = await hashPassword(password)
    await createAdmin(c.env.DB, { email: normalizedEmail, password_hash: hash, role: 'owner' })
    return c.json({ ok: true, created: true })
  }

  // Admins exist — only allow setup if this specific email has a placeholder password.
  // If any admin already has a real password, the endpoint is permanently locked.
  const existing = await getAdminByEmail(c.env.DB, normalizedEmail)
  if (!existing || existing.password_hash !== 'PLACEHOLDER_USE_SETUP_ENDPOINT') {
    return c.json({ error: 'Setup already completed' }, 403)
  }

  const hash = await hashPassword(password)
  await updateAdminPassword(c.env.DB, normalizedEmail, hash)
  return c.json({ ok: true })
})

// ─── POST /api/admin/login ────────────────────────────────────────────────────

admin.post('/login', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { email, password } = body as Record<string, unknown>
  if (typeof email !== 'string' || typeof password !== 'string') {
    return c.json({ error: 'email and password required' }, 400)
  }

  const adminRow = await getAdminByEmail(c.env.DB, email.toLowerCase())
  if (!adminRow) return c.json({ error: 'Invalid credentials' }, 401)

  if (adminRow.password_hash === 'PLACEHOLDER_USE_SETUP_ENDPOINT') {
    return c.json({ error: 'Password not set. Use POST /api/admin/setup first.' }, 403)
  }

  const valid = await verifyPassword(password, adminRow.password_hash)
  if (!valid) return c.json({ error: 'Invalid credentials' }, 401)

  const token = await signToken(
    { sub: String(adminRow.id), role: 'admin' },
    c.env.JWT_SECRET,
    '12h',
  )

  setCookie(c, 'admin_token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  })

  return c.json({ ok: true })
})

// ─── POST /api/admin/logout ───────────────────────────────────────────────────

admin.post('/logout', (c) => {
  deleteCookie(c, 'admin_token', { path: '/' })
  return c.json({ ok: true })
})

// ─── GET /api/admin/me ────────────────────────────────────────────────────────

admin.get('/me', requireAdmin, async (c) => {
  const row = await getAdminById(c.env.DB, c.get('adminId'))
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ id: row.id, email: row.email, role: row.role || 'staff' })
})

// ─── Admin team management (OWNER only) ───────────────────────────────────────

// List all admin accounts — any admin can SEE the team roster (who is owner/
// manager/staff); only the owner can add/change/remove (gated below).
admin.get('/admins', requireAdmin, async (c) => {
  const admins = await listAdmins(c.env.DB)
  return c.json({ admins })
})

// Create a new admin account with a role.
admin.post('/admins', requireAdmin, requireRole('owner'), async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  const { email, password, role } = body as Record<string, unknown>
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: 'Введите корректный email' }, 400)
  }
  if (typeof password !== 'string' || password.length < 8) {
    return c.json({ error: 'Пароль должен содержать минимум 8 символов' }, 400)
  }
  const r = typeof role === 'string' && (ADMIN_ROLES as readonly string[]).includes(role) ? role : 'staff'
  if (r === 'owner') return c.json({ error: 'Нельзя создать второго владельца. Сначала передайте роль.' }, 400)
  const existing = await getAdminByEmail(c.env.DB, email.toLowerCase())
  if (existing) return c.json({ error: 'Админ с таким email уже существует' }, 409)
  const hash = await hashPassword(password)
  const id = await createAdmin(c.env.DB, { email: email.toLowerCase(), password_hash: hash, role: r })
  return c.json({ ok: true, id, role: r })
})

// Change an admin's role.
admin.patch('/admins/:id/role', requireAdmin, requireRole('owner'), async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  const { role } = body as Record<string, unknown>
  if (typeof role !== 'string' || !(ADMIN_ROLES as readonly string[]).includes(role)) {
    return c.json({ error: 'Недопустимая роль' }, 400)
  }
  const target = await getAdminById(c.env.DB, id)
  if (!target) return c.json({ error: 'Админ не найден' }, 404)

  // Transfer of ownership: demote the current owner so there is exactly one.
  if (role === 'owner') {
    if (id === c.get('adminId')) return c.json({ ok: true, role }) // already owner
    await updateAdminRole(c.env.DB, c.get('adminId'), 'manager')
    await updateAdminRole(c.env.DB, id, 'owner')
    return c.json({ ok: true, role, transferred: true })
  }

  // Prevent demoting the last owner (would lock everyone out of owner powers).
  if (target.role === 'owner') {
    const owners = await countAdminsByRole(c.env.DB, 'owner')
    if (owners <= 1) return c.json({ error: 'Нельзя снять роль с единственного владельца. Сначала назначьте другого.' }, 400)
  }
  await updateAdminRole(c.env.DB, id, role)
  return c.json({ ok: true, role })
})

// Delete an admin account.
admin.delete('/admins/:id', requireAdmin, requireRole('owner'), async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)
  if (id === c.get('adminId')) return c.json({ error: 'Нельзя удалить свой аккаунт' }, 400)
  const target = await getAdminById(c.env.DB, id)
  if (!target) return c.json({ error: 'Админ не найден' }, 404)
  if (target.role === 'owner') return c.json({ error: 'Нельзя удалить владельца' }, 400)
  await deleteAdmin(c.env.DB, id)
  return c.json({ ok: true })
})

// ─── GET /api/admin/orders ────────────────────────────────────────────────────

admin.get('/orders', requireAdmin, async (c) => {
  const status = c.req.query('status') || undefined
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '50', 10)))
  const q = c.req.query('q') || undefined

  const { orders, total } = await getAdminOrders(c.env.DB, { status, page, limit, q })
  return c.json({ orders, total, page, limit })
})

// ─── GET /api/admin/orders/:id ────────────────────────────────────────────────

admin.get('/orders/:id', requireAdmin, async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  const order = await getOrderById(c.env.DB, id)
  if (!order) return c.json({ error: 'Not found' }, 404)

  const statusLog = await getOrderStatusLog(c.env.DB, id)

  // Build admin media URLs (served by the worker, requires the admin cookie).
  const mediaUrl = (key: unknown) => (typeof key === 'string' && key ? `/api/admin/media/${key}` : null)
  const proofUrls = (row: Record<string, unknown>) => ({
    logoUrl: mediaUrl(row.logo_key),
    backLogoUrl: mediaUrl(row.back_logo_key),
    frontPrintUrl: mediaUrl(row.front_print_key),
    backPrintUrl: mediaUrl(row.back_print_key),
    frontMockupUrl: mediaUrl(row.front_mockup_key),
    backMockupUrl: mediaUrl(row.back_mockup_key),
    modelUrl: mediaUrl(row.model_key),
  })

  // Multi-item orders (cart checkout): attach line items with per-item media URLs
  const rawItems = await getOrderItemsByOrderId(c.env.DB, id)
  const items = rawItems.map((it) => ({ ...it, ...proofUrls(it) }))

  // Surface who approved the production proof (admin id → email).
  let approvedBy: { id: number; email: string } | null = null
  if (order.proof_approved_by) {
    const a = await getAdminById(c.env.DB, order.proof_approved_by)
    if (a) approvedBy = { id: a.id, email: a.email }
  }

  return c.json({ ...order, statusLog, ...proofUrls(order as unknown as Record<string, unknown>), approvedBy, items })
})

// ─── POST /api/admin/orders/:id/approve  (owner/manager) ──────────────────────
// Mark / unmark the production proof as approved. Approval gates status → producing.

admin.post('/orders/:id/approve', requireAdmin, requireRole('owner', 'manager'), async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  const order = await getOrderById(c.env.DB, id)
  if (!order) return c.json({ error: 'Not found' }, 404)

  let approved = true
  try {
    const body = (await c.req.json()) as Record<string, unknown>
    if (typeof body.approved === 'boolean') approved = body.approved
  } catch { /* default: approve */ }

  await setOrderProofApproval(c.env.DB, id, approved ? c.get('adminId') : null)

  let approvedBy: { id: number; email: string } | null = null
  if (approved) {
    const a = await getAdminById(c.env.DB, c.get('adminId'))
    if (a) approvedBy = { id: a.id, email: a.email }
  }
  return c.json({ ok: true, approved, approvedAt: approved ? Date.now() : null, approvedBy })
})

// ─── PATCH /api/admin/orders/:id/status ──────────────────────────────────────

admin.patch('/orders/:id/status', requireAdmin, async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { status, note } = body as Record<string, unknown>
  if (typeof status !== 'string' || !(ORDER_STATUSES as readonly string[]).includes(status)) {
    return c.json(
      { error: `status must be one of: ${ORDER_STATUSES.join(', ')}` },
      400,
    )
  }

  const order = await getOrderById(c.env.DB, id)
  if (!order) return c.json({ error: 'Not found' }, 404)

  // Production gate: the design proof must be approved before an order can advance
  // to production or beyond. Approving is an owner/manager action (see /approve).
  const GATED_STATUSES = ['producing', 'shipped', 'delivered']
  if (GATED_STATUSES.includes(status) && !order.proof_approved_at) {
    return c.json(
      { error: 'Сначала подтвердите макет («Макет проверен»), затем переводите заказ в производство.', code: 'proof_not_approved' },
      409,
    )
  }

  await updateOrderStatus(c.env.DB, id, status)
  await insertOrderStatusLog(c.env.DB, {
    order_id: id,
    old_status: order.status,
    new_status: status,
    changed_by: c.get('adminId'),
    note: typeof note === 'string' ? note.trim() : null,
  })

  // Auto-notify the customer when the status actually changed:
  // Telegram push (if linked) + an in-site notification (account → Уведомления).
  if (order.user_id && status !== order.status) {
    c.executionCtx.waitUntil(
      notifyOrderStatus(c.env, {
        orderId: id,
        userId: order.user_id,
        status: status as string,
        note: typeof note === 'string' ? note.trim() : null,
        adminId: c.get('adminId'),
      }),
    )
  }

  return c.json({ ok: true })
})

// ─── Order-status customer notification ──────────────────────────────────────

const ORDER_STATUS_MESSAGES: Record<string, string> = {
  new:       '🆕 Ваш заказ LOOM #%N принят.',
  confirmed: '✅ Ваш заказ LOOM #%N подтверждён — мы приступаем к работе.',
  producing: '🧵 Ваш заказ LOOM #%N в производстве.',
  shipped:   '🚚 Ваш заказ LOOM #%N отправлен — скоро будет у вас!',
  delivered: '📦 Ваш заказ LOOM #%N доставлен. Спасибо за покупку! 🖤',
  cancelled: '❌ Ваш заказ LOOM #%N отменён. По вопросам свяжитесь с нами.',
}

async function notifyOrderStatus(
  env: Bindings,
  p: { orderId: number; userId: number; status: string; note: string | null; adminId: number },
): Promise<void> {
  try {
    const base = (ORDER_STATUS_MESSAGES[p.status] || 'ℹ️ Статус вашего заказа LOOM #%N обновлён.')
      .replace('%N', String(p.orderId))
    const text = p.note ? `${base}\n\n💬 ${p.note}` : base

    const user = await getUserById(env.DB, p.userId)

    let telegramMessageId: number | null = null
    let sendStatus = 'sent'
    let errorDetail: string | null = null

    const botToken = env.TELEGRAM_BOT_TOKEN
    if (user?.telegram_user_id && botToken) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: user.telegram_user_id, text }),
        })
        const data = (await res.json()) as { ok: boolean; result?: { message_id: number }; description?: string }
        if (data.ok) telegramMessageId = data.result?.message_id ?? null
        else { sendStatus = 'failed'; errorDetail = data.description ?? 'Telegram API error' }
      } catch (err) {
        sendStatus = 'failed'
        errorDetail = err instanceof Error ? err.message : String(err)
      }
    } else {
      // No Telegram link — still record the in-site notification
      sendStatus = user?.telegram_user_id ? 'failed' : 'no_telegram'
    }

    // Always store an in-site notification so it shows in the account panel
    await insertNotification(env.DB, {
      user_id: p.userId,
      message: text,
      button_label: null,
      button_url: null,
      telegram_message_id: telegramMessageId,
      sent_by_admin_id: p.adminId,
      status: sendStatus,
      error_detail: errorDetail,
    })
  } catch (err) {
    console.error('[notifyOrderStatus] failed:', err)
  }
}

// ─── GET /api/admin/media/:key  (serve R2 logo to admin panel) ───────────────
// The admin panel fetches this with credentials: 'include' and creates a blob URL.

admin.get('/media/:key{.+}', requireAdmin, async (c) => {
  const key = c.req.param('key')
  const object = await c.env.LOOM_UPLOADS.get(key)
  if (!object) return c.json({ error: 'Not found' }, 404)

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('cache-control', 'private, max-age=3600')

  return new Response(object.body, { headers })
})

// ─── Refresh admin cookie (extend session) ────────────────────────────────────

admin.post('/refresh', async (c) => {
  const token = getCookie(c, 'admin_token')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)

  const payload = await verifyToken(token, c.env.JWT_SECRET)
  if (!payload || payload.role !== 'admin') return c.json({ error: 'Unauthorized' }, 401)

  const newToken = await signToken(
    { sub: payload.sub, role: 'admin' },
    c.env.JWT_SECRET,
    '12h',
  )

  setCookie(c, 'admin_token', newToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  })

  return c.json({ ok: true })
})

// ─── GET /api/admin/analytics/visitors ───────────────────────────────────────

admin.get('/analytics/visitors', requireAdmin, async (c) => {
  const stats = await getVisitorStats(c.env.DB)
  return c.json(stats)
})

export { setupRouter }
export default admin
