import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import {
  getUserByEmail, getUserById, createUser,
  updateUserProfile, updateUserPassword, updateUserAvatar,
  getUserOrderStats, anonymizeUser,
} from '../db/queries'
import { hashPassword, verifyPassword, hasUsablePassword } from '../lib/password'
import { signToken } from '../lib/jwt'
import { requireAuth } from '../middleware/requireAuth'
import { AVATAR_TYPES, LEGACY_AVATAR_KEY, validateUpload } from '../lib/r2'
import { clientIp, isRateLimited, tooManyFailures, recordFailure, TOO_MANY } from '../lib/rateLimit'
import type { UserEnv } from '../types'

const auth = new Hono<UserEnv>()

// ─── POST /api/auth/register ─────────────────────────────────────────────────

auth.post('/register', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { email, password, name, phone } = body as Record<string, unknown>

  if (await isRateLimited(c.env.RATE_LIMIT, `register:${clientIp(c)}`, 5, 60 * 60)) {
    return c.json(TOO_MANY, 429)
  }

  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: 'Invalid email format' }, 400)
  }
  if (typeof password !== 'string' || password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400)
  }

  const normalizedEmail = email.toLowerCase()
  const existing = await getUserByEmail(c.env.DB, normalizedEmail)
  if (existing) return c.json({ error: 'Email already registered' }, 409)

  const passwordHash = await hashPassword(password)
  const userId = await createUser(c.env.DB, {
    email: normalizedEmail,
    password_hash: passwordHash,
    name: typeof name === 'string' ? name : null,
    phone: typeof phone === 'string' ? phone : null,
  })

  const token = await signToken({ sub: String(userId), role: 'user' }, c.env.JWT_SECRET, '30d')
  return c.json({ token, user: { id: userId, email: normalizedEmail, name: name ?? null } }, 201)
})

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

auth.post('/login', async (c) => {
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

  // Failed attempts are counted per IP and per account.
  const failKeys = [`login:ip:${clientIp(c)}`, `login:id:${email.toLowerCase()}`]
  if (await tooManyFailures(c.env.RATE_LIMIT, failKeys, 10)) return c.json(TOO_MANY, 429)

  const user = await getUserByEmail(c.env.DB, email.toLowerCase())
  const valid = !!user && (await verifyPassword(password, user.password_hash))
  if (!user || !valid) {
    await recordFailure(c.env.RATE_LIMIT, failKeys, 15 * 60)
    return c.json({ error: 'Invalid credentials' }, 401)
  }
  if (user.status !== 'active') return c.json({ error: 'Your account has been blocked' }, 403)

  const token = await signToken({ sub: String(user.id), role: 'user' }, c.env.JWT_SECRET, '30d')
  return c.json({ token, user: { id: user.id, email: user.email, name: user.name } })
})

// ─── GET /api/auth/me  (requires Bearer token or user_token cookie) ──────────

auth.get('/me', requireAuth, async (c) => {
  const user = await getUserById(c.env.DB, c.get('userId'))
  if (!user) return c.json({ error: 'Not found' }, 404)
  const stats = await getUserOrderStats(c.env.DB, user.id)

  let avatarUrl: string | null = null
  if (user.avatar_key && LEGACY_AVATAR_KEY.test(user.avatar_key)) {
    user.avatar_key = await moveLegacyAvatar(c.env.LOOM_MODELS, c.env.DB, user.id, user.avatar_key)
  }
  if (user.avatar_key) {
    const { protocol, host } = new URL(c.req.url)
    avatarUrl = `${protocol}//${host}/api/files/avatars/${user.avatar_key}`
  }

  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    first_name: user.first_name,
    last_name: user.last_name,
    phone: user.phone,
    avatar_key: user.avatar_key,
    avatar_url: avatarUrl,
    location_preset: user.location_preset,
    created_at: user.created_at,
    order_count: stats.order_count,
    // Same number under the name the mobile app reads (and the admin API uses).
    orders_count: stats.order_count,
    total_spent: stats.total_spent,
    // True once the phone number has been verified through Telegram.
    phone_verified: !!user.telegram_user_id,
    telegram_user_id: user.telegram_user_id,
    telegram_username: user.telegram_username,
    // Designer opt-in (migration 0017). The app refreshes from /me after every
    // sign-in and after /designer/apply, so leaving these out here made the
    // designer flag vanish the moment it was granted.
    is_designer: user.is_designer ?? 0,
    designer_handle: user.designer_handle ?? null,
    designer_bio: user.designer_bio ?? null,
    // Telegram and OAuth accounts carry a sentinel in password_hash that no
    // password can ever match, so offering them "change password" is a dead
    // end — the cabinet hides that card when this is false.
    has_password: hasUsablePassword(user.password_hash),
    // Notification switches (0019). Default on: a row written before the
    // migration has neither column, and nobody has opted out of anything.
    notify_orders: (user.notify_orders ?? 1) ? 1 : 0,
    notify_promo: (user.notify_promo ?? 1) ? 1 : 0,
  })
})

// Avatars used to live at a key derived from the user id (LEGACY_AVATAR_KEY).
// Those keys are no longer served; the owner's next /me moves the file to a
// random key.

function newAvatarKey(userId: number, ext: string): string {
  return `avatars/u${userId}_${crypto.randomUUID()}.${ext}`
}

async function moveLegacyAvatar(bucket: R2Bucket, db: D1Database, userId: number, oldKey: string): Promise<string | null> {
  const obj = await bucket.get(oldKey)
  if (!obj) {
    await updateUserAvatar(db, userId, null)
    return null
  }
  const bytes = new Uint8Array(await obj.arrayBuffer())
  const check = validateUpload(bytes, AVATAR_TYPES)
  if (!check.ok) {
    // Not a real image: drop it rather than carry it forward.
    await bucket.delete(oldKey)
    await updateUserAvatar(db, userId, null)
    return null
  }
  const key = newAvatarKey(userId, check.type.ext)
  await bucket.put(key, bytes, { httpMetadata: { contentType: check.type.mime } })
  await updateUserAvatar(db, userId, key)
  await bucket.delete(oldKey)
  return key
}

// ─── DELETE /api/auth/account  (requires Bearer token) ───────────────────────
// Store policy: an app that offers sign-up must offer account deletion. Orders
// are kept as anonymised commercial records; everything personal is wiped.

auth.delete('/account', requireAuth, async (c) => {
  const user = await getUserById(c.env.DB, c.get('userId'))
  if (!user) return c.json({ error: 'Not found' }, 404)
  await anonymizeUser(c.env.DB, user.id)
  return c.json({ ok: true })
})

// ─── PATCH /api/auth/profile  (requires Bearer token) ────────────────────────

auth.patch('/profile', requireAuth, async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const { name, phone, location_preset, notify_orders, notify_promo } = body as Record<string, unknown>
  const updates: Parameters<typeof updateUserProfile>[2] = {}

  if (name !== undefined) updates.name = typeof name === 'string' ? name.trim() || null : null
  if (phone !== undefined) updates.phone = typeof phone === 'string' ? phone.trim() || null : null
  if (notify_orders !== undefined) updates.notify_orders = notify_orders ? 1 : 0
  if (notify_promo !== undefined) updates.notify_promo = notify_promo ? 1 : 0
  if (location_preset !== undefined) {
    if (location_preset === null) {
      updates.location_preset = null
    } else if (typeof location_preset === 'object') {
      updates.location_preset = JSON.stringify(location_preset)
    } else if (typeof location_preset === 'string') {
      updates.location_preset = location_preset || null
    }
  }

  await updateUserProfile(c.env.DB, c.get('userId'), updates)

  const user = await getUserById(c.env.DB, c.get('userId'))
  if (!user) return c.json({ error: 'Not found' }, 404)
  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    location_preset: user.location_preset,
    notify_orders: (user.notify_orders ?? 1) ? 1 : 0,
    notify_promo: (user.notify_promo ?? 1) ? 1 : 0,
  })
})

// ─── PATCH /api/auth/password  (requires Bearer token) ───────────────────────

auth.patch('/password', requireAuth, async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const { current_password, new_password } = body as Record<string, unknown>
  if (typeof current_password !== 'string' || typeof new_password !== 'string') {
    return c.json({ error: 'current_password and new_password required' }, 400)
  }
  if (new_password.length < 8) {
    return c.json({ error: 'New password must be at least 8 characters' }, 400)
  }

  const user = await getUserById(c.env.DB, c.get('userId'))
  if (!user) return c.json({ error: 'Not found' }, 404)

  const valid = await verifyPassword(current_password, user.password_hash)
  if (!valid) return c.json({ error: 'Current password is incorrect' }, 401)

  const newHash = await hashPassword(new_password)
  // Signs out every existing session, including this one; hand back a fresh
  // token so the caller stays signed in.
  await updateUserPassword(c.env.DB, user.id, newHash)
  const token = await signToken({ sub: String(user.id), role: 'user' }, c.env.JWT_SECRET, '30d')
  if (getCookie(c, 'user_token')) {
    setCookie(c, 'user_token', token, {
      httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 30 * 24 * 60 * 60,
    })
  }
  return c.json({ ok: true, token })
})

// ─── POST /api/auth/avatar  (requires Bearer token, multipart) ────────────────

auth.post('/avatar', requireAuth, async (c) => {
  let formData: FormData
  try { formData = await c.req.formData() } catch { return c.json({ error: 'Expected multipart/form-data' }, 400) }

  const f = formData.get('avatar') as File | null
  if (!f || typeof f.name !== 'string') return c.json({ error: 'avatar file required' }, 400)

  if (f.size > 2 * 1024 * 1024) return c.json({ error: 'Avatar must be ≤ 2 MB' }, 400)
  // The stored type comes from the file content; name and declared type are ignored.
  const bytes = new Uint8Array(await f.arrayBuffer())
  const check = validateUpload(bytes, AVATAR_TYPES, 2 * 1024 * 1024)
  if (!check.ok) return c.json({ error: 'Avatar must be PNG, JPG, or WebP' }, 400)

  const userId = c.get('userId')
  const previous = (await getUserById(c.env.DB, userId))?.avatar_key
  const key = newAvatarKey(userId, check.type.ext)

  await c.env.LOOM_MODELS.put(key, bytes, {
    httpMetadata: { contentType: check.type.mime },
  })

  await updateUserAvatar(c.env.DB, userId, key)
  if (previous && previous.startsWith('avatars/')) await c.env.LOOM_MODELS.delete(previous)

  const { protocol, host } = new URL(c.req.url)
  return c.json({ avatar_key: key, avatar_url: `${protocol}//${host}/api/files/avatars/${key}` })
})

// ─── GET /api/me/orders  (requires Bearer token) ─────────────────────────────
// Mounted separately in index.ts, but handler lives here for proximity

export default auth
