'use strict'

const STATUS_COLORS_HEX = {
  new: '#3b82f6', confirmed: '#eab308', producing: '#f97316',
  shipped: '#a855f7', delivered: '#22c55e', cancelled: '#6b7280',
}

const DEVICE_COLORS  = { desktop: '#60a5fa', mobile: '#4ade80', tablet: '#f97316', unknown: '#6b7280' }
const BROWSER_COLORS = { chrome: '#facc15', safari: '#60a5fa', firefox: '#f97316', edge: '#a78bfa', samsung: '#4ade80', opera: '#ef4444', other: '#6b7280' }
const OS_COLORS      = { android: '#4ade80', ios: '#60a5fa', windows: '#a78bfa', mac: '#facc15', linux: '#f97316', other: '#6b7280' }

function escHtml(s) {
  if (!s) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderBreakdown(containerId, rows, colorMap) {
  const container = document.getElementById(containerId)
  if (!rows || !rows.length) { container.innerHTML = '<span style="font-size:0.8rem;color:rgba(255,255,255,0.3)">Нет данных</span>'; return }
  const total = rows.reduce((s, r) => s + (r.count || 0), 0)
  const key = Object.keys(rows[0]).find(k => k !== 'count')
  container.innerHTML = `<div class="breakdown-list">` + rows.map(r => {
    const val = r[key] || 'other'
    const pct = total ? Math.round((r.count / total) * 100) : 0
    const color = colorMap[val] || colorMap['other'] || '#6b7280'
    return `
      <div class="breakdown-row">
        <span class="breakdown-label">${escHtml(val)}</span>
        <div class="breakdown-bar-wrap">
          <div class="breakdown-bar" style="width:${pct}%;background:${color}"></div>
        </div>
        <span class="breakdown-count">${r.count}</span>
      </div>
    `
  }).join('') + `</div>`
}

function makeLineChart(canvasId, labels, data, color = 'rgba(99,202,183,0.7)') {
  const ctx = document.getElementById(canvasId).getContext('2d')
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: color,
        backgroundColor: color.replace('0.7', '0.08'),
        borderWidth: 1.5,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: 'rgba(255,255,255,0.3)', font: { size: 10 }, maxTicksLimit: 10 }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { ticks: { color: 'rgba(255,255,255,0.3)', font: { size: 10 }, stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true },
      },
    },
  })
}

function makeBarChart(canvasId, labels, data) {
  const ctx = document.getElementById(canvasId).getContext('2d')
  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: 'rgba(255,255,255,0.12)',
        borderColor: 'rgba(255,255,255,0.3)',
        borderWidth: 1, borderRadius: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: 'rgba(255,255,255,0.3)', font: { size: 10 }, maxTicksLimit: 10 }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { ticks: { color: 'rgba(255,255,255,0.3)', font: { size: 10 }, stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true },
      },
    },
  })
}

// Fill missing days in last-N-days series
function fillDays(rows, n, dateKey = 'day', countKey = 'count') {
  const map = {}
  for (const row of rows) map[row[dateKey]] = row[countKey]
  const labels = [], counts = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    labels.push(key.slice(5))
    counts.push(map[key] ?? 0)
  }
  return { labels, counts }
}

async function loadDashboard() {
  const { apiJSON, formatPrice, formatDate, statusBadge, STATUS_LABELS } = window.LOOM

  // ── Load in parallel ────────────────────────────────────────────────────────
  const [stats, visitors] = await Promise.all([
    apiJSON('/api/admin/stats').catch(() => null),
    apiJSON('/api/admin/analytics/visitors').catch(() => null),
  ])

  if (!stats) return

  // ── Order stat cards ────────────────────────────────────────────────────────
  document.getElementById('stat-week').textContent = stats.ordersLast7Days
  document.getElementById('stat-revenue').textContent = formatPrice(stats.revenueLast30Days)
  document.getElementById('stat-new').textContent = stats.ordersByStatus['new'] ?? 0
  document.getElementById('stat-producing').textContent = stats.ordersByStatus['producing'] ?? 0

  // ── Visitor stat cards ──────────────────────────────────────────────────────
  if (visitors) {
    document.getElementById('vis-today').textContent = visitors.today
    document.getElementById('vis-week').textContent  = visitors.week
    document.getElementById('vis-month').textContent = visitors.month
    document.getElementById('vis-year').textContent  = visitors.year
    document.getElementById('vis-all').textContent   = visitors.allTime

    renderBreakdown('device-breakdown',  visitors.byDevice,  DEVICE_COLORS)
    renderBreakdown('browser-breakdown', visitors.byBrowser, BROWSER_COLORS)
    renderBreakdown('os-breakdown',      visitors.byOs,      OS_COLORS)

    const vd = fillDays(visitors.dailyLast30, 30)
    makeLineChart('visitors-chart', vd.labels, vd.counts)
  }

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

  // ── Orders per day chart ────────────────────────────────────────────────────
  const od = fillDays(stats.ordersPerDay, 30)
  makeBarChart('orders-chart', od.labels, od.counts)

  // ── Recent orders ───────────────────────────────────────────────────────────
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

  // ── Top products ────────────────────────────────────────────────────────────
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
