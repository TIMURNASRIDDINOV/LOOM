'use strict'

;(function () {
  const { apiJSON, formatPrice } = window.LOOM
  const { esc, toast, confirmDialog, apiErrorMessage } = window.LOOM_UI

  const LIMIT = 50
  let currentPage = 1
  let debounceTimer = null
  let canEdit = false

  const el = (id) => document.getElementById(id)

  function stateRow(html, kind) {
    return '<tr><td colspan="6"><div class="state' + (kind ? ' state--' + kind : '') + '">' + html + '</div></td></tr>'
  }

  function rowHtml(p) {
    const thumb = p.thumbnail_url
      ? '<img src="' + esc(p.thumbnail_url) + '" class="thumb" alt="" loading="lazy" />'
      : '<div class="thumb-placeholder" aria-hidden="true">GLB</div>'

    // Editing is a capability, not a role — a manager can have it revoked and a
    // staff member can have it granted.
    const actions = canEdit
      ? '<a href="product-edit.html?id=' + p.id + '" class="btn btn--sm">Изменить</a> ' +
        '<button type="button" class="btn btn--sm btn--danger" data-del="' + p.id + '" data-name="' + esc(p.name_ru) + '">Удалить</button>'
      : '<a href="product-edit.html?id=' + p.id + '" class="btn btn--sm">Открыть</a>'

    const toggle = '<label class="switch" title="' + (p.active ? 'Скрыть с сайта' : 'Показать на сайте') + '">' +
      '<input type="checkbox" data-active="' + p.id + '"' + (p.active ? ' checked' : '') + (canEdit ? '' : ' disabled') + ' />' +
      '<span class="track" aria-hidden="true"></span><span class="knob" aria-hidden="true"></span>' +
      '<span class="sr-only">Товар активен</span>' +
    '</label>'

    return '<tr>' +
      '<td>' + thumb + '</td>' +
      '<td>' + esc(p.name_ru) +
        (p.product_type === 'ready' ? '<span class="tag-ready">Готовый</span>' : '') + '</td>' +
      '<td class="num muted">' + esc(p.slug) + '</td>' +
      '<td class="num right">' + formatPrice(p.price) + '</td>' +
      '<td>' + toggle + '</td>' +
      '<td class="cell-actions">' + actions + '</td>' +
    '</tr>'
  }

  async function loadProducts() {
    const active = el('filter-active').value
    const q = el('filter-q').value.trim()

    const params = new URLSearchParams({ page: currentPage, limit: LIMIT })
    if (active !== '') params.set('active', active)
    if (q) params.set('q', q)

    const tbody = el('products-tbody')
    tbody.innerHTML = stateRow('Загрузка…')

    try {
      const { products, total, page, limit } = await apiJSON('/api/admin/products?' + params)

      const totalPages = Math.ceil(total / limit) || 1
      el('page-info').textContent = 'Страница ' + page + ' из ' + totalPages + ' · всего ' + total
      el('btn-prev').disabled = page <= 1
      el('btn-next').disabled = page >= totalPages

      if (!products.length) {
        tbody.innerHTML = (active !== '' || q)
          ? stateRow('<p class="state-title">Ничего не найдено</p><p class="state-sub">Под выбранный фильтр не попал ни один товар.</p>')
          : stateRow('<p class="state-title">Каталог пуст</p><p class="state-sub">Добавьте первый товар, чтобы он появился на сайте.</p>')
        return
      }

      tbody.innerHTML = products.map(rowHtml).join('')
      wireRows()
    } catch (err) {
      if (err.status === 401) { window.location.href = 'login.html'; return }
      tbody.innerHTML = stateRow(esc(apiErrorMessage(err)), 'error')
    }
  }

  function wireRows() {
    const tbody = el('products-tbody')

    tbody.querySelectorAll('[data-active]').forEach((toggle) => {
      toggle.addEventListener('change', async () => {
        toggle.disabled = true
        try {
          const fd = new FormData()
          fd.append('active', toggle.checked ? '1' : '0')
          await apiJSON('/api/admin/products/' + toggle.dataset.active, { method: 'PATCH', body: fd })
          toast(toggle.checked ? 'Товар показан на сайте' : 'Товар скрыт с сайта', 'success')
        } catch (err) {
          toggle.checked = !toggle.checked   // revert to the server's truth
          toast(apiErrorMessage(err), 'error')
        } finally {
          toggle.disabled = false
        }
      })
    })

    tbody.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.name
        const ok = await confirmDialog({
          title: 'Удалить «' + name + '»?',
          body: 'Если по этому товару уже есть заказы, он будет архивирован (скрыт с сайта), а не удалён — чтобы история заказов осталась целой.',
          confirmLabel: 'Удалить',
          danger: true,
        })
        if (!ok) return

        btn.disabled = true
        try {
          const res = await apiJSON('/api/admin/products/' + btn.dataset.del, { method: 'DELETE' })
          toast(res && res.mode === 'archived'
            ? '«' + name + '» архивирован: на него ссылаются заказы (' + res.orders + ')'
            : '«' + name + '» удалён', 'success')
          await loadProducts()
        } catch (err) {
          toast(apiErrorMessage(err), 'error')
          btn.disabled = false
        }
      })
    })
  }

  window.LOOM_LAYOUT.onReady((me, caps) => {
    canEdit = caps.has('products.edit')

    el('filter-active').addEventListener('change', () => { currentPage = 1; loadProducts() })
    el('filter-q').addEventListener('input', () => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => { currentPage = 1; loadProducts() }, 300)
    })
    el('btn-refresh').addEventListener('click', loadProducts)
    el('btn-prev').addEventListener('click', () => { if (currentPage > 1) { currentPage--; loadProducts() } })
    el('btn-next').addEventListener('click', () => { currentPage++; loadProducts() })

    loadProducts()
  })
})()
