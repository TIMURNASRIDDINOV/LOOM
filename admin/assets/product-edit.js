'use strict'

const { API_BASE, apiJSON, checkAuth } = window.LOOM

// ── State ─────────────────────────────────────────────────────────────────────
let editId = null
let baseColors = []

// ── Colors UI ─────────────────────────────────────────────────────────────────

function renderColors() {
  const list = document.getElementById('colors-list')
  if (!baseColors.length) {
    list.innerHTML = '<span style="font-size:0.78rem;color:rgba(255,255,255,0.25)">Нет цветов</span>'
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

// ── Load existing product (edit mode) ─────────────────────────────────────────

async function loadProduct(id) {
  const p = await apiJSON(`/api/admin/products/${id}`)

  document.getElementById('page-title').textContent = `Редактировать: ${p.slug}`
  document.getElementById('f-slug').value = p.slug
  document.getElementById('f-price').value = p.price
  document.getElementById('f-name-ru').value = p.name_ru || ''
  document.getElementById('f-name-en').value = p.name_en || ''
  document.getElementById('f-desc').value = p.description_ru || ''
  document.getElementById('f-order').value = p.display_order ?? 0
  document.getElementById('f-active').checked = !!p.active

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
  fd.append('name_en', document.getElementById('f-name-en').value.trim())
  fd.append('description_ru', document.getElementById('f-desc').value.trim())
  fd.append('price', document.getElementById('f-price').value)
  fd.append('display_order', document.getElementById('f-order').value || '0')
  fd.append('active', document.getElementById('f-active').checked ? '1' : '0')
  fd.append('base_colors', JSON.stringify(baseColors))

  const glbFile = document.getElementById('f-glb').files[0]
  const thumbFile = document.getElementById('f-thumbnail').files[0]

  if (!editId && !glbFile) {
    errEl.textContent = 'GLB файл обязателен для нового продукта'
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

    const product = await submitWithXHR(url, method, fd)
    okEl.textContent = editId ? 'Сохранено!' : `Продукт создан (id: ${product.id})`

    if (!editId) {
      // Switch to edit mode after creation
      editId = product.id
      history.replaceState(null, '', `?id=${editId}`)
      document.getElementById('page-title').textContent = `Редактировать: ${product.slug}`
      const glbEl = document.getElementById('glb-current')
      glbEl.textContent = 'Текущий файл: ' + (product.glb_key || '')
      glbEl.style.display = 'block'
    }
  } catch (err) {
    errEl.textContent = err.message || 'Ошибка сохранения'
  } finally {
    btn.disabled = false
    btn.textContent = 'Сохранить'
  }
})

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const admin = await checkAuth()
  if (!admin) { window.location.href = 'login.html'; return }

  window.LOOM_LAYOUT.setEmail(admin.email)

  renderColors()

  editId = new URLSearchParams(window.location.search).get('id')
  if (editId) {
    try {
      await loadProduct(editId)
    } catch (e) {
      document.getElementById('form-error').textContent = 'Ошибка загрузки продукта: ' + e.message
    }
  }
})
