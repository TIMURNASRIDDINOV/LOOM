/* ================================================================
   LOOM — catalogue grid (catalog.html, Atelye skin, LOOM-323).

   GET /api/products → type chips + product cards. A card opens
   product.html?slug=…; colour, size and the cart live there.
   Markup is atl-* only (assets/atelye.css). The chip filter is kept in
   ?type= so Back returns to the same view.
================================================================ */
'use strict';
(function () {
  var root = document.getElementById('product-list-root');
  var chips = document.getElementById('catalog-chips');
  if (!root) return;

  function t(key, fallback) {
    try {
      var s = window.LOOM_I18N && window.LOOM_I18N.t(key);
      return s && s !== key ? s : fallback;
    } catch (e) { return fallback; }
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function api() {
    if (window.LOOM_CONFIG && window.LOOM_CONFIG.API_BASE) return window.LOOM_CONFIG.API_BASE;
    return location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? 'http://localhost:8787' : 'https://api.loomdesign.uz';
  }
  function name(p) {
    var I = window.LOOM_I18N;
    return (I && I.productName ? I.productName(p) : p.name_ru) || p.slug || '';
  }
  function price(n) {
    var I = window.LOOM_I18N;
    return I && I.formatPrice ? I.formatPrice(n) : Number(n).toLocaleString('ru-RU') + ' so‘m';
  }

  /* Garment type from the slug (tshirt-regular, hoodie-regular, …).
     Unknown slugs show under "Hammasi" only. */
  var TYPES = [
    ['tee', /^t-?shirt|^tee/], ['hoodie', /^hood/], ['polo', /^polo/],
    ['sweat', /^sweatshirt/], ['cap', /^cap/], ['pants', /^(sweat)?pants|^jogger/]
  ];
  function typeOf(p) {
    var s = String(p.slug || '');
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i][1].test(s)) return TYPES[i][0];
    return '';
  }

  /* Photoreal transparent pictures, by slug (LOOM-344); the same map is in
     assets/product.js and assets/home.js. A garment without one shows the
     product render from our API; anything that is not https is dropped. */
  var PHOTO = {
    'tshirt-regular': 'images/home/hero-tee-v1.webp',
    'hoodie-regular': 'images/garments/hoodie-front-v1.webp',
    'sweatshirt': 'images/garments/sweatshirt-front-v1.webp'
  };
  function artOf(p) {
    return PHOTO[p.slug] || (/^https:\/\//.test(p.thumbnail_url || '') ? p.thumbnail_url : '');
  }

  var products = null;
  /* catalog.html ships the on-sale garments as static cards for no-JS
     crawlers (LOOM-328; tools/check-static-prices.mjs keeps them in
     step with the API). They stay on screen until live data replaces
     them, and stay under the error block if the API fails. */
  var fallback = root.querySelector('.atl-pc') ? root.innerHTML : '';
  var current = (new URLSearchParams(location.search).get('type')) || 'all';

  function card(p) {
    var type = p.product_type || 'custom';
    var tag = type === 'blank' ? t('atl.blankOnly', 'Faqat printsiz')
      : type === 'ready' ? t('catalog.readyBadge', 'Tayyor dizayn') : '';
    var art = artOf(p);
    return '<a class="atl-pc" href="product.html?slug=' + encodeURIComponent(p.slug) + '">' +
      '<span class="atl-cv atl-gtile">' + (art ? '<img src="' + esc(art) + '" alt="" loading="lazy" decoding="async">' : '') + '</span>' +
      '<span class="atl-pc-nm">' + esc(name(p)) + '</span>' +
      '<span class="atl-pc-pr">' + esc(price(p.price)) + '</span>' +
      (tag ? '<span class="atl-tag">' + esc(tag) + '</span>' : '') +
    '</a>';
  }

  function renderChips() {
    var have = {};
    products.forEach(function (p) { var k = typeOf(p); if (k) have[k] = 1; });
    var keys = TYPES.map(function (x) { return x[0]; }).filter(function (k) { return have[k]; });
    if (current !== 'all' && !have[current]) current = 'all';
    if (keys.length < 2) { chips.hidden = true; chips.innerHTML = ''; return; }
    chips.hidden = false;
    chips.innerHTML = ['all'].concat(keys).map(function (k) {
      return '<button type="button" class="atl-chip" data-type="' + k + '" aria-pressed="' + (k === current) + '">' +
        esc(t('atl.cat.' + k, k)) + '</button>';
    }).join('');
  }

  function renderGrid() {
    var list = current === 'all' ? products : products.filter(function (p) { return typeOf(p) === current; });
    root.removeAttribute('aria-busy');
    if (!list.length) {
      root.innerHTML = '<div class="atl-empty"><h2 class="atl-t2">' + esc(t('catalog.empty', 'Katalog bo‘sh.')) + '</h2>' +
        '<div class="atl-btns"><a class="atl-btn atl-btn-p" href="configurator.html">' + esc(t('atl.nav.create', 'Dizayn yaratish')) + '</a></div></div>';
      return;
    }
    root.innerHTML = '<div class="atl-pgrid">' + list.map(card).join('') + '</div>';
  }

  function render() {
    if (!products) return;
    renderChips();
    renderGrid();
  }

  function skeleton() {
    var one = '<div class="atl-pc"><span class="atl-skel atl-gtile"></span>' +
      '<span class="atl-skel" style="height:14px;width:80%"></span>' +
      '<span class="atl-skel" style="height:14px;width:50%"></span></div>';
    root.setAttribute('aria-busy', 'true');
    root.innerHTML = '<div class="atl-pgrid" aria-label="' + esc(t('atl.loading', 'Yuklanmoqda')) + '">' + new Array(7).join(one) + '</div>';
  }

  function failed() {
    root.removeAttribute('aria-busy');
    root.innerHTML = fallback + '<div class="atl-empty"><h2 class="atl-t2">' + esc(t('atl.state.errT', 'Nimadir noto‘g‘ri ketdi')) + '</h2>' +
      '<p class="atl-lead">' + esc(t('atl.state.errL', 'Sahifani yuklab bo‘lmadi. Internetni tekshirib, yangilang.')) + '</p>' +
      '<div class="atl-btns"><button type="button" class="atl-btn atl-btn-g" data-retry>' + esc(t('atl.reload', 'Yangilash')) + '</button></div></div>';
  }

  function load() {
    if (!fallback) skeleton();
    fetch(api() + '/api/products')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { products = (d && d.products) || []; render(); })
      .catch(function () { failed(); });
  }

  chips && chips.addEventListener('click', function (e) {
    var b = e.target.closest('[data-type]');
    if (!b || b.getAttribute('data-type') === current) return;
    current = b.getAttribute('data-type');
    try {
      var u = new URL(location.href);
      if (current === 'all') u.searchParams.delete('type'); else u.searchParams.set('type', current);
      history.replaceState(null, '', u.pathname + u.search);
    } catch (err) { /* filter still works, URL just does not remember it */ }
    render();
  });
  root.addEventListener('click', function (e) {
    if (e.target.closest('[data-retry]')) load();
  });
  window.addEventListener('loom:langchange', render);

  load();
})();
