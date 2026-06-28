'use strict'
;(function () {
  const { apiJSON, checkAuth, formatDate } = window.LOOM

  let me = null

  function esc(s) {
    if (!s) return ''
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
  function roleBadge(role) {
    return `<span class="badge role-${esc(role)}">${esc(role)}</span>`
  }

  async function loadAdmins() {
    const tbody = document.getElementById('admins-tbody')
    try {
      const { admins } = await apiJSON('/api/admin/admins')
      if (!admins.length) { tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-dim)">Нет администраторов</td></tr>'; return }
      const canManage = me && me.role === 'owner'
      tbody.innerHTML = admins.map((a) => {
        const isSelf = me && a.id === me.id
        const rowIsOwner = a.role === 'owner'
        // Owners get an inline role <select>; everyone else sees a static badge.
        const roleCell = (canManage && !rowIsOwner)
          ? `<select class="sel-inline" data-role-for="${a.id}">
               <option value="staff"${a.role === 'staff' ? ' selected' : ''}>staff</option>
               <option value="manager"${a.role === 'manager' ? ' selected' : ''}>manager</option>
               <option value="owner">передать owner…</option>
             </select>`
          : roleBadge(a.role)
        let actions = ''
        if (canManage) {
          actions = (isSelf || rowIsOwner)
            ? '<span style="color:var(--text-dim);font-size:0.78rem">' + (isSelf ? 'это вы' : 'владелец') + '</span>'
            : `<button class="btn-action danger" data-del="${a.id}" data-email="${esc(a.email)}" style="padding:0.35rem 0.7rem">Удалить</button>`
        } else if (isSelf) {
          actions = '<span style="color:var(--text-dim);font-size:0.78rem">это вы</span>'
        }
        return `<tr>
          <td class="mono">${esc(a.email)}</td>
          <td>${roleCell}</td>
          <td style="color:var(--text-muted)">${formatDate(a.created_at)}</td>
          <td style="text-align:right">${actions}</td>
        </tr>`
      }).join('')

      // Wire role selects
      tbody.querySelectorAll('select[data-role-for]').forEach((sel) => {
        const original = sel.value
        sel.addEventListener('change', async () => {
          const id = sel.getAttribute('data-role-for')
          const role = sel.value
          const msg = role === 'owner'
            ? 'Передать роль владельца этому администратору? Вы станете manager.'
            : `Назначить роль «${role}»?`
          if (!confirm(msg)) { sel.value = original; return }
          try {
            await apiJSON(`/api/admin/admins/${id}/role`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }),
            })
            loadAdmins()
            if (role === 'owner') location.reload() // we are no longer owner
          } catch (err) { alert('Ошибка: ' + err.message); sel.value = original }
        })
      })
      // Wire delete buttons
      tbody.querySelectorAll('button[data-del]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm(`Удалить администратора ${btn.getAttribute('data-email')}?`)) return
          try {
            await apiJSON(`/api/admin/admins/${btn.getAttribute('data-del')}`, { method: 'DELETE' })
            loadAdmins()
          } catch (err) { alert('Ошибка: ' + err.message) }
        })
      })
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="4" style="color:var(--danger)">Ошибка: ${esc(err.message)}</td></tr>`
    }
  }

  function wireAddForm() {
    document.getElementById('btn-add-admin').addEventListener('click', async () => {
      const result = document.getElementById('add-result')
      const email = document.getElementById('new-email').value.trim()
      const password = document.getElementById('new-password').value
      const role = document.getElementById('new-role').value
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { result.style.color = 'var(--danger)'; result.textContent = 'Введите корректный email'; return }
      if (password.length < 8) { result.style.color = 'var(--danger)'; result.textContent = 'Пароль ≥ 8 символов'; return }
      result.style.color = 'var(--text-muted)'; result.textContent = 'Добавление…'
      try {
        await apiJSON('/api/admin/admins', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, role }),
        })
        result.style.color = 'var(--success)'; result.textContent = '✅ Администратор добавлен'
        document.getElementById('new-email').value = ''
        document.getElementById('new-password').value = ''
        loadAdmins()
      } catch (err) { result.style.color = 'var(--danger)'; result.textContent = 'Ошибка: ' + err.message }
    })
  }

  async function init() {
    me = await checkAuth()
    if (!me) { window.location.href = 'login.html'; return }
    if (me.role !== 'owner') {
      // Non-owners: read-only roster, no add form.
      document.getElementById('add-card').style.display = 'none'
      const note = document.getElementById('no-access')
      note.style.display = 'block'
      note.style.color = 'var(--text-muted)'
      note.textContent = 'Список команды доступен для просмотра. Управление — только у владельца (owner).'
    } else {
      wireAddForm()
    }
    loadAdmins()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
