// Telegram Mini App initData validation.
//
// Telegram signs the data it injects into a Mini App WebView:
//   secret_key = HMAC_SHA256(key = "WebAppData", message = bot_token)
//   hash       = hex(HMAC_SHA256(key = secret_key, message = data_check_string))
// where data_check_string is every field except `hash`, URL-decoded,
// serialized as "key=value", sorted alphabetically and joined with "\n".
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
//
// A valid signature proves the payload was produced by Telegram for OUR bot,
// so the embedded user.id can be trusted as an authenticated Telegram identity.

export interface WebAppUser {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
  photo_url?: string
}

export interface ValidatedInitData {
  user: WebAppUser
  auth_date: number
}

// Telegram issues fresh initData every time the Mini App is opened, so stale
// payloads are replays. 24 h tolerates a webview the user left open overnight.
export const INIT_DATA_MAX_AGE_S = 24 * 60 * 60

const encoder = new TextEncoder()

async function hmacSha256(key: BufferSource, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message))
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Constant-time comparison so the hash check cannot be probed byte-by-byte.
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function validateWebAppInitData(
  initData: string,
  botToken: string,
  nowMs: number = Date.now(),
): Promise<ValidatedInitData | null> {
  if (!initData || initData.length > 8192) return null

  let params: URLSearchParams
  try {
    params = new URLSearchParams(initData)
  } catch {
    return null
  }

  const hash = params.get('hash')
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null
  params.delete('hash')

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n')

  const secretKey = await hmacSha256(encoder.encode('WebAppData'), botToken)
  const expected = toHex(await hmacSha256(secretKey, dataCheckString))
  if (!timingSafeEqualHex(expected, hash.toLowerCase())) return null

  const authDate = parseInt(params.get('auth_date') ?? '', 10)
  if (!Number.isFinite(authDate)) return null
  if (nowMs / 1000 - authDate > INIT_DATA_MAX_AGE_S) return null

  const userJson = params.get('user')
  if (!userJson) return null
  let user: WebAppUser
  try {
    user = JSON.parse(userJson) as WebAppUser
  } catch {
    return null
  }
  if (typeof user?.id !== 'number' || !Number.isInteger(user.id) || user.id <= 0) return null

  return { user, auth_date: authDate }
}
