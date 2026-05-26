'use strict'

;(function () {
  const { apiJSON, checkAuth, formatPrice, formatDate, formatPhone, statusBadge } = window.LOOM

  let userId = null
  let currentUser = null

  function escHtml(s) {
    if (!s) return ''
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function roleBadge(role) {
    const map = {
      owner:       ['OWNER',       '#fbbf24', 'rgba(251,191,36,0.15)'],
      super_admin: ['SUPER ADMIN', '#a78bfa', 'rgba(167,139,250,0.15)'],
      admin:       ['ADMIN',       '#60a5fa', 'rgba(96,165,250,0.15)'],
      user:        ['USER',        'rgba(255,255,255,0.5)', 'rgba(255,255,255,0.06)'],
    }
    const [label, color, bg] = map[role] || ['?', 'rgba(255,255,255,0.3)', 'transparent']
    return `<span class="badge" style="color:${color};background:${bg};border:1px solid ${color}30">${label}</span>`
  }

  function renderUserInfo(u) {
    currentUser = u
    document.getElementById('page-title').textContent = u.phone || `Пользователь #${u.id}`

    const rows = [
      ['ID', String(u.id)],
      ['Телефон', u.phone ? formatPhone(u.phone) : '—'],
      ['Имя', [u.first_name, u.last_name].filter(Boolean).join(' ') || '—'],
      ['Telegram', u.telegram_username ? '@' + u.telegram_username : '—'],
      ['Telegram ID', u.telegram_user_id ? String(u.telegram_user_id) : '—'],
      ['Статус', u.status],
      ['Заказов', String(u.orders_count ?? 0)],
      ['Потрачено', formatPrice(u.total_spent ?? 0)],
      ['Регистрация', formatDate(u.created_at)],
      ['Последний вход', u.last_login_at ? formatDate(u.last_login_at) : '—'],
    ]

    document.getElementById('user-info').innerHTML =
      // Role row with badge
      `<span class="info-label">Роль</span><span class="info-value">${roleBadge(u.role)}</span>` +
      rows.map(([label, val]) => `
        <span class="info-label">${escHtml(label)}</span>
        <span class="info-value">${escHtml(val)}</span>
      `).join('')

    // Show action buttons
    const actions = document.getElementById('user-actions')
    actions.style.display = ''

    const toggleStatusBtn = document.getElementById('btn-toggle-status')
    toggleStatusBtn.textContent = u.status === 'banned' ? 'Разблокировать' : 'Заблокировать'
    toggleStatusBtn.className = u.status === 'banned'
      ? 'btn-action'
      : 'btn-action danger'

    // Role selector dropdown
    const roleContainer = document.getElementById('role-select-container')
    if (roleContainer) {
      roleContainer.innerHTML = `
        <select id="role-select" style="
          padding:0.45rem 0.75rem;border-radius:3px;
          border:0.5px solid rgba(255,255,255,0.2);
          background:rgba(255,255,255,0.05);color:#fff;
          font-family:inherit;font-size:0.8rem;cursor:pointer;outline:none;
        ">
          <option value="user"${u.role === 'user' ? ' selected' : ''}>user</option>
          <option value="admin"${u.role === 'admin' ? ' selected' : ''}>admin</option>
          <option value="super_admin"${u.role === 'super_admin' ? ' selected' : ''}>super_admin</option>
          <option value="owner"${u.role === 'owner' ? ' selected' : ''}>owner</option>
        </select>
        <button class="btn-action" id="btn-apply-role" style="margin-left:0.4rem">Сохранить роль</button>
      `
      document.getElementById('btn-apply-role').addEventListener('click', async () => {
        const newRole = document.getElementById('role-select').value
        if (newRole === currentUser.role) return
        const label = newRole === 'owner' ? 'передать права владельца' : `назначить роль "${newRole}"`
        if (!confirm(`Вы уверены, что хотите ${label}?`)) return
        try {
          await apiJSON(`/api/admin/users/${userId}/role`, {
            method: 'PATCH',
            body: JSON.stringify({ role: newRole }),
            headers: { 'Content-Type': 'application/json' },
          })
          location.reload()
        } catch (err) {
          alert('Ошибка: ' + err.message)
        }
      })
    }

    // Notify button — always visible; hint differs when no Telegram
    const notifyBtn = document.getElementById('btn-notify')
    notifyBtn.style.display = ''
    const noTgNote = document.getElementById('notif-no-tg-note')
    if (noTgNote) noTgNote.style.display = u.telegram_user_id ? 'none' : ''

    // Pre-fill edit profile form
    document.getElementById('edit-first-name').value = u.first_name || ''
    document.getElementById('edit-last-name').value = u.last_name || ''
    document.getElementById('edit-email').value = u.email || ''
    document.getElementById('edit-phone').value = u.phone || ''

    // Pre-fill location form from JSON
    try {
      const loc = u.location_preset ? JSON.parse(u.location_preset) : null
      const curEl = document.getElementById('admin-loc-current')
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
      if (!data.orders?.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="color:rgba(255,255,255,0.3)">Заказов нет</td></tr>'
        return
      }
      tbody.innerHTML = data.orders.map(o => `
        <tr style="cursor:pointer" onclick="location.href='order.html?id=${o.id}'">
          <td class="mono">#${o.id}</td>
          <td style="color:rgba(255,255,255,0.5)">${formatDate(o.created_at)}</td>
          <td>${statusBadge(o.status)}</td>
          <td style="text-align:right;font-family:var(--mono)">${formatPrice(o.total_price)}</td>
        </tr>
      `).join('')
    } catch (err) {
      document.getElementById('orders-tbody').innerHTML =
        `<tr><td colspan="4" style="color:#f87171">${escHtml(err.message)}</td></tr>`
    }
  }

  async function loadActivity(since) {
    const tbody = document.getElementById('activity-tbody')
    tbody.innerHTML = '<tr><td colspan="3" style="color:rgba(255,255,255,0.3)">Загрузка…</td></tr>'
    try {
      const qs = since ? `?since=${since}` : ''
      const data = await apiJSON(`/api/admin/users/${userId}/activity${qs}`)

      if (!data.items?.length) {
        tbody.innerHTML = '<tr><td colspan="3" style="color:rgba(255,255,255,0.3)">Нет записей</td></tr>'
        return
      }
      tbody.innerHTML = data.items.map(a => {
        let meta = ''
        if (a.metadata) {
          try {
            const m = JSON.parse(a.metadata)
            meta = Object.entries(m).map(([k, v]) => `${k}: ${v}`).join(', ')
          } catch { meta = a.metadata }
        }
        return `
          <tr>
            <td class="mono" style="font-size:0.8rem">${escHtml(a.action)}</td>
            <td style="color:rgba(255,255,255,0.4);font-size:0.8rem">${formatDate(a.created_at)}</td>
            <td style="color:rgba(255,255,255,0.4);font-size:0.78rem">${escHtml(meta)}</td>
          </tr>
        `
      }).join('')
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="3" style="color:#f87171">${escHtml(err.message)}</td></tr>`
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  document.getElementById('btn-toggle-status').addEventListener('click', async () => {
    if (!currentUser) return
    const newStatus = currentUser.status === 'banned' ? 'active' : 'banned'
    const label = newStatus === 'banned' ? 'заблокировать' : 'разблокировать'
    if (!confirm(`Вы уверены, что хотите ${label} этого пользователя?`)) return
    try {
      await apiJSON(`/api/admin/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }), headers: { 'Content-Type': 'application/json' } })
      location.reload()
    } catch (err) {
      alert('Ошибка: ' + err.message)
    }
  })

  // Role change is now handled by the role-select dropdown rendered inside renderUserInfo

  function toggleCard(btnId, cardId) {
    document.getElementById(btnId).addEventListener('click', () => {
      const card = document.getElementById(cardId)
      card.style.display = card.style.display === 'none' ? '' : 'none'
    })
  }

  toggleCard('btn-notify', 'notif-form')
  toggleCard('btn-edit-profile', 'edit-profile-card')
  toggleCard('btn-edit-location', 'edit-location-card')
  toggleCard('btn-reset-password', 'reset-password-card')

  document.getElementById('btn-send-notif').addEventListener('click', async () => {
    const msg = document.getElementById('notif-msg').value.trim()
    const btnLabel = document.getElementById('notif-btn-label').value.trim()
    const btnUrl = document.getElementById('notif-btn-url').value.trim()
    const result = document.getElementById('notif-result')

    if (!msg) { result.style.color = '#f87171'; result.textContent = 'Введите текст сообщения'; return }

    result.style.color = 'rgba(255,255,255,0.4)'; result.textContent = 'Отправка…'

    try {
      const body = { user_id: userId, message: msg }
      if (btnLabel && btnUrl) { body.button_label = btnLabel; body.button_url = btnUrl }

      await apiJSON('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      result.style.color = '#4ade80'; result.textContent = '✅ Уведомление отправлено'
      document.getElementById('notif-msg').value = ''
    } catch (err) {
      result.style.color = '#f87171'; result.textContent = 'Ошибка: ' + err.message
    }
  })

  // ── Edit Profile ──────────────────────────────────────────────────────────

  document.getElementById('btn-save-profile').addEventListener('click', async () => {
    const result = document.getElementById('profile-result')
    const body = {
      first_name: document.getElementById('edit-first-name').value.trim() || null,
      last_name: document.getElementById('edit-last-name').value.trim() || null,
      email: document.getElementById('edit-email').value.trim() || null,
      phone: document.getElementById('edit-phone').value.trim() || null,
    }
    result.style.color = 'rgba(255,255,255,0.4)'; result.textContent = 'Сохранение…'
    try {
      const updated = await apiJSON(`/api/admin/users/${userId}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      result.style.color = '#4ade80'; result.textContent = '✅ Сохранено'
      renderUserInfo(updated)
    } catch (err) {
      result.style.color = '#f87171'; result.textContent = 'Ошибка: ' + err.message
    }
  })

  // ── Edit Location ─────────────────────────────────────────────────────────

  document.getElementById('btn-geocode-location').addEventListener('click', async () => {
    const q = document.getElementById('edit-location-addr').value.trim()
    const result = document.getElementById('location-result')
    const btn = document.getElementById('btn-geocode-location')
    if (!q) return
    btn.disabled = true; btn.textContent = '…'; result.textContent = ''
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&accept-language=ru`
      const res = await fetch(url)
      const data = await res.json()
      if (!data.length) { result.style.color = '#f87171'; result.textContent = 'Адрес не найден'; return }
      const { lat, lon, display_name } = data[0]
      document.getElementById('edit-location-addr').value = display_name
      showAdminLocResult(display_name, parseFloat(lat), parseFloat(lon))
    } catch (err) {
      result.style.color = '#f87171'; result.textContent = 'Ошибка: ' + err.message
    } finally {
      btn.disabled = false; btn.textContent = 'Найти'
    }
  })

  document.getElementById('edit-location-addr').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-geocode-location').click()
  })

  document.getElementById('btn-save-location').addEventListener('click', async () => {
    const result = document.getElementById('location-result')
    result.style.color = 'rgba(255,255,255,0.4)'; result.textContent = 'Сохранение…'
    const loc = _adminLocAddr ? { address: _adminLocAddr, lat: _adminLocLat, lng: _adminLocLng } : null
    try {
      await apiJSON(`/api/admin/users/${userId}/location`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_preset: loc }),
      })
      result.style.color = '#4ade80'; result.textContent = '✅ Сохранено'
    } catch (err) {
      result.style.color = '#f87171'; result.textContent = 'Ошибка: ' + err.message
    }
  })

  document.getElementById('btn-clear-location').addEventListener('click', async () => {
    const result = document.getElementById('location-result')
    document.getElementById('edit-location-addr').value = ''
    document.getElementById('admin-loc-result').style.display = 'none'
    document.getElementById('admin-loc-current').style.display = 'none'
    _adminLocAddr = null; _adminLocLat = null; _adminLocLng = null
    result.style.color = 'rgba(255,255,255,0.4)'; result.textContent = 'Очистка…'
    try {
      await apiJSON(`/api/admin/users/${userId}/location`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_preset: null }),
      })
      result.style.color = '#4ade80'; result.textContent = '✅ Локация очищена'
    } catch (err) {
      result.style.color = '#f87171'; result.textContent = 'Ошибка: ' + err.message
    }
  })

  // ── Reset Password ────────────────────────────────────────────────────────

  document.getElementById('btn-save-password').addEventListener('click', async () => {
    const result = document.getElementById('password-result')
    const password = document.getElementById('edit-password').value
    if (password.length < 6) {
      result.style.color = '#f87171'; result.textContent = 'Минимум 6 символов'
      return
    }
    if (!confirm('Установить новый пароль для этого пользователя?')) return
    result.style.color = 'rgba(255,255,255,0.4)'; result.textContent = 'Сохранение…'
    try {
      await apiJSON(`/api/admin/users/${userId}/password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      result.style.color = '#4ade80'; result.textContent = '✅ Пароль установлен'
      document.getElementById('edit-password').value = ''
    } catch (err) {
      result.style.color = '#f87171'; result.textContent = 'Ошибка: ' + err.message
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

  document.addEventListener('DOMContentLoaded', async () => {
    const admin = await checkAuth()
    if (!admin) { window.location.href = 'login.html'; return }
    window.LOOM_LAYOUT.setEmail(admin.email)

    userId = parseInt(new URLSearchParams(window.location.search).get('id'), 10)
    if (!userId) { window.location.href = 'users.html'; return }

    try {
      const user = await apiJSON(`/api/admin/users/${userId}`)
      renderUserInfo(user)
    } catch (err) {
      document.getElementById('user-info').textContent = 'Ошибка загрузки: ' + err.message
      return
    }

    // Phone input mask
    const phoneInput = document.getElementById('edit-phone')
    if (phoneInput) applyPhoneMask(phoneInput)

    // Activity filter buttons
    document.querySelectorAll('.activity-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.activity-filter-btn').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        loadActivity(btn.dataset.since || undefined)
      })
    })

    await Promise.all([loadOrders(), loadActivity()])
  })
})()
