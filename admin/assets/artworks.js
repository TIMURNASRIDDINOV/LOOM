'use strict'

/* LOOM Admin — designer artwork moderation.
   Cards instead of table rows: a graphic has to be SEEN before it can be
   judged, and a 32px thumbnail hides exactly the flaws (soft edges, baked-in
   background, stolen logos) the review exists to catch. */

;(function () {
  const { apiJSON, formatDate, formatPrice } = window.LOOM
  const { esc, toast, confirmDialog, apiErrorMessage } = window.LOOM_UI

  const PAGE_SIZE = 30
  let status = 'pending'
  let page = 1

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
        (a.tags ? '<div class="art-tags" title="' + esc(a.tags) + '">' + esc(a.tags) + '</div>' : '') +
        (a.status === 'rejected' && a.reject_note ? '<div class="art-note">' + esc(a.reject_note) + '</div>' : '') +
        '<div class="art-meta"><span>Загружена ' + esc(formatDate(a.created_at)) + '</span>' +
          (a.reviewed_at ? '<span>· проверена ' + esc(formatDate(a.reviewed_at)) + '</span>' : '') +
        '</div>' +
      '</div>' +
      actions +
    '</article>'
  }

  function render(data) {
    const grid = el('art-grid')
    const items = data.items || []
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

  async function load() {
    const grid = el('art-grid')
    grid.innerHTML = stateBlock('Загрузка…')
    try {
      const qs = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
      if (status) qs.set('status', status)
      const data = await apiJSON('/api/admin/artworks?' + qs)
      render(data)
    } catch (err) {
      if (err.status === 401) { window.location.href = 'login.html'; return }
      grid.innerHTML = stateBlock(esc(apiErrorMessage(err)), 'error')
    }
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
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null) })
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
        if (btn.dataset.act === 'approve') approve(btn.dataset.id, title)
        if (btn.dataset.act === 'reject') reject(btn.dataset.id, title)
        return
      }
      const thumb = e.target.closest('.art-thumb')
      if (thumb) lightbox(thumb.dataset.full)
    })

    el('refresh-btn').addEventListener('click', load)
    el('prev-btn').addEventListener('click', () => { if (page > 1) { page--; load() } })
    el('next-btn').addEventListener('click', () => { page++; load() })

    load()
  })
})()
