'use strict'

/**
 * LOOM — social sign-in for the storefront (Google, Discord; Facebook when
 * its credentials land).
 *
 * Same contract as the mobile app (mobile/src/api/oauth.ts): the browser runs
 * the PKCE authorization step at the provider, then hands the code to the
 * Worker, which owns the client secret and does the token exchange. Nothing
 * secret ever reaches this file.
 *
 * Flow:
 *   login/register page → LOOM_OAUTH.mount() renders a button per provider the
 *   Worker says it can finish → start() stashes the PKCE verifier + state in
 *   sessionStorage and leaves for the provider → provider returns to
 *   /auth/callback → complete() posts the code and stores the JWT exactly like
 *   an email sign-in.
 *
 * Which providers appear is decided by the Worker, not here — a button is only
 * ever drawn for a provider whose client id AND secret are set, so the page can
 * never offer a sign-in the deployment cannot complete.
 */
;(function () {
  const API = window.LOOM_CONFIG?.API_BASE ?? 'https://api.loomdesign.uz'

  /** Registered at every provider console as the web redirect URI. */
  const CALLBACK_PATH = '/auth/callback'

  // Namespaced so a stray key cannot collide with the cart or the TMA session.
  const K = {
    verifier: 'loom_oauth_verifier',
    state: 'loom_oauth_state',
    provider: 'loom_oauth_provider',
    next: 'loom_oauth_next',
  }

  // ── Provider table ─────────────────────────────────────────────────────────
  // Only the public half: authorization endpoint, scopes, brand mark. The token
  // endpoints live on the Worker.

  const PROVIDERS = {
    google: {
      label: 'Google',
      i18n: 'auth.viaGoogle',
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      scope: 'openid profile email',
      // Without this Google silently reuses the one signed-in account, which
      // reads as a bug to anyone with two.
      extra: { prompt: 'select_account' },
      brand: '#fff',
      ink: '#131311',
      border: 'rgba(19,19,17,0.16)',
      icon:
        '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">' +
        '<path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z"/>' +
        '<path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.96v2.33A9 9 0 0 0 9 18z"/>' +
        '<path fill="#FBBC05" d="M3.95 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l2.99-2.33z"/>' +
        '<path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l2.99 2.33C4.66 5.16 6.65 3.58 9 3.58z"/>' +
        '</svg>',
    },
    discord: {
      label: 'Discord',
      i18n: 'auth.viaDiscord',
      authorizeUrl: 'https://discord.com/api/oauth2/authorize',
      scope: 'identify email',
      brand: '#5865F2',
      ink: '#fff',
      border: '#5865F2',
      icon:
        '<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
        '<path d="M20.32 4.57A19.8 19.8 0 0 0 15.43 3c-.21.38-.46.9-.63 1.31a18.3 18.3 0 0 0-5.6 0C9.03 3.9 8.77 3.38 8.56 3a19.7 19.7 0 0 0-4.9 1.57C.56 9.2-.28 13.7.14 18.14A19.9 19.9 0 0 0 6.2 21.2c.49-.67.93-1.38 1.3-2.13-.71-.27-1.4-.6-2.04-.99.17-.13.34-.26.5-.4a14.2 14.2 0 0 0 12.1 0c.16.14.33.27.5.4-.65.39-1.33.72-2.05.99.38.75.81 1.46 1.3 2.13a19.9 19.9 0 0 0 6.07-3.06c.5-5.15-.84-9.62-3.55-13.57zM8.02 15.42c-1.19 0-2.16-1.09-2.16-2.42 0-1.34.95-2.43 2.16-2.43 1.22 0 2.19 1.1 2.17 2.43 0 1.33-.95 2.42-2.17 2.42zm7.96 0c-1.18 0-2.16-1.09-2.16-2.42 0-1.34.96-2.43 2.16-2.43 1.22 0 2.19 1.1 2.17 2.43 0 1.33-.95 2.42-2.17 2.42z"/>' +
        '</svg>',
    },
    facebook: {
      label: 'Facebook',
      i18n: 'auth.viaFacebook',
      authorizeUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
      // Facebook separates scopes with commas, not spaces.
      scope: 'public_profile,email',
      brand: '#1877F2',
      ink: '#fff',
      border: '#1877F2',
      icon:
        '<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
        '<path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.52 1.5-3.91 3.77-3.91 1.1 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.89h2.78l-.45 2.9h-2.33V22c4.78-.76 8.44-4.92 8.44-9.94z"/>' +
        '</svg>',
    },
  }

  function T(key, fallback) {
    try {
      return (window.LOOM_I18N ? window.LOOM_I18N.t(key) : fallback) || fallback
    } catch (e) {
      return fallback
    }
  }

  // ── PKCE ───────────────────────────────────────────────────────────────────

  function b64url(bytes) {
    let s = ''
    bytes.forEach(function (b) { s += String.fromCharCode(b) })
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  function randomString(byteLength) {
    const bytes = new Uint8Array(byteLength)
    crypto.getRandomValues(bytes)
    return b64url(bytes)
  }

  async function challengeFor(verifier) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    return b64url(new Uint8Array(digest))
  }

  // ── Redirect targets ───────────────────────────────────────────────────────

  function redirectUri() {
    return window.location.origin + CALLBACK_PATH
  }

  /**
   * Where to land after a successful sign-in. Only same-origin paths are
   * honoured — a `?redirect=` is user-supplied, and bouncing to an arbitrary
   * host with a fresh session would be an open redirect.
   */
  function safeNext(value) {
    if (!value || typeof value !== 'string') return '/account.html'
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return '/account.html'   // absolute URL
    if (value.startsWith('//') || value.startsWith('\\')) return '/account.html'
    // The callback lives one level down, so a bare `account.html` from a page
    // at the root must be re-anchored.
    return value.startsWith('/') ? value : '/' + value
  }

  // ── Which providers this deployment can finish ─────────────────────────────

  let providersPromise = null

  function fetchProviders() {
    if (!providersPromise) {
      providersPromise = fetch(API + '/api/auth/oauth/providers?platform=web')
        .then(function (r) { return r.ok ? r.json() : { providers: [] } })
        .then(function (d) {
          return (d.providers || []).filter(function (p) {
            return p && PROVIDERS[p.id] && typeof p.client_id === 'string' && p.client_id
          })
        })
        .catch(function () { return [] })
    }
    return providersPromise
  }

  // ── Leaving for the provider ───────────────────────────────────────────────

  async function start(providerId, clientId, next) {
    const cfg = PROVIDERS[providerId]
    if (!cfg) throw new Error('Unknown provider: ' + providerId)

    const verifier = randomString(48)
    const state = randomString(16)

    sessionStorage.setItem(K.verifier, verifier)
    sessionStorage.setItem(K.state, state)
    sessionStorage.setItem(K.provider, providerId)
    sessionStorage.setItem(
      K.next,
      safeNext(next || new URLSearchParams(window.location.search).get('redirect')),
    )

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: cfg.scope,
      state: state,
      code_challenge: await challengeFor(verifier),
      code_challenge_method: 'S256',
    })
    Object.keys(cfg.extra || {}).forEach(function (k) { params.set(k, cfg.extra[k]) })

    window.location.assign(cfg.authorizeUrl + '?' + params.toString())
  }

  // ── Coming back from the provider ──────────────────────────────────────────

  /**
   * Runs on /auth/callback. Resolves with the path to continue to, or throws a
   * message fit to show the user.
   */
  async function complete() {
    const q = new URLSearchParams(window.location.search)

    const verifier = sessionStorage.getItem(K.verifier)
    const state    = sessionStorage.getItem(K.state)
    const provider = sessionStorage.getItem(K.provider)
    const next     = safeNext(sessionStorage.getItem(K.next))
    // Single-use: whatever happens below, this attempt is spent.
    ;[K.verifier, K.state, K.provider, K.next].forEach(function (k) { sessionStorage.removeItem(k) })

    if (q.get('error')) {
      if (q.get('error') === 'access_denied') throw new Error(T('auth.oauthCancelled', 'Вход отменён'))
      throw new Error(T('auth.oauthFailed', 'Не удалось войти через этот сервис'))
    }

    const code = q.get('code')
    if (!code || !provider || !verifier) {
      throw new Error(T('auth.oauthFailed', 'Не удалось войти через этот сервис'))
    }
    // The state came back through the provider; a mismatch means this response
    // was not started by this tab, so it is not ours to redeem.
    if (!state || q.get('state') !== state) {
      throw new Error(T('auth.oauthFailed', 'Не удалось войти через этот сервис'))
    }

    const res = await fetch(API + '/api/auth/oauth/' + provider, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The Worker also sets an httpOnly cookie; the site reads the body token.
      credentials: 'include',
      body: JSON.stringify({
        code: code,
        redirect_uri: redirectUri(),
        code_verifier: verifier,
        platform: 'web',
      }),
    })

    const data = await res.json().catch(function () { return {} })
    if (!res.ok || !data.token) {
      throw new Error(data.error || T('auth.oauthFailed', 'Не удалось войти через этот сервис'))
    }

    // Same storage the email path uses, so every other page sees a normal login.
    window.LOOM_AUTH.setToken(data.token)
    try {
      sessionStorage.setItem('loom_user', JSON.stringify(data.user))
    } catch (e) { /* cache only — /api/auth/me will refill it */ }

    return next
  }

  // ── Buttons ────────────────────────────────────────────────────────────────

  function buildButton(info) {
    const cfg = PROVIDERS[info.id]
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'auth-btn-social auth-btn-social--' + info.id
    btn.style.setProperty('--social-bg', cfg.brand)
    btn.style.setProperty('--social-ink', cfg.ink)
    btn.style.setProperty('--social-border', cfg.border)

    const glyph = document.createElement('span')
    glyph.className = 'auth-btn-social__glyph'
    glyph.innerHTML = cfg.icon

    const label = document.createElement('span')
    label.setAttribute('data-i18n', cfg.i18n)
    label.textContent = T(cfg.i18n, 'Продолжить через ' + cfg.label)

    btn.appendChild(glyph)
    btn.appendChild(label)

    btn.addEventListener('click', function () {
      btn.disabled = true
      start(info.id, info.clientId).catch(function () {
        btn.disabled = false
        window.alert(T('auth.oauthFailed', 'Не удалось войти через этот сервис'))
      })
    })
    return btn
  }

  /**
   * Fill `container` with one button per available provider. Renders nothing at
   * all — not even the divider around it — when the Worker offers none, so a
   * half-configured deployment shows no dead buttons.
   */
  async function mount(container) {
    if (!container) return []
    const list = await fetchProviders()
    if (!list.length) {
      container.hidden = true
      return []
    }
    container.innerHTML = ''
    list.forEach(function (p) {
      container.appendChild(buildButton({ id: p.id, clientId: p.client_id }))
    })
    container.hidden = false
    // The labels carry data-i18n, so a later language switch repaints them.
    if (window.LOOM_I18N && window.LOOM_I18N.applyTo) window.LOOM_I18N.applyTo(container)
    return list
  }

  window.LOOM_OAUTH = { mount, start, complete, fetchProviders, redirectUri, PROVIDERS }
})()
