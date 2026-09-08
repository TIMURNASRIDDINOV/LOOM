/* ================================================================
   LOOM — Designer studio (account.html → "Дизайнер" tab)

   The backend has carried the whole designer marketplace since 0017/0018
   (apply, upload, moderation, sales attribution), but only the mobile app
   ever offered it. This is the web half:

     not a designer  → the pitch + POST /api/designer/apply
     a designer      → GET /api/designer/stats + /artworks, and uploads via
                       POST /api/uploads → POST /api/designer/artworks

   Runs before account.js and owns only #tab-designer, so nothing here can
   break the rest of the cabinet: every entry point starts by looking for its
   own nodes and returns if they are absent.
================================================================ */
'use strict'
;(function () {
  const MIN_LONG_EDGE = 1500 // the server enforces this too — see designers.ts

  function T(key, fb) {
    try { return (window.LOOM_I18N ? window.LOOM_I18N.t(key) : fb) || fb } catch (e) { return fb }
  }
  function lang() {
    try { return window.LOOM_I18N ? window.LOOM_I18N.getLang() : 'ru' } catch (e) { return 'ru' }
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
  function money(n) {
    if (window.LOOM_I18N) return window.LOOM_I18N.formatPrice(n)
    return Number(n || 0).toLocaleString('ru-RU') + ' сум'
  }
  function $(id) { return document.getElementById(id) }

  const STATUS = {
    ru: { pending: 'На проверке', approved: 'Одобрено', rejected: 'Отклонено' },
    uz: { pending: 'Tekshiruvda', approved: 'Tasdiqlangan', rejected: 'Rad etilgan' },
    en: { pending: 'In review', approved: 'Approved', rejected: 'Rejected' },
  }
  const STATUS_COLOR = { pending: '#a16207', approved: '#15803d', rejected: '#d6382d' }

  let API = ''
  let user = null
  let pending = null // { key, width, height, name }

  // ── Fetch helpers ─────────────────────────────────────────────────────────
  // Both auth styles are live on this site: Bearer for email accounts, cookie
  // for phone/Telegram. Send whichever exists — same shape account.js uses.
  function authHeaders(extra) {
    const h = Object.assign({}, extra || {})
    const token = window.LOOM_AUTH && window.LOOM_AUTH.getToken()
    if (token) h['Authorization'] = 'Bearer ' + token
    return h
  }

  async function api(path, opts) {
    const o = Object.assign({ credentials: 'include' }, opts || {})
    o.headers = authHeaders(o.headers)
    const res = await fetch(API + path, o)
    let data = null
    try { data = await res.json() } catch (e) { /* 204 or non-JSON */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'HTTP ' + res.status)
      err.status = res.status
      err.code = data && data.code
      throw err
    }
    return data
  }

  function flash(okId, errId, okText, errText) {
    const ok = $(okId), err = $(errId)
    if (ok) ok.textContent = okText || ''
    if (err) err.textContent = errText || ''
    if (okText && ok) setTimeout(() => { if (ok.textContent === okText) ok.textContent = '' }, 4000)
  }

  // ── Which half of the tab to show ─────────────────────────────────────────

  function showState(isDesigner) {
    const intro = $('dz-intro')
    if (intro) intro.style.display = isDesigner ? 'none' : ''
    ;['dz-studio', 'dz-upload-card', 'dz-works-card'].forEach((id) => {
      const n = $(id)
      if (n) n.style.display = isDesigner ? '' : 'none'
    })
  }

  function renderIdentity() {
    const handle = user && user.designer_handle
    const view = $('dz-handle-view')
    if (view) view.textContent = handle || '—'
    const bio = $('dz-bio-view')
    if (bio) bio.textContent = (user && user.designer_bio) || ''
    const link = $('dz-public-link')
    if (link && handle) link.href = 'designer.html?handle=' + encodeURIComponent(handle.replace(/^@/, ''))
    // Editing a profile is the same call as applying, so the form doubles as
    // the editor — prefilled, with a different button label.
    const h = $('dz-handle'), b = $('dz-bio')
    if (h && handle) h.value = handle.replace(/^@/, '')
    if (b) b.value = (user && user.designer_bio) || ''
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  async function loadStats() {
    try {
      const s = await api('/api/designer/stats')
      const set = (id, v) => { const n = $(id); if (n) n.textContent = v }
      set('dz-stat-works', String(s.works_approved || 0) + ' / ' + String(s.works_total || 0))
      set('dz-stat-sold', String(s.units_sold || 0))
      set('dz-stat-earned', money(s.earned || 0))
      const note = $('dz-commission-note')
      if (note) {
        note.textContent = T('dz.commission', 'С каждой продажи LOOM удерживает {pct}% вашей наценки, остальное — ваше.')
          .replace('{pct}', String(s.commission_pct != null ? s.commission_pct : 30))
      }
    } catch (e) {
      if (e.code !== 'not_designer') console.warn('[LOOM] designer stats:', e.message)
    }
  }

  // ── Submissions ───────────────────────────────────────────────────────────

  function badge(status) {
    const label = (STATUS[lang()] || STATUS.ru)[status] || status
    const c = STATUS_COLOR[status] || '#6b7280'
    return '<span class="status-badge" style="background:' + c + '22;color:' + c +
      ';border:1px solid ' + c + '55">' + esc(label) + '</span>'
  }

  async function loadWorks() {
    const box = $('dz-works')
    if (!box) return
    try {
      const data = await api('/api/designer/artworks')
      const items = data.items || []
      if (!items.length) {
        box.innerHTML = '<p class="empty-state">' +
          esc(T('dz.noWorks', 'Вы пока ничего не загрузили. Начните с формы выше.')) + '</p>'
        return
      }
      box.innerHTML = items.map((a) => {
        const sold = a.sold
          ? '<p class="dz-work-meta">' + esc(T('dz.soldTimes', 'Продано: ')) + a.sold + '</p>'
          : ''
        const note = a.status === 'rejected' && a.reject_note
          ? '<p class="dz-work-note">' + esc(a.reject_note) + '</p>'
          : ''
        return '<div class="dz-work">' +
          '<img class="dz-work-thumb" src="' + esc(a.image_url) + '" alt="" loading="lazy" />' +
          '<div class="dz-work-body">' +
            '<p class="dz-work-title">' + esc(a.title) + ' ' + badge(a.status) + '</p>' +
            '<p class="dz-work-meta">' +
              esc(T('dz.markupShort', 'Наценка')) + ': ' + esc(money(a.markup)) +
              (a.tags ? ' · ' + esc(a.tags) : '') +
            '</p>' + sold + note +
          '</div></div>'
      }).join('')
    } catch (e) {
      if (e.code === 'not_designer') return
      box.innerHTML = '<p class="empty-state">' + esc(e.message) + '</p>'
    }
  }

  // ── Apply / edit profile ──────────────────────────────────────────────────

  function bindApply() {
    const btn = $('dz-apply-btn')
    if (!btn) return
    btn.addEventListener('click', async () => {
      const raw = ($('dz-handle').value || '').trim().replace(/^@/, '')
      if (!/^[a-zA-Z0-9_.]{3,24}$/.test(raw)) {
        flash('dz-apply-msg', 'dz-apply-err', '', T('dz.handleBad', 'Ник: 3–24 символа, латиница, цифры, точка или подчёркивание.'))
        return
      }
      btn.disabled = true
      flash('dz-apply-msg', 'dz-apply-err', '', '')
      try {
        const bio = ($('dz-bio').value || '').trim()
        const out = await api('/api/designer/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ handle: raw, bio: bio }),
        })
        user.is_designer = 1
        user.designer_handle = out.designer_handle
        user.designer_bio = out.designer_bio
        // The nav and other tabs read this cached copy; a stale one would keep
        // showing the pitch after a successful application.
        try { sessionStorage.setItem('loom_user', JSON.stringify(user)) } catch (e) {}
        flash('dz-apply-msg', 'dz-apply-err', T('dz.applied', 'Готово! Теперь вы дизайнер LOOM.'), '')
        showState(true)
        renderIdentity()
        loadStats()
        loadWorks()
      } catch (e) {
        flash('dz-apply-msg', 'dz-apply-err', '', e.message)
      } finally {
        btn.disabled = false
      }
    })

    // "Изменить" reopens the same form, prefilled.
    const edit = $('dz-edit-btn')
    if (edit) edit.addEventListener('click', () => {
      const intro = $('dz-intro')
      if (!intro) return
      intro.style.display = ''
      const b = $('dz-apply-btn')
      if (b) { b.removeAttribute('data-i18n'); b.textContent = T('dz.saveProfile', 'Сохранить') }
      intro.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  // ── Upload ────────────────────────────────────────────────────────────────

  function readImageSize(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight, url: url }) }
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
      img.src = url
    })
  }

  async function acceptFile(file) {
    if (!file) return
    const info = $('dz-file-info')
    const drop = $('dz-drop')
    flash('dz-submit-msg', 'dz-submit-err', '', '')

    const dims = await readImageSize(file)
    if (!dims) {
      flash('dz-submit-msg', 'dz-submit-err', '', T('dz.notImage', 'Это не похоже на картинку.'))
      return
    }
    const long = Math.max(dims.width, dims.height)
    // Refuse here rather than after the upload: the server rejects it anyway,
    // and a wasted upload on a phone connection is a bad way to find out.
    if (long < MIN_LONG_EDGE) {
      flash('dz-submit-msg', 'dz-submit-err', '',
        T('dz.tooSmall', 'Минимум {n} px по длинной стороне — у вас {w}×{h}.')
          .replace('{n}', MIN_LONG_EDGE).replace('{w}', dims.width).replace('{h}', dims.height))
      URL.revokeObjectURL(dims.url)
      return
    }

    const prev = $('dz-preview')
    if (prev) prev.src = dims.url
    if (drop) drop.classList.add('has-file')
    if (info) {
      info.textContent = file.name + ' · ' + dims.width + '×' + dims.height + ' · ' +
        Math.round(file.size / 1024) + ' KB'
    }
    pending = { file: file, width: dims.width, height: dims.height, name: file.name, key: null }

    const t = $('dz-title')
    if (t && !t.value) t.value = file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 80)
  }

  function bindUpload() {
    const drop = $('dz-drop')
    const input = $('dz-file')
    if (!drop || !input) return

    drop.addEventListener('click', () => input.click())
    drop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click() }
    })
    input.addEventListener('change', (e) => acceptFile(e.target.files && e.target.files[0]))
    ;['dragenter', 'dragover'].forEach((ev) =>
      drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over') }))
    ;['dragleave', 'drop'].forEach((ev) =>
      drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over') }))
    drop.addEventListener('drop', (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
      if (f) acceptFile(f)
    })

    const submit = $('dz-submit-btn')
    if (!submit) return
    submit.addEventListener('click', async () => {
      const title = ($('dz-title').value || '').trim()
      if (!pending) {
        flash('dz-submit-msg', 'dz-submit-err', '', T('dz.needFile', 'Сначала выберите файл.'))
        return
      }
      if (!title) {
        flash('dz-submit-msg', 'dz-submit-err', '', T('dz.needTitle', 'Укажите название работы.'))
        return
      }
      submit.disabled = true
      const original = submit.textContent
      submit.textContent = T('dz.uploading', 'Загружаем…')
      flash('dz-submit-msg', 'dz-submit-err', '', '')
      try {
        // Two calls on purpose: the blob goes to R2 through the shared upload
        // endpoint, and only the resulting key is attached to the artwork row.
        if (!pending.key) {
          const fd = new FormData()
          fd.append('file', pending.file)
          const up = await fetch(API + '/api/uploads', {
            method: 'POST', body: fd, credentials: 'include', headers: authHeaders(),
          })
          const upData = await up.json()
          if (!up.ok) throw new Error(upData.error || 'Upload failed')
          pending.key = upData.key
        }
        await api('/api/designer/artworks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title,
            tags: ($('dz-tags').value || '').trim() || null,
            image_key: pending.key,
            width: pending.width,
            height: pending.height,
            markup: Math.max(0, parseInt($('dz-markup').value, 10) || 0),
          }),
        })
        flash('dz-submit-msg', 'dz-submit-err',
          T('dz.submitted', 'Отправлено на проверку. Обычно это занимает не больше дня.'), '')
        resetUploadForm()
        loadWorks()
        loadStats()
      } catch (e) {
        flash('dz-submit-msg', 'dz-submit-err', '', e.message)
      } finally {
        submit.disabled = false
        submit.textContent = original
      }
    })
  }

  function resetUploadForm() {
    pending = null
    const drop = $('dz-drop')
    if (drop) drop.classList.remove('has-file')
    const prev = $('dz-preview')
    if (prev) prev.removeAttribute('src')
    ;['dz-title', 'dz-tags'].forEach((id) => { const n = $(id); if (n) n.value = '' })
    const m = $('dz-markup'); if (m) m.value = '0'
    const info = $('dz-file-info'); if (info) info.textContent = ''
    const file = $('dz-file'); if (file) file.value = ''
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async function init() {
    if (!$('tab-designer')) return
    API = (window.LOOM_CONFIG && window.LOOM_CONFIG.API_BASE) || 'https://api.loomdesign.uz'

    bindApply()
    bindUpload()

    // account.js does the redirect-to-login; here a missing user just means
    // there is nothing to render yet.
    try { user = await window.LOOM_AUTH.getCurrentUser() } catch (e) { user = null }
    if (!user) return

    const isDesigner = !!user.is_designer
    showState(isDesigner)
    if (isDesigner) {
      renderIdentity()
      loadStats()
      loadWorks()
    }

    if (window.location.hash === '#designer') {
      setTimeout(() => {
        const btn = document.querySelector('[data-tab="designer"]')
        if (btn) btn.click()
      }, 60)
    }

    window.addEventListener('loom:langchange', () => {
      if (user && user.is_designer) { loadStats(); loadWorks() }
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
