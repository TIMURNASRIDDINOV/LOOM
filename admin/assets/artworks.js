'use strict'

/* LOOM Admin — designer artwork moderation.
   Cards instead of table rows: a graphic has to be SEEN before it can be
   judged, and a 32px thumbnail hides exactly the flaws (soft edges, baked-in
   background, stolen logos) the review exists to catch. */

;(function () {
  const { apiJSON, formatDate, formatPrice, formatPhone } = window.LOOM
  const { esc, toast, confirmDialog, apiErrorMessage } = window.LOOM_UI

  const PAGE_SIZE = 30
  let status = 'pending'
  let page = 1
  let categories = []
  let categoriesError = ''
  const artworks = new Map()
  let canEdit = false
  const TITLE_ERROR = 'Название должно содержать от 1 до 80 символов.'
  const NAMES_ERROR = 'Укажите названия на ru, uz и en (до 80 символов).'

  const el = (id) => document.getElementById(id)

  const STATUS_LABEL = { pending: 'На проверке', approved: 'Опубликована', rejected: 'Отклонена' }

  function statusBadge(s) {
    return '<span class="badge badge-' + esc(s) + '">' + esc(STATUS_LABEL[s] || s) + '</span>'
  }

  function stateBlock(html, kind) {
    return '<div class="state' + (kind ? ' state--' + kind : '') + '" style="grid-column:1/-1">' + html + '</div>'
  }

  function canReview() {
    return !!document.body.dataset.capArtworksReview
  }

  function categoryName(id) {
    const cat = categories.find((c) => c.id === id)
    return cat ? cat.name_ru : id ? 'Категория #' + id : 'Без категории'
  }

  // Only a press that starts and ends on the backdrop closes a dialog, so a
  // text selection dragged out of a field keeps what was typed.
  function closeOnBackdrop(backdrop, close) {
    let pressed = false
    backdrop.addEventListener('mousedown', (e) => { pressed = e.button === 0 && e.target === backdrop })
    backdrop.addEventListener('mouseup', (e) => { if (pressed && e.target === backdrop) close() })
  }

  function card(a) {
    const dims = a.width && a.height ? a.width + '×' + a.height : '—'
    const sold = a.sold ? '<span>Продано: <b>' + a.sold + '</b></span>' : ''
    const actions = a.status === 'pending' && canReview()
      ? '<div class="art-actions">' +
          '<button type="button" class="btn btn--sm btn--primary" data-act="approve" data-id="' + a.id + '">Опубликовать</button>' +
          '<button type="button" class="btn btn--sm btn--danger" data-act="reject" data-id="' + a.id + '">Отклонить</button>' +
        '</div>'
      : a.status === 'rejected' && canReview()
        ? '<div class="art-actions"><button type="button" class="btn btn--sm" data-act="approve" data-id="' + a.id + '">Всё-таки опубликовать</button></div>'
        : a.status === 'approved' && canReview()
          ? '<div class="art-actions"><button type="button" class="btn btn--sm" data-act="reject" data-id="' + a.id + '">Снять с публикации</button></div>'
          : ''

    return '<article class="card card--flush art-card" data-id="' + a.id + '">' +
      '<div class="art-thumb" data-full="' + esc(a.image_url) + '" title="Открыть в полном размере">' +
        '<img src="' + esc(a.image_url) + '" alt="" loading="lazy" />' +
        statusBadge(a.status) +
      '</div>' +
      '<div class="art-body">' +
        '<h3 class="art-title" title="' + esc(a.title) + '">' + esc(a.title) + '</h3>' +
        '<div class="art-meta">' +
          '<span class="mono">' + esc(a.author) + '</span>' +
          '<span>·</span><span class="mono">' + esc(dims) + ' px</span>' +
          '<span>·</span><span>+' + esc(formatPrice(a.markup)) + '</span>' +
          sold +
        '</div>' +
        '<div class="art-meta">' + esc(categoryName(a.category_id)) + '</div>' +
        (a.tags ? '<div class="art-tags" title="' + esc(a.tags) + '">' + esc(a.tags) + '</div>' : '') +
        (a.status === 'rejected' && a.reject_note ? '<div class="art-note">' + esc(a.reject_note) + '</div>' : '') +
        '<div class="art-meta"><span>Загружена ' + esc(formatDate(a.created_at)) + '</span>' +
          (a.reviewed_at ? '<span>· проверена ' + esc(formatDate(a.reviewed_at)) + '</span>' : '') +
        '</div>' +
      '</div>' +
      (canEdit ? '<div class="art-actions"><button type="button" class="btn btn--sm" data-act="edit" data-id="' + a.id + '">Изменить</button></div>' : '') +
      actions +
    '</article>'
  }

  function render(data) {
    const grid = el('art-grid')
    const items = data.items || []
    artworks.clear()
    items.forEach((a) => artworks.set(a.id, a))
    el('count-pending').textContent = data.pending ? data.pending : ''

    if (!items.length) {
      grid.innerHTML = stateBlock(
        '<p class="state-title">' + (status === 'pending' ? 'Очередь пуста' : 'Здесь пока ничего нет') + '</p>' +
        '<p class="state-sub">' + (status === 'pending'
          ? 'Все загруженные работы проверены. Новые появятся здесь, как только дизайнер отправит их из приложения.'
          : 'Работы с этим статусом появятся здесь после модерации.') + '</p>',
      )
    } else {
      grid.innerHTML = items.map(card).join('')
    }

    const from = data.total ? (data.page - 1) * data.limit + 1 : 0
    const to = Math.min(data.page * data.limit, data.total)
    el('page-info').textContent = data.total ? from + '–' + to + ' из ' + data.total : 'Нет записей'
    el('prev-btn').disabled = data.page <= 1
    el('next-btn').disabled = to >= data.total
  }

  // Categories are optional here: moderation must work while they fail.
  async function loadCategories() {
    try {
      categories = (await apiJSON('/api/admin/artwork-categories')).items || []
      categoriesError = ''
    } catch (err) {
      categoriesError = apiErrorMessage(err)
    }
    renderCategories()
  }

  async function load() {
    const grid = el('art-grid')
    grid.innerHTML = stateBlock('Загрузка…')
    const taxonomy = loadCategories()
    try {
      const qs = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
      if (status) qs.set('status', status)
      const data = await apiJSON('/api/admin/artworks?' + qs)
      await taxonomy
      render(data)
    } catch (err) {
      if (err.status === 401) { window.location.href = 'login.html'; return }
      grid.innerHTML = stateBlock(esc(apiErrorMessage(err)), 'error')
    }
  }

  function field(label, name, value, attrs) {
    return '<label class="art-field">' + esc(label) + '<input class="input" name="' + name + '" value="' + esc(value) + '" ' + (attrs || '') + ' /></label>'
  }

  // One form dialog for metadata and categories. A failed request leaves it open.
  function editDialog(title, fields, save) {
    const previous = document.activeElement
    const backdrop = document.createElement('div')
    backdrop.className = 'dialog-backdrop'
    backdrop.innerHTML = '<form class="dialog" role="dialog" aria-modal="true" aria-labelledby="art-edit-title" novalidate>' +
      '<h2 class="dialog-title" id="art-edit-title">' + esc(title) + '</h2>' + fields +
      '<p class="art-note" role="alert" hidden></p>' +
      '<div class="dialog-actions"><button type="button" class="btn" data-cancel>Отмена</button>' +
      '<button type="submit" class="btn btn--primary">Сохранить</button></div></form>'
    document.body.appendChild(backdrop)
    const form = backdrop.querySelector('form')
    let busy = false
    function close() {
      if (busy) return
      document.removeEventListener('keydown', keydown, true)
      backdrop.remove()
      if (previous && previous.isConnected) previous.focus()
    }
    function keydown(e) {
      if (e.key === 'Escape') { e.preventDefault(); close() }
      if (e.key === 'Tab') {
        const controls = Array.from(form.querySelectorAll('input, select, button')).filter((n) => !n.disabled)
        const first = controls[0], last = controls[controls.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', keydown, true)
    closeOnBackdrop(backdrop, close)
    form.querySelector('[data-cancel]').addEventListener('click', close)
    form.querySelector('input, select').focus()
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      form.querySelectorAll('[data-blank]').forEach((input) => input.setCustomValidity(input.value.trim() ? '' : input.dataset.blank))
      if (busy || !form.reportValidity()) return
      busy = true
      const button = form.querySelector('[type="submit"]')
      button.disabled = true
      const error = form.querySelector('[role="alert"]')
      error.hidden = true
      try {
        await save(new FormData(form))
        busy = false
        close()
        toast('Сохранено', 'success')
        load()
      } catch (err) {
        error.textContent = apiErrorMessage(err)
        error.hidden = false
      } finally {
        busy = false
        button.disabled = false
      }
    })
    return form
  }

  function editArtwork(a) {
    if (!a || !canEdit) return
    const options = '<option value="">Выберите категорию</option>' + categories
      .filter((cat) => cat.active || cat.id === a.category_id)
      .map((cat) => '<option value="' + cat.id + '"' + (cat.id === a.category_id ? ' selected' : '') + '>' + esc(cat.name_ru) + (cat.active ? '' : ' (неактивна)') + '</option>').join('')
    // Without the list the current category is kept; it cannot be changed.
    // A work with no category cannot be saved until the list loads.
    const keepCategory = !!categoriesError
    const blocked = keepCategory && !a.category_id
    const category = keepCategory
      ? '<label class="art-field">Категория<select class="input" disabled><option>' + esc(categoryName(a.category_id)) + '</option></select></label>' +
        '<p class="art-note">' + (blocked
          ? 'Категории не загрузились, а у работы нет категории — без неё изменения не сохранить. Закройте окно, нажмите «Повторить» в разделе категорий и откройте работу снова.'
          : 'Категории не загрузились — текущая сохранится. Нажмите «Повторить» в разделе категорий.') + '</p>'
      : '<label class="art-field">Категория<select class="input" name="category_id" required>' + options + '</select></label>'
    const form = editDialog('Изменить работу',
      field('Название', 'title', a.title, 'required maxlength="80" data-blank="' + esc(TITLE_ERROR) + '"') +
      field('Наценка дизайнера, сум (0 — бесплатно)', 'markup', a.markup, 'type="number" min="0" max="200000" step="1" required') +
      field('Теги', 'tags', a.tags || '', 'maxlength="200"') + category +
      '<p class="dialog-body">Статус публикации сохранится. Новая наценка применяется при следующем расчёте покупки; прошлые продажи не меняются.</p>',
      (data) => apiJSON('/api/admin/artworks/' + a.id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: data.get('title'), markup: Number(data.get('markup')), tags: data.get('tags'), category_id: keepCategory ? a.category_id : Number(data.get('category_id')) }),
      }))
    form.querySelector('[type="submit"]').disabled = blocked
  }

  function editCategory(cat) {
    if (!canEdit) return
    editDialog(cat ? 'Изменить категорию' : 'Новая категория',
      field('Название · RU', 'name_ru', cat ? cat.name_ru : '', 'required maxlength="80" data-blank="' + esc(NAMES_ERROR) + '"') +
      field('Название · UZ', 'name_uz', cat ? cat.name_uz : '', 'required maxlength="80" data-blank="' + esc(NAMES_ERROR) + '"') +
      field('Название · EN', 'name_en', cat ? cat.name_en : '', 'required maxlength="80" data-blank="' + esc(NAMES_ERROR) + '"') +
      '<label class="art-field"><span><input type="checkbox" name="active"' + (!cat || cat.active ? ' checked' : '') + ' /> Доступна для новых загрузок</span></label>',
      (data) => apiJSON('/api/admin/artwork-categories' + (cat ? '/' + cat.id : ''), {
        method: cat ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name_ru: data.get('name_ru'), name_uz: data.get('name_uz'), name_en: data.get('name_en'), active: data.has('active') }),
      }))
  }

  function renderCategories() {
    if (categoriesError) {
      el('category-list').innerHTML = '<div class="state state--error">' + esc(categoriesError) +
        ' <button class="btn btn--sm" type="button" data-retry-categories>Повторить</button></div>'
      return
    }
    el('category-list').innerHTML = categories.map((cat) =>
      '<div class="art-category"><span>' + esc(cat.name_ru) + ' / ' + esc(cat.name_uz) + ' / ' + esc(cat.name_en) +
      (cat.active ? '' : ' · Неактивна') + '</span>' + (canEdit ? '<button class="btn btn--sm" type="button" data-category="' + cat.id + '">Изменить</button>' : '') + '</div>').join('')
  }

  // ── Review actions ─────────────────────────────────────────────────────
  async function approve(id, title) {
    const ok = await confirmDialog({
      title: 'Опубликовать работу?',
      body: '«' + title + '» появится в маркетплейсе и в студии у всех покупателей. Дизайнер получит уведомление в Telegram.',
      confirmLabel: 'Опубликовать',
    })
    if (!ok) return
    try {
      await apiJSON('/api/admin/artworks/' + id + '/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approve' }),
      })
      toast('Работа опубликована', 'success')
      load()
    } catch (err) {
      toast(apiErrorMessage(err), 'error')
    }
  }

  // A rejection needs a reason, so this is a small bespoke dialog rather than
  // the shared yes/no one.
  function rejectDialog(title) {
    return new Promise((resolve) => {
      const previous = document.activeElement
      const backdrop = document.createElement('div')
      backdrop.className = 'dialog-backdrop'
      backdrop.innerHTML =
        '<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="rj-title">' +
          '<h2 class="dialog-title" id="rj-title">Отклонить «' + esc(title) + '»</h2>' +
          '<p class="dialog-body">Причину увидит дизайнер в приложении и в Telegram. Напишите, что исправить.</p>' +
          '<textarea class="textarea" id="rj-note" maxlength="500" placeholder="Например: фон не прозрачный, по краям видна белая рамка"></textarea>' +
          '<div class="dialog-actions">' +
            '<button type="button" class="btn" data-act="cancel">Отмена</button>' +
            '<button type="button" class="btn btn--danger" data-act="ok">Отклонить</button>' +
          '</div>' +
        '</div>'
      document.body.appendChild(backdrop)
      const note = backdrop.querySelector('#rj-note')
      note.focus()

      function close(result) {
        document.removeEventListener('keydown', onKey, true)
        backdrop.remove()
        if (previous && previous.focus) previous.focus()
        resolve(result)
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(null) }
      }
      document.addEventListener('keydown', onKey, true)
      closeOnBackdrop(backdrop, () => close(null))
      backdrop.querySelector('[data-act="cancel"]').addEventListener('click', () => close(null))
      backdrop.querySelector('[data-act="ok"]').addEventListener('click', () => {
        const v = note.value.trim()
        if (!v) { note.focus(); note.classList.add('is-invalid'); return }
        close(v)
      })
    })
  }

  async function reject(id, title) {
    const note = await rejectDialog(title)
    if (!note) return
    try {
      await apiJSON('/api/admin/artworks/' + id + '/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'reject', note }),
      })
      toast('Работа отклонена, дизайнер уведомлён', 'success')
      load()
    } catch (err) {
      toast(apiErrorMessage(err), 'error')
    }
  }

  // ── Payout ledger ─────────────────────────────────────────────────────
  async function loadPayouts() {
    const tbody = el('payouts-tbody')
    try {
      const data = await apiJSON('/api/admin/designers/payouts')
      el('payout-share').textContent = String(100 - (data.commission_pct || 30))
      const tot = data.totals || {}
      const kpi = (label, value) =>
        '<div class="stat"><p class="stat-label">' + esc(label) + '</p><p class="stat-value">' + esc(value) + '</p></div>'
      el('payout-totals').innerHTML =
        kpi('К выплате сейчас', formatPrice(tot.payable || 0)) +
        kpi('В работе', formatPrice(tot.pending || 0)) +
        kpi('Начислено всего', formatPrice(tot.earned || 0) + ' · ' + (tot.units_sold || 0) + ' шт.')

      const rows = data.designers || []
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="8"><div class="state"><p class="state-title">Дизайнеров пока нет</p><p class="state-sub">Как только кто-то станет дизайнером в приложении, он появится здесь.</p></div></td></tr>'
        return
      }
      tbody.innerHTML = rows.map((r) => {
        const contact = r.telegram_username ? '@' + r.telegram_username : (r.phone ? formatPhone(r.phone) : '—')
        return '<tr>' +
          '<td><b>' + esc(r.designer_handle || r.name || '#' + r.user_id) + '</b>' + (r.name && r.designer_handle ? '<div class="muted" style="font-size:var(--fs-sm)">' + esc(r.name) + '</div>' : '') + '</td>' +
          '<td class="num muted">' + esc(contact) + '</td>' +
          '<td class="num right">' + r.works_approved + '</td>' +
          '<td class="num right">' + r.units_sold + '</td>' +
          '<td class="num right">' + esc(formatPrice(r.earned)) + '</td>' +
          '<td class="num right muted">' + esc(formatPrice(r.pending)) + '</td>' +
          '<td class="num right"' + (r.payable > 0 ? ' style="color:var(--success);font-weight:600"' : '') + '>' + esc(formatPrice(r.payable)) + '</td>' +
          '<td class="muted">' + (r.last_sale_at ? esc(formatDate(r.last_sale_at)) : '—') + '</td>' +
        '</tr>'
      }).join('')
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="8"><div class="state state--error">' + esc(apiErrorMessage(err)) + '</div></td></tr>'
    }
  }

  function lightbox(src) {
    const box = document.createElement('div')
    box.className = 'lightbox'
    box.innerHTML = '<img src="' + esc(src) + '" alt="" />'
    box.addEventListener('click', () => box.remove())
    document.body.appendChild(box)
  }

  window.LOOM_LAYOUT.onReady((me) => {
    // Mirror the capability onto <body> so card actions can read it cheaply.
    const caps = (me && me.capabilities) || []
    canEdit = caps.includes('artworks.edit') || (me && me.role === 'owner')
    el('new-category-btn').hidden = !canEdit
    el('new-category-btn').addEventListener('click', () => editCategory(null))
    el('category-list').addEventListener('click', (e) => {
      if (e.target.closest('[data-retry-categories]')) { load(); return }
      const btn = e.target.closest('[data-category]')
      if (btn) editCategory(categories.find((cat) => cat.id === Number(btn.dataset.category)))
    })
    if (caps.includes('artworks.review') || (me && me.role === 'owner')) {
      document.body.dataset.capArtworksReview = '1'
    }

    el('status-tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.tab')
      if (!tab) return
      status = tab.dataset.status
      page = 1
      el('status-tabs').querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)))
      load()
    })

    el('art-grid').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]')
      if (btn) {
        const cardEl = btn.closest('.art-card')
        const title = cardEl ? cardEl.querySelector('.art-title').textContent : ''
        if (btn.dataset.act === 'edit') editArtwork(artworks.get(Number(btn.dataset.id)))
        if (btn.dataset.act === 'approve') approve(btn.dataset.id, title)
        if (btn.dataset.act === 'reject') reject(btn.dataset.id, title)
        return
      }
      const thumb = e.target.closest('.art-thumb')
      if (thumb) lightbox(thumb.dataset.full)
    })

    el('refresh-btn').addEventListener('click', () => { load(); loadPayouts() })
    el('prev-btn').addEventListener('click', () => { if (page > 1) { page--; load() } })
    el('next-btn').addEventListener('click', () => { page++; load() })

    load()
    loadPayouts()
  })
})()
