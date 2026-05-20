import { Hono } from 'hono'
import { requireAuth } from '../middleware/requireAuth'
import { getUserById, updateUserAvatar, updateUserDisplayName } from '../db/queries'
import type { UserEnv } from '../types'

const userProfile = new Hono<UserEnv>()

function buildAvatarUrl(requestUrl: string, avatarKey: string): string {
  const { protocol, host } = new URL(requestUrl)
  return `${protocol}//${host}/api/files/uploads/${avatarKey}`
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

// ─── POST /api/me/avatar ──────────────────────────────────────────────────────

const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

const MAX_SIZE = 2 * 1024 * 1024 // 2 MB

userProfile.post('/me/avatar', requireAuth, async (c) => {
  const userId = c.get('userId')

  let formData: FormData
  try {
    formData = await c.req.formData()
  } catch {
    return c.json({ error: 'Expected multipart/form-data' }, 400)
  }

  const file = formData.get('file')
  if (!file || typeof (file as { name?: unknown }).name !== 'string') {
    return c.json({ error: 'file field is required' }, 400)
  }

  const fileObj = file as unknown as {
    name: string
    type: string
    size: number
    stream: () => ReadableStream
    arrayBuffer: () => Promise<ArrayBuffer>
  }

  const ext = ALLOWED_MIME[fileObj.type]
  if (!ext) {
    return c.json({ error: 'Only jpg, png, and webp images are allowed' }, 400)
  }
  if (fileObj.size > MAX_SIZE) {
    return c.json({ error: 'Image must be ≤ 2 MB' }, 400)
  }

  const key = `avatars/${userId}.${ext}`
  await c.env.LOOM_UPLOADS.put(key, fileObj.stream(), {
    httpMetadata: { contentType: fileObj.type },
  })

  await updateUserAvatar(c.env.DB, userId, key)

  const avatar_url = buildAvatarUrl(c.req.url, key)
  return c.json({ avatar_url }, 200)
})

export default userProfile
