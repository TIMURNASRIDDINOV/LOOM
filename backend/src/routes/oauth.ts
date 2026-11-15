import { Hono } from 'hono'
import type { BaseEnv } from '../types'

// Social sign-in is closed (PRD-216): the only way in is a phone number
// confirmed through Telegram (routes/telegram-auth.ts). The routes stay so an
// old app build gets a clear answer instead of a 404; lib/oauth.ts and the
// user_identities rows are kept for the release that removes them for good.

const router = new Hono<BaseEnv>()

export const SIGN_IN_CLOSED = {
  error: "Kirish faqat telefon raqami va Telegram orqali: loomdesign.uz. / Вход только по номеру телефона через Telegram: loomdesign.uz.",
  code: 'sign_in_method_closed',
}

// The sign-in sheet asks which buttons it may show: none.
router.get('/oauth/providers', (c) => c.json({ platform: c.req.query('platform') ?? 'android', providers: [] }))

router.post('/oauth/:provider', (c) => c.json(SIGN_IN_CLOSED, 410))

export default router
