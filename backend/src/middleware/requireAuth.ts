import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import { verifyToken } from '../lib/jwt'
import { getUserById } from '../db/queries'
import type { UserEnv } from '../types'

export const requireAuth = createMiddleware<UserEnv>(async (c, next) => {
  // Accept Bearer token (email auth) or user_token cookie (phone/Telegram auth)
  let token: string | undefined
  const auth = c.req.header('Authorization')
  if (auth?.startsWith('Bearer ')) {
    token = auth.slice(7)
  } else {
    token = getCookie(c, 'user_token') ?? undefined
  }

  if (!token) return c.json({ error: 'Unauthorized' }, 401)

  const payload = await verifyToken(token, c.env.JWT_SECRET)
  if (!payload || payload.role !== 'user') {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const userId = parseInt(payload.sub, 10)

  // A JWT lives 30 days, so a deleted account would otherwise keep working
  // until its token ran out. One indexed primary-key read per request is the
  // price of making "delete my account" mean what it says.
  const user = await getUserById(c.env.DB, userId)
  if (!user || user.status === 'deleted') {
    return c.json({ error: 'Unauthorized', code: 'account_deleted' }, 401)
  }

  c.set('userId', userId)
  await next()
})
