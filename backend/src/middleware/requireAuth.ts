import { createMiddleware } from 'hono/factory'
import { verifyToken } from '../lib/jwt'
import type { UserEnv } from '../types'

export const requireAuth = createMiddleware<UserEnv>(async (c, next) => {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const token = auth.slice(7)
  const payload = await verifyToken(token, c.env.JWT_SECRET)

  if (!payload || payload.role !== 'user') {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  c.set('userId', parseInt(payload.sub, 10))
  await next()
})
