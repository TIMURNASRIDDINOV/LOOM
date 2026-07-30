'use strict'
;(function () {
  // i18n helper (Russian fallback when i18n.js absent)
  function AT(key, fb) {
    try { return (window.LOOM_I18N ? window.LOOM_I18N.t(key) : fb) || fb } catch (e) { return fb }
  }
  function lang() { try { return window.LOOM_I18N ? window.LOOM_I18N.getLang() : 'ru' } catch (e) { return 'ru' } }

  const STATUS_LABELS = {
    ru: { new: 'Новый', confirmed: 'Подтверждён', producing: 'Производство', shipped: 'Отправлен', delivered: 'Доставлен', cancelled: 'Отменён', pending: 'Ожидает', processing: 'В работе' },
    uz: { new: 'Yangi', confirmed: 'Tasdiqlangan', producing: 'Ishlab chiqarilmoqda', shipped: 'Jo‘natilgan', delivered: 'Yetkazilgan', cancelled: 'Bekor qilingan', pending: 'Kutilmoqda', processing: 'Jarayonda' },
    en: { new: 'New', confirmed: 'Confirmed', producing: 'In production', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled', pending: 'Pending', processing: 'Processing' },
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
  function fmt(n) {
    if (window.LOOM_I18N) return window.LOOM_I18N.formatPrice(n)
    return Number(n || 0).toLocaleString('ru-RU') + ' сум'
  }
  function fmtDate(ts) {
    if (!ts) return '—'
    const loc = { ru: 'ru-RU', uz: 'uz-UZ', en: 'en-US' }[lang()] || 'ru-RU'
    return new Date(Number(ts)).toLocaleDateString(loc, { day: 'numeric', month: 'short', year: 'numeric' })
  }
  function fmtYear(ts) {
    if (!ts) return '—'
    return new Date(Number(ts)).getFullYear().toString()
  }
  function statusBadge(status) {
    const map = STATUS_LABELS[lang()] || STATUS_LABELS.ru
    const label = map[status] || status
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
      // inline message instead of a native alert()
      let errEl = document.getElementById('avatar-err')
      if (!errEl) {
        errEl = document.createElement('span')
        errEl.id = 'avatar-err'
        errEl.className = 'msg-err'
        const meta = document.querySelector('.avatar-meta')
        if (meta) meta.appendChild(errEl)
      }
      if (errEl) {
        errEl.textContent = 'Ошибка загрузки: ' + err.message
        setTimeout(() => { errEl.textContent = '' }, 6000)
      }
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
    // Telegram-created accounts have no name and a synthetic tg<id>@telegram.loom
    // email, so fall back to the Telegram first name before the email prefix.
    document.getElementById('profile-name').textContent =
      u.name || u.first_name || (u.email ? u.email.split('@')[0] : '')
    document.getElementById('profile-email').textContent = u.email
    document.getElementById('profile-since').textContent = AT('acc.statSince', 'С нами с') + ' ' + fmtDate(u.created_at)

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

  function yandexMapsUrl(lat, lng) {
    return `https://yandex.ru/maps/?ll=${lng},${lat}&z=15&pt=${lng},${lat}`
  }

  function showGeocodeResult(address, lat, lng) {
    const box = document.getElementById('geocode-result')
    document.getElementById('geocode-addr').textContent = address
    document.getElementById('geocode-coords-text').textContent = lat && lng ? `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}` : ''
    if (lat && lng) {
      document.getElementById('geocode-map-link').href = yandexMapsUrl(lat, lng)
      document.getElementById('geocode-map-link').style.display = ''
    } else {
      document.getElementById('geocode-map-link').style.display = 'none'
    }
    box.classList.add('visible')
  }

  function hideGeocodeResult() {
    document.getElementById('geocode-result').classList.remove('visible')
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
      coordsEl.textContent = loc.lat && loc.lng ? `${Number(loc.lat).toFixed(5)}, ${Number(loc.lng).toFixed(5)}` : ''
      document.getElementById('loc-address').value = loc.address || ''
      document.getElementById('loc-lat').value = loc.lat || ''
      document.getElementById('loc-lng').value = loc.lng || ''
      showGeocodeResult(loc.address, loc.lat, loc.lng)
    } else {
      preview.style.display = 'none'
      hideGeocodeResult()
    }
  }

  async function geocodeAddress(query) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&accept-language=ru`
    const res = await fetch(url, { headers: { 'Accept-Language': 'ru' } })
    const data = await res.json()
    if (!data.length) throw new Error('Адрес не найден')
    const { lat, lon, display_name } = data[0]
    return { lat: parseFloat(lat), lng: parseFloat(lon), address: display_name }
  }

  async function reverseGeocode(lat, lng) {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ru`
    const res = await fetch(url, { headers: { 'Accept-Language': 'ru' } })
    const data = await res.json()
    return data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`
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
      msg.textContent = AT('acc.addrSaved', 'Адрес сохранён!')
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
    hideGeocodeResult()
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

  // ── Address search (Nominatim) ────────────────────────────────────────────────

  document.getElementById('loc-search-btn').addEventListener('click', async () => {
    const q = document.getElementById('loc-address').value.trim()
    if (!q) return
    const btn = document.getElementById('loc-search-btn')
    const msg = document.getElementById('location-msg')
    btn.disabled = true; btn.textContent = '…'; msg.textContent = ''
    try {
      const { lat, lng, address } = await geocodeAddress(q)
      document.getElementById('loc-lat').value = lat
      document.getElementById('loc-lng').value = lng
      document.getElementById('loc-address').value = address
      showGeocodeResult(address, lat, lng)
    } catch (err) {
      msg.textContent = '⚠ ' + err.message
      hideGeocodeResult()
    } finally {
      btn.disabled = false; btn.textContent = 'Найти'
    }
  })

  document.getElementById('loc-address').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('loc-search-btn').click()
  })

  // ── Geolocation button ────────────────────────────────────────────────────────

  document.getElementById('req-geo-btn').addEventListener('click', () => {
    const msg = document.getElementById('location-msg')
    msg.textContent = 'Определение…'
    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude: lat, longitude: lng } = pos.coords
      document.getElementById('loc-lat').value = lat.toFixed(6)
      document.getElementById('loc-lng').value = lng.toFixed(6)
      msg.textContent = ''
      try {
        const address = await reverseGeocode(lat, lng)
        document.getElementById('loc-address').value = address
        showGeocodeResult(address, lat, lng)
      } catch {
        const address = `${lat.toFixed(5)}, ${lng.toFixed(5)}`
        document.getElementById('loc-address').value = address
        showGeocodeResult(address, lat, lng)
      }
    }, () => {
      msg.textContent = '⚠ Геолокация недоступна'
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
      listEl.innerHTML = '<p class="notif-empty" style="color:#d6382d">Не удалось загрузить уведомления.</p>'
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

  // ── Map picker callback ───────────────────────────────────────────────────────

  window._mapPickerCallback = function (address, lat, lng) {
    showGeocodeResult(address, lat, lng)
  }

  // ── Init ──────────────────────────────────────────────────────────────────────

  async function init() {
    API = window.LOOM_CONFIG ? window.LOOM_CONFIG.API_BASE
      : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
          ? 'http://localhost:8787' : 'https://api.loomdesign.uz')

    user = await window.LOOM_AUTH.getCurrentUser()
    if (!user) { window.location.href = 'login.html?redirect=account.html'; return }

    // Populate the shared site navbar (auth slot, avatar/dropdown)
    if (window.LOOM_AUTH && window.LOOM_AUTH.renderAuthNav) window.LOOM_AUTH.renderAuthNav()

    populateProfile(user)
    loadOrders()
    loadNotifPrefs()
    loadNotifications(notifPage)

    // Legacy standalone logout button (logout now lives in the nav dropdown)
    const logoutBtn = document.getElementById('logout-btn')
    if (logoutBtn) logoutBtn.addEventListener('click', () => window.LOOM_AUTH.logout())

    // Re-render language-sensitive dynamic content on language switch
    window.addEventListener('loom:langchange', () => {
      if (user) {
        document.getElementById('profile-since').textContent = AT('acc.statSince', 'С нами с') + ' ' + fmtDate(user.created_at)
      }
      loadOrders()
      loadNotifications(notifPage)
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
