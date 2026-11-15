/* ================================================================
   LOOM — order page (PRD-216, LOOM-323 phase 10). Markup: order.html,
   styles: atelye.css + the page's inline <style>.

   order.html            the customer's orders, unpaid first
   order.html?id=N       one order. While it still has to be paid it IS
                         the payment screen: 30-minute timer (server
                         clock), amount + card with copy buttons, the
                         receipt screenshot (required, local preview),
                         "To'ladim". Then: receipt sent / payment check,
                         rejected (with the reason and a fresh window),
                         expired (a late receipt revives the order) and
                         the status steps. Old cash-on-delivery orders
                         keep their old wording.

   Telegram links here as https://loomdesign.uz/order?id=N (reminder,
   expiry, confirm, reject messages). In the Mini App the page's main
   button ([data-tma-main]) becomes Telegram's MainButton (shell.js).

   API (backend/API.md, "Prepayment by card transfer"):
     GET  /api/me/orders            {orders}
     GET  /api/me/orders/:id        {order, items, status_log, now, can_revive, card}
     POST /api/me/orders/:id/receipt  multipart `file`
     POST /api/me/orders/:id/paid
================================================================ */
'use strict'
;(function () {
  const main = document.getElementById('main')
  if (!main) return

  const BOT = 'https://t.me/looom_design_bot'
  const MAX_BYTES = 10 * 1024 * 1024
  const TYPES = ['image/png', 'image/jpeg', 'image/webp']
  const LOW_MS = 5 * 60 * 1000
  const orderId = (location.search.match(/[?&]id=(\d+)/) || [])[1] || null

  /* ── helpers ─────────────────────────────────────────────────── */
  const I = () => window.LOOM_I18N
  const lang = () => (I() ? I().getLang() : 'uz')
  /** A string, or `fallback` while the key is not in i18n.js yet. */
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
  const som = (n) => (I() ? I().formatPrice(n) : Number(n || 0).toLocaleString('ru-RU') + ' so‘m')
  const num = (id) => '#' + id
  // Browsers have no reliable Uzbek Latin dates ("M11 15"), so Uzbek is spelled out: "14-noyabr, 10:42".
  const UZ_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr']
  function when(ms, withTime) {
    if (!ms) return ''
    const d = new Date(Number(ms))
    const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
    if (lang() === 'uz') return d.getDate() + '-' + UZ_MONTHS[d.getMonth()] + (withTime ? ', ' + hm : '')
    const day = d.toLocaleDateString(lang() === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'long' })
    return withTime ? day + ', ' + hm : day
  }
  function kb(bytes) {
    return bytes >= 1024 * 1024 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB'
  }

  const P = {
    clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
    copy: 'M9 9h10v11H9zM5 15V4h10',
    upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
    trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
    check: 'M5 12l5 5 9-11',
    alert: 'M12 3l10 18H2zM12 10v4M12 17h.01',
    pin: 'M12 21s7-6.2 7-11.5a7 7 0 10-14 0C5 14.8 12 21 12 21zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
    cash: 'M3 7h18v10H3zM12 15a3 3 0 100-6 3 3 0 000 6z',
    tg: 'M21 4L3 11l6 2 2 6 3-4 5 4z',
    chev: 'M9 5l7 7-7 7',
    receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
    bag: 'M5 8h14l-1 12H6zM9 8V7a3 3 0 016 0v1'
  }
  const ic = (n, s) => '<svg class="atl-ic' + (s ? ' atl-ic-s' : '') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + P[n] + '"/></svg>'

  /* ── API ─────────────────────────────────────────────────────── */
  const API = () => (window.LOOM_CONFIG && window.LOOM_CONFIG.API_BASE) || 'https://api.loomdesign.uz'
  function headers() {
    const tok = window.LOOM_AUTH && window.LOOM_AUTH.getToken()
    return tok ? { Authorization: 'Bearer ' + tok } : {}
  }
  async function call(method, path, body) {
    const res = await fetch(API() + path, { method, headers: headers(), credentials: 'include', body })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) { toLogin(); throw Object.assign(new Error('auth'), { status: 401 }) }
    if (!res.ok) throw Object.assign(new Error(data.error || 'HTTP ' + res.status), { status: res.status, code: data.code })
    return data
  }
  function toLogin() {
    location.replace('login.html?next=' + encodeURIComponent('order.html' + location.search))
  }

  /* Garment previews: the mockup PNGs the configurator uploaded. They are
     private to their uploader, so they come through an authorised fetch. */
  const thumbCache = {}
  function loadThumbs() {
    main.querySelectorAll('img[data-key]').forEach((img) => {
      // desktop-only panels: no fetch while a phone hides them
      if (img.closest('.atl-only-d') && getComputedStyle(img.closest('.atl-only-d')).display === 'none') return
      const key = img.getAttribute('data-key')
      const set = (url) => { img.src = url; img.hidden = false }
      if (thumbCache[key]) return set(thumbCache[key])
      fetch(API() + '/api/uploads/' + key.split('/').map(encodeURIComponent).join('/'), { headers: headers(), credentials: 'include' })
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => { if (b) set(thumbCache[key] = URL.createObjectURL(b)) })
        .catch(() => {})
    })
  }
  const thumb = (key) => '<span class="atl-thumb atl-cv">' +
    (key ? '<img data-key="' + esc(key) + '" alt="" hidden>' : ic('bag')) + '</span>'

  /* ── order state ─────────────────────────────────────────────── */
  const isP2p = (o) => o.payment_method === 'p2p'
  const owes = (o) => isP2p(o) && o.status === 'new' && (o.payment_status === 'unpaid' || o.payment_status === 'failed')

  // Old cash-on-delivery orders keep the wording they were placed with.
  const COD_STATUS = {
    uz: { new: 'Yangi', confirmed: 'Tasdiqlangan', producing: 'Ishlab chiqarilmoqda', shipped: 'Jo‘natilgan', delivered: 'Yetkazilgan', cancelled: 'Bekor qilingan' },
    ru: { new: 'Новый', confirmed: 'Подтверждён', producing: 'Производство', shipped: 'Отправлен', delivered: 'Доставлен', cancelled: 'Отменён' },
    en: { new: 'New', confirmed: 'Confirmed', producing: 'In production', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' }
  }
  const codLabel = (s) => (COD_STATUS[lang()] || COD_STATUS.uz)[s] || s

  /** [i18n key or cod label, pill tone] */
  function pill(o) {
    if (!isP2p(o)) {
      const tone = o.status === 'delivered' ? ' atl-pill-ok' : o.status === 'cancelled' ? ' atl-pill-no' : ''
      return '<span class="atl-pill' + tone + '">' + esc(codLabel(o.status)) + '</span>'
    }
    let k = 'production'
    if (o.status === 'cancelled') k = 'cancelled'
    else if (o.status === 'delivered') k = 'delivered'
    else if (o.status === 'shipped') k = 'shipped'
    else if (o.status === 'producing') k = 'production'
    else if (o.payment_status === 'paid') k = 'paid'
    else if (o.payment_status === 'pending') k = 'review'
    else if (o.payment_status === 'failed') k = 'rejected'
    else k = 'awaiting'
    const tone = { awaiting: ' atl-pill-no', rejected: ' atl-pill-no', cancelled: ' atl-pill-no', delivered: ' atl-pill-ok' }[k] || ''
    return '<span class="atl-pill' + tone + '">' + esc(T('atl.st.' + k)) + '</span>'
  }

  /* ── page state ──────────────────────────────────────────────── */
  const S = {
    list: null,        // GET /api/me/orders
    data: null,        // GET /api/me/orders/:id
    offset: 0,         // server clock minus device clock
    view: null,        // 'pay' | 'expired' | 'placed' | 'detail'
    shown: null,       // the view on screen (scroll to top when it changes)
    revive: false,     // pay screen opened from "expired"
    file: null,        // {url, name, size} local preview of the receipt
    upload: 'none',    // none | busy | done | error
    uploadErr: '',
    paying: false,
    timer: 0,
    poll: 0
  }
  const now = () => Date.now() + S.offset

  function setTitle(text) {
    const h = document.querySelector('.atl-mbar h1')
    if (h) h.textContent = text
    document.title = text + ' — LOOM'
  }
  function toast(text, err) {
    const old = document.querySelector('.atl-toast')
    if (old) old.remove()
    const el = document.createElement('div')
    el.className = 'atl-toast' + (err ? ' atl-toast-err' : '')
    el.setAttribute('role', err ? 'alert' : 'status')
    el.innerHTML = ic(err ? 'alert' : 'check', 's') + '<span>' + esc(text) + '</span>'
    document.body.appendChild(el)
    setTimeout(() => el.remove(), 2600)
  }
  function stateBlock(o) {
    return '<div class="atl-empty atl-center">' +
      '<span class="atl-cv">' + ic(o.icon || 'alert') + '</span>' +
      '<h1 class="atl-t2">' + esc(o.title) + '</h1>' +
      '<p class="atl-lead">' + esc(o.lead) + '</p>' +
      '<div class="atl-btns" style="width:100%;max-width:420px">' + o.btns + '</div></div>'
  }
  function done() {
    main.removeAttribute('aria-busy')
    loadThumbs()
    if (window.LOOM_SHELL) window.LOOM_SHELL.syncMain()
  }
  function fail(e) {
    if (e && e.status === 401) return
    main.classList.remove('atl-ord-hasbar')
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    main.innerHTML = stateBlock({
      title: T('atl.state.errT', 'Nimadir noto‘g‘ri ketdi'),
      lead: offline ? T('atl.state.offline') : T('atl.state.errL'),
      btns: '<button type="button" class="atl-btn atl-btn-g" data-act="reload">' + esc(T('atl.reload', 'Yangilash')) + '</button>'
    })
    done()
  }

  /* ════ Orders list ════════════════════════════════════════════ */
  async function loadList() {
    try { S.list = (await call('GET', '/api/me/orders')).orders || [] } catch (e) { return fail(e) }
    renderList()
  }
  function renderList() {
    const orders = S.list
    setTitle(T('atl.orders.title', 'Buyurtmalarim'))
    if (!orders.length) {
      main.innerHTML = stateBlock({
        icon: 'bag',
        title: T('atl.orders.empty'),
        lead: T('atl.orders.emptyLead'),
        btns: '<a class="atl-btn atl-btn-p" href="configurator.html">' + esc(T('atl.nav.create', 'Dizayn yaratish')) + '</a>'
      })
      return done()
    }
    // Unpaid first (they open the payment screen), then the newest.
    const rank = (o) => (owes(o) ? 0 : 1)
    const sorted = orders.slice().sort((a, b) => rank(a) - rank(b) || b.created_at - a.created_at)
    const active = sorted.filter((o) => o.status !== 'delivered' && o.status !== 'cancelled')
    const closed = sorted.filter((o) => o.status === 'delivered' || o.status === 'cancelled')
    const t0 = Date.now()
    const row = (o) => {
      let sub = when(o.created_at)
      if (owes(o) && o.pay_deadline) {
        const min = Math.max(1, Math.ceil((o.pay_deadline - t0) / 60000))
        sub = fill(T('atl.orders.payWithin'), { min })
      }
      return '<a class="atl-row" href="order.html?id=' + o.id + '">' + thumb(o.front_mockup_key) +
        '<span class="atl-row-tx" style="gap:4px"><b>' + esc(num(o.id) + ' · ' + sub) + '</b><span>' + pill(o) + '</span></span>' +
        '<span class="atl-row-v atl-num">' + esc(som(o.total_price)) + '</span>' + ic('chev', 's') + '</a>'
    }
    const grp = (key, list) => list.length
      ? '<section class="atl-grp"><h2>' + esc(T(key)) + '</h2><div class="atl-lst">' + list.map(row).join('') + '</div></section>' : ''
    main.innerHTML = '<h1 class="atl-t1 atl-only-d">' + esc(T('atl.orders.title')) + '</h1>' +
      grp('atl.orders.active', active) + grp('atl.orders.done', closed)
    done()
  }

  /* ════ One order ══════════════════════════════════════════════ */
  async function loadOrder(keepView) {
    let data
    try { data = await call('GET', '/api/me/orders/' + orderId) } catch (e) {
      if (e && e.status === 404) return notFound()
      return fail(e)
    }
    S.data = data
    S.offset = (data.now || Date.now()) - Date.now()
    const o = data.order
    if (!keepView || !S.view) {
      if (owes(o)) S.view = 'pay'
      else if (data.can_revive) S.view = S.revive ? 'pay' : 'expired'
      else S.view = 'detail'
    }
    // A stored receipt counts as uploaded (the server never sends it back).
    if (o.receipt && S.upload === 'none') S.upload = 'done'
    render()
  }
  function notFound() {
    main.classList.remove('atl-ord-hasbar')
    main.innerHTML = stateBlock({
      title: T('atl.od.notFoundT', 'Buyurtma topilmadi'),
      lead: T('atl.od.notFoundL', 'Bunday buyurtma yo‘q yoki u boshqa akkauntga tegishli. Buyurtmalaringiz ro‘yxatini oching.'),
      btns: '<a class="atl-btn atl-btn-g" href="order.html">' + esc(T('atl.orders.title', 'Buyurtmalarim')) + '</a>'
    })
    setTitle(T('atl.orders.title', 'Buyurtmalarim'))
    done()
  }

  function render() {
    clearInterval(S.timer); clearTimeout(S.poll)
    const o = S.data.order
    main.classList.toggle('atl-ord-hasbar', S.view === 'pay')
    if (S.shown && S.shown !== S.view) window.scrollTo(0, 0)
    S.shown = S.view
    if (S.view === 'pay') renderPay(o)
    else if (S.view === 'expired') renderExpired(o)
    else if (S.view === 'placed') renderPlaced(o)
    else renderDetail(o)
    done()
  }

  /* ── payment screen ──────────────────────────────────────────── */
  function cardBank(n) {
    if (/^8600|^5614/.test(n)) return 'Uzcard'
    if (/^9860/.test(n)) return 'Humo'
    return ''
  }
  function timerHtml(o) {
    if (S.revive || !o.pay_deadline) return ''
    return '<div data-timer></div>'
  }
  function paintTimer() {
    const box = main.querySelector('[data-timer]')
    const o = S.data && S.data.order
    if (!box || !o) return
    const left = o.pay_deadline - now()
    if (left <= 0) {
      clearInterval(S.timer)
      S.view = null
      return loadOrder()   // the server cancels it on read; the page shows "expired"
    }
    const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60
    const time = m + ':' + String(s).padStart(2, '0')
    const line = esc(T('atl.pay.timer')).replace(esc('{time}'), '<b class="atl-num">' + time + '</b>')
    const low = left <= LOW_MS
    const html = low
      ? '<div class="atl-banner" role="status">' + ic('clock', 's') + '<span class="atl-banner-tx"><span>' + line + '</span><span>' + esc(T('atl.pay.reminder')) + '</span></span></div>'
      : '<p class="atl-banner atl-banner-info">' + ic('clock', 's') + '<span class="atl-banner-tx"><span>' + line + '</span></span></p>'
    // Desktop only: how much of the 30-minute window is left, as a bar.
    const pct = Math.max(0, Math.min(1, left / (30 * 60000))).toFixed(4)
    const bar = '<span class="atl-ord-tbar atl-only-d' + (low ? ' is-low' : '') + '" aria-hidden="true"><i style="transform:scaleX(' + pct + ')"></i></span>'
    // Rebuild only when the tone changes; otherwise swap the digits (screen readers stay calm).
    if (box.getAttribute('data-low') !== String(low)) { box.innerHTML = html + bar; box.setAttribute('data-low', String(low)) }
    else {
      const b = box.querySelector('b'); if (b) b.textContent = time
      const i = box.querySelector('.atl-ord-tbar i'); if (i) i.style.transform = 'scaleX(' + pct + ')'
    }
  }

  function rejectBanner(o) {
    if (o.payment_status !== 'failed') return ''
    const msg = o.pay_reject_reason === 'amount_mismatch' ? T('atl.od.rejectMismatch') : T('atl.od.rejectNotFound')
    return '<div class="atl-banner" role="alert">' + ic('alert', 's') + '<span class="atl-banner-tx"><span>' + esc(msg) + '</span>' +
      '<span class="atl-btns"><a class="atl-btn" href="' + BOT + '" target="_blank" rel="noopener">' + esc(T('atl.od.writeSupport')) + '</a></span></span></div>'
  }

  function renderPay(o) {
    const card = S.data.card
    const total = o.total_price
    const delivery = o.delivery_fee || 0
    setTitle(fill(T('atl.pay.title'), { order: num(o.id) }))

    let cardBox
    if (card && card.number) {
      const digits = String(card.number).replace(/\D/g, '')
      const grouped = digits.replace(/(\d{4})(?=\d)/g, '$1 ')
      const bank = cardBank(digits)
      cardBox = '<section class="atl-card"><span class="atl-sm">' + esc(T('atl.pay.card') + (bank ? ' · ' + bank : '')) + '</span>' +
        '<div class="atl-ord-copy"><b class="atl-ord-cardno">' + esc(grouped) + '</b>' +
        '<button type="button" class="atl-btn" data-copy="' + esc(digits) + '">' + ic('copy', 's') + '<span>' + esc(T('atl.copy')) + '</span></button></div>' +
        (card.holder ? '<span class="atl-sm">' + esc(fill(T('atl.pay.holder'), { holder: card.holder })) + '</span>' : '') + '</section>'
    } else {
      cardBox = '<p class="atl-banner" role="alert">' + ic('alert', 's') + '<span class="atl-banner-tx">' + esc(T('atl.co.p2pOff')) + '</span></p>'
    }

    const left = '<div class="atl-ord-col">' + rejectBanner(o) + timerHtml(o) +
      '<section class="atl-card"><span class="atl-sm">' + esc(T('atl.pay.amount')) + '</span>' +
        '<div class="atl-ord-copy"><b class="atl-ord-amt">' + esc(som(total)) + '</b>' +
        '<button type="button" class="atl-btn" data-copy="' + total + '">' + ic('copy', 's') + '<span>' + esc(T('atl.copy')) + '</span></button></div>' +
        (delivery ? '<span class="atl-sm">' + esc(fill(T('atl.pay.amountNote'), { items: som(total - delivery), delivery: som(delivery) })) + '</span>' : '') +
      '</section>' + cardBox +
      '<ol class="atl-ol">' +
        '<li><b>1</b><span><b>' + esc(T('atl.pay.s1')) + '</b><i>' + esc(T('atl.pay.s1Sub')) + '</i></span></li>' +
        '<li><b>2</b><span><b>' + esc(T('atl.pay.s2')) + '</b><i>' + esc(fill(T('atl.pay.s2Sub'), { amount: som(total) })) + '</i></span></li>' +
        '<li><b>3</b><span><b>' + esc(T('atl.pay.s3')) + '</b><i>' + esc(T('atl.pay.s3Sub')) + '</i></span></li>' +
      '</ol></div>'

    const has = S.upload === 'done'
    let rc
    if (S.upload === 'none' || S.upload === 'error') {
      rc = '<label class="atl-ord-drop" for="rcpt">' + ic('upload') + '<b>' + esc(T('atl.pay.upload')) + '</b>' +
        '<span class="atl-sm">' + esc(T('atl.pay.uploadHint')) + '</span></label>'
    } else {
      const f = S.file
      const pic = f ? '<img class="atl-ord-prev" src="' + esc(f.url) + '" alt="">' : '<span class="atl-thumb atl-cv">' + ic('receipt') + '</span>'
      const sub = S.upload === 'busy' ? T('atl.sending') : f ? fill(T('atl.pay.uploaded'), { size: kb(f.size) }) : ''
      rc = '<div class="atl-row atl-panel">' + pic + '<span class="atl-row-tx"><b>' + esc(f ? f.name : T('atl.pay.receiptOk')) + '</b>' +
        (sub ? '<i>' + (S.upload === 'busy' ? '<span class="atl-spin" aria-hidden="true"></span> ' : '') + esc(sub) + '</i>' : '') + '</span>' +
        (S.upload === 'done' ? '<button type="button" class="atl-ib" data-act="remove" aria-label="' + esc(T('atl.pay.removeReceipt')) + '">' + ic('trash', 's') + '</button>' : '') + '</div>'
    }
    const err = S.uploadErr ? '<p class="atl-ferr" role="alert">' + ic('alert', 's') + '<span>' + esc(S.uploadErr) + '</span></p>' : ''
    const off = !has || S.paying || !card
    const btn = '<button type="button" class="atl-btn atl-btn-p atl-btn-w" data-act="paid" data-tma-main' +
      (off ? ' aria-disabled="true"' : '') + (S.paying ? ' aria-busy="true"' : '') + '>' +
      (S.paying ? '<span class="atl-spin" aria-hidden="true"></span>' : '') + '<span>' + esc(T('atl.pay.paid')) + '</span></button>'
    const right = '<section class="atl-card atl-stick"><h2 class="atl-t3">' + esc(T('atl.pay.receipt')) + '</h2>' +
      '<input class="atl-ord-file" id="rcpt" type="file" accept="image/png,image/jpeg,image/webp" tabindex="-1" aria-hidden="true">' +
      rc + err +
      '<div class="atl-ord-bar"><span class="atl-ord-bar-pr atl-only-m"><b>' + esc(som(total)) + '</b>' +
        '<span class="atl-sm' + (has ? '' : ' atl-warn') + '">' + esc(has ? T('atl.pay.receiptOk') : T('atl.pay.receiptNeeded')) + '</span></span>' + btn + '</div>' +
      (has ? '' : '<p class="atl-hint">' + esc(T('atl.pay.needReceipt')) + '</p>') +
      '<p class="atl-sm"><a class="atl-lnk" href="' + BOT + '" target="_blank" rel="noopener">' + esc(T('atl.questions')) + '</a></p></section>'

    main.innerHTML = '<h1 class="atl-t1 atl-only-d">' + esc(fill(T('atl.pay.title'), { order: num(o.id) })) + '</h1>' +
      '<div class="atl-two atl-ord-pay">' + left + right + paySide(o) + '</div>'
    // The upload zone is a <label>: keyboard users reach it through this.
    const drop = main.querySelector('.atl-ord-drop')
    if (drop) {
      drop.tabIndex = 0
      drop.setAttribute('role', 'button')
      drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick() } })
      // A file dragged from the desktop goes through the same checks as a picked one.
      const over = (on) => (e) => { e.preventDefault(); drop.classList.toggle('is-over', on) }
      drop.addEventListener('dragenter', over(true))
      drop.addEventListener('dragover', over(true))
      drop.addEventListener('dragleave', over(false))
      drop.addEventListener('drop', (e) => { over(false)(e); onFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) })
    }
    if (timerHtml(o)) { paintTimer(); S.timer = setInterval(paintTimer, 1000) }
  }

  /* Desktop only: what is being paid for, and what happens after To'ladim. */
  function paySide(o) {
    const items = S.data.items || []
    const delivery = o.delivery_fee || 0
    const itemsSum = items.reduce((s, it) => s + (it.unit_price || 0) * (it.quantity || 1), 0)
    const list = items.map((it) => '<div class="atl-row">' + thumb(it.front_mockup_key) +
      '<span class="atl-row-tx"><b>' + esc(it.product_name || '—') + '</b><i>' + esc(fill(T('atl.pcs'), { n: it.quantity || 1 })) + '</i></span>' +
      '<span class="atl-row-v atl-num">' + esc(som((it.unit_price || 0) * (it.quantity || 1))) + '</span></div>').join('')
    return '<aside class="atl-ord-side atl-only-d">' +
      '<section class="atl-card"><h2 class="atl-t3">' + esc(T('atl.co.summary', 'Sizning buyurtmangiz')) + '</h2>' +
        (list ? '<div class="atl-lst">' + list + '</div>' : '') +
        '<div class="atl-price-lines">' +
          (delivery ? '<div><span>' + esc(T('atl.sum.items')) + '</span><span>' + esc(som(itemsSum || o.total_price - delivery)) + '</span></div>' +
            '<div><span>' + esc(T('atl.sum.delivery')) + '</span><span>' + esc(som(delivery)) + '</span></div>' : '') +
          '<div class="atl-price-tot"><span>' + esc(T('atl.sum.total')) + '</span><span>' + esc(som(o.total_price)) + '</span></div></div></section>' +
      '<section class="atl-card"><h2 class="atl-t3">' + esc(T('atl.pay.nextT', 'Keyin nima bo‘ladi')) + '</h2>' +
        '<p class="atl-sm">' + esc(fill(T('atl.pay.nextL'), { hours: T('atl.hours', '9:00–21:00') })) + '</p></section>' +
      '</aside>'
  }

  function pick() {
    const inp = document.getElementById('rcpt')
    if (inp) inp.click()
  }

  async function onFile(file) {
    S.uploadErr = ''
    if (!file) return
    if (TYPES.indexOf(file.type) === -1) { S.uploadErr = T('atl.pay.errType'); return render() }
    if (file.size > MAX_BYTES) { S.uploadErr = T('atl.pay.errSize'); return render() }
    if (S.file) URL.revokeObjectURL(S.file.url)
    S.file = { url: URL.createObjectURL(file), name: file.name || 'receipt', size: file.size }
    S.upload = 'busy'
    render()
    const form = new FormData()
    form.append('file', file, file.name || 'receipt')
    try {
      await call('POST', '/api/me/orders/' + orderId + '/receipt', form)
      S.upload = 'done'
      render()
    } catch (e) {
      S.upload = 'error'
      S.uploadErr = e.code === 'receipt_invalid' ? T('atl.pay.errType')
        : e.code === 'receipt_too_large' ? T('atl.pay.errSize')
        : e.code === 'rate_limited' ? T('atl.pay.errRate', 'Juda ko‘p urinish. Bir necha daqiqadan keyin qayta urinib ko‘ring.')
        : T('atl.pay.errUpload')
      if (e.code === 'order_not_payable') { S.view = null; return loadOrder() }
      render()
    }
  }

  async function onPaid() {
    if (S.paying || S.upload !== 'done') return
    S.paying = true
    render()
    try {
      await call('POST', '/api/me/orders/' + orderId + '/paid')
      S.paying = false
      S.revive = false
      S.view = 'placed'
      await loadOrder(true)
    } catch (e) {
      S.paying = false
      if (e.code === 'receipt_required') { S.upload = 'none'; S.file = null; S.uploadErr = T('atl.pay.needReceipt'); return render() }
      if (e.code === 'order_not_payable') { S.view = null; return loadOrder() }
      render()
      if (e.status !== 401) toast(e.code === 'rate_limited' ? T('atl.pay.errRate', 'Juda ko‘p urinish. Bir necha daqiqadan keyin qayta urinib ko‘ring.') : T('atl.co.noServer'), true)
    }
  }

  async function copy(text) {
    let ok = false
    try { await navigator.clipboard.writeText(text); ok = true } catch (e) {
      const ta = document.createElement('textarea')
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      try { ok = document.execCommand('copy') } catch (e2) { ok = false }
      ta.remove()
    }
    if (ok) toast(T('atl.copied'))
  }

  /* ── expired (cancelled by the timeout; a late receipt revives) ── */
  function renderExpired(o) {
    setTitle(T('atl.co.payment', 'To‘lov'))
    main.innerHTML = '<div class="atl-wrap-narrow">' + stateBlock({
      icon: 'clock',
      title: T('atl.pay.expiredT'),
      lead: fill(T('atl.pay.expiredL'), { order: num(o.id) }),
      btns: '<button type="button" class="atl-btn atl-btn-g" data-act="revive" data-tma-main>' + esc(T('atl.pay.sendReceipt')) + '</button>' +
        '<a class="atl-btn" href="catalog.html">' + esc(T('atl.pay.reorder')) + '</a>'
    }) + '</div>'
  }

  /* ── steps ───────────────────────────────────────────────────── */
  function logAt(status) {
    const log = S.data.status_log || []
    for (let i = log.length - 1; i >= 0; i--) if (log[i].new_status === status) return log[i].changed_at
    return null
  }
  function steps(list, cur) {
    return '<ol class="atl-steps">' + list.map((s, j) => {
      const cls = j < cur ? 'atl-done' : j === cur ? 'atl-cur' : ''
      const dot = j < cur ? ic('check', 's') : j === cur ? '' : String(j + 1)
      return '<li' + (cls ? ' class="' + cls + '"' : '') + '><span class="atl-steps-dot">' + dot + '</span><span><b>' + esc(s[0]) + '</b>' +
        (s[1] ? '<i>' + esc(s[1]) + '</i>' : '') + '</span></li>'
    }).join('') + '</ol>'
  }

  /* ── receipt sent: what happens next ─────────────────────────── */
  function renderPlaced(o) {
    setTitle(T('atl.placed.title'))
    const lead = esc(T('atl.placed.leadHtml')).replace(/&lt;b&gt;/g, '<b class="atl-num">').replace(/&lt;\/b&gt;/g, '</b>')
    main.innerHTML = '<div class="atl-wrap-narrow atl-ord-col">' +
      '<span class="atl-ord-ring atl-cv">' + ic('clock') + '</span>' +
      '<h1 class="atl-t1">' + esc(T('atl.placed.h1')) + '</h1>' +
      '<p class="atl-lead">' + fill(lead, { order: esc(num(o.id)), amount: esc(som(o.total_price)) }) + '</p>' +
      steps([
        [T('atl.placed.sent'), when(o.receipt_at, true)],
        [T('atl.placed.checking'), T('atl.placed.checkingSub')],
        [T('atl.placed.production'), T('atl.placed.productionSub')],
        [T('atl.placed.delivery'), T('atl.placed.deliverySub')]
      ], 1) +
      '<div class="atl-btns"><button type="button" class="atl-btn atl-btn-g" data-act="track" data-tma-main>' + esc(T('atl.placed.track')) + '</button>' +
      '<a class="atl-btn" href="catalog.html">' + esc(T('atl.placed.backCatalog')) + '</a></div></div>'
  }

  /* ── order detail ────────────────────────────────────────────── */
  function renderDetail(o) {
    setTitle(num(o.id))
    const p2p = isP2p(o)
    const items = S.data.items || []
    let stepHtml = ''
    let cur = 0
    if (o.status !== 'cancelled') {
      if (p2p) {
        // Steps follow the money: receipt, confirmed payment, production, road, door.
        const pay = o.payment_status
        cur = o.status === 'delivered' ? 5 : o.status === 'shipped' ? 3 : pay === 'paid' ? 2 : 1
        stepHtml = steps([
          [T('atl.placed.sent'), when(o.receipt_at, true)],
          [pay === 'paid' ? T('atl.st.paid') : T('atl.placed.checking'),
            pay === 'paid' ? T('atl.od.paidSub') : cur === 1 ? T('atl.od.checkingSub') : ''],
          [T('atl.placed.production'), cur === 2 ? T('atl.placed.productionSub') : ''],
          [T('atl.st.shipped'), cur === 3 ? T('atl.od.shippedSub') : ''],
          [T('atl.st.delivered'), cur >= 5 ? when(logAt('delivered')) : '']
        ], cur)
      } else {
        const order = ['new', 'confirmed', 'producing', 'shipped', 'delivered']
        cur = o.status === 'delivered' ? 5 : order.indexOf(o.status)
        stepHtml = steps(order.map((s) => [codLabel(s), when(logAt(s))]), cur)
      }
    }

    const paySub = p2p
      ? som(o.total_price) + ' · ' + (o.payment_status === 'paid' ? T('atl.od.payPaid') : o.payment_status === 'failed' ? T('atl.od.payNotFound') : T('atl.od.payChecking'))
      : som(o.total_price) + ' · ' + T('co.codHint')
    const row = (icon, b, i, href) => (href ? '<a class="atl-row" href="' + href + '" target="_blank" rel="noopener">' : '<div class="atl-row">') +
      '<span class="atl-row-ico">' + ic(icon, 's') + '</span><span class="atl-row-tx"><b>' + esc(b) + '</b>' + (i ? '<i>' + esc(i) + '</i>' : '') + '</span>' +
      (href ? ic('chev', 's') + '</a>' : '</div>')
    const rows = '<div class="atl-lst">' +
      (o.address ? row('pin', o.address, o.comment || '') : '') +
      row('cash', p2p ? T('atl.co.p2p') : T('co.cod'), paySub) +
      row('tg', T('atl.od.question'), 'Telegram: @looom_design_bot', BOT) + '</div>'
    const beforeProduction = o.status === 'new' || o.status === 'confirmed'
    const cancelBtn = beforeProduction ? '<a class="atl-btn atl-btn-w" href="' + BOT + '" target="_blank" rel="noopener">' + esc(T('atl.od.cancelWrite')) + '</a>' : ''

    const itemsSum = items.reduce((s, it) => s + (it.unit_price || 0) * (it.quantity || 1), 0)
    const delivery = o.delivery_fee || 0
    const list = items.map((it) => '<div class="atl-row">' + thumb(it.front_mockup_key) +
      '<span class="atl-row-tx"><b>' + esc(it.product_name || '—') + '</b><i>' + esc(fill(T('atl.pcs'), { n: it.quantity || 1 })) + '</i></span>' +
      '<span class="atl-row-v atl-num">' + esc(som((it.unit_price || 0) * (it.quantity || 1))) + '</span></div>').join('')
    const sum = '<div class="atl-price-lines">' +
      (delivery ? '<div><span>' + esc(T('atl.sum.items')) + '</span><span>' + esc(som(itemsSum || o.total_price - delivery)) + '</span></div>' +
        '<div><span>' + esc(T('atl.sum.delivery')) + '</span><span>' + esc(som(delivery)) + '</span></div>' : '') +
      '<div class="atl-price-tot"><span>' + esc(T('atl.sum.total')) + '</span><span>' + esc(som(o.total_price)) + '</span></div></div>'

    main.innerHTML = '<div class="atl-two atl-ord-det"><div class="atl-ord-col">' +
      '<div class="atl-ord-col atl-ord-head" style="gap:6px"><h1 class="atl-t1">' + esc(fill(T('atl.od.h1'), { order: num(o.id) })) + '</h1><span>' + pill(o) + '</span>' +
      '<span class="atl-sm">' + esc(when(o.created_at, true)) + '</span></div>' +
      stepHtml + rows + cancelBtn + '</div>' +
      '<section class="atl-card atl-stick">' + (list ? '<div class="atl-lst">' + list + '</div>' : '') + sum + '</section></div>'

    // While staff check the receipt, look again every 30 s (the answer also comes in Telegram).
    if (p2p && o.payment_status === 'pending' && o.status === 'new') {
      const again = () => { if (document.hidden) S.poll = setTimeout(again, 30000); else loadOrder() }
      S.poll = setTimeout(again, 30000)
    }
  }

  /* ── events ──────────────────────────────────────────────────── */
  main.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act],[data-copy]')
    if (!el || !main.contains(el)) return
    if (el.hasAttribute('data-copy')) return copy(el.getAttribute('data-copy'))
    if (el.getAttribute('aria-disabled') === 'true') return
    const act = el.getAttribute('data-act')
    if (act === 'reload') location.reload()
    else if (act === 'paid') onPaid()
    else if (act === 'remove') { if (S.file) URL.revokeObjectURL(S.file.url); S.file = null; S.upload = 'none'; S.uploadErr = ''; render() }
    else if (act === 'revive') { S.revive = true; S.view = 'pay'; render() }
    else if (act === 'track') { S.view = 'detail'; render() }
  })
  main.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'rcpt') onFile(e.target.files && e.target.files[0])
  })
  window.addEventListener('loom:langchange', () => {
    if (orderId && S.data) render()
    else if (!orderId && S.list) renderList()
  })
  // Back from the banking app: the timer may have run out meanwhile.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && S.view === 'pay') paintTimer()
  })

  /* ── boot ────────────────────────────────────────────────────── */
  async function boot() {
    const A = window.LOOM_AUTH
    const user = A ? await A.getCurrentUser().catch(() => null) : null
    if (!user) return toLogin()
    if (orderId) loadOrder()
    else loadList()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
