import { Hono } from 'hono'
import { getUserByEmail, getUserById, createUser } from '../db/queries'
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
  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    first_name: user.first_name ?? null,
    last_name: user.last_name ?? null,
    telegram_username: user.telegram_username ?? null,
    role: user.role ?? 'customer',
    status: user.status ?? 'active',
  })
})

// ─── GET /api/me/orders  (requires Bearer token) ─────────────────────────────
// Mounted separately in index.ts, but handler lives here for proximity

export default auth
