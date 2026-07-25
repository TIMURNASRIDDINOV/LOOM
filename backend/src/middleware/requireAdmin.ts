import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import { verifyToken } from '../lib/jwt'
import { getAdminById, listAdminPermissions } from '../db/queries'
import { resolveCapabilities, type Capability } from '../lib/permissions'
import type { AdminEnv } from '../types'

// Verifies the admin_token cookie AND loads the admin's current role +
// capability overrides from the DB (so a permission change takes effect on the
// admin's very next request, and a deleted admin is locked out at once).
// Sets adminId, adminRole and adminCaps on the context.
export const requireAdmin = createMiddleware<AdminEnv>(async (c, next) => {
  const token = getCookie(c, 'admin_token')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)

  const payload = await verifyToken(token, c.env.JWT_SECRET)
  if (!payload || payload.role !== 'admin') return c.json({ error: 'Unauthorized' }, 401)

  const admin = await getAdminById(c.env.DB, parseInt(payload.sub, 10))
  if (!admin) return c.json({ error: 'Unauthorized' }, 401)

  const role = admin.role || 'staff'
  // The owner resolves to every capability without consulting the overrides
  // table, so skip the read entirely for them.
  const overrides = role === 'owner' ? {} : await listAdminPermissions(c.env.DB, admin.id)

  c.set('adminId', admin.id)
  c.set('adminRole', role)
  c.set('adminCaps', resolveCapabilities(role, overrides))
  await next()
})

// Gate a route on a capability. Use AFTER requireAdmin:
//   admin.post('/x', requireAdmin, requireCap('orders.approve'), handler)
// Passing several capabilities requires ALL of them.
export function requireCap(...needed: Capability[]) {
  return createMiddleware<AdminEnv>(async (c, next) => {
    const caps = c.get('adminCaps')
    const missing = needed.filter((cap) => !caps.has(cap))
    if (missing.length) {
      return c.json(
        {
          error: 'Недостаточно прав для этого действия. Обратитесь к владельцу аккаунта.',
          code: 'forbidden',
          missing,
        },
        403,
      )
    }
    await next()
  })
}

// Gate a route to one of the given admin roles. Still used by the team and
// permission endpoints, which are owner-only by design and deliberately NOT
// expressible as a grantable capability (see lib/permissions.ts).
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
