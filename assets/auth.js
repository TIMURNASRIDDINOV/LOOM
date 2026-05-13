'use strict'
;(function () {
  const TOKEN_KEY = 'loom_auth_token'
  const USER_KEY  = 'loom_user'

  // ── Token storage ──────────────────────────────────────────────────────────
  function getToken()    { return localStorage.getItem(TOKEN_KEY) }
  function setToken(t)   { localStorage.setItem(TOKEN_KEY, t) }
  function clearToken()  { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(USER_KEY) }

  // ── User profile (cached in sessionStorage for the tab lifetime) ───────────
  async function getCurrentUser() {
    const cached = sessionStorage.getItem(USER_KEY)
    if (cached) { try { return JSON.parse(cached) } catch {} }

    const token = getToken()
    const API = window.LOOM_CONFIG?.API_BASE ?? 'https://api.looom.me'

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
      await fetch((window.LOOM_CONFIG?.API_BASE ?? 'https://api.looom.me') + '/api/auth/logout', {
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

  async function renderAuthNav() {
    const slots = document.querySelectorAll('.auth-nav-slot')
    if (!slots.length) return

    const user = await getCurrentUser()

    slots.forEach(slot => {
      if (!user) {
        slot.innerHTML = `<a href="login.html" class="auth-nav-link">Войти</a>`
        return
      }

      const displayName = user.first_name || (user.name ? user.name.split(' ')[0] : null) || (user.phone ? user.phone : null) || (user.email && !user.email.includes('@telegram.loom') ? user.email.split('@')[0] : null) || 'Аккаунт'
      slot.innerHTML = `
        <div class="auth-dropdown">
          <button class="auth-dropdown-btn" aria-haspopup="true" aria-expanded="false">
            <span class="auth-dropdown-name">${esc(displayName)}</span>
            <svg class="auth-dropdown-caret" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <div class="auth-dropdown-menu" role="menu">
            <a href="account.html" class="auth-dropdown-item" role="menuitem">Личный кабинет</a>
            <button class="auth-dropdown-item auth-dropdown-logout" role="menuitem">Выйти</button>
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

  window.LOOM_AUTH = { getToken, setToken, clearToken, getCurrentUser, login, register, logout, renderAuthNav }
})()
