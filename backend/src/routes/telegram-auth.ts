import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import {
  createAuthSession,
  getAuthSession,
  getActiveAuthSessionByPhone,
  setAuthSessionTelegramUser,
  getPendingAuthSessionsByTelegramUser,
  getPendingWebappSessionByTelegramUser,
  markAuthSessionVerified,
  markAuthSessionFailed,
  markAuthSessionUsed,
  upsertPhoneUser,
  upsertTelegramWebappUser,
  insertUserActivity,
  getUserByPhone,
  getUserById,
  getUserByTelegramId,
  updateUserPassword,
} from '../db/queries'
import { signToken } from '../lib/jwt'
import { hashPassword } from '../lib/password'
import { validateWebAppInitData } from '../lib/telegram-webapp'
import type { BaseEnv } from '../types'

const USER_COOKIE_MAX_AGE = 30 * 24 * 60 * 60  // 30 days

const router = new Hono<BaseEnv>()

// ─── Phone normalization ─────────────────────────────────────────────────────

function normalizePhone(raw: string): string {
  let p = raw.replace(/[\s\-\(\)]/g, '')
  if (!p.startsWith('+')) {
    if (p.startsWith('998')) p = '+' + p
    else if (p.startsWith('0')) p = '+998' + p.slice(1)
    else p = '+' + p
  }
  return p
}

function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone)
}

// Telegram phone numbers come without the leading +
function normalizeTelegramPhone(raw: string): string {
  const stripped = raw.replace(/\D/g, '')
  return '+' + stripped
}

// ─── POST /api/auth/telegram/start ───────────────────────────────────────────

router.post('/telegram/start', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { phone: rawPhone } = body as Record<string, unknown>
  if (typeof rawPhone !== 'string' || !rawPhone.trim()) {
    return c.json({ error: 'phone is required' }, 400)
  }
  // purpose: 'login' (default) or 'reset' (forgot-password recovery)
  const purpose = (body as Record<string, unknown>).purpose === 'reset' ? 'reset' : 'login'

  const phone = normalizePhone(rawPhone.trim())
  if (!isValidE164(phone)) {
    return c.json({ error: 'Invalid phone number. Use international format, e.g. +998901234567' }, 400)
  }

  const botUsername = c.env.BOT_USERNAME
  if (!botUsername) {
    console.error('[TelegramAuth] BOT_USERNAME env var not set')
    return c.json({ error: 'Bot not configured' }, 503)
  }

  // For login we reuse an active pending session; reset always starts fresh.
  if (purpose === 'login') {
    const existing = await getActiveAuthSessionByPhone(c.env.DB, phone)
    if (existing && existing.purpose === 'login') {
      return c.json({
        session_id: existing.id,
        telegram_deep_link: `https://t.me/${botUsername}?start=${existing.id}`,
        expires_at: existing.expires_at,
      })
    }
  }

  // Create new session
  const sessionId = crypto.randomUUID()
  const expiresAt = Date.now() + 10 * 60 * 1000  // 10 minutes

  await createAuthSession(c.env.DB, { id: sessionId, phone, expires_at: expiresAt, purpose })

  return c.json({
    session_id: sessionId,
    telegram_deep_link: `https://t.me/${botUsername}?start=${sessionId}`,
    expires_at: expiresAt,
    purpose,
  })
})

// ─── POST /api/auth/telegram/webapp ──────────────────────────────────────────
// Telegram Mini App login. The Mini App posts window.Telegram.WebApp.initData;
// a valid Telegram HMAC signature on it proves the request comes from this
// bot's Mini App session for that Telegram user — no password or SMS needed.
//
// The token is also returned in the body (not only as a cookie) because in
// Telegram-Web the Mini App runs inside an iframe on web.telegram.org, where
// the SameSite=Lax cookie for api.loomdesign.uz is never sent.

router.post('/telegram/webapp', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const initData = (body as Record<string, unknown>).init_data
  if (typeof initData !== 'string' || !initData) {
    return c.json({ error: 'init_data is required' }, 400)
  }

  const botToken = c.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    console.error('[TelegramWebApp] TELEGRAM_BOT_TOKEN env var not set')
    return c.json({ error: 'Bot not configured' }, 503)
  }

  const data = await validateWebAppInitData(initData, botToken)
  if (!data) return c.json({ error: 'Invalid init data' }, 401)

  const existing = await getUserByTelegramId(c.env.DB, data.user.id)
  if (existing) {
    if (existing.status === 'banned') {
      return c.json({ error: 'Your account has been blocked' }, 403)
    }

    const jwt = await signToken({ sub: String(existing.id), role: 'user' }, c.env.JWT_SECRET, '30d')
    setCookie(c, 'user_token', jwt, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: USER_COOKIE_MAX_AGE,
      path: '/',
    })
    await insertUserActivity(c.env.DB, {
      user_id: existing.id,
      action: 'login',
      metadata: { via: 'telegram_webapp', telegram_user_id: data.user.id },
    })
    return c.json({ status: 'ok', token: jwt })
  }

  // No linked account yet. The Mini App calls Telegram.WebApp.requestContact();
  // the shared contact lands on the bot webhook, which completes this session
  // (purpose='webapp' — phone is unknown until the contact arrives).
  //
  // Reuse a live session for this Telegram user: tma.js calls this on any page
  // load where the visitor is not logged in, and a row per navigation would
  // pile up unbounded (nothing sweeps auth_sessions).
  const openSession = await getPendingWebappSessionByTelegramUser(c.env.DB, data.user.id)
  if (openSession) {
    return c.json({ status: 'need_contact', session_id: openSession.id, expires_at: openSession.expires_at })
  }

  const sessionId = crypto.randomUUID()
  const expiresAt = Date.now() + 10 * 60 * 1000  // 10 minutes

  await createAuthSession(c.env.DB, { id: sessionId, phone: '', expires_at: expiresAt, purpose: 'webapp' })
  await setAuthSessionTelegramUser(c.env.DB, sessionId, data.user.id)

  return c.json({ status: 'need_contact', session_id: sessionId, expires_at: expiresAt })
})

// ─── GET /api/auth/telegram/status ───────────────────────────────────────────

router.get('/telegram/status', async (c) => {
  const sessionId = c.req.query('session_id')
  if (!sessionId) return c.json({ error: 'session_id is required' }, 400)

  const session = await getAuthSession(c.env.DB, sessionId)
  if (!session) return c.json({ error: 'Session not found' }, 404)

  if (session.status === 'pending' && Date.now() > session.expires_at) {
    return c.json({ status: 'expired' })
  }

  if (session.status === 'verified' && session.jwt) {
    // Set httpOnly cookie and return verified status
    setCookie(c, 'user_token', session.jwt, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: USER_COOKIE_MAX_AGE,
      path: '/',
    })

    // Two kinds of caller cannot use that cookie and need the token in the body:
    //
    //   · Mini App  — inside Telegram-Web's iframe the cookie is third-party and
    //                 never comes back (see /telegram/webapp).
    //   · Native app — has no cookie jar at all. It opens the bot deep link and
    //                 polls with ?client=app. Without this the phone flow verified
    //                 server-side, the bot said "you're logged in", and the app
    //                 was handed nothing — so it stayed signed out.
    //
    // Either way, handing the token out consumes the session, so a leaked
    // session_id cannot be replayed as a bearer-token dispenser for the whole
    // 30-day life of the JWT. The web keeps polling on the cookie and is
    // deliberately left alone.
    const wantsBodyToken = session.purpose === 'webapp' || c.req.query('client') === 'app'
    if (wantsBodyToken) {
      await markAuthSessionUsed(c.env.DB, sessionId)
      return c.json({ status: 'verified', token: session.jwt })
    }
    return c.json({ status: 'verified' })
  }

  return c.json({ status: session.status })
})

// ─── POST /api/auth/reset-password ────────────────────────────────────────────
// Sets a new password using a Telegram-VERIFIED reset session (see purpose='reset').

router.post('/reset-password', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  const { session_id, new_password } = body as Record<string, unknown>
  if (typeof session_id !== 'string' || !session_id) return c.json({ error: 'session_id is required' }, 400)
  if (typeof new_password !== 'string' || new_password.length < 8) {
    return c.json({ error: 'Пароль должен содержать минимум 8 символов' }, 400)
  }

  const session = await getAuthSession(c.env.DB, session_id)
  if (!session || session.purpose !== 'reset' || session.status !== 'verified' || !session.user_id) {
    return c.json({ error: 'Сессия недействительна. Запросите сброс заново.' }, 400)
  }
  if (Date.now() > session.expires_at) {
    return c.json({ error: 'Время сессии истекло. Запросите сброс заново.' }, 400)
  }

  const hash = await hashPassword(new_password)
  await updateUserPassword(c.env.DB, session.user_id, hash)
  await markAuthSessionUsed(c.env.DB, session_id) // one-time use
  await insertUserActivity(c.env.DB, {
    user_id: session.user_id, action: 'password_reset', metadata: { via: 'telegram' },
  })
  return c.json({ ok: true })
})

// ─── POST /api/auth/logout ────────────────────────────────────────────────────

router.post('/logout', (c) => {
  deleteCookie(c, 'user_token', { path: '/' })
  return c.json({ ok: true })
})

// ─── POST /api/telegram/webhook ──────────────────────────────────────────────

const webhookRouter = new Hono<BaseEnv>()

webhookRouter.post('/webhook', async (c) => {
  // Verify secret token header
  const secret = c.req.header('X-Telegram-Bot-Api-Secret-Token')
  if (!c.env.TELEGRAM_WEBHOOK_SECRET || secret !== c.env.TELEGRAM_WEBHOOK_SECRET) {
    // Return 200 to prevent Telegram retries; log nothing identifiable
    return c.json({ ok: true })
  }

  let update: TelegramUpdate
  try {
    update = await c.req.json() as TelegramUpdate
  } catch {
    return c.json({ ok: true })
  }

  const msg = update.message
  if (!msg) return c.json({ ok: true })

  const botToken = c.env.TELEGRAM_BOT_TOKEN
  const telegramUserId = msg.from?.id
  if (!telegramUserId) return c.json({ ok: true })

  // Handle /start <session_id>
  if (msg.text?.startsWith('/start') && msg.entities?.some(e => e.type === 'bot_command')) {
    const parts = msg.text.split(' ')
    const sessionId = parts[1]?.trim()

    if (!sessionId) {
      await sendTelegramMessage(botToken, msg.chat.id, 'Откройте loomdesign.uz и введите номер телефона для входа.')
      return c.json({ ok: true })
    }

    const session = await getAuthSession(c.env.DB, sessionId)
    // A deep link may only ever drive a session the WEBSITE started and that no
    // Telegram user has claimed yet. Mini App sessions ('webapp') are bound to a
    // Telegram identity at creation from signed initData, so accepting one here
    // would let an attacker forward their own session_id and have the victim who
    // taps it — and shares their own contact — verify it, handing the attacker a
    // token for the victim's account.
    if (
      !session ||
      session.status !== 'pending' ||
      Date.now() > session.expires_at ||
      session.purpose === 'webapp' ||
      session.telegram_user_id !== null
    ) {
      await sendTelegramMessage(
        botToken,
        msg.chat.id,
        '❌ Ссылка устарела или уже использована. Вернитесь на loomdesign.uz и запросите новую.',
      )
      return c.json({ ok: true })
    }

    // Associate this Telegram user with the session. Loses the race (and stops)
    // if another Telegram user claimed it between the read and here.
    const bound = await setAuthSessionTelegramUser(c.env.DB, sessionId, telegramUserId)
    if (!bound) {
      await sendTelegramMessage(
        botToken,
        msg.chat.id,
        '❌ Ссылка устарела или уже использована. Вернитесь на loomdesign.uz и запросите новую.',
      )
      return c.json({ ok: true })
    }

    // Ask for phone number
    await sendContactRequest(botToken, msg.chat.id)
    return c.json({ ok: true })
  }

  // Handle contact share
  if (msg.contact) {
    const contact = msg.contact
    const sharedPhone = normalizeTelegramPhone(contact.phone_number)

    // The contact.user_id field confirms the user shared their own phone
    const contactUserId = contact.user_id
    if (!contactUserId || contactUserId !== telegramUserId) {
      await sendTelegramMessage(
        botToken,
        msg.chat.id,
        '❌ Пожалуйста, поделитесь своим собственным номером телефона.',
      )
      return c.json({ ok: true })
    }

    // Find the pending session this contact is answering. A Mini App session is
    // created on page load, so "newest wins" would let it shadow the website
    // login/reset the user deliberately started and is polling right now.
    // Prefer a website session whose phone actually matches the shared contact.
    const pending = await getPendingAuthSessionsByTelegramUser(c.env.DB, telegramUserId)
    const session =
      pending.find(s => s.purpose !== 'webapp' && s.phone === sharedPhone) ??
      pending[0] ??
      null
    if (!session) {
      await sendTelegramMessage(
        botToken,
        msg.chat.id,
        '❌ Сессия не найдена или истекла. Вернитесь на loomdesign.uz и попробуйте снова.',
      )
      return c.json({ ok: true })
    }

    // Mini App onboarding (purpose='webapp'): the session carries no phone —
    // it was created from signed initData, and the shared contact IS the phone.
    // The session's telegram_user_id came from that initData and can no longer
    // be rebound (see setAuthSessionTelegramUser), so this Telegram user really
    // is the one who opened the Mini App.
    if (session.purpose === 'webapp') {
      if (!isValidE164(sharedPhone)) {
        await markAuthSessionFailed(c.env.DB, session.id)
        await sendTelegramMessage(
          botToken, msg.chat.id,
          '❌ Не удалось распознать номер телефона. Откройте мини-приложение заново.', undefined, true,
        )
        return c.json({ ok: true })
      }

      try {
        const { userId, conflict } = await upsertTelegramWebappUser(c.env.DB, {
          phone: sharedPhone,
          telegram_user_id: telegramUserId,
          telegram_username: msg.from?.username ?? null,
          first_name: msg.from?.first_name ?? null,
          last_name: msg.from?.last_name ?? null,
        })

        // This phone already belongs to an account linked to a DIFFERENT
        // Telegram user. Issuing a token here would hand over that account.
        if (conflict || !userId) {
          await markAuthSessionFailed(c.env.DB, session.id)
          await sendTelegramMessage(
            botToken, msg.chat.id,
            '❌ Этот номер уже привязан к другому аккаунту Telegram. Войдите на loomdesign.uz по паролю или напишите нам.',
            undefined, true,
          )
          return c.json({ ok: true })
        }

        const user = await getUserById(c.env.DB, userId)
        if (user?.status === 'banned') {
          await markAuthSessionFailed(c.env.DB, session.id)
          await sendTelegramMessage(
            botToken, msg.chat.id,
            '❌ Доступ к аккаунту заблокирован.', undefined, true,
          )
          return c.json({ ok: true })
        }

        const jwt = await signToken({ sub: String(userId), role: 'user' }, c.env.JWT_SECRET, '30d')
        await markAuthSessionVerified(c.env.DB, session.id, userId, jwt)
        await insertUserActivity(c.env.DB, {
          user_id: userId,
          action: 'login',
          metadata: { via: 'telegram_webapp', telegram_user_id: telegramUserId },
        })

        await sendTelegramMessage(
          botToken,
          msg.chat.id,
          '✅ Номер подтверждён! Вернитесь в мини-приложение LOOM — вы уже вошли в систему.',
          undefined,
          true,  // remove keyboard
        )
      } catch (err) {
        console.error('[TelegramWebApp] upsertTelegramWebappUser failed:', err)
        await markAuthSessionFailed(c.env.DB, session.id)
        await sendTelegramMessage(
          botToken,
          msg.chat.id,
          '❌ Произошла ошибка. Откройте мини-приложение заново и попробуйте ещё раз.',
        )
      }
      return c.json({ ok: true })
    }

    // Compare phones (normalize both to E.164)
    if (sharedPhone !== session.phone) {
      await markAuthSessionFailed(c.env.DB, session.id)
      await sendTelegramMessage(
        botToken,
        msg.chat.id,
        `❌ Номер телефона не совпадает. Вы ввели ${session.phone}, а поделились ${sharedPhone}. Вернитесь на сайт и введите правильный номер.`,
      )
      return c.json({ ok: true })
    }

    // ── Password recovery: verify ownership, then let the site set a new password ──
    if (session.purpose === 'reset') {
      const u = await getUserByPhone(c.env.DB, session.phone)
      if (!u) {
        await markAuthSessionFailed(c.env.DB, session.id)
        await sendTelegramMessage(
          botToken, msg.chat.id,
          '❌ Аккаунт с этим номером не найден.', undefined, true,
        )
        return c.json({ ok: true })
      }
      await markAuthSessionVerified(c.env.DB, session.id, u.id, null) // no JWT — reset only
      await insertUserActivity(c.env.DB, {
        user_id: u.id, action: 'password_reset_verified',
        metadata: { via: 'telegram', telegram_user_id: telegramUserId },
      })
      await sendTelegramMessage(
        botToken, msg.chat.id,
        '✅ Номер подтверждён. Вернитесь на loomdesign.uz и задайте новый пароль.', undefined, true,
      )
      return c.json({ ok: true })
    }

    // Upsert user in DB
    try {
      const userId = await upsertPhoneUser(c.env.DB, {
        phone: session.phone,
        telegram_user_id: telegramUserId,
        telegram_username: msg.from?.username ?? null,
        first_name: msg.from?.first_name ?? null,
        last_name: msg.from?.last_name ?? null,
      })

      const jwt = await signToken({ sub: String(userId), role: 'user' }, c.env.JWT_SECRET, '30d')

      await markAuthSessionVerified(c.env.DB, session.id, userId, jwt)
      await insertUserActivity(c.env.DB, {
        user_id: userId,
        action: 'login',
        metadata: { via: 'telegram', telegram_user_id: telegramUserId },
      })

      await sendTelegramMessage(
        botToken,
        msg.chat.id,
        '✅ Вы успешно вошли в систему! Можете закрыть этот чат и вернуться на loomdesign.uz.',
        undefined,
        true,  // remove keyboard
      )
    } catch (err) {
      console.error('[TelegramAuth] upsertPhoneUser failed:', err)
      await markAuthSessionFailed(c.env.DB, session.id)
      await sendTelegramMessage(
        botToken,
        msg.chat.id,
        '❌ Произошла ошибка. Попробуйте снова на loomdesign.uz.',
      )
    }

    return c.json({ ok: true })
  }

  return c.json({ ok: true })
})

// ─── Telegram API helpers ─────────────────────────────────────────────────────

async function sendTelegramMessage(
  botToken: string,
  chatId: number,
  text: string,
  inlineButton?: { label: string; url: string },
  removeKeyboard?: boolean,
): Promise<void> {
  const payload: Record<string, unknown> = { chat_id: chatId, text }
  if (inlineButton) {
    payload.reply_markup = { inline_keyboard: [[{ text: inlineButton.label, url: inlineButton.url }]] }
  } else if (removeKeyboard) {
    payload.reply_markup = { remove_keyboard: true }
  }
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    console.error('[Telegram] sendMessage failed:', err)
  }
}

async function sendContactRequest(botToken: string, chatId: number): Promise<void> {
  const payload = {
    chat_id: chatId,
    text:
      '📱 Нажмите кнопку ниже, чтобы поделиться номером телефона и войти в loomdesign.uz.\n\n' +
      '⚠️ Если вы не начинали вход сами — не делитесь номером и закройте этот чат.',
    reply_markup: {
      keyboard: [[{ text: '📱 Поделиться номером телефона', request_contact: true }]],
      one_time_keyboard: true,
      resize_keyboard: true,
    },
  }
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    console.error('[Telegram] sendContactRequest failed:', err)
  }
}

// ─── Telegram update types ────────────────────────────────────────────────────

interface TelegramUser {
  id: number
  is_bot: boolean
  first_name: string
  last_name?: string
  username?: string
}

interface TelegramContact {
  phone_number: string
  first_name: string
  last_name?: string
  user_id?: number
}

interface TelegramMessageEntity {
  type: string
  offset: number
  length: number
}

interface TelegramMessage {
  message_id: number
  from?: TelegramUser
  chat: { id: number }
  text?: string
  contact?: TelegramContact
  entities?: TelegramMessageEntity[]
}

interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

export { webhookRouter }
export default router
