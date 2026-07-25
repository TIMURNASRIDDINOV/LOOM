'use strict'

;(function () {
  const { apiJSON, formatDate } = window.LOOM
  const { esc, toast, apiErrorMessage } = window.LOOM_UI

  const PAGE_SIZE = 25
  let currentPage = 1

  const el = (id) => document.getElementById(id)

  function stateRow(html, kind) {
    return '<tr><td colspan="5"><div class="state' + (kind ? ' state--' + kind : '') + '">' + html + '</div></td></tr>'
  }

  function renderHistory(items, total) {
    const tbody = el('notif-tbody')
    if (!items.length) {
      tbody.innerHTML = stateRow('<p class="state-title">Отправок пока не было</p>' +
        '<p class="state-sub">Здесь появится каждое сообщение, отправленное клиенту.</p>')
      updatePagination(0)
      return
    }
    tbody.innerHTML = items.map((n) =>
      '<tr>' +
        '<td class="num muted">' + n.id + '</td>' +
        '<td><a href="user-detail.html?id=' + n.user_id + '" class="mono">#' + n.user_id + '</a></td>' +
        '<td class="msg-cell" title="' + esc(n.message) + '">' + esc(n.message) + '</td>' +
        '<td>' + (n.status === 'sent'
          ? '<span class="badge badge-delivered">Отправлено</span>'
          : '<span class="badge badge-cancelled">Ошибка</span>') + '</td>' +
        '<td class="muted">' + formatDate(n.sent_at) + '</td>' +
      '</tr>').join('')
    updatePagination(total)
  }

  function updatePagination(total) {
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
    el('page-info').textContent = 'Страница ' + currentPage + ' из ' + totalPages + ' · всего ' + total
    el('btn-prev').disabled = currentPage <= 1
    el('btn-next').disabled = currentPage >= totalPages
  }

  async function loadHistory() {
    const params = new URLSearchParams({ page: String(currentPage), limit: String(PAGE_SIZE) })
    try {
      const data = await apiJSON('/api/admin/notifications?' + params)
      renderHistory(data.items || [], data.total || 0)
    } catch (err) {
      el('notif-tbody').innerHTML = stateRow(esc(apiErrorMessage(err)), 'error')
    }
  }

  async function send() {
    const userId = parseInt(el('n-user-id').value, 10)
    const message = el('n-message').value.trim()
    const btnLabel = el('n-btn-label').value.trim()
    const btnUrl = el('n-btn-url').value.trim()
    const btn = el('btn-send')

    if (!userId || Number.isNaN(userId)) { toast('Укажите ID клиента', 'error'); el('n-user-id').focus(); return }
    if (!message) { toast('Введите текст сообщения', 'error'); el('n-message').focus(); return }

    btn.disabled = true
    try {
      const body = { user_id: userId, message }
      if (btnLabel && btnUrl) { body.button_label = btnLabel; body.button_url = btnUrl }
      await apiJSON('/api/admin/notifications', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      toast('Сообщение отправлено', 'success')
      el('n-message').value = ''
      el('n-btn-label').value = ''
      el('n-btn-url').value = ''
      currentPage = 1
      loadHistory()
    } catch (err) {
      toast(apiErrorMessage(err), 'error')
    } finally {
      btn.disabled = false
    }
  }

  window.LOOM_LAYOUT.onReady(() => {
    el('btn-prev').addEventListener('click', () => { if (currentPage > 1) { currentPage--; loadHistory() } })
    el('btn-next').addEventListener('click', () => { currentPage++; loadHistory() })
    // The compose card is removed entirely when the admin lacks the capability.
    const sendBtn = el('btn-send')
    if (sendBtn) sendBtn.addEventListener('click', send)

    loadHistory()
  })
})()
