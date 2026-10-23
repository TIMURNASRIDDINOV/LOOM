'use strict'

/* LOOM Admin — Instagram posts (PRD-213, LOOM-270).
   API: /api/admin/instagram/* (backend/src/routes/admin-instagram.ts).
   instagram.edit prepares posts; instagram.approve approves, retries and owns
   the kill switch. The server enforces both — hiding a button here is only
   so nobody clicks something that will be refused.
   Ads tab (LOOM-277): targeting, "create paused ad" and spend vs the monthly
   cap. Nothing on this page switches an ad on — Tim does that in Ads Manager. */

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

  // Suggested slots (LOOM-274): ranked on the server from stored insights.
  const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
  async function suggestions(box, input) {
    try {
      const s = await apiJSON('/api/admin/instagram/suggested-times')
      const n = s.posts
      box.innerHTML = s.slots.map((slot) =>
        '<button type="button" class="btn btn--sm" data-at="' + esc(slot.next_at) + '"' +
          (slot.mean_reach != null ? ' title="Средний охват: ' + esc(slot.mean_reach) + '"' : '') + '>' +
          WEEKDAYS[slot.weekday] + ' ' + String(slot.hour).padStart(2, '0') + ':00</button>').join('') +
        '<span class="ig-meta">' + (s.basis === 'default' ? 'по умолчанию'
          : 'по данным ' + n + (n % 10 === 1 && n % 100 !== 11 ? ' поста' : ' постов')) + '</span>'
      box.hidden = false
      box.addEventListener('click', (e) => {
        const chip = e.target.closest('button[data-at]')
        if (!chip) return
        input.value = toTashkentInput(chip.dataset.at)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    } catch {
      // Suggestions are a convenience; the time picker works without them.
    }
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
    if (p.status === 'published' && canApprove) b.push(button('promote', p.id, 'Создать рекламу (на паузе)'))
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
        (s.updated_at ? ' Изменено ' + formatDate(s.updated_at) + '.' : '') +
        (s.ai_batch && s.ai_batch.message ? ' ' + s.ai_batch.message + (s.ai_batch.week ? ' (' + s.ai_batch.week + ').' : '.') : '')
      if (input) { input.checked = !s.publish_paused; input.disabled = false }
      if (s.ads_targeting) fillTargeting(s.ads_targeting)
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
          '<input type="datetime-local" class="input" id="ig-ed-at" name="publish_at" value="' + esc(toTashkentInput(p.publish_at)) + '" />' +
          '<div class="ig-slots" aria-label="Рекомендуемое время" hidden></div></div>' +
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
    suggestions(form.querySelector('.ig-slots'), form.elements.publish_at)
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

  // ── Ads (API from LOOM-276) ───────────────────────────────────────────
  // GET /ads reads Meta (status, spend), so it runs only when the tab is
  // opened or a promote dialog needs this month's numbers.
  const ADS_MANAGER = 'https://adsmanager.facebook.com/adsmanager/manage/'
  const usd = (n) => Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
  let adsLoaded = false

  function monthLine(m) {
    if (m.spent_usd === null) return 'Потрачено: Meta не ответила · лимит ' + usd(m.cap_usd) + ' USD'
    return 'Потрачено ' + usd(m.spent_usd) + ' из ' + usd(m.cap_usd) + ' USD в этом месяце' +
      (m.committed_usd ? ' · ещё ' + usd(m.committed_usd) + ' USD заложено в идущие объявления' : '')
  }
  // Same sum the server checks: cap − spend this month − budgets of ads not yet ended.
  function remaining(m) {
    return Math.max(0, (m.cap_usd || 0) - (m.spent_usd || 0) - (m.committed_usd || 0))
  }

  function adRow(a) {
    const link = a.ad_id ? ADS_MANAGER + 'ads?selected_ad_ids=' + encodeURIComponent(a.ad_id)
      : a.campaign_id ? ADS_MANAGER + 'campaigns?selected_campaign_ids=' + encodeURIComponent(a.campaign_id) : ''
    return '<tr>' +
      '<td class="num">#' + esc(a.id) + ' · пост #' + esc(a.ig_post_id) + '</td>' +
      '<td>' + esc(a.status_seen || (a.error ? 'Создано не полностью' : '—')) +
        (a.error ? '<p class="ig-note">' + esc(a.error) + '</p>' : '') + '</td>' +
      '<td class="num">' + usd(a.budget_usd) + ' USD</td>' +
      '<td class="num">' + (a.spend_usd === null ? '—' : usd(a.spend_usd) + ' USD') + '</td>' +
      '<td class="num">' + esc(formatDate(a.start_at)) + ' — ' + esc(formatDate(a.end_at)) + '</td>' +
      '<td>' + (link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">Ads Manager ↗</a>' : '—') + '</td>' +
    '</tr>'
  }

  async function loadAds() {
    adsLoaded = true
    el('ads-list').innerHTML = '<div class="state">Загрузка…</div>'
    try {
      const r = await apiJSON('/api/admin/instagram/ads')
      el('ads-spend').textContent = monthLine(r.month)
      el('ads-spend').classList.toggle('is-over', r.month.spent_usd !== null && remaining(r.month) <= 0)
      if (r.targeting) fillTargeting(r.targeting)
      const items = r.items || []
      el('ads-list').innerHTML =
        (r.meta_error ? '<p class="ig-note">Meta не ответила, статусы и расходы могут быть устаревшими: ' + esc(r.meta_error) + '</p>' : '') +
        (items.length
          ? '<div class="table-wrap"><table class="table"><thead><tr><th>Объявление</th><th>Статус в Meta</th><th>Бюджет</th><th>Потрачено</th><th>Период</th><th></th></tr></thead><tbody>' +
            items.map(adRow).join('') + '</tbody></table></div>'
          : '<div class="state"><p class="state-title">Объявлений пока нет</p><p class="state-sub">Создайте рекламу кнопкой на опубликованном посте.</p></div>')
    } catch (err) {
      if (err.status === 401) { window.location.href = 'login.html'; return }
      el('ads-spend').textContent = ''
      el('ads-list').innerHTML = '<div class="state state--error">' + esc(apiErrorMessage(err)) + '</div>'
    }
  }

  function fillTargeting(t) {
    const f = el('ads-form')
    if (!f) return
    f.elements.countries.value = t.countries.join(', ')
    f.elements.age_min.value = t.age_min
    f.elements.age_max.value = t.age_max
    f.elements.genders.value = t.genders.length === 1 ? String(t.genders[0]) : ''
    f.elements.interests.value = t.interests.map((i) => i.id + ' ' + i.name).join('\n')
  }

  async function saveTargeting(e) {
    e.preventDefault()
    const f = e.target
    const note = f.querySelector('.ig-note')
    const submit = f.querySelector('[type="submit"]')
    // Sent as typed; the server validates (ISO codes, ages 18–65, numeric interest ids).
    const targeting = {
      countries: f.elements.countries.value.split(/[\s,;]+/).filter(Boolean).map((c) => c.toUpperCase()),
      age_min: Number(f.elements.age_min.value),
      age_max: Number(f.elements.age_max.value),
      genders: f.elements.genders.value ? [Number(f.elements.genders.value)] : [],
      interests: f.elements.interests.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
        const m = l.match(/^(\S+)\s*(.*)$/)
        return { id: m[1], name: m[2] || m[1] }
      }),
    }
    note.hidden = true
    submit.disabled = true
    try {
      await apiJSON('/api/admin/instagram/ads/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ads_targeting: targeting }),
      })
      toast('Таргетинг сохранён', 'success')
    } catch (err) {
      note.textContent = apiErrorMessage(err)
      note.hidden = false
    } finally {
      submit.disabled = false
    }
  }

  function promote(post) {
    const previous = document.activeElement
    const backdrop = document.createElement('div')
    backdrop.className = 'dialog-backdrop'
    backdrop.innerHTML =
      '<form class="dialog ig-promote" role="dialog" aria-modal="true" aria-labelledby="ig-pr-title" novalidate>' +
        '<h2 class="dialog-title" id="ig-pr-title">Реклама поста #' + esc(post.id) + '</h2>' +
        '<p class="dialog-body">Кампания, группа и объявление создаются на паузе. Показ не начнётся, пока Тимур не включит рекламу в Meta Ads Manager.</p>' +
        '<p class="ig-spend" data-month>Загрузка расходов…</p>' +
        '<div class="field-row">' +
          '<div class="field"><label class="field-label" for="ig-pr-budget">Бюджет на весь срок, USD</label>' +
            '<input class="input" type="number" id="ig-pr-budget" name="budget_usd" min="1" step="1" value="5" required /></div>' +
          '<div class="field"><label class="field-label" for="ig-pr-days">Дней</label>' +
            '<input class="input" type="number" id="ig-pr-days" name="days" min="1" max="30" step="1" value="3" required /></div>' +
        '</div>' +
        '<p class="ig-note" role="alert" hidden></p>' +
        '<div class="dialog-actions"><button type="button" class="btn" data-cancel>Отмена</button>' +
        '<button type="submit" class="btn btn--primary" disabled>Создать на паузе</button></div>' +
      '</form>'
    document.body.appendChild(backdrop)
    const form = backdrop.querySelector('form')
    const note = form.querySelector('[role="alert"]')
    const submit = form.querySelector('[type="submit"]')
    const month = form.querySelector('[data-month]')
    let busy = false

    function close() {
      if (busy) return
      document.removeEventListener('keydown', keydown, true)
      backdrop.remove()
      if (previous && previous.isConnected) previous.focus()
    }
    function keydown(e) { if (e.key === 'Escape') { e.preventDefault(); close() } }
    document.addEventListener('keydown', keydown, true)
    form.querySelector('[data-cancel]').addEventListener('click', close)
    form.elements.budget_usd.focus()

    // AC-2: the month total is on screen before the create can be confirmed.
    apiJSON('/api/admin/instagram/ads').then((r) => {
      month.textContent = monthLine(r.month) + ' · свободно ' + usd(remaining(r.month)) + ' USD'
      submit.disabled = false
    }).catch((err) => {
      month.textContent = ''
      note.textContent = apiErrorMessage(err)
      note.hidden = false
    })

    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      if (busy || submit.disabled) return
      busy = true
      submit.disabled = true
      note.hidden = true
      try {
        await apiJSON('/api/admin/instagram/ads', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ post_id: post.id, budget_usd: Number(form.elements.budget_usd.value), days: Number(form.elements.days.value) }),
        })
        busy = false
        close()
        toast('Реклама создана на паузе. Включите её в Meta Ads Manager.', 'success')
        if (adsLoaded) loadAds()
      } catch (err) {
        const d = err.data || {}
        note.textContent = apiErrorMessage(err) +
          (d.code === 'ig_ads_over_cap' ? ' Осталось ' + usd(remaining(d)) + ' USD из ' + usd(d.cap_usd) + '.' : '')
        note.hidden = false
        if (d.code === 'ig_ads_meta' && adsLoaded) loadAds()
      } finally {
        busy = false
        submit.disabled = false
      }
    })
  }

  function showTab(name) {
    el('ig-tabs').querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)))
    el('tab-posts').hidden = name !== 'posts'
    el('tab-ads').hidden = name !== 'ads'
    el('new-btn').hidden = name !== 'posts'
    if (name === 'ads' && !adsLoaded) loadAds()
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
      else if (btn.dataset.act === 'promote') promote(posts.get(Number(btn.dataset.id)))
      else act(btn)
    })
    if (canApprove) {
      el('ig-tabs').addEventListener('click', (e) => { const t = e.target.closest('.tab'); if (t) showTab(t.dataset.tab) })
      el('ads-form').addEventListener('submit', saveTargeting)
      el('ads-refresh-btn').addEventListener('click', loadAds)
    }
    load()
    loadSettings()
  })
})()
