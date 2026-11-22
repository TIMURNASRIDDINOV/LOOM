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
  const THEME_BG = { light: '#f5f5f2', dark: '#121315' }  // boot.js META_COLORS = Atelye --page

  function init() {
    const W = window.Telegram && window.Telegram.WebApp
    if (!W) return

    try { W.ready() } catch (e) {}
    try { W.expand() } catch (e) {}
    try {
      if (W.isVersionAtLeast && W.isVersionAtLeast('7.7')) W.disableVerticalSwipes()
    } catch (e) {}

    if (routeStartParam(W)) return
    syncTheme(W)
    try { W.onEvent && W.onEvent('themeChanged', () => syncTheme(W)) } catch (e) {}
    // The configurator's phone shell drives Telegram's own buttons (LOOM-297).
    try { window.dispatchEvent(new Event('loom:tma-ready')) } catch (e) {}

    autoLogin(W)
  }

  // Ads link straight into the Mini App (LOOM-365):
  //   t.me/looom_design_bot?startapp=<slug>[__<campaign>]
  // On the launch page only (the #tgWebAppData hash is gone after the first
  // navigation, so this cannot loop), open that garment in the configurator
  // with UTM tags so GA4 / Metrika credit the ad. "home" or an unknown value
  // stays on the launch page untagged. Returns true while leaving the page.
  function routeStartParam(W) {
    const sp = W.initDataUnsafe && W.initDataUnsafe.start_param
    if (!sp || !/tgWebAppData/.test(location.hash) || !/^[A-Za-z0-9_-]{1,64}$/.test(sp)) return false
    const parts = sp.split('__')
    const slug = parts[0].toLowerCase()
    if (!/^[a-z0-9-]+$/.test(slug) || slug === 'home') return false
    const q = new URLSearchParams({ slug: slug, utm_source: 'telegram', utm_medium: 'miniapp', utm_campaign: parts[1] || slug })
    location.replace('/configurator?' + q.toString())
    return true
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

  // ── First-visit confirm sheet ───────────────────────────────────────────────
  // A brand-new visitor never sees a login form: the account is created from
  // their Telegram identity. All we ask is one tap to share the phone (needed
  // for delivery) and a glance at the name that will go on their orders —
  // Telegram's first_name is often a nickname with emoji in it.
  //
  // Dismissible and shown once per app session: browsing must never be walled.
  const PROMPT_KEY = 'loom_tma_contact_prompted'

  function T(key, fallback) {
    try { return (window.LOOM_I18N ? window.LOOM_I18N.t(key) : fallback) || fallback }
    catch (e) { return fallback }
  }

  // Atelye look (PRD-216): own rules with token fallbacks, so the sheet reads
  // the same on Atelye pages (atelye.css tokens) and on the configurator.
  const SHEET_CSS = `
.tma-sheet{position:fixed;inset:0;z-index:9999;display:flex;align-items:flex-end;justify-content:center;font-family:var(--f,'Archivo',system-ui,sans-serif)}
.tma-sheet__scrim{position:absolute;inset:0;background:rgba(10,12,14,.38);opacity:0;transition:opacity .22s cubic-bezier(.2,0,0,1)}
.tma-sheet.is-open .tma-sheet__scrim{opacity:1}
.tma-sheet__panel{position:relative;width:100%;max-width:34rem;background:var(--surface,#fff);color:var(--ink,#14171a);
  border-radius:14px 14px 0 0;padding:0 16px calc(16px + var(--tma-bottom,env(safe-area-inset-bottom,0px)));
  box-shadow:0 0 0 1px var(--ln,rgba(20,23,26,.16)),0 -14px 30px -12px rgba(14,18,24,.3);
  transform:translateY(100%);transition:transform .22s cubic-bezier(.2,0,0,1)}
.tma-sheet.is-open .tma-sheet__panel{transform:translateY(0)}
.tma-sheet__grip{height:22px;display:grid;place-items:center}
.tma-sheet__grip::before{content:"";width:38px;height:4px;border-radius:2px;background:var(--mut,#59616a);opacity:.55}
.tma-sheet__title{font:700 22px/1.1 var(--f,inherit);margin:4px 0 8px}
.tma-sheet__sub{font-size:15px;line-height:1.5;color:var(--mut,#59616a);margin:0 0 16px}
.tma-sheet__label{display:block;font:600 13.5px var(--f,inherit);margin-bottom:6px}
.tma-sheet__inp{display:block;width:100%;box-sizing:border-box;height:48px;border:0;border-radius:8px;padding:0 12px;
  font:500 16px var(--f,inherit);color:inherit;background:var(--surface,#fff);box-shadow:inset 0 0 0 1.5px var(--ln,rgba(20,23,26,.16))}
.tma-sheet__inp:focus{outline:none;box-shadow:inset 0 0 0 2px var(--ink,#14171a)}
.tma-sheet__btn{display:flex;align-items:center;justify-content:center;width:100%;height:48px;margin-top:16px;border:0;border-radius:8px;
  font:700 14.5px var(--f,inherit);cursor:pointer;background:var(--cta,#d93529);color:var(--on-cta,#fff)}
.tma-sheet__btn:disabled{opacity:.4;cursor:not-allowed}
.tma-sheet__hint{font-size:13px;line-height:1.45;color:var(--mut,#59616a);margin:10px 0 0}
.tma-sheet__later{display:flex;align-items:center;justify-content:center;width:100%;height:48px;margin:8px 0 0;border:0;border-radius:8px;
  background:none;color:inherit;font:700 14.5px var(--f,inherit);box-shadow:inset 0 0 0 1.5px var(--ink,#14171a);cursor:pointer;
  -webkit-tap-highlight-color:transparent}
.tma-sheet__err{font-size:13px;font-weight:600;color:var(--alert,#c4291d);margin:10px 0 0}
.tma-sheet__done{text-align:center;padding:12px 0 8px}
.tma-sheet__tick{width:72px;height:72px;margin:0 auto 14px;border-radius:50%;background:var(--canvas,#e4e7ea);
  display:grid;place-items:center;color:var(--ink,#14171a);font-size:28px}
.tma-sheet button:focus-visible,.tma-sheet input:focus-visible{outline:2px solid var(--ink,#14171a);outline-offset:2px}
@media (prefers-reduced-motion:reduce){
  .tma-sheet__scrim,.tma-sheet__panel{transition:none}
}`

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function promptContact(W, sessionId, tgUid) {
    try { if (sessionStorage.getItem(PROMPT_KEY)) return } catch (e) {}
    try { sessionStorage.setItem(PROMPT_KEY, '1') } catch (e) {}
    if (typeof W.requestContact !== 'function') return  // very old Telegram client

    const u = (W.initDataUnsafe && W.initDataUnsafe.user) || {}
    const suggested = [u.first_name, u.last_name].filter(Boolean).join(' ')

    const style = document.createElement('style')
    style.textContent = SHEET_CSS
    document.head.appendChild(style)

    const sheet = document.createElement('div')
    sheet.className = 'tma-sheet'
    sheet.setAttribute('role', 'dialog')
    sheet.setAttribute('aria-modal', 'true')
    sheet.setAttribute('aria-labelledby', 'tmaSheetTitle')
    sheet.innerHTML = `
      <div class="tma-sheet__scrim" data-tma-later></div>
      <div class="tma-sheet__panel">
        <div class="tma-sheet__grip" aria-hidden="true"></div>
        <div data-tma-form>
          <h2 class="tma-sheet__title" id="tmaSheetTitle">${esc(T('tma.welcome', 'Добро пожаловать в LOOM'))}</h2>
          <p class="tma-sheet__sub">${esc(T('tma.sub', 'Вы вошли через Telegram. Проверьте данные — это имя мы укажем в заказе.'))}</p>
          <label class="tma-sheet__label" for="tmaName">${esc(T('tma.fullName', 'Полное имя'))}</label>
          <input class="tma-sheet__inp" id="tmaName" type="text" autocomplete="name"
                 placeholder="${esc(T('tma.namePh', 'Имя и фамилия'))}" value="${esc(suggested)}" />
          <button class="tma-sheet__btn" type="button" data-tma-share>${esc(T('tma.share', 'Поделиться номером'))}</button>
          <p class="tma-sheet__hint">${esc(T('tma.phoneWhy', 'Номер нужен для доставки. Можно добавить позже.'))}</p>
          <button class="tma-sheet__later" type="button" data-tma-later>${esc(T('tma.later', 'Позже'))}</button>
        </div>
      </div>`
    document.body.appendChild(sheet)
    requestAnimationFrame(() => sheet.classList.add('is-open'))

    const form = sheet.querySelector('[data-tma-form]')
    const nameInput = sheet.querySelector('#tmaName')
    const shareBtn = sheet.querySelector('[data-tma-share]')

    function close() {
      sheet.classList.remove('is-open')
      setTimeout(() => { sheet.remove(); style.remove() }, 240)
    }
    sheet.querySelectorAll('[data-tma-later]').forEach((el) => el.addEventListener('click', close))

    let watchdog = null
    function fail(msg) {
      clearTimeout(watchdog)
      shareBtn.disabled = false
      shareBtn.textContent = T('tma.share', 'Поделиться номером')
      let err = form.querySelector('.tma-sheet__err')
      if (!err) {
        err = document.createElement('p')
        err.className = 'tma-sheet__err'
        form.appendChild(err)
      }
      err.textContent = msg
    }

    function succeed() {
      clearTimeout(watchdog)
      form.innerHTML = `
        <div class="tma-sheet__done">
          <div class="tma-sheet__tick" aria-hidden="true">✓</div>
          <h2 class="tma-sheet__title">${esc(T('tma.done', 'Всё готово!'))}</h2>
          <p class="tma-sheet__sub" style="margin:0">${esc(T('tma.doneSub', 'Можно приступать к созданию дизайна.'))}</p>
        </div>`
      setTimeout(close, 1600)
    }

    shareBtn.addEventListener('click', () => {
      const typedName = nameInput.value.trim().slice(0, 80)
      shareBtn.disabled = true
      shareBtn.textContent = T('tma.saving', 'Сохраняем…')
      // Telegram clients always answer requestContact, but if one never does the
      // button would stay disabled forever — always leave a way back.
      clearTimeout(watchdog)
      watchdog = setTimeout(() => {
        fail(T('tma.errShare', 'Не удалось получить номер. Попробуйте снова.'))
      }, 75000)  // longer than the 60s poll window, so it only fires if nothing did
      try {
        W.requestContact((shared) => {
          if (!shared) return fail(T('tma.errShare', 'Не удалось получить номер. Попробуйте снова.'))
          // The contact lands on the bot webhook, which creates the account and
          // verifies the session. Only then does a profile exist to name.
          pollSession(sessionId, 30, tgUid, {
            onLogin: () => { saveName(typedName, suggested).then(succeed) },
            onGiveUp: () => fail(T('tma.errShare', 'Не удалось получить номер. Попробуйте снова.')),
          })
        })
      } catch (e) {
        fail(T('tma.errShare', 'Не удалось получить номер. Попробуйте снова.'))
      }
    })
  }

  // Persist the confirmed full name. `name` is what checkout splits into
  // first/surname, so the sheet writes there rather than to first_name.
  function saveName(typed, suggested) {
    if (!typed || typed === suggested) return Promise.resolve()  // nothing to correct
    const token = window.LOOM_AUTH.getToken()
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = 'Bearer ' + token
    return fetch(API() + '/api/auth/profile', {
      method: 'PATCH',
      headers,
      credentials: 'include',
      body: JSON.stringify({ name: typed }),
    })
      .then(() => window.LOOM_AUTH.getCurrentUser(true))
      .then(() => { window.LOOM_AUTH.renderAuthNav() })
      .catch(() => {})
  }

  // The shared contact arrives on the bot webhook, which verifies the
  // session — mirror login-modal.js and poll status every 2 s.
  function pollSession(sessionId, attemptsLeft, tgUid, hooks) {
    if (attemptsLeft <= 0) { hooks && hooks.onGiveUp && hooks.onGiveUp(); return }
    setTimeout(() => {
      fetch(API() + '/api/auth/telegram/status?session_id=' + encodeURIComponent(sessionId), {
        credentials: 'include',
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d && d.status === 'verified' && d.token) {
            finishLogin(d.token, tgUid)
            hooks && hooks.onLogin && hooks.onLogin()
          } else if (!d || d.status === 'pending') {
            pollSession(sessionId, attemptsLeft - 1, tgUid, hooks)
          } else {
            // failed / expired → stop; normal login paths remain
            hooks && hooks.onGiveUp && hooks.onGiveUp()
          }
        })
        .catch(() => pollSession(sessionId, attemptsLeft - 1, tgUid, hooks))
    }, 2000)
  }
})()
