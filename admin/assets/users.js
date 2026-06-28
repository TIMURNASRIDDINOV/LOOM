'use strict'

;(function () {
  const { apiJSON, checkAuth, formatPrice, formatDate, formatPhone } = window.LOOM

  let currentPage = 1
  const PAGE_SIZE = 50
  let currentQ = ''

  function esc(s) {
    if (!s) return ''
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function displayName(u) {
    if (u.first_name || u.last_name) {
      return [u.first_name, u.last_name].filter(Boolean).join(' ')
    }
    return u.name || ''
  }

  function initials(u) {
    const name = displayName(u) || u.email || u.phone || ''
    return name.slice(0, 2).toUpperCase()
  }

  function avatarHtml(u) {
    const url = u.avatar_key
      ? `${window.LOOM.API_BASE}/api/files/avatars/${esc(u.avatar_key)}`
      : null
    if (url) {
      return `<img class="avatar-sm" src="${url}" alt="" />`
    }
    return `<div class="initials-sm">${esc(initials(u))}</div>`
  }

  function roleBadge(role) {
    const colors = { owner: '#f59e0b', super_admin: '#8b5cf6', admin: '#3b82f6', user: '#6b7280', customer: '#6b7280' }
    const c = colors[role] || '#6b7280'
    return `<span style="font-size:0.68rem;padding:1px 6px;border-radius:3px;background:${c}22;color:${c};border:1px solid ${c}44">${esc(role)}</span>`
  }

  function renderUsers(users, total, page, limit) {
    const tbody = document.getElementById('users-tbody')
    if (!users.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="color:var(--text-dim);font-size:0.82rem;padding:1rem">Пользователи не найдены</td></tr>'
    } else {
      tbody.innerHTML = users.map(u => {
        const name = displayName(u)
        const contact = u.email || u.phone || (u.telegram_username ? '@' + u.telegram_username : '')
        return `
        <tr style="cursor:pointer" onclick="location.href='user-detail.html?id=${u.id}'">
          <td>${avatarHtml(u)}</td>
          <td class="mono" style="font-size:0.8rem">${esc(contact)}</td>
          <td>${name ? esc(name) : '<span class="muted">—</span>'}</td>
          <td class="mono muted">${u.phone ? esc(formatPhone(u.phone)) : '—'}</td>
          <td style="text-align:center">${roleBadge(u.role || 'user')}</td>
          <td class="mono" style="text-align:center">${u.orders_count ?? 0}</td>
          <td class="muted" style="font-size:0.78rem">${formatDate(u.created_at)}</td>
        </tr>
      `}).join('')
    }

    const from = (page - 1) * limit + 1
    const to = Math.min(page * limit, total)
    document.getElementById('page-info').textContent = total
      ? `${from}–${to} из ${total}`
      : '0 пользователей'
    document.getElementById('prev-btn').disabled = page <= 1
    document.getElementById('next-btn').disabled = to >= total
  }

  async function loadUsers(page, q) {
    const tbody = document.getElementById('users-tbody')
    tbody.innerHTML = '<tr><td colspan="7"><span class="loading-ph">Загрузка…</span></td></tr>'
    try {
      const qs = new URLSearchParams({ page, limit: PAGE_SIZE })
      if (q) qs.set('q', q)
      const data = await apiJSON('/api/admin/users?' + qs)
      renderUsers(data.users, data.total, data.page, data.limit)
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" style="color:var(--danger);font-size:0.82rem;padding:1rem">${esc(err.message)}</td></tr>`
    }
  }

  document.getElementById('search-btn').addEventListener('click', () => {
    currentQ = document.getElementById('search-input').value.trim()
    currentPage = 1
    loadUsers(currentPage, currentQ)
  })

  document.getElementById('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('search-btn').click()
  })

  document.getElementById('refresh-btn').addEventListener('click', () => {
    loadUsers(currentPage, currentQ)
  })

  document.getElementById('prev-btn').addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; loadUsers(currentPage, currentQ) }
  })

  document.getElementById('next-btn').addEventListener('click', () => {
    currentPage++; loadUsers(currentPage, currentQ)
  })

  document.addEventListener('DOMContentLoaded', async () => {
    const admin = await checkAuth()
    if (!admin) { window.location.href = 'login.html'; return }
    window.LOOM_LAYOUT.setEmail(admin.email)
    loadUsers(currentPage, currentQ)
  })
})()
