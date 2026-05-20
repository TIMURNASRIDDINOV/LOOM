'use strict'

;(function () {
  const { apiJSON, checkAuth, formatPrice, formatDate, statusBadge } = window.LOOM

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
      ['Телефон', u.phone || '—'],
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

    // Notify button only if has Telegram
    document.getElementById('btn-notify').style.display = u.telegram_user_id ? '' : 'none'
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

  async function loadActivity() {
    try {
      const data = await apiJSON(`/api/admin/users/${userId}/activity`)
      const tbody = document.getElementById('activity-tbody')
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
      document.getElementById('activity-tbody').innerHTML =
        `<tr><td colspan="3" style="color:#f87171">${escHtml(err.message)}</td></tr>`
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

  document.getElementById('btn-notify').addEventListener('click', () => {
    const form = document.getElementById('notif-form')
    form.style.display = form.style.display === 'none' ? '' : 'none'
  })

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

    await Promise.all([loadOrders(), loadActivity()])
  })
})()
