// PBKDF2 password hashing via WebCrypto — works in Cloudflare Workers
// Format: pbkdf2$<iterations>$<base64-salt>$<base64-hash>

const ITERATIONS = 100_000
const HASH_BITS = 256   // 32 bytes
const SALT_BYTES = 16

function bufToBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

function base64ToBuf(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  )
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    HASH_BITS,
  )
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await deriveKey(password, salt, ITERATIONS)
  return `pbkdf2$${ITERATIONS}$${bufToBase64(salt.buffer)}$${bufToBase64(hash)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false

  const iterations = parseInt(parts[1], 10)
  if (Number.isNaN(iterations) || iterations < 1) return false

  const salt = base64ToBuf(parts[2])
  const expected = base64ToBuf(parts[3])
  const actual = new Uint8Array(await deriveKey(password, salt, iterations))

  // Constant-time comparison
  if (actual.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i]
  return diff === 0
}
