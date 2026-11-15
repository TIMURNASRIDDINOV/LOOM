/* ================================================================
   LOOM — designer market, Atelye skin (PRD-216, LOOM-323). Styles:
   assets/atelye.css + the small inline block of each page.

   Drives three pages from one file, because they share the print card:
     market.html    → GET /api/artworks (+ /api/artwork-categories)
     designers.html → GET /api/designers (the directory)
     designer.html  → GET /api/designers/:handle (one designer's prints)

   Choosing a print does not add it to a cart. It stashes the artwork in
   sessionStorage and opens the configurator, which refetches the image and
   places it as a normal layer carrying `artworkId` — the field checkout reads
   to credit the designer (backend/src/routes/cart.ts).
================================================================ */
'use strict'
;(function () {
  const HANDOFF_KEY = 'loom_pending_art'

  function T(key, fb) {
    try {
      const s = window.LOOM_I18N && window.LOOM_I18N.t(key)
      return s && s !== key ? s : fb
    } catch (e) { return fb }
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
  function money(n) {
    if (window.LOOM_I18N) return window.LOOM_I18N.formatPrice(n)
    return Number(n || 0).toLocaleString('ru-RU') + ' so‘m'
  }
  function plural(n, key, fb) {
    try {
      const w = window.LOOM_I18N && window.LOOM_I18N.plural(n, key)
      if (w) return w
    } catch (e) { /* i18n not ready */ }
    return fb
  }
  function lang() {
    try { return window.LOOM_I18N ? window.LOOM_I18N.getLang() : 'uz' } catch (e) { return 'uz' }
  }
  function $(id) { return document.getElementById(id) }
  function handleOf(s) { return String(s || '').replace(/^@/, '') }

  const API = () => (window.LOOM_CONFIG && window.LOOM_CONFIG.API_BASE) || 'https://api.loomdesign.uz'

  // The phone top bar title is static Uzbek from data-title; keep it in the
  // page language.
  function setBarTitle(text) {
    const h = document.querySelector('.atl-mbar-sub h1')
    if (h && text) h.textContent = text
  }

  // ── Shared blocks ─────────────────────────────────────────────────────────

  function printCard(a, withAuthor) {
    const h = handleOf(a.author)
    const author = withAuthor && h
      ? '<a class="atl-sm atl-mk-by" href="designer.html?handle=' + encodeURIComponent(h) + '">@' + esc(h) + '</a>'
      : ''
    return '<div class="atl-pc">' +
      '<button type="button" class="atl-mk-try" data-try="' + esc(a.id) + '">' +
        '<span class="atl-cv atl-gtile"><img src="' + esc(a.image_url) + '" alt="" loading="lazy" decoding="async"></span>' +
        '<span class="atl-pc-nm">' + esc(a.title) + '</span>' +
        (a.markup ? '<span class="atl-pc-pr">+ ' + esc(money(a.markup)) + '</span>' : '') +
      '</button>' + author +
    '</div>'
  }

  function skeletons(n) {
    return new Array(n).fill(
      '<div class="atl-pc"><span class="atl-skel atl-gtile"></span><span class="atl-skel atl-mk-skl"></span></div>'
    ).join('')
  }

  function errorBlock(onRetry) {
    const box = document.createElement('div')
    box.className = 'atl-empty'
    box.setAttribute('role', 'alert')
    box.innerHTML = '<h2 class="atl-t2">' + esc(T('atl.state.errT', 'Nimadir noto‘g‘ri ketdi')) + '</h2>' +
      '<p class="atl-lead">' + esc(T('atl.state.errL', 'Sahifani yuklab bo‘lmadi. Internetni tekshirib, yangilang.')) + '</p>' +
      '<button type="button" class="atl-btn atl-btn-g">' + esc(T('atl.reload', 'Yangilash')) + '</button>'
    box.querySelector('button').addEventListener('click', onRetry || (() => location.reload()))
    return box
  }

  function tryOn(a) {
    try {
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({
        id: a.id,
        title: a.title,
        image_url: a.image_url,
        image_key: a.image_key,
        markup: a.markup || 0,
        author: a.author || null,
      }))
    } catch (e) { /* private mode: the configurator just opens empty */ }
    window.location.href = 'configurator.html'
  }

  function bindGrid(grid, byId) {
    grid.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('[data-try]')
      const a = b && byId[b.getAttribute('data-try')]
      if (a) tryOn(a)
    })
  }

  // ── market.html ───────────────────────────────────────────────────────────

  function initMarket() {
    const grid = $('mk-grid'), more = $('mk-more'), cats = $('mk-cats')
    const empty = $('mk-empty'), err = $('mk-err')
    const byId = {}
    let page = 1, request = 0, category = ''
    bindGrid(grid, byId)

    function chip(id, label) {
      return '<button type="button" class="atl-chip" data-cat="' + esc(id) + '" aria-pressed="' +
        (String(id) === category) + '">' + esc(label) + '</button>'
    }

    async function loadCategories() {
      try {
        const res = await fetch(API() + '/api/artwork-categories')
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const items = ((await res.json()).items || []).filter((c) => c.active !== false && c.active !== 0)
        if (category && !items.some((c) => String(c.id) === category)) { category = ''; load(1, false) }
        cats.innerHTML = items.length
          ? chip('', T('atl.cat.all', 'Hammasi')) +
            items.map((c) => chip(c.id, c['name_' + lang()] || c.name_uz || c.name_ru)).join('')
          : ''
        cats.hidden = !items.length
      } catch (e) {
        // The filter is secondary: say so once, offer a retry, keep the grid.
        cats.innerHTML = '<span class="atl-sm atl-mk-cerr" role="alert">' +
          esc(T('cat.failed', 'Kategoriyalarni yuklab bo‘lmadi.')) + '</span>' +
          '<button type="button" class="atl-chip" data-cat-retry>' + esc(T('cat.retry', 'Qayta urinish')) + '</button>'
        cats.hidden = false
      }
    }

    async function load(p, append) {
      const version = ++request
      more.disabled = true
      err.textContent = ''
      if (!append) {
        more.hidden = true
        empty.hidden = true
        grid.hidden = false
        grid.setAttribute('aria-busy', 'true')
        grid.innerHTML = skeletons(8)
        Object.keys(byId).forEach((id) => delete byId[id])
      }
      try {
        const res = await fetch(API() + '/api/artworks?page=' + p +
          (category ? '&category_id=' + encodeURIComponent(category) : ''))
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const data = await res.json()
        if (version !== request) return
        const items = data.items || [], total = data.total || 0
        items.forEach((a) => { byId[a.id] = a })
        const html = items.map((a) => printCard(a, true)).join('')
        grid.removeAttribute('aria-busy')
        if (append) grid.insertAdjacentHTML('beforeend', html)
        else if (html) grid.innerHTML = html
        else if (category) {
          grid.innerHTML = '<p class="atl-lead atl-mk-none">' +
            esc(T('cat.empty', 'Bu kategoriyada hali dizaynlar yo‘q.')) + '</p>'
        } else {
          // An empty market is the moment to recruit, not to apologise.
          grid.innerHTML = ''
          grid.hidden = true
          empty.hidden = false
          cats.hidden = true
        }
        page = p
        more.hidden = grid.querySelectorAll('[data-try]').length >= total
      } catch (e) {
        if (version !== request) return
        grid.removeAttribute('aria-busy')
        if (append) {
          // Keep the page number so a retry never skips an unreceived page.
          err.textContent = T('mk.moreFailed', 'Yuklab bo‘lmadi. Qayta urinib ko‘ring.')
        } else {
          grid.innerHTML = ''
          grid.appendChild(errorBlock(() => load(1, false)))
        }
      } finally {
        if (version === request) more.disabled = false
      }
    }

    cats.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('button')
      if (!b) return
      if (b.hasAttribute('data-cat-retry')) { loadCategories(); return }
      category = b.getAttribute('data-cat') || ''
      cats.querySelectorAll('[data-cat]').forEach((c) =>
        c.setAttribute('aria-pressed', String(c.getAttribute('data-cat') === category)))
      load(1, false)
    })
    more.addEventListener('click', () => load(page + 1, true))
    loadCategories()
    load(1, false)
    setBarTitle(T('atl.nav.market', 'Market'))
    window.addEventListener('loom:langchange', () => {
      setBarTitle(T('atl.nav.market', 'Market'))
      loadCategories()
    })
  }

  // ── designers.html — the public directory ─────────────────────────────────

  function initials(d) {
    const src = String(d.name || handleOf(d.handle) || '?').trim()
    const parts = src.split(/[\s._-]+/).filter(Boolean)
    return ((parts[0] || '?').charAt(0) + (parts[1] ? parts[1].charAt(0) : '')).toUpperCase()
  }
  function avatar(d) {
    return '<span class="atl-avatar atl-dsg-av" aria-hidden="true">' +
      (d.avatar_url ? '<img src="' + esc(d.avatar_url) + '" alt="">' : esc(initials(d))) + '</span>'
  }
  function worksLabel(n) {
    return n + ' ' + plural(n, 'plural.works', 'ta ish')
  }

  function designerRow(d) {
    const h = handleOf(d.handle)
    return '<a class="atl-row" href="designer.html?handle=' + encodeURIComponent(h) + '">' +
      avatar(d) +
      '<span class="atl-row-tx"><b>@' + esc(h) + '</b><i>' + esc(worksLabel(d.works || 0)) + '</i></span>' +
      '<svg class="atl-ic atl-ic-s" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>' +
    '</a>'
  }

  function initDirectory() {
    const list = $('dsg-list'), more = $('dsg-more'), err = $('dsg-err')
    let page = 1

    async function load(p, append) {
      more.disabled = true
      err.textContent = ''
      if (!append) {
        more.hidden = true
        list.hidden = false
        list.setAttribute('aria-busy', 'true')
        list.innerHTML = new Array(3).fill(
          '<div class="atl-row"><span class="atl-skel atl-avatar atl-dsg-av"></span><span class="atl-skel atl-mk-skl"></span></div>'
        ).join('')
      }
      try {
        const res = await fetch(API() + '/api/designers?page=' + p)
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const data = await res.json()
        const items = data.items || [], total = data.total || items.length
        const html = items.map(designerRow).join('')
        list.removeAttribute('aria-busy')
        if (append) list.insertAdjacentHTML('beforeend', html)
        else list.innerHTML = html
        // Nobody approved yet: the "become a designer" panel below says it all.
        list.hidden = !list.children.length
        page = p
        more.hidden = list.querySelectorAll('a.atl-row').length >= total
      } catch (e) {
        list.removeAttribute('aria-busy')
        if (append) err.textContent = T('mk.moreFailed', 'Yuklab bo‘lmadi. Qayta urinib ko‘ring.')
        else {
          // A failed fetch is not an empty directory.
          list.innerHTML = ''
          list.appendChild(errorBlock(() => load(1, false)))
        }
      } finally {
        more.disabled = false
      }
    }

    more.addEventListener('click', () => load(page + 1, true))
    load(1, false)
    setBarTitle(T('atl.nav.designers', 'Dizaynerlar'))
    window.addEventListener('loom:langchange', () => {
      setBarTitle(T('atl.nav.designers', 'Dizaynerlar'))
      load(1, false)
    })
  }

  // ── designer.html ─────────────────────────────────────────────────────────

  function initDesigner() {
    const grid = $('dz-grid'), head = $('dz-head'), missing = $('dz-missing')
    const raw = handleOf(new URLSearchParams(window.location.search).get('handle') || '')
    const byId = {}
    let d = null
    bindGrid(grid, byId)

    function notFound() {
      head.hidden = true
      grid.hidden = true
      missing.hidden = false
      setBarTitle(T('mk.notFound', 'Dizayner topilmadi'))
    }

    function render() {
      const h = handleOf(d.handle)
      const works = d.works || []
      setBarTitle('@' + h)
      document.title = 'LOOM — @' + h
      $('dz-av').innerHTML = d.avatar_url ? '<img src="' + esc(d.avatar_url) + '" alt="">' : esc(initials(d))
      $('dz-handle').textContent = '@' + h
      const meta = [d.name, worksLabel(works.length)]
      if (d.units_sold) meta.push(d.units_sold + ' ' + T('dir.sold', 'sotilgan'))
      $('dz-meta').textContent = meta.filter(Boolean).join(', ')
      const bio = $('dz-bio')
      bio.textContent = d.bio || ''
      bio.hidden = !d.bio
      works.forEach((a) => { byId[a.id] = a })
      grid.removeAttribute('aria-busy')
      grid.innerHTML = works.length
        ? works.map((a) => printCard(a, false)).join('')
        : '<p class="atl-lead atl-mk-none">' +
          esc(T('dz.noPublicWorks', 'Bu dizaynerda hali tasdiqlangan ishlar yo‘q.')) + '</p>'
    }

    async function load() {
      if (!raw) return notFound()
      grid.hidden = false
      grid.setAttribute('aria-busy', 'true')
      grid.innerHTML = skeletons(4)
      try {
        const res = await fetch(API() + '/api/designers/' + encodeURIComponent(raw))
        if (res.status === 404) return notFound()
        if (!res.ok) throw new Error('HTTP ' + res.status)
        d = await res.json()
        render()
      } catch (e) {
        head.hidden = true
        grid.removeAttribute('aria-busy')
        grid.innerHTML = ''
        grid.appendChild(errorBlock(() => { head.hidden = false; load() }))
      }
    }

    load()
    window.addEventListener('loom:langchange', () => { if (d) render() })
  }

  function init() {
    if ($('dsg-list')) initDirectory()
    else if ($('mk-grid')) initMarket()
    else if ($('dz-grid')) initDesigner()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
