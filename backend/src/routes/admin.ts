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
  updateOrderStatus,
  insertOrderStatusLog,
  getVisitorStats,
} from '../db/queries'
import { hashPassword, verifyPassword } from '../lib/password'
import { signToken, verifyToken } from '../lib/jwt'
import { requireAdmin } from '../middleware/requireAdmin'
import { ORDER_STATUSES } from '../db/schema'
import type { AdminEnv, BaseEnv } from '../types'

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
    await createAdmin(c.env.DB, { email: normalizedEmail, password_hash: hash })
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
  return c.json({ id: row.id, email: row.email })
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

  // Build logo URL for admin media route (served by worker, requires admin cookie)
  const logoUrl = order.logo_key ? `/api/admin/media/${order.logo_key}` : null

  return c.json({ ...order, statusLog, logoUrl })
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

  await updateOrderStatus(c.env.DB, id, status)
  await insertOrderStatusLog(c.env.DB, {
    order_id: id,
    old_status: order.status,
    new_status: status,
    changed_by: c.get('adminId'),
    note: typeof note === 'string' ? note.trim() : null,
  })

  return c.json({ ok: true })
})

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
