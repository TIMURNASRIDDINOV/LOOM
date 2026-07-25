'use strict'

/* LOOM Admin — application shell: sidebar, topbar, account menu, capability
   gating. All styling lives in theme.css (render-blocking, in <head>); the
   initial theme is applied synchronously by theme-init.js so there is no flash.

   CAPABILITIES
   /api/admin/me returns the admin's effective capability list (role preset plus
   the owner's per-person overrides). Two things consume it:
     • the sidebar — a destination the admin cannot open is never rendered;
     • [data-cap="…"] elements anywhere on the page — those the admin lacks are
       REMOVED from the DOM, the rest get data-cap-ok and become visible.
   theme.css hides [data-cap] by default, so this fails closed: a slow /me call
   shows nothing privileged rather than showing everything and retracting it.  */

;(function () {
  // Inline 18px stroke icons. Keeps the shell self-contained (no icon font,
  // no extra request) and gives each destination a distinguishable mark —
  // the old set reused the same glyph for two different pages.
  const ICONS = {
    overview: '<path d="M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z"/>',
    orders:   '<path d="M3 6h18M3 12h18M3 18h11"/>',
    clients:  '<path d="M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1"/><circle cx="9.5" cy="7" r="3.5"/><path d="M17 11l2 2 4-4"/>',
    products: '<path d="M20.5 7.5 12 12l-8.5-4.5M12 12v9.5M20.5 7.5v9l-8.5 4.5-8.5-4.5v-9L12 3z"/>',
    bell:     '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    team:     '<path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    ai:       '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="3.5"/>',
  }

  function icon(name) {
    return '<span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg></span>'
  }

  /* Information architecture. Sections mirror how the work actually splits —
     day-to-day selling, the things being sold, outbound comms, and the
     configuration you touch rarely. Every entry declares the capability that
     makes it reachable; `cap: null` means "any signed-in admin". */
  const NAV_GROUPS = [
    {
      label: null,
      items: [
        { id: 'dashboard', label: 'Обзор', href: 'dashboard.html', icon: 'overview', cap: 'analytics.view' },
      ],
    },
    {
      label: 'Продажи',
      items: [
        { id: 'orders', label: 'Заказы',  href: 'orders.html', icon: 'orders',  cap: 'orders.view' },
        { id: 'users',  label: 'Клиенты', href: 'users.html',  icon: 'clients', cap: 'users.view' },
      ],
    },
    {
      label: 'Каталог',
      items: [
        { id: 'products', label: 'Товары', href: 'products.html', icon: 'products', cap: 'products.view' },
      ],
    },
    {
      label: 'Связь',
      items: [
        // Previously unreachable: the page existed with no link to it anywhere.
        { id: 'notifications', label: 'Уведомления', href: 'notifications.html', icon: 'bell', cap: 'notifications.view' },
      ],
    },
    {
      label: 'Настройки',
      items: [
        { id: 'team',    label: 'Команда и доступы', href: 'team.html',    icon: 'team', cap: null },
        { id: 'ai-test', label: 'AI-лаборатория',    href: 'ai-test.html', icon: 'ai',   cap: 'ai.use' },
      ],
    },
  ]

  const ROLE_LABELS = { owner: 'Владелец', manager: 'Менеджер', staff: 'Сотрудник' }

  const THEME_KEY = (window.__loomTheme && window.__loomTheme.KEY) || 'loom_admin_theme'
  const COLLAPSE_KEY = 'loom_admin_sidebar_collapsed'
  const effective = (window.__loomTheme && window.__loomTheme.effective) || function (t) {
    if (t === 'light' || t === 'dark') return t
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  function store(key, value) { try { localStorage.setItem(key, value) } catch (e) { /* private mode */ } }
  function read(key, fallback) { try { return localStorage.getItem(key) || fallback } catch (e) { return fallback } }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  // ── Theme ───────────────────────────────────────────────────────────────
  function applyTheme(theme) {
    const html = document.documentElement
    const eff = effective(theme)
    html.setAttribute('data-theme', eff)
    html.style.colorScheme = eff
    store(THEME_KEY, theme)
    document.querySelectorAll('.segmented [data-theme]').forEach((btn) => {
      const on = btn.dataset.theme === theme
      btn.classList.toggle('active', on)
      btn.setAttribute('aria-pressed', on ? 'true' : 'false')
    })
  }

  // ── Chrome ──────────────────────────────────────────────────────────────
  function buildSidebar() {
    const aside = document.createElement('aside')
    aside.className = 'sidebar'
    aside.id = 'sidebar'
    aside.innerHTML =
      '<a href="dashboard.html" class="sidebar-brand"><span class="brand-text">LOOM</span></a>' +
      '<nav class="sidebar-nav" id="sidebar-nav" aria-label="Разделы админки"></nav>' +
      '<div class="sidebar-foot">' +
        '<button type="button" class="sidebar-collapse-btn" id="sidebar-collapse" aria-label="Свернуть меню">' +
          '<span aria-hidden="true">‹‹</span><span>Свернуть</span>' +
        '</button>' +
      '</div>'
    return aside
  }

  function buildTopbar(pageTitle, crumbs) {
    const bar = document.createElement('header')
    bar.className = 'topbar'
    const crumbHtml = (crumbs && crumbs.length)
      ? '<nav class="topbar-crumbs" aria-label="Хлебные крошки">' +
          crumbs.map((c) => c.href
            ? '<a href="' + esc(c.href) + '">' + esc(c.label) + '</a><span class="sep" aria-hidden="true">/</span>'
            : '').join('') +
        '</nav>'
      : ''
    bar.innerHTML =
      '<button type="button" class="menu-toggle" id="menu-toggle" aria-label="Открыть меню" aria-expanded="false">☰</button>' +
      crumbHtml +
      '<h1 class="topbar-title" id="topbar-title">' + esc(pageTitle || '') + '</h1>' +
      '<div class="topbar-spacer"></div>' +
      '<div class="account">' +
        '<button type="button" class="account-btn" id="account-btn" aria-haspopup="true" aria-expanded="false">' +
          '<span class="avatar" id="account-avatar" aria-hidden="true">—</span>' +
          '<span class="caret" aria-hidden="true">▼</span>' +
          '<span class="sr-only">Аккаунт и настройки</span>' +
        '</button>' +
        '<div class="account-menu" id="account-menu" hidden>' +
          '<div class="account-menu-head">' +
            '<p class="account-email" id="account-email">…</p>' +
            '<p class="account-role" id="account-role"></p>' +
          '</div>' +
          '<p class="account-menu-label">Оформление</p>' +
          '<div class="segmented" role="group" aria-label="Тема оформления">' +
            '<button type="button" data-theme="light">Светлая</button>' +
            '<button type="button" data-theme="dark">Тёмная</button>' +
            '<button type="button" data-theme="system">Авто</button>' +
          '</div>' +
          '<button type="button" class="btn btn--block account-logout" id="account-logout">Выйти</button>' +
        '</div>' +
      '</div>'
    return bar
  }

  function renderNav(activePage, capabilities) {
    const nav = document.getElementById('sidebar-nav')
    if (!nav) return []
    const allowed = []
    let html = ''
    NAV_GROUPS.forEach((group) => {
      const items = group.items.filter((i) => !i.cap || capabilities.has(i.cap))
      if (!items.length) return
      allowed.push.apply(allowed, items)
      html += '<div class="nav-group">' +
        (group.label ? '<p class="nav-group-label">' + esc(group.label) + '</p>' : '') +
        items.map((item) =>
          '<a href="' + esc(item.href) + '" class="sidebar-link' + (item.id === activePage ? ' active' : '') + '"' +
            (item.id === activePage ? ' aria-current="page"' : '') + ' title="' + esc(item.label) + '">' +
            icon(item.icon) + '<span class="label">' + esc(item.label) + '</span>' +
          '</a>').join('') +
        '</div>'
    })
    nav.innerHTML = html
    return allowed
  }

  // ── Capability gating ───────────────────────────────────────────────────
  // Elements the admin may not use are deleted, not hidden: a control that is
  // merely display:none is still in the DOM, still focusable by some tooling,
  // and still reads as "this exists but is broken" when someone finds it.
  function applyCapabilities(capabilities) {
    document.querySelectorAll('[data-cap]').forEach((el) => {
      const needed = el.getAttribute('data-cap').split(/[\s,]+/).filter(Boolean)
      if (needed.every((cap) => capabilities.has(cap))) el.setAttribute('data-cap-ok', '')
      else el.remove()
    })
    document.querySelectorAll('[data-cap-not]').forEach((el) => {
      const needed = el.getAttribute('data-cap-not').split(/[\s,]+/).filter(Boolean)
      if (needed.some((cap) => !capabilities.has(cap))) el.setAttribute('data-cap-ok', '')
      else el.remove()
    })
    document.body.classList.add('caps-ready')
  }

  // ── Wiring ──────────────────────────────────────────────────────────────
  function wireAccountMenu() {
    const btn = document.getElementById('account-btn')
    const menu = document.getElementById('account-menu')
    if (!btn || !menu) return

    function setOpen(open) {
      menu.hidden = !open
      btn.setAttribute('aria-expanded', open ? 'true' : 'false')
    }
    btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(menu.hidden) })
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) setOpen(false)
    })
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) { setOpen(false); btn.focus() }
    })

    menu.querySelectorAll('[data-theme]').forEach((b) => {
      b.addEventListener('click', () => applyTheme(b.dataset.theme))
    })
    document.getElementById('account-logout').addEventListener('click', () => window.LOOM.logout())
  }

  function wireSidebarControls() {
    const collapse = document.getElementById('sidebar-collapse')
    if (collapse) {
      collapse.addEventListener('click', () => {
        const on = !document.body.classList.contains('sidebar-collapsed')
        document.body.classList.toggle('sidebar-collapsed', on)
        collapse.setAttribute('aria-label', on ? 'Развернуть меню' : 'Свернуть меню')
        store(COLLAPSE_KEY, on ? '1' : '0')
      })
    }

    const toggle = document.getElementById('menu-toggle')
    const scrim = document.createElement('div')
    scrim.className = 'scrim'
    document.body.appendChild(scrim)
    function setNav(open) {
      document.body.classList.toggle('nav-open', open)
      if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false')
    }
    if (toggle) toggle.addEventListener('click', () => setNav(!document.body.classList.contains('nav-open')))
    scrim.addEventListener('click', () => setNav(false))
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setNav(false) })
  }

  function wrapContent(pageTitle, crumbs) {
    const main = document.createElement('div')
    main.className = 'main-content'
    main.appendChild(buildTopbar(pageTitle, crumbs))
    while (document.body.firstChild) main.appendChild(document.body.firstChild)
    document.body.appendChild(main)
    return main
  }

  /* init(activePage, options)
       activePage — nav id to highlight
       options.title  — topbar heading (defaults to the nav item's label)
       options.crumbs — [{label, href}] shown before the title on detail pages */
  function init(activePage, options) {
    const opts = options || {}

    function run() {
      document.body.classList.add('has-sidebar')
      if (read(COLLAPSE_KEY, '0') === '1') document.body.classList.add('sidebar-collapsed')

      const navItem = NAV_GROUPS.reduce((found, g) =>
        found || g.items.filter((i) => i.id === activePage)[0], null)
      const title = opts.title || (navItem ? navItem.label : document.title.split('—')[0].trim())

      // Topbar first (it lives inside .main-content), then the sidebar.
      wrapContent(title, opts.crumbs)
      document.body.insertBefore(buildSidebar(), document.body.firstChild)

      wireSidebarControls()
      wireAccountMenu()
      applyTheme(read(THEME_KEY, 'system'))

      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (read(THEME_KEY, 'system') === 'system') applyTheme('system')
      })

      if (!(window.LOOM && window.LOOM.checkAuth)) return
      window.LOOM.checkAuth().then((me) => {
        if (!me) { window.location.href = 'login.html'; return }

        const caps = new Set(me.capabilities || [])
        window.LOOM.me = me
        window.LOOM.caps = caps
        window.LOOM.can = (cap) => caps.has(cap)

        document.body.dataset.adminRole = me.role || 'staff'
        const avatar = document.getElementById('account-avatar')
        if (avatar) avatar.textContent = (me.email || '?').charAt(0)
        const emailEl = document.getElementById('account-email')
        if (emailEl) emailEl.textContent = me.email || ''
        const roleEl = document.getElementById('account-role')
        if (roleEl) roleEl.textContent = ROLE_LABELS[me.role] || me.role || ''

        const allowed = renderNav(activePage, caps)
        applyCapabilities(caps)

        // Land somewhere useful rather than on an empty page the admin's
        // capabilities do not cover (e.g. no analytics.view → no dashboard).
        const current = NAV_GROUPS.reduce((found, g) =>
          found || g.items.filter((i) => i.id === activePage)[0], null)
        if (current && current.cap && !caps.has(current.cap)) {
          if (allowed.length) window.location.replace(allowed[0].href)
          return
        }

        document.dispatchEvent(new CustomEvent('loom:ready', { detail: { me: me, caps: caps } }))
      })
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run)
    else run()
  }

  // Run `fn(me, caps)` once capabilities are known — before that, a page cannot
  // tell whether an action is permitted.
  function onReady(fn) {
    if (window.LOOM && window.LOOM.caps) { fn(window.LOOM.me, window.LOOM.caps); return }
    document.addEventListener('loom:ready', (e) => fn(e.detail.me, e.detail.caps), { once: true })
  }

  function setTitle(text) {
    const el = document.getElementById('topbar-title')
    if (el) el.textContent = text
  }

  window.LOOM_LAYOUT = { init, onReady, setTitle, ROLE_LABELS }
})()
