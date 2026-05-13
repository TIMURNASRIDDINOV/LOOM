'use strict';

/**
 * LOOM Phone / Telegram Auth Modal
 *
 * Usage:
 *   const modal = window.LOOM_LOGIN_MODAL
 *   modal.open()                        // open and wait for login
 *   modal.open().then(user => ...)      // resolves when user is logged in
 *   modal.requireAuth()                 // resolves immediately if already logged in,
 *                                       // otherwise opens modal and waits
 */

;(function () {
  const API = window.LOOM_CONFIG?.API_BASE ?? 'https://api.looom.me'

  const TIMEOUT_MS = 10 * 60 * 1000   // 10 minutes (matches server)
  const POLL_MS    = 2_000             // 2 s polling interval

  // ── Modal DOM ──────────────────────────────────────────────────────────────

  function buildModal() {
    const backdrop = document.createElement('div')
    backdrop.className = 'loom-modal-backdrop'
    backdrop.setAttribute('role', 'dialog')
    backdrop.setAttribute('aria-modal', 'true')
    backdrop.setAttribute('aria-label', 'Вход в LOOM')

    backdrop.innerHTML = `
      <div class="loom-modal" id="loom-modal-box">
        <button class="loom-modal__close" id="loom-modal-close" aria-label="Закрыть">✕</button>

        <!-- Step 1: phone input -->
        <div id="loom-step-phone">
          <h2 class="loom-modal__title">Вход в LOOM</h2>
          <p class="loom-modal__sub">Введите номер телефона — мы отправим подтверждение через Telegram.</p>
          <div class="loom-modal__phone-wrap">
            <span class="loom-modal__phone-prefix">+998</span>
            <input
              id="loom-phone-input"
              class="loom-modal__phone-input"
              type="tel"
              inputmode="numeric"
              autocomplete="tel"
              placeholder="90 123 45 67"
              maxlength="13"
            />
          </div>
          <button class="loom-modal__btn" id="loom-phone-btn">Продолжить через Telegram</button>
          <p class="loom-modal__error" id="loom-phone-error"></p>
        </div>

        <!-- Step 2: waiting for Telegram -->
        <div id="loom-step-waiting" style="display:none">
          <div class="loom-modal__waiting">
            <div class="loom-modal__spinner"></div>
            <p class="loom-modal__waiting-title">Ожидаем подтверждение</p>
            <p class="loom-modal__waiting-sub">
              Перейдите в Telegram и нажмите<br>«Поделиться номером телефона».
            </p>
            <a id="loom-tg-link" href="#" target="_blank" rel="noopener" class="loom-modal__tg-link">
              📱 Открыть Telegram бот
            </a>
            <div class="loom-modal__timeout-bar">
              <div class="loom-modal__timeout-fill" id="loom-timeout-fill"></div>
            </div>
            <p class="loom-modal__error" id="loom-wait-error"></p>
            <button class="loom-modal__cancel-btn" id="loom-cancel-btn">Отменить</button>
          </div>
        </div>

        <!-- Step 3: success -->
        <div id="loom-step-success" style="display:none">
          <div class="loom-modal__success">
            <div class="loom-modal__success-icon">✅</div>
            <p class="loom-modal__success-title">Вы вошли!</p>
            <p class="loom-modal__success-sub">Переадресуем вас…</p>
          </div>
        </div>
      </div>
    `
    document.body.appendChild(backdrop)
    return backdrop
  }

  // ── State ──────────────────────────────────────────────────────────────────

  let backdrop = null
  let resolveLogin = null
  let rejectLogin = null
  let pollTimer = null
  let timeoutTimer = null
  let sessionId = null
  let deepLink = null

  // ── Show / hide steps ──────────────────────────────────────────────────────

  function showStep(name) {
    for (const id of ['loom-step-phone', 'loom-step-waiting', 'loom-step-success']) {
      const el = document.getElementById(id)
      if (el) el.style.display = id === `loom-step-${name}` ? '' : 'none'
    }
  }

  // ── Open / close ───────────────────────────────────────────────────────────

  function close(reason) {
    if (!backdrop) return
    cleanup()
    backdrop.classList.remove('visible')
    setTimeout(() => {
      if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop)
      backdrop = null
    }, 220)
    if (reason instanceof Error && rejectLogin) {
      rejectLogin(reason)
    }
    resolveLogin = null
    rejectLogin = null
  }

  function cleanup() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null }
    sessionId = null
    deepLink = null
  }

  function open() {
    if (backdrop) {
      // Already open — return same promise
      return new Promise((res, rej) => { resolveLogin = res; rejectLogin = rej })
    }

    backdrop = buildModal()

    // Wire close button
    document.getElementById('loom-modal-close').addEventListener('click', () => close(new Error('cancelled')))
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(new Error('cancelled'))
    })

    // Wire phone step
    document.getElementById('loom-phone-btn').addEventListener('click', handlePhoneSubmit)
    document.getElementById('loom-phone-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handlePhoneSubmit()
    })

    // Wire cancel in waiting step
    document.getElementById('loom-cancel-btn').addEventListener('click', () => {
      close(new Error('cancelled'))
    })

    // Animate in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => backdrop.classList.add('visible'))
    })

    return new Promise((res, rej) => {
      resolveLogin = res
      rejectLogin = rej
    })
  }

  // ── Phone submit ───────────────────────────────────────────────────────────

  async function handlePhoneSubmit() {
    const input = document.getElementById('loom-phone-input')
    const errEl = document.getElementById('loom-phone-error')
    const btn = document.getElementById('loom-phone-btn')

    const raw = input.value.trim()
    if (!raw) {
      errEl.textContent = 'Введите номер телефона'
      return
    }

    // Prepend +998 prefix (the UI shows it as a separate element)
    const phone = '+998' + raw.replace(/\D/g, '')
    if (phone.length < 12) {
      errEl.textContent = 'Введите полный номер телефона'
      return
    }

    errEl.textContent = ''
    btn.disabled = true
    btn.textContent = 'Отправка…'

    try {
      const res = await fetch(API + '/api/auth/telegram/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
        credentials: 'include',
      })
      const data = await res.json()

      if (!res.ok) {
        errEl.textContent = data.error || 'Ошибка. Попробуйте снова.'
        btn.disabled = false
        btn.textContent = 'Продолжить через Telegram'
        return
      }

      sessionId = data.session_id
      deepLink = data.telegram_deep_link

      // Switch to waiting step
      showStep('waiting')
      document.getElementById('loom-tg-link').href = deepLink

      // Open Telegram automatically
      window.open(deepLink, '_blank', 'noopener')

      startPolling(data.expires_at)
    } catch (err) {
      errEl.textContent = 'Нет соединения. Проверьте интернет и попробуйте снова.'
      btn.disabled = false
      btn.textContent = 'Продолжить через Telegram'
    }
  }

  // ── Polling ────────────────────────────────────────────────────────────────

  function startPolling(expiresAt) {
    const startMs = Date.now()
    const durationMs = expiresAt - startMs

    // Countdown bar
    const fill = document.getElementById('loom-timeout-fill')
    if (fill) {
      fill.style.transitionDuration = durationMs + 'ms'
      requestAnimationFrame(() => { fill.style.width = '0%' })
    }

    // Timeout handler
    timeoutTimer = setTimeout(() => {
      cleanup()
      showStep('phone')
      const errEl = document.getElementById('loom-phone-error')
      if (errEl) errEl.textContent = 'Время ожидания истекло. Попробуйте снова.'
      const btn = document.getElementById('loom-phone-btn')
      if (btn) { btn.disabled = false; btn.textContent = 'Продолжить через Telegram' }
    }, durationMs)

    pollTimer = setInterval(pollStatus, POLL_MS)
  }

  async function pollStatus() {
    if (!sessionId) return
    try {
      const res = await fetch(
        `${API}/api/auth/telegram/status?session_id=${encodeURIComponent(sessionId)}`,
        { credentials: 'include' },
      )
      const data = await res.json()

      if (data.status === 'verified') {
        cleanup()
        showStep('success')
        // Give the cookie a moment to be set, then resolve
        setTimeout(async () => {
          if (resolveLogin) {
            const user = await getCurrentUser()
            resolveLogin(user)
          }
          close()
        }, 1200)
      } else if (data.status === 'failed') {
        cleanup()
        showStep('phone')
        const errEl = document.getElementById('loom-phone-error')
        if (errEl) errEl.textContent = 'Телефон не совпадает. Убедитесь, что поделились нужным номером.'
        const btn = document.getElementById('loom-phone-btn')
        if (btn) { btn.disabled = false; btn.textContent = 'Продолжить через Telegram' }
      } else if (data.status === 'expired') {
        cleanup()
        showStep('phone')
        const errEl = document.getElementById('loom-phone-error')
        if (errEl) errEl.textContent = 'Время ожидания истекло. Попробуйте снова.'
        const btn = document.getElementById('loom-phone-btn')
        if (btn) { btn.disabled = false; btn.textContent = 'Продолжить через Telegram' }
      }
    } catch {
      // Ignore transient network errors during polling
    }
  }

  // ── Get current user via cookie ────────────────────────────────────────────

  async function getCurrentUser() {
    try {
      const res = await fetch(API + '/api/auth/me', { credentials: 'include' })
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  }

  // ── requireAuth ────────────────────────────────────────────────────────────

  async function requireAuth() {
    // Check if already logged in (cookie or Bearer token)
    const authModule = window.LOOM_AUTH
    if (authModule) {
      try {
        const user = await authModule.getCurrentUser()
        if (user) return user
      } catch { /* not logged in */ }
    }

    // Also check cookie-based auth
    const cookieUser = await getCurrentUser()
    if (cookieUser) return cookieUser

    // Need to log in — open modal
    return open()
  }

  window.LOOM_LOGIN_MODAL = { open, close, requireAuth }
})()
