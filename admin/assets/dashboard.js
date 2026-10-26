'use strict'

;(function () {
  const { apiJSON, formatPrice, formatDate, statusBadge, STATUS_LABELS } = window.LOOM
  const { esc } = window.LOOM_UI

  const chartInstances = {}
  const lastChartData = {}

  const el = (id) => document.getElementById(id)

  // ── GA4 tab (LOOM-285): GET /api/admin/analytics/ga4, loaded on first open ──
  const ga4Translations = {
    ru: {
      consent: 'Только посетители с согласием: меньше, чем во внутренней воронке', open: 'Открыть GA4 ↗',
      period: 'Период', days28: '28 дней', days7: '7 дней', loading: 'Загрузка…', empty: 'Нет данных за этот период.',
      fetched: 'Получено', cached: 'из кэша', lastGood: 'Последние данные', code: 'Код',
      pages: 'Популярные страницы', clicks: 'Клики (ui_click)', sources: 'Источники трафика', devices: 'Устройства',
      events: 'Прокрутка и события конфигуратора',
      page: 'Страница', views: 'Просмотры', users: 'Пользователи', text: 'Текст', id: 'ID', section: 'Секция', count: 'Кол-во',
      source: 'Источник', medium: 'Канал', campaign: 'Кампания', sessions: 'Сеансы', device: 'Устройство', event: 'Событие',
      setupTitle: 'GA4 не подключён',
      setup: 'Не заданы секреты Worker: {missing}. Настройка: сервисный аккаунт Google с ролью Viewer в ресурсе GA4, числовой Property ID, затем npx wrangler secret put для каждого секрета. Пошагово — в задаче LOOM-284.',
      failed: 'Не удалось загрузить данные GA4. Повторите попытку.',
      ga4_rate_limited: 'Квота Google Analytics исчерпана. Повторите позже.',
      ga4_forbidden: 'Google отказал в доступе: включите Google Analytics Data API и дайте сервисному аккаунту роль Viewer в ресурсе GA4.',
      ga4_custom_dimensions_missing: 'В GA4 не зарегистрированы параметры element_id, element_text и section (данные появляются через 24–48 ч).',
      ga4_auth_failed: 'Ключ сервисного аккаунта не принят. Загрузите GA4_SA_KEY заново.',
      ga4_property_invalid: 'GA4_PROPERTY_ID должен быть числовым Property ID (не G-…).',
    },
    uz: {
      consent: 'Faqat rozilik bergan tashrifchilar: ichki voronkadan kamroq', open: 'GA4 ni ochish ↗',
      period: 'Davr', days28: '28 kun', days7: '7 kun', loading: 'Yuklanmoqda…', empty: 'Bu davr uchun maʼlumot yo‘q.',
      fetched: 'Olingan', cached: 'keshdan', lastGood: 'Oxirgi maʼlumot', code: 'Kod',
      pages: 'Mashhur sahifalar', clicks: 'Bosishlar (ui_click)', sources: 'Trafik manbalari', devices: 'Qurilmalar',
      events: 'Aylantirish va konfigurator hodisalari',
      page: 'Sahifa', views: 'Ko‘rishlar', users: 'Foydalanuvchilar', text: 'Matn', id: 'ID', section: 'Bo‘lim', count: 'Soni',
      source: 'Manba', medium: 'Kanal', campaign: 'Kampaniya', sessions: 'Seanslar', device: 'Qurilma', event: 'Hodisa',
      setupTitle: 'GA4 ulanmagan',
      setup: 'Worker sirlari berilmagan: {missing}. Sozlash: GA4 resursida Viewer roli bor Google xizmat hisobi, raqamli Property ID, so‘ng har bir sir uchun npx wrangler secret put. Batafsil — LOOM-284 vazifasida.',
      failed: 'GA4 maʼlumotlarini yuklab bo‘lmadi. Qayta urinib ko‘ring.',
      ga4_rate_limited: 'Google Analytics kvotasi tugadi. Keyinroq urinib ko‘ring.',
      ga4_forbidden: 'Google ruxsat bermadi: Google Analytics Data API ni yoqing va xizmat hisobiga GA4 resursida Viewer rolini bering.',
      ga4_custom_dimensions_missing: 'GA4 da element_id, element_text va section parametrlari ro‘yxatdan o‘tmagan (maʼlumot 24–48 soatdan keyin chiqadi).',
      ga4_auth_failed: 'Xizmat hisobi kaliti qabul qilinmadi. GA4_SA_KEY ni qayta yuklang.',
      ga4_property_invalid: 'GA4_PROPERTY_ID raqamli Property ID bo‘lishi kerak (G-… emas).',
    },
    en: {
      consent: 'Consented visitors only: lower than the first-party funnel', open: 'Open GA4 ↗',
      period: 'Period', days28: '28 days', days7: '7 days', loading: 'Loading…', empty: 'No data for this period.',
      fetched: 'Fetched', cached: 'from cache', lastGood: 'Last good fetch', code: 'Code',
      pages: 'Top pages', clicks: 'Clicks (ui_click)', sources: 'Traffic sources', devices: 'Devices',
      events: 'Scroll and configurator events',
      page: 'Page', views: 'Views', users: 'Users', text: 'Text', id: 'ID', section: 'Section', count: 'Count',
      source: 'Source', medium: 'Medium', campaign: 'Campaign', sessions: 'Sessions', device: 'Device', event: 'Event',
      setupTitle: 'GA4 is not connected',
      setup: 'Missing Worker secrets: {missing}. Setup: a Google service account with the Viewer role on the GA4 property, the numeric Property ID, then npx wrangler secret put for each secret. Step by step in LOOM-284.',
      failed: 'Could not load GA4 data. Please try again.',
      ga4_rate_limited: 'Google Analytics quota reached. Try again later.',
      ga4_forbidden: 'Google refused access: enable the Google Analytics Data API and give the service account the Viewer role on the GA4 property.',
      ga4_custom_dimensions_missing: 'GA4 has no custom dimensions element_id, element_text and section yet (data appears 24–48 h after registering them).',
      ga4_auth_failed: 'The service-account key was rejected. Upload GA4_SA_KEY again.',
      ga4_property_invalid: 'GA4_PROPERTY_ID must be the numeric Property ID (not G-…).',
    },
  }
  const gt = ga4Translations[document.documentElement.lang.split('-')[0]] || ga4Translations.ru
  gt.ga4_key_invalid = gt.ga4_auth_failed

  // [response key, columns as [row key, label key, numeric?]]
  const GA4_CARDS = [
    ['pages', [['path', 'page'], ['views', 'views', 1], ['users', 'users', 1]]],
    ['clicks', [['text', 'text'], ['elementId', 'id'], ['section', 'section'], ['path', 'page'], ['count', 'count', 1]]],
    ['sources', [['source', 'source'], ['medium', 'medium'], ['campaign', 'campaign'], ['sessions', 'sessions', 1], ['users', 'users', 1]]],
    ['devices', [['device', 'device'], ['sessions', 'sessions', 1], ['users', 'users', 1]]],
    ['events', [['event', 'event'], ['path', 'page'], ['count', 'count', 1]]],
  ]
  let ga4Opened = false

  function ga4Notice(kind, title, body) {
    return '<div class="notice notice--' + kind + '"><div><strong>' + esc(title) + '</strong>' +
      (body ? '<div>' + esc(body) + '</div>' : '') + '</div></div>'
  }

  function ga4Card(key, cols, rows, sub) {
    const head = cols.map(([, label, num]) => '<th' + (num ? ' class="right"' : '') + '>' + esc(gt[label]) + '</th>').join('')
    const body = rows.length
      ? rows.map((r) => '<tr>' + cols.map(([k, , num]) => num
        ? '<td class="num right">' + Number(r[k] || 0).toLocaleString('ru-RU') + '</td>'
        : '<td>' + esc(r[k]) + '</td>').join('') + '</tr>').join('')
      : '<tr><td colspan="' + cols.length + '"><div class="state">' + esc(gt.empty) + '</div></td></tr>'
    return '<div class="card"><div class="card-head"><div><h3 class="card-title">' + esc(gt[key]) + '</h3>' +
      '<p class="card-sub">' + esc(sub) + '</p></div></div>' +
      '<div class="table-wrap"><table class="table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div></div>'
  }

  async function loadGa4() {
    ga4Opened = true
    const state = el('ga4-state'), results = el('ga4-results')
    el('ga4-days').disabled = true
    results.hidden = true
    state.innerHTML = '<p class="field-hint">' + esc(gt.loading) + '</p>'
    try {
      const data = await apiJSON('/api/admin/analytics/ga4?days=' + el('ga4-days').value)
      if (!data.configured) {
        state.innerHTML = ga4Notice('warning', gt.setupTitle, gt.setup.replace('{missing}', (data.missing || []).join(', ')))
        return
      }
      el('ga4-link').href = 'https://analytics.google.com/analytics/web/#/p' + encodeURIComponent(data.propertyId) + '/reports/intelligenthome'
      const sub = gt.consent + ' · ' + gt.fetched + ' ' + formatDate(data.fetchedAt) + (data.cached ? ' (' + gt.cached + ')' : '')
      results.innerHTML = GA4_CARDS.map(([key, cols]) => ga4Card(key, cols, data[key] || [], sub)).join('')
      state.innerHTML = ''
      results.hidden = false
    } catch (error) {
      const d = error.data || {}
      const detail = [d.code ? gt.code + ': ' + d.code : '', d.lastFetchedAt ? gt.lastGood + ': ' + formatDate(d.lastFetchedAt) : '']
      state.innerHTML = ga4Notice('danger', gt[d.code] || gt.failed, detail.filter(Boolean).join(' · '))
    } finally {
      el('ga4-days').disabled = false
    }
  }

  function wireGa4() {
    document.querySelectorAll('[data-ga4-i18n]').forEach((node) => { node.textContent = gt[node.dataset.ga4I18n] })
    el('ga4-days').addEventListener('change', loadGa4)
  }

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
      { tab: el('tab-ga4'), panel: el('panel-ga4') },
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
        // GA4 costs Data API quota, so it loads only when someone opens the tab.
        if (tab.id === 'tab-ga4' && !ga4Opened) loadGa4()
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
    wireGa4()
    load()
  })
})()
