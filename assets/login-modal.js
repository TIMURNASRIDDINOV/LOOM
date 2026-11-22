'use strict';

/**
 * LOOM sign-in modal (configurator "Add to cart" / "Buy now").
 *
 * LOOM-362: phone → a 6-digit code that Telegram Gateway sends to the
 * buyer's Telegram → typed here. The buyer never leaves the page.
 * When the Gateway is off (503) or the number has no Telegram (422) the
 * modal falls back to the bot round-trip (/api/auth/telegram/start), with
 * a real button into the bot and numbered steps.
 *
 * Usage:
 *   window.LOOM_LOGIN_MODAL.open()          // resolves with the user
 *   window.LOOM_LOGIN_MODAL.requireAuth()   // resolves at once if signed in
 */

;(function () {
  const API = window.LOOM_CONFIG?.API_BASE ?? 'https://api.loomdesign.uz'
  const POLL_MS = 2_000
  const RESEND_SEC = 60

  // Copy lives in assets/i18n.js; the fallbacks are Uzbek, the site default.
  function t(key, fallback) {
    try {
      const s = window.LOOM_I18N && window.LOOM_I18N.t(key)
      return s && s !== key ? s : fallback
    } catch { return fallback }
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
  function track(name) {
    try { window.LOOM_TRACK && window.LOOM_TRACK.event(name) } catch { /* optional */ }
  }
  const TG_ICO = '<svg class="loom-modal__tg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.2 4.3 2.9 11.2c-1 .4-1 1.8.1 2l4.6 1.3 1.7 5c.3.9 1.4 1.1 2 .4l2.4-2.6 4.6 3.4c.8.6 1.9.1 2.1-.8l3-14.2c.2-1-.8-1.8-1.7-1.4z"/><path d="M7.6 14.5 18.6 6.4l-7.9 9.5"/></svg>'

  // ── Modal DOM ──────────────────────────────────────────────────────────────

  function buildModal() {
    const b = document.createElement('div')
    b.className = 'loom-modal-backdrop'
    b.setAttribute('role', 'dialog')
    b.setAttribute('aria-modal', 'true')
    b.setAttribute('aria-labelledby', 'lm-h-phone')
    b.innerHTML = `
      <div class="loom-modal" id="loom-modal-box">
        <button class="loom-modal__close" id="lm-close" aria-label="${esc(t('lm.close', 'Yopish'))}">✕</button>

        <form id="lm-step-phone" novalidate>
          <h2 class="loom-modal__title" id="lm-h-phone">${esc(t('lm.title', 'Raqamingizni kiriting'))}</h2>
          <p class="loom-modal__sub">${esc(t('lm.why', 'Dizayningiz saqlanadi. Buyurtma holatini Telegram orqali yuboramiz. Parol kerak emas.'))}</p>
          <div class="loom-modal__phone-wrap">
            <span class="loom-modal__phone-prefix">+998</span>
            <input id="lm-phone" class="loom-modal__phone-input" type="tel" inputmode="numeric"
              autocomplete="tel-national" placeholder="90 123 45 67" maxlength="12"
              aria-label="${esc(t('atl.login.phone', 'Telefon raqami'))}" aria-describedby="lm-phone-err" />
          </div>
          <button class="loom-modal__btn" id="lm-send" type="submit">${esc(t('lm.send', 'Davom etish'))}</button>
          <p class="loom-modal__error" id="lm-phone-err" role="alert"></p>
        </form>

        <form id="lm-step-code" novalidate hidden>
          <h2 class="loom-modal__title">${esc(t('lm.codeH', 'Telegramga kod yubordik'))}</h2>
          <p class="loom-modal__sub" id="lm-code-sub"></p>
          <input id="lm-code" class="loom-modal__code" type="text" inputmode="numeric" autocomplete="one-time-code"
            pattern="[0-9]*" maxlength="6" placeholder="••••••"
            aria-label="${esc(t('lm.codeLabel', 'Kod'))}" aria-describedby="lm-code-err" />
          <button class="loom-modal__btn" id="lm-check" type="submit">${esc(t('lm.check', 'Tasdiqlash'))}</button>
          <p class="loom-modal__error" id="lm-code-err" role="alert"></p>
          <div class="loom-modal__row">
            <button type="button" class="loom-modal__link" id="lm-resend" disabled></button>
            <button type="button" class="loom-modal__link" data-lm-back>${esc(t('atl.login.changeNum', 'Raqamni o‘zgartirish'))}</button>
          </div>
        </form>

        <div id="lm-step-bot" hidden>
          <h2 class="loom-modal__title">${esc(t('atl.login.waitH1', 'Telegramda tasdiqlang'))}</h2>
          <a id="lm-bot-link" href="#" target="_blank" rel="noopener" class="loom-modal__tg-link">${TG_ICO}<span>${esc(t('lm.botOpen', 'Telegramni ochish'))}</span></a>
          <ol class="loom-modal__steps">
            <li>${esc(t('lm.b1', 'Botda START ni bosing'))}</li>
            <li>${esc(t('lm.b2', '«Raqamni ulashish» ni bosing'))}</li>
            <li>${esc(t('lm.b3', 'Shu yerga qayting — o‘zi davom etadi'))}</li>
          </ol>
          <p class="loom-modal__error" id="lm-bot-err" role="alert"></p>
          <button type="button" class="loom-modal__link" data-lm-back>${esc(t('atl.login.changeNum', 'Raqamni o‘zgartirish'))}</button>
        </div>

        <div id="lm-step-done" hidden>
          <div class="loom-modal__success">
            <div class="loom-modal__success-icon">✅</div>
            <p class="loom-modal__success-title">${esc(t('lm.done', 'Kirdingiz!'))}</p>
          </div>
        </div>
      </div>`
    document.body.appendChild(b)
    return b
  }

  // ── State ──────────────────────────────────────────────────────────────────

  let backdrop = null
  let resolveLogin = null
  let rejectLogin = null
  let phone = ''          // 9 digits after +998
  let ticket = null       // code flow
  let botSession = null   // bot fallback
  let pollTimer = null
  let resendTimer = null

  const $ = (id) => document.getElementById(id)
  function digits(v) {
    let d = String(v || '').replace(/\D/g, '')
    if (d.length >= 12 && d.startsWith('998')) d = d.slice(3)
    return d.slice(0, 9)
  }
  function fmt(d) { return [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean).join(' ') }
  function setErr(id, msg) { const el = $(id); if (el) el.textContent = msg || '' }

  function show(step) {
    for (const s of ['phone', 'code', 'bot', 'done']) {
      const el = $('lm-step-' + s)
      if (el) el.hidden = s !== step
    }
    const focus = step === 'phone' ? $('lm-phone') : step === 'code' ? $('lm-code') : null
    if (focus) setTimeout(() => focus.focus(), 50)
  }

  function stopTimers() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    if (resendTimer) { clearInterval(resendTimer); resendTimer = null }
    document.removeEventListener('visibilitychange', onVisible)
  }

  function close(reason) {
    if (!backdrop) return
    stopTimers()
    document.removeEventListener('keydown', onKey)
    document.body.classList.remove('loom-modal-open')
    backdrop.classList.remove('visible')
    const b = backdrop
    setTimeout(() => b.remove(), 220)
    backdrop = null
    ticket = null
    botSession = null
    if (reason instanceof Error && rejectLogin) rejectLogin(reason)
    resolveLogin = null
    rejectLogin = null
  }
  function onKey(e) { if (e.key === 'Escape') close(new Error('cancelled')) }

  function open() {
    if (backdrop) return new Promise((res, rej) => { resolveLogin = res; rejectLogin = rej })

    backdrop = buildModal()
    document.body.classList.add('loom-modal-open')
    track('login_start')

    $('lm-close').addEventListener('click', () => close(new Error('cancelled')))
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(new Error('cancelled')) })
    document.addEventListener('keydown', onKey)

    const input = $('lm-phone')
    input.addEventListener('input', () => { input.value = fmt(digits(input.value)); setErr('lm-phone-err') })
    $('lm-step-phone').addEventListener('submit', (e) => { e.preventDefault(); sendCode() })

    const code = $('lm-code')
    code.addEventListener('input', () => {
      code.value = code.value.replace(/\D/g, '').slice(0, 6)
      setErr('lm-code-err')
      if (code.value.length === 6) checkCode()
    })
    $('lm-step-code').addEventListener('submit', (e) => { e.preventDefault(); checkCode() })
    $('lm-resend').addEventListener('click', () => sendCode())
    backdrop.querySelectorAll('[data-lm-back]').forEach((el) => el.addEventListener('click', () => {
      stopTimers(); ticket = null; botSession = null; show('phone')
    }))

    show('phone')
    requestAnimationFrame(() => requestAnimationFrame(() => backdrop && backdrop.classList.add('visible')))
    return new Promise((res, rej) => { resolveLogin = res; rejectLogin = rej })
  }

  // ── Code flow (Telegram Gateway) ───────────────────────────────────────────

  async function post(path, body) {
    const res = await fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
    })
    let data = {}
    try { data = await res.json() } catch { /* empty body */ }
    return { res, data }
  }

  let sending = false
  async function sendCode() {
    if (sending) return
    const d = digits($('lm-phone').value)
    if (d.length !== 9) { setErr('lm-phone-err', t('auth.errPhone', 'To‘liq telefon raqamini kiriting')); $('lm-phone').focus(); return }
    phone = d
    sending = true
    const btn = $('lm-send')
    btn.disabled = true
    btn.textContent = t('atl.sending', 'Yuborilmoqda…')
    try {
      const { res, data } = await post('/api/auth/code/send', { phone: '+998' + d })
      if (res.ok && data.ticket) {
        ticket = data.ticket
        track('login_code_sent')
        $('lm-code').value = ''
        setErr('lm-code-err')
        $('lm-code-sub').textContent = t('lm.codeSub', '+998 {phone} raqamidagi Telegramni oching: «Verification Codes» chatida 6 xonali kod bor.').replace('{phone}', fmt(d))
        show('code')
        startResendCountdown()
      } else if (res.status === 429) {
        setErr(ticket ? 'lm-code-err' : 'lm-phone-err', t('lm.errMany', 'Juda ko‘p urinish. Bir necha daqiqadan keyin qayta urinib ko‘ring.'))
      } else if (res.status === 400) {
        setErr('lm-phone-err', t('auth.errPhone', 'To‘liq telefon raqamini kiriting'))
      } else {
        await startBot() // gateway off, or this number has no Telegram
      }
    } catch {
      setErr(ticket ? 'lm-code-err' : 'lm-phone-err', t('lm.errNet', 'Internet aloqasi yo‘q. Qayta urinib ko‘ring.'))
    } finally {
      sending = false
      if ($('lm-send')) { btn.disabled = false; btn.textContent = t('lm.send', 'Davom etish') }
    }
  }

  function startResendCountdown() {
    const btn = $('lm-resend')
    let left = RESEND_SEC
    const paint = () => {
      btn.disabled = left > 0
      btn.textContent = left > 0
        ? t('lm.resendIn', 'Qayta yuborish: {s} s').replace('{s}', left)
        : t('lm.resend', 'Kodni qayta yuborish')
    }
    paint()
    if (resendTimer) clearInterval(resendTimer)
    resendTimer = setInterval(() => { left--; paint(); if (left <= 0) { clearInterval(resendTimer); resendTimer = null } }, 1000)
  }

  let checking = false
  async function checkCode() {
    const code = $('lm-code').value
    if (checking || !ticket) return
    if (code.length !== 6) { setErr('lm-code-err', t('lm.errCode', 'Kod noto‘g‘ri. Telegramdagi kodni tekshiring.')); return }
    checking = true
    $('lm-check').disabled = true
    try {
      const { res, data } = await post('/api/auth/code/check', { ticket, code })
      if (data.status === 'verified') return finish()
      if (res.status === 429) setErr('lm-code-err', t('lm.errMany', 'Juda ko‘p urinish. Bir necha daqiqadan keyin qayta urinib ko‘ring.'))
      else if (data.status === 'expired' || data.status === 'code_max_attempts_exceeded') {
        setErr('lm-code-err', t('lm.errExpired', 'Kod eskirdi. «Kodni qayta yuborish» ni bosing.'))
        if (resendTimer) { clearInterval(resendTimer); resendTimer = null }
        const r = $('lm-resend'); r.disabled = false; r.textContent = t('lm.resend', 'Kodni qayta yuborish')
      } else if (data.error === 'gateway_off') await startBot()
      else setErr('lm-code-err', t('lm.errCode', 'Kod noto‘g‘ri. Telegramdagi kodni tekshiring.'))
      $('lm-code').select()
    } catch {
      setErr('lm-code-err', t('lm.errNet', 'Internet aloqasi yo‘q. Qayta urinib ko‘ring.'))
    } finally {
      checking = false
      if ($('lm-check')) $('lm-check').disabled = false
    }
  }

  // ── Bot fallback ───────────────────────────────────────────────────────────

  async function startBot() {
    track('login_fallback_bot')
    const { res, data } = await post('/api/auth/telegram/start', { phone: '+998' + phone })
    if (!res.ok || !data.session_id) {
      setErr('lm-phone-err', res.status === 429
        ? t('lm.errMany', 'Juda ko‘p urinish. Bir necha daqiqadan keyin qayta urinib ko‘ring.')
        : t('lm.errNet', 'Internet aloqasi yo‘q. Qayta urinib ko‘ring.'))
      show('phone')
      return
    }
    botSession = data.session_id
    // A real link the buyer taps: phone browsers block window.open after an await.
    $('lm-bot-link').href = data.telegram_deep_link
    setErr('lm-bot-err')
    show('bot')
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = setInterval(pollBot, POLL_MS)
    document.addEventListener('visibilitychange', onVisible)
  }
  function onVisible() { if (document.visibilityState === 'visible') pollBot() }

  async function pollBot() {
    if (!botSession) return
    try {
      const res = await fetch(`${API}/api/auth/telegram/status?session_id=${encodeURIComponent(botSession)}`, { credentials: 'include' })
      const data = await res.json()
      if (data.status === 'verified') return finish()
      if (data.status === 'failed') {
        setErr('lm-bot-err', t('lm.errMismatch', 'Telegramdagi raqam boshqa. Telegramingizdagi raqamni kiriting.'))
        stopTimers(); botSession = null
      } else if (data.status === 'expired') {
        setErr('lm-bot-err', t('lm.errExpiredBot', 'Vaqt tugadi. Raqamni qayta kiriting.'))
        stopTimers(); botSession = null
      }
    } catch { /* transient: next poll */ }
  }

  // ── Done ───────────────────────────────────────────────────────────────────

  async function finish() {
    stopTimers()
    ticket = null
    botSession = null
    track('login_done')
    show('done')
    const user = await getCurrentUser()
    const res = resolveLogin
    setTimeout(() => { if (res) res(user); close() }, 700)
  }

  async function getCurrentUser() {
    try {
      const res = await fetch(API + '/api/auth/me', { credentials: 'include' })
      return res.ok ? await res.json() : null
    } catch { return null }
  }

  async function requireAuth() {
    if (window.LOOM_AUTH) {
      try { const u = await window.LOOM_AUTH.getCurrentUser(); if (u) return u } catch { /* signed out */ }
    }
    const u = await getCurrentUser()
    return u || open()
  }

  window.LOOM_LOGIN_MODAL = { open, close, requireAuth }
})()
