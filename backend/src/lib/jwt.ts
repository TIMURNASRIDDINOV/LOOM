import { SignJWT, jwtVerify } from 'jose'

export type JwtRole = 'user' | 'admin'

export interface AppJwtPayload {
  sub: string
  role: JwtRole
  iat: number
  exp: number
}

function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

export async function signToken(
  payload: { sub: string; role: JwtRole },
  secret: string,
  expiresIn: string,
): Promise<string> {
  return new SignJWT({ role: payload.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(encodeSecret(secret))
}

export async function verifyToken(
  token: string,
  secret: string,
): Promise<AppJwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, encodeSecret(secret))
    if (!payload.sub || typeof payload.role !== 'string') return null
    return payload as unknown as AppJwtPayload
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code
    if (code === 'ERR_JWT_EXPIRED') {
      console.warn('[JWT] Token expired')
    } else {
      console.error('[JWT] Invalid or tampered token — code:', code ?? 'unknown')
    }
    return null
  }
}
