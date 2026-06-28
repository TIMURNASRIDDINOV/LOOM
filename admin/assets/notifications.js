'use strict'

;(function () {
  const { apiJSON, checkAuth, formatDate } = window.LOOM

  let currentPage = 1
  const PAGE_SIZE = 25

  function escHtml(s) {
    if (!s) return ''
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  async function loadHistory() {
    const params = new URLSearchParams({ page: String(currentPage), limit: String(PAGE_SIZE) })
    try {
      const data = await apiJSON('/api/admin/notifications?' + params.toString())
      renderHistory(data.items || [], data.total || 0)
    } catch (err) {
      document.getElementById('notif-tbody').innerHTML =
        `<tr><td colspan="5" style="color:var(--danger)">${escHtml(err.message)}</td></tr>`
    }
  }

  function renderHistory(items, total) {
    const tbody = document.getElementById('notif-tbody')
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text-dim)">Нет отправок</td></tr>'
      updatePagination(0)
      return
    }
    tbody.innerHTML = items.map(n => `
      <tr>
        <td class="mono">${n.id}</td>
        <td class="mono" style="cursor:pointer;color:var(--text-secondary)" onclick="location.href='user-detail.html?id=${n.user_id}'">${n.user_id}</td>
        <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary)">${escHtml(n.message)}</td>
        <td>${n.status === 'sent'
          ? '<span class="badge-sent">✓ отправлено</span>'
          : `<span class="badge-failed">✗ ошибка</span>`}</td>
        <td style="color:var(--text-muted)">${formatDate(n.sent_at)}</td>
      </tr>
    `).join('')
    updatePagination(total)
  }

  function updatePagination(total) {
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
    document.getElementById('page-info').textContent = `Стр. ${currentPage} / ${totalPages} (${total})`
    document.getElementById('btn-prev').disabled = currentPage <= 1
    document.getElementById('btn-next').disabled = currentPage >= totalPages
  }

  document.getElementById('btn-prev').addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; loadHistory() }
  })
  document.getElementById('btn-next').addEventListener('click', () => {
    currentPage++; loadHistory()
  })

  document.getElementById('btn-send').addEventListener('click', async () => {
    const userId = parseInt(document.getElementById('n-user-id').value, 10)
    const message = document.getElementById('n-message').value.trim()
    const btnLabel = document.getElementById('n-btn-label').value.trim()
    const btnUrl = document.getElementById('n-btn-url').value.trim()
    const result = document.getElementById('send-result')
    const btn = document.getElementById('btn-send')

    if (!userId || Number.isNaN(userId)) {
      result.style.color = 'var(--danger)'; result.textContent = 'Введите ID пользователя'
      return
    }
    if (!message) {
      result.style.color = 'var(--danger)'; result.textContent = 'Введите текст сообщения'
      return
    }

    result.style.color = 'var(--text-muted)'; result.textContent = 'Отправка…'
    btn.disabled = true

    try {
      const body = { user_id: userId, message }
      if (btnLabel && btnUrl) { body.button_label = btnLabel; body.button_url = btnUrl }
      await apiJSON('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      result.style.color = 'var(--success)'
      result.textContent = '✅ Уведомление отправлено'
      document.getElementById('n-message').value = ''
      document.getElementById('n-btn-label').value = ''
      document.getElementById('n-btn-url').value = ''
      currentPage = 1
      loadHistory()
    } catch (err) {
      result.style.color = 'var(--danger)'
      result.textContent = 'Ошибка: ' + err.message
    } finally {
      btn.disabled = false
    }
  })

  document.addEventListener('DOMContentLoaded', async () => {
    const admin = await checkAuth()
    if (!admin) { window.location.href = 'login.html'; return }
    window.LOOM_LAYOUT.setEmail(admin.email)
    loadHistory()
  })
})()
