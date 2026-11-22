// Guest checkout (LOOM-363): order first, confirm the number in Telegram after.
//
//   POST /api/auth/guest → { ok, guest } + user_token cookie
//
// A buyer without an account gets a new, empty guest account the moment they
// add to cart, so cart, checkout and the order page work unchanged. A guest
// account holds no phone: typing someone's number never opens their account.
// When the buyer later confirms a number (bot or code), mergeGuestInto() moves
// the guest's cart and orders to that verified account.

import { Hono } from 'hono'
import type { Context } from 'hono'
import { setCookie } from 'hono/cookie'
import { getUserById } from '../db/queries'
import { signToken } from '../lib/jwt'
import { clientIp, isRateLimited, TOO_MANY } from '../lib/rateLimit'
import { authenticateUser, userTokenFrom } from '../middleware/requireAuth'
import type { BaseEnv } from '../types'

export const GUEST_HASH = 'guest' // password_hash sentinel: no password can match it
export const isGuest = (u: { password_hash?: string | null } | null | undefined) => u?.password_hash === GUEST_HASH

const USER_COOKIE_MAX_AGE = 30 * 24 * 60 * 60

const router = new Hono<BaseEnv>()

router.post('/guest', async (c) => {
  const current = await authenticateUser(c.env, userTokenFrom(c))
  if (current.ok) return c.json({ ok: true, guest: isGuest(current.user) })

  if (await isRateLimited(c.env.RATE_LIMIT, `guest:ip:${clientIp(c)}`, 10, 60 * 60)) return c.json(TOO_MANY, 429)

  const now = Date.now()
  const result = await c.env.DB
    .prepare(
      `INSERT INTO users (email, password_hash, phone, role, status, created_at, last_login_at)
       VALUES (?, ?, NULL, 'user', 'active', ?, ?)`,
    )
    .bind(`guest-${crypto.randomUUID()}@guest.loom`, GUEST_HASH, now, now)
    .run()
  const id = Number(result.meta.last_row_id)
  const jwt = await signToken({ sub: String(id), role: 'user' }, c.env.JWT_SECRET, '30d')
  setCookie(c, 'user_token', jwt, { httpOnly: true, secure: true, sameSite: 'Lax', maxAge: USER_COOKIE_MAX_AGE, path: '/' })
  return c.json({ ok: true, guest: true })
})

/**
 * The request's own session is a guest and the buyer just proved a number:
 * move the guest's cart and orders to the verified account. Called by the
 * bot and code sign-in right before they hand out the verified cookie.
 */
export async function mergeGuestInto(c: Context<BaseEnv>, verifiedUserId: number): Promise<void> {
  const current = await authenticateUser(c.env, userTokenFrom(c))
  if (!current.ok || !isGuest(current.user) || current.user.id === verifiedUserId) return
  const guestId = current.user.id
  const target = await getUserById(c.env.DB, verifiedUserId)
  if (!target || isGuest(target)) return
  await c.env.DB.batch(
    ['orders', 'cart_items', 'uploads', 'user_activity_log'].map((t) =>
      c.env.DB.prepare(`UPDATE ${t} SET user_id = ? WHERE user_id = ?`).bind(verifiedUserId, guestId),
    ),
  )
  // The guest is spent: its cookie is replaced, and any copy of it stops working
  // (status alone, since a token issued in the same second survives a revoke).
  await c.env.DB.prepare("UPDATE users SET status = 'deleted' WHERE id = ?").bind(guestId).run()
}

export default router
