'use strict'

/* LOOM Admin shared layout: sidebar + theme toggle.
   All styling lives in theme.css (render-blocking, in <head>).
   The initial theme is applied synchronously by theme-init.js (also in <head>)
   so there is no flash; this file only builds the chrome and wires the toggle. */

;(function () {
  const NAV_ITEMS = [
    { id: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: '⊞' },
    { id: 'orders',    label: 'Заказы',     href: 'orders.html',   icon: '◫' },
    { id: 'products',  label: 'Продукты',   href: 'products.html', icon: '◻' },
    { id: 'users',     label: 'Пользователи', href: 'users.html',  icon: '○' },
  ]

  const THEME_KEY = (window.__loomTheme && window.__loomTheme.KEY) || 'loom_admin_theme'
  const effective = (window.__loomTheme && window.__loomTheme.effective) || function (t) {
    if (t === 'light' || t === 'dark') return t
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  function getStoredTheme() {
    try { return localStorage.getItem(THEME_KEY) || 'system' } catch (e) { return 'system' }
  }

  function applyTheme(theme) {
    const html = document.documentElement
    const eff = effective(theme)
    html.setAttribute('data-theme', eff)
    html.style.colorScheme = eff
    try { localStorage.setItem(THEME_KEY, theme) } catch (e) { /* ignore */ }
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === theme)
    })
  }

  function buildSidebar(activePage) {
    const navHtml = NAV_ITEMS.map(item => `
      <a href="${item.href}" class="sidebar-link${item.id === activePage ? ' active' : ''}">
        <span class="icon">${item.icon}</span>${item.label}
      </a>
    `).join('')

    const aside = document.createElement('aside')
    aside.className = 'sidebar'
    aside.innerHTML = `
      <a href="dashboard.html" class="sidebar-brand">LOOM</a>
      <nav class="sidebar-nav">${navHtml}</nav>
      <div class="sidebar-footer">
        <span class="sidebar-email" id="sidebar-email"></span>
        <div class="theme-toggle-row">
          <button class="theme-btn" data-theme="light" title="Светлая тема">☀ Светлая</button>
          <button class="theme-btn" data-theme="dark"  title="Тёмная тема">◑ Тёмная</button>
          <button class="theme-btn" data-theme="system" title="Системная тема">⊙ Авто</button>
        </div>
        <button class="sidebar-logout" id="sidebar-logout">Выйти</button>
      </div>
    `
    return aside
  }

  function wrapContent() {
    // Wrap everything that isn't the sidebar into .main-content
    const main = document.createElement('div')
    main.className = 'main-content'
    while (document.body.firstChild) {
      main.appendChild(document.body.firstChild)
    }
    document.body.appendChild(main)
  }

  function init(activePage) {
    function run() {
      document.body.classList.add('has-sidebar')

      const sidebar = buildSidebar(activePage)
      wrapContent()
      document.body.insertBefore(sidebar, document.body.firstChild)

      document.getElementById('sidebar-logout').addEventListener('click', () => {
        window.LOOM.logout()
      })

      document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', () => applyTheme(btn.dataset.theme))
      })
      // Reflect current stored choice on the buttons (theme already applied in <head>)
      applyTheme(getStoredTheme())

      // Load the admin's role → drives nav + per-action gating (CSS in theme.css).
      if (window.LOOM && window.LOOM.checkAuth) {
        window.LOOM.checkAuth().then((me) => {
          if (!me) return
          setEmail(me.email)
          const role = me.role || 'staff'
          document.body.dataset.adminRole = role
          const emailEl = document.getElementById('sidebar-email')
          if (emailEl && !document.getElementById('sidebar-role')) {
            const r = document.createElement('span')
            r.id = 'sidebar-role'; r.className = 'sidebar-role'
            r.textContent = role
            emailEl.insertAdjacentElement('afterend', r)
          }
          if (role === 'owner') {
            const nav = sidebar.querySelector('.sidebar-nav')
            if (nav && !nav.querySelector('[data-team]')) {
              const a = document.createElement('a')
              a.href = 'team.html'
              a.className = 'sidebar-link' + (activePage === 'team' ? ' active' : '')
              a.setAttribute('data-team', '1')
              a.innerHTML = '<span class="icon">◈</span>Команда'
              nav.appendChild(a)
            }
          }
        })
      }

      // Respond to system theme changes while in 'system' mode
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (getStoredTheme() === 'system') applyTheme('system')
      })
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run)
    } else {
      run()
    }
  }

  function setEmail(email) {
    const el = document.getElementById('sidebar-email')
    if (el) el.textContent = email
  }

  window.LOOM_LAYOUT = { init, setEmail }
})()
