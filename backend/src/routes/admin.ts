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
  getArtworkSalesByOrder,
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
  listAllAdminPermissions,
  setAdminPermission,
  clearAdminPermission,
  clearAllAdminPermissions,
  revokeAdminTokens,
  finishScheduledDeletions,
} from '../db/queries'
import { hashPassword, verifyPassword } from '../lib/password'
import { funnelRange, getFunnelStats } from '../db/funnel'
import { Ga4Error, ga4Days, ga4Report } from '../lib/ga4'
import { clarityReadout } from '../lib/clarity'
import { signToken, verifyToken } from '../lib/jwt'
import { serveObject } from '../lib/r2'
import { notifyCustomer, orderUrl, PAY_BUTTON, PAY_MESSAGES, REJECT_REASONS, type RejectReason } from '../lib/prepay'
import { PAY_WINDOW_MS } from '../lib/pricing'
import { clientIp, tooManyFailures, recordFailure, TOO_MANY } from '../lib/rateLimit'
import { requireAdmin, requireRole, requireCap } from '../middleware/requireAdmin'
import {
  permissionCatalog,
  resolveCapabilities,
  isCapability,
  presetFor,
} from '../lib/permissions'
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

  // Failed attempts are counted per IP and per account; either one tripping
  // blocks further attempts for the window.
  const failKeys = [`admin-login:ip:${clientIp(c)}`, `admin-login:id:${email.toLowerCase()}`]
  if (await tooManyFailures(c.env.RATE_LIMIT, failKeys, 5)) return c.json(TOO_MANY, 429)

  const adminRow = await getAdminByEmail(c.env.DB, email.toLowerCase())
  if (adminRow?.password_hash === 'PLACEHOLDER_USE_SETUP_ENDPOINT') {
    return c.json({ error: 'Password not set. Use POST /api/admin/setup first.' }, 403)
  }

  const valid = !!adminRow && (await verifyPassword(password, adminRow.password_hash))
  if (!adminRow || !valid) {
    await recordFailure(c.env.RATE_LIMIT, failKeys, 15 * 60)
    return c.json({ error: 'Invalid credentials' }, 401)
  }

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

admin.post('/logout', async (c) => {
  // Revoke server-side too, so a copied token stops working with the cookie.
  const token = getCookie(c, 'admin_token')
  const payload = token ? await verifyToken(token, c.env.JWT_SECRET) : null
  if (payload?.role === 'admin') await revokeAdminTokens(c.env.DB, parseInt(payload.sub, 10))
  deleteCookie(c, 'admin_token', { path: '/' })
  return c.json({ ok: true })
})

// ─── GET /api/admin/me ────────────────────────────────────────────────────────

admin.get('/me', requireAdmin, async (c) => {
  const row = await getAdminById(c.env.DB, c.get('adminId'))
  if (!row) return c.json({ error: 'Not found' }, 404)
  // capabilities drives the whole admin UI: the sidebar hides pages the admin
  // cannot open, and [data-cap] controls are removed from the DOM entirely.
  return c.json({
    id: row.id,
    email: row.email,
    role: row.role || 'staff',
    capabilities: [...c.get('adminCaps')],
  })
})

// ─── Permission catalog ───────────────────────────────────────────────────────
// Labels, groupings and role presets, so the panel never hardcodes the list.

admin.get('/permissions/catalog', requireAdmin, (c) => c.json(permissionCatalog()))

// ─── Admin team management (OWNER only) ───────────────────────────────────────

// List all admin accounts — any admin can SEE the team roster (who is owner/
// manager/staff); only the owner can add/change/remove (gated below) and only
// the owner is shown the per-member capability detail.
admin.get('/admins', requireAdmin, async (c) => {
  const admins = await listAdmins(c.env.DB)
  if (c.get('adminRole') !== 'owner') return c.json({ admins })

  const overridesByAdmin = await listAllAdminPermissions(c.env.DB)
  return c.json({
    admins: admins.map((a) => {
      const overrides = overridesByAdmin[a.id] ?? {}
      return {
        ...a,
        overrides,
        preset: presetFor(a.role),
        capabilities: [...resolveCapabilities(a.role, overrides)],
      }
    }),
  })
})

// Replace an admin's capability overrides.
//   { overrides: { "orders.approve": false, "users.role": true, "ai.use": null } }
// true = grant on top of the preset, false = revoke from it, null = inherit.
admin.put('/admins/:id/permissions', requireAdmin, requireRole('owner'), async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  const { overrides } = body as Record<string, unknown>
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return c.json({ error: 'overrides должен быть объектом' }, 400)
  }

  const target = await getAdminById(c.env.DB, id)
  if (!target) return c.json({ error: 'Админ не найден' }, 404)
  // The owner always resolves to every capability, so storing overrides for one
  // would be a silent no-op that reads as a working toggle in the UI.
  if ((target.role || 'staff') === 'owner') {
    return c.json({ error: 'У владельца всегда полный доступ — права не настраиваются.' }, 400)
  }

  const entries = Object.entries(overrides as Record<string, unknown>)
  const unknown = entries.filter(([cap]) => !isCapability(cap)).map(([cap]) => cap)
  if (unknown.length) return c.json({ error: `Неизвестные права: ${unknown.join(', ')}` }, 400)

  for (const [cap, value] of entries) {
    if (value === null) {
      await clearAdminPermission(c.env.DB, id, cap)
    } else if (typeof value === 'boolean') {
      await setAdminPermission(c.env.DB, {
        adminId: id, capability: cap, granted: value, updatedBy: c.get('adminId'),
      })
    } else {
      return c.json({ error: `Значение для «${cap}» должно быть true, false или null` }, 400)
    }
  }

  const fresh = await listAllAdminPermissions(c.env.DB)
  const merged = fresh[id] ?? {}
  return c.json({
    ok: true,
    overrides: merged,
    capabilities: [...resolveCapabilities(target.role || 'staff', merged)],
  })
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
    // The new owner's old overrides no longer mean anything (owner = all), and
    // the outgoing owner starts from a clean manager preset.
    await clearAllAdminPermissions(c.env.DB, id)
    await clearAllAdminPermissions(c.env.DB, c.get('adminId'))
    return c.json({ ok: true, role, transferred: true })
  }

  // Prevent demoting the last owner (would lock everyone out of owner powers).
  if (target.role === 'owner') {
    const owners = await countAdminsByRole(c.env.DB, 'owner')
    if (owners <= 1) return c.json({ error: 'Нельзя снять роль с единственного владельца. Сначала назначьте другого.' }, 400)
  }
  await updateAdminRole(c.env.DB, id, role)
  // Overrides are deviations FROM a preset; carrying them onto a different
  // preset would silently grant or strip access the owner never chose.
  if (target.role !== role) await clearAllAdminPermissions(c.env.DB, id)
  const overrides = target.role !== role ? {} : await listAllAdminPermissions(c.env.DB).then((m) => m[id] ?? {})
  return c.json({ ok: true, role, capabilities: [...resolveCapabilities(role, overrides)] })
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

admin.get('/orders', requireAdmin, requireCap('orders.view'), async (c) => {
  const status = c.req.query('status') || undefined
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '50', 10)))
  const q = c.req.query('q') || undefined

  const { orders, total } = await getAdminOrders(c.env.DB, { status, page, limit, q })
  return c.json({ orders, total, page, limit })
})

// ─── GET /api/admin/orders/:id ────────────────────────────────────────────────

admin.get('/orders/:id', requireAdmin, requireCap('orders.view'), async (c) => {
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
  // Card-transfer payment (PRD-216): the receipt image and who checked it.
  const payChecker = order.pay_checked_by ? await getAdminById(c.env.DB, order.pay_checked_by) : null
  const payment = {
    receiptUrl: mediaUrl(order.receipt_key),
    checkedBy: payChecker ? { id: payChecker.id, email: payChecker.email } : null,
    canCheck: c.get('adminCaps').has('orders.approve'),
  }

  // Marketplace artwork on this order and the designer credited for it — the
  // print shop needs to know the file is a designer's, finance needs the share.
  const designerSales = await getArtworkSalesByOrder(c.env.DB, id)

  return c.json({ ...order, statusLog, ...proofUrls(order as unknown as Record<string, unknown>), approvedBy, payment, items, designerSales })
})

// ─── POST /api/admin/orders/:id/approve  (owner/manager) ──────────────────────
// Mark / unmark the production proof as approved. Approval gates status → producing.

admin.post('/orders/:id/approve', requireAdmin, requireCap('orders.approve'), async (c) => {
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

// ─── POST /api/admin/orders/:id/payment  (owner/manager) ──────────────────────
// Staff answer to a card-transfer receipt: { action: 'confirm' } or
// { action: 'reject', reason: 'not_found' | 'amount_mismatch' }.
// A person looking at the bank statement is the only way to 'paid'.
// Both are one conditional UPDATE on payment_status = 'pending', so a double
// click or two admins at once change the order once; the repeat of an action
// that already happened answers 200 { already: true } and sends no message.

admin.post('/orders/:id/payment', requireAdmin, requireCap('orders.approve'), async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)
  let body: Record<string, unknown>
  try { body = (await c.req.json()) as Record<string, unknown> } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  const action = body.action
  if (action !== 'confirm' && action !== 'reject') return c.json({ error: "action must be 'confirm' or 'reject'" }, 400)
  const reason = body.reason as RejectReason
  if (action === 'reject' && !REJECT_REASONS.includes(reason)) {
    return c.json({ error: `reason must be one of: ${REJECT_REASONS.join(', ')}`, code: 'reject_reason_required' }, 400)
  }

  const order = await getOrderById(c.env.DB, id)
  if (!order) return c.json({ error: 'Not found' }, 404)
  const now = Date.now()
  const adminId = c.get('adminId')
  const PENDING = "id = ? AND payment_method = 'p2p' AND payment_status = 'pending' AND status = 'new'"

  if (action === 'confirm') {
    const [update] = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE orders SET payment_status = 'paid', paid_at = ?1, status = 'confirmed', pay_checked_by = ?2,
           pay_checked_at = ?1, pay_reject_reason = NULL, updated_at = ?1 WHERE ${PENDING.replace('?', '?3')}`,
      ).bind(now, adminId, id),
      c.env.DB.prepare(
        `INSERT INTO order_status_log (order_id, old_status, new_status, changed_by, changed_at, note)
         SELECT ?, 'new', 'confirmed', ?, ?, 'payment_confirmed' WHERE changes() > 0`,
      ).bind(id, adminId, now),
    ])
    if (!update.meta.changes) {
      const cur = await getOrderById(c.env.DB, id)
      if (cur?.payment_method === 'p2p' && cur.payment_status === 'paid') return c.json({ ok: true, already: true, payment_status: 'paid', status: cur.status })
      return c.json({ error: 'Этот заказ не ждёт проверки оплаты.', code: 'payment_not_pending' }, 409)
    }
    if (order.user_id) c.executionCtx.waitUntil(notifyCustomer(c.env, order.user_id, PAY_MESSAGES.confirmed(id), null, adminId))
    return c.json({ ok: true, payment_status: 'paid', status: 'confirmed' })
  }

  // Reject: the customer gets a fresh window to send a correct receipt. The
  // rejected image is removed; it is personal financial data with no further use.
  const r = await c.env.DB.prepare(
    `UPDATE orders SET payment_status = 'failed', pay_reject_reason = ?1, pay_checked_by = ?2, pay_checked_at = ?3,
       receipt_key = NULL, receipt_at = NULL, pay_deadline = ?4, pay_reminded_at = NULL, updated_at = ?3
     WHERE ${PENDING.replace('?', '?5')}`,
  ).bind(reason, adminId, now, now + PAY_WINDOW_MS, id).run()
  if (!r.meta.changes) {
    const cur = await getOrderById(c.env.DB, id)
    if (cur?.payment_method === 'p2p' && cur.payment_status === 'failed') return c.json({ ok: true, already: true, payment_status: 'failed', status: cur.status })
    return c.json({ error: 'Этот заказ не ждёт проверки оплаты.', code: 'payment_not_pending' }, 409)
  }
  if (order.receipt_key) c.executionCtx.waitUntil(c.env.LOOM_UPLOADS.delete(order.receipt_key))
  if (order.user_id) {
    c.executionCtx.waitUntil(notifyCustomer(c.env, order.user_id, PAY_MESSAGES.rejected(id, reason),
      { label: PAY_BUTTON, url: orderUrl(id) }, adminId))
  }
  return c.json({ ok: true, payment_status: 'failed', status: 'new' })
})

// ─── PATCH /api/admin/orders/:id/status ──────────────────────────────────────

admin.patch('/orders/:id/status', requireAdmin, requireCap('orders.status'), async (c) => {
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

  // Prepayment gate (PRD-216): nothing is made or sent before staff confirmed
  // the money. Old cash-on-delivery orders are paid on delivery and are exempt.
  // 'confirmed' is gated too: only the payment confirm sets it for these orders.
  if ((status === 'confirmed' || GATED_STATUSES.includes(status)) && order.payment_method === 'p2p' && order.payment_status !== 'paid') {
    return c.json(
      { error: 'Оплата не подтверждена. Сначала подтвердите оплату в блоке «Оплата».', code: 'payment_not_confirmed' },
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
      }).then(async () => {
        // A deletion the customer asked for while this order was open runs once
        // their last open order is closed, after the message above went out.
        if (status === 'delivered' || status === 'cancelled') await finishScheduledDeletions(c.env.DB, order.user_id!)
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

admin.get('/media/:key{.+}', requireAdmin, requireCap('orders.view'), async (c) => {
  const key = c.req.param('key')
  const object = await c.env.LOOM_UPLOADS.get(key)
  if (!object) return c.json({ error: 'Not found' }, 404)
  return serveObject(object, key, 'private, max-age=3600')
})

// ─── Refresh admin cookie (extend session) ────────────────────────────────────

// requireAdmin first: a revoked or deleted admin must not mint a fresh token.
admin.post('/refresh', requireAdmin, async (c) => {
  const newToken = await signToken(
    { sub: String(c.get('adminId')), role: 'admin' },
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

admin.get('/analytics/visitors', requireAdmin, requireCap('analytics.view'), async (c) => {
  const stats = await getVisitorStats(c.env.DB)
  return c.json(stats)
})

admin.get('/analytics/funnel', requireAdmin, requireCap('analytics.view'), async (c) => {
  c.header('Cache-Control', 'no-store')
  const range = funnelRange(c.req.query('from'), c.req.query('to'))
  if (!range) return c.json({ error: 'Choose valid UTC dates, up to 366 days.', code: 'funnel_range' }, 400)
  return c.json(await getFunnelStats(c.env.DB, range))
})

// GA4 Data API readout (lib/ga4.ts). Google failures are 502 with a stable
// code, never 401/403, so the admin client does not read them as a lost session.
admin.get('/analytics/ga4', requireAdmin, requireCap('analytics.view'), async (c) => {
  c.header('Cache-Control', 'no-store')
  const days = ga4Days(c.req.query('days'))
  if (!days) return c.json({ error: 'days must be 7 or 28.', code: 'ga4_days' }, 400)
  try {
    return c.json(await ga4Report(c.env, days, c.req.url))
  } catch (error) {
    if (!(error instanceof Ga4Error)) console.error('ga4', error)
    const known = error instanceof Ga4Error ? error : new Ga4Error('ga4_request_failed')
    return c.json({ configured: true, error: 'GA4 request failed.', code: known.code, lastFetchedAt: known.lastFetchedAt }, 502)
  }
})

// Clarity readout from the daily D1 snapshots (lib/clarity.ts). Never calls
// Clarity: its quota is 10 requests a day and the cron spends 4.
admin.get('/analytics/clarity', requireAdmin, requireCap('analytics.view'), async (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json(await clarityReadout(c.env))
})

export { setupRouter }
export default admin
