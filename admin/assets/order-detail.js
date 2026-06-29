'use strict'

function showError(msg) {
  document.getElementById('loading').style.display = 'none'
  const el = document.getElementById('error-msg')
  el.textContent = msg
  el.style.display = 'block'
}

function escHtml(s) {
  if (s == null) return ''
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

function parseDesign(json) {
  try { return JSON.parse(json) } catch { return {} }
}

function renderOrderItems(items, anchorCard) {
  const { apiFetch, formatPrice } = window.LOOM
  const card = document.createElement('div')
  card.className = 'card'
  card.innerHTML = `<p class="card-title">Позиции заказа (${items.length})</p>` +
    items.map((it, i) => {
      const d = parseDesign(it.design_json)
      const color = d.shirtColor || '—'
      const size = d.size || '—'
      const text = d.front?.text?.content || ''
      const font = d.front?.text?.font || ''
      const logoName = d.front?.image?.name || d.back?.image?.name || ''
      const meta = [
        `<span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:${escHtml(color)};border:1px solid var(--input-border);vertical-align:middle;margin-right:5px"></span>${escHtml(color)}`,
        escHtml(size),
        text ? `«${escHtml(text)}»${font ? ' (' + escHtml(font) + ')' : ''}` : '',
        logoName ? 'лого: ' + escHtml(logoName) : '',
      ].filter(Boolean).join(' · ')
      return `<div style="display:flex;gap:0.85rem;padding:0.75rem 0;border-bottom:0.5px solid var(--hairline2)">
        <div class="oi-thumb" data-logo="${escHtml(it.logoUrl || '')}" style="width:56px;height:56px;border-radius:6px;flex-shrink:0;background:var(--hover-bg);border:0.5px solid var(--hairline);display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:0.7rem;overflow:hidden">${i + 1}</div>
        <div style="flex:1;min-width:0;font-size:0.83rem">
          <div style="font-weight:500;color:var(--text)">${escHtml(it.product_name || 'Футболка')}${it.quantity > 1 ? ' ×' + it.quantity : ''}</div>
          <div style="color:var(--text-muted);margin-top:3px;line-height:1.5">${meta}</div>
        </div>
        <div style="font-family:var(--mono);font-size:0.82rem;white-space:nowrap">${formatPrice(it.unit_price * (it.quantity || 1))}</div>
      </div>`
    }).join('')
  if (anchorCard && anchorCard.parentNode) anchorCard.parentNode.insertBefore(card, anchorCard)
  else document.getElementById('detail-content')?.appendChild(card)
  // Lazy-load each item's logo thumbnail (admin media route needs the admin cookie)
  card.querySelectorAll('.oi-thumb[data-logo]').forEach(async (el) => {
    const url = el.getAttribute('data-logo')
    if (!url) return
    try {
      const r = await apiFetch(url)
      if (r.ok) {
        const u = URL.createObjectURL(await r.blob())
        el.innerHTML = `<img src="${u}" style="width:100%;height:100%;object-fit:cover" alt="">`
      }
    } catch { /* logo not critical */ }
  })
}

async function loadOrder(id) {
  const { apiFetch, apiJSON, statusBadge, formatPrice, formatDate, STATUS_LABELS } = window.LOOM

  document.getElementById('loading').style.display = 'block'
  document.getElementById('detail-content').style.display = 'none'
  const errEl = document.getElementById('error-msg')
  errEl.textContent = ''
  errEl.style.display = 'none'

  try {
    const res = await apiFetch(`/api/admin/orders/${id}`)
    if (res.status === 401) { window.location.href = 'login.html'; return }
    if (res.status === 404) { showError('Заказ не найден'); return }
    const o = await res.json()

    document.getElementById('loading').style.display = 'none'
    document.getElementById('detail-content').style.display = 'grid'
    document.title = `Заказ #${o.id} — LOOM Admin`

    // ── Left column ──────────────────────────────────────────────
    document.getElementById('order-id').textContent = `#${o.id}`
    document.getElementById('order-status-badge').innerHTML = statusBadge(o.status)
    document.getElementById('order-date').textContent = formatDate(o.created_at)

    document.getElementById('order-customer').textContent = o.customer_name
    document.getElementById('order-phone').textContent = o.customer_phone
    document.getElementById('order-address').textContent = o.address || '—'
    document.getElementById('order-coords').textContent = o.coordinates || '—'
    document.getElementById('order-comment').textContent = o.comment || '—'
    document.getElementById('order-price').textContent = formatPrice(o.total_price)

    // Design summary
    const design = parseDesign(o.design_json)
    const color = design.shirtColor || '—'
    const size = design.size || '—'
    const frontText = design.front?.text?.content || '—'
    const backText = design.back?.text?.content || '—'
    const fontName = design.front?.text?.font || '—'
    const logoName = design.front?.image?.name || design.back?.image?.name || '—'

    document.getElementById('design-color').innerHTML =
      `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${escHtml(color)};border:1px solid var(--input-border);vertical-align:middle;margin-right:6px"></span>${escHtml(color)}`
    document.getElementById('design-size').textContent = size
    document.getElementById('design-front-text').textContent = frontText
    document.getElementById('design-back-text').textContent = backText
    document.getElementById('design-font').textContent = fontName
    document.getElementById('design-logo').textContent = logoName

    // Raw JSON
    document.getElementById('design-json-raw').textContent =
      JSON.stringify(design, null, 2)

    // Multi-item orders (cart checkout): show line items, hide single-design cards
    if (o.items && o.items.length) {
      const designCard = document.getElementById('design-color')?.closest('.card')
      const jsonCard = document.getElementById('design-json-raw')?.closest('.card')
      if (designCard) designCard.style.display = 'none'
      if (jsonCard) jsonCard.style.display = 'none'
      renderOrderItems(o.items, designCard || jsonCard)
    }

    // ── Production review: 3D model, print artwork, spec, approval ──
    renderProductionSheet(o)
    setupApproval(o)

    // Logo preview
    if (o.logoUrl) {
      try {
        const imgRes = await apiFetch(o.logoUrl)
        if (imgRes.ok) {
          const blob = await imgRes.blob()
          const blobUrl = URL.createObjectURL(blob)
          const img = document.getElementById('logo-preview')
          img.src = blobUrl
          img.style.display = 'block'
        }
      } catch { /* logo not critical */ }
    }

    // ── Right column: status change ───────────────────────────────
    const statusSelect = document.getElementById('status-select')
    statusSelect.value = o.status

    document.getElementById('btn-update-status').addEventListener('click', async () => {
      const newStatus = statusSelect.value
      const note = document.getElementById('status-note').value.trim()
      const btn = document.getElementById('btn-update-status')
      btn.disabled = true
      btn.textContent = 'Обновляю…'
      try {
        await apiJSON(`/api/admin/orders/${id}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus, note: note || undefined }),
        })
        await loadOrder(id)  // reload to refresh log + badge
      } catch (e) {
        alert('Ошибка: ' + e.message)
        btn.disabled = false
        btn.textContent = 'Обновить статус'
      }
    })

    // ── Status log ────────────────────────────────────────────────
    const logEl = document.getElementById('status-log')
    if (!o.statusLog?.length) {
      logEl.innerHTML = '<p style="color:var(--text-dim);font-size:0.82rem">История пуста</p>'
    } else {
      logEl.innerHTML = o.statusLog.map(entry => `
        <div style="padding:0.6rem 0;border-bottom:1px solid var(--hairline2)">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem">
            <div>
              <span style="color:var(--text-muted);font-size:0.75rem">${entry.old_status ? escHtml(STATUS_LABELS[entry.old_status] || entry.old_status) + ' →' : ''}</span>
              ${statusBadge(entry.new_status)}
            </div>
            <span style="font-size:0.72rem;color:var(--text-dim);white-space:nowrap">${formatDate(entry.changed_at)}</span>
          </div>
          ${entry.note ? `<p style="margin:0.3rem 0 0;font-size:0.8rem;color:var(--text-secondary)">${escHtml(entry.note)}</p>` : ''}
        </div>
      `).join('')
    }
  } catch (e) {
    document.getElementById('loading').style.display = 'none'
    showError('Ошибка загрузки: ' + e.message)
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const { checkAuth } = window.LOOM
  const admin = await checkAuth()
  if (!admin) { window.location.href = 'login.html'; return }

  window.LOOM_LAYOUT.setEmail(admin.email)

  const id = new URLSearchParams(window.location.search).get('id')
  if (!id) { showError('ID не указан'); return }

  loadOrder(id)
})

// ════════════════════════════════════════════════════════════════════════════
// PRODUCTION SHEET — design proof / print review
// Mirrors the configurator's print geometry so what the admin sees == what prints.
// ════════════════════════════════════════════════════════════════════════════

const TEX_SIZE = 2048
const PRINT_AREA = { x: 560, y: 360, w: 928, h: 1120 } // texture px (matches configurator.js)
const PHYS_CM = { w: 30, h: 40 }                        // real-world print area (A3 DTG platen)

// Position of a texture-space coordinate relative to the print-area top-left.
function relPct(px, axis) {
  const origin = axis === 'x' ? PRINT_AREA.x : PRINT_AREA.y
  const span = axis === 'x' ? PRINT_AREA.w : PRINT_AREA.h
  return ((px - origin) / span) * 100
}
function relCm(px, axis) {
  return (relPct(px, axis) / 100) * (axis === 'x' ? PHYS_CM.w : PHYS_CM.h)
}

// Fetch an admin-protected media URL and return a blob URL (or null).
async function loadMedia(url) {
  if (!url) return null
  try {
    const r = await window.LOOM.apiFetch(url)
    if (r.ok) return URL.createObjectURL(await r.blob())
  } catch { /* media is non-critical */ }
  return null
}

function proofUrlsOf(row) {
  return {
    logoUrl: row.logoUrl, backLogoUrl: row.backLogoUrl,
    frontPrintUrl: row.frontPrintUrl, backPrintUrl: row.backPrintUrl,
    frontMockupUrl: row.frontMockupUrl, backMockupUrl: row.backMockupUrl,
    modelUrl: row.modelUrl,
  }
}

// Active 3D viewers' render loops, cancelled before a re-render (e.g. after approve).
let _viewerStops = []
function stopAllViewers() {
  _viewerStops.forEach((fn) => { try { fn() } catch {} })
  _viewerStops = []
}

async function renderProductionSheet(o) {
  const host = document.getElementById('production-sheet')
  if (!host) return
  stopAllViewers() // tear down any viewers from a previous render (e.g. after approve)
  host.innerHTML = '<p style="color:var(--text-dim);font-size:0.8rem">Загрузка макета…</p>'

  const designs = (o.items && o.items.length)
    ? o.items.map((it, i) => ({
        design: parseDesign(it.design_json),
        urls: proofUrlsOf(it),
        title: `${it.product_name || 'Изделие'} #${i + 1}${it.quantity > 1 ? ' ×' + it.quantity : ''}`,
        idLabel: `${o.id}-${i + 1}`,
      }))
    : [{ design: parseDesign(o.design_json), urls: proofUrlsOf(o), title: '', idLabel: String(o.id) }]

  host.innerHTML = ''
  for (const d of designs) {
    host.appendChild(await buildDesignBlock(d.design, d.urls, { title: d.title, idLabel: d.idLabel }))
  }
}

async function buildDesignBlock(design, urls, opts) {
  const el = document.createElement('div')
  el.className = 'ps-design'
  if (opts.title) {
    const h = document.createElement('p'); h.className = 'ps-design-title'; h.textContent = opts.title
    el.appendChild(h)
  }

  // ── Interactive 3D model (centerpiece) ──────────────────────────────────
  if (urls.modelUrl) {
    el.appendChild(buildModelViewer(urls.modelUrl, opts.idLabel || 'model'))
  }

  const [fMock, bMock, fPrint, bPrint, fLogo, bLogo] = await Promise.all([
    loadMedia(urls.frontMockupUrl), loadMedia(urls.backMockupUrl),
    loadMedia(urls.frontPrintUrl), loadMedia(urls.backPrintUrl),
    loadMedia(urls.logoUrl), loadMedia(urls.backLogoUrl),
  ])

  const views = document.createElement('div'); views.className = 'ps-views'
  views.appendChild(await buildView('front', design.front, fMock, fPrint, fLogo))
  views.appendChild(await buildView('back', design.back, bMock, bPrint, bLogo))
  el.appendChild(views)
  el.appendChild(buildSpecTable(design))
  return el
}

// Build the interactive 3D viewer card and kick off async model loading.
function buildModelViewer(modelUrl, idLabel) {
  const card = document.createElement('div'); card.className = 'ps-viewer-card'
  const head = document.createElement('div'); head.className = 'ps-viewer-head'
  head.innerHTML = `<p class="ps-viewer-title">3D-модель (как у клиента)</p>`
  const dl = document.createElement('a')
  dl.className = 'ps-dl'; dl.textContent = '⬇ Скачать .glb'; dl.href = '#'
  dl.style.opacity = '0.5'; dl.style.pointerEvents = 'none'
  head.appendChild(dl)
  card.appendChild(head)

  const box = document.createElement('div'); box.className = 'ps-viewer'
  box.innerHTML = `<div class="ps-viewer-loading">Загрузка 3D…</div><span class="ps-viewer-hint">тащите — повернуть · колесо — масштаб</span>`
  card.appendChild(box)

  mountModelViewer(box, modelUrl, dl, idLabel)
  return card
}

// Fetch the .glb (admin cookie), render it with OrbitControls, wire the download.
async function mountModelViewer(box, modelUrl, dlLink, idLabel) {
  if (typeof THREE === 'undefined' || !THREE.GLTFLoader) {
    box.querySelector('.ps-viewer-loading')?.replaceChildren(document.createTextNode('3D-просмотр недоступен'))
    return
  }
  let buf
  try {
    const r = await window.LOOM.apiFetch(modelUrl)
    if (!r.ok) throw new Error('fetch failed')
    buf = await r.arrayBuffer()
  } catch {
    box.querySelector('.ps-viewer-loading')?.replaceChildren(document.createTextNode('Не удалось загрузить модель'))
    return
  }

  // Wire the download from the bytes we already have.
  const blobUrl = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }))
  dlLink.href = blobUrl
  dlLink.download = `order-${idLabel}.glb`
  dlLink.style.opacity = ''
  dlLink.style.pointerEvents = ''

  const w = box.clientWidth || 400, h = box.clientHeight || 300
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, w / h, 0.01, 100)
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(w, h)
  if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding
  box.querySelector('.ps-viewer-loading')?.remove()
  box.insertBefore(renderer.domElement, box.firstChild)

  scene.add(new THREE.AmbientLight(0xffffff, 1.05))
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(2, 3, 4); scene.add(key)
  const fill = new THREE.DirectionalLight(0xffffff, 0.7); fill.position.set(-3, 1, -2); scene.add(fill)

  const controls = new THREE.OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true; controls.dampingFactor = 0.08
  controls.enablePan = false

  try {
    new THREE.GLTFLoader().parse(buf, '', (gltf) => {
      scene.add(gltf.scene)
      fitCameraToObject(gltf.scene, camera, controls, renderer)
    }, () => {
      box.innerHTML = '<div class="ps-viewer-loading">Ошибка разбора модели</div>'
    })
  } catch {
    box.innerHTML = '<div class="ps-viewer-loading">Ошибка разбора модели</div>'
    return
  }

  let raf = 0, alive = true
  const tick = () => { if (!alive) return; raf = requestAnimationFrame(tick); controls.update(); renderer.render(scene, camera) }
  tick()

  const onResize = () => {
    const nw = box.clientWidth, nh = box.clientHeight
    if (!nw || !nh) return
    camera.aspect = nw / nh; camera.updateProjectionMatrix(); renderer.setSize(nw, nh)
  }
  window.addEventListener('resize', onResize)

  // Register teardown so a re-render (after approve) doesn't leak WebGL contexts.
  _viewerStops.push(() => {
    alive = false; cancelAnimationFrame(raf)
    window.removeEventListener('resize', onResize)
    controls.dispose(); renderer.dispose()
    try { renderer.forceContextLoss() } catch {}
    URL.revokeObjectURL(blobUrl)
  })
}

// Frame the loaded model: center it and pull the camera back to fit its bounds.
function fitCameraToObject(obj, camera, controls, renderer) {
  const box = new THREE.Box3().setFromObject(obj)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z) || 1
  const fov = camera.fov * (Math.PI / 180)
  let dist = (maxDim / 2) / Math.tan(fov / 2)
  dist *= 1.4 // padding
  controls.target.copy(center)
  camera.position.set(center.x, center.y + size.y * 0.05, center.z + dist)
  camera.near = dist / 100; camera.far = dist * 100; camera.updateProjectionMatrix()
  controls.update()
  if (renderer) renderer.render(obj.parent || obj, camera)
}

async function buildView(name, vd, mockUrl, printUrl, logoUrl) {
  const col = document.createElement('div')
  const label = name === 'front' ? 'Перёд' : 'Спина'
  const hasContent = vd && ((vd.text && vd.text.content) || (vd.image && vd.image.name))
  col.innerHTML = `<p class="ps-view-h">${label}</p>`

  if (mockUrl) {
    col.insertAdjacentHTML('beforeend',
      `<figure class="ps-figure"><img class="ps-mockup" src="${mockUrl}" alt="Превью ${label}"><figcaption class="ps-figcap"><span>Превью (3D)</span></figcaption></figure>`)
  }

  const fig = document.createElement('figure'); fig.className = 'ps-figure'
  if (printUrl) {
    fig.innerHTML = `<div class="ps-print-wrap"><img src="${printUrl}" alt="Печать ${label}"></div>`
    const cap = document.createElement('figcaption'); cap.className = 'ps-figcap'
    cap.innerHTML = `<span>Печать · ${PHYS_CM.w} × ${PHYS_CM.h} см</span>`
    const dl = document.createElement('a')
    dl.className = 'ps-dl'; dl.href = printUrl; dl.download = `print-${name}.png`; dl.textContent = 'Скачать PNG'
    cap.appendChild(dl)
    fig.appendChild(cap)
  } else if (hasContent) {
    const wrap = document.createElement('div'); wrap.className = 'ps-print-wrap'
    const canvas = document.createElement('canvas'); wrap.appendChild(canvas)
    fig.appendChild(wrap)
    fig.insertAdjacentHTML('beforeend',
      `<figcaption class="ps-figcap"><span class="ps-recon-note">реконструкция (приблизительно)</span></figcaption>`)
    await drawReconstruction(canvas, vd, logoUrl)
  } else {
    fig.innerHTML = `<div class="ps-empty">Нет дизайна на этой стороне</div>`
  }
  col.appendChild(fig)
  return col
}

// Re-draw the print artwork from design_json for legacy orders that have no saved
// print master. Uses the SAME geometry as configurator.js _renderPrintCanvas.
async function drawReconstruction(canvas, vd, logoUrl) {
  const scale = 0.55 // 928×1120 → ~510×616 internal px (display-only)
  canvas.width = Math.round(PRINT_AREA.w * scale)
  canvas.height = Math.round(PRINT_AREA.h * scale)
  const ctx = canvas.getContext('2d')
  ctx.scale(scale, scale)
  ctx.translate(-PRINT_AREA.x, -PRINT_AREA.y)

  if (vd && vd.image && logoUrl) {
    await new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const natW = img.naturalWidth || img.width, natH = img.naturalHeight || img.height
        const factor = ((vd.image.scalePct || 100) / 100) * ((TEX_SIZE * 0.30) / Math.max(natW, natH))
        const dw = natW * factor, dh = natH * factor
        const x = vd.image.x ?? (PRINT_AREA.x + PRINT_AREA.w / 2)
        const y = vd.image.y ?? (PRINT_AREA.y + PRINT_AREA.h / 2)
        ctx.save(); ctx.translate(x, y); ctx.rotate(vd.image.rotation || 0)
        ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh); ctx.restore()
        resolve()
      }
      img.onerror = resolve
      img.src = logoUrl
    })
  }

  if (vd && vd.text && vd.text.content) {
    const size = vd.text.size || 160, font = vd.text.font || 'Arial'
    try { await document.fonts.load(`${size}px "${font}"`) } catch { /* fallback face */ }
    ctx.save()
    const weight = vd.text.bold ? 'bold' : 'normal'
    const style = vd.text.italic ? 'italic' : 'normal'
    ctx.font = `${style} ${weight} ${size}px "${font}"`
    ctx.fillStyle = vd.text.color || '#000'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    const x = vd.text.x ?? (PRINT_AREA.x + PRINT_AREA.w / 2)
    const y = vd.text.y ?? (PRINT_AREA.y + PRINT_AREA.h * 0.35)
    ctx.translate(x, y); ctx.rotate(vd.text.rotation || 0)
    ctx.fillText(vd.text.content, 0, 0)
    ctx.restore()
  }
}

function posStr(x, y, rot) {
  if (x == null || y == null) return 'не сохранено (старый заказ)'
  const r = rot ? ` · ${Math.round((rot * 180) / Math.PI)}°` : ''
  return `${relCm(x, 'x').toFixed(1)}×${relCm(y, 'y').toFixed(1)} см · ${relPct(x, 'x').toFixed(0)}%×${relPct(y, 'y').toFixed(0)}%${r}`
}

function buildSpecTable(d) {
  const wrap = document.createElement('div')
  const color = d.shirtColor || '—'
  const rows = [
    `<tr><td>Цвет</td><td colspan="2"><span class="ps-swatch" style="background:${escHtml(color)}"></span>${escHtml(color)}</td></tr>`,
    `<tr><td>Размер</td><td colspan="2">${escHtml(d.size || '—')}</td></tr>`,
  ]
  ;['front', 'back'].forEach((v) => {
    const vd = d[v]; if (!vd) return
    const label = v === 'front' ? 'Перёд' : 'Спина'
    if (vd.text && vd.text.content) {
      const t = vd.text
      const wstyle = [t.bold ? 'Bold' : '', t.italic ? 'Italic' : ''].filter(Boolean).join(' ') || 'Regular'
      rows.push(`<tr><td>${label} · текст</td><td colspan="2">«${escHtml(t.content)}»</td></tr>`)
      rows.push(`<tr><td></td><td>Шрифт</td><td>${escHtml(t.font || '—')} · ${wstyle} · ${t.size || '—'}px</td></tr>`)
      rows.push(`<tr><td></td><td>Цвет</td><td><span class="ps-swatch" style="background:${escHtml(t.color || '#000')}"></span>${escHtml(t.color || '—')}</td></tr>`)
      rows.push(`<tr><td></td><td>Позиция</td><td class="mono">${posStr(t.x, t.y, t.rotation)}</td></tr>`)
    }
    if (vd.image && vd.image.name) {
      const im = vd.image
      rows.push(`<tr><td>${label} · логотип</td><td colspan="2">${escHtml(im.name)}</td></tr>`)
      rows.push(`<tr><td></td><td>Масштаб</td><td>${im.scalePct ?? '—'}%</td></tr>`)
      rows.push(`<tr><td></td><td>Позиция</td><td class="mono">${posStr(im.x, im.y, im.rotation)}</td></tr>`)
    }
  })
  wrap.innerHTML = `<table class="ps-spec"><thead><tr><th>Параметр</th><th></th><th>Значение</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
  return wrap
}

// ── Approval (production gate) ──────────────────────────────────────────────
function setupApproval(o) {
  const stateEl = document.getElementById('approval-state')
  const btn = document.getElementById('btn-approve')
  if (!stateEl || !btn) return

  if (o.proof_approved_at) {
    const by = o.approvedBy ? ` · ${escHtml(o.approvedBy.email)}` : ''
    stateEl.innerHTML = `<span class="ps-approved">✓ Макет подтверждён</span>` +
      `<div style="color:var(--text-dim);font-size:0.74rem;margin-top:0.25rem">${escHtml(window.LOOM.formatDate(o.proof_approved_at))}${by}</div>`
    btn.textContent = 'Снять подтверждение'
    btn.dataset.approve = 'false'
  } else {
    stateEl.innerHTML = `<span class="ps-pending">● Ожидает подтверждения</span>`
    btn.textContent = 'Макет проверен — в производство'
    btn.dataset.approve = 'true'
  }

  btn.disabled = false
  btn.onclick = async () => {
    btn.disabled = true
    const wantApprove = btn.dataset.approve === 'true'
    try {
      await window.LOOM.apiJSON(`/api/admin/orders/${o.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: wantApprove }),
      })
      await loadOrder(o.id)
    } catch (e) {
      alert('Ошибка: ' + (e.message || 'не удалось обновить'))
      btn.disabled = false
    }
  }
}
