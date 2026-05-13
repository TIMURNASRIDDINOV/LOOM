'use strict'

const STATUS_COLORS_HEX = {
  new: '#3b82f6',
  confirmed: '#eab308',
  producing: '#f97316',
  shipped: '#a855f7',
  delivered: '#22c55e',
  cancelled: '#6b7280',
}

function escHtml(s) {
  if (!s) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function loadDashboard() {
  const { apiJSON, formatPrice, formatDate, statusBadge, STATUS_LABELS } = window.LOOM

  let stats
  try {
    stats = await apiJSON('/api/admin/stats')
  } catch (e) {
    console.error('Failed to load stats:', e)
    return
  }

  // ── Stat cards ──────────────────────────────────────────────────────────────
  document.getElementById('stat-week').textContent = stats.ordersLast7Days
  document.getElementById('stat-revenue').textContent = formatPrice(stats.revenueLast30Days)
  document.getElementById('stat-new').textContent = stats.ordersByStatus['new'] ?? 0
  document.getElementById('stat-producing').textContent = stats.ordersByStatus['producing'] ?? 0
  const usersEl = document.getElementById('stat-users')
  if (usersEl) usersEl.textContent = stats.totalUsers ?? 0
  const newUsersEl = document.getElementById('stat-new-users')
  if (newUsersEl) newUsersEl.textContent = stats.newUsersLast7Days ?? 0

  // ── Status bar ──────────────────────────────────────────────────────────────
  const statusOrder = ['new', 'confirmed', 'producing', 'shipped', 'delivered', 'cancelled']
  const statusBarEl = document.getElementById('status-bar')
  statusBarEl.innerHTML = statusOrder.map(s => {
    const count = stats.ordersByStatus[s] ?? 0
    const color = STATUS_COLORS_HEX[s] ?? '#6b7280'
    const label = STATUS_LABELS[s] ?? s
    return `
      <div class="status-item">
        <span class="status-count" style="color:${color}">${count}</span>
        <span class="status-lbl">${escHtml(label)}</span>
      </div>
    `
  }).join('')

  // ── Orders per day chart ─────────────────────────────────────────────────────
  // Fill in any missing days in the last 30 days with 0
  const days = []
  const counts = []
  const now = new Date()
  const dayMap = {}
  for (const row of stats.ordersPerDay) dayMap[row.day] = row.count

  for (let i = 29; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    days.push(key.slice(5))  // MM-DD
    counts.push(dayMap[key] ?? 0)
  }

  const ctx = document.getElementById('orders-chart').getContext('2d')
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: days,
      datasets: [{
        data: counts,
        backgroundColor: 'rgba(255,255,255,0.12)',
        borderColor: 'rgba(255,255,255,0.3)',
        borderWidth: 1,
        borderRadius: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { color: 'rgba(255,255,255,0.3)', font: { size: 10 }, maxTicksLimit: 10 },
          grid: { color: 'rgba(255,255,255,0.04)' },
        },
        y: {
          ticks: { color: 'rgba(255,255,255,0.3)', font: { size: 10 }, stepSize: 1 },
          grid: { color: 'rgba(255,255,255,0.04)' },
          beginAtZero: true,
        },
      },
    },
  })

  // ── Recent orders ────────────────────────────────────────────────────────────
  const tbody = document.getElementById('recent-orders').querySelector('tbody')
  if (!stats.recentOrders?.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:rgba(255,255,255,0.3);font-size:0.82rem">Нет заказов</td></tr>'
  } else {
    tbody.innerHTML = stats.recentOrders.map(o => `
      <tr onclick="location.href='order.html?id=${o.id}'">
        <td class="id-col">#${o.id}</td>
        <td class="name-col">
          <div style="font-size:0.85rem">${escHtml(o.customer_name)}</div>
          <div style="font-size:0.72rem;color:rgba(255,255,255,0.35);margin-top:2px">${formatDate(o.created_at)}</div>
        </td>
        <td style="text-align:right;vertical-align:middle">${statusBadge(o.status)}</td>
      </tr>
    `).join('')
  }

  // ── Top products ─────────────────────────────────────────────────────────────
  const topEl = document.getElementById('top-products')
  if (!stats.topProducts?.length) {
    topEl.innerHTML = '<span style="color:rgba(255,255,255,0.3);font-size:0.82rem">Нет данных</span>'
  } else {
    topEl.innerHTML = stats.topProducts.map((p, i) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0.55rem 0;border-bottom:0.5px solid rgba(255,255,255,0.04)">
        <div style="display:flex;align-items:center;gap:0.6rem">
          <span style="font-family:var(--mono);font-size:0.72rem;color:rgba(255,255,255,0.3);width:1rem">${i + 1}</span>
          <span style="font-size:0.85rem">${escHtml(p.name_ru ?? 'Без названия')}</span>
        </div>
        <span style="font-family:var(--mono);font-size:0.82rem;color:rgba(255,255,255,0.5)">${p.count} зак.</span>
      </div>
    `).join('')
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const { checkAuth } = window.LOOM
  const admin = await checkAuth()
  if (!admin) { window.location.href = 'login.html'; return }

  window.LOOM_LAYOUT.setEmail(admin.email)
  loadDashboard()
})
