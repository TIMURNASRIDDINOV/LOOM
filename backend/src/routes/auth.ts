import { Hono } from 'hono'
import {
  getUserByEmail, getUserById, createUser,
  updateUserProfile, updateUserPassword, updateUserAvatar,
  getUserOrderStats, anonymizeUser,
} from '../db/queries'
import { hashPassword, verifyPassword } from '../lib/password'
import { signToken } from '../lib/jwt'
import { requireAuth } from '../middleware/requireAuth'
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

  const user = await getUserByEmail(c.env.DB, email.toLowerCase())
  if (!user) return c.json({ error: 'Invalid credentials' }, 401)

  const valid = await verifyPassword(password, user.password_hash)
  if (!valid) return c.json({ error: 'Invalid credentials' }, 401)

  const token = await signToken({ sub: String(user.id), role: 'user' }, c.env.JWT_SECRET, '30d')
  return c.json({ token, user: { id: user.id, email: user.email, name: user.name } })
})

// ─── GET /api/auth/me  (requires Bearer token or user_token cookie) ──────────

auth.get('/me', requireAuth, async (c) => {
  const user = await getUserById(c.env.DB, c.get('userId'))
  if (!user) return c.json({ error: 'Not found' }, 404)
  const stats = await getUserOrderStats(c.env.DB, user.id)

  let avatarUrl: string | null = null
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
  })
})

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

  const { name, phone, location_preset } = body as Record<string, unknown>
  const updates: Parameters<typeof updateUserProfile>[2] = {}

  if (name !== undefined) updates.name = typeof name === 'string' ? name.trim() || null : null
  if (phone !== undefined) updates.phone = typeof phone === 'string' ? phone.trim() || null : null
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
  return c.json({ id: user.id, email: user.email, name: user.name, phone: user.phone, location_preset: user.location_preset })
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
  await updateUserPassword(c.env.DB, user.id, newHash)
  return c.json({ ok: true })
})

// ─── POST /api/auth/avatar  (requires Bearer token, multipart) ────────────────

auth.post('/avatar', requireAuth, async (c) => {
  let formData: FormData
  try { formData = await c.req.formData() } catch { return c.json({ error: 'Expected multipart/form-data' }, 400) }

  const f = formData.get('avatar') as File | null
  if (!f || typeof f.name !== 'string') return c.json({ error: 'avatar file required' }, 400)

  const ALLOWED_IMG_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
  const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
  const mime = f.type || 'application/octet-stream'
  if (!ALLOWED_IMG_TYPES.has(mime) && !['png','jpg','jpeg','webp'].includes(ext)) {
    return c.json({ error: 'Avatar must be PNG, JPG, or WebP' }, 400)
  }
  if (f.size > 2 * 1024 * 1024) return c.json({ error: 'Avatar must be ≤ 2 MB' }, 400)

  const userId = c.get('userId')
  const fileExt = ALLOWED_IMG_TYPES.has(mime) ? mime.split('/')[1].replace('jpeg','jpg') : ext
  const key = `avatars/user_${userId}.${fileExt}`

  await c.env.LOOM_MODELS.put(key, f.stream(), {
    httpMetadata: { contentType: mime },
  })

  await updateUserAvatar(c.env.DB, userId, key)

  const { protocol, host } = new URL(c.req.url)
  return c.json({ avatar_key: key, avatar_url: `${protocol}//${host}/api/files/avatars/${key}` })
})

// ─── GET /api/me/orders  (requires Bearer token) ─────────────────────────────
// Mounted separately in index.ts, but handler lives here for proximity

export default auth
