'use strict'

// ─── API base ──────────────────────────────────────────────────────────────────

const API_BASE = (() => {
  const h = window.location.hostname
  if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:8787'
  return 'https://api.looom.me'
})()

// ─── Fetch wrapper with credentials (sends admin_token cookie) ─────────────────

async function apiFetch(path, options = {}) {
  const url = path.startsWith('http') ? path : API_BASE + path
  const res = await fetch(url, { credentials: 'include', ...options })
  return res
}

async function apiJSON(path, options = {}) {
  const res = await apiFetch(path, options)
  const data = await res.json()
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, data })
  return data
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

async function checkAuth() {
  try {
    const data = await apiJSON('/api/admin/me')
    return data
  } catch {
    return null
  }
}

async function logout() {
  try {
    await apiJSON('/api/admin/logout', { method: 'POST' })
  } catch { /* ignore */ }
  window.location.href = 'login.html'
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_LABELS = {
  new: 'Новый',
  confirmed: 'Подтверждён',
  producing: 'Производство',
  shipped: 'Отправлен',
  delivered: 'Доставлен',
  cancelled: 'Отменён',
}

const STATUS_COLORS = {
  new: '#3b82f6',        // blue
  confirmed: '#eab308',  // yellow
  producing: '#f97316',  // orange
  shipped: '#a855f7',    // purple
  delivered: '#22c55e',  // green
  cancelled: '#6b7280',  // gray
}

function statusBadge(status) {
  const label = STATUS_LABELS[status] ?? status
  const color = STATUS_COLORS[status] ?? '#6b7280'
  return `<span style="
    display:inline-block;padding:2px 10px;border-radius:9999px;font-size:0.72rem;
    font-weight:500;letter-spacing:0.05em;
    background:${color}22;color:${color};border:1px solid ${color}55
  ">${label}</span>`
}

function formatPrice(sums) {
  return new Intl.NumberFormat('ru-RU').format(sums) + ' сум'
}

function formatDate(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', dateStyle: 'short', timeStyle: 'short' })
}

function formatPhone(phone) {
  if (!phone) return '—'
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('998') && digits.length === 12) {
    return `+998 (${digits.slice(3,5)}) ${digits.slice(5,8)}-${digits.slice(8,10)}-${digits.slice(10,12)}`
  }
  if (digits.length === 9) {
    return `+998 (${digits.slice(0,2)}) ${digits.slice(2,5)}-${digits.slice(5,7)}-${digits.slice(7,9)}`
  }
  return phone
}

// ─── Logout button ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btn-logout')
  if (btn) btn.addEventListener('click', logout)
})

// Export for other scripts
window.LOOM = { API_BASE, apiFetch, apiJSON, checkAuth, logout, statusBadge, formatPrice, formatDate, formatPhone, STATUS_LABELS, STATUS_COLORS }
