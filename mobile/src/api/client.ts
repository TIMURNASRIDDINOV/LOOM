import Constants from 'expo-constants'
import * as SecureStore from 'expo-secure-store'

// `EXPO_PUBLIC_API_BASE` lets a dev build or the web preview point at a local
// Worker / CORS proxy without touching app.json; production builds carry the
// value from `extra.apiBase`.
export const API_BASE: string =
  process.env.EXPO_PUBLIC_API_BASE ??
  (Constants.expoConfig?.extra as { apiBase?: string } | undefined)?.apiBase ??
  'https://api.loomdesign.uz'

const TOKEN_KEY = 'loom_user_token'

// The web storefront rides on the `user_token` httpOnly cookie. A native client
// has no cookie jar to lean on, so it keeps the same JWT in the keychain and
// sends it as a Bearer token — the backend accepts either (see routes/public.ts).

let cached: string | null = null

export async function getToken(): Promise<string | null> {
  if (cached !== null) return cached
  try {
    cached = await SecureStore.getItemAsync(TOKEN_KEY)
  } catch {
    cached = null
  }
  return cached
}

export async function setToken(token: string | null): Promise<void> {
  cached = token
  try {
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token)
    else await SecureStore.deleteItemAsync(TOKEN_KEY)
  } catch {
    // Keychain unavailable (simulator reset, locked device) — the in-memory
    // copy still carries the session for this launch.
  }
}

export class ApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

type Options = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  auth?: boolean
  signal?: AbortSignal
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const { method = 'GET', body, auth = false, signal } = opts
  const headers: Record<string, string> = { Accept: 'application/json' }

  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth) {
    const token = await getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError('Нет соединения. Проверьте интернет.', 0)
  }

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      // Non-JSON body (an HTML error page from the edge, say).
    }
  }

  if (!res.ok) {
    const d = data as { error?: unknown; code?: string } | null
    // Admin product routes use `{ ok:false, error:{ code, message } }`; every
    // other route uses `{ error: string }`. Handle both shapes.
    const err = d?.error
    const message =
      typeof err === 'string'
        ? err
        : typeof (err as { message?: string })?.message === 'string'
          ? (err as { message: string }).message
          : `Ошибка ${res.status}`
    const code = d?.code ?? (err as { code?: string })?.code
    throw new ApiError(message, res.status, code)
  }

  return data as T
}

/** Multipart upload to `POST /api/uploads` → `{ key }`. */
export async function uploadFile(uri: string, name: string, type: string): Promise<string> {
  const form = new FormData()
  // React Native's FormData takes this {uri,name,type} shape rather than a Blob.
  form.append('file', { uri, name, type } as unknown as Blob)

  const token = await getToken()
  const res = await fetch(`${API_BASE}/api/uploads`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  })

  const data = (await res.json().catch(() => null)) as { key?: string; error?: string } | null
  if (!res.ok || !data?.key) {
    throw new ApiError(data?.error ?? 'Не удалось загрузить файл', res.status)
  }
  return data.key
}
