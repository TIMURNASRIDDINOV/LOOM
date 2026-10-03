import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import type { Context } from 'hono'
import { verifyToken } from '../lib/jwt'
import { getUserById } from '../db/queries'
import type { Bindings, UserEnv } from '../types'
import type { User } from '../db/schema'

/** Bearer token (app / email auth) or the user_token cookie (web). */
export function userTokenFrom(c: Context): string | undefined {
  const auth = c.req.header('Authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  return getCookie(c, 'user_token') ?? undefined
}

export type UserAuthResult =
  | { ok: true; user: User }
  | { ok: false; status: 401 | 403; body: { error: string; code?: string } }

/**
 * Resolve a user token to a live account. A JWT lives 30 days, so the row is
 * read on every request: deleted and banned accounts are refused, and tokens
 * issued before the account's last logout / password change are rejected.
 */
export async function authenticateUser(env: Bindings, token: string | undefined): Promise<UserAuthResult> {
  if (!token) return { ok: false, status: 401, body: { error: 'Unauthorized' } }

  const payload = await verifyToken(token, env.JWT_SECRET)
  if (!payload || payload.role !== 'user') return { ok: false, status: 401, body: { error: 'Unauthorized' } }

  const user = await getUserById(env.DB, parseInt(payload.sub, 10))
  if (!user || user.status === 'deleted') {
    return { ok: false, status: 401, body: { error: 'Unauthorized', code: 'account_deleted' } }
  }
  if ((payload.iat ?? 0) < (user.tokens_valid_after ?? 0)) {
    return { ok: false, status: 401, body: { error: 'Session expired', code: 'session_revoked' } }
  }
  if (user.status === 'banned') {
    return { ok: false, status: 403, body: { error: 'Your account has been blocked', code: 'account_banned' } }
  }
  return { ok: true, user }
}

export const requireAuth = createMiddleware<UserEnv>(async (c, next) => {
  const r = await authenticateUser(c.env, userTokenFrom(c))
  if (!r.ok) return c.json(r.body, r.status)
  c.set('userId', r.user.id)
  await next()
})
