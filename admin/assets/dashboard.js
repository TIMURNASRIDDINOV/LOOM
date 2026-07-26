'use strict'

;(function () {
  const { apiJSON, formatPrice, formatDate, statusBadge, STATUS_LABELS } = window.LOOM
  const { esc } = window.LOOM_UI

  const chartInstances = {}
  const lastChartData = {}

  const el = (id) => document.getElementById(id)

  // Russian needs three forms; "2 заказа(ов)" is not something you ship to a
  // person who reads this screen every morning.
  function plural(n, one, few, many) {
    const mod10 = n % 10, mod100 = n % 100
    const form = (mod10 === 1 && mod100 !== 11) ? one
      : (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) ? few
      : many
    return n + ' ' + form
  }

  // Chart.js is deferred, so it may not have executed yet when the first data
  // arrives. Everything chart-related goes through here.
  function whenChart(fn) {
    if (window.Chart) { fn(); return }
    window.addEventListener('load', () => { if (window.Chart) fn() }, { once: true })
  }

  function isLight() { return document.documentElement.getAttribute('data-theme') === 'light' }

  function chartPalette() {
    const light = isLight()
    return {
      tick:     light ? 'rgba(24,24,27,0.66)'   : 'rgba(255,255,255,0.68)',
      grid:     light ? 'rgba(24,24,27,0.08)'   : 'rgba(255,255,255,0.07)',
      barFill:  light ? 'rgba(24,24,27,0.16)'   : 'rgba(255,255,255,0.18)',
      barEdge:  light ? 'rgba(24,24,27,0.5)'    : 'rgba(255,255,255,0.45)',
      line:     light ? 'rgba(13,148,136,0.9)'  : 'rgba(99,202,183,0.9)',
      lineFill: light ? 'rgba(13,148,136,0.12)' : 'rgba(99,202,183,0.1)',
    }
  }

  function baseOptions(p) {
    return {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: p.tick, font: { size: 12 }, maxTicksLimit: 10 }, grid: { color: p.grid } },
        y: { ticks: { color: p.tick, font: { size: 12 }, precision: 0 }, grid: { color: p.grid }, beginAtZero: true },
      },
    }
  }

  function makeChart(kind, canvasId, labels, data) {
    const canvas = el(canvasId)
    if (!canvas || !window.Chart) return
    const p = chartPalette()
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy()

    const dataset = kind === 'line'
      ? { data, borderColor: p.line, backgroundColor: p.lineFill, borderWidth: 2, fill: true, tension: 0.3, pointRadius: 0 }
      : { data, backgroundColor: p.barFill, borderColor: p.barEdge, borderWidth: 1, borderRadius: 3 }

    chartInstances[canvasId] = new Chart(canvas.getContext('2d'), {
      type: kind, data: { labels, datasets: [dataset] }, options: baseOptions(p),
    })
    lastChartData[canvasId] = { kind, labels, data }
  }

  // Charts paint their own colours, so they have to be rebuilt on theme change.
  new MutationObserver((muts) => {
    if (!muts.some((m) => m.attributeName === 'data-theme')) return
    Object.keys(lastChartData).forEach((id) => {
      const d = lastChartData[id]
      makeChart(d.kind, id, d.labels, d.data)
    })
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

  // Fill gaps so a quiet day reads as zero rather than vanishing from the axis.
  function fillDays(rows, n, dateKey, countKey) {
    dateKey = dateKey || 'day'; countKey = countKey || 'count'
    const map = {}
    ;(rows || []).forEach((row) => { map[row[dateKey]] = row[countKey] })
    const labels = [], counts = []
    const now = new Date()
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      labels.push(key.slice(5))
      counts.push(map[key] ?? 0)
    }
    return { labels, counts }
  }

  function renderBreakdown(containerId, rows) {
    const container = el(containerId)
    if (!container) return
    if (!rows || !rows.length) { container.innerHTML = '<div class="state">Нет данных</div>'; return }
    const total = rows.reduce((s, r) => s + (r.count || 0), 0)
    const key = Object.keys(rows[0]).filter((k) => k !== 'count')[0]
    container.innerHTML = rows.map((r) => {
      const val = r[key] || 'other'
      const pct = total ? Math.round((r.count / total) * 100) : 0
      return '<div class="breakdown-row">' +
        '<span class="breakdown-label">' + esc(val) + '</span>' +
        '<span class="breakdown-bar-wrap"><span class="breakdown-bar" style="width:' + pct + '%"></span></span>' +
        '<span class="breakdown-count">' + r.count + ' · ' + pct + '%</span>' +
      '</div>'
    }).join('')
  }

  function renderOrders(stats) {
    el('stat-week').textContent = stats.ordersLast7Days
    el('stat-revenue').textContent = formatPrice(stats.revenueLast30Days)

    const newCount = stats.ordersByStatus['new'] ?? 0
    el('stat-new').textContent = newCount
    el('stat-producing').textContent = stats.ordersByStatus['producing'] ?? 0
    // The "needs attention" treatment is only warranted when something does.
    if (!newCount) el('tile-new').classList.remove('stat--action')

    el('greeting').textContent = newCount
      ? plural(newCount, 'заказ ждёт', 'заказа ждут', 'заказов ждут') + ' обработки.'
      : 'Необработанных заказов нет — всё в работе.'

    const order = ['new', 'confirmed', 'producing', 'shipped', 'delivered', 'cancelled']
    el('status-bar').innerHTML = order.map((s) =>
      '<a class="status-cell" href="orders.html?status=' + s + '">' +
        '<span class="status-num">' + (stats.ordersByStatus[s] ?? 0) + '</span>' +
        '<span class="status-name">' + esc(STATUS_LABELS[s] ?? s) + '</span>' +
      '</a>').join('')

    const od = fillDays(stats.ordersPerDay, 30)
    whenChart(() => makeChart('bar', 'orders-chart', od.labels, od.counts))

    const tbody = el('recent-orders').querySelector('tbody')
    if (!stats.recentOrders || !stats.recentOrders.length) {
      tbody.innerHTML = '<tr><td colspan="3"><div class="state">Заказов пока нет</div></td></tr>'
    } else {
      tbody.innerHTML = stats.recentOrders.map((o) =>
        '<tr data-id="' + o.id + '">' +
          '<td class="mini-id">' + o.id + '</td>' +
          '<td><div>' + esc(o.customer_name) + '</div><div class="mini-date">' + formatDate(o.created_at) + '</div></td>' +
          '<td style="text-align:right">' + statusBadge(o.status) + '</td>' +
        '</tr>').join('')
      tbody.querySelectorAll('tr[data-id]').forEach((row) => {
        row.addEventListener('click', () => { location.href = 'order.html?id=' + row.dataset.id })
      })
    }

    const topEl = el('top-products')
    if (!stats.topProducts || !stats.topProducts.length) {
      topEl.innerHTML = '<div class="state">Нет данных</div>'
    } else {
      topEl.innerHTML = stats.topProducts.map((p, i) =>
        '<div class="rank-row">' +
          '<span class="rank-left"><span class="rank-num">' + (i + 1) + '</span>' +
          '<span>' + esc(p.name_ru ?? 'Без названия') + '</span></span>' +
          '<span class="rank-count">' + p.count + ' зак.</span>' +
        '</div>').join('')
    }
  }

  function renderVisitors(v) {
    el('vis-today').textContent = v.today
    el('vis-week').textContent = v.week
    el('vis-month').textContent = v.month
    el('vis-all').textContent = v.allTime
    el('vis-year-note').textContent = 'За последний год: ' + v.year + ' посетителей.'

    renderBreakdown('device-breakdown', v.byDevice)
    renderBreakdown('browser-breakdown', v.byBrowser)
    renderBreakdown('os-breakdown', v.byOs)

    const vd = fillDays(v.dailyLast30, 30)
    whenChart(() => makeChart('line', 'visitors-chart', vd.labels, vd.counts))
  }

  function wireTabs() {
    const tabs = [
      { tab: el('tab-orders'), panel: el('panel-orders') },
      { tab: el('tab-visitors'), panel: el('panel-visitors') },
    ]
    tabs.forEach(({ tab }, i) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t, j) => {
          t.tab.setAttribute('aria-selected', i === j ? 'true' : 'false')
          t.panel.hidden = i !== j
        })
        // Chart.js sizes to a hidden container as 0×0; rebuild on reveal.
        const d = lastChartData['visitors-chart']
        if (i === 1 && d) whenChart(() => makeChart(d.kind, 'visitors-chart', d.labels, d.data))
      })
    })
  }

  // A swallowed rejection used to leave every placeholder on «Загрузка…»
  // forever, which reads as "still working" rather than "this failed".
  function failPanels(ids, message) {
    ids.forEach((id) => {
      const node = el(id)
      if (!node) return
      node.innerHTML = '<div class="state state--error">' + esc(message) + '</div>'
    })
  }

  async function load() {
    const [stats, visitors] = await Promise.all([
      apiJSON('/api/admin/stats').catch((e) => e),
      apiJSON('/api/admin/analytics/visitors').catch((e) => e),
    ])

    if (stats instanceof Error) {
      failPanels(['status-bar', 'top-products'], 'Не удалось загрузить статистику заказов.')
      el('recent-orders').querySelector('tbody').innerHTML =
        '<tr><td colspan="3"><div class="state state--error">Не удалось загрузить заказы.</div></td></tr>'
      el('greeting').textContent = 'Не удалось загрузить данные — обновите страницу.'
    } else {
      renderOrders(stats)
    }

    if (visitors instanceof Error) {
      failPanels(['device-breakdown', 'browser-breakdown', 'os-breakdown'],
        'Не удалось загрузить статистику посетителей.')
    } else {
      renderVisitors(visitors)
    }
  }

  window.LOOM_LAYOUT.onReady(() => {
    wireTabs()
    load()
  })
})()
