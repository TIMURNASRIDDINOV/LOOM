'use strict'

let currentPage = 1
const LIMIT = 50
let debounceTimer = null

function escHtml(s) {
  if (!s) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function loadProducts() {
  const { apiFetch, apiJSON, formatPrice } = window.LOOM

  const active = document.getElementById('filter-active').value
  const q = document.getElementById('filter-q').value.trim()

  const params = new URLSearchParams({ page: currentPage, limit: LIMIT })
  if (active !== '') params.set('active', active)
  if (q) params.set('q', q)

  const tbody = document.getElementById('products-tbody')
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:rgba(255,255,255,0.35)">Загрузка…</td></tr>'

  try {
    const data = await apiJSON('/api/admin/products?' + params)
    const { products, total, page, limit } = data

    const totalPages = Math.ceil(total / limit)
    document.getElementById('page-info').textContent = `Стр. ${page} из ${totalPages || 1} (всего ${total})`
    document.getElementById('btn-prev').disabled = page <= 1
    document.getElementById('btn-next').disabled = page >= totalPages

    if (!products.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:rgba(255,255,255,0.35)">Продуктов нет</td></tr>'
      return
    }

    tbody.innerHTML = products.map(p => {
      const thumb = p.thumbnail_url
        ? `<img src="${escHtml(p.thumbnail_url)}" class="thumb" alt="" loading="lazy" />`
        : `<div class="thumb-placeholder">GLB</div>`

      return `
        <tr>
          <td>${thumb}</td>
          <td style="font-family:var(--mono);font-size:0.8rem;color:rgba(255,255,255,0.6)">${escHtml(p.slug)}</td>
          <td>${escHtml(p.name_ru)}</td>
          <td style="font-family:var(--mono)">${formatPrice(p.price)}</td>
          <td>
            <label class="toggle" title="${p.active ? 'Деактивировать' : 'Активировать'}">
              <input type="checkbox" class="active-toggle" data-id="${p.id}" ${p.active ? 'checked' : ''} />
              <span class="toggle-slider"></span>
            </label>
          </td>
          <td style="white-space:nowrap">
            <a href="product-edit.html?id=${p.id}" class="action-btn">Изменить</a>
            <button class="action-btn danger delete-btn" data-id="${p.id}" data-name="${escHtml(p.name_ru)}" style="margin-left:0.4rem">Удалить</button>
          </td>
        </tr>
      `
    }).join('')

    // Wire active toggles
    tbody.querySelectorAll('.active-toggle').forEach(toggle => {
      toggle.addEventListener('change', async () => {
        const id = toggle.dataset.id
        const newActive = toggle.checked ? 1 : 0
        toggle.disabled = true
        try {
          const fd = new FormData()
          fd.append('active', String(newActive))
          await apiJSON(`/api/admin/products/${id}`, { method: 'PATCH', body: fd })
        } catch (e) {
          alert('Ошибка: ' + e.message)
          toggle.checked = !toggle.checked  // revert
        } finally {
          toggle.disabled = false
        }
      })
    })

    // Wire delete buttons
    tbody.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id
        const name = btn.dataset.name
        if (!confirm(`Деактивировать продукт "${name}"?\n(Файлы в R2 сохранятся)`)) return
        btn.disabled = true
        try {
          await apiJSON(`/api/admin/products/${id}`, { method: 'DELETE' })
          await loadProducts()
        } catch (e) {
          alert('Ошибка: ' + e.message)
          btn.disabled = false
        }
      })
    })
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:#ef4444">Ошибка: ${escHtml(e.message)}</td></tr>`
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const { checkAuth } = window.LOOM
  const admin = await checkAuth()
  if (!admin) { window.location.href = 'login.html'; return }

  window.LOOM_LAYOUT.setEmail(admin.email)

  document.getElementById('filter-active').addEventListener('change', () => { currentPage = 1; loadProducts() })
  document.getElementById('filter-q').addEventListener('input', () => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => { currentPage = 1; loadProducts() }, 300)
  })
  document.getElementById('btn-refresh').addEventListener('click', loadProducts)
  document.getElementById('btn-prev').addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; loadProducts() }
  })
  document.getElementById('btn-next').addEventListener('click', () => { currentPage++; loadProducts() })

  loadProducts()
})
