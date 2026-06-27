'use strict'
;(function () {
  const TOKEN_KEY = 'loom_auth_token'
  const USER_KEY  = 'loom_user'

  // ── Token storage ──────────────────────────────────────────────────────────
  function getToken()    { return localStorage.getItem(TOKEN_KEY) }
  function setToken(t)   { localStorage.setItem(TOKEN_KEY, t) }
  function clearToken()  { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(USER_KEY) }

  // ── User profile (cached in sessionStorage for the tab lifetime) ───────────
  async function getCurrentUser(forceRefresh) {
    if (!forceRefresh) {
      const cached = sessionStorage.getItem(USER_KEY)
      if (cached) { try { return JSON.parse(cached) } catch {} }
    }

    const token = getToken()
    const API = window.LOOM_CONFIG?.API_BASE ?? 'https://api.loomdesign.uz'

    // Try Bearer token (email auth)
    if (token) {
      try {
        const res = await fetch(API + '/api/auth/me', {
          headers: { Authorization: 'Bearer ' + token },
        })
        if (res.ok) {
          const user = await res.json()
          sessionStorage.setItem(USER_KEY, JSON.stringify(user))
          return user
        }
        clearToken()
      } catch { /* fall through to cookie auth */ }
    }

    // Try cookie-based auth (phone/Telegram auth)
    try {
      const res = await fetch(API + '/api/auth/me', { credentials: 'include' })
      if (res.ok) {
        const user = await res.json()
        sessionStorage.setItem(USER_KEY, JSON.stringify(user))
        return user
      }
    } catch {}

    return null
  }

  // ── Auth API calls ─────────────────────────────────────────────────────────
  async function login(email, password) {
    const res = await fetch(window.LOOM_CONFIG.API_BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Ошибка входа')
    setToken(data.token)
    sessionStorage.setItem(USER_KEY, JSON.stringify(data.user))
    return data
  }

  async function register(email, password, name, phone) {
    const body = { email, password }
    if (name)  body.name  = name
    if (phone) body.phone = phone
    const res = await fetch(window.LOOM_CONFIG.API_BASE + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Ошибка регистрации')
    setToken(data.token)
    sessionStorage.setItem(USER_KEY, JSON.stringify(data.user))
    return data
  }

  async function logout() {
    clearToken()
    // Clear phone-auth cookie too
    try {
      await fetch((window.LOOM_CONFIG?.API_BASE ?? 'https://api.loomdesign.uz') + '/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
    } catch {}
    window.location.href = 'index.html'
  }

  // ── Nav renderer ──────────────────────────────────────────────────────────
  function esc(s) {
    if (!s) return ''
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  }

  // Translation helper with fallback when i18n.js is not loaded
  function L(key, fallback) {
    try { return (window.LOOM_I18N ? window.LOOM_I18N.t(key) : fallback) || fallback }
    catch (e) { return fallback }
  }

  async function renderAuthNav() {
    const slots = document.querySelectorAll('.auth-nav-slot')
    if (!slots.length) return

    const user = await getCurrentUser()

    slots.forEach(slot => {
      if (!user) {
        slot.innerHTML = `<a href="login.html" class="auth-nav-link">${esc(L('nav.login', 'Войти'))}</a>`
        return
      }

      const displayName = user.name ? user.name.split(' ')[0] : user.email.split('@')[0]
      const initials = displayName.slice(0, 2).toUpperCase()
      const avatarHtml = user.avatar_url
        ? `<img class="auth-nav-avatar" src="${esc(user.avatar_url)}" alt="${esc(displayName)}" />`
        : `<span class="auth-nav-initials" aria-hidden="true">${esc(initials)}</span>`

      slot.innerHTML = `
        <div class="auth-dropdown">
          <button class="auth-dropdown-btn" aria-haspopup="true" aria-expanded="false">
            ${avatarHtml}
            <span class="auth-dropdown-name">${esc(displayName)}</span>
            <svg class="auth-dropdown-caret" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <div class="auth-dropdown-menu" role="menu">
            <a href="account.html" class="auth-dropdown-item" role="menuitem">${esc(L('nav.account', 'Личный кабинет'))}</a>
            <a href="account.html#settings" class="auth-dropdown-item" role="menuitem">${esc(L('nav.settings', 'Настройки'))}</a>
            <button class="auth-dropdown-item auth-dropdown-logout" role="menuitem">${esc(L('nav.logout', 'Выйти'))}</button>
          </div>
        </div>
      `
      const btn  = slot.querySelector('.auth-dropdown-btn')
      const menu = slot.querySelector('.auth-dropdown-menu')

      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const open = menu.classList.toggle('open')
        btn.setAttribute('aria-expanded', String(open))
      })

      // Close on outside click
      document.addEventListener('click', () => {
        menu.classList.remove('open')
        btn.setAttribute('aria-expanded', 'false')
      })

      slot.querySelector('.auth-dropdown-logout').addEventListener('click', logout)
    })
  }

  // Re-render the auth nav when the language changes
  window.addEventListener('loom:langchange', () => { renderAuthNav() })

  window.LOOM_AUTH = { getToken, setToken, clearToken, getCurrentUser, login, register, logout, renderAuthNav }
})()
