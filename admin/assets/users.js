'use strict'

;(function () {
  const { apiJSON, formatDate, formatPhone, API_BASE } = window.LOOM
  const { esc, apiErrorMessage } = window.LOOM_UI

  const PAGE_SIZE = 50
  let currentPage = 1
  let currentQ = ''
  let debounceTimer = null

  const el = (id) => document.getElementById(id)

  function stateRow(html, kind) {
    return '<tr><td colspan="7"><div class="state' + (kind ? ' state--' + kind : '') + '">' + html + '</div></td></tr>'
  }

  function displayName(u) {
    if (u.first_name || u.last_name) return [u.first_name, u.last_name].filter(Boolean).join(' ')
    return u.name || ''
  }

  function initials(u) {
    const name = displayName(u) || u.email || u.phone || ''
    return name.slice(0, 2).toUpperCase()
  }

  function avatarHtml(u) {
    if (u.avatar_key) {
      return '<img class="avatar-sm" src="' + API_BASE + '/api/files/avatars/' + esc(u.avatar_key) + '" alt="" loading="lazy" />'
    }
    return '<span class="avatar" aria-hidden="true">' + esc(initials(u)) + '</span>'
  }

  // Customer roles are the shop's own roles, not admin roles — kept as a plain
  // badge so they cannot be mistaken for admin-panel access.
  function roleBadge(role) {
    return '<span class="badge">' + esc(window.LOOM.userRoleLabel(role)) + '</span>'
  }

  function renderUsers(users, total, page, limit) {
    const tbody = el('users-tbody')

    if (!users.length) {
      tbody.innerHTML = currentQ
        ? stateRow('<p class="state-title">Никого не найдено</p>' +
            '<p class="state-sub">По запросу «' + esc(currentQ) + '» нет ни одного клиента.</p>' +
            '<div class="state-actions"><button type="button" class="btn btn--sm" id="btn-clear-search">Очистить поиск</button></div>')
        : stateRow('<p class="state-title">Клиентов пока нет</p>' +
            '<p class="state-sub">Здесь появятся все, кто зарегистрируется на сайте.</p>')
      const clear = el('btn-clear-search')
      if (clear) clear.addEventListener('click', () => {
        el('search-input').value = ''
        currentQ = ''; currentPage = 1
        loadUsers()
      })
    } else {
      tbody.innerHTML = users.map((u) => {
        const name = displayName(u)
        const contact = u.email || u.phone || (u.telegram_username ? '@' + u.telegram_username : '—')
        return '<tr class="is-clickable" data-id="' + u.id + '" tabindex="0">' +
          '<td>' + avatarHtml(u) + '</td>' +
          '<td class="num">' + esc(contact) + '</td>' +
          '<td>' + (name ? esc(name) : '<span class="muted">—</span>') + '</td>' +
          '<td class="num muted">' + (u.phone ? esc(formatPhone(u.phone)) : '—') + '</td>' +
          '<td>' + roleBadge(u.role || 'user') + '</td>' +
          '<td class="num right">' + (u.orders_count ?? 0) + '</td>' +
          '<td class="muted">' + formatDate(u.created_at) + '</td>' +
        '</tr>'
      }).join('')

      tbody.querySelectorAll('tr[data-id]').forEach((row) => {
        const open = () => { window.location.href = 'user-detail.html?id=' + row.dataset.id }
        row.addEventListener('click', open)
        row.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() }
        })
      })
    }

    const from = total ? (page - 1) * limit + 1 : 0
    const to = Math.min(page * limit, total)
    el('page-info').textContent = total ? from + '–' + to + ' из ' + total : 'Нет записей'
    el('prev-btn').disabled = page <= 1
    el('next-btn').disabled = to >= total
  }

  async function loadUsers() {
    const tbody = el('users-tbody')
    tbody.innerHTML = stateRow('Загрузка…')
    try {
      const qs = new URLSearchParams({ page: currentPage, limit: PAGE_SIZE })
      if (currentQ) qs.set('q', currentQ)
      const data = await apiJSON('/api/admin/users?' + qs)
      renderUsers(data.users, data.total, data.page, data.limit)
    } catch (err) {
      if (err.status === 401) { window.location.href = 'login.html'; return }
      tbody.innerHTML = stateRow(esc(apiErrorMessage(err)), 'error')
    }
  }

  function search() {
    currentQ = el('search-input').value.trim()
    currentPage = 1
    loadUsers()
  }

  window.LOOM_LAYOUT.onReady(() => {
    el('search-btn').addEventListener('click', search)
    el('search-input').addEventListener('input', () => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(search, 300)
    })
    el('search-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); search() }
    })
    el('refresh-btn').addEventListener('click', loadUsers)
    el('prev-btn').addEventListener('click', () => { if (currentPage > 1) { currentPage--; loadUsers() } })
    el('next-btn').addEventListener('click', () => { currentPage++; loadUsers() })

    loadUsers()
  })
})()
