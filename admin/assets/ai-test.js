'use strict'

/* LOOM Admin — AI model comparison harness.
   A spike: the job of this page is to make models comparable (same prompt,
   same seed, same backdrop) so we can decide which one LOOM ships with.

   TWO PROVIDERS: Workers AI (neurons, free tier) and Google Gemini / Nano
   Banana (dollars, paid). Each has its own budget bar and its own caps.

   Images come from admin-gated endpoints, and the admin panel is on a
   different origin than the API, so <img src> would not carry the cookie.
   Everything is fetched with credentials and shown as a blob URL — the same
   pattern order-detail.js uses for order proofs.

   Wrapped in an IIFE so this file's top-level declarations stay function-scoped.
   Without it, `const { apiFetch, ... }` below collides with the global
   `apiFetch` declared in app.js (both are classic scripts sharing the page's
   global scope), throwing "Identifier 'apiFetch' has already been declared".
   That SyntaxError aborts the ENTIRE file before a single line runs. Same fix
   as product-edit.js. */

;(function () {
const { apiFetch, apiJSON, checkAuth } = window.LOOM

const el = (id) => document.getElementById(id)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const nf = (n) => new Intl.NumberFormat('ru-RU').format(n)
const usd = (n) => '$' + (Number(n) || 0).toFixed(2)

let REGISTRY = []
// Caps mirrored from the server so the estimate can warn before the round-trip.
// The server guard is always the source of truth; these are only UX.
let MAX_PER_RUN = 4500       // neurons
let MAX_PER_RUN_USD = 0.5    // dollars
let GOOGLE_ENABLED = false   // is GEMINI_API_KEY set on the worker?
let BUDGET = {
  usedToday: 0, remaining: 0, cap: 9000,
  usedUsdToday: 0, remainingUsd: 1, capUsd: 1,
  resetsAt: null,
}
/** Blob URLs created for this run — revoked before the next run replaces them. */
let blobUrls = []

// ─── Budget ───────────────────────────────────────────────────────────────────

function renderBudget() {
  const b = BUDGET

  // Neuron budget (Workers AI, free tier)
  el('budget-value').innerHTML = `${nf(b.remaining)} <span class="dim">/ ${nf(b.cap)}</span>`
  const nPct = b.cap > 0 ? Math.min(100, (b.usedToday / b.cap) * 100) : 0
  const nFill = el('budget-fill')
  nFill.style.width = `${nPct}%`
  nFill.className = 'budget-fill' + (nPct >= 90 ? ' danger' : nPct >= 60 ? ' warn' : '')

  // USD budget (Google, paid)
  el('budget-usd-value').innerHTML = `${usd(b.remainingUsd)} <span class="dim">/ ${usd(b.capUsd)}</span>`
  const uPct = b.capUsd > 0 ? Math.min(100, (b.usedUsdToday / b.capUsd) * 100) : 0
  const uFill = el('budget-usd-fill')
  uFill.style.width = `${uPct}%`
  uFill.className = 'budget-fill' + (uPct >= 90 ? ' danger' : uPct >= 60 ? ' warn' : '')
  el('budget-usd-meta').textContent = GOOGLE_ENABLED
    ? `Потрачено ${usd(b.usedUsdToday)} · платные модели Google`
    : 'Ключ GEMINI_API_KEY не задан — модели Google отключены'
  el('budget-usd').classList.toggle('disabled', !GOOGLE_ENABLED)

  const reset = b.resetsAt
    ? new Date(b.resetsAt).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', dateStyle: 'short', timeStyle: 'short' })
    : '—'
  el('budget-meta').textContent =
    `Потрачено ${nf(b.usedToday)} · сброс 00:00 UTC (${reset} по Ташкенту)`
}

/** Merge whatever budget fields a response carried, keeping the rest. */
function mergeBudget(d) {
  if (d.usedToday !== undefined) BUDGET.usedToday = d.usedToday
  if (d.remaining !== undefined) BUDGET.remaining = d.remaining
  if (d.cap !== undefined) BUDGET.cap = d.cap
  if (d.usedUsdToday !== undefined) BUDGET.usedUsdToday = d.usedUsdToday
  if (d.remainingUsd !== undefined) BUDGET.remainingUsd = d.remainingUsd
  if (d.capUsd !== undefined) BUDGET.capUsd = d.capUsd
  if (d.resetsAt !== undefined) BUDGET.resetsAt = d.resetsAt
  if (d.maxPerRun) MAX_PER_RUN = d.maxPerRun
  if (d.maxPerRunUsd) MAX_PER_RUN_USD = d.maxPerRunUsd
  if (d.googleEnabled !== undefined) GOOGLE_ENABLED = d.googleEnabled
}

async function loadBudget() {
  try {
    mergeBudget(await apiJSON('/api/admin/ai/budget'))
    renderBudget()
    renderModels()   // google enable/disable can change on refresh
    updateEstimate()
  } catch (err) {
    showAlert(`Не удалось загрузить бюджет: ${err.message}`)
  }
}

// ─── Model checkboxes ─────────────────────────────────────────────────────────

/* Accepting `seed` and honouring it are different things, and the difference
   decides whether a re-run is comparable or a coin flip. Verified per model. */
function seedNote(deterministic) {
  if (deterministic === true) return ' · <span class="seed-ok">seed воспроизводим</span>'
  if (deterministic === false) return ' · <span class="seed-no">seed игнорируется</span>'
  return ' · <span class="seed-unknown">seed не проверен</span>'
}

/** Per-image price string — neurons for Workers AI, dollars for Google. */
function priceNote(m) {
  return m.provider === 'google'
    ? `${usd(m.estUsd)} / изобр. <span class="paid">· платно</span>`
    : `~${nf(m.estNeurons)} нейронов / изобр.`
}

function modelDisabled(m) {
  return m.provider === 'google' && !GOOGLE_ENABLED
}

function renderModels() {
  el('models').innerHTML = REGISTRY.map((m) => {
    const disabled = modelDisabled(m)
    const badges =
      (m.provider === 'google' ? ' <span class="prov prov-google">Google</span>' : '') +
      (!m.verified ? ' <span class="unverified">не проверено</span>' : '')
    const keyHint = disabled ? ' <span class="seed-no">· нужен ключ GEMINI_API_KEY</span>' : ''
    return `
    <label class="model-opt${disabled ? ' opt-disabled' : ''}">
      <input type="checkbox" value="${esc(m.id)}"
             data-cost="${m.estNeurons}" data-usd="${m.estUsd}"
             data-max="${m.maxCount}" data-provider="${esc(m.provider)}"
             ${disabled ? 'disabled' : ''} />
      <span class="model-opt-body">
        <span class="model-name">${esc(m.label)}${badges}</span>
        <span class="model-id">${esc(m.id)}</span>
        <span class="model-cost">${priceNote(m)}${
          m.maxCount === 1 ? ' <span class="cap">· макс. 1 за прогон</span>' : ''
        }${seedNote(m.seedDeterministic)}${keyHint}</span>
      </span>
    </label>`
  }).join('')

  el('models').querySelectorAll('input').forEach((cb) =>
    cb.addEventListener('change', updateEstimate))
}

function selectedModels() {
  return Array.from(el('models').querySelectorAll('input:checked'))
}

/** Per-model effective count — the slow/paid models are capped low. */
function effectiveCount(cb, requested) {
  return Math.min(requested, parseInt(cb.dataset.max, 10) || 1)
}

function updateEstimate() {
  const requested = parseInt(el('count').value, 10)
  const chosen = selectedModels()

  let neurons = 0, usdCost = 0, images = 0, anyGoogle = false
  for (const cb of chosen) {
    const c = effectiveCount(cb, requested)
    neurons += (parseInt(cb.dataset.cost, 10) || 0) * c
    usdCost += (parseFloat(cb.dataset.usd) || 0) * c
    images += c
    if (cb.dataset.provider === 'google') anyGoogle = true
  }

  const overRunN = neurons > MAX_PER_RUN
  const overRunUsd = usdCost > MAX_PER_RUN_USD
  const overDayN = neurons > BUDGET.remaining
  const overDayUsd = usdCost > BUDGET.remainingUsd
  const googleBlocked = anyGoogle && !GOOGLE_ENABLED

  const est = el('est')
  if (chosen.length === 0) {
    est.textContent = '—'
    est.classList.remove('over')
  } else {
    const parts = [`${images} изобр.`]
    if (neurons > 0) parts.push(`~${nf(neurons)} нейронов`)
    if (usdCost > 0) parts.push(usd(usdCost))
    let note = ''
    if (googleBlocked) note = ' — модели Google требуют ключ GEMINI_API_KEY'
    else if (overRunN) note = ` — превышает лимит нейронов за прогон (${nf(MAX_PER_RUN)})`
    else if (overRunUsd) note = ` — превышает лимит $ за прогон (${usd(MAX_PER_RUN_USD)})`
    else if (overDayN) note = ` — превышает остаток нейронов (${nf(BUDGET.remaining)})`
    else if (overDayUsd) note = ` — превышает остаток $ (${usd(BUDGET.remainingUsd)})`
    est.textContent = parts.join(' · ') + note
    est.classList.toggle('over', overRunN || overRunUsd || overDayN || overDayUsd || googleBlocked)
  }
  // Only hard limits disable the button; daily-over is warned but left to the
  // server (usage may have reset between page load and click).
  el('btn-generate').disabled = chosen.length === 0 || overRunN || overRunUsd || googleBlocked

  const capped = chosen.filter((cb) => effectiveCount(cb, requested) < requested)
  el('count-hint').textContent = capped.length
    ? `Ограничено до ${capped.map((cb) => effectiveCount(cb, requested)).join('/')} для: ` +
      capped.map((cb) => REGISTRY.find((m) => m.id === cb.value)?.label ?? cb.value).join(', ') +
      ' — эти модели медленные/платные, пакет ограничен.'
    : ''
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

function showAlert(msg, kind = 'danger') {
  const a = el('alert')
  a.className = `alert alert-${kind}`
  a.textContent = msg
}

function clearAlert() {
  el('alert').className = 'alert alert-danger hidden'
}

// ─── Result tiles ─────────────────────────────────────────────────────────────

/** Fetch an admin-protected image with the cookie and return a blob URL. */
async function fetchImage(url) {
  const r = await apiFetch(url)
  if (!r.ok) {
    let detail = `HTTP ${r.status}`
    try {
      const j = await r.json()
      if (j && j.error) detail = j.error
    } catch { /* not JSON — keep the status */ }
    throw new Error(detail)
  }
  const u = URL.createObjectURL(await r.blob())
  blobUrls.push(u)
  return u
}

/** Per-image cost string for a result tile. */
function tileCost(res) {
  return res.provider === 'google' ? usd(res.estUsd) : `~${nf(res.estNeurons)} нейронов`
}

function tileMarkup(res) {
  const facts = res.ok
    ? `${tileCost(res)} · ${res.mime.replace('image/', '')} · ${Math.round(res.bytes / 1024)} КБ · ${(res.ms / 1000).toFixed(1)} с` +
      (res.seed !== null && res.seed !== undefined ? ` · seed ${res.seed}` : '')
    : `${tileCost(res)} · ошибка`

  const prov = res.provider === 'google' ? ' <span class="prov prov-google">Google</span>' : ''

  return `
    <div class="tile" data-model="${esc(res.model)}" data-index="${res.index}">
      <div class="tile-img-wrap bd-checker">
        <div class="tile-status">${res.ok ? 'Загрузка…' : ''}</div>
      </div>
      <div class="tile-body">
        <div class="tile-name">${esc(res.label)}${prov} <span style="color:var(--text-dim)">#${res.index + 1}</span></div>
        <div class="tile-facts">${esc(facts)}</div>
        <div class="tile-toggles">
          <button class="chip chip-view active" data-view="raw"${res.ok ? '' : ' disabled'}>Оригинал</button>
          <button class="chip chip-view" data-view="cutout"${res.ok ? '' : ' disabled'}>Без фона</button>
          <button class="chip chip-bd" data-bd="checker">Шахматка</button>
          <button class="chip chip-bd active" data-bd="black">Чёрный</button>
          <button class="chip chip-bd" data-bd="white">Белый</button>
        </div>
      </div>
    </div>`
}

function wireTile(tile, res) {
  const wrap = tile.querySelector('.tile-img-wrap')
  const status = tile.querySelector('.tile-status')

  // Default to black: edge fringing from a cutout is only visible against it.
  wrap.classList.remove('bd-checker')
  wrap.classList.add('bd-black')

  if (!res.ok) {
    status.className = 'tile-status err'
    status.textContent = res.error
    return
  }

  const cache = {}
  let view = 'raw'

  async function show(which) {
    view = which
    tile.querySelectorAll('.chip-view').forEach((b) =>
      b.classList.toggle('active', b.dataset.view === which))

    if (!cache[which]) {
      status.className = 'tile-status'
      status.textContent = which === 'cutout' ? 'Удаление фона…' : 'Загрузка…'
      status.classList.remove('hidden')
      try {
        cache[which] = await fetchImage(which === 'cutout' ? res.cutoutUrl : res.url)
      } catch (err) {
        status.className = 'tile-status err'
        status.textContent = err.message
        return
      }
    }
    if (view !== which) return // a newer toggle won the race

    let img = tile.querySelector('.tile-img')
    if (!img) {
      img = document.createElement('img')
      img.className = 'tile-img'
      img.alt = res.label
      wrap.appendChild(img)
    }
    img.src = cache[which]
    status.className = 'tile-status hidden'
  }

  tile.querySelectorAll('.chip-view').forEach((btn) =>
    btn.addEventListener('click', () => show(btn.dataset.view)))

  tile.querySelectorAll('.chip-bd').forEach((btn) =>
    btn.addEventListener('click', () => {
      wrap.classList.remove('bd-checker', 'bd-black', 'bd-white')
      wrap.classList.add(`bd-${btn.dataset.bd}`)
      tile.querySelectorAll('.chip-bd').forEach((b) => b.classList.toggle('active', b === btn))
    }))

  show('raw')
}

function renderResults(data) {
  el('empty').classList.add('hidden')
  el('results-section').classList.remove('hidden')

  const okCount = data.results.filter((r) => r.ok).length
  const cost = []
  if (data.estNeurons > 0) cost.push(`~${nf(data.estNeurons)} нейронов`)
  if (data.estUsd > 0) cost.push(usd(data.estUsd))
  el('run-meta').textContent =
    `run ${data.runId.slice(0, 8)} · ${okCount}/${data.results.length} изобр.` +
    (cost.length ? ` · ${cost.join(' · ')}` : '') +
    (data.seed !== null && data.seed !== undefined ? ` · seed ${data.seed}` : '')

  const grid = el('grid')
  grid.innerHTML = data.results.map(tileMarkup).join('')
  Array.from(grid.children).forEach((tile, i) => wireTile(tile, data.results[i]))
}

// ─── Generate ─────────────────────────────────────────────────────────────────

async function generate() {
  const prompt = el('prompt').value.trim()
  if (!prompt) { showAlert('Введите промпт.'); return }

  const models = selectedModels().map((cb) => cb.value)
  if (models.length === 0) { showAlert('Выберите хотя бы одну модель.'); return }

  const seedRaw = el('seed').value.trim()
  const body = { prompt, models, count: parseInt(el('count').value, 10) }
  if (seedRaw !== '') body.seed = parseInt(seedRaw, 10)

  clearAlert()
  const btn = el('btn-generate')
  btn.disabled = true
  btn.textContent = 'Генерация…'

  blobUrls.forEach(URL.revokeObjectURL)
  blobUrls = []

  try {
    const res = await apiFetch('/api/admin/ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()

    if (!res.ok) {
      // 429 = a budget/limit refusal (yellow); everything else is an error (red).
      showAlert(data.error || `Ошибка ${res.status}`, res.status === 429 ? 'warn' : 'danger')
      // Refresh whatever budget numbers the refusal carried so the bars agree
      // with the server about what is left.
      mergeBudget(data)
      renderBudget()
      updateEstimate()
      return
    }

    mergeBudget(data)
    renderBudget()
    renderResults(data)

    const failed = data.results.filter((r) => !r.ok)
    if (failed.length) {
      showAlert(`${failed.length} из ${data.results.length} изображений не сгенерировались — подробности в плитках.`, 'warn')
    }
  } catch (err) {
    showAlert(`Сбой запроса: ${err.message}`)
  } finally {
    btn.textContent = 'Сгенерировать'
    updateEstimate()   // restores the disabled state per the current selection
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const me = await checkAuth()
  if (!me) { window.location.href = 'login.html'; return }

  try {
    const data = await apiJSON('/api/admin/ai/models')
    REGISTRY = data.models
    mergeBudget(data)
    renderModels()
  } catch (err) {
    showAlert(`Не удалось загрузить список моделей: ${err.message}`)
  }

  await loadBudget()

  el('count').addEventListener('change', updateEstimate)
  el('btn-generate').addEventListener('click', generate)
  el('btn-refresh-budget').addEventListener('click', loadBudget)
  updateEstimate()
})
})()
