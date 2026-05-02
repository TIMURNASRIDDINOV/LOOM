'use strict'

let currentPage = 1
const LIMIT = 50
let debounceTimer = null

async function loadOrders() {
  const { apiFetch, statusBadge, formatPrice, formatDate } = window.LOOM

  const status = document.getElementById('filter-status').value
  const q = document.getElementById('filter-q').value.trim()

  const params = new URLSearchParams({ page: currentPage, limit: LIMIT })
  if (status) params.set('status', status)
  if (q) params.set('q', q)

  const tbody = document.getElementById('orders-tbody')
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:rgba(255,255,255,0.35)">Загрузка…</td></tr>'

  try {
    const res = await apiFetch('/api/admin/orders?' + params)
    if (res.status === 401) { window.location.href = 'login.html'; return }
    const data = await res.json()

    const { orders, total, page, limit } = data

    // Update pagination info
    const totalPages = Math.ceil(total / limit)
    document.getElementById('page-info').textContent = `Стр. ${page} из ${totalPages || 1} (всего ${total})`
    document.getElementById('btn-prev').disabled = page <= 1
    document.getElementById('btn-next').disabled = page >= totalPages

    if (!orders.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:rgba(255,255,255,0.35)">Заказов нет</td></tr>'
      return
    }

    tbody.innerHTML = orders.map(o => `
      <tr class="order-row" data-id="${o.id}" style="cursor:pointer">
        <td>#${o.id}</td>
        <td>${escHtml(o.customer_name)}</td>
        <td style="font-family:var(--mono);font-size:0.82rem">${escHtml(o.customer_phone)}</td>
        <td>${escHtml(o.product_name_ru || '—')}</td>
        <td style="font-family:var(--mono)">${formatPrice(o.total_price)}</td>
        <td>${statusBadge(o.status)}</td>
        <td style="font-size:0.82rem;color:rgba(255,255,255,0.55)">${formatDate(o.created_at)}</td>
        <td style="color:rgba(255,255,255,0.35)">→</td>
      </tr>
    `).join('')

    // Row click navigation
    tbody.querySelectorAll('.order-row').forEach(row => {
      row.addEventListener('click', () => {
        window.location.href = `order.html?id=${row.dataset.id}`
      })
      row.addEventListener('mouseenter', () => row.style.background = 'rgba(255,255,255,0.03)')
      row.addEventListener('mouseleave', () => row.style.background = '')
    })
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:#ef4444">Ошибка: ${escHtml(e.message)}</td></tr>`
  }
}

function escHtml(s) {
  if (!s) return ''
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

document.addEventListener('DOMContentLoaded', async () => {
  const { checkAuth } = window.LOOM
  const admin = await checkAuth()
  if (!admin) { window.location.href = 'login.html'; return }

  window.LOOM_LAYOUT.setEmail(admin.email)

  // Wire controls
  document.getElementById('filter-status').addEventListener('change', () => { currentPage = 1; loadOrders() })

  document.getElementById('filter-q').addEventListener('input', () => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => { currentPage = 1; loadOrders() }, 300)
  })

  document.getElementById('btn-refresh').addEventListener('click', loadOrders)

  document.getElementById('btn-prev').addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; loadOrders() }
  })
  document.getElementById('btn-next').addEventListener('click', () => {
    currentPage++; loadOrders()
  })

  loadOrders()
})
