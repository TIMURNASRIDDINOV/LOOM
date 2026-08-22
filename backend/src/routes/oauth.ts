import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import {
  createOAuthUser,
  getUserByEmail,
  getUserByIdentity,
  getUserById,
  linkIdentity,
  touchUserLogin,
} from '../db/queries'
import { signToken } from '../lib/jwt'
import {
  OAuthError,
  configuredProviders,
  exchangeCode,
  isPlatform,
  isProviderId,
  type Platform,
} from '../lib/oauth'
import type { BaseEnv } from '../types'

// Social sign-in for the mobile app.
//
// The app runs PKCE in the system browser (expo-auth-session) and posts the
// authorization code here. We exchange it server-side — the client secret must
// never be in the app bundle — then upsert the user and hand back a JWT.

const router = new Hono<BaseEnv>()

// ─── GET /api/auth/oauth/providers ───────────────────────────────────────────
// The sign-in sheet asks which buttons it is allowed to show. A provider only
// appears once its client id and secret are set on the Worker.

router.get('/oauth/providers', (c) => {
  const env = c.env as unknown as Record<string, string | undefined>
  // Google's client id differs per platform, so the app says which build it is.
  const q = c.req.query('platform')
  const platform: Platform = isPlatform(q) ? q : 'android'
  return c.json({ platform, providers: configuredProviders(env, platform) })
})

// ─── POST /api/auth/oauth/:provider ──────────────────────────────────────────

router.post('/oauth/:provider', async (c) => {
  const provider = c.req.param('provider')
  if (!isProviderId(provider)) return c.json({ error: 'Unknown provider' }, 404)

  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown'
  const rlKey = `oauth:${ip}`
  const seen = await c.env.RATE_LIMIT.get(rlKey)
  if (seen && parseInt(seen, 10) >= 10) {
    return c.json({ error: 'Слишком много попыток. Подождите минуту.' }, 429)
  }
  await c.env.RATE_LIMIT.put(rlKey, String((seen ? parseInt(seen, 10) : 0) + 1), {
    expirationTtl: 60,
  })

  let body: Record<string, unknown>
  try {
    body = (await c.req.json()) as Record<string, unknown>
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const code = typeof body.code === 'string' ? body.code : ''
  const redirectUri = typeof body.redirect_uri === 'string' ? body.redirect_uri : ''
  const codeVerifier = typeof body.code_verifier === 'string' ? body.code_verifier : undefined
  const platform: Platform = isPlatform(body.platform) ? body.platform : 'android'
  if (!code || !redirectUri) {
    return c.json({ error: 'code and redirect_uri are required' }, 400)
  }

  const env = c.env as unknown as Record<string, string | undefined>

  let profile
  try {
    profile = await exchangeCode(provider, { code, codeVerifier, redirectUri, platform }, env)
  } catch (e) {
    if (e instanceof OAuthError) return c.json({ error: e.message }, e.status as 400)
    console.error('oauth exchange threw:', e)
    return c.json({ error: 'Не удалось войти. Попробуйте ещё раз.' }, 500)
  }

  // 1. Already linked → straight in.
  let user = await getUserByIdentity(c.env.DB, provider, profile.providerUserId)

  // 2. Not linked, but the provider vouches for an email we already know →
  //    attach the identity to that account. The `emailVerified` guard is what
  //    stops someone registering "victim@gmail.com" at a sloppy provider and
  //    walking into the victim's LOOM account.
  if (!user && profile.email && profile.emailVerified) {
    const existing = await getUserByEmail(c.env.DB, profile.email.toLowerCase())
    if (existing) user = existing
  }

  // 3. Nobody we know → new account.
  if (!user) {
    const id = await createOAuthUser(c.env.DB, {
      provider,
      provider_user_id: profile.providerUserId,
      email: profile.email,
      name: profile.name,
    })
    user = await getUserById(c.env.DB, id)
    if (!user) return c.json({ error: 'Не удалось создать аккаунт' }, 500)
  }

  if (user.status === 'banned') {
    return c.json({ error: 'Ваш аккаунт заблокирован' }, 403)
  }

  await linkIdentity(c.env.DB, {
    user_id: user.id,
    provider,
    provider_user_id: profile.providerUserId,
    email: profile.email,
    avatar_url: profile.avatarUrl,
  })
  await touchUserLogin(c.env.DB, user.id)

  const token = await signToken({ sub: String(user.id), role: 'user' }, c.env.JWT_SECRET, '30d')

  // Cookie for the web storefront; the body token is what the native app keeps,
  // since it has no cookie jar (same reasoning as the Mini App flow).
  setCookie(c, 'user_token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })

  return c.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      // The app needs this immediately: ordering requires a Telegram-verified
      // phone, and a social sign-in does not provide one.
      telegram_user_id: user.telegram_user_id,
      is_designer: user.is_designer,
      designer_handle: user.designer_handle,
    },
  })
})

export default router
