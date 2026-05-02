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
  } catch {
    return null
  }
}
