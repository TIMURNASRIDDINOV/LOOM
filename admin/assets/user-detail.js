'use strict'

;(function () {
  const { apiJSON, formatPrice, formatDate, formatPhone, statusBadge, describeActivity } = window.LOOM
  const { toast, confirmDialog, apiErrorMessage } = window.LOOM_UI

  // Every action button below lives behind a data-cap and may be absent from
  // the DOM entirely (layout.js removes what the admin may not use), so each
  // listener is attached defensively.
  const on = (id, event, fn) => {
    const node = document.getElementById(id)
    if (node) node.addEventListener(event, fn)
    return node
  }

  let userId = null
  let currentUser = null

  function escHtml(s) {
    if (!s) return ''
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function roleBadge(role) {
    return `<span class="badge">${escHtml(window.LOOM.userRoleLabel(role))}</span>`
  }

  function renderUserInfo(u) {
    currentUser = u
    const title = [u.first_name, u.last_name].filter(Boolean).join(' ')
      || (u.phone ? formatPhone(u.phone) : u.email) || `Клиент #${u.id}`
    document.getElementById('page-title').textContent = title

    // «Имя» is dropped: the header already shows it, and repeating it is noise.
    // `technical` marks values that earn a monospace face (identifiers, digits).
    const rows = [
      ['Телефон', u.phone ? formatPhone(u.phone) : '—', true],
      ['Telegram', u.telegram_username ? '@' + u.telegram_username
        : (u.telegram_user_id ? 'привязан' : 'не привязан'), false],
      ['Регистрация', formatDate(u.created_at), false],
      ['Последний вход', u.last_login_at ? formatDate(u.last_login_at) : 'ни разу', false],
      ['Номер клиента', String(u.id), true],
    ]

    // Identity header (avatar/initials + name + email + status)
    const displayName = [u.first_name, u.last_name].filter(Boolean).join(' ')
      || (u.phone ? formatPhone(u.phone) : u.email) || ('Клиент #' + u.id)
    const initials = (displayName || '?').replace(/[^A-Za-zА-Яа-яЁё]/g, '').slice(0, 2).toUpperCase() || '#'
    const statusHtml = `<span class="badge badge-${u.status === 'banned' ? 'banned' : 'active'}">${u.status === 'banned' ? 'Заблокирован' : 'Активен'}</span>`
    const tgHtml = u.telegram_user_id ? '<span class="badge">Telegram ✓</span>' : ''
    const ident = document.getElementById('user-identity')
    if (ident) {
      ident.innerHTML =
        (u.avatar_url
          ? `<img src="${escHtml(u.avatar_url)}" alt="" class="ud-avatar" />`
          : `<div class="ud-avatar ud-avatar-ph">${escHtml(initials)}</div>`) +
        `<div style="flex:1;min-width:0">
           <div class="ud-name">${escHtml(displayName)}</div>
           <div class="ud-email">${escHtml(u.email || '—')}</div>
           <div class="ud-badges">${statusHtml}${tgHtml}</div>
         </div>`
    }

    document.getElementById('user-stats').innerHTML = `
      <span><span class="ud-stat-label">Заказов</span>
            <span class="ud-stat-value">${u.orders_count ?? 0}</span></span>
      <span><span class="ud-stat-label">Потрачено</span>
            <span class="ud-stat-value">${escHtml(formatPrice(u.total_spent ?? 0))}</span></span>`

    document.getElementById('user-info').innerHTML =
      rows.map(([label, val, technical]) => `
        <span>
          <span class="info-label">${escHtml(label)}</span>
          <span class="info-value${technical ? ' is-technical' : ''}">${escHtml(val)}</span>
        </span>
      `).join('')

    // The button says what it will DO, and the title carries the consequence,
    // so a destructive click is never ambiguous even sitting beside the name.
    const toggleStatusBtn = document.getElementById('btn-toggle-status')
    if (toggleStatusBtn) {
      const banned = u.status === 'banned'
      const BAN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>'
      const UNBAN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.4l2.6 2.6L16 9.6"/></svg>'

      document.getElementById('btn-toggle-label').textContent = banned ? 'Разблокировать' : 'Заблокировать'
      document.getElementById('btn-toggle-icon').innerHTML = banned ? UNBAN_ICON : BAN_ICON
      toggleStatusBtn.className = banned ? 'btn btn--sm ud-block' : 'btn btn--sm btn--danger ud-block'
      toggleStatusBtn.title = banned
        ? 'Вернуть клиенту доступ в личный кабинет'
        : 'Закрыть клиенту вход и оформление заказов'
    }

    const noTgNote = document.getElementById('notif-no-tg-note')
    if (noTgNote) noTgNote.style.display = u.telegram_user_id ? 'none' : ''

    // Pre-fill the edit panel when the admin is allowed to see it at all.
    const setVal = (id, v) => { const n = document.getElementById(id); if (n) n.value = v || '' }
    setVal('edit-first-name', u.first_name)
    setVal('edit-last-name', u.last_name)
    setVal('edit-email', u.email)
    setVal('edit-phone', u.phone)

    // Pre-fill location form from JSON
    try {
      const loc = u.location_preset ? JSON.parse(u.location_preset) : null
      const curEl = document.getElementById('admin-loc-current')
      if (!curEl) return
      if (loc && loc.address) {
        curEl.textContent = `Текущий: ${loc.address}${loc.lat ? ` (${Number(loc.lat).toFixed(5)}, ${Number(loc.lng).toFixed(5)})` : ''}`
        curEl.style.display = ''
        document.getElementById('edit-location-addr').value = loc.address || ''
        showAdminLocResult(loc.address, loc.lat, loc.lng)
      } else {
        curEl.style.display = 'none'
      }
    } catch {}
  }

  let _adminLocLat = null
  let _adminLocLng = null
  let _adminLocAddr = null

  // Expose state and callback for the map picker
  window._adminLocState = () => ({ lat: _adminLocLat, lng: _adminLocLng, addr: _adminLocAddr })
  window._adminMapPickerCallback = (address, lat, lng) => {
    document.getElementById('edit-location-addr').value = address
    showAdminLocResult(address, lat, lng)
  }

  function showAdminLocResult(address, lat, lng) {
    _adminLocAddr = address; _adminLocLat = lat; _adminLocLng = lng
    if (!document.getElementById('admin-loc-result')) return
    document.getElementById('admin-loc-found-addr').textContent = address
    document.getElementById('admin-loc-coords').textContent = lat && lng ? `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}` : ''
    if (lat && lng) {
      document.getElementById('admin-loc-map-link').href = `https://yandex.ru/maps/?ll=${lng},${lat}&z=15&pt=${lng},${lat}`
      document.getElementById('admin-loc-map-link').style.display = ''
    } else {
      document.getElementById('admin-loc-map-link').style.display = 'none'
    }
    document.getElementById('admin-loc-result').style.display = ''
  }

  async function loadOrders() {
    try {
      const data = await apiJSON(`/api/admin/users/${userId}/orders`)
      const tbody = document.getElementById('orders-tbody')
      const countEl = document.getElementById('orders-count')
      if (countEl) countEl.textContent = data.orders?.length ?? 0
      if (!data.orders?.length) {
        tbody.innerHTML = '<tr><td colspan="4"><div class="state">У этого клиента ещё нет заказов</div></td></tr>'
        return
      }
      tbody.innerHTML = data.orders.map(o => `
        <tr class="is-clickable" data-order="${o.id}">
          <td class="num">${o.id}</td>
          <td class="muted">${formatDate(o.created_at)}</td>
          <td>${statusBadge(o.status)}</td>
          <td class="num right">${formatPrice(o.total_price)}</td>
        </tr>
      `).join('')
      tbody.querySelectorAll('tr[data-order]').forEach((row) => {
        row.addEventListener('click', () => { location.href = 'order.html?id=' + row.dataset.order })
      })
    } catch (err) {
      document.getElementById('orders-tbody').innerHTML =
        `<tr><td colspan="4"><div class="state state--error">${escHtml(apiErrorMessage(err))}</div></td></tr>`
    }
  }

  // by_admin_id is a bare number in the log. Resolving it to an email is the
  // difference between «by_admin_id: 1» and «Изменил: admin@loomdesign.uz».
  //
  // Memoise the PROMISE, not the result: every row resolves its actor
  // concurrently, so caching the result object meant the first caller published
  // an empty map before its fetch returned and the other rows all fell through
  // to the numeric fallback. Awaiting one shared promise keeps it to a single
  // request and gives every row the same answer.
  let adminsPromise = null
  function adminDirectory() {
    if (!adminsPromise) {
      adminsPromise = apiJSON('/api/admin/admins')
        .then(({ admins }) => {
          const map = {}
          admins.forEach((a) => { map[a.id] = a.email })
          return map
        })
        // A failed lookup must cost us the names, not the whole log.
        .catch(() => ({}))
    }
    return adminsPromise
  }

  async function adminName(id) {
    if (id == null) return ''
    const map = await adminDirectory()
    return map[id] || 'администратор #' + id
  }

  // No time filter: every row carries its own date, so a row of period buttons
  // above a short log was chrome without a job. The endpoint returns the full
  // history when `since` is omitted.
  async function loadActivity() {
    const tbody = document.getElementById('activity-tbody')
    tbody.innerHTML = '<tr><td colspan="2"><div class="state">Загрузка…</div></td></tr>'
    try {
      const data = await apiJSON(`/api/admin/users/${userId}/activity`)

      if (!data.items?.length) {
        tbody.innerHTML = '<tr><td colspan="2"><div class="state">По этому клиенту пока ничего не происходило</div></td></tr>'
        return
      }

      // Resolve every actor first so the rows render in one pass.
      const rows = await Promise.all(data.items.map(async (a) => {
        let meta = {}
        if (a.metadata) { try { meta = JSON.parse(a.metadata) } catch { meta = {} } }

        const d = describeActivity(a.action, meta)
        const actor = await adminName(meta.by_admin_id)

        // The second line carries the clarifying detail and, when an admin did
        // it rather than the customer, who that was.
        const sub = [d.note, actor ? 'Изменил: ' + actor : ''].filter(Boolean).join(' · ')

        return '<tr>' +
          '<td>' +
            '<div class="act-title">' + escHtml(d.title) + '</div>' +
            (sub ? '<div class="act-sub' + (d.failed ? ' act-sub--failed' : '') + '">' + escHtml(sub) + '</div>' : '') +
          '</td>' +
          '<td class="muted">' + formatDate(a.created_at) + '</td>' +
        '</tr>'
      }))

      tbody.innerHTML = rows.join('')
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="2"><div class="state state--error">${escHtml(apiErrorMessage(err))}</div></td></tr>`
    }
  }

  // ── Content strip ─────────────────────────────────────────────────────────
  // Six controls, one style, one region beneath them. Two are views (Заказы,
  // Активность) and four open a form, but from the operator's side they behave
  // identically: click one, its content takes the region and it shows selected.
  // Modelling them as a single list is what keeps that promise honest — with
  // two parallel mechanisms it is only a matter of time before some path leaves
  // two things on screen or nothing selected.
  const SEGMENTS = [
    { control: 'tab-orders',         panel: 'panel-orders',       view: true },
    { control: 'tab-activity',       panel: 'panel-activity',     view: true, onFirstOpen: () => loadActivity() },
    { control: 'btn-notify',         panel: 'notif-form' },
    { control: 'btn-edit-profile',   panel: 'edit-profile-card' },
    { control: 'btn-edit-location',  panel: 'edit-location-card' },
    { control: 'btn-reset-password', panel: 'reset-password-card' },
  ]

  const opened = new Set()
  let activeSegment = 0
  // Closing a form returns you to the view you were reading, not to a fixed
  // default — landing back on Заказы after checking Активность loses your place.
  let lastViewSegment = 0

  function selectSegment(i) {
    const seg = SEGMENTS[i]
    if (!seg) return
    activeSegment = i
    if (seg.view) lastViewSegment = i

    SEGMENTS.forEach((s2, j) => {
      const control = document.getElementById(s2.control)
      const panel = document.getElementById(s2.panel)
      // Either may be absent: capability gating removes controls outright.
      if (control) control.setAttribute('aria-selected', i === j ? 'true' : 'false')
      if (panel) panel.hidden = i !== j
    })

    if (!opened.has(i)) {
      opened.add(i)
      if (seg.onFirstOpen) seg.onFirstOpen()
    }
  }

  function closePanels() { selectSegment(lastViewSegment) }

  function wireContentStrip() {
    SEGMENTS.forEach((seg, i) => {
      const control = document.getElementById(seg.control)
      if (control) control.addEventListener('click', () => selectSegment(i))
    })
    document.querySelectorAll('[data-close-panel]').forEach((b) => b.addEventListener('click', closePanels))
  }

  on('btn-toggle-status', 'click', async () => {
    if (!currentUser) return
    const banning = currentUser.status !== 'banned'
    const ok = await confirmDialog({
      title: banning ? 'Заблокировать клиента?' : 'Разблокировать клиента?',
      body: banning
        ? 'Клиент не сможет войти в личный кабинет и оформлять заказы, пока вы не снимете блокировку.'
        : 'Клиент снова сможет войти и оформлять заказы.',
      confirmLabel: banning ? 'Заблокировать' : 'Разблокировать',
      danger: banning,
    })
    if (!ok) return
    try {
      await apiJSON(`/api/admin/users/${userId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: banning ? 'banned' : 'active' }),
      })
      toast(banning ? 'Клиент заблокирован' : 'Клиент разблокирован', 'success')
      location.reload()
    } catch (err) {
      toast(apiErrorMessage(err), 'error')
    }
  })

  // ── Notify ────────────────────────────────────────────────────────────────

  on('btn-send-notif', 'click', async (e) => {
    const btn = e.currentTarget
    const msg = document.getElementById('notif-msg').value.trim()
    const btnLabel = document.getElementById('notif-btn-label').value.trim()
    const btnUrl = document.getElementById('notif-btn-url').value.trim()
    if (!msg) { toast('Введите текст сообщения', 'error'); return }

    btn.disabled = true
    try {
      const body = { user_id: userId, message: msg }
      if (btnLabel && btnUrl) { body.button_label = btnLabel; body.button_url = btnUrl }
      await apiJSON('/api/admin/notifications', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      toast('Сообщение отправлено', 'success')
      document.getElementById('notif-msg').value = ''
      closePanels()
    } catch (err) {
      toast(apiErrorMessage(err), 'error')
    } finally {
      btn.disabled = false
    }
  })

  // ── Edit profile ──────────────────────────────────────────────────────────

  on('btn-save-profile', 'click', async (e) => {
    const btn = e.currentTarget
    const body = {
      first_name: document.getElementById('edit-first-name').value.trim() || null,
      last_name: document.getElementById('edit-last-name').value.trim() || null,
      email: document.getElementById('edit-email').value.trim() || null,
      phone: document.getElementById('edit-phone').value.trim() || null,
    }
    btn.disabled = true
    try {
      const updated = await apiJSON(`/api/admin/users/${userId}/profile`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      toast('Данные сохранены', 'success')
      renderUserInfo(updated)
      closePanels()
    } catch (err) {
      toast(apiErrorMessage(err), 'error')
    } finally {
      btn.disabled = false
    }
  })

  // ── Location ──────────────────────────────────────────────────────────────

  on('btn-geocode-location', 'click', async (e) => {
    const btn = e.currentTarget
    const q = document.getElementById('edit-location-addr').value.trim()
    if (!q) { toast('Введите адрес', 'error'); return }
    btn.disabled = true; btn.textContent = 'Ищем…'
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&accept-language=ru`
      const data = await (await fetch(url)).json()
      if (!data.length) { toast('Адрес не найден — попробуйте выбрать на карте', 'error'); return }
      const { lat, lon, display_name } = data[0]
      document.getElementById('edit-location-addr').value = display_name
      showAdminLocResult(display_name, parseFloat(lat), parseFloat(lon))
    } catch (err) {
      toast('Не удалось найти адрес: ' + err.message, 'error')
    } finally {
      btn.disabled = false; btn.textContent = 'Найти'
    }
  })

  on('edit-location-addr', 'keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-geocode-location').click() }
  })

  on('btn-save-location', 'click', async (e) => {
    const btn = e.currentTarget
    const loc = _adminLocAddr ? { address: _adminLocAddr, lat: _adminLocLat, lng: _adminLocLng } : null
    btn.disabled = true
    try {
      await apiJSON(`/api/admin/users/${userId}/location`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_preset: loc }),
      })
      toast('Адрес сохранён', 'success')
    } catch (err) {
      toast(apiErrorMessage(err), 'error')
    } finally {
      btn.disabled = false
    }
  })

  on('btn-clear-location', 'click', async (e) => {
    const btn = e.currentTarget
    const ok = await confirmDialog({
      title: 'Очистить адрес доставки?',
      body: 'Сохранённый адрес клиента будет удалён. Он сможет указать новый при следующем заказе.',
      confirmLabel: 'Очистить',
      danger: true,
    })
    if (!ok) return

    document.getElementById('edit-location-addr').value = ''
    document.getElementById('admin-loc-result').style.display = 'none'
    document.getElementById('admin-loc-current').style.display = 'none'
    _adminLocAddr = null; _adminLocLat = null; _adminLocLng = null

    btn.disabled = true
    try {
      await apiJSON(`/api/admin/users/${userId}/location`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_preset: null }),
      })
      toast('Адрес очищен', 'success')
    } catch (err) {
      toast(apiErrorMessage(err), 'error')
    } finally {
      btn.disabled = false
    }
  })

  // ── Reset password ────────────────────────────────────────────────────────
  // The admin can only TRIGGER a reset — the client sets their own new password
  // via Telegram. No plaintext password is ever shown to or set by an admin.

  on('btn-save-password', 'click', async (e) => {
    const btn = e.currentTarget
    if (currentUser && !currentUser.telegram_user_id) {
      toast('У клиента не привязан Telegram — отправить запрос некуда', 'error')
      return
    }
    const ok = await confirmDialog({
      title: 'Отправить запрос на сброс пароля?',
      body: 'Клиент получит сообщение в Telegram и сам задаст новый пароль на сайте.',
      confirmLabel: 'Отправить',
    })
    if (!ok) return

    btn.disabled = true
    try {
      await apiJSON(`/api/admin/users/${userId}/password`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      })
      toast('Запрос отправлен в Telegram', 'success')
      closePanels()
    } catch (err) {
      toast(apiErrorMessage(err), 'error')
    } finally {
      btn.disabled = false
    }
  })

  // ── Phone input mask ──────────────────────────────────────────────────────

  function applyPhoneMask(input) {
    input.addEventListener('input', () => {
      let d = input.value.replace(/\D/g, '')
      if (d.startsWith('998')) d = d.slice(3)
      d = d.slice(0, 9)
      let v = '+998'
      if (d.length > 0) v += ' (' + d.slice(0, 2)
      if (d.length >= 2) v += ') ' + d.slice(2, 5)
      if (d.length >= 5) v += '-' + d.slice(5, 7)
      if (d.length >= 7) v += '-' + d.slice(7, 9)
      input.value = v
    })
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  window.LOOM_LAYOUT.onReady(async () => {
    userId = parseInt(new URLSearchParams(window.location.search).get('id'), 10)
    if (!userId) { window.location.href = 'users.html'; return }

    try {
      const user = await apiJSON(`/api/admin/users/${userId}`)
      renderUserInfo(user)
      window.LOOM_LAYOUT.setTitle(document.getElementById('page-title').textContent)
    } catch (err) {
      document.getElementById('user-info').innerHTML =
        `<span class="state--error">${escHtml(apiErrorMessage(err))}</span>`
      return
    }

    const phoneInput = document.getElementById('edit-phone')
    if (phoneInput) applyPhoneMask(phoneInput)

    wireContentStrip()
    selectSegment(0)
    await loadOrders()
  })
})()
