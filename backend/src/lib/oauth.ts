// Federated sign-in providers for the mobile app.
//
// The app runs the PKCE authorization step in the system browser and sends the
// resulting `code` here; this module does the token exchange server-side so the
// client secret never ships inside the binary. Each provider is just three
// URLs plus a normaliser, so adding a fourth is a table entry.

export type ProviderId = 'google' | 'facebook' | 'discord'

/** What every provider gets boiled down to before we touch the database. */
export type OAuthProfile = {
  providerUserId: string
  email: string | null
  /**
   * Whether the provider vouches for the email. Only a verified email may be
   * merged into an existing password account — see routes/oauth.ts.
   */
  emailVerified: boolean
  name: string | null
  avatarUrl: string | null
}

export type Platform = 'android' | 'ios' | 'web'

type ProviderConfig = {
  tokenUrl: string
  userInfoUrl: string
  clientIdVar: string
  clientSecretVar: string
  /**
   * Google issues a separate client id per platform, and a code obtained with
   * one can only be redeemed by that same id. When set, the env var for a
   * platform is `<clientIdVar>_<PLATFORM>` and the app says which it used.
   */
  perPlatform?: boolean
  /**
   * True when the provider issues codes to public clients that hold no secret.
   * Google's Android and iOS OAuth clients are the case that matters: they are
   * the only Google client types that accept a custom-scheme redirect like
   * `loom://redirect`, they have no secret, and a code issued to one can only
   * be redeemed by that same client id. Sending a secret there is an error.
   * PKCE is what secures the exchange instead.
   */
  allowPublicClient?: boolean
  /** Discord wants the token in the body as form data; all three do, actually. */
  profile: (raw: Record<string, unknown>) => OAuthProfile
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  google: {
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    clientIdVar: 'GOOGLE_CLIENT_ID',
    clientSecretVar: 'GOOGLE_CLIENT_SECRET',
    allowPublicClient: true,
    perPlatform: true,
    profile: (r) => ({
      providerUserId: String(r.sub),
      email: typeof r.email === 'string' ? r.email : null,
      // Google returns this as a real boolean on the OIDC endpoint.
      emailVerified: r.email_verified === true || r.email_verified === 'true',
      name: typeof r.name === 'string' ? r.name : null,
      avatarUrl: typeof r.picture === 'string' ? r.picture : null,
    }),
  },
  facebook: {
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    userInfoUrl: 'https://graph.facebook.com/v19.0/me?fields=id,name,email,picture.type(large)',
    clientIdVar: 'FACEBOOK_CLIENT_ID',
    clientSecretVar: 'FACEBOOK_CLIENT_SECRET',
    profile: (r) => ({
      providerUserId: String(r.id),
      email: typeof r.email === 'string' ? r.email : null,
      // Facebook only releases an email at all once it has been confirmed, so
      // its presence is the verification signal.
      emailVerified: typeof r.email === 'string' && r.email.length > 0,
      name: typeof r.name === 'string' ? r.name : null,
      avatarUrl:
        ((r.picture as { data?: { url?: string } } | undefined)?.data?.url as string) ?? null,
    }),
  },
  discord: {
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userInfoUrl: 'https://discord.com/api/users/@me',
    clientIdVar: 'DISCORD_CLIENT_ID',
    clientSecretVar: 'DISCORD_CLIENT_SECRET',
    profile: (r) => ({
      providerUserId: String(r.id),
      email: typeof r.email === 'string' ? r.email : null,
      emailVerified: r.verified === true,
      name:
        (typeof r.global_name === 'string' ? r.global_name : null) ??
        (typeof r.username === 'string' ? r.username : null),
      avatarUrl:
        typeof r.avatar === 'string'
          ? `https://cdn.discordapp.com/avatars/${String(r.id)}/${r.avatar}.png`
          : null,
    }),
  },
}

/**
 * The env var holding the client id for this provider on this platform.
 * Google: GOOGLE_CLIENT_ID_ANDROID / _IOS / _WEB. Everyone else: one id.
 */
function idVarFor(provider: ProviderId, platform: Platform): string {
  const cfg = PROVIDERS[provider]
  return cfg.perPlatform ? `${cfg.clientIdVar}_${platform.toUpperCase()}` : cfg.clientIdVar
}

export function isPlatform(v: unknown): v is Platform {
  return v === 'android' || v === 'ios' || v === 'web'
}

export function isProviderId(v: string): v is ProviderId {
  return v === 'google' || v === 'facebook' || v === 'discord'
}

/**
 * A provider is only offered to the app once both of its secrets are set, so
 * the sign-in sheet can grey out what the deployment cannot actually do.
 */
export function providerConfigured(
  provider: ProviderId,
  env: Record<string, string | undefined>,
  platform: Platform = 'android',
): boolean {
  const c = PROVIDERS[provider]
  if (!env[idVarFor(provider, platform)]) return false
  // A public client is complete with just an id; everyone else needs the pair.
  return c.allowPublicClient ? true : !!env[c.clientSecretVar]
}

/**
 * The providers this deployment can complete, each with its public client id.
 * The app needs the id to build the authorization URL; only the secret is
 * sensitive, and that never leaves the Worker.
 */
export function configuredProviders(
  env: Record<string, string | undefined>,
  platform: Platform = 'android',
): { id: ProviderId; client_id: string }[] {
  return (Object.keys(PROVIDERS) as ProviderId[])
    .filter((p) => providerConfigured(p, env, platform))
    .map((id) => ({ id, client_id: env[idVarFor(id, platform)] as string }))
}

export class OAuthError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

/**
 * Exchange an authorization code for the provider's view of the user.
 * `codeVerifier` is the PKCE secret the app generated; `redirectUri` must be
 * byte-identical to the one used to obtain the code or the provider rejects it.
 */
export async function exchangeCode(
  provider: ProviderId,
  params: { code: string; codeVerifier?: string; redirectUri: string; platform?: Platform },
  env: Record<string, string | undefined>,
): Promise<OAuthProfile> {
  const cfg = PROVIDERS[provider]
  const platform = params.platform ?? 'android'
  const clientId = env[idVarFor(provider, platform)]
  const clientSecret = env[cfg.clientSecretVar]
  if (!clientId || (!clientSecret && !cfg.allowPublicClient)) {
    throw new OAuthError(`${provider} sign-in is not configured`, 503)
  }

  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: clientId,
  })
  // Omitted entirely for a public client — Google rejects the exchange if a
  // secret is sent for an Android/iOS client id.
  if (clientSecret) form.set('client_secret', clientSecret)
  if (params.codeVerifier) form.set('code_verifier', params.codeVerifier)

  const tokenRes = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString(),
  })

  const tokenBody = (await tokenRes.json().catch(() => null)) as {
    access_token?: string
    error?: unknown
    error_description?: string
  } | null

  if (!tokenRes.ok || !tokenBody?.access_token) {
    // Never surface the provider's raw error to the client — it can echo the
    // code and redirect URI back.
    const detail = tokenBody?.error_description ?? String(tokenBody?.error ?? tokenRes.status)
    console.error(`oauth ${provider} token exchange failed: ${detail}`)
    throw new OAuthError('Не удалось войти через этот сервис. Попробуйте ещё раз.', 401)
  }

  const infoRes = await fetch(cfg.userInfoUrl, {
    headers: { Authorization: `Bearer ${tokenBody.access_token}`, Accept: 'application/json' },
  })
  if (!infoRes.ok) {
    console.error(`oauth ${provider} userinfo failed: ${infoRes.status}`)
    throw new OAuthError('Сервис не вернул профиль. Попробуйте ещё раз.', 502)
  }

  const raw = (await infoRes.json()) as Record<string, unknown>
  const profile = cfg.profile(raw)
  if (!profile.providerUserId || profile.providerUserId === 'undefined') {
    throw new OAuthError('Сервис не вернул идентификатор пользователя.', 502)
  }
  return profile
}
