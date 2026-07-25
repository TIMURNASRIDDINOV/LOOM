'use strict'

/* LOOM Admin — Команда и доступы.

   The owner picks a role (which is a PRESET of capabilities) and then, if they
   want, deviates from that preset per capability. Those deviations are the
   "overrides" the API stores; a switch that matches its preset stores nothing,
   so changing someone's role later gives them the new role's defaults cleanly.

   Everyone else gets a read-only roster: seeing who has access is useful,
   changing it is not theirs to do. */

;(function () {
  const { apiJSON, checkAuth, formatDate } = window.LOOM
  const { toast, confirmDialog, apiErrorMessage, esc } = window.LOOM_UI
  const ROLE_LABELS = window.LOOM_LAYOUT.ROLE_LABELS

  let me = null
  let catalog = null           // groups / capabilities / presets / roles
  let admins = []
  let selectedId = null
  let draft = {}               // capability → boolean, the switch state being edited
  let baseline = {}            // the same, as last loaded from the server

  const el = (id) => document.getElementById(id)
  const isOwner = () => me && me.role === 'owner'

  // Russian needs three plural forms.
  function plural(n, one, few, many) {
    const mod10 = n % 10, mod100 = n % 100
    const form = (mod10 === 1 && mod100 !== 11) ? one
      : (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) ? few
      : many
    return n + ' ' + form
  }

  function selected() {
    return admins.filter((a) => a.id === selectedId)[0] || null
  }

  // Effective state of one capability for the member being edited.
  function presetHas(admin, cap) {
    return (admin.preset || catalog.presets[admin.role] || []).indexOf(cap) !== -1
  }

  // ── Roster ────────────────────────────────────────────────────────────
  function renderRoster() {
    const root = el('roster')
    if (!admins.length) {
      root.innerHTML = '<div class="state">Нет администраторов</div>'
      return
    }
    root.innerHTML = admins.map((a) => {
      const overrideCount = Object.keys(a.overrides || {}).length
      const meta = [ROLE_LABELS[a.role] || a.role]
      if (a.id === (me && me.id)) meta.push('это вы')
      else if (overrideCount) meta.push(overrideCount + ' изм.')
      return '<button type="button" class="roster-item" data-id="' + a.id + '"' +
        (a.id === selectedId ? ' aria-current="true"' : '') + '>' +
        '<span class="avatar" aria-hidden="true">' + esc((a.email || '?').charAt(0)) + '</span>' +
        '<span class="roster-body">' +
          '<span class="roster-email">' + esc(a.email) + '</span>' +
          '<span class="roster-meta">' + esc(meta.join(' · ')) + '</span>' +
        '</span>' +
      '</button>'
    }).join('')

    root.querySelectorAll('.roster-item').forEach((btn) => {
      btn.addEventListener('click', () => select(parseInt(btn.dataset.id, 10)))
    })
  }

  // ── Detail ────────────────────────────────────────────────────────────
  async function select(id) {
    // Switching members mid-edit would silently drop the pending toggles.
    if (selectedId !== null && id !== selectedId && hasChanges()) {
      const leave = await confirmDialog({
        title: 'Изменения не сохранены',
        body: 'Права, которые вы переключили, не сохранены. Перейти к другому участнику и потерять их?',
        confirmLabel: 'Перейти без сохранения',
        danger: true,
      })
      if (!leave) return
    }

    selectedId = id
    const admin = selected()
    if (!admin) return

    baseline = {}
    catalog.capabilities.forEach((c) => {
      baseline[c.id] = (admin.capabilities || []).indexOf(c.id) !== -1
    })
    draft = Object.assign({}, baseline)

    renderRoster()
    renderDetail()
  }

  function renderDetail() {
    const admin = selected()
    el('detail-empty').hidden = true
    el('detail').hidden = false

    const isSelf = admin.id === (me && me.id)
    const targetIsOwner = admin.role === 'owner'
    // The owner cannot edit their own row (nothing to change) nor another
    // owner's (there is only ever one). Everyone else is editable by the owner.
    const editable = isOwner() && !isSelf && !targetIsOwner

    el('d-email').textContent = admin.email
    el('d-meta').textContent = 'Добавлен ' + formatDate(admin.created_at)
    const badge = el('d-role-badge')
    badge.textContent = ROLE_LABELS[admin.role] || admin.role
    badge.className = 'badge badge-role-' + admin.role

    el('d-self-note').hidden = !isSelf
    el('d-owner-note').hidden = !targetIsOwner || isSelf

    el('role-card').hidden = !editable
    el('perm-card').hidden = !(isOwner() && !targetIsOwner)
    el('danger-card').hidden = !editable

    if (editable) renderRoleOptions(admin)
    if (isOwner() && !targetIsOwner) renderPermissions(admin, editable)
  }

  function renderRoleOptions(admin) {
    el('role-options').innerHTML = catalog.roles
      .filter((r) => r.id !== 'owner')   // ownership moves via transfer, not a radio
      .map((r) =>
        '<label class="role-option">' +
          '<input type="radio" name="role" value="' + esc(r.id) + '"' + (admin.role === r.id ? ' checked' : '') + ' />' +
          '<span>' +
            '<span class="role-option-title">' + esc(r.label) + '</span>' +
            '<span class="role-option-desc">' + esc(r.description) + '</span>' +
          '</span>' +
        '</label>').join('')

    el('role-options').querySelectorAll('input[name="role"]').forEach((input) => {
      input.addEventListener('change', () => changeRole(input.value))
    })
  }

  function renderPermissions(admin, editable) {
    const byGroup = {}
    catalog.capabilities.forEach((c) => { (byGroup[c.group] ??= []).push(c) })

    el('perm-sub').textContent = editable
      ? 'Переключатели поверх роли «' + (ROLE_LABELS[admin.role] || admin.role) + '». «Изменено» — право, которое вы задали вручную.'
      : 'Права этого администратора. Изменять может только владелец.'
    el('btn-reset-perms').hidden = !editable

    el('perm-groups').innerHTML = catalog.groups.map((g) => {
      const caps = byGroup[g.id] || []
      if (!caps.length) return ''
      return '<div class="perm-group">' +
        '<p class="perm-group-title">' + esc(g.label) + '</p>' +
        caps.map((c) => {
          const on = !!draft[c.id]
          const changed = on !== presetHas(admin, c.id)
          return '<label class="switch-row' + (editable ? '' : ' is-disabled') + '">' +
            '<span class="switch">' +
              '<input type="checkbox" data-cap-toggle="' + esc(c.id) + '"' +
                (on ? ' checked' : '') + (editable ? '' : ' disabled') + ' />' +
              '<span class="track" aria-hidden="true"></span><span class="knob" aria-hidden="true"></span>' +
            '</span>' +
            '<span class="switch-text">' +
              '<span class="switch-label">' + esc(c.label) +
                (changed ? '<span class="perm-tag">изменено</span>' : '') +
              '</span>' +
              '<span class="switch-desc">' + esc(c.description) + '</span>' +
            '</span>' +
          '</label>'
        }).join('') +
      '</div>'
    }).join('')

    if (editable) {
      el('perm-groups').querySelectorAll('[data-cap-toggle]').forEach((input) => {
        input.addEventListener('change', () => {
          draft[input.dataset.capToggle] = input.checked
          renderPermissions(admin, editable)   // refresh the «изменено» tags
          updateSaveBar()
        })
      })
    }
    updateSaveBar()
  }

  function hasChanges() {
    return catalog && catalog.capabilities.some((c) => !!draft[c.id] !== !!baseline[c.id])
  }

  function updateSaveBar() {
    const admin = selected()
    if (!admin) return
    const dirty = hasChanges()
    const overrides = catalog.capabilities.filter((c) => !!draft[c.id] !== presetHas(admin, c.id)).length

    // The action bar exists only while something is pending; the steady-state
    // summary lives in the card header where it does not cover anything.
    el('save-bar').hidden = !dirty
    document.body.classList.toggle('has-unsaved', dirty)
    el('perm-status').textContent = overrides
      ? plural(overrides, 'право отличается', 'права отличаются', 'прав отличаются') + ' от роли'
      : 'Всё как в роли — индивидуальных настроек нет'
  }

  // ── Mutations ─────────────────────────────────────────────────────────
  async function changeRole(role) {
    const admin = selected()
    const ok = await confirmDialog({
      title: 'Сменить роль на «' + (ROLE_LABELS[role] || role) + '»?',
      body: 'Индивидуальные настройки прав для ' + admin.email + ' будут сброшены к правам новой роли.',
      confirmLabel: 'Сменить роль',
    })
    if (!ok) { renderRoleOptions(admin); return }

    try {
      await apiJSON('/api/admin/admins/' + admin.id + '/role', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      toast('Роль обновлена', 'success')
      await loadAdmins()
      select(admin.id)
    } catch (err) {
      toast(apiErrorMessage(err), 'error')
      renderRoleOptions(admin)
    }
  }

  async function savePermissions() {
    const admin = selected()
    // Send the full picture: an explicit true/false where the switch differs
    // from the preset, and null where it matches so the row is deleted and the
    // capability goes back to simply inheriting.
    const overrides = {}
    catalog.capabilities.forEach((c) => {
      const on = !!draft[c.id]
      overrides[c.id] = on === presetHas(admin, c.id) ? null : on
    })

    el('btn-save-perms').disabled = true
    try {
      const res = await apiJSON('/api/admin/admins/' + admin.id + '/permissions', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides }),
      })
      admin.overrides = res.overrides
      admin.capabilities = res.capabilities
      baseline = Object.assign({}, draft)
      toast('Права сохранены', 'success')
      renderRoster()
      renderPermissions(admin, true)
    } catch (err) {
      toast(apiErrorMessage(err), 'error')
      el('btn-save-perms').disabled = false
    }
  }

  function resetToPreset() {
    const admin = selected()
    catalog.capabilities.forEach((c) => { draft[c.id] = presetHas(admin, c.id) })
    renderPermissions(admin, true)
  }

  function discard() {
    draft = Object.assign({}, baseline)
    renderPermissions(selected(), true)
  }

  async function transferOwnership() {
    const admin = selected()
    const ok = await confirmDialog({
      title: 'Передать владение ' + admin.email + '?',
      body: 'Этот администратор получит полный доступ, включая управление командой. ' +
            'Вы станете менеджером и больше не сможете менять права других.',
      confirmLabel: 'Передать владение',
      danger: true,
    })
    if (!ok) return
    try {
      await apiJSON('/api/admin/admins/' + admin.id + '/role', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'owner' }),
      })
      toast('Владение передано', 'success')
      setTimeout(() => location.reload(), 700)   // we are no longer the owner
    } catch (err) {
      toast(apiErrorMessage(err), 'error')
    }
  }

  async function removeAdmin() {
    const admin = selected()
    const ok = await confirmDialog({
      title: 'Удалить администратора?',
      body: admin.email + ' сразу потеряет доступ в админку. Отменить это действие нельзя.',
      confirmLabel: 'Удалить',
      danger: true,
    })
    if (!ok) return
    try {
      await apiJSON('/api/admin/admins/' + admin.id, { method: 'DELETE' })
      toast('Администратор удалён', 'success')
      selectedId = null
      el('detail').hidden = true
      el('detail-empty').hidden = false
      await loadAdmins()
    } catch (err) {
      toast(apiErrorMessage(err), 'error')
    }
  }

  // ── Invite ────────────────────────────────────────────────────────────
  function generatePassword() {
    // Ambiguous glyphs (0/O, 1/l/I) removed — this gets read aloud or retyped.
    const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const bytes = new Uint32Array(14)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
  }

  async function addAdmin() {
    const email = el('new-email').value.trim()
    const password = el('new-password').value
    const role = el('new-role').value
    const result = el('invite-result')

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('Введите корректный email', 'error'); return }
    if (password.length < 8) { toast('Пароль должен быть не короче 8 символов', 'error'); return }

    try {
      const res = await apiJSON('/api/admin/admins', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, role }),
      })
      result.hidden = false
      result.innerHTML =
        '<b>Учётная запись создана.</b> Передайте эти данные сотруднику:' +
        '<span class="credential"><code>' + esc(email) + '</code><code>' + esc(password) + '</code>' +
        '<button type="button" class="btn btn--sm" id="btn-copy-cred">Скопировать</button></span>'
      el('btn-copy-cred').addEventListener('click', () => {
        navigator.clipboard.writeText(email + ' / ' + password)
          .then(() => toast('Скопировано', 'success'))
          .catch(() => toast('Не удалось скопировать', 'error'))
      })
      el('new-email').value = ''
      el('new-password').value = ''
      toast('Администратор добавлен', 'success')
      await loadAdmins()
      select(res.id)
    } catch (err) {
      toast(apiErrorMessage(err), 'error')
    }
  }

  // ── Boot ──────────────────────────────────────────────────────────────
  async function loadAdmins() {
    const { admins: list } = await apiJSON('/api/admin/admins')
    admins = list
    renderRoster()
  }

  function wire() {
    el('btn-save-perms').addEventListener('click', savePermissions)
    el('btn-discard').addEventListener('click', discard)
    el('btn-reset-perms').addEventListener('click', resetToPreset)
    el('btn-transfer').addEventListener('click', transferOwnership)
    el('btn-remove').addEventListener('click', removeAdmin)
    el('btn-gen-password').addEventListener('click', () => {
      el('new-password').value = generatePassword()
    })
    el('btn-add-admin').addEventListener('click', addAdmin)
    el('btn-show-invite').addEventListener('click', () => {
      el('invite-card').hidden = false
      el('new-password').value = generatePassword()
      el('new-email').focus()
    })
    el('btn-hide-invite').addEventListener('click', () => {
      el('invite-card').hidden = true
      el('invite-result').hidden = true
    })
    window.addEventListener('beforeunload', (e) => {
      if (hasChanges()) { e.preventDefault(); e.returnValue = '' }
    })
  }

  async function init() {
    me = await checkAuth()
    if (!me) { window.location.href = 'login.html'; return }

    el('readonly-flag').hidden = isOwner()
    el('btn-show-invite').hidden = !isOwner()

    try {
      catalog = await apiJSON('/api/admin/permissions/catalog')
      await loadAdmins()
      wire()
      // Open on someone useful straight away rather than an empty right pane.
      const first = admins.filter((a) => a.id !== me.id)[0] || admins[0]
      if (first) select(first.id)
    } catch (err) {
      el('roster').innerHTML = '<div class="state state--error">' + esc(apiErrorMessage(err)) + '</div>'
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
