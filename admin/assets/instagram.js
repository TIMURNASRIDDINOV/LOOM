'use strict'

/* LOOM Admin — Instagram posts (PRD-213, LOOM-270).
   API: /api/admin/instagram/* (backend/src/routes/admin-instagram.ts).
   instagram.edit prepares posts; instagram.approve approves, retries and owns
   the kill switch. The server enforces both — hiding a button here is only
   so nobody clicks something that will be refused. */

;(function () {
  const { apiJSON, formatDate } = window.LOOM
  const { esc, toast, confirmDialog, apiErrorMessage } = window.LOOM_UI

  const el = (id) => document.getElementById(id)
  const posts = new Map()
  let canApprove = false

  const GROUPS = [
    ['draft', 'Черновики'],
    ['approved', 'Одобрены, ждут публикации'],
    ['publishing', 'Публикуются'],
    ['failed', 'Ошибка публикации'],
    ['published', 'Опубликованы'],
    ['rejected', 'Отклонены'],
  ]
  const STATUS_LABEL = { draft: 'Черновик', approved: 'Одобрен', publishing: 'Публикуется', published: 'Опубликован', failed: 'Ошибка', rejected: 'Отклонён' }
  const LANGS = [['uz', 'Oʻzbekcha'], ['ru', 'Русский'], ['en', 'English']]

  // Same limits and counting as backend/src/lib/instagram.ts — the server
  // re-checks on approve, this is only the live counter.
  const LIMITS = { chars: 2200, tags: 30, mentions: 20 }
  const HASHTAG = /(?:^|[^\p{L}\p{N}_&])#[\p{L}\p{N}_]+/gu
  const MENTION = /(?:^|[^\p{L}\p{N}_.])@[A-Za-z0-9._]+/gu

  function compose(captions, langs) {
    return LANGS.map(([l]) => l).filter((l) => langs.includes(l))
      .map((l) => (captions[l] || '').trim()).filter(Boolean).join('\n\n')
  }

  // Uzbekistan is UTC+5 all year (no DST), so Tashkent time is a fixed offset.
  const TASHKENT_MS = 5 * 3600 * 1000
  function toTashkentInput(iso) {
    return iso ? new Date(Date.parse(iso) + TASHKENT_MS).toISOString().slice(0, 16) : ''
  }
  function fromTashkentInput(value) {
    return value ? new Date(value + ':00+05:00').toISOString() : null
  }

  // ── List ──────────────────────────────────────────────────────────────
  function button(act, id, label, kind) {
    return '<button type="button" class="btn btn--sm' + (kind ? ' btn--' + kind : '') + '" data-act="' + act + '" data-id="' + id + '">' + label + '</button>'
  }

  function actions(p) {
    const b = []
    const editable = ['draft', 'approved', 'failed', 'rejected'].includes(p.status)
    if (editable) b.push(button('edit', p.id, 'Изменить'))
    if (p.status === 'draft' && canApprove) b.push(button('approve', p.id, 'Одобрить', 'primary'))
    if (p.status === 'failed' && canApprove) b.push(button('retry', p.id, 'Повторить'))
    if (p.status === 'approved' || p.status === 'rejected') b.push(button('draft', p.id, 'В черновик'))
    if (['draft', 'approved', 'failed'].includes(p.status)) b.push(button('reject', p.id, 'Отклонить', 'danger'))
    return b.length ? '<div class="ig-actions">' + b.join('') + '<p class="ig-note" role="alert" hidden></p></div>' : ''
  }

  function card(p) {
    const first = (p.caption || '').split('\n').find((line) => line.trim()) || 'Без подписи'
    const when = p.publish_at ? formatDate(p.publish_at) : 'Время не задано'
    return '<article class="card card--flush ig-card" data-id="' + p.id + '">' +
      '<div class="ig-thumb">' +
        (p.media_url ? '<img src="' + esc(p.media_url) + '" alt="" loading="lazy" />' : '<span class="ig-noimg">Нет изображения</span>') +
        '<span class="badge badge-' + esc(p.status) + '">' + esc(STATUS_LABEL[p.status] || p.status) + '</span>' +
      '</div>' +
      '<div class="ig-body">' +
        '<span class="ig-when">' + esc(when) + '</span>' +
        '<p class="ig-line" title="' + esc(first) + '">' + esc(first) + '</p>' +
        '<span class="ig-meta">' + esc((p.langs || []).join(' · ') || 'языки не выбраны') + (p.source === 'ai' ? ' · AI' : '') + '</span>' +
        (p.status === 'published' && p.permalink
          ? '<a class="ig-meta" href="' + esc(p.permalink) + '" target="_blank" rel="noopener noreferrer">Открыть в Instagram ↗</a>' : '') +
        (p.status === 'failed'
          ? '<p class="ig-note">' + esc(p.error || 'Ошибка без описания') + ' · попыток: ' + esc(p.attempts) + '</p>' : '') +
      '</div>' +
      actions(p) +
    '</article>'
  }

  function render(items) {
    posts.clear()
    items.forEach((p) => posts.set(p.id, p))
    el('page-info').textContent = items.length ? 'Постов: ' + items.length : ''
    if (!items.length) {
      el('ig-groups').innerHTML = '<div class="state"><p class="state-title">Постов пока нет</p>' +
        '<p class="state-sub">Нажмите «Новый пост», чтобы подготовить первый.</p></div>'
      return
    }
    el('ig-groups').innerHTML = GROUPS.map(([status, title]) => {
      const list = items.filter((p) => p.status === status)
        .sort((a, b) => (b.publish_at || '').localeCompare(a.publish_at || ''))
      if (!list.length) return ''
      return '<section class="ig-group" data-status="' + status + '"><h3 class="ig-group-title">' + esc(title) +
        ' <span class="count">' + list.length + '</span></h3><div class="ig-grid">' + list.map(card).join('') + '</div></section>'
    }).join('')
  }

  async function load() {
    el('ig-groups').innerHTML = '<div class="state">Загрузка…</div>'
    try {
      render((await apiJSON('/api/admin/instagram/posts')).items || [])
    } catch (err) {
      if (err.status === 401) { window.location.href = 'login.html'; return }
      el('ig-groups').innerHTML = '<div class="state state--error">' + esc(apiErrorMessage(err)) + '</div>'
    }
  }

  // ── Kill switch ───────────────────────────────────────────────────────
  async function loadSettings() {
    const input = el('switch-input')
    try {
      const s = await apiJSON('/api/admin/instagram/settings')
      el('ig-switch').className = 'notice ig-switch ' + (s.publish_paused ? 'notice--warning' : 'notice--success')
      el('switch-title').textContent = s.publish_paused ? 'Публикация на паузе' : 'Публикация включена'
      el('switch-sub').textContent = (s.token_configured ? 'Токен Instagram настроен.' : 'Токен Instagram не настроен — публиковать нечем.') +
        (s.updated_at ? ' Изменено ' + formatDate(s.updated_at) + '.' : '')
      if (input) { input.checked = !s.publish_paused; input.disabled = false }
    } catch (err) {
      el('ig-switch').className = 'notice ig-switch notice--danger'
      el('switch-title').textContent = 'Не удалось загрузить состояние публикации'
      el('switch-sub').textContent = apiErrorMessage(err)
    }
  }

  async function toggleSwitch(e) {
    const input = e.target
    const on = input.checked
    input.checked = !on // keep the old state until the server agrees
    if (on) {
      const ok = await confirmDialog({
        title: 'Включить публикацию?',
        body: 'Одобренные посты начнут уходить в Instagram в своё время, без дополнительных подтверждений.',
        confirmLabel: 'Включить',
      })
      if (!ok) return
    }
    input.disabled = true
    try {
      await apiJSON('/api/admin/instagram/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publish_paused: !on }),
      })
      toast(on ? 'Публикация включена' : 'Публикация на паузе', 'success')
    } catch (err) {
      toast(apiErrorMessage(err), 'error')
    }
    loadSettings()
  }

  // ── Status actions ────────────────────────────────────────────────────
  const ACTION_DONE = { approve: 'Пост одобрен', retry: 'Пост возвращён в черновик', reject: 'Пост отклонён', draft: 'Пост возвращён в черновик' }

  async function act(btn) {
    const action = btn.dataset.act
    const note = btn.parentElement.querySelector('.ig-note')
    if (action === 'reject' && !(await confirmDialog({ title: 'Отклонить пост?', confirmLabel: 'Отклонить', danger: true }))) return
    btn.disabled = true
    note.hidden = true
    try {
      await apiJSON('/api/admin/instagram/posts/' + btn.dataset.id + '/' + action, { method: 'POST' })
      toast(ACTION_DONE[action], 'success')
      load()
    } catch (err) {
      // 422 (approval rules) and 409 (status moved) explain themselves next to the button.
      note.textContent = apiErrorMessage(err)
      note.hidden = false
      btn.disabled = false
    }
  }

  // ── Editor ────────────────────────────────────────────────────────────
  function editor(post) {
    const p = post || { caption_uz: '', caption_ru: '', caption_en: '', langs: ['uz', 'ru', 'en'], media_key: null, media_url: null, publish_at: null, status: 'draft' }
    let mediaKey = p.media_key
    const previous = document.activeElement
    const backdrop = document.createElement('div')
    backdrop.className = 'dialog-backdrop'
    backdrop.innerHTML =
      '<form class="dialog ig-editor" role="dialog" aria-modal="true" aria-labelledby="ig-ed-title" novalidate>' +
        '<h2 class="dialog-title" id="ig-ed-title">' + (post ? 'Пост #' + post.id : 'Новый пост') + '</h2>' +
        LANGS.map(([l, name]) =>
          '<div class="field"><div class="ig-lang"><span class="field-label">Подпись · ' + l.toUpperCase() + ' — ' + name + '</span>' +
            '<label><input type="checkbox" name="lang_' + l + '"' + (p.langs.includes(l) ? ' checked' : '') + ' /> включить</label></div>' +
            '<textarea class="textarea" name="caption_' + l + '" maxlength="5000">' + esc(p['caption_' + l]) + '</textarea></div>').join('') +
        '<div class="ig-counter" aria-live="polite"><span data-count="chars"></span><span data-count="tags"></span><span data-count="mentions"></span></div>' +
        '<div class="field"><span class="field-label">Изображение (JPEG, до 8 МБ)</span>' +
          '<input type="file" class="input" name="file" accept="image/jpeg" />' +
          '<img class="ig-preview" alt="Предпросмотр"' + (p.media_url ? ' src="' + esc(p.media_url) + '"' : ' hidden') + ' /></div>' +
        '<div class="field"><label class="field-label" for="ig-ed-at">Время публикации (Ташкент)</label>' +
          '<input type="datetime-local" class="input" id="ig-ed-at" name="publish_at" value="' + esc(toTashkentInput(p.publish_at)) + '" /></div>' +
        '<p class="ig-note" role="alert" hidden></p>' +
        '<div class="dialog-actions"><button type="button" class="btn" data-cancel>Отмена</button>' +
        '<button type="submit" class="btn btn--primary">Сохранить</button></div>' +
      '</form>'
    document.body.appendChild(backdrop)
    const form = backdrop.querySelector('form')
    const error = form.querySelector('[role="alert"]')
    const preview = form.querySelector('.ig-preview')
    const submit = form.querySelector('[type="submit"]')
    let busy = false

    function values() {
      const langs = LANGS.map(([l]) => l).filter((l) => form.elements['lang_' + l].checked)
      return {
        caption_uz: form.elements.caption_uz.value, caption_ru: form.elements.caption_ru.value, caption_en: form.elements.caption_en.value,
        langs, publish_at: fromTashkentInput(form.elements.publish_at.value),
      }
    }

    function count() {
      const v = values()
      const text = compose({ uz: v.caption_uz, ru: v.caption_ru, en: v.caption_en }, v.langs)
      const n = { chars: text.length, tags: (text.match(HASHTAG) || []).length, mentions: (text.match(MENTION) || []).length }
      const label = { chars: 'символов', tags: 'хэштегов', mentions: 'упоминаний' }
      form.querySelectorAll('[data-count]').forEach((s) => {
        const k = s.dataset.count
        s.textContent = label[k] + ': ' + n[k].toLocaleString('ru-RU') + ' / ' + LIMITS[k].toLocaleString('ru-RU')
        s.classList.toggle('is-over', n[k] > LIMITS[k])
      })
    }

    function close() {
      if (busy) return
      document.removeEventListener('keydown', keydown, true)
      backdrop.remove()
      if (previous && previous.isConnected) previous.focus()
    }
    function keydown(e) { if (e.key === 'Escape') { e.preventDefault(); close() } }
    document.addEventListener('keydown', keydown, true)
    form.querySelector('[data-cancel]').addEventListener('click', close)
    form.addEventListener('input', count)
    count()
    form.elements.caption_uz.focus()

    form.elements.file.addEventListener('change', async (e) => {
      const file = e.target.files[0]
      if (!file) return
      error.hidden = true
      submit.disabled = true
      try {
        const body = new FormData()
        body.append('file', file)
        const res = await apiJSON('/api/admin/instagram/media', { method: 'POST', body })
        mediaKey = res.key
        preview.src = res.url
        preview.hidden = false
      } catch (err) {
        e.target.value = ''
        error.textContent = apiErrorMessage(err)
        error.hidden = false
      } finally {
        submit.disabled = false
      }
    })

    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      if (busy) return
      const v = values()
      const payload = {}
      Object.keys(v).forEach((k) => {
        const old = k === 'langs' ? p.langs.join(',') : p[k] || (k === 'publish_at' ? null : '')
        if (!post || (k === 'langs' ? v.langs.join(',') : v[k]) !== old) payload[k] = v[k]
      })
      if (mediaKey !== p.media_key) payload.media_key = mediaKey
      if (post && !Object.keys(payload).length) { close(); return }
      if (post && post.status === 'approved' && !(await confirmDialog({
        title: 'Пост вернётся в черновик',
        body: 'Изменённый пост нужно одобрить заново, иначе он не будет опубликован.',
        confirmLabel: 'Сохранить',
      }))) return
      busy = true
      submit.disabled = true
      error.hidden = true
      try {
        await apiJSON('/api/admin/instagram/posts' + (post ? '/' + post.id : ''), {
          method: post ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })
        busy = false
        close()
        toast('Сохранено', 'success')
        load()
      } catch (err) {
        error.textContent = apiErrorMessage(err)
        error.hidden = false
      } finally {
        busy = false
        submit.disabled = false
      }
    })
  }

  window.LOOM_LAYOUT.onReady((me, caps) => {
    canApprove = caps.has('instagram.approve')
    const input = el('switch-input')
    if (input) input.addEventListener('change', toggleSwitch)
    el('new-btn').addEventListener('click', () => editor(null))
    el('refresh-btn').addEventListener('click', () => { load(); loadSettings() })
    el('ig-groups').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]')
      if (!btn) return
      if (btn.dataset.act === 'edit') editor(posts.get(Number(btn.dataset.id)))
      else act(btn)
    })
    load()
    loadSettings()
  })
})()
