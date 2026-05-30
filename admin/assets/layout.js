'use strict'

;(function () {
  const NAV_ITEMS = [
    { id: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: '⊞' },
    { id: 'orders',    label: 'Заказы',     href: 'orders.html',   icon: '◫' },
    { id: 'products',  label: 'Продукты',   href: 'products.html', icon: '◻' },
    { id: 'users',     label: 'Пользователи', href: 'users.html',  icon: '○' },
  ]

  const THEME_KEY = 'loom_admin_theme'

  const CSS = `
    /* ── Theme variables ─────────────────────────────────────────── */
    :root, [data-theme="dark"] {
      --bg:        #0a0a0a;
      --bg-sidebar:#080808;
      --bg-card:   #0f0f0f;
      --text:      #ffffff;
      --text-muted:rgba(255,255,255,0.45);
      --text-dim:  rgba(255,255,255,0.3);
      --hairline:  rgba(255,255,255,0.08);
      --hairline2: rgba(255,255,255,0.06);
      --link-color:rgba(255,255,255,0.45);
      --link-hover:rgba(255,255,255,0.8);
      --link-active:#ffffff;
      --link-active-bg:rgba(255,255,255,0.04);
      --hover-bg:  rgba(255,255,255,0.03);
      --input-bg:  rgba(255,255,255,0.05);
      --input-border:rgba(255,255,255,0.12);
      --input-border-focus:rgba(255,255,255,0.35);
      --btn-border:rgba(255,255,255,0.15);
      --btn-color: rgba(255,255,255,0.5);
      --btn-hover: #ffffff;
      --btn-hover-border:rgba(255,255,255,0.4);
      --logout-bg: transparent;
    }
    [data-theme="light"] {
      --bg:        #f2f0ec;
      --bg-sidebar:#e8e5e0;
      --bg-card:   #ece9e4;
      --text:      #1c1917;
      --text-muted:rgba(28,25,23,0.55);
      --text-dim:  rgba(28,25,23,0.38);
      --hairline:  rgba(0,0,0,0.1);
      --hairline2: rgba(0,0,0,0.07);
      --link-color:rgba(28,25,23,0.5);
      --link-hover:rgba(28,25,23,0.85);
      --link-active:#1c1917;
      --link-active-bg:rgba(0,0,0,0.06);
      --hover-bg:  rgba(0,0,0,0.04);
      --input-bg:  rgba(0,0,0,0.04);
      --input-border:rgba(0,0,0,0.14);
      --input-border-focus:rgba(0,0,0,0.38);
      --btn-border:rgba(0,0,0,0.18);
      --btn-color: rgba(28,25,23,0.55);
      --btn-hover: #1c1917;
      --btn-hover-border:rgba(0,0,0,0.4);
      --logout-bg: transparent;
    }

    html, body { height: 100%; }
    body {
      display: flex !important; flex-direction: row !important;
      background: var(--bg); color: var(--text); margin: 0;
      transition: background 0.2s, color 0.2s;
    }
    .sidebar {
      width: 220px; flex-shrink: 0;
      background: var(--bg-sidebar);
      border-right: 0.5px solid var(--hairline);
      height: 100vh; position: sticky; top: 0;
      display: flex; flex-direction: column;
      padding: 0; overflow-y: auto; z-index: 50;
      transition: background 0.2s, border-color 0.2s;
    }
    .sidebar-brand {
      font-family: 'DM Mono', monospace;
      font-size: 0.78rem; letter-spacing: 0.22em; text-transform: uppercase;
      color: var(--text); padding: 1.5rem 1.25rem 1.25rem;
      border-bottom: 0.5px solid var(--hairline2);
      text-decoration: none; display: block; opacity: 0.9;
    }
    .sidebar-nav { flex: 1; padding: 0.75rem 0; }
    .sidebar-link {
      display: flex; align-items: center; gap: 0.6rem;
      padding: 0.6rem 1.25rem; font-size: 0.85rem;
      color: var(--link-color); text-decoration: none;
      transition: color 0.12s, background 0.12s;
      border-left: 2px solid transparent;
    }
    .sidebar-link:hover { color: var(--link-hover); background: var(--hover-bg); }
    .sidebar-link.active { color: var(--link-active); border-left-color: var(--link-active); background: var(--link-active-bg); }
    .sidebar-link .icon { font-size: 0.9rem; opacity: 0.7; width: 1.1rem; text-align: center; }
    .sidebar-footer {
      padding: 1rem 1.25rem; border-top: 0.5px solid var(--hairline2);
      display: flex; flex-direction: column; gap: 0.4rem;
    }
    .sidebar-email { font-size: 0.72rem; color: var(--text-dim); word-break: break-all; }
    .sidebar-logout {
      padding: 0.4rem 0.7rem; border: 0.5px solid var(--btn-border);
      border-radius: 3px; background: var(--logout-bg); color: var(--btn-color);
      font-family: inherit; font-size: 0.75rem; cursor: pointer;
      transition: all 0.15s; text-align: left;
    }
    .sidebar-logout:hover { color: var(--btn-hover); border-color: var(--btn-hover-border); }
    .main-content { flex: 1; min-width: 0; overflow-y: auto; background: var(--bg); }

    /* Theme toggle */
    .theme-toggle-row {
      display: flex; gap: 0.25rem; margin-bottom: 0.4rem;
    }
    .theme-btn {
      flex: 1; padding: 0.3rem 0.2rem; border-radius: 3px;
      border: 0.5px solid var(--btn-border); background: transparent;
      color: var(--btn-color); font-family: inherit; font-size: 0.68rem;
      cursor: pointer; transition: all 0.12s; text-align: center;
    }
    .theme-btn:hover { color: var(--btn-hover); border-color: var(--btn-hover-border); }
    .theme-btn.active { color: var(--link-active); border-color: var(--link-active); background: var(--link-active-bg); }

    /* Always-on overrides (use CSS vars so they adapt to theme) */
    body { background: var(--bg) !important; color: var(--text) !important; }
    .card, [class*="card"] { background: var(--bg-card) !important; border-color: var(--hairline) !important; }
    .form-input, textarea.form-input, .notif-form input, .notif-form textarea {
      background: var(--input-bg) !important; border-color: var(--input-border) !important;
      color: var(--text) !important;
    }
    .form-input:focus, textarea.form-input:focus, .notif-form input:focus, .notif-form textarea:focus {
      border-color: var(--input-border-focus) !important;
    }
    .form-input::placeholder, .notif-form input::placeholder, .notif-form textarea::placeholder {
      color: var(--text-dim) !important;
    }
    .btn-action {
      border-color: var(--btn-border) !important; color: var(--btn-color) !important;
      background: transparent !important;
    }
    .btn-action:hover { color: var(--btn-hover) !important; border-color: var(--btn-hover-border) !important; }
    .btn-action.primary { border-color: var(--input-border-focus) !important; color: var(--text) !important; }
    .btn-action.danger { border-color: rgba(239,68,68,0.35) !important; color: #f87171 !important; }
    .btn-action.danger:hover { border-color: #f87171 !important; }
    .form-label, .info-label { color: var(--text-dim) !important; }
    th { color: var(--text-dim) !important; border-color: var(--hairline) !important; }
    td { border-color: var(--hairline2) !important; }
    .muted { color: var(--text-muted) !important; }
    .page-title { color: var(--text) !important; }
    .btn-back { border-color: var(--btn-border) !important; color: var(--text-muted) !important; }
    .btn-back:hover { color: var(--text) !important; border-color: var(--input-border-focus) !important; }
    select { background: var(--input-bg) !important; border-color: var(--input-border) !important; color: var(--text) !important; }

    /* Light-mode: comprehensive fixes for hardcoded dark colors */
    [data-theme="light"] { --muted: rgba(28,25,23,0.5); --hairline: rgba(0,0,0,0.1); }

    /* Reset all text to theme color */
    [data-theme="light"] .main-content *:not([style*="color"]) {
      color: var(--text) !important;
    }
    /* Restore intentionally colored elements (badges, status) */
    [data-theme="light"] .badge,
    [data-theme="light"] [class*="badge"],
    [data-theme="light"] [class*="status"] span { color: inherit; }

    /* Inputs, textareas, selects */
    [data-theme="light"] .form-input,
    [data-theme="light"] .form-textarea,
    [data-theme="light"] .form-select,
    [data-theme="light"] .form-input-sm,
    [data-theme="light"] .search-input,
    [data-theme="light"] .notif-form input,
    [data-theme="light"] .notif-form textarea {
      background: var(--input-bg) !important;
      border-color: var(--input-border) !important;
      color: var(--text) !important;
    }
    [data-theme="light"] .form-input::placeholder,
    [data-theme="light"] .form-textarea::placeholder,
    [data-theme="light"] .form-input-sm::placeholder,
    [data-theme="light"] .search-input::placeholder,
    [data-theme="light"] .notif-form input::placeholder,
    [data-theme="light"] .notif-form textarea::placeholder {
      color: var(--text-dim) !important;
    }
    [data-theme="light"] .form-input:focus,
    [data-theme="light"] .form-textarea:focus,
    [data-theme="light"] .form-select:focus,
    [data-theme="light"] .form-input-sm:focus,
    [data-theme="light"] .search-input:focus,
    [data-theme="light"] .notif-form input:focus,
    [data-theme="light"] .notif-form textarea:focus {
      border-color: var(--input-border-focus) !important;
    }
    [data-theme="light"] .form-select option { background: var(--bg-card) !important; color: var(--text) !important; }

    /* Buttons */
    [data-theme="light"] .btn-sm,
    [data-theme="light"] .btn-add-color,
    [data-theme="light"] .action-btn,
    [data-theme="light"] .activity-filter-btn {
      border-color: var(--btn-border) !important;
      color: var(--btn-color) !important;
      background: transparent !important;
    }
    [data-theme="light"] .btn-sm:hover,
    [data-theme="light"] .btn-add-color:hover,
    [data-theme="light"] .action-btn:hover,
    [data-theme="light"] .activity-filter-btn:hover {
      color: var(--btn-hover) !important;
      border-color: var(--btn-hover-border) !important;
      background: var(--hover-bg) !important;
    }
    [data-theme="light"] .activity-filter-btn.active {
      color: var(--link-active) !important;
      border-color: var(--link-active) !important;
      background: var(--link-active-bg) !important;
    }
    [data-theme="light"] .btn-primary,
    [data-theme="light"] .btn-update {
      border-color: var(--btn-border) !important;
      color: var(--btn-color) !important;
      background: var(--input-bg) !important;
    }
    [data-theme="light"] .btn-primary:hover,
    [data-theme="light"] .btn-update:hover:not(:disabled) {
      color: var(--btn-hover) !important;
      border-color: var(--btn-hover-border) !important;
      background: var(--hover-bg) !important;
    }
    /* Submit / send buttons (inverted style) */
    [data-theme="light"] .btn-submit,
    [data-theme="light"] .btn-send {
      border-color: var(--text) !important;
      background: var(--text) !important;
      color: var(--bg) !important;
    }
    [data-theme="light"] .btn-submit:hover:not(:disabled),
    [data-theme="light"] .btn-send:hover:not(:disabled) {
      background: transparent !important;
      color: var(--text) !important;
    }

    /* Table rows */
    [data-theme="light"] tbody tr { background: var(--bg-card) !important; }
    [data-theme="light"] tbody tr:hover td { background: var(--hover-bg) !important; }
    [data-theme="light"] .mini-table tr:hover { background: var(--hover-bg) !important; }
    [data-theme="light"] .mini-table tr:hover .arrow-col { color: var(--text) !important; }
    [data-theme="light"] .arrow-col { color: var(--text-dim) !important; }

    /* Labels and muted text */
    [data-theme="light"] .field-label,
    [data-theme="light"] .field-hint,
    [data-theme="light"] .form-label,
    [data-theme="light"] .info-label,
    [data-theme="light"] .design-label,
    [data-theme="light"] .page-sub,
    [data-theme="light"] .loading-ph,
    [data-theme="light"] .loading-msg,
    [data-theme="light"] .sidebar-email { color: var(--text-muted) !important; }

    /* Toggle switches */
    [data-theme="light"] .toggle-slider {
      background: rgba(0,0,0,0.12) !important;
      border-color: rgba(0,0,0,0.18) !important;
    }
    [data-theme="light"] .toggle-slider::before { background: rgba(0,0,0,0.45) !important; }
    [data-theme="light"] .toggle-label { color: var(--text-muted) !important; }
    [data-theme="light"] .color-remove { color: var(--text-dim) !important; }

    /* Avatar initials */
    [data-theme="light"] .initials-sm {
      background: rgba(0,0,0,0.08) !important;
      color: var(--text-muted) !important;
    }

    /* Breakdown / progress bars */
    [data-theme="light"] .breakdown-bar-wrap,
    [data-theme="light"] .progress-bar-wrap { background: rgba(0,0,0,0.08) !important; }
    [data-theme="light"] .progress-bar { background: rgba(0,0,0,0.35) !important; }
    [data-theme="light"] .progress-text { color: var(--text-muted) !important; }

    /* Upload zone */
    [data-theme="light"] .upload-zone-text { color: var(--text-muted) !important; }
    [data-theme="light"] .upload-zone-text strong { color: var(--text) !important; }
    [data-theme="light"] .upload-zone:hover,
    [data-theme="light"] .upload-zone.drag-over {
      border-color: var(--input-border-focus) !important;
      background: rgba(0,0,0,0.03) !important;
    }

    /* Location result box in user-detail */
    [data-theme="light"] #admin-loc-result {
      background: var(--input-bg) !important;
      border-color: var(--input-border) !important;
    }

    /* Dashboard / orders cells & inline elements that used hardcoded white-based colors */
    [data-theme="light"] .cell-date,
    [data-theme="light"] .cell-empty,
    [data-theme="light"] .row-date,
    [data-theme="light"] .top-count,
    [data-theme="light"] .breakdown-label,
    [data-theme="light"] .breakdown-count,
    [data-theme="light"] .stat-label,
    [data-theme="light"] .stat-sub,
    [data-theme="light"] .status-lbl,
    [data-theme="light"] .card-title,
    [data-theme="light"] .section-label,
    [data-theme="light"] .page-info { color: var(--text-muted) !important; }

    [data-theme="light"] .cell-arrow,
    [data-theme="light"] .arrow-col,
    [data-theme="light"] .top-rank,
    [data-theme="light"] .empty-ph,
    [data-theme="light"] .breakdown-empty,
    [data-theme="light"] .loading-ph { color: var(--text-dim) !important; }

    /* Visitor sub-stat colored teal — soften slightly for light mode */
    [data-theme="light"] .visitor-card .stat-sub { color: rgba(13,148,136,0.85) !important; }

    /* Status badges (rendered inline by statusBadge()) — boost contrast in light theme.
       Each badge has inline background/border/color in the form: bg=color+'22', color=color, border=color+'55'.
       In light mode the alpha-22 background is too pale; force a stronger tinted fill. */
    [data-theme="light"] [class*="badge"],
    [data-theme="light"] .status-bar span[style] { font-weight: 500 !important; }

    /* Hide legacy top nav if present */
    .nav { display: none !important; }
  `

  function getStoredTheme() {
    return localStorage.getItem(THEME_KEY) || 'system'
  }

  function applyTheme(theme) {
    const html = document.documentElement
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      html.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
    } else {
      html.setAttribute('data-theme', theme)
    }
    localStorage.setItem(THEME_KEY, theme)
    // Update active button state
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === theme)
    })
  }

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
      injectCSS()
      // Apply saved theme before rendering to avoid flash
      applyTheme(getStoredTheme())

      const sidebar = buildSidebar(activePage)
      wrapContent()
      document.body.insertBefore(sidebar, document.body.firstChild)

      document.getElementById('sidebar-logout').addEventListener('click', () => {
        window.LOOM.logout()
      })

      document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', () => applyTheme(btn.dataset.theme))
      })
      // Keep button states correct after sidebar is in DOM
      applyTheme(getStoredTheme())

      // Respond to system theme changes when in 'system' mode
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
