'use strict'

;(function () {
  const { apiJSON, statusBadge, formatPrice, formatDate, formatPhone } = window.LOOM
  const { esc, apiErrorMessage } = window.LOOM_UI

  const LIMIT = 50
  let currentPage = 1
  let debounceTimer = null

  const el = (id) => document.getElementById(id)

  function stateRow(html, kind) {
    return '<tr><td colspan="8"><div class="state' + (kind ? ' state--' + kind : '') + '">' + html + '</div></td></tr>'
  }

  async function loadOrders() {
    const status = el('filter-status').value
    const q = el('filter-q').value.trim()

    const params = new URLSearchParams({ page: currentPage, limit: LIMIT })
    if (status) params.set('status', status)
    if (q) params.set('q', q)

    const tbody = el('orders-tbody')
    tbody.innerHTML = stateRow('Загрузка…')

    try {
      const { orders, total, page, limit } = await apiJSON('/api/admin/orders?' + params)

      const totalPages = Math.ceil(total / limit) || 1
      el('page-info').textContent = 'Страница ' + page + ' из ' + totalPages + ' · всего ' + total
      el('btn-prev').disabled = page <= 1
      el('btn-next').disabled = page >= totalPages

      if (!orders.length) {
        // An empty result from a filter is a different situation from an empty
        // shop, and the way out of each is different.
        tbody.innerHTML = (status || q)
          ? stateRow('<p class="state-title">Ничего не найдено</p>' +
              '<p class="state-sub">Под выбранный фильтр не попал ни один заказ.</p>' +
              '<div class="state-actions"><button type="button" class="btn btn--sm" id="btn-clear-filters">Сбросить фильтры</button></div>')
          : stateRow('<p class="state-title">Заказов пока нет</p>' +
              '<p class="state-sub">Как только клиент оформит заказ, он появится здесь.</p>')
        const clear = el('btn-clear-filters')
        if (clear) clear.addEventListener('click', () => {
          el('filter-status').value = ''
          el('filter-q').value = ''
          currentPage = 1
          loadOrders()
        })
        return
      }

      tbody.innerHTML = orders.map((o) =>
        '<tr class="is-clickable" data-id="' + o.id + '" tabindex="0">' +
          '<td class="num">' + o.id + '</td>' +
          '<td>' + esc(o.customer_name) + '</td>' +
          '<td class="num">' + esc(formatPhone(o.customer_phone)) + '</td>' +
          '<td>' + esc(o.product_name_ru || '—') + '</td>' +
          '<td class="num right">' + formatPrice(o.total_price) + '</td>' +
          '<td>' + statusBadge(o.status) + '</td>' +
          '<td class="muted">' + formatDate(o.created_at) + '</td>' +
          '<td class="dim" aria-hidden="true">→</td>' +
        '</tr>').join('')

      tbody.querySelectorAll('tr[data-id]').forEach((row) => {
        const open = () => { window.location.href = 'order.html?id=' + row.dataset.id }
        row.addEventListener('click', open)
        row.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() }
        })
      })
    } catch (err) {
      if (err.status === 401) { window.location.href = 'login.html'; return }
      tbody.innerHTML = stateRow(esc(apiErrorMessage(err)), 'error')
    }
  }

  window.LOOM_LAYOUT.onReady(() => {
    // The dashboard links here with a status pre-selected ("12 ждут обработки"
    // → the 12), so the filter has to honour ?status=.
    const wanted = new URLSearchParams(location.search).get('status')
    if (wanted && el('filter-status').querySelector('option[value="' + wanted + '"]')) {
      el('filter-status').value = wanted
    }

    el('filter-status').addEventListener('change', () => { currentPage = 1; loadOrders() })
    el('filter-q').addEventListener('input', () => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => { currentPage = 1; loadOrders() }, 300)
    })
    el('btn-refresh').addEventListener('click', loadOrders)
    el('btn-prev').addEventListener('click', () => { if (currentPage > 1) { currentPage--; loadOrders() } })
    el('btn-next').addEventListener('click', () => { currentPage++; loadOrders() })

    loadOrders()
  })
})()
