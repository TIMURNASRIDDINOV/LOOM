'use strict'

;(function () {
  const NAV_ITEMS = [
    { id: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: '⊞' },
    { id: 'orders',    label: 'Заказы',     href: 'orders.html',   icon: '◫' },
    { id: 'products',  label: 'Продукты',   href: 'products.html', icon: '◻' },
    { id: 'users',     label: 'Пользователи', href: 'users.html',  icon: '○' },
  ]

  const CSS = `
    html, body { height: 100%; }
    body { display: flex !important; flex-direction: row !important; background: #0a0a0a; color: #fff; margin: 0; }
    .sidebar {
      width: 220px; flex-shrink: 0;
      background: #080808;
      border-right: 0.5px solid rgba(255,255,255,0.08);
      height: 100vh; position: sticky; top: 0;
      display: flex; flex-direction: column;
      padding: 0; overflow-y: auto; z-index: 50;
    }
    .sidebar-brand {
      font-family: 'DM Mono', monospace;
      font-size: 0.78rem; letter-spacing: 0.22em; text-transform: uppercase;
      color: rgba(255,255,255,0.9); padding: 1.5rem 1.25rem 1.25rem;
      border-bottom: 0.5px solid rgba(255,255,255,0.06);
      text-decoration: none; display: block;
    }
    .sidebar-nav { flex: 1; padding: 0.75rem 0; }
    .sidebar-link {
      display: flex; align-items: center; gap: 0.6rem;
      padding: 0.6rem 1.25rem; font-size: 0.85rem;
      color: rgba(255,255,255,0.45); text-decoration: none;
      transition: color 0.12s, background 0.12s;
      border-left: 2px solid transparent;
    }
    .sidebar-link:hover { color: rgba(255,255,255,0.8); background: rgba(255,255,255,0.03); }
    .sidebar-link.active { color: #fff; border-left-color: #fff; background: rgba(255,255,255,0.04); }
    .sidebar-link .icon { font-size: 0.9rem; opacity: 0.7; width: 1.1rem; text-align: center; }
    .sidebar-footer {
      padding: 1rem 1.25rem; border-top: 0.5px solid rgba(255,255,255,0.06);
      display: flex; flex-direction: column; gap: 0.4rem;
    }
    .sidebar-email { font-size: 0.72rem; color: rgba(255,255,255,0.3); word-break: break-all; }
    .sidebar-logout {
      padding: 0.4rem 0.7rem; border: 0.5px solid rgba(255,255,255,0.15);
      border-radius: 3px; background: transparent; color: rgba(255,255,255,0.5);
      font-family: inherit; font-size: 0.75rem; cursor: pointer;
      transition: all 0.15s; text-align: left;
    }
    .sidebar-logout:hover { color: #fff; border-color: rgba(255,255,255,0.4); }
    .main-content { flex: 1; min-width: 0; overflow-y: auto; }
    /* Hide legacy top nav if present */
    .nav { display: none !important; }
  `

  function injectCSS() {
    const style = document.createElement('style')
    style.textContent = CSS
    document.head.appendChild(style)
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
      injectCSS()
      const sidebar = buildSidebar(activePage)
      wrapContent()
      document.body.insertBefore(sidebar, document.body.firstChild)

      document.getElementById('sidebar-logout').addEventListener('click', () => {
        window.LOOM.logout()
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
