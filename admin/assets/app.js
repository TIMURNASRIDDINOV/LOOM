'use strict'

// ─── API base ──────────────────────────────────────────────────────────────────

const API_BASE = (() => {
  const h = window.location.hostname
  if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:8787'
  return 'https://api.loomdesign.uz'
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
  // Colours live in theme.css (.badge / .badge-<status>) so they adapt per theme.
  const safe = STATUS_LABELS[status] ? status : 'cancelled'
  return `<span class="badge badge-${safe}">${label}</span>`
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

// ─── Boot failure surface ─────────────────────────────────────────────────────
// A page script that throws on its very first statement — typically destructuring
// a global whose file did not load — dies before it renders anything. The table
// then sits on «Загрузка…» forever and the only clue is in the console, so the
// page is indistinguishable from "there is simply no data". That is the failure
// mode this section exists to kill.
//
// The usual cause is a stale cached HTML page. Bumping ?v= changes the cache KEY
// but NOT which file the CDN serves, so an old page happily pulls the new
// scripts while never requesting one that was newly added — hence the reload
// below busts the cache on the HTML itself rather than calling location.reload(),
// which may legitimately be served from cache.
//
// This lives in app.js because app.js is the one file every admin page loads,
// old and new alike, and it loads before anything that can fail.

let bootErrorShown = false

// Only shout when there is evidence the page is actually stuck. An uncaught
// error from some unrelated widget should not put a scary banner over a page
// that rendered fine.
function pageLooksStuck() {
  return Array.prototype.some.call(
    document.querySelectorAll('.state'),
    (el) => /Загрузка/.test(el.textContent || ''),
  )
}

function showBootError(detail) {
  if (bootErrorShown) return
  bootErrorShown = true
  console.error('[LOOM admin] boot failure:', detail)

  const bar = document.createElement('div')
  bar.setAttribute('role', 'alert')
  // Inline styles on purpose: this has to render even if the stylesheet is the
  // thing that failed to load.
  bar.style.cssText = [
    'position:fixed', 'left:0', 'right:0', 'top:0', 'z-index:9999',
    'padding:14px 18px', 'background:#fef2f2', 'color:#7f1d1d',
    'border-bottom:1px solid #fca5a5', 'box-shadow:0 2px 10px rgba(0,0,0,0.12)',
    'font:500 14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif',
    'display:flex', 'gap:12px', 'align-items:center', 'flex-wrap:wrap',
  ].join(';')
  bar.innerHTML =
    '<span style="flex:1;min-width:240px">Страница загрузилась не полностью — ' +
    'часть файлов устарела. Нажмите «Обновить», чтобы получить свежую версию.</span>' +
    '<button type="button" style="padding:8px 16px;border-radius:4px;border:1px solid #7f1d1d;' +
    'background:#7f1d1d;color:#fff;font:inherit;cursor:pointer">Обновить</button>'

  bar.querySelector('button').addEventListener('click', () => {
    const url = new URL(window.location.href)
    url.searchParams.set('_', Date.now().toString(36))
    window.location.replace(url.toString())
  })

  function mount() {
    // position:fixed keeps this out of flow, so it cannot become a flex item of
    // body.has-sidebar and disturb the shell layout.
    document.body.appendChild(bar)
    document.querySelectorAll('.state').forEach((el) => {
      if (!/Загрузка/.test(el.textContent || '')) return
      el.classList.add('state--error')
      el.textContent = 'Не удалось загрузить данные — обновите страницу.'
    })
  }
  if (document.body) mount()
  else document.addEventListener('DOMContentLoaded', mount)
}

// A script or stylesheet that 404s reports through the capture phase with the
// element as target; a thrown exception reports with target === window.
window.addEventListener('error', (e) => {
  const el = e.target
  if (el && el !== window && el.tagName) {
    // A broken <img> (e.g. a missing product thumbnail) is cosmetic — ignore it.
    if (el.tagName === 'SCRIPT' || el.tagName === 'LINK') {
      showBootError('failed to load ' + (el.src || el.href))
    }
    return
  }
  // Give the page a moment to finish rendering before judging it stuck.
  const err = e.error || e.message
  setTimeout(() => { if (pageLooksStuck()) showBootError(err) }, 600)
}, true)

window.addEventListener('unhandledrejection', (e) => {
  setTimeout(() => { if (pageLooksStuck()) showBootError(e.reason) }, 600)
})

// ─── LOOM_UI fallback ─────────────────────────────────────────────────────────
// Every page script opens with `const { esc, toast, … } = window.LOOM_UI`, so if
// ui.js is absent that destructure throws and the page renders nothing at all.
// Seeding a degraded implementation here — app.js always loads, and always
// before ui.js — turns "blank page" into "page works, toasts fall back to
// native dialogs". ui.js overwrites this wholesale when it does load.
window.LOOM_UI = {
  esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  },
  toast(message) { console.warn('[LOOM admin] toast (ui.js missing):', message) },
  confirmDialog(opts) {
    const o = opts || {}
    return Promise.resolve(window.confirm([o.title, o.body].filter(Boolean).join('\n\n')))
  },
  apiErrorMessage(err) {
    if (err && err.data && err.data.code === 'forbidden') {
      return err.data.error || 'Недостаточно прав для этого действия.'
    }
    if (err && err.status === 401) return 'Сессия истекла — войдите заново.'
    return (err && err.message) || 'Не удалось выполнить действие.'
  },
}

// ─── Logout button ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btn-logout')
  if (btn) btn.addEventListener('click', logout)
})

// Export for other scripts
window.LOOM = { API_BASE, apiFetch, apiJSON, checkAuth, logout, statusBadge, formatPrice, formatDate, formatPhone, STATUS_LABELS, STATUS_COLORS, showBootError }
