/* ================================================================
   LOOM — account (account.html), Atelye skin (PRD-216, LOOM-323).

   One page, hash-routed sections:
     (none)          profile hub: orders, account, settings, more
     #profile        first / last name (saved as users.name)
     #phone          the number and its Telegram confirmation
     #addresses      the saved delivery address (checkout offers it)
     #language       uz / ru / en, applied at once
     #theme          auto / light / dark
     #notifications  order status / offers switches (Telegram bot)
     #privacy        analytics consent, data copy, policy
     #delete         account deletion (privacy.html §5). With an order
                     in progress it is only scheduled and can be called
                     off until delivery (DELETE /api/auth/account →
                     {scheduled}, POST /api/auth/account/restore).
     #designer       designer studio (static markup, assets/designer.js)

   Signed out: the hub shows "Kiring" plus language, theme and help;
   language and theme still work.
================================================================ */
'use strict'
;(function () {
  const view = document.getElementById('acc-view')
  const main = document.getElementById('main')
  const studio = document.getElementById('tab-designer')
  if (!view) return

  const BOT = 'https://t.me/looom_design_bot'
  const SECTIONS = ['orders', 'profile', 'phone', 'addresses', 'language', 'theme', 'notifications', 'privacy', 'delete', 'designer']
  const PUBLIC = ['language', 'theme']

  /* ── helpers ─────────────────────────────────────────────────── */
  const I = () => window.LOOM_I18N
  function T(key, fallback) {
    const s = I() ? I().t(key) : null
    return s && s !== key ? s : (fallback == null ? key : fallback)
  }
  function fill(str, vars) {
    return Object.keys(vars).reduce((s, k) => s.split('{' + k + '}').join(vars[k]), str)
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
  const P = {
    pkg: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
    user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
    phone: 'M8 2h8a1 1 0 011 1v18a1 1 0 01-1 1H8a1 1 0 01-1-1V3a1 1 0 011-1zM11 18h2',
    pin: 'M12 21s7-6.2 7-11.5a7 7 0 10-14 0C5 14.8 12 21 12 21zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
    globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z',
    sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
    bell: 'M6 16V11a6 6 0 0112 0v5l2 2H4zM10 20a2 2 0 004 0',
    shield: 'M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z',
    store: 'M4 9l1.5-5h13L20 9M4 9h16v11H4zM4 9a2.7 2.7 0 005.3 0 2.7 2.7 0 005.4 0 2.7 2.7 0 005.3 0M10 20v-5h4v5',
    help: 'M12 3a9 9 0 100 18 9 9 0 000-18zM9.5 9.5a2.5 2.5 0 015 0c0 2-2.5 2-2.5 4M12 17h.01',
    logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
    trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
    doc: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
    chev: 'M9 5l7 7-7 7',
    back: 'M15 5l-7 7 7 7',
    check: 'M5 12l5 5 9-11',
    alert: 'M12 3l10 18H2zM12 10v4M12 17h.01',
    plus: 'M12 5v14M5 12h14',
    tg: 'M21 4L3 11l6 2 2 6 3-4 5 4z'
  }
  const ic = (n, s) => '<svg class="atl-ic' + (s ? ' atl-ic-s' : '') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + P[n] + '"/></svg>'

  /** One settings row. o: {i, b, s, v, href, act, dg, right, attrs} */
  function row(o) {
    const inner = (o.i ? '<span class="atl-row-ico">' + ic(o.i, 1) + '</span>' : '') +
      '<span class="atl-row-tx"><b>' + esc(o.b) + '</b>' + (o.s ? '<i>' + esc(o.s) + '</i>' : '') + '</span>' +
      (o.v ? '<span class="atl-row-v">' + esc(o.v) + '</span>' : '') + (o.right || '') +
      (o.href || o.act ? ic('chev', 1) : '')
    const cls = 'atl-row' + (o.dg ? ' atl-row-dg' : '')
    if (o.href) return '<a class="' + cls + '" href="' + esc(o.href) + '"' + (o.attrs || '') + '>' + inner + '</a>'
    if (o.act) return '<button type="button" class="' + cls + '" data-act="' + o.act + '">' + inner + '</button>'
    return '<div class="' + cls + '">' + inner + '</div>'
  }
  const grp = (title, rows) => '<section class="atl-grp"><h2>' + esc(title) + '</h2><div class="atl-lst">' + rows + '</div></section>'
  const tgl = (on, label, attrs) => '<button type="button" class="atl-tgl" role="switch" aria-checked="' + !!on + '" aria-label="' + esc(label) + '"' + (attrs || '') + '><i></i></button>'
  function radio(name, value, title, sub, on) {
    return '<button type="button" class="atl-opt" role="radio" data-' + name + '="' + value + '" aria-checked="' + !!on + '">' +
      '<span class="atl-opt-rd"></span><span class="atl-opt-tx"><b>' + esc(title) + '</b>' + (sub ? '<i>' + esc(sub) + '</i>' : '') + '</span></button>'
  }
  function field(id, label, input, o) {
    o = o || {}
    return '<div class="atl-field"><label class="atl-field-l" for="' + id + '">' + esc(label) +
        (o.opt ? ' <i>· ' + esc(T('atl.optional', 'ixtiyoriy')) + '</i>' : '') + '</label>' + input +
      '<span class="atl-ferr" id="' + id + '-err" hidden></span>' +
      (o.hint ? '<span class="atl-hint" id="' + id + '-hint">' + esc(o.hint) + '</span>' : '') + '</div>'
  }
  function fieldErr(id, text) {
    const el = document.getElementById(id + '-err')
    const inp = document.getElementById(id)
    if (el) { el.hidden = !text; el.innerHTML = text ? ic('alert', 1) + '<span>' + esc(text) + '</span>' : '' }
    if (inp) {
      if (text) { inp.setAttribute('aria-invalid', 'true'); inp.setAttribute('aria-describedby', id + '-err'); inp.focus() } else { inp.removeAttribute('aria-invalid') }
    }
  }
  function toast(text, err) {
    const old = document.querySelector('.atl-toast')
    if (old) old.remove()
    const el = document.createElement('div')
    el.className = 'atl-toast' + (err ? ' atl-toast-err' : '')
    el.setAttribute('role', err ? 'alert' : 'status')
    el.innerHTML = ic(err ? 'alert' : 'check', 1) + '<span>' + esc(text) + '</span>'
    document.body.appendChild(el)
    setTimeout(() => el.remove(), 2600)
  }
  const errText = () => (navigator.onLine === false ? T('atl.state.offline') : T('atl.state.errT', 'Nimadir noto‘g‘ri ketdi'))

  /* ── API ─────────────────────────────────────────────────────── */
  const API = () => (window.LOOM_CONFIG && window.LOOM_CONFIG.API_BASE) || 'https://api.loomdesign.uz'
  async function call(method, path, body) {
    const h = body ? { 'Content-Type': 'application/json' } : {}
    const tok = window.LOOM_AUTH && window.LOOM_AUTH.getToken()
    if (tok) h.Authorization = 'Bearer ' + tok
    const res = await fetch(API() + path, { method, headers: h, credentials: 'include', body: body ? JSON.stringify(body) : undefined })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) { location.replace('login.html?next=' + encodeURIComponent('account.html' + location.hash)); throw new Error('auth') }
    if (!res.ok) throw Object.assign(new Error(data.error || 'HTTP ' + res.status), { status: res.status })
    return data
  }
  /** Keep auth.js's session copy of /me in step with what we just saved. */
  function cacheUser() {
    try { sessionStorage.setItem('loom_user', JSON.stringify(user)) } catch (e) { /* private mode */ }
  }

  /* ── state ───────────────────────────────────────────────────── */
  let user = null
  let orders = null          // GET /api/me/orders, null until loaded
  let armed = false          // delete: first press done
  let busy = false
  let picker = null          // LOOM_ADDRESS instance on #addresses/edit
  let addrEdit = false       // #addresses shows the form
  let inPage = false         // we navigated between sections on this page
  let addrArm = false        // desktop: delete address asked, waiting for the second press
  /* Desktop (900 px+): a side list of settings on the left, the open
     section on the right (mockup 2026-11-15). Phones keep the hub. */
  const mq = window.matchMedia ? window.matchMedia('(min-width: 900px)') : null
  const isDesk = () => !!(mq && mq.matches)

  const section = () => {
    const h = location.hash.slice(1)
    return SECTIONS.indexOf(h) === -1 ? '' : h
  }
  const displayName = () => (user && (user.name || [user.first_name, user.last_name].filter(Boolean).join(' '))) || ''
  function digits(p) { return String(p || '').replace(/\D/g, '') }
  function fmtPhone(p, mask) {
    const d = digits(p)
    if (d.length !== 12 || d.indexOf('998') !== 0) return p || ''
    return '+998 ' + d.slice(3, 5) + ' ' + (mask ? '*** **' : d.slice(5, 8) + ' ' + d.slice(8, 10)) + ' ' + d.slice(10)
  }
  function preset() {
    try {
      const p = user && user.location_preset ? JSON.parse(user.location_preset) : null
      return p && p.address ? p : null
    } catch (e) { return null }
  }
  const isOpen = (o) => o.status !== 'delivered' && o.status !== 'cancelled'
  const openOrders = () => (orders || []).filter(isOpen)
  const orderList = () => openOrders().map((o) => '#' + o.id).join(', ')

  /* ── views ───────────────────────────────────────────────────── */
  const TITLES = {
    '': ['atl.nav.profile', 'Profil'],
    orders: ['atl.orders.title', 'Buyurtmalarim'],
    profile: ['atl.acc.profile', 'Profil'],
    phone: ['atl.acc.phone', 'Telefon raqami'],
    addresses: ['atl.acc.addresses', 'Manzillar'],
    language: ['atl.acc.lang', 'Til'],
    theme: ['atl.acc.theme', 'Mavzu'],
    notifications: ['atl.acc.notifications', 'Bildirishnomalar'],
    privacy: ['atl.acc.privacy', 'Maxfiylik'],
    delete: ['atl.acc.delete', 'Akkauntni o‘chirish'],
    designer: ['dz.studioTitle', 'Dizayner kabineti']
  }
  function head(sec) {
    const key = sec === 'designer' && !(user && user.is_designer) ? ['atl.acc.becomeDesigner', 'Dizayner bo‘lish'] : TITLES[sec]
    const title = T(key[0], key[1])
    const h = document.querySelector('.atl-mbar h1')
    if (h) h.textContent = title
    document.title = title + ' — LOOM'
    if (!sec) return ''
    // Desktop has no top bar: a link back to the hub above the title.
    return '<div class="atl-only-d"><a class="atl-lnk" href="account.html" data-act="hub">' + ic('back', 1) + esc(T('atl.nav.profile', 'Profil')) + '</a></div>' +
      '<h1 class="atl-t1 atl-only-d">' + esc(title) + '</h1>'
  }

  function hub() {
    if (!user) {
      return '<div class="atl-empty">' +
          '<span class="atl-cv">' + ic('user') + '</span>' +
          '<h1 class="atl-t2">' + esc(T('atl.acc.signIn', 'Kiring')) + '</h1>' +
          '<p class="atl-lead">' + esc(T('atl.acc.signInLead')) + '</p>' +
          '<div class="atl-btns" style="width:100%;max-width:420px"><a class="atl-btn atl-btn-p" href="login.html?next=account.html">' + ic('tg', 1) + esc(T('atl.acc.signInBtn', 'Kirish')) + '</a></div>' +
        '</div>' +
        '<div class="atl-lst">' + appRows(false) + row({ i: 'help', b: T('atl.nav.help', 'Yordam'), href: 'help.html' }) + '</div>'
    }
    const name = displayName()
    const initials = name ? name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() : ''
    const avatar = user.avatar_url
      ? '<span class="atl-avatar"><img src="' + esc(user.avatar_url) + '" alt=""></span>'
      : '<span class="atl-avatar" aria-hidden="true">' + (initials ? esc(initials) : ic('user')) + '</span>'
    const sub = [user.phone ? fmtPhone(user.phone, true) : '', user.phone_verified ? T('atl.acc.viaTg', 'Telegram orqali') : ''].filter(Boolean).join(' · ')

    let ordersSub = ''
    if (orders) {
      const unpaid = orders.filter((o) => o.payment_method === 'p2p' && o.status === 'new' && (o.payment_status === 'unpaid' || o.payment_status === 'failed')).length
      const review = orders.filter((o) => isOpen(o) && o.payment_status === 'pending').length
      if (unpaid || review) ordersSub = fill(T('atl.acc.ordersSub'), { unpaid, review })
    }
    const p = preset()
    const scheduled = user.delete_requested_at
      ? '<div class="atl-banner atl-banner-info">' + ic('alert', 1) + '<div class="atl-banner-tx"><span>' +
          esc(fill(T('atl.acc.delScheduled'), { orders: orderList() || '—' })) + '</span>' +
          '<a class="atl-btn" href="#delete">' + esc(T('atl.acc.delUndo', 'O‘chirishni bekor qilish')) + '</a></div></div>'
      : ''
    return '<div class="atl-acc-me">' + avatar + '<div><h1 class="atl-t2">' + esc(name || T('atl.nav.profile', 'Profil')) + '</h1>' +
        (sub ? '<p class="atl-sm atl-num">' + esc(sub) + '</p>' : '') + '</div></div>' +
      scheduled +
      grp(T('atl.acc.grpOrders', 'Buyurtmalar'), row({ i: 'pkg', b: T('atl.orders.title', 'Buyurtmalarim'), s: ordersSub, href: 'order.html' })) +
      grp(T('atl.acc.grpAccount', 'Akkaunt'),
        row({ i: 'user', b: T('atl.acc.profile', 'Profil'), s: T('atl.acc.profileSub', 'Ism va familiya'), href: '#profile' }) +
        row({ i: 'phone', b: T('atl.acc.phone', 'Telefon raqami'), v: user.phone_verified ? T('atl.verified', 'Tasdiqlangan') : '', href: '#phone' }) +
        row({ i: 'pin', b: T('atl.acc.addresses', 'Manzillar'), v: p ? fill(T('atl.acc.addrCount', '{n} ta'), { n: 1 }) : '', href: '#addresses' })) +
      grp(T('atl.acc.grpApp', 'Ilova'), appRows(true)) +
      grp(T('atl.acc.grpOther', 'Boshqa'),
        row({ i: 'store', b: user.is_designer ? T('dz.studioTitle', 'Dizayner kabineti') : T('atl.acc.becomeDesigner', 'Dizayner bo‘lish'), s: user.is_designer ? '' : T('atl.acc.becomeSub'), href: '#designer' }) +
        row({ i: 'help', b: T('atl.nav.help', 'Yordam'), href: 'help.html' }) +
        row({ i: 'logout', b: T('atl.acc.logout', 'Chiqish'), act: 'logout' })) +
      '<div class="atl-lst">' + row({ i: 'trash', b: T('atl.acc.delete', 'Akkauntni o‘chirish'), dg: 1, href: '#delete' }) + '</div>'
  }
  function appRows(full) {
    const L = { uz: 'O‘zbekcha', ru: 'Русский', en: 'English' }
    const th = themeNow()
    return row({ i: 'globe', b: T('atl.acc.lang', 'Til'), v: L[I() ? I().getLang() : 'uz'], href: '#language' }) +
      row({ i: 'sun', b: T('atl.acc.theme', 'Mavzu'), v: T('atl.theme.' + th), href: '#theme' }) +
      (full
        ? row({ i: 'bell', b: T('atl.acc.notifications', 'Bildirishnomalar'), v: 'Telegram', href: '#notifications' }) +
          row({ i: 'shield', b: T('atl.acc.privacy', 'Maxfiylik'), href: '#privacy' })
        : '')
  }

  function profile() {
    const parts = user.name ? user.name.trim().split(/\s+/) : [user.first_name || '', user.last_name || '']
    const first = parts[0] || ''
    const last = parts.slice(1).join(' ')
    return '<form class="atl-form" id="acc-profile-form" novalidate>' +
      field('acc-first', T('atl.acc.name', 'Ism'), '<input class="atl-inp" id="acc-first" autocomplete="given-name" maxlength="60" value="' + esc(first) + '" required>') +
      field('acc-last', T('atl.acc.surname', 'Familiya'), '<input class="atl-inp" id="acc-last" autocomplete="family-name" maxlength="60" value="' + esc(last) + '">', { opt: 1 }) +
      '<p class="atl-hint">' + esc(T('atl.acc.nameHint')) + '</p>' +
      '<button type="submit" class="atl-btn atl-btn-g atl-btn-w" data-tma-main>' + esc(T('atl.save', 'Saqlash')) + '</button>' +
    '</form>'
  }

  function phone() {
    if (!user.phone_verified) {
      return '<div class="atl-lst">' + row({ i: 'phone', b: user.phone ? fmtPhone(user.phone) : T('atl.acc.phone', 'Telefon raqami'), s: T('atl.co.verifyBanner') }) + '</div>' +
        '<a class="atl-btn atl-btn-p atl-btn-w" href="login.html?next=' + encodeURIComponent('account.html#phone') + '">' + ic('tg', 1) + esc(T('atl.co.verifyBtn', 'Telegram orqali tasdiqlash')) + '</a>'
    }
    return '<div class="atl-lst">' + row({ i: 'phone', b: fmtPhone(user.phone), s: T('atl.acc.tgVerified', 'Telegram orqali tasdiqlangan'),
        right: '<span style="color:var(--ok)">' + ic('check', 1) + '</span>' }) + '</div>' +
      // No self-service number change yet: the bot can only confirm the number
      // of the Telegram account that shares it (needs.md, phase 12).
      '<p class="atl-hint">' + esc(T('atl.acc.phoneChange', 'Raqamni o‘zgartirish uchun @looom_design_bot ga yozing.')) + '</p>' +
      '<a class="atl-btn atl-btn-w" href="' + BOT + '" rel="noopener">' + ic('tg', 1) + '@looom_design_bot</a>'
  }

  function addresses() {
    const p = preset()
    if (!addrEdit) {
      if (!p) {
        return '<p class="atl-lead">' + esc(T('atl.acc.addrNone', 'Saqlangan manzil yo‘q. Uni qo‘shsangiz, buyurtmada tanlash kifoya.')) + '</p>' +
          '<button type="button" class="atl-btn atl-btn-w" data-act="addr-edit">' + ic('plus', 1) + esc(T('atl.acc.addAddr', 'Manzil qo‘shish')) + '</button>'
      }
      if (isDesk()) {
        // Edit and delete side by side; delete asks once more inline.
        return '<div class="atl-lst">' + row({ i: 'pin', b: p.label || T('atl.co.addr', 'Manzil'), s: p.address,
            right: '<span class="atl-tag">' + esc(T('atl.acc.addrMain', 'Asosiy')) + '</span>' +
              '<span class="atl-acc-acts"><button type="button" class="atl-btn" data-act="addr-edit">' + esc(T('atl.cart.edit', 'O‘zgartirish')) + '</button>' +
              '<button type="button" class="atl-btn atl-acc-dg" data-act="addr-arm"' + (addrArm ? ' aria-expanded="true"' : ' aria-expanded="false"') + '>' + esc(T('atl.cart.remove', 'O‘chirish')) + '</button></span>' }) + '</div>' +
          (addrArm
            ? '<div class="atl-banner" role="alert">' + ic('alert', 1) + '<div class="atl-banner-tx"><span>' + esc(T('atl.acc.addrDelQ')) + '</span>' +
                '<span class="atl-btns"><button type="button" class="atl-btn atl-acc-dg-f" data-act="addr-remove">' + esc(T('atl.acc.addrDelYes', 'Ha, o‘chirish')) + '</button>' +
                '<button type="button" class="atl-btn atl-acc-light" data-act="addr-disarm">' + esc(T('atl.cancel', 'Bekor qilish')) + '</button></span></div></div>'
            : '') +
          '<p class="atl-hint">' + esc(T('atl.acc.addrHint')) + '</p>'
      }
      return '<div class="atl-lst">' + row({ i: 'pin', b: p.label || T('atl.co.addr', 'Manzil'), s: p.address,
        right: '<span class="atl-tag">' + esc(T('atl.acc.addrMain', 'Asosiy')) + '</span>', act: 'addr-edit' }) + '</div>'
    }
    return '<div id="acc-map"></div>' +
      '<form class="atl-form" id="acc-addr-form" novalidate>' +
        field('acc-addr', T('atl.co.addr', 'Manzil'), '<input class="atl-inp" id="acc-addr" autocomplete="street-address" maxlength="300" placeholder="' + esc(T('atl.co.addrPh', 'Ko‘cha, uy, mo‘ljal…')) + '" value="' + esc(p ? p.address : '') + '" required>') +
        field('acc-addr-label', T('atl.acc.addrLabel', 'Nomi'), '<input class="atl-inp" id="acc-addr-label" maxlength="40" placeholder="' + esc(T('atl.acc.addrLabelPh', 'Uy, Ish…')) + '" value="' + esc(p && p.label ? p.label : '') + '">', { opt: 1 }) +
        '<button type="submit" class="atl-btn atl-btn-g atl-btn-w" data-tma-main>' + esc(T('atl.acc.saveAddr', 'Manzilni saqlash')) + '</button>' +
        (p && !isDesk() ? '<button type="button" class="atl-btn atl-btn-w atl-acc-dg" data-act="addr-remove">' + esc(T('atl.cart.remove', 'O‘chirish')) + '</button>' : '') +
        '<button type="button" class="atl-btn atl-btn-w" data-act="addr-cancel">' + esc(T('atl.cancel', 'Bekor qilish')) + '</button>' +
      '</form>'
  }

  function language() {
    const now = I() ? I().getLang() : 'uz'
    return '<div class="atl-acc-opts" role="radiogroup" aria-label="' + esc(T('atl.acc.lang', 'Til')) + '">' +
      radio('lang', 'uz', 'O‘zbekcha', '', now === 'uz') + radio('lang', 'ru', 'Русский', '', now === 'ru') + radio('lang', 'en', 'English', '', now === 'en') + '</div>'
  }

  function themeNow() {
    let stored = null
    try { stored = localStorage.getItem('loom_theme') } catch (e) { /* private mode */ }
    return stored === 'light' || stored === 'dark' ? stored : 'auto'
  }
  function theme() {
    const th = themeNow()
    return '<div class="atl-acc-opts" role="radiogroup" aria-label="' + esc(T('atl.acc.theme', 'Mavzu')) + '">' +
      radio('theme', 'auto', T('atl.theme.auto', 'Avto'), T('atl.theme.autoSub'), th === 'auto') +
      radio('theme', 'light', T('atl.theme.light', 'Yorug‘'), '', th === 'light') +
      radio('theme', 'dark', T('atl.theme.dark', 'Qorong‘i'), '', th === 'dark') + '</div>'
  }

  function notifications() {
    const o = T('atl.acc.notifOrder', 'Buyurtma holati')
    const pr = T('atl.acc.notifPromo', 'Aksiya va yangiliklar')
    return '<div class="atl-lst">' +
      row({ b: o, s: T('atl.acc.notifOrderSub'), right: tgl(user.notify_orders !== 0, o, ' data-notif="notify_orders"') }) +
      row({ b: pr, s: T('atl.acc.notifPromoSub'), right: tgl(user.notify_promo !== 0, pr, ' data-notif="notify_promo"') }) +
      '</div><p class="atl-hint">' + esc(T('atl.acc.notifHint')) + '</p>'
  }

  function privacy() {
    let consent = null
    try { consent = localStorage.getItem('loom_consent') } catch (e) { /* private mode */ }
    const on = consent === 'granted'
    const a = T('atl.acc.analytics', 'Analitika cookie')
    // analytics.js handles any click on [data-consent] (saves the choice, starts or stops the tags).
    return '<div class="atl-lst">' +
      row({ b: a, s: T('atl.acc.analyticsSub'), right: tgl(on, a, ' data-consent="' + (on ? 'denied' : 'granted') + '" data-act="consent"') }) +
      row({ i: 'doc', b: T('atl.acc.dataCopy', 'Ma’lumotlarim nusxasi'), s: T('atl.acc.dataCopySub'), href: BOT, attrs: ' rel="noopener"' }) +
      (isDesk() ? row({ i: 'doc', b: T('atl.acc.receipts', 'To‘lov cheklari'), s: T('atl.acc.receiptsSub') }) : '') +
      row({ i: 'shield', b: T('atl.acc.policy', 'Maxfiylik siyosati'), href: 'privacy.html' }) +
    '</div>'
  }

  function del() {
    if (!orders) return '<span class="atl-skel" style="height:120px"></span>'
    const what = '<section class="atl-grp"><h2>' + esc(T('atl.acc.delErased', 'O‘chiriladi')) + '</h2><ul>' +
        ['atl.acc.delE1', 'atl.acc.delE2', 'atl.acc.delE3'].map((k) => '<li>' + esc(T(k)) + '</li>').join('') + '</ul></section>' +
      '<section class="atl-grp"><h2>' + esc(T('atl.acc.delKept', 'Saqlanadi')) + '</h2><p class="atl-sm">' + esc(T('atl.acc.delKeptSub')) + '</p></section>'
    const cancel = '<a class="atl-btn atl-btn-g atl-btn-w" href="account.html" data-act="hub">' + esc(T('atl.cancel', 'Bekor qilish')) + '</a>'
    const lead = '<p class="atl-lead">' + esc(T('atl.acc.delLead')) + '</p>'
    let b
    if (user.delete_requested_at) {
      b = '<div class="atl-banner atl-banner-info">' + ic('check', 1) + '<div class="atl-banner-tx">' +
          esc(fill(T('atl.acc.delScheduled'), { orders: orderList() || '—' })) + '</div></div>' +
        '<button type="button" class="atl-btn atl-btn-w" data-act="del-undo">' + esc(T('atl.acc.delUndo', 'O‘chirishni bekor qilish')) + '</button>'
    } else if (openOrders().length) {
      b = '<div class="atl-banner atl-banner-info">' + ic('pkg', 1) + '<div class="atl-banner-tx">' +
          esc(fill(T('atl.acc.delActive'), { orders: orderList() })) + '</div></div>' + what +
        '<button type="button" class="atl-btn atl-btn-w atl-acc-dg" data-act="del">' + esc(T('atl.acc.delAfter', 'Yetkazilgandan keyin o‘chirish')) + '</button>' + cancel
    } else if (armed) {
      b = '<div class="atl-banner" role="alert">' + ic('alert', 1) + '<div class="atl-banner-tx">' + esc(T('atl.acc.delWarn')) + '</div></div>' + what +
        '<button type="button" class="atl-btn atl-btn-w atl-acc-dg-f" data-act="del">' + esc(T('atl.acc.delConfirm', 'Ha, butunlay o‘chirilsin')) + '</button>' + cancel
    } else {
      b = what + '<button type="button" class="atl-btn atl-btn-w atl-acc-dg" data-act="del-arm">' + esc(T('atl.acc.delete', 'Akkauntni o‘chirish')) + '</button>' + cancel
    }
    return lead + '<div class="atl-acc-del">' + b + '</div>'
  }

  /* Orders, as on order.html's list (unpaid first, then the newest). */
  const som = (n) => (I() ? I().formatPrice(n) : Number(n || 0).toLocaleString('ru-RU') + ' so‘m')
  const owes = (o) => o.payment_method === 'p2p' && o.status === 'new' && (o.payment_status === 'unpaid' || o.payment_status === 'failed')
  function pill(o) {
    let k = 'awaiting'
    if (o.status === 'cancelled') k = 'cancelled'
    else if (o.status === 'delivered') k = 'delivered'
    else if (o.status === 'shipped') k = 'shipped'
    else if (o.status === 'producing') k = 'production'
    else if (o.payment_status === 'paid') k = 'paid'
    else if (o.payment_status === 'pending') k = 'review'
    else if (o.payment_status === 'failed') k = 'rejected'
    const tone = { awaiting: ' atl-pill-no', rejected: ' atl-pill-no', cancelled: ' atl-pill-no', delivered: ' atl-pill-ok' }[k] || ''
    return '<span class="atl-pill' + tone + '">' + esc(T('atl.st.' + k)) + '</span>'
  }
  // Same date wording as order.js: Uzbek spelled out ("14-noyabr"), browsers have no Uzbek Latin dates.
  const UZ_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr']
  function when(ms) {
    if (!ms) return ''
    const d = new Date(Number(ms))
    const lg = I() ? I().getLang() : 'uz'
    if (lg === 'uz') return d.getDate() + '-' + UZ_MONTHS[d.getMonth()]
    return d.toLocaleDateString(lg === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'long' })
  }
  function ordersView() {
    if (!orders) return '<span class="atl-skel" style="height:64px"></span><span class="atl-skel" style="height:64px"></span>'
    if (!orders.length) {
      return '<p class="atl-lead">' + esc(T('atl.orders.emptyLead')) + '</p>' +
        '<a class="atl-btn atl-btn-p atl-acc-fit" href="configurator.html">' + esc(T('atl.nav.create', 'Dizayn yaratish')) + '</a>'
    }
    const rank = (o) => (owes(o) ? 0 : 1)
    const sorted = orders.slice().sort((a, b) => rank(a) - rank(b) || b.created_at - a.created_at)
    const t0 = Date.now()
    const line = (o) => {
      const sub = owes(o) && o.pay_deadline
        ? fill(T('atl.orders.payWithin'), { min: Math.max(1, Math.ceil((o.pay_deadline - t0) / 60000)) })
        : when(o.created_at)
      return '<a class="atl-row" href="order.html?id=' + encodeURIComponent(o.id) + '"><span class="atl-row-ico">' + ic('pkg', 1) + '</span>' +
        '<span class="atl-row-tx" style="gap:4px"><b>#' + esc(o.id) + ' · ' + esc(sub) + '</b><span>' + pill(o) + '</span></span>' +
        '<span class="atl-row-v atl-num">' + esc(som(o.total_price)) + '</span>' + ic('chev', 1) + '</a>'
    }
    const part = (key, list) => list.length
      ? '<section class="atl-grp"><h2>' + esc(T(key)) + '</h2><div class="atl-lst">' + list.map(line).join('') + '</div></section>' : ''
    return part('atl.orders.active', sorted.filter(isOpen)) + part('atl.orders.done', sorted.filter((o) => !isOpen(o)))
  }

  /** Desktop side list: label left, what is set right, the open one marked. */
  function sideNav(sec) {
    const L = { uz: 'O‘zbekcha', ru: 'Русский', en: 'English' }
    const p = preset()
    const unpaid = (orders || []).filter(owes).length
    const items = [
      ['orders', T('atl.orders.title', 'Buyurtmalarim'), unpaid ? '<span class="atl-bdg atl-acc-bdg">' + unpaid + '</span>' : ''],
      ['profile', T('atl.acc.profile', 'Profil'), esc(displayName())],
      ['phone', T('atl.acc.phone', 'Telefon raqami'), user.phone_verified ? esc(fmtPhone(user.phone)) : '<span class="atl-warn">' + esc(T('atl.acc.unverified', 'Tasdiqlanmagan')) + '</span>'],
      ['addresses', T('atl.acc.addresses', 'Manzillar'), p ? esc(p.label || T('atl.co.addr', 'Manzil')) : '—'],
      ['language', T('atl.acc.lang', 'Til'), esc(L[I() ? I().getLang() : 'uz'])],
      ['theme', T('atl.acc.theme', 'Mavzu'), esc(T('atl.theme.' + themeNow()))],
      ['notifications', T('atl.acc.notifications', 'Bildirishnomalar'), 'Telegram'],
      ['privacy', T('atl.acc.privacy', 'Maxfiylik'), ''],
      ['designer', user.is_designer ? T('dz.studioTitle', 'Dizayner kabineti') : T('atl.acc.becomeDesigner', 'Dizayner bo‘lish'), '']
    ]
    const sub = [user.phone ? fmtPhone(user.phone) : '', user.phone_verified ? T('atl.acc.viaTg', 'Telegram orqali') : ''].filter(Boolean).join(' · ')
    return '<nav class="atl-acc-nav" aria-label="' + esc(T('atl.nav.profile', 'Profil')) + '">' +
      '<div class="atl-acc-who"><b>' + esc(displayName() || T('atl.nav.profile', 'Profil')) + '</b>' + (sub ? '<span class="atl-num">' + esc(sub) + '</span>' : '') + '</div>' +
      items.map((it) => '<a href="#' + it[0] + '"' + (sec === it[0] ? ' aria-current="page"' : '') + '><span>' + esc(it[1]) + '</span>' +
        '<span class="atl-acc-nav-v">' + it[2] + ic('chev', 1) + '</span></a>').join('') +
      '<div class="atl-acc-out">' +
        '<button type="button" class="atl-lnk" data-act="logout">' + esc(T('atl.acc.logout', 'Chiqish')) + '</button>' +
        '<a class="atl-lnk atl-acc-delk" href="#delete"' + (sec === 'delete' ? ' aria-current="page"' : '') + '>' + esc(T('atl.acc.delete', 'Akkauntni o‘chirish')) + '</a>' +
      '</div></nav>'
  }
  function scheduledBanner() {
    if (!user || !user.delete_requested_at) return ''
    return '<div class="atl-banner" role="status">' + ic('alert', 1) + '<div class="atl-banner-tx"><span>' +
      esc(fill(T('atl.acc.delScheduled'), { orders: orderList() || '—' })) + '</span>' +
      '<span class="atl-btns"><button type="button" class="atl-btn atl-acc-light" data-act="del-undo">' + esc(T('atl.acc.delUndo', 'O‘chirishni bekor qilish')) + '</button></span></div></div>'
  }

  const RENDER = { orders: ordersView, profile, phone, addresses, language, theme, notifications, privacy, delete: del, designer: () => '' }

  function render() {
    let sec = section()
    if (sec && !user && PUBLIC.indexOf(sec) === -1) sec = ''
    const desk = isDesk() && !!user
    if (desk && !sec) sec = 'orders'
    if (sec !== 'addresses') { addrEdit = false; addrArm = false; dropPicker() }
    if (sec !== 'delete') armed = false
    // the studio is static markup (designer.js owns it): park it outside view before redrawing
    if (studio && studio.parentNode !== main) main.appendChild(studio)
    main.classList.toggle('atl-acc-wide', desk)
    if (desk) {
      head(sec)
      view.innerHTML = '<div class="atl-acc-d">' + sideNav(sec) +
        '<div class="atl-acc-body" id="acc-body">' + (sec === 'delete' ? '' : scheduledBanner()) +
        '<h1 class="atl-t2">' + esc(document.title.replace(/ — LOOM$/, '')) + '</h1>' + RENDER[sec]() + '</div></div>'
      if (sec === 'designer' && studio) document.getElementById('acc-body').appendChild(studio)
    } else {
      view.innerHTML = head(sec) + (sec ? RENDER[sec]() : hub())
    }
    if (studio) studio.hidden = sec !== 'designer'
    main.removeAttribute('aria-busy')
    if (sec === 'addresses' && addrEdit) mountPicker()
    if (window.LOOM_SHELL) window.LOOM_SHELL.syncMain()
  }

  /* ── address map (same picker as checkout; plain field when it cannot load) ── */
  function mapOffline(host) {
    host.innerHTML = '<p class="atl-hint">' + esc(T('co.mapOffline', 'Xarita mavjud emas. Manzilni qo‘lda kiriting.')) + '</p>'
  }
  function mountPicker() {
    const host = document.getElementById('acc-map')
    if (!host) return
    const p = preset()
    const initial = p && p.lat && p.lng ? { lat: p.lat, lng: p.lng } : null
    let skip = !!initial   // the first settle re-reads the saved spot: keep the typed text
    if (!window.LOOM_ADDRESS) return mapOffline(host)
    window.LOOM_ADDRESS.load().then(() => {
      if (!document.body.contains(host)) return
      picker = window.LOOM_ADDRESS.mount(host, {
        initial,
        onChange (a) {
          if (skip) { skip = false; return }
          const inp = document.getElementById('acc-addr')
          if (a && a.address && inp) { inp.value = a.address; fieldErr('acc-addr', null) }
        }
      })
      if (!picker) mapOffline(host)   // no WebGL
    }).catch(() => { if (document.body.contains(host)) mapOffline(host) })
  }
  function dropPicker() {
    if (picker) { try { picker.destroy() } catch (e) { /* already gone */ } picker = null }
  }

  /* ── actions ─────────────────────────────────────────────────── */
  async function patch(body) {
    const data = await call('PATCH', '/api/auth/profile', body)
    Object.assign(user, data)
    cacheUser()
    return data
  }
  async function guard(btn, fn) {
    if (busy) return
    busy = true
    if (btn) btn.disabled = true
    try { await fn() } catch (e) { if (e.message !== 'auth') toast(errText(), true) } finally {
      busy = false
      if (btn && document.body.contains(btn)) btn.disabled = false
    }
  }

  view.addEventListener('submit', (e) => {
    e.preventDefault()
    const form = e.target
    const btn = form.querySelector('[type="submit"]')
    if (form.id === 'acc-profile-form') {
      const first = document.getElementById('acc-first').value.trim()
      const last = document.getElementById('acc-last').value.trim()
      if (!first) return fieldErr('acc-first', T('co.needName', 'Ismingizni kiriting'))
      fieldErr('acc-first', null)
      guard(btn, async () => {
        await patch({ name: [first, last].filter(Boolean).join(' ') })
        if (isDesk()) render()   // the side list shows the new name at once
        if (window.LOOM_SHELL && window.LOOM_SHELL.repaintMe) window.LOOM_SHELL.repaintMe()
        toast(T('atl.saved', 'Saqlandi!'))
      })
    } else if (form.id === 'acc-addr-form') {
      const address = document.getElementById('acc-addr').value.trim()
      const label = document.getElementById('acc-addr-label').value.trim()
      if (!address) return fieldErr('acc-addr', T('atl.acc.needAddr', 'Manzilni kiriting'))
      fieldErr('acc-addr', null)
      const at = picker && picker.get()
      const old = preset()
      // Coordinates only when they belong to this text (from the map now, or kept from before).
      const coords = at && at.address ? { lat: at.lat, lng: at.lng } : (old && old.address === address ? { lat: old.lat || null, lng: old.lng || null } : { lat: null, lng: null })
      guard(btn, async () => {
        await patch({ location_preset: Object.assign({ address, label: label || undefined }, coords) })
        addrEdit = false
        render()
        toast(T('atl.saved', 'Saqlandi!'))
      })
    }
  })

  view.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act], [data-lang], [data-theme], [data-notif]')
    if (!el || !view.contains(el)) return
    const act = el.getAttribute('data-act')
    if (el.hasAttribute('data-lang')) {
      if (I()) I().setLang(el.getAttribute('data-lang'))   // loom:langchange re-renders
    } else if (el.hasAttribute('data-theme')) {
      const v = el.getAttribute('data-theme')
      const B = window.__loomTheme
      if (v === 'auto') {
        try { localStorage.removeItem('loom_theme') } catch (err) { /* private mode */ }
        if (B) B.applyOnly(B.effective())
      } else if (B) B.set(v)
      render()
    } else if (el.hasAttribute('data-notif')) {
      const key = el.getAttribute('data-notif')
      const on = el.getAttribute('aria-checked') !== 'true'
      el.setAttribute('aria-checked', String(on))
      guard(null, async () => {
        try { await patch({ [key]: on }) } catch (err) { el.setAttribute('aria-checked', String(!on)); throw err }
      })
    } else if (act === 'consent') {
      // analytics.js saved the choice in its capture listener; withdrawing reloads the page.
      setTimeout(render, 0)
    } else if (act === 'hub') {
      e.preventDefault()
      goHub()
    } else if (act === 'logout') {
      if (window.LOOM_SHELL && window.LOOM_SHELL.flash) window.LOOM_SHELL.flash('out')
      if (window.LOOM_AUTH) window.LOOM_AUTH.logout()
    } else if (act === 'addr-arm') {
      addrArm = true
      render()
      const yes = view.querySelector('[data-act="addr-remove"]')
      if (yes) yes.focus()
    } else if (act === 'addr-disarm') {
      addrArm = false
      render()
      const back = view.querySelector('[data-act="addr-arm"]')
      if (back) back.focus()
    } else if (act === 'addr-edit') {
      addrEdit = true
      render()
      const inp = document.getElementById('acc-addr')
      if (inp) inp.focus({ preventScroll: true })
    } else if (act === 'addr-cancel') {
      addrEdit = false
      dropPicker()
      render()
    } else if (act === 'addr-remove') {
      guard(el, async () => {
        await patch({ location_preset: null })
        addrEdit = false
        addrArm = false
        dropPicker()
        render()
        toast(T('atl.saved', 'Saqlandi!'))
      })
    } else if (act === 'del-arm') {
      armed = true
      render()
    } else if (act === 'del') {
      guard(el, async () => {
        const r = await call('DELETE', '/api/auth/account')
        if (r.scheduled) {
          user.delete_requested_at = r.delete_requested_at || Date.now()
          cacheUser()
          render()
          return
        }
        try { sessionStorage.removeItem('loom_user') } catch (err) { /* private mode */ }
        if (window.LOOM_SHELL && window.LOOM_SHELL.flash) window.LOOM_SHELL.flash('deleted')
        if (window.LOOM_AUTH) await window.LOOM_AUTH.logout()
        else location.href = 'index.html'
      })
    } else if (act === 'del-undo') {
      guard(el, async () => {
        await call('POST', '/api/auth/account/restore')
        user.delete_requested_at = null
        cacheUser()
        render()
        toast(T('atl.acc.delUndone', 'O‘chirish bekor qilindi'))
      })
    }
  })

  /* Back to the hub: history when we came from it, else replace (direct open). */
  function goHub() {
    if (inPage) history.back()
    else location.replace('account.html')
  }
  document.addEventListener('click', (e) => {
    const back = e.target.closest && e.target.closest('[data-atl-back]')
    if (!back || !section()) return
    e.preventDefault()
    e.stopImmediatePropagation()
    goHub()
  }, true)

  window.addEventListener('hashchange', () => {
    inPage = true
    render()
    window.scrollTo(0, 0)
  })
  window.addEventListener('loom:langchange', () => { if (!picker) render() })
  window.addEventListener('loom:themechange', () => { if (section() === 'theme' || !section()) render() })

  /* ── boot ────────────────────────────────────────────────────── */
  async function boot() {
    const A = window.LOOM_AUTH
    user = A ? await A.getCurrentUser(true).catch(() => null) : null
    render()
    if (!user) return
    try { orders = (await call('GET', '/api/me/orders')).orders || [] } catch (e) { orders = [] }
    const sec = section()
    if (!sec || sec === 'delete' || sec === 'orders' || (isDesk() && !addrEdit && sec !== 'profile')) render()
  }
  // crossing 900 px swaps hub and side list (not while a form is open)
  if (mq && mq.addEventListener) mq.addEventListener('change', () => { if (!addrEdit) render() })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
