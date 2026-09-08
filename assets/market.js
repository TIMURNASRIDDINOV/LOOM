/* ================================================================
   LOOM — Designer marketplace renderer.

   Drives two pages from one file, because they render the same card:
     market.html   → GET /api/artworks       (everything moderation approved)
     designer.html → GET /api/designers/:h   (one designer's works + totals)

   Choosing a work does not add it to a cart. It stashes the artwork in
   sessionStorage and opens the configurator, which refetches the image and
   places it as a normal layer carrying `artworkId` — the field checkout reads
   to credit the designer (backend/src/routes/cart.ts).
================================================================ */
'use strict'
;(function () {
  const PAGE_SIZE = 40
  const HANDOFF_KEY = 'loom_pending_art'

  function T(key, fb) {
    try { return (window.LOOM_I18N ? window.LOOM_I18N.t(key) : fb) || fb } catch (e) { return fb }
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

  const API = () => (window.LOOM_CONFIG && window.LOOM_CONFIG.API_BASE) || 'https://api.loomdesign.uz'

  const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13"/><path d="M12 5l7 7-7 7"/></svg>'

  // ── Card ──────────────────────────────────────────────────────────────────

  function cardHtml(a) {
    const free = !a.markup
    const price = free
      ? T('common.free', 'Бесплатно')
      : '+ ' + money(a.markup)
    const author = esc(a.author || 'LOOM')
    const sold = a.sold
      ? '<p class="mk-card__sold">' + esc(T('mk.sold', 'Продано')) + ': ' + a.sold + '</p>'
      : ''
    return '' +
      '<article class="mk-card" data-id="' + a.id + '">' +
        '<div class="mk-card__art">' +
          '<img src="' + esc(a.image_url) + '" alt="' + esc(a.title) + '" loading="lazy" />' +
          '<span class="mk-card__price' + (free ? ' mk-card__price--free' : '') + '">' + esc(price) + '</span>' +
        '</div>' +
        '<div class="mk-card__body">' +
          '<h3 class="mk-card__title">' + esc(a.title) + '</h3>' +
          '<a class="mk-card__by" href="designer.html?handle=' +
            encodeURIComponent(String(a.author || '').replace(/^@/, '')) + '">' + author + '</a>' +
          sold +
          '<button class="mk-card__try" type="button" data-try="' + a.id + '">' +
            '<span>' + esc(T('mk.try', 'Примерить')) + '</span>' + ARROW +
          '</button>' +
        '</div>' +
      '</article>'
  }

  function skeletons(n) {
    return new Array(n).fill('<div class="mk-skeleton"></div>').join('')
  }

  // ── Hand-off to the configurator ──────────────────────────────────────────

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
      const card = e.target.closest && e.target.closest('.mk-card')
      if (!card) return
      // The author link is a real link — let it navigate.
      if (e.target.closest('.mk-card__by')) return
      const a = byId[card.dataset.id]
      if (a) tryOn(a)
    })
  }

  // ── market.html ───────────────────────────────────────────────────────────

  async function initMarket() {
    const grid = $('mk-grid')
    if (!grid) return
    const moreBtn = $('mk-more-btn')
    const byId = {}
    let page = 1
    let total = 0

    bindGrid(grid, byId)

    async function load(p, append) {
      if (!append) grid.innerHTML = skeletons(8)
      try {
        const res = await fetch(API() + '/api/artworks?page=' + p)
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const data = await res.json()
        const items = data.items || []
        total = data.total || items.length
        items.forEach((a) => { byId[a.id] = a })

        const html = items.map(cardHtml).join('')
        if (append) grid.insertAdjacentHTML('beforeend', html)
        else grid.innerHTML = html || '<p class="mk-empty">' +
          esc(T('mk.empty', 'Здесь пока пусто. Первые работы появятся совсем скоро — или загрузите свою.')) + '</p>'

        const shown = grid.querySelectorAll('.mk-card').length
        const count = $('mk-count')
        if (count) {
          count.textContent = total
            ? total + ' ' + T('mk.works', 'работ')
            : T('mk.worksNone', 'пока пусто')
        }
        if (moreBtn) moreBtn.style.display = shown < total ? '' : 'none'
      } catch (e) {
        if (!append) {
          grid.innerHTML = '<p class="mk-error">' +
            esc(T('mk.failed', 'Не удалось загрузить маркет. Обновите страницу.')) + '</p>'
        }
        console.warn('[LOOM] market load failed:', e.message)
      }
    }

    if (moreBtn) {
      moreBtn.addEventListener('click', async () => {
        moreBtn.disabled = true
        page += 1
        await load(page, true)
        moreBtn.disabled = false
      })
    }

    load(1, false)
    window.addEventListener('loom:langchange', () => { page = 1; load(1, false) })
  }

  // ── designer.html ─────────────────────────────────────────────────────────

  function stat(value, label) {
    return '<div class="dzp-stat"><div class="dzp-stat__value">' + esc(value) +
      '</div><div class="dzp-stat__label">' + esc(label) + '</div></div>'
  }

  async function initDesigner() {
    const grid = $('mk-grid')
    const handleEl = $('dzp-handle')
    if (!grid || !handleEl) return

    const raw = (new URLSearchParams(window.location.search).get('handle') || '').replace(/^@/, '')
    const byId = {}
    bindGrid(grid, byId)

    if (!raw) {
      handleEl.textContent = T('mk.notFound', 'Дизайнер не найден')
      grid.innerHTML = ''
      return
    }

    grid.innerHTML = skeletons(4)
    try {
      const res = await fetch(API() + '/api/designers/' + encodeURIComponent(raw))
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const d = await res.json()

      handleEl.textContent = d.handle
      document.title = 'LOOM — ' + d.handle
      const name = $('dzp-name')
      if (name) name.textContent = d.name || ''
      const bio = $('dzp-bio')
      if (bio) bio.textContent = d.bio || ''

      const avatar = $('dzp-avatar')
      if (avatar) {
        if (d.avatar_url) avatar.innerHTML = '<img src="' + esc(d.avatar_url) + '" alt="" />'
        else {
          const initial = (d.name || d.handle.replace('@', '') || '?').charAt(0).toUpperCase()
          avatar.innerHTML = '<span>' + esc(initial) + '</span>'
        }
      }

      const stats = $('dzp-stats')
      if (stats) {
        stats.innerHTML =
          stat(String((d.works || []).length), T('dz.statWorks', 'Работ')) +
          stat(String(d.units_sold || 0), T('dz.statSold', 'Продано')) +
          stat(d.since ? String(new Date(d.since).getFullYear()) : '—', T('acc.statSince', 'С нами с'))
      }

      const works = d.works || []
      works.forEach((a) => { byId[a.id] = a })
      grid.innerHTML = works.length
        ? works.map(cardHtml).join('')
        : '<p class="mk-empty">' + esc(T('dz.noPublicWorks', 'У этого дизайнера пока нет одобренных работ.')) + '</p>'
    } catch (e) {
      handleEl.textContent = T('mk.notFound', 'Дизайнер не найден')
      grid.innerHTML = '<p class="mk-error">' +
        esc(T('mk.failed', 'Не удалось загрузить страницу. Обновите её.')) + '</p>'
    }
  }

  function init() {
    if ($('mk-count')) initMarket()
    else initDesigner()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
