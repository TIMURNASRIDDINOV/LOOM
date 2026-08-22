import * as AuthSession from 'expo-auth-session'
import { api, API_BASE } from './client'
import type { Me } from './types'

// Social sign-in, PKCE half.
//
// The app never sees a client secret: it runs the authorization step in the
// system browser, then hands the resulting code to the Worker, which does the
// token exchange (see backend/src/routes/oauth.ts).

export type ProviderId = 'google' | 'facebook' | 'discord'

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  google: 'Google',
  facebook: 'Facebook',
  discord: 'Discord',
}

type Endpoints = {
  authorizationEndpoint: string
  tokenEndpoint: string
  scopes: string[]
  /** Google needs this to hand back a refreshable code; the others ignore it. */
  extraParams?: Record<string, string>
  usePKCE: boolean
}

const ENDPOINTS: Record<ProviderId, Endpoints> = {
  google: {
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    scopes: ['openid', 'profile', 'email'],
    usePKCE: true,
  },
  facebook: {
    authorizationEndpoint: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenEndpoint: 'https://graph.facebook.com/v19.0/oauth/access_token',
    scopes: ['public_profile', 'email'],
    usePKCE: true,
  },
  discord: {
    authorizationEndpoint: 'https://discord.com/api/oauth2/authorize',
    tokenEndpoint: 'https://discord.com/api/oauth2/token',
    scopes: ['identify', 'email'],
    usePKCE: true,
  },
}

/** A provider this deployment can complete, with its public client id. */
export type ProviderInfo = { id: ProviderId; clientId: string }

/**
 * Which providers the Worker can actually finish a sign-in for, and the client
 * id to build each authorization URL with. Served rather than hardcoded so the
 * app can never disagree with the deployment about what is live.
 */
export async function fetchProviders(): Promise<ProviderInfo[]> {
  const res = await api<{ providers: { id: ProviderId; client_id: string }[] }>(
    '/api/auth/oauth/providers',
  )
  return (res.providers ?? [])
    .filter((p) => p && typeof p.client_id === 'string' && p.client_id.length > 0)
    .map((p) => ({ id: p.id, clientId: p.client_id }))
}

export function redirectUri(): string {
  // `loom://redirect` — matches the `scheme` in app.json. Register this exact
  // string with each provider.
  return AuthSession.makeRedirectUri({ scheme: 'loom', path: 'redirect' })
}

export class OAuthCancelled extends Error {
  constructor() {
    super('cancelled')
  }
}

/**
 * Run the browser half of the flow and exchange the code with our Worker.
 * Resolves with the same `{ token, user }` shape as email sign-in.
 */
export async function signInWithProvider(
  provider: ProviderId,
  clientId: string,
): Promise<{ token: string; user: Me }> {
  const cfg = ENDPOINTS[provider]
  const uri = redirectUri()

  const request = new AuthSession.AuthRequest({
    clientId,
    scopes: cfg.scopes,
    redirectUri: uri,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: cfg.usePKCE,
    extraParams: cfg.extraParams,
  })

  // Only the authorization endpoint matters here — the Worker owns the token
  // exchange, so no token endpoint is handed to the browser step.
  const result = await request.promptAsync({
    authorizationEndpoint: cfg.authorizationEndpoint,
  })

  if (result.type === 'cancel' || result.type === 'dismiss') throw new OAuthCancelled()
  if (result.type !== 'success' || !result.params.code) {
    const desc = result.type === 'error' ? result.params?.error_description : null
    throw new Error(desc || 'Не удалось войти через этот сервис')
  }

  return api<{ token: string; user: Me }>(`/api/auth/oauth/${provider}`, {
    method: 'POST',
    body: {
      code: result.params.code,
      redirect_uri: uri,
      code_verifier: request.codeVerifier,
    },
  })
}

/** Shown in the setup docs so the redirect URI can be copied exactly. */
export const OAUTH_DEBUG = { API_BASE, redirectUri }
