'use strict'

;(function () {
  const { apiJSON, checkAuth, formatPrice, formatDate } = window.LOOM

  let currentPage = 1
  const PAGE_SIZE = 25
  let debounceTimer = null

  function escHtml(s) {
    if (!s) return ''
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function roleBadge(role) {
    if (role === 'admin') return '<span class="badge badge-admin">admin</span>'
    return '<span class="badge badge-customer">customer</span>'
  }

  function statusBadge(status) {
    if (status === 'banned') return '<span class="badge badge-banned">заблокирован</span>'
    return '<span class="badge badge-active">активен</span>'
  }

  async function loadUsers() {
    const q = document.getElementById('f-search').value.trim() || undefined
    const role = document.getElementById('f-role').value || undefined
    const status = document.getElementById('f-status').value || undefined

    const params = new URLSearchParams({ page: String(currentPage), limit: String(PAGE_SIZE) })
    if (q) params.set('q', q)
    if (role) params.set('role', role)
    if (status) params.set('status', status)

    const tbody = document.getElementById('users-tbody')
    tbody.innerHTML = '<tr><td colspan="8" style="color:rgba(255,255,255,0.3);padding:1rem 0.75rem">Загрузка…</td></tr>'

    try {
      const data = await apiJSON('/api/admin/users?' + params.toString())
      renderUsers(data.users || [], data.total || 0)
      updatePagination(data.total || 0)
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="8" style="color:#f87171;padding:1rem 0.75rem">Ошибка загрузки: ${escHtml(err.message)}</td></tr>`
    }
  }

  function renderUsers(users, total) {
    const tbody = document.getElementById('users-tbody')
    if (!users.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="color:rgba(255,255,255,0.3);padding:1.5rem 0.75rem">Пользователей не найдено</td></tr>'
      return
    }
    tbody.innerHTML = users.map(u => `
      <tr class="clickable" onclick="location.href='user-detail.html?id=${u.id}'">
        <td class="mono">${escHtml(u.phone || '—')}</td>
        <td>
          <div style="font-size:0.85rem">${escHtml([u.first_name, u.last_name].filter(Boolean).join(' ') || '—')}</div>
          ${u.telegram_username ? `<div style="font-size:0.72rem;color:rgba(255,255,255,0.35);margin-top:2px">@${escHtml(u.telegram_username)}</div>` : ''}
        </td>
        <td>${roleBadge(u.role)}</td>
        <td>${statusBadge(u.status)}</td>
        <td class="mono" style="color:rgba(255,255,255,0.6)">${u.orders_count ?? 0}</td>
        <td class="mono" style="color:rgba(255,255,255,0.6)">${formatPrice(u.total_spent ?? 0)}</td>
        <td style="color:rgba(255,255,255,0.45);font-size:0.82rem">${formatDate(u.created_at)}</td>
        <td style="color:rgba(255,255,255,0.35);font-size:0.82rem">${u.last_login_at ? formatDate(u.last_login_at) : '—'}</td>
      </tr>
    `).join('')
  }

  function updatePagination(total) {
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
    const info = document.getElementById('page-info')
    info.textContent = `Стр. ${currentPage} / ${totalPages} (${total})`
    document.getElementById('btn-prev').disabled = currentPage <= 1
    document.getElementById('btn-next').disabled = currentPage >= totalPages
  }

  document.getElementById('btn-prev').addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; loadUsers() }
  })
  document.getElementById('btn-next').addEventListener('click', () => {
    currentPage++; loadUsers()
  })

  ;['f-search', 'f-role', 'f-status'].forEach(id => {
    const el = document.getElementById(id)
    el.addEventListener('input', () => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => { currentPage = 1; loadUsers() }, 280)
    })
    el.addEventListener('change', () => { currentPage = 1; loadUsers() })
  })

  document.addEventListener('DOMContentLoaded', async () => {
    const admin = await checkAuth()
    if (!admin) { window.location.href = 'login.html'; return }
    window.LOOM_LAYOUT.setEmail(admin.email)
    loadUsers()
  })
})()
