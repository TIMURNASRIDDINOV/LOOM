import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import { verifyToken } from '../lib/jwt'
import type { AdminEnv } from '../types'

export const requireAdmin = createMiddleware<AdminEnv>(async (c, next) => {
  const token = getCookie(c, 'admin_token')
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const payload = await verifyToken(token, c.env.JWT_SECRET)
  if (!payload || payload.role !== 'admin') {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  c.set('adminId', parseInt(payload.sub, 10))
  await next()
})
