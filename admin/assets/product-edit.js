'use strict'

// Wrapped in an IIFE so this file's top-level declarations stay function-scoped.
// Without it, `const API_BASE` below collides with the global `const API_BASE`
// declared in app.js (both are classic scripts sharing the page's global scope),
// throwing "Identifier 'API_BASE' has already been declared". That SyntaxError
// aborts the ENTIRE file, so the product-form submit handler is never attached
// and clicking "Сохранить" just does a native form submit — i.e. adding a
// product silently does nothing. Scope isolation is the standard back-office fix.
;(function () {
const { API_BASE, apiJSON } = window.LOOM

// ── State ─────────────────────────────────────────────────────────────────────
let editId = null
let baseColors = []
let canEdit = true
// Set false when a loaded product has no config columns (API before migration
// 0022): the card stays locked and nothing config-related is sent, so saves
// still work against the old API.
let hasConfig = true

// ── Colors UI ─────────────────────────────────────────────────────────────────

function renderColors() {
  const list = document.getElementById('colors-list')
  if (!baseColors.length) {
    list.innerHTML = '<span style="font-size:0.78rem;color:var(--text-dim)">Нет цветов</span>'
    return
  }
  list.innerHTML = baseColors.map((c, i) => `
    <div class="color-chip">
      <span class="color-swatch" style="background:${c}"></span>
      ${c}
      <button type="button" class="color-remove" data-index="${i}" aria-label="Удалить цвет">×</button>
    </div>
  `).join('')
  list.querySelectorAll('.color-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      baseColors.splice(parseInt(btn.dataset.index), 1)
      renderColors()
    })
  })
}

document.getElementById('btn-add-color').addEventListener('click', () => {
  const color = document.getElementById('color-picker').value.toLowerCase()
  if (!baseColors.includes(color)) {
    baseColors.push(color)
    renderColors()
  }
})

// ── Configurator config (LOOM-165) ────────────────────────────────────────────
// Mirrors the server checks in backend/src/routes/admin-products.ts so the
// founder sees the problem before saving; the server re-validates anyway.

const HEX_RE = /^#[0-9A-Fa-f]{6}$/
const SIZE_RE = /^[A-Za-z0-9]{1,8}$/
const ART_KEY_RE = /^[A-Za-z0-9_-][A-Za-z0-9._/-]{0,199}$/
const COLOR_NAME_FIELDS = [['name_ru', 'RU'], ['name_uz', 'UZ'], ['name_en', 'EN']]

function addConfigColorRow(c = { hex: '#FFFFFF', name_uz: '', name_ru: '', name_en: '', available: true }) {
  const row = document.createElement('div')
  row.className = 'cfg-color-row'
  const picker = Object.assign(document.createElement('input'), { type: 'color', className: 'color-picker', value: c.hex.toLowerCase() })
  picker.setAttribute('aria-label', 'Цвет')
  const hex = Object.assign(document.createElement('input'), { className: 'form-input cfg-hex', value: c.hex, maxLength: 7 })
  hex.setAttribute('aria-label', 'HEX')
  picker.addEventListener('input', () => { hex.value = picker.value.toUpperCase(); hex.classList.remove('is-invalid') })
  hex.addEventListener('input', () => {
    const ok = HEX_RE.test(hex.value.trim())
    hex.classList.toggle('is-invalid', !ok)
    if (ok) picker.value = hex.value.trim().toLowerCase()
  })
  row.append(picker, hex)
  for (const [key, lang] of COLOR_NAME_FIELDS) {
    const name = Object.assign(document.createElement('input'), { className: 'form-input cfg-name', value: c[key] || '', placeholder: lang, maxLength: 60 })
    name.dataset.key = key
    name.setAttribute('aria-label', `Название (${lang})`)
    row.append(name)
  }
  const avail = document.createElement('label')
  avail.className = 'cfg-avail'
  const box = Object.assign(document.createElement('input'), { type: 'checkbox', className: 'cfg-available', checked: c.available !== false })
  avail.append(box, ' В наличии')
  const remove = Object.assign(document.createElement('button'), { type: 'button', className: 'color-remove', textContent: '×' })
  remove.setAttribute('aria-label', 'Удалить цвет')
  remove.addEventListener('click', () => row.remove())
  row.append(avail, remove)
  document.getElementById('cfg-colors').append(row)
}

document.getElementById('btn-add-cfg-color').addEventListener('click', () => addConfigColorRow())

function fillConfig(p) {
  hasConfig = typeof p.sizes_json === 'string'
  const parse = (s, fallback) => { try { return JSON.parse(s) ?? fallback } catch { return fallback } }
  document.getElementById('f-sizes').value = parse(p.sizes_json, []).join(', ')
  document.getElementById('cfg-colors').replaceChildren()
  parse(p.colors_json, []).forEach(addConfigColorRow)
  const pa = parse(p.print_area_json, {})
  document.getElementById('f-platen-w').value = pa.platen_cm?.w ?? ''
  document.getElementById('f-platen-h').value = pa.platen_cm?.h ?? ''
  document.getElementById('f-width-frac').value = pa.width_frac ?? ''
  document.getElementById('f-top-frac').value = pa.top_frac ?? ''
  document.getElementById('f-panel-w').value = pa.platen_cm?.w && pa.width_frac ? +(pa.platen_cm.w / pa.width_frac).toFixed(1) : ''
  const art = parse(p.flat_art_json, {})
  document.getElementById('f-art-front').value = art.front?.src || ''
  document.getElementById('f-art-front-small').value = art.front?.src_small || ''
  document.getElementById('f-art-back').value = art.back?.src || ''
  document.getElementById('f-art-back-small').value = art.back?.src_small || ''
}

/** Reads the config card into JSON strings, or throws an Error with a readable message. */
function collectConfig() {
  const sizes = document.getElementById('f-sizes').value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
  if (!sizes.length) throw new Error('Укажите хотя бы один размер')
  const badSize = sizes.find((s) => !SIZE_RE.test(s))
  if (badSize) throw new Error(`Неверный размер «${badSize}»: только буквы и цифры, до 8 символов`)
  if (new Set(sizes).size !== sizes.length) throw new Error('Размеры повторяются')

  const colors = [...document.querySelectorAll('#cfg-colors .cfg-color-row')].map((row) => {
    const hex = row.querySelector('.cfg-hex').value.trim().toUpperCase()
    if (!HEX_RE.test(hex)) throw new Error(`Неверный HEX «${hex}»: нужен формат #RRGGBB`)
    const c = { hex, available: row.querySelector('.cfg-available').checked }
    row.querySelectorAll('.cfg-name').forEach((n) => {
      c[n.dataset.key] = n.value.trim()
      if (!c[n.dataset.key]) throw new Error(`У цвета ${hex} не заполнено название (${n.placeholder})`)
    })
    return c
  })
  if (!colors.length) throw new Error('Добавьте хотя бы один цвет')
  if (new Set(colors.map((c) => c.hex)).size !== colors.length) throw new Error('Цвета повторяются')
  if (!colors.some((c) => c.available)) throw new Error('Хотя бы один цвет должен быть в наличии')

  const num = (id) => { const v = document.getElementById(id).value.trim(); return v === '' ? NaN : Number(v) }
  const w = num('f-platen-w'), h = num('f-platen-h'), widthFrac = num('f-width-frac'), topFrac = num('f-top-frac')
  if (!(w > 0 && w <= 100 && h > 0 && h <= 100)) throw new Error('Размер платена: числа от 0 до 100 см')
  if (!(widthFrac > 0 && widthFrac <= 1)) throw new Error('Доля ширины должна быть больше 0 и не больше 1')
  if (!(topFrac >= 0 && topFrac <= 1)) throw new Error('Отступ сверху должен быть от 0 до 1')

  const art = {}
  for (const [face, id] of [['front', 'f-art-front'], ['back', 'f-art-back']]) {
    const src = document.getElementById(id).value.trim()
    const small = document.getElementById(id + '-small').value.trim()
    for (const k of [src, small]) {
      if (!ART_KEY_RE.test(k) || k.includes('..')) throw new Error(`Неверный путь к картинке «${k}»`)
    }
    art[face] = { src, src_small: small }
  }

  return {
    sizes_json: JSON.stringify(sizes),
    colors_json: JSON.stringify(colors),
    print_area_json: JSON.stringify({ platen_cm: { w, h }, width_frac: widthFrac, top_frac: topFrac }),
    flat_art_json: JSON.stringify(art),
  }
}

// Panel-width helper: width_frac = platen width / front panel width.
function syncWidthFrac() {
  const w = Number(document.getElementById('f-platen-w').value)
  const panel = Number(document.getElementById('f-panel-w').value)
  if (w > 0 && panel > 0) document.getElementById('f-width-frac').value = +(w / panel).toFixed(3)
}
document.getElementById('f-panel-w').addEventListener('input', syncWidthFrac)
document.getElementById('f-platen-w').addEventListener('input', syncWidthFrac)

// New products take the DB defaults (today's T-shirt config); edit after saving.
function syncConfigMode() {
  const oldApi = !!editId && !hasConfig
  document.getElementById('cfg-new-note').style.display = editId ? 'none' : ''
  document.getElementById('cfg-old-api-note').style.display = oldApi ? '' : 'none'
  document.getElementById('cfg-fields').disabled = !editId || !canEdit || oldApi
  for (const id of ['f-desc-uz', 'f-desc-en']) document.getElementById(id).disabled = !canEdit || oldApi
}

// ── Thumbnail preview ─────────────────────────────────────────────────────────

document.getElementById('f-thumbnail').addEventListener('change', (e) => {
  const file = e.target.files[0]
  if (!file) return
  const preview = document.getElementById('thumb-preview')
  preview.src = URL.createObjectURL(file)
  preview.style.display = 'block'
})

// ── Drag-and-drop for upload zones ────────────────────────────────────────────

for (const zoneId of ['glb-zone', 'thumb-zone']) {
  const zone = document.getElementById(zoneId)
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over') })
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'))
  zone.addEventListener('drop', (e) => {
    e.preventDefault()
    zone.classList.remove('drag-over')
    const inputId = zoneId === 'glb-zone' ? 'f-glb' : 'f-thumbnail'
    const input = document.getElementById(inputId)
    if (e.dataTransfer.files.length) {
      const dt = new DataTransfer()
      dt.items.add(e.dataTransfer.files[0])
      input.files = dt.files
      input.dispatchEvent(new Event('change'))
    }
  })
}

document.getElementById('f-glb').addEventListener('change', (e) => {
  const file = e.target.files[0]
  document.getElementById('glb-filename').textContent = file ? file.name : ''
})

// GLB is optional for ready-made designs — surface that in the form
function syncGlbNote() {
  const isReady = document.getElementById('f-type').value === 'ready'
  document.getElementById('glb-optional-note').style.display = isReady ? '' : 'none'
}
document.getElementById('f-type').addEventListener('change', syncGlbNote)

// ── Load existing product (edit mode) ─────────────────────────────────────────

async function loadProduct(id) {
  const p = await apiJSON(`/api/admin/products/${id}`)

  document.getElementById('page-title').textContent = p.name_ru || p.slug
  window.LOOM_LAYOUT.setTitle(p.name_ru || p.slug)
  document.getElementById('f-slug').value = p.slug
  document.getElementById('f-price').value = p.price
  document.getElementById('f-name-ru').value = p.name_ru || ''
  document.getElementById('f-name-uz').value = p.name_uz || ''
  document.getElementById('f-name-en').value = p.name_en || ''
  document.getElementById('f-desc').value = p.description_ru || ''
  document.getElementById('f-desc-uz').value = p.description_uz || ''
  document.getElementById('f-desc-en').value = p.description_en || ''
  fillConfig(p)
  document.getElementById('f-order').value = p.display_order ?? 0
  document.getElementById('f-active').checked = !!p.active
  document.getElementById('f-type').value = p.product_type === 'ready' ? 'ready' : 'custom'
  syncGlbNote()

  if (p.base_colors) {
    try { baseColors = JSON.parse(p.base_colors) } catch { baseColors = [] }
  }
  renderColors()

  if (p.glb_key) {
    const el = document.getElementById('glb-current')
    el.textContent = 'Текущий файл: ' + p.glb_key
    el.style.display = 'block'
  }
  if (p.thumbnail_url) {
    const el = document.getElementById('thumb-current')
    el.textContent = 'Текущее изображение: ' + (p.thumbnail_key || '')
    el.style.display = 'block'
    const preview = document.getElementById('thumb-preview')
    preview.src = p.thumbnail_url
    preview.style.display = 'block'
  }
}

// ── XHR submit with progress ──────────────────────────────────────────────────

function submitWithXHR(url, method, formData) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()

    const progressWrap = document.getElementById('glb-progress-wrap')
    const progressBar = document.getElementById('glb-progress-bar')
    const progressText = document.getElementById('glb-progress-text')

    xhr.upload.addEventListener('progress', (e) => {
      if (!e.lengthComputable) return
      const pct = Math.round((e.loaded / e.total) * 100)
      progressWrap.style.display = 'block'
      progressText.style.display = 'block'
      progressBar.style.width = pct + '%'
      progressText.textContent = `Загрузка: ${pct}%`
    })

    xhr.addEventListener('load', () => {
      progressWrap.style.display = 'none'
      progressText.style.display = 'none'
      progressBar.style.width = '0%'

      let data
      try { data = JSON.parse(xhr.responseText) } catch { data = {} }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data)
      } else {
        reject(new Error(data.error || `HTTP ${xhr.status}`))
      }
    })

    xhr.addEventListener('error', () => reject(new Error('Network error')))
    xhr.open(method, url)
    xhr.withCredentials = true
    xhr.send(formData)
  })
}

// ── Form submit ───────────────────────────────────────────────────────────────

document.getElementById('product-form').addEventListener('submit', async (e) => {
  e.preventDefault()

  const btn = document.getElementById('btn-submit')
  const errEl = document.getElementById('form-error')
  const okEl = document.getElementById('form-success')
  errEl.textContent = ''
  okEl.textContent = ''
  btn.disabled = true
  btn.textContent = 'Сохраняю…'

  const fd = new FormData()
  fd.append('slug', document.getElementById('f-slug').value.trim())
  fd.append('name_ru', document.getElementById('f-name-ru').value.trim())
  fd.append('name_uz', document.getElementById('f-name-uz').value.trim())
  fd.append('name_en', document.getElementById('f-name-en').value.trim())
  fd.append('description_ru', document.getElementById('f-desc').value.trim())
  fd.append('price', document.getElementById('f-price').value)
  fd.append('display_order', document.getElementById('f-order').value || '0')
  fd.append('active', document.getElementById('f-active').checked ? '1' : '0')
  fd.append('product_type', document.getElementById('f-type').value)
  fd.append('base_colors', JSON.stringify(baseColors))
  if (!editId || hasConfig) {
    fd.append('description_uz', document.getElementById('f-desc-uz').value.trim())
    fd.append('description_en', document.getElementById('f-desc-en').value.trim())
  }
  if (editId && hasConfig) {
    try {
      for (const [k, v] of Object.entries(collectConfig())) fd.append(k, v)
    } catch (err) {
      errEl.textContent = err.message
      btn.disabled = false
      btn.textContent = 'Сохранить'
      return
    }
  }

  const glbFile = document.getElementById('f-glb').files[0]
  const thumbFile = document.getElementById('f-thumbnail').files[0]

  // Ready-made designs never open the 3D scene — GLB optional for them
  if (!editId && !glbFile && document.getElementById('f-type').value !== 'ready') {
    errEl.textContent = 'GLB файл обязателен для кастомизируемого продукта'
    btn.disabled = false
    btn.textContent = 'Сохранить'
    return
  }

  if (glbFile) fd.append('glb', glbFile)
  if (thumbFile) fd.append('thumbnail', thumbFile)

  try {
    const url = editId
      ? `${API_BASE}/api/admin/products/${editId}`
      : `${API_BASE}/api/admin/products`
    const method = editId ? 'PATCH' : 'POST'

    const resp = await submitWithXHR(url, method, fd)

    // Handle both old shape (direct product object) and new shape ({ ok, product })
    const product = resp.ok === true ? resp.product : (resp.id ? resp : null)

    if (!product) {
      // ok: false from new API shape
      const err = resp.error
      if (err && err.field) {
        errEl.textContent = `${err.field}: ${err.message}`
      } else {
        errEl.textContent = (err && err.message) || resp.error || 'Ошибка сохранения'
      }
      return
    }

    okEl.textContent = editId ? 'Сохранено!' : `Продукт создан (id: ${product.id})`

    if (!editId) {
      // Switch to edit mode after creation
      editId = product.id
      history.replaceState(null, '', `?id=${editId}`)
      document.getElementById('page-title').textContent = product.name_ru || product.slug
      const glbEl = document.getElementById('glb-current')
      glbEl.textContent = 'Текущий файл: ' + (product.glb_key || '')
      glbEl.style.display = 'block'
      fillConfig(product)
      syncConfigMode()
    }
  } catch (err) {
    errEl.textContent = err.message || 'Ошибка сохранения'
  } finally {
    btn.disabled = false
    btn.textContent = 'Сохранить'
  }
})

// ── Init ──────────────────────────────────────────────────────────────────────

window.LOOM_LAYOUT.onReady(async (me, caps) => {
  // Without products.edit the form is readable but not submittable — the save
  // button is already gone (data-cap), so lock the inputs to match.
  canEdit = caps.has('products.edit')
  if (!canEdit) {
    document.querySelectorAll('#product-form input, #product-form textarea, #product-form select, #product-form button')
      .forEach((node) => { node.disabled = true })
  }

  renderColors()

  editId = new URLSearchParams(window.location.search).get('id')
  syncConfigMode()
  if (editId) {
    try {
      await loadProduct(editId)
      syncConfigMode()
    } catch (e) {
      window.LOOM_UI.toast('Не удалось загрузить товар: ' + e.message, 'error')
    }
  }
})
})()
