import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import { verifyToken } from '../lib/jwt'
import { getAdminById } from '../db/queries'
import type { AdminEnv } from '../types'

// Verifies the admin_token cookie AND loads the admin's current role from the
// DB (so role changes take effect immediately, and a deleted admin is locked
// out at once). Sets adminId + adminRole on the context.
export const requireAdmin = createMiddleware<AdminEnv>(async (c, next) => {
  const token = getCookie(c, 'admin_token')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)

  const payload = await verifyToken(token, c.env.JWT_SECRET)
  if (!payload || payload.role !== 'admin') return c.json({ error: 'Unauthorized' }, 401)

  const admin = await getAdminById(c.env.DB, parseInt(payload.sub, 10))
  if (!admin) return c.json({ error: 'Unauthorized' }, 401)

  c.set('adminId', admin.id)
  c.set('adminRole', admin.role || 'staff')
  await next()
})

// Gate a route to one of the given admin roles. Use AFTER requireAdmin:
//   admin.post('/x', requireAdmin, requireRole('owner'), handler)
export function requireRole(...allowed: string[]) {
  return createMiddleware<AdminEnv>(async (c, next) => {
    if (!allowed.includes(c.get('adminRole'))) {
      return c.json({ error: 'Недостаточно прав для этого действия.', code: 'forbidden' }, 403)
    }
    await next()
  })
}

// Role rank (higher = more power) for comparisons inside handlers.
export function roleRank(role: string): number {
  return role === 'owner' ? 3 : role === 'manager' ? 2 : 1
}
