/* ================================================================
   LOOM — Telegram Mini App bootstrap.

   Loaded on every public page (defer, after auth.js). Outside
   Telegram this file is a no-op after two cheap checks. Inside the
   Telegram WebView it:

     1. loads the official telegram-web-app.js SDK,
     2. expands the viewport and disables swipe-to-close (which
        otherwise fires while dragging decals in the 3D configurator),
     3. follows the Telegram light/dark theme (site dots are hidden —
        the Telegram client owns the theme here),
     4. logs the visitor in with zero taps via signed initData when
        their Telegram is already linked to a LOOM account, or asks
        for their phone with the native "share contact" popup.

   Detection: Telegram opens the Mini App URL with #tgWebAppData=…;
   on later same-session navigations the hash is gone, but the SDK
   has stashed its params in sessionStorage (__telegram__initParams).

   The login token travels in the response BODY and is stored via
   LOOM_AUTH.setToken (Bearer), not just the cookie: in Telegram-Web
   the Mini App lives in an iframe on web.telegram.org, where the
   api.loomdesign.uz cookie is third-party and never sent.
================================================================ */
'use strict'
;(function () {
  let inTelegram = /tgWebAppData/.test(window.location.hash)
  if (!inTelegram) {
    try { inTelegram = !!sessionStorage.getItem('__telegram__initParams') } catch (e) {}
  }
  if (!inTelegram) return

  document.documentElement.classList.add('tma')

  // Theme follows the Telegram client inside the Mini App
  const style = document.createElement('style')
  style.textContent = 'html.tma .theme-dots{display:none!important}'
  document.head.appendChild(style)

  const sdk = document.createElement('script')
  sdk.src = 'https://telegram.org/js/telegram-web-app.js'
  sdk.onload = init
  document.head.appendChild(sdk)

  const API = () => (window.LOOM_CONFIG && window.LOOM_CONFIG.API_BASE) || 'https://api.loomdesign.uz'
  const THEME_BG = { light: '#f4f2ed', dark: '#151412' }  // boot.js META_COLORS

  function init() {
    const W = window.Telegram && window.Telegram.WebApp
    if (!W) return

    try { W.ready() } catch (e) {}
    try { W.expand() } catch (e) {}
    try {
      if (W.isVersionAtLeast && W.isVersionAtLeast('7.7')) W.disableVerticalSwipes()
    } catch (e) {}

    syncTheme(W)
    try { W.onEvent && W.onEvent('themeChanged', () => syncTheme(W)) } catch (e) {}

    autoLogin(W)
  }

  function syncTheme(W) {
    const scheme = W.colorScheme === 'dark' ? 'dark' : 'light'
    // applyOnly, never set: the Telegram client owns the theme only inside the
    // Mini App, and Telegram's in-app browser shares localStorage with normal
    // loomdesign.uz browsing — persisting would overwrite the user's own choice.
    try {
      const t = window.__loomTheme
      if (t) (t.applyOnly || t.set).call(t, scheme, { animate: false })
    } catch (e) {}
    try {
      if (W.isVersionAtLeast && W.isVersionAtLeast('6.1')) {
        W.setHeaderColor(THEME_BG[scheme])
        W.setBackgroundColor(THEME_BG[scheme])
      }
    } catch (e) {}
  }

  // Which Telegram account the stored LOOM session belongs to. Telegram clients
  // share one storage origin across the accounts signed into them, so without
  // this the second account would silently inherit the first one's session.
  const UID_KEY = 'loom_tma_uid'

  function ls(op, key, value) {
    try {
      if (op === 'get') return localStorage.getItem(key)
      if (op === 'set') localStorage.setItem(key, value)
      if (op === 'del') localStorage.removeItem(key)
    } catch (e) { /* storage disabled */ }
    return null
  }

  function autoLogin(W) {
    if (!W.initData || !window.LOOM_AUTH) return
    // The visitor logged out inside this Mini App session (see auth.js logout).
    try { if (sessionStorage.getItem('loom_tma_logout')) return } catch (e) {}

    // initDataUnsafe is only used to compare against the account we last logged
    // in for — never as an auth decision. The signature check happens server-side.
    const tgUid = W.initDataUnsafe && W.initDataUnsafe.user && W.initDataUnsafe.user.id
    const boundUid = ls('get', UID_KEY)

    if (boundUid && String(tgUid || '') !== boundUid) {
      // Different Telegram account than the stored session — drop it.
      window.LOOM_AUTH.clearToken()
      ls('del', UID_KEY)
    } else if (boundUid && window.LOOM_AUTH.getToken()) {
      return  // same account, already logged in
    }

    // Resolve cookie auth first so we do not re-login someone already in.
    // A session we did not create (e.g. manual email login inside Telegram) is
    // left alone: only tokens tagged with UID_KEY are ours to discard.
    window.LOOM_AUTH.getCurrentUser().then((user) => {
      if (user && !boundUid) return

      fetch(API() + '/api/auth/telegram/webapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ init_data: W.initData }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return
          if (data.status === 'ok' && data.token) finishLogin(data.token, tgUid)
          else if (data.status === 'need_contact' && data.session_id) promptContact(W, data.session_id, tgUid)
        })
        .catch(() => {})
    }).catch(() => {})
  }

  function finishLogin(token, tgUid) {
    window.LOOM_AUTH.setToken(token)
    if (tgUid) ls('set', UID_KEY, String(tgUid))
    window.LOOM_AUTH.getCurrentUser(true)
      .then(() => { window.LOOM_AUTH.renderAuthNav() })
      .catch(() => {})
  }

  // Native popup asking the user to share their phone — once per session.
  // Declining is fine: browsing works logged out, and every existing login
  // path (login page, checkout) still applies.
  const PROMPT_KEY = 'loom_tma_contact_prompted'

  function promptContact(W, sessionId, tgUid) {
    if (typeof W.requestContact !== 'function') return  // very old Telegram client
    try { if (sessionStorage.getItem(PROMPT_KEY)) return } catch (e) {}
    try { sessionStorage.setItem(PROMPT_KEY, '1') } catch (e) {}

    // On clients that predate requestContact the SDK still defines the method
    // and throws WebAppMethodUnsupported when called — so guard the call too.
    try {
      W.requestContact((shared) => {
        if (shared) pollSession(sessionId, 30, tgUid)
      })
    } catch (e) { /* unsupported — normal login paths still work */ }
  }

  // The shared contact arrives on the bot webhook, which verifies the
  // session — mirror login-modal.js and poll status every 2 s.
  function pollSession(sessionId, attemptsLeft, tgUid) {
    if (attemptsLeft <= 0) return
    setTimeout(() => {
      fetch(API() + '/api/auth/telegram/status?session_id=' + encodeURIComponent(sessionId), {
        credentials: 'include',
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d && d.status === 'verified' && d.token) finishLogin(d.token, tgUid)
          else if (!d || d.status === 'pending') pollSession(sessionId, attemptsLeft - 1, tgUid)
          // failed / expired → stop quietly; normal login paths remain
        })
        .catch(() => pollSession(sessionId, attemptsLeft - 1, tgUid))
    }, 2000)
  }
})()
