'use strict'

/* LOOM Admin — Workers AI model comparison harness.
   A spike: the job of this page is to make models comparable (same prompt,
   same seed, same backdrop) so we can decide which one LOOM ships with.

   Images come from admin-gated endpoints, and the admin panel is on a
   different origin than the API, so <img src> would not carry the cookie.
   Everything is fetched with credentials and shown as a blob URL — the same
   pattern order-detail.js uses for order proofs.

   Wrapped in an IIFE so this file's top-level declarations stay function-scoped.
   Without it, `const { apiFetch, ... }` below collides with the global
   `apiFetch` declared in app.js (both are classic scripts sharing the page's
   global scope), throwing "Identifier 'apiFetch' has already been declared".
   That SyntaxError aborts the ENTIRE file before a single line runs, so the
   page renders its empty shell and silently never loads models or budget.
   Same fix as product-edit.js. */

;(function () {
const { apiFetch, apiJSON, checkAuth } = window.LOOM

const el = (id) => document.getElementById(id)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const nf = (n) => new Intl.NumberFormat('ru-RU').format(n)

let REGISTRY = []
let CAP = 9000
let BUDGET = { usedToday: 0, remaining: 0, cap: 9000, resetsAt: null }
/** Blob URLs created for this run — revoked before the next run replaces them. */
let blobUrls = []

// ─── Budget ───────────────────────────────────────────────────────────────────

function renderBudget() {
  const { usedToday, remaining, cap, resetsAt } = BUDGET
  el('budget-value').innerHTML = `${nf(remaining)} <span class="dim">/ ${nf(cap)}</span>`

  const pctUsed = cap > 0 ? Math.min(100, (usedToday / cap) * 100) : 0
  const fill = el('budget-fill')
  fill.style.width = `${pctUsed}%`
  fill.className = 'budget-fill' + (pctUsed >= 90 ? ' danger' : pctUsed >= 60 ? ' warn' : '')

  const reset = resetsAt
    ? new Date(resetsAt).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', dateStyle: 'short', timeStyle: 'short' })
    : '—'
  el('budget-meta').textContent =
    `Потрачено ${nf(usedToday)} · сброс 00:00 UTC (${reset} по Ташкенту)`
}

async function loadBudget() {
  try {
    BUDGET = await apiJSON('/api/admin/ai/budget')
    CAP = BUDGET.cap
    renderBudget()
    updateEstimate()
  } catch (err) {
    showAlert(`Не удалось загрузить бюджет: ${err.message}`)
  }
}

// ─── Model checkboxes ─────────────────────────────────────────────────────────

/* Accepting `seed` and honouring it are different things, and the difference
   decides whether a re-run is comparable or a coin flip. Verified per model:
   the Leonardo models reproduce byte-identical images, the FLUX ones do not. */
function seedNote(deterministic) {
  if (deterministic === true) return ' · <span class="seed-ok">seed воспроизводим</span>'
  if (deterministic === false) return ' · <span class="seed-no">seed игнорируется</span>'
  return ' · <span class="seed-unknown">seed не проверен</span>'
}

function renderModels() {
  el('models').innerHTML = REGISTRY.map((m) => `
    <label class="model-opt">
      <input type="checkbox" value="${esc(m.id)}" data-cost="${m.estNeurons}" data-max="${m.maxCount}" />
      <span class="model-opt-body">
        <span class="model-name">${esc(m.label)}</span>
        <span class="model-id">${esc(m.id)}</span>
        <span class="model-cost">~${nf(m.estNeurons)} нейронов / изобр.${
          m.maxCount === 1 ? ' <span class="cap">· макс. 1 за прогон</span>' : ''
        }${seedNote(m.seedDeterministic)}</span>
      </span>
    </label>
  `).join('')

  el('models').querySelectorAll('input').forEach((cb) =>
    cb.addEventListener('change', updateEstimate))
}

function selectedModels() {
  return Array.from(el('models').querySelectorAll('input:checked'))
}

/** Per-model effective count — the slow Leonardo models are capped at 1. */
function effectiveCount(cb, requested) {
  return Math.min(requested, parseInt(cb.dataset.max, 10) || 1)
}

function updateEstimate() {
  const requested = parseInt(el('count').value, 10)
  const chosen = selectedModels()

  const cost = chosen.reduce(
    (sum, cb) => sum + parseInt(cb.dataset.cost, 10) * effectiveCount(cb, requested), 0)
  const images = chosen.reduce((n, cb) => n + effectiveCount(cb, requested), 0)

  const est = el('est')
  if (chosen.length === 0) {
    est.textContent = '—'
    est.classList.remove('over')
  } else {
    const over = cost > BUDGET.remaining
    est.textContent = `${images} изобр. · ~${nf(cost)} нейронов${over ? ` — превышает остаток (${nf(BUDGET.remaining)})` : ''}`
    est.classList.toggle('over', over)
  }
  el('btn-generate').disabled = chosen.length === 0

  // Explain any clamp rather than silently generating fewer images.
  const capped = chosen.filter((cb) => effectiveCount(cb, requested) < requested)
  el('count-hint').textContent = capped.length
    ? `Ограничено до ${capped.map((cb) => effectiveCount(cb, requested)).join('/')} для: ` +
      capped.map((cb) => REGISTRY.find((m) => m.id === cb.value)?.label ?? cb.value).join(', ') +
      ' — эти модели слишком медленные для пакета.'
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

function tileMarkup(res) {
  const facts = res.ok
    ? `~${nf(res.estNeurons)} нейронов · ${res.mime.replace('image/', '')} · ${Math.round(res.bytes / 1024)} КБ · ${(res.ms / 1000).toFixed(1)} с` +
      (res.seed !== null ? ` · seed ${res.seed}` : '')
    : `~${nf(res.estNeurons)} нейронов · ошибка`

  return `
    <div class="tile" data-model="${esc(res.model)}" data-index="${res.index}">
      <div class="tile-img-wrap bd-checker">
        <div class="tile-status">${res.ok ? 'Загрузка…' : ''}</div>
      </div>
      <div class="tile-body">
        <div class="tile-name">${esc(res.label)} <span style="color:var(--text-dim)">#${res.index + 1}</span></div>
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
  el('run-meta').textContent =
    `run ${data.runId.slice(0, 8)} · ${okCount}/${data.results.length} изобр. · ~${nf(data.estCost)} нейронов` +
    (data.seed !== null ? ` · seed ${data.seed}` : '')

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
      // 429 from the budget guard carries the numbers — show them, and refresh
      // the bar so the page agrees with the server about what is left.
      showAlert(data.error || `Ошибка ${res.status}`, res.status === 429 ? 'warn' : 'danger')
      if (data.usedToday !== undefined) {
        BUDGET = {
          usedToday: data.usedToday,
          remaining: data.remaining,
          cap: data.cap ?? CAP,
          resetsAt: data.resetsAt ?? null,
        }
        renderBudget()
        updateEstimate()
      }
      return
    }

    BUDGET = {
      usedToday: data.usedToday,
      remaining: data.remaining,
      cap: data.cap,
      resetsAt: data.resetsAt,
    }
    renderBudget()
    renderResults(data)

    const failed = data.results.filter((r) => !r.ok)
    if (failed.length) {
      showAlert(`${failed.length} из ${data.results.length} изображений не сгенерировались — подробности в плитках.`, 'warn')
    }
  } catch (err) {
    showAlert(`Сбой запроса: ${err.message}`)
  } finally {
    btn.disabled = false
    btn.textContent = 'Сгенерировать'
    updateEstimate()
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const me = await checkAuth()
  if (!me) { window.location.href = 'login.html'; return }

  try {
    const data = await apiJSON('/api/admin/ai/models')
    REGISTRY = data.models
    CAP = data.cap
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
