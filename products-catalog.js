// Vanilla JavaScript Product Catalog — dynamic from API
(function () {
  'use strict'

  // ── Helpers ──────────────────────────────────────────────────────────────
  function T(key, fallback) {
    try { return (window.LOOM_I18N ? window.LOOM_I18N.t(key) : fallback) || fallback }
    catch (e) { return fallback }
  }

  function formatPrice(price) {
    if (window.LOOM_I18N) return window.LOOM_I18N.formatPrice(price)
    return Number(price).toLocaleString('ru-RU') + ' сум'
  }

  function esc(s) {
    if (!s) return ''
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function getApiBase() {
    return window.LOOM_CONFIG?.API_BASE ?? 'https://api.loomdesign.uz'
  }

  // ── Skeleton placeholders ─────────────────────────────────────────────────
  function renderSkeletons(container, count) {
    const grid = document.createElement('div')
    grid.className = 'product-grid'
    grid.id = 'catalog-skeleton'

    for (let i = 0; i < count; i++) {
      const card = document.createElement('div')
      card.className = 'product-card product-card--skeleton'
      card.innerHTML = `
        <div class="product-card__image-container" style="background:rgba(19,19,17,0.04)">
          <div style="width:100%;height:100%;background:linear-gradient(90deg,rgba(19,19,17,0.04) 25%,rgba(19,19,17,0.09) 50%,rgba(19,19,17,0.04) 75%);background-size:200% 100%;animation:shimmer 1.4s infinite"></div>
        </div>
        <div class="product-card__content">
          <div style="height:18px;background:rgba(19,19,17,0.08);border-radius:2px;margin-bottom:0.5rem;animation:shimmer 1.4s infinite"></div>
          <div style="height:14px;width:60%;background:rgba(19,19,17,0.05);border-radius:2px;animation:shimmer 1.4s infinite"></div>
        </div>
      `
      grid.appendChild(card)
    }

    if (!document.getElementById('shimmer-style')) {
      const s = document.createElement('style')
      s.id = 'shimmer-style'
      s.textContent = '@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}'
      document.head.appendChild(s)
    }

    container.appendChild(grid)
  }

  // ── Error state ───────────────────────────────────────────────────────────
  function renderError(container, onRetry) {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'text-align:center;padding:4rem 1.5rem;color:rgba(19,19,17,0.55)'
    wrap.innerHTML = `
      <p style="margin-bottom:1rem">${T('catalog.loadError', 'Не удалось загрузить каталог.')}</p>
      <button id="catalog-retry" style="
        padding:0.85rem 1.6rem;border:1px solid rgba(19,19,17,0.85);
        background:transparent;color:rgba(19,19,17,0.85);border-radius:2px;font-family:inherit;
        font-size:0.8rem;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;
        transition:background 0.2s">${T('catalog.retry', 'Повторить')}</button>
    `
    container.appendChild(wrap)
    container.querySelector('#catalog-retry').addEventListener('click', onRetry)
  }

  // ── Card factory ──────────────────────────────────────────────────────────
  function createProductCard(product) {
    const card = document.createElement('div')
    card.className = 'product-card'
    card.setAttribute('data-product-id', product.id)
    card.setAttribute('data-slug', product.slug || '')

    const imageContainer = document.createElement('div')
    imageContainer.className = 'product-card__image-container'

    if (product.thumbnail_url) {
      const img = document.createElement('img')
      img.loading = 'lazy'
      img.decoding = 'async'
      img.src = product.thumbnail_url
      img.alt = product.name_ru
      img.className = 'product-card__image'
      img.onerror = function () {
        this.style.display = 'none'
        imageContainer.style.background = 'rgba(19,19,17,0.04)'
      }
      imageContainer.appendChild(img)
    } else {
      imageContainer.style.background = 'rgba(19,19,17,0.04)'
    }

    // Hover swap: no second photo in the API yet, so the "back" is a
    // styled ink tile with the product name (classes from theme.css).
    // When a hover image exists, drop it in here instead.
    const alt = document.createElement('div')
    alt.className = 'pcard__media-alt'
    alt.setAttribute('aria-hidden', 'true')
    const altTag = document.createElement('span')
    altTag.className = 'pcard__alt-tag'
    altTag.textContent = 'Apparel'
    const altName = document.createElement('span')
    altName.className = 'pcard__alt-name'
    altName.textContent = product.name_ru
    const altSlash = document.createElement('span')
    altSlash.className = 'pcard__alt-slash'
    altSlash.textContent = '/'
    alt.appendChild(altTag)
    alt.appendChild(altName)
    alt.appendChild(altSlash)
    imageContainer.appendChild(alt)

    // the whole card navigates — on phones the title/price area is the
    // natural tap zone, not just the image tile
    card.style.cursor = 'pointer'
    card.addEventListener('click', (e) => {
      if (e.target.closest('.customize-btn, .quick-sizes')) return // buttons handle themselves
      window.location.href = 'configurator.html' + (product.slug ? '?slug=' + encodeURIComponent(product.slug) : '')
    })

    const content = document.createElement('div')
    content.className = 'product-card__content'

    const title = document.createElement('h3')
    title.className = 'product-card__title'
    title.textContent = product.name_ru

    const desc = document.createElement('p')
    desc.className = 'product-card__description'
    desc.textContent = product.description_ru || ''

    const priceDiv = document.createElement('div')
    priceDiv.className = 'product-card__price'
    priceDiv.textContent = formatPrice(product.price)

    const actions = document.createElement('div')
    actions.className = 'product-card__actions'

    const btn = document.createElement('button')
    btn.className = 'customize-btn btn-primary'
    btn.textContent = T('catalog.customize', 'Настроить дизайн')
    btn.setAttribute('aria-label', `${T('catalog.customize', 'Настроить дизайн')} ${esc(product.name_ru)}`)
    btn.addEventListener('click', () => {
      window.location.href = 'configurator.html' + (product.slug ? '?slug=' + encodeURIComponent(product.slug) : '')
    })

    actions.appendChild(btn)

    // ── Quick add-to-bag: plain garment, size chosen inline ────────
    // (custom designs go through the configurator; this is the
    // "just give me the tee" path, reference-style)
    const bagBtn = document.createElement('button')
    bagBtn.className = 'customize-btn bag-btn'
    bagBtn.type = 'button'
    bagBtn.textContent = T('cfg.addToCart', 'В корзину')
    bagBtn.setAttribute('aria-expanded', 'false')

    const sizeRow = document.createElement('div')
    sizeRow.className = 'quick-sizes'
    sizeRow.setAttribute('role', 'group')
    sizeRow.setAttribute('aria-label', T('cart.size', 'Размер'))
    ;['XS', 'S', 'M', 'L', 'XL', 'XXL'].forEach(sz => {
      const b = document.createElement('button')
      b.className = 'quick-size-btn'
      b.type = 'button'
      b.textContent = sz
      b.addEventListener('click', async () => {
        if (!window.LOOM_CART) return
        try {
          if (window.LOOM_LOGIN_MODAL) await window.LOOM_LOGIN_MODAL.requireAuth()
        } catch (e) { return } // login cancelled
        b.disabled = true
        try {
          await window.LOOM_CART.add({
            productId: product.id,
            designJson: JSON.stringify({ plain: true, shirtColor: '#FFFFFF', size: sz }),
            unitPrice: product.price,
            quantity: 1,
          })
          window.LOOM_CART.toast(T('cart.added', 'Добавлено в корзину') + ' · ' + sz)
          sizeRow.classList.remove('open')
          bagBtn.setAttribute('aria-expanded', 'false')
        } catch (err) {
          window.LOOM_CART.toast(err.message || T('cfg.toastAddError', 'Ошибка добавления'), 'error')
        } finally {
          b.disabled = false
        }
      })
      sizeRow.appendChild(b)
    })

    bagBtn.addEventListener('click', () => {
      const open = !sizeRow.classList.contains('open')
      sizeRow.classList.toggle('open', open)
      bagBtn.setAttribute('aria-expanded', String(open))
    })

    actions.appendChild(bagBtn)
    content.appendChild(title)
    content.appendChild(desc)
    content.appendChild(priceDiv)
    content.appendChild(actions)
    content.appendChild(sizeRow)
    card.appendChild(imageContainer)
    card.appendChild(content)

    return card
  }

  // ── Grid render ───────────────────────────────────────────────────────────
  function renderGrid(container, products) {
    const grid = document.createElement('div')
    grid.className = 'product-grid'
    products.forEach(p => grid.appendChild(createProductCard(p)))
    container.appendChild(grid)
  }

  // ── Carousel render (index.html, first 3 products) ────────────────────────
  function renderCarousel(container, products) {
    const featured = products.slice(0, 3)
    let currentIndex = 0

    const wrapper = document.createElement('div')
    wrapper.className = 'product-carousel'

    const prevBtn = document.createElement('button')
    prevBtn.className = 'carousel-arrow carousel-arrow--prev'
    prevBtn.setAttribute('aria-label', 'Предыдущий товар')
    prevBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>'

    const nextBtn = document.createElement('button')
    nextBtn.className = 'carousel-arrow carousel-arrow--next'
    nextBtn.setAttribute('aria-label', 'Следующий товар')
    nextBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>'

    const viewport = document.createElement('div')
    viewport.className = 'product-carousel__viewport'
    const track = document.createElement('div')
    track.className = 'product-carousel__track'

    featured.forEach(product => {
      const card = createProductCard(product)
      card.style.cursor = 'pointer'
      track.appendChild(card)
    })

    const dotsEl = document.createElement('div')
    dotsEl.className = 'carousel-dots'
    featured.forEach((_, i) => {
      const dot = document.createElement('button')
      dot.className = 'carousel-dot' + (i === 0 ? ' active' : '')
      dot.setAttribute('aria-label', 'Перейти к товару ' + (i + 1))
      dot.addEventListener('click', () => goTo(i))
      dotsEl.appendChild(dot)
    })

    function updateState() {
      prevBtn.disabled = currentIndex === 0
      nextBtn.disabled = currentIndex === featured.length - 1
      dotsEl.querySelectorAll('.carousel-dot').forEach((d, i) => d.classList.toggle('active', i === currentIndex))
    }

    function goTo(index) {
      currentIndex = Math.max(0, Math.min(index, featured.length - 1))
      const card = track.children[currentIndex]
      viewport.scrollTo({ left: card.offsetLeft - (viewport.offsetWidth - card.offsetWidth) / 2, behavior: 'smooth' })
      updateState()
    }

    prevBtn.addEventListener('click', () => goTo(currentIndex - 1))
    nextBtn.addEventListener('click', () => goTo(currentIndex + 1))
    viewport.addEventListener('scroll', function () {
      const center = viewport.scrollLeft + viewport.offsetWidth / 2
      let closest = 0, closestDist = Infinity
      for (let i = 0; i < track.children.length; i++) {
        const c = track.children[i]
        const dist = Math.abs(c.offsetLeft + c.offsetWidth / 2 - center)
        if (dist < closestDist) { closestDist = dist; closest = i }
      }
      if (closest !== currentIndex) { currentIndex = closest; updateState() }
    }, { passive: true })

    updateState()
    viewport.appendChild(track)
    wrapper.appendChild(prevBtn)
    wrapper.appendChild(viewport)
    wrapper.appendChild(nextBtn)
    wrapper.appendChild(dotsEl)
    container.appendChild(wrapper)
  }

  // ── Main fetch & render ───────────────────────────────────────────────────
  let productsCache = null

  function renderFrom(container, products, isIndexPage) {
    container.innerHTML = ''

    if (!products.length) {
      container.innerHTML = `<p style="text-align:center;color:rgba(19,19,17,0.4);padding:3rem">${T('catalog.empty', 'Каталог пуст.')}</p>`
      return
    }

    if (isIndexPage) {
      renderCarousel(container, products)
    } else {
      renderGrid(container, products)
    }

    // Trigger reveal animations on newly rendered cards
    if (window._initReveal) window._initReveal()
  }

  async function renderProducts() {
    const container = document.getElementById('product-list-root')
    if (!container) return

    container.innerHTML = ''

    const isIndexPage =
      window.location.pathname.endsWith('index.html') ||
      window.location.pathname === '/' ||
      window.location.pathname.endsWith('/')

    // Language switch: re-render labels/prices from cache — no
    // skeleton flash, no repeat network round-trip
    if (productsCache) {
      renderFrom(container, productsCache, isIndexPage)
      return
    }

    // Show skeletons while loading
    renderSkeletons(container, isIndexPage ? 3 : 6)

    try {
      const res = await fetch(getApiBase() + '/api/products')
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const data = await res.json()
      const products = data.products || []
      productsCache = products

      renderFrom(container, products, isIndexPage)

    } catch (err) {
      console.error('Catalog fetch failed:', err)
      container.innerHTML = ''
      renderError(container, () => { container.innerHTML = ''; renderProducts() })
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderProducts)
  } else {
    renderProducts()
  }

  // Re-render product cards (prices, button labels) when the language changes
  window.addEventListener('loom:langchange', renderProducts)
})()
