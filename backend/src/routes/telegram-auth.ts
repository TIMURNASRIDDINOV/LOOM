import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import {
  createAuthSession,
  getAuthSession,
  getActiveAuthSessionByPhone,
  setAuthSessionTelegramUser,
  getPendingAuthSessionByTelegramUser,
  markAuthSessionVerified,
  markAuthSessionFailed,
  upsertPhoneUser,
  insertUserActivity,
} from '../db/queries'
import { signToken } from '../lib/jwt'
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

  const phone = normalizePhone(rawPhone.trim())
  if (!isValidE164(phone)) {
    return c.json({ error: 'Invalid phone number. Use international format, e.g. +998901234567' }, 400)
  }

  const botUsername = c.env.BOT_USERNAME
  if (!botUsername || !botUsername.trim()) {
    // Loud: this disables the entire phone-auth flow. Fix wrangler.toml [vars]
    // BOT_USERNAME or set it as a secret in the Cloudflare dashboard.
    console.error(
      '[TelegramAuth] CRITICAL: BOT_USERNAME is empty. Phone/Telegram login is disabled. ' +
      'Set it in backend/wrangler.toml [vars] or via `wrangler secret put BOT_USERNAME`, then redeploy.',
    )
    return c.json({ error: 'Bot not configured (BOT_USERNAME is empty)' }, 503)
  }

  // Reuse pending session if one exists for this phone
  const existing = await getActiveAuthSessionByPhone(c.env.DB, phone)
  if (existing) {
    return c.json({
      session_id: existing.id,
      telegram_deep_link: `https://t.me/${botUsername}?start=${existing.id}`,
      expires_at: existing.expires_at,
    })
  }

  // Create new session
  const sessionId = crypto.randomUUID()
  const expiresAt = Date.now() + 10 * 60 * 1000  // 10 minutes

  await createAuthSession(c.env.DB, { id: sessionId, phone, expires_at: expiresAt })

  return c.json({
    session_id: sessionId,
    telegram_deep_link: `https://t.me/${botUsername}?start=${sessionId}`,
    expires_at: expiresAt,
  })
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
    return c.json({ status: 'verified' })
  }

  return c.json({ status: session.status })
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
      await sendTelegramMessage(botToken, msg.chat.id, 'Откройте looom.me и введите номер телефона для входа.')
      return c.json({ ok: true })
    }

    const session = await getAuthSession(c.env.DB, sessionId)
    if (!session || session.status !== 'pending' || Date.now() > session.expires_at) {
      await sendTelegramMessage(
        botToken,
        msg.chat.id,
        '❌ Ссылка устарела или уже использована. Вернитесь на looom.me и запросите новую.',
      )
      return c.json({ ok: true })
    }

    // Associate this Telegram user with the session
    await setAuthSessionTelegramUser(c.env.DB, sessionId, telegramUserId)

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

    // Find the pending session for this Telegram user
    const session = await getPendingAuthSessionByTelegramUser(c.env.DB, telegramUserId)
    if (!session) {
      await sendTelegramMessage(
        botToken,
        msg.chat.id,
        '❌ Сессия не найдена или истекла. Вернитесь на looom.me и попробуйте снова.',
      )
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
        '✅ Вы успешно вошли в систему! Можете закрыть этот чат и вернуться на looom.me.',
        undefined,
        true,  // remove keyboard
      )
    } catch (err) {
      console.error('[TelegramAuth] upsertPhoneUser failed:', err)
      await markAuthSessionFailed(c.env.DB, session.id)
      await sendTelegramMessage(
        botToken,
        msg.chat.id,
        '❌ Произошла ошибка. Попробуйте снова на looom.me.',
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
    text: '📱 Нажмите кнопку ниже, чтобы поделиться номером телефона и войти в looom.me.',
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
