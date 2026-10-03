import { Hono } from 'hono'
import { requireAuth } from '../middleware/requireAuth'
import { getUserById, updateUserDisplayName } from '../db/queries'
import type { UserEnv } from '../types'

const userProfile = new Hono<UserEnv>()

function buildAvatarUrl(requestUrl: string, avatarKey: string): string {
  const { protocol, host } = new URL(requestUrl)
  return `${protocol}//${host}/api/files/avatars/${avatarKey}`
}

// ─── GET /api/me ──────────────────────────────────────────────────────────────

userProfile.get('/me', requireAuth, async (c) => {
  const userId = c.get('userId')
  const user = await getUserById(c.env.DB, userId)
  if (!user) return c.json({ error: 'User not found' }, 404)

  const avatar_url = user.avatar_key
    ? buildAvatarUrl(c.req.url, user.avatar_key)
    : null

  return c.json({
    id: user.id,
    phone: user.phone,
    first_name: user.first_name,
    last_name: user.last_name,
    role: user.role,
    status: user.status,
    avatar_url,
    email: user.email,
  })
})

// ─── PATCH /api/me ────────────────────────────────────────────────────────────

userProfile.patch('/me', requireAuth, async (c) => {
  const userId = c.get('userId')

  let body: unknown
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { first_name } = body as Record<string, unknown>
  if (typeof first_name !== 'string') {
    return c.json({ error: 'first_name must be a string' }, 400)
  }

  const trimmed = first_name.trim().slice(0, 50)
  if (!trimmed) return c.json({ error: 'first_name cannot be empty' }, 400)

  await updateUserDisplayName(c.env.DB, userId, trimmed)

  const user = await getUserById(c.env.DB, userId)
  if (!user) return c.json({ error: 'User not found' }, 404)

  const avatar_url = user.avatar_key
    ? buildAvatarUrl(c.req.url, user.avatar_key)
    : null

  return c.json({
    id: user.id,
    phone: user.phone,
    first_name: user.first_name,
    last_name: user.last_name,
    role: user.role,
    status: user.status,
    avatar_url,
  })
})

// Avatar upload lives at POST /api/auth/avatar (routes/auth.ts).

export default userProfile
