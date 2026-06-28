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
