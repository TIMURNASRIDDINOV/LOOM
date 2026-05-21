'use strict'
;(function () {
  const STATUS_LABELS = {
    new: 'Новый', confirmed: 'Подтверждён', producing: 'Производство',
    shipped: 'Отправлен', delivered: 'Доставлен', cancelled: 'Отменён',
    pending: 'Ожидает', processing: 'В работе',
  }
  const STATUS_COLORS = {
    new: '#3b82f6', confirmed: '#eab308', producing: '#f97316',
    shipped: '#a855f7', delivered: '#22c55e', cancelled: '#6b7280',
    pending: '#facc15', processing: '#a78bfa',
  }

  function esc(s) {
    if (!s) return ''
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
  function fmt(n) { return Number(n || 0).toLocaleString('ru-RU') + ' сум' }
  function fmtDate(ts) {
    if (!ts) return '—'
    return new Date(Number(ts)).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
  }
  function fmtYear(ts) {
    if (!ts) return '—'
    return new Date(Number(ts)).getFullYear().toString()
  }
  function statusBadge(status) {
    const label = STATUS_LABELS[status] || status
    const color = STATUS_COLORS[status] || '#6b7280'
    return `<span class="status-badge" style="background:${color}22;color:${color};border:1px solid ${color}55">${esc(label)}</span>`
  }

  let user = null
  let API = ''

  // ── Tabs ─────────────────────────────────────────────────────────────────────

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'))
      btn.classList.add('active')
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active')
    })
  })

  // Hash-based tab navigation
  if (window.location.hash === '#settings') {
    setTimeout(() => document.querySelector('[data-tab="settings"]')?.click(), 50)
  } else if (window.location.hash === '#notifications') {
    setTimeout(() => document.querySelector('[data-tab="notifications"]')?.click(), 50)
  }

  // ── Avatar ───────────────────────────────────────────────────────────────────

  function renderAvatar(u) {
    const placeholder = document.getElementById('avatar-placeholder')
    const img = document.getElementById('avatar-img')
    const initials = (u.name || u.email || '').slice(0, 2).toUpperCase() || '?'
    if (u.avatar_url) {
      img.src = u.avatar_url
      img.style.display = 'block'
      placeholder.style.display = 'none'
    } else {
      placeholder.textContent = initials
      placeholder.style.display = 'flex'
      img.style.display = 'none'
    }
  }

  document.getElementById('avatar-btn').addEventListener('click', () => {
    document.getElementById('avatar-input').click()
  })

  document.getElementById('avatar-input').addEventListener('change', async (e) => {
    const file = e.target.files[0]
    if (!file) return
    const btn = document.getElementById('avatar-btn')
    btn.disabled = true
    try {
      const fd = new FormData()
      fd.append('avatar', file)
      const token = window.LOOM_AUTH.getToken()
      const res = await fetch(API + '/api/auth/avatar', {
        method: 'POST', body: fd,
        headers: { Authorization: 'Bearer ' + token },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      user.avatar_url = data.avatar_url
      renderAvatar(user)
    } catch (err) {
      alert('Ошибка загрузки: ' + err.message)
    } finally {
      btn.disabled = false
      e.target.value = ''
    }
  })

  // ── Profile data ──────────────────────────────────────────────────────────────

  function populateProfile(u) {
    // Top nav
    const navEmail = document.getElementById('nav-email')
    if (navEmail) navEmail.textContent = u.email || ''

    // Avatar section
    renderAvatar(u)
    document.getElementById('profile-name').textContent = u.name || u.email.split('@')[0]
    document.getElementById('profile-email').textContent = u.email
    document.getElementById('profile-since').textContent = 'С нами с ' + fmtDate(u.created_at)

    // Stats
    document.getElementById('stat-orders').textContent = u.order_count ?? '0'
    document.getElementById('stat-spent').textContent = u.total_spent
      ? new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 0 }).format(u.total_spent)
      : '0'
    document.getElementById('stat-since').textContent = fmtYear(u.created_at)

    // Location
    populateLocation(u.location_preset)

    // Settings form
    const nameInput = document.getElementById('edit-name')
    const phoneInput = document.getElementById('edit-phone')
    if (nameInput) nameInput.value = u.name || ''
    if (phoneInput) phoneInput.value = u.phone || ''
  }

  function populateLocation(locationJson) {
    let loc = null
    try { loc = locationJson ? JSON.parse(locationJson) : null } catch {}
    const preview = document.getElementById('location-preview')
    const addrEl = document.getElementById('location-address')
    const coordsEl = document.getElementById('location-coords')
    if (loc && loc.address) {
      preview.style.display = 'flex'
      addrEl.textContent = loc.address
      coordsEl.textContent = loc.lat && loc.lng ? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}` : ''
      document.getElementById('loc-address').value = loc.address || ''
      document.getElementById('loc-lat').value = loc.lat || ''
      document.getElementById('loc-lng').value = loc.lng || ''
      if (window._ymap && loc.lat && loc.lng) {
        window._ymap.geoObjects.removeAll()
        const coords = [loc.lat, loc.lng]
        window._ymap.setCenter(coords, 15)
        window._ymapPlacemark.geometry.setCoordinates(coords)
        window._ymap.geoObjects.add(window._ymapPlacemark)
      }
    } else {
      preview.style.display = 'none'
    }
  }

  // ── Save profile ──────────────────────────────────────────────────────────────

  document.getElementById('save-profile-btn').addEventListener('click', async () => {
    const btn = document.getElementById('save-profile-btn')
    const msgOk = document.getElementById('profile-msg')
    const msgErr = document.getElementById('profile-err')
    msgOk.textContent = ''; msgErr.textContent = ''
    btn.disabled = true
    try {
      const token = window.LOOM_AUTH.getToken()
      const res = await fetch(API + '/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          name: document.getElementById('edit-name').value.trim() || null,
          phone: document.getElementById('edit-phone').value.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      user.name = data.name; user.phone = data.phone
      document.getElementById('profile-name').textContent = data.name || data.email?.split('@')[0] || user.email.split('@')[0]
      msgOk.textContent = 'Сохранено!'
      sessionStorage.removeItem('loom_user')
    } catch (err) {
      msgErr.textContent = err.message
    } finally {
      btn.disabled = false
    }
  })

  // ── Save location ─────────────────────────────────────────────────────────────

  document.getElementById('save-location-btn').addEventListener('click', async () => {
    const btn = document.getElementById('save-location-btn')
    const msg = document.getElementById('location-msg')
    msg.textContent = ''; btn.disabled = true
    try {
      const address = document.getElementById('loc-address').value.trim()
      const lat = parseFloat(document.getElementById('loc-lat').value) || null
      const lng = parseFloat(document.getElementById('loc-lng').value) || null
      const loc = address ? { address, lat, lng } : null
      const token = window.LOOM_AUTH.getToken()
      const res = await fetch(API + '/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ location_preset: loc }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Ошибка') }
      user.location_preset = loc ? JSON.stringify(loc) : null
      populateLocation(user.location_preset)
      msg.textContent = 'Адрес сохранён!'
      sessionStorage.removeItem('loom_user')
    } catch (err) {
      msg.textContent = '⚠ ' + err.message
    } finally {
      btn.disabled = false
    }
  })

  document.getElementById('clear-location-btn').addEventListener('click', async () => {
    document.getElementById('loc-address').value = ''
    document.getElementById('loc-lat').value = ''
    document.getElementById('loc-lng').value = ''
    document.getElementById('location-preview').style.display = 'none'
    if (window._ymap) window._ymap.geoObjects.removeAll()
    const token = window.LOOM_AUTH.getToken()
    await fetch(API + '/api/auth/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ location_preset: null }),
    }).catch(() => {})
    sessionStorage.removeItem('loom_user')
  })

  // ── Change password ───────────────────────────────────────────────────────────

  document.getElementById('save-pw-btn').addEventListener('click', async () => {
    const btn = document.getElementById('save-pw-btn')
    const msgOk = document.getElementById('pw-msg')
    const msgErr = document.getElementById('pw-err')
    msgOk.textContent = ''; msgErr.textContent = ''
    const current = document.getElementById('pw-current').value
    const newPw = document.getElementById('pw-new').value
    const confirm = document.getElementById('pw-confirm').value
    if (!current || !newPw || !confirm) { msgErr.textContent = 'Заполните все поля'; return }
    if (newPw !== confirm) { msgErr.textContent = 'Пароли не совпадают'; return }
    if (newPw.length < 8) { msgErr.textContent = 'Новый пароль — минимум 8 символов'; return }
    btn.disabled = true
    try {
      const token = window.LOOM_AUTH.getToken()
      const res = await fetch(API + '/api/auth/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ current_password: current, new_password: newPw }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      msgOk.textContent = 'Пароль обновлён!'
      document.getElementById('pw-current').value = ''
      document.getElementById('pw-new').value = ''
      document.getElementById('pw-confirm').value = ''
    } catch (err) {
      msgErr.textContent = err.message
    } finally {
      btn.disabled = false
    }
  })

  // ── Notification prefs (stored in localStorage) ───────────────────────────────

  document.getElementById('save-notif-btn').addEventListener('click', () => {
    const prefs = {
      orders: document.getElementById('notif-orders').checked,
      promo: document.getElementById('notif-promo').checked,
    }
    localStorage.setItem('loom_notif_prefs', JSON.stringify(prefs))
    document.getElementById('notif-msg').textContent = 'Сохранено!'
    setTimeout(() => { document.getElementById('notif-msg').textContent = '' }, 2000)
  })

  function loadNotifPrefs() {
    try {
      const prefs = JSON.parse(localStorage.getItem('loom_notif_prefs') || '{}')
      if (prefs.orders !== undefined) document.getElementById('notif-orders').checked = prefs.orders
      if (prefs.promo  !== undefined) document.getElementById('notif-promo').checked = prefs.promo
    } catch {}
  }

  // ── Yandex Map for location picker ───────────────────────────────────────────

  function initYandexMap() {
    if (!window.ymaps || !document.getElementById('ymap-container')) return

    ymaps.ready(() => {
      const defaultCenter = [41.2995, 69.2401]
      const savedLat = parseFloat(document.getElementById('loc-lat').value) || null
      const savedLng = parseFloat(document.getElementById('loc-lng').value) || null
      const center = savedLat && savedLng ? [savedLat, savedLng] : defaultCenter

      const map = new ymaps.Map('ymap-container', {
        center,
        zoom: savedLat ? 15 : 12,
        controls: ['zoomControl', 'geolocationControl'],
      }, {
        suppressMapOpenBlock: true,
      })

      const placemark = new ymaps.Placemark(center, {}, {
        draggable: true,
        preset: 'islands#redCircleDotIcon',
      })

      if (savedLat && savedLng) map.geoObjects.add(placemark)

      window._ymap = map
      window._ymapPlacemark = placemark

      function setLocation(coords) {
        document.getElementById('loc-lat').value = coords[0].toFixed(6)
        document.getElementById('loc-lng').value = coords[1].toFixed(6)
        map.geoObjects.removeAll()
        placemark.geometry.setCoordinates(coords)
        map.geoObjects.add(placemark)
        // Reverse geocode to get address
        ymaps.geocode(coords, { results: 1 }).then(res => {
          const first = res.geoObjects.get(0)
          if (first) {
            document.getElementById('loc-address').value = first.getAddressLine()
          }
        }).catch(() => {})
      }

      map.events.add('click', e => setLocation(e.get('coords')))
      placemark.events.add('dragend', () => setLocation(placemark.geometry.getCoordinates()))

      // Address search
      document.getElementById('loc-search-btn').addEventListener('click', () => {
        const q = document.getElementById('loc-address').value.trim()
        if (!q) return
        ymaps.geocode(q, { results: 1 }).then(res => {
          const first = res.geoObjects.get(0)
          if (first) {
            const coords = first.geometry.getCoordinates()
            map.setCenter(coords, 15)
            setLocation(coords)
            document.getElementById('loc-address').value = first.getAddressLine()
          }
        }).catch(() => {})
      })

      document.getElementById('loc-address').addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('loc-search-btn').click()
      })
    })
  }

  // Geolocation button
  document.getElementById('req-geo-btn').addEventListener('click', () => {
    navigator.geolocation.getCurrentPosition(pos => {
      const coords = [pos.coords.latitude, pos.coords.longitude]
      if (window._ymap) {
        window._ymap.setCenter(coords, 15)
        window._ymap.geoObjects.removeAll()
        window._ymapPlacemark.geometry.setCoordinates(coords)
        window._ymap.geoObjects.add(window._ymapPlacemark)
        ymaps.geocode(coords, { results: 1 }).then(res => {
          const first = res.geoObjects.get(0)
          if (first) document.getElementById('loc-address').value = first.getAddressLine()
        }).catch(() => {})
      }
      document.getElementById('loc-lat').value = coords[0].toFixed(6)
      document.getElementById('loc-lng').value = coords[1].toFixed(6)
    }, () => {
      document.getElementById('location-msg').textContent = '⚠ Геолокация недоступна'
    })
  })

  // ── Notifications ─────────────────────────────────────────────────────────────

  let notifPage = 1
  const NOTIF_LIMIT = 25

  function fmtNotifDate(ts) {
    if (!ts) return ''
    return new Date(Number(ts)).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', dateStyle: 'short', timeStyle: 'short' })
  }

  async function loadNotifications(page) {
    const listEl = document.getElementById('notif-list')
    listEl.innerHTML = '<p class="notif-empty">Загрузка…</p>'
    try {
      const token = window.LOOM_AUTH.getToken()
      const headers = {}
      if (token) headers['Authorization'] = 'Bearer ' + token
      const res = await fetch(API + '/api/me/notifications?page=' + page + '&limit=' + NOTIF_LIMIT, {
        headers,
        credentials: 'include',
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const data = await res.json()
      const items = data.items || []
      if (!items.length) {
        listEl.innerHTML = '<p class="notif-empty">Уведомлений пока нет.</p>'
        document.getElementById('notif-pagination').style.display = 'none'
        return
      }
      listEl.innerHTML = items.map(n => `
        <div class="notif-item">
          <div style="font-size:0.88rem;line-height:1.5">${esc(n.message)}</div>
          ${n.button_label && n.button_url ? `<a class="notif-btn" href="${esc(n.button_url)}" target="_blank" rel="noopener">${esc(n.button_label)}</a>` : ''}
          <div class="notif-meta">${fmtNotifDate(n.sent_at)}</div>
        </div>
      `).join('')
      const total = data.total || 0
      const from = (page - 1) * NOTIF_LIMIT + 1
      const to = Math.min(page * NOTIF_LIMIT, total)
      document.getElementById('notif-page-info').textContent = `${from}–${to} из ${total}`
      document.getElementById('notif-prev-btn').disabled = page <= 1
      document.getElementById('notif-next-btn').disabled = to >= total
      document.getElementById('notif-pagination').style.display = total > NOTIF_LIMIT ? 'flex' : 'none'
    } catch {
      listEl.innerHTML = '<p class="notif-empty" style="color:#f87171">Не удалось загрузить уведомления.</p>'
    }
  }

  document.getElementById('notif-prev-btn').addEventListener('click', () => {
    if (notifPage > 1) { notifPage--; loadNotifications(notifPage) }
  })
  document.getElementById('notif-next-btn').addEventListener('click', () => {
    notifPage++; loadNotifications(notifPage)
  })

  // ── Orders ────────────────────────────────────────────────────────────────────

  async function loadOrders() {
    const container = document.getElementById('orders-container')
    try {
      const token = window.LOOM_AUTH.getToken()
      const res = await fetch(API + '/api/me/orders', {
        headers: { Authorization: 'Bearer ' + token },
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const data = await res.json()
      const orders = data.orders || []
      if (!orders.length) {
        container.innerHTML = '<p class="empty-state">Заказов пока нет.</p>'
        return
      }
      container.innerHTML = `
        <table class="orders-table">
          <thead><tr>
            <th>№</th><th>Дата</th><th>Статус</th><th style="text-align:right">Сумма</th>
          </tr></thead>
          <tbody>
            ${orders.map(o => `
              <tr>
                <td>#${o.id}</td>
                <td>${fmtDate(o.created_at)}</td>
                <td>${statusBadge(o.status)}</td>
                <td style="text-align:right;font-family:var(--mono);font-size:0.8rem">${fmt(o.total_price)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `
    } catch {
      container.innerHTML = '<p class="msg-err">Не удалось загрузить заказы.</p>'
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────────

  async function init() {
    API = window.LOOM_CONFIG ? window.LOOM_CONFIG.API_BASE
      : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
          ? 'http://localhost:8787' : 'https://api.looom.me')

    user = await window.LOOM_AUTH.getCurrentUser()
    if (!user) { window.location.href = 'login.html?redirect=account.html'; return }

    populateProfile(user)
    loadOrders()
    loadNotifPrefs()
    loadNotifications(notifPage)
    initYandexMap()

    document.getElementById('logout-btn').addEventListener('click', () => window.LOOM_AUTH.logout())
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
