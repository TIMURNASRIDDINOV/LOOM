// Sign-in with a code that Telegram Gateway sends to the buyer's Telegram
// (LOOM-362). The buyer types a +998 number, gets a code in the official
// "Verification Codes" chat and types it here, without leaving the page.
// The bot round-trip in telegram-auth.ts stays as the fallback.
//
//   POST /api/auth/code/send   { phone }          → { ticket, expires_at }
//   POST /api/auth/code/check  { ticket, code }   → { status: 'verified' } + user_token cookie
//
// No secret = 503 gateway_off; a number Telegram cannot reach = 422
// no_telegram. The site falls back to the bot flow on both.
//   wrangler secret put TELEGRAM_GATEWAY_TOKEN

import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { upsertPhoneOnlyUser, insertUserActivity } from '../db/queries'
import { signToken } from '../lib/jwt'
import { clientIp, isRateLimited, tooManyFailures, recordFailure, TOO_MANY } from '../lib/rateLimit'
import type { BaseEnv } from '../types'

const GATEWAY = 'https://gatewayapi.telegram.org/'
const CODE_TTL_SEC = 300
const USER_COOKIE_MAX_AGE = 30 * 24 * 60 * 60
// Every sent code costs money; this caps what a flood of random numbers can burn.
const DAILY_SEND_CAP = 300

type GatewayResult = {
  ok: boolean
  error?: string
  result?: { request_id: string; verification_status?: { status: string } }
}

async function gateway(token: string, method: string, body: Record<string, unknown>): Promise<GatewayResult> {
  const res = await fetch(GATEWAY + method, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return (await res.json()) as GatewayResult
}

function uzPhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let d = raw.replace(/\D/g, '')
  if (d.length === 9) d = '998' + d
  return /^998\d{9}$/.test(d) ? '+' + d : null
}

const router = new Hono<BaseEnv>()

router.post('/code/send', async (c) => {
  const token = c.env.TELEGRAM_GATEWAY_TOKEN
  if (!token) return c.json({ error: 'gateway_off' }, 503)

  let body: Record<string, unknown>
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  const phone = uzPhone(body.phone)
  if (!phone) return c.json({ error: 'bad_phone' }, 400)

  if (
    (await isRateLimited(c.env.RATE_LIMIT, `code-send:ip:${clientIp(c)}`, 6, 10 * 60)) ||
    (await isRateLimited(c.env.RATE_LIMIT, `code-send:phone:${phone}`, 3, 10 * 60))
  ) return c.json(TOO_MANY, 429)
  const day = new Date().toISOString().slice(0, 10)
  if (await isRateLimited(c.env.RATE_LIMIT, `code-send:day:${day}`, DAILY_SEND_CAP, 26 * 60 * 60)) {
    return c.json({ error: 'gateway_off' }, 503)
  }

  let r: GatewayResult
  try {
    r = await gateway(token, 'sendVerificationMessage', { phone_number: phone, code_length: 6, ttl: CODE_TTL_SEC })
  } catch (err) {
    console.error('[CodeAuth] gateway unreachable:', err)
    return c.json({ error: 'gateway_off' }, 503)
  }
  if (!r.ok || !r.result?.request_id) {
    // Out of budget or a bad token is our problem, not the buyer's: use the bot.
    console.error('[CodeAuth] sendVerificationMessage refused:', r.error)
    const ours = /BALANCE|TOKEN|ACCESS/i.test(r.error ?? '')
    return c.json({ error: ours ? 'gateway_off' : 'no_telegram' }, ours ? 503 : 422)
  }

  const ticket = crypto.randomUUID()
  await c.env.RATE_LIMIT.put(`code-ticket:${ticket}`, JSON.stringify({ rid: r.result.request_id, phone }), {
    expirationTtl: CODE_TTL_SEC + 60,
  })
  return c.json({ ticket, expires_at: Date.now() + CODE_TTL_SEC * 1000 })
})

router.post('/code/check', async (c) => {
  const token = c.env.TELEGRAM_GATEWAY_TOKEN
  if (!token) return c.json({ error: 'gateway_off' }, 503)

  let body: Record<string, unknown>
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  const { ticket, code } = body
  if (typeof ticket !== 'string' || typeof code !== 'string' || !/^\d{4,8}$/.test(code)) {
    return c.json({ status: 'code_invalid' })
  }

  const failKey = [`code-check:ip:${clientIp(c)}`]
  if (await tooManyFailures(c.env.RATE_LIMIT, failKey, 15)) return c.json(TOO_MANY, 429)

  const saved = await c.env.RATE_LIMIT.get(`code-ticket:${ticket}`)
  if (!saved) return c.json({ status: 'expired' })
  const { rid, phone } = JSON.parse(saved) as { rid: string; phone: string }

  let r: GatewayResult
  try {
    r = await gateway(token, 'checkVerificationStatus', { request_id: rid, code })
  } catch (err) {
    console.error('[CodeAuth] gateway unreachable:', err)
    return c.json({ error: 'gateway_off' }, 503)
  }
  const status = r.result?.verification_status?.status ?? 'code_invalid'
  if (status !== 'code_valid') {
    await recordFailure(c.env.RATE_LIMIT, failKey, 10 * 60)
    return c.json({ status })
  }

  await c.env.RATE_LIMIT.delete(`code-ticket:${ticket}`) // one sign-in per code
  const userId = await upsertPhoneOnlyUser(c.env.DB, phone)
  const jwt = await signToken({ sub: String(userId), role: 'user' }, c.env.JWT_SECRET, '30d')
  setCookie(c, 'user_token', jwt, {
    httpOnly: true, secure: true, sameSite: 'Lax', maxAge: USER_COOKIE_MAX_AGE, path: '/',
  })
  await insertUserActivity(c.env.DB, { user_id: userId, action: 'login', metadata: { via: 'telegram_code' } })
  return c.json({ status: 'verified' })
})

export default router
