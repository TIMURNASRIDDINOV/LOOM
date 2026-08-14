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

// ─── Human vocabulary ─────────────────────────────────────────────────────────
// The activity log stores raw machine values — action slugs like
// `password_reset_requested` and metadata like `by_admin_id: 1`. Those are for
// the database, not for a person reading a customer's history. Everything an
// operator sees gets translated here, in one place, so the wording cannot drift
// between the customers list and the customer card.

// Roles on the SHOP side (a customer's role), not admin-panel roles.
const USER_ROLE_LABELS = {
  user: 'Клиент',
  customer: 'Клиент',
  admin: 'Администратор',
  super_admin: 'Старший администратор',
  owner: 'Владелец',
}

const PROFILE_FIELD_LABELS = {
  first_name: 'имя',
  last_name: 'фамилия',
  name: 'имя',
  email: 'email',
  phone: 'телефон',
  location_preset: 'адрес доставки',
}

const LOGIN_VIA_LABELS = {
  telegram: 'через Telegram',
  telegram_webapp: 'через Telegram, мини-приложение',
}

function userRoleLabel(role) {
  return USER_ROLE_LABELS[role] || role || '—'
}

// Turn one activity row into a sentence plus an optional clarifying line.
// An action this function has never heard of must still read sensibly rather
// than leaking a slug, so the default case cleans it up instead of giving up.
function describeActivity(action, meta) {
  const m = meta && typeof meta === 'object' ? meta : {}

  const fieldList = () => {
    const raw = Array.isArray(m.fields) ? m.fields : String(m.fields || '').split(',')
    return raw
      .map((f) => PROFILE_FIELD_LABELS[String(f).trim()] || String(f).trim())
      .filter(Boolean)
      .join(', ')
  }

  const addressOf = (preset) => {
    if (!preset) return ''
    if (typeof preset === 'string') { try { preset = JSON.parse(preset) } catch { return '' } }
    return (preset && preset.address) || ''
  }

  switch (action) {
    case 'login':
      return { title: 'Вход в аккаунт', note: LOGIN_VIA_LABELS[m.via] || '' }

    case 'banned':
      return { title: 'Аккаунт заблокирован', note: '' }

    case 'unbanned':
      return { title: 'Аккаунт разблокирован', note: '' }

    case 'role_changed':
      return {
        title: 'Изменена роль',
        note: userRoleLabel(m.from_role) + ' → ' + userRoleLabel(m.to_role) +
          (m.reason === 'owner_transfer' ? ' · передача владения' : ''),
      }

    case 'notified':
      return {
        title: 'Отправлено сообщение',
        note: m.status === 'failed' ? 'не доставлено' : 'доставлено в Telegram',
        failed: m.status === 'failed',
      }

    case 'profile_updated': {
      const f = fieldList()
      return { title: 'Изменены данные клиента', note: f ? 'Поля: ' + f : '' }
    }

    case 'location_updated': {
      const addr = addressOf(m.location_preset)
      return m.location_preset
        ? { title: 'Изменён адрес доставки', note: addr }
        : { title: 'Адрес доставки очищен', note: '' }
    }

    case 'password_reset_requested':
      return {
        title: 'Запрошен сброс пароля',
        note: m.sent === false ? 'сообщение не отправлено' : 'клиенту отправлен запрос в Telegram',
        failed: m.sent === false,
      }

    case 'password_reset':
      return { title: 'Клиент сменил пароль', note: LOGIN_VIA_LABELS[m.via] || '' }

    case 'password_reset_verified':
      return { title: 'Номер телефона подтверждён', note: LOGIN_VIA_LABELS[m.via] || '' }

    default: {
      // e.g. "some_new_action" → "Some new action" — still readable, never a slug.
      const s = String(action || '').replace(/_/g, ' ').trim()
      return { title: s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Действие', note: '' }
    }
  }
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
// error from some unrelated widget must not put a scary banner over a page that
// rendered fine.
//
// Visibility matters: several pages HIDE their loading placeholder rather than
// removing it (order.html sets #loading to display:none), so a text-only check
// reports every such page as permanently stuck. getClientRects() is empty when
// the element or any ancestor is display:none, which is exactly the test we want.
function visibleLoadingPlaceholders() {
  return Array.prototype.filter.call(
    document.querySelectorAll('.state'),
    (el) => /Загрузка/.test(el.textContent || '') && el.getClientRects().length > 0,
  )
}

function pageLooksStuck() {
  return visibleLoadingPlaceholders().length > 0
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
  const btnCss = 'padding:8px 16px;border-radius:4px;font:inherit;cursor:pointer;'
  bar.innerHTML =
    '<span style="flex:1;min-width:240px">Не удалось загрузить часть данных на этой ' +
    'странице. Попробуйте обновить — если не помогает, сообщите разработчику.</span>' +
    '<button type="button" data-act="reload" style="' + btnCss +
    'border:1px solid #7f1d1d;background:#7f1d1d;color:#fff">Обновить</button>' +
    '<button type="button" data-act="dismiss" aria-label="Скрыть сообщение" style="' + btnCss +
    'border:1px solid #fca5a5;background:transparent;color:#7f1d1d">Скрыть</button>'

  bar.querySelector('[data-act="reload"]').addEventListener('click', () => {
    const url = new URL(window.location.href)
    url.searchParams.set('_', Date.now().toString(36))
    window.location.replace(url.toString())
  })
  // Never trap the operator behind a banner they cannot clear — if this fires
  // wrongly, dismissing must get them back to work immediately.
  bar.querySelector('[data-act="dismiss"]').addEventListener('click', () => bar.remove())

  function mount() {
    // position:fixed keeps this out of flow, so it cannot become a flex item of
    // body.has-sidebar and disturb the shell layout.
    document.body.appendChild(bar)
    visibleLoadingPlaceholders().forEach((el) => {
      el.classList.add('state--error')
      el.textContent = 'Не удалось загрузить данные — обновите страницу.'
    })
  }
  if (document.body) mount()
  else document.addEventListener('DOMContentLoaded', mount)
}

// Report only when the page is BOTH broken and visibly stuck. Getting this
// wrong in the noisy direction is worse than staying quiet: an operator who
// sees a red banner over a page that works learns to ignore all of them.
function reportIfStuck(detail) {
  setTimeout(() => { if (pageLooksStuck()) showBootError(detail) }, 800)
}

// A failed subresource reports through the capture phase with the element as
// target; a thrown exception reports with target === window.
window.addEventListener('error', (e) => {
  const el = e.target
  if (el && el !== window && el.tagName) {
    // Only a SCRIPT can leave the page functionally empty. A <link> covers
    // favicons and the Google Fonts stylesheet — losing those is cosmetic, and
    // treating them as fatal fired this banner on perfectly working pages.
    // An <img> (a missing product thumbnail) is cosmetic for the same reason.
    if (el.tagName === 'SCRIPT') reportIfStuck('failed to load ' + (el.src || el.href))
    return
  }
  reportIfStuck(e.error || e.message)
}, true)

window.addEventListener('unhandledrejection', (e) => reportIfStuck(e.reason))

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
window.LOOM = { API_BASE, apiFetch, apiJSON, checkAuth, logout, statusBadge, formatPrice, formatDate, formatPhone, STATUS_LABELS, STATUS_COLORS, showBootError, describeActivity, userRoleLabel, USER_ROLE_LABELS }
