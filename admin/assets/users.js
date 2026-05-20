'use strict'

const { API_BASE, apiJSON, checkAuth, formatPrice, formatDate } = window.LOOM

let currentPage = 1
const PAGE_SIZE = 50
let currentQ = ''

function esc(s) {
  if (!s) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function initials(u) {
  const name = u.name || u.email || ''
  return name.slice(0, 2).toUpperCase()
}

function avatarHtml(u) {
  const url = u.avatar_key
    ? `${API_BASE}/api/files/avatars/${esc(u.avatar_key)}`
    : null
  if (url) {
    return `<img class="avatar-sm" src="${url}" alt="" />`
  }
  return `<div class="initials-sm">${esc(initials(u))}</div>`
}

function renderUsers(users, total, page, limit) {
  const tbody = document.getElementById('users-tbody')
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:rgba(255,255,255,0.3);font-size:0.82rem;padding:1rem">Пользователи не найдены</td></tr>'
  } else {
    tbody.innerHTML = users.map(u => `
      <tr>
        <td>${avatarHtml(u)}</td>
        <td class="mono">${esc(u.email)}</td>
        <td>${u.name ? esc(u.name) : '<span class="muted">—</span>'}</td>
        <td class="mono muted">${u.phone ? esc(u.phone) : '—'}</td>
        <td class="mono" style="text-align:center">${u.order_count ?? 0}</td>
        <td class="mono muted">${u.total_spent ? formatPrice(u.total_spent) : '—'}</td>
        <td class="muted" style="font-size:0.78rem">${formatDate(u.created_at)}</td>
      </tr>
    `).join('')
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
    tbody.innerHTML = `<tr><td colspan="7" style="color:#f87171;font-size:0.82rem;padding:1rem">${esc(err.message)}</td></tr>`
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
