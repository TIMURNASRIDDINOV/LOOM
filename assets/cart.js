/* ================================================================
   LOOM — shared bag (cart). One module for every page.

   Usage: <body data-cart> + <script src="assets/cart.js"></script>
   (after config.js / i18n.js / auth.js; layout.js provides the nav
   button #navCartBtn + badge #cartCount).

   Owns: cart state, API calls, the full-screen drawer (markup is
   injected here — pages carry no drawer HTML), line-item editing
   (quantity steppers → PATCH, remove → DELETE, "edit design" →
   configurator.html?item=ID), authenticated mockup thumbnails, and
   the checkout handoff (checkout.html).

   Public API: window.LOOM_CART = { load, sync, add, remove, setQty,
   open, close, state, updateBadge }
================================================================ */
'use strict';
(function () {
  if (window.LOOM_CART) return;

  var state = { items: [], total: 0 };
  var thumbCache = {};   // itemId → objectURL (authenticated blob fetch)
  var qtyTimers = {};    // itemId → debounce timer for PATCH

  function api() {
    if (window.LOOM_CONFIG && window.LOOM_CONFIG.API_BASE) return window.LOOM_CONFIG.API_BASE;
    return location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? 'http://localhost:8787' : 'https://api.loomdesign.uz';
  }
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
  function fmt(n) {
    try {
      if (window.LOOM_I18N && window.LOOM_I18N.formatPrice) return window.LOOM_I18N.formatPrice(n);
    } catch (e) { /* fall through */ }
    return new Intl.NumberFormat('ru-RU').format(n) + ' ' + t('cfg.currency', 'сум');
  }
  function authHeaders(json) {
    var h = json ? { 'Content-Type': 'application/json' } : {};
    var token = window.LOOM_AUTH && window.LOOM_AUTH.getToken && window.LOOM_AUTH.getToken();
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }

  /* ── tiny toast (pages without configurator.js need one) ────── */
  function toast(msg, type) {
    var el = document.getElementById('loom-toast');
    if (el) el.remove();
    el = document.createElement('div');
    el.id = 'loom-toast';
    el.style.cssText =
      'position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(8px);z-index:10001;' +
      'padding:0.8rem 1.3rem;border-radius:2px;font-family:var(--font-body);font-size:0.85rem;font-weight:500;' +
      'color:var(--on-accent);box-shadow:var(--menu-shadow);opacity:0;transition:opacity .25s ease,transform .25s ease;' +
      'background:' + (type === 'error' ? 'var(--danger)' : 'var(--ok)');
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(function () {
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(function () {
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 300);
    }, 2600);
  }

  /* ── drawer markup (injected once) ──────────────────────────── */
  function ensureDrawer() {
    if (document.getElementById('cartDrawer')) return;
    var html =
      '<div class="drawer-backdrop" id="cartBackdrop"></div>' +
      '<aside class="cart-drawer" id="cartDrawer" aria-label="Cart" aria-hidden="true">' +
        '<div class="cart-head">' +
          '<h2 class="cart-title"><span data-i18n="cfg.cartTitle">Корзина</span><span class="cart-title-slash">/</span></h2>' +
          '<button class="mobile-menu-close" id="cartClose" aria-label="Close">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="cart-body" id="cartBody">' +
          '<p class="cart-empty" data-i18n="cfg.cartEmpty">Корзина пуста</p>' +
        '</div>' +
        '<div class="cart-foot" id="cartFoot" style="display:none">' +
          '<div class="cart-total-row">' +
            '<span class="cart-total-label" data-i18n="cfg.total">Итого</span>' +
            '<span class="cart-total-val"><span id="cartTotal">0</span> <span data-i18n="cfg.currency">сум</span></span>' +
          '</div>' +
          '<button class="btn-primary-full" id="cartCheckoutBtn" type="button" data-i18n="cfg.checkout">Оформить заказ</button>' +
        '</div>' +
      '</aside>';
    document.body.insertAdjacentHTML('beforeend', html);
    if (window.LOOM_I18N && window.LOOM_I18N.apply) window.LOOM_I18N.apply();
    document.getElementById('cartClose').addEventListener('click', function () { close(); });
    document.getElementById('cartBackdrop').addEventListener('click', function () { close(); });
    document.getElementById('cartCheckoutBtn').addEventListener('click', function () {
      if (!state.items.length) { toast(t('cfg.cartEmpty', 'Корзина пуста'), 'error'); return; }
      close();
      location.href = 'checkout.html';
    });
  }

  /* ── badge ──────────────────────────────────────────────────── */
  function updateBadge() {
    var n = state.items.reduce(function (s, i) { return s + (i.quantity || 1); }, 0);
    var el = document.getElementById('cartCount');
    if (el) { el.textContent = n; el.classList.toggle('show', n > 0); }
  }

  /* ── API ────────────────────────────────────────────────────── */
  function sync(json) {
    if (json && Array.isArray(json.items)) state = json;
    updateBadge();
    render();
    return state;
  }
  async function load() {
    try {
      var res = await fetch(api() + '/api/cart', { headers: authHeaders(false), credentials: 'include' });
      state = res.ok ? await res.json() : { items: [], total: 0 };
    } catch (e) { state = { items: [], total: 0 }; }
    updateBadge();
    render();
    return state;
  }
  async function add(payload) {
    var res = await fetch(api() + '/api/cart', {
      method: 'POST', headers: authHeaders(true), credentials: 'include',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      var e = await res.json().catch(function () { return {}; });
      throw Object.assign(new Error(e.error || 'add failed'), { status: res.status });
    }
    sync(await res.json());
    return state;
  }
  async function remove(id) {
    try {
      var res = await fetch(api() + '/api/cart/' + encodeURIComponent(id), {
        method: 'DELETE', headers: authHeaders(false), credentials: 'include',
      });
      if (res.ok) sync(await res.json());
    } catch (e) { /* keep current state */ }
  }
  function setQty(id, qty) {
    qty = Math.max(1, Math.min(99, qty | 0));
    var item = state.items.find(function (i) { return i.id === id; });
    if (item) item.quantity = qty; // optimistic
    state.total = state.items.reduce(function (s, i) { return s + i.unit_price * i.quantity; }, 0);
    updateBadge();
    renderTotals();
    clearTimeout(qtyTimers[id]);
    qtyTimers[id] = setTimeout(async function () {
      try {
        var res = await fetch(api() + '/api/cart/' + id, {
          method: 'PATCH', headers: authHeaders(true), credentials: 'include',
          body: JSON.stringify({ quantity: qty }),
        });
        if (res.ok) sync(await res.json());
      } catch (e) { /* next load reconciles */ }
    }, 350);
  }

  /* ── thumbnails: authenticated blob → objectURL ─────────────── */
  function thumbInto(imgEl, item) {
    var key = item.front_mockup_key ? 'front-mockup' : item.back_mockup_key ? 'back-mockup' : null;
    if (!key) return;
    var cacheKey = item.id + ':' + key;
    if (thumbCache[cacheKey]) { imgEl.src = thumbCache[cacheKey]; imgEl.style.display = 'block'; return; }
    fetch(api() + '/api/cart/' + item.id + '/file/' + key, { headers: authHeaders(false), credentials: 'include' })
      .then(function (r) { return r.ok ? r.blob() : null; })
      .then(function (blob) {
        if (!blob) return;
        var url = URL.createObjectURL(blob);
        thumbCache[cacheKey] = url;
        imgEl.src = url;
        imgEl.style.display = 'block';
      })
      .catch(function () { /* icon fallback stays */ });
  }

  /* ── design summary line (colour · size · text · logo) ──────── */
  var COLOR_NAMES = { '#FFFFFF': { ru: 'Белый', uz: 'Oq', en: 'White' }, '#1F2937': { ru: 'Тёмный', uz: 'To‘q', en: 'Dark' } };
  function colorName(hex) {
    if (!hex) return '';
    var lang = (window.LOOM_I18N && window.LOOM_I18N.getLang()) || 'ru';
    var e = COLOR_NAMES[String(hex).toUpperCase()];
    return e ? (e[lang] || e.ru) : hex;
  }
  function summarize(designJson) {
    var d = {};
    try { d = JSON.parse(designJson || '{}'); } catch (e) { d = {}; }
    var bits = [];
    if (d.shirtColor) bits.push(colorName(d.shirtColor));
    if (d.size) bits.push(d.size);
    var txt = d.front && d.front.text && d.front.text.content;
    if (txt) bits.push('«' + txt + '»');
    if (d.front && d.front.image && d.front.image.name) bits.push(t('cfg.layerLogo', 'Логотип'));
    if (d.plain) bits.push(t('cart.plain', 'Без принта'));
    return bits;
  }
  function hasDesign(item) {
    try {
      var d = JSON.parse(item.design_json || '{}');
      return !d.plain;
    } catch (e) { return true; }
  }

  /* ── render ─────────────────────────────────────────────────── */
  function renderTotals() {
    var totalEl = document.getElementById('cartTotal');
    if (totalEl) totalEl.textContent = new Intl.NumberFormat('ru-RU').format(state.total || 0);
    state.items.forEach(function (it) {
      var row = document.querySelector('.cart-item[data-id="' + it.id + '"]');
      if (!row) return;
      var q = row.querySelector('.cart-qty-val');
      if (q) q.textContent = it.quantity;
      var p = row.querySelector('.cart-item-price');
      if (p) p.textContent = new Intl.NumberFormat('ru-RU').format(it.unit_price * it.quantity) + ' ' + t('cfg.currency', 'сум');
    });
  }
  function render() {
    var body = document.getElementById('cartBody');
    var foot = document.getElementById('cartFoot');
    if (!body) return;
    if (!state.items.length) {
      body.innerHTML = '<p class="cart-empty">' + esc(t('cfg.cartEmpty', 'Корзина пуста')) + '</p>';
      if (foot) foot.style.display = 'none';
      return;
    }
    var cur = t('cfg.currency', 'сум');
    body.innerHTML = state.items.map(function (it) {
      var meta = summarize(it.design_json).map(esc).join(' · ');
      var editBtn = hasDesign(it)
        ? '<a class="cart-item-edit" href="configurator.html?item=' + it.id + '">' +
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>' +
            '<span>' + esc(t('cart.edit', 'Изменить')) + '</span></a>'
        : '';
      return (
        '<div class="cart-item" data-id="' + it.id + '">' +
          '<div class="cart-item-thumb">' +
            '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/></svg>' +
            '<img alt="" loading="lazy" style="display:none">' +
          '</div>' +
          '<div class="cart-item-info">' +
            '<span class="cart-item-name">' + esc(it.product_name || t('cart.item', 'Футболка')) + '</span>' +
            (meta ? '<span class="cart-item-meta">' + meta + '</span>' : '') +
            '<div class="cart-item-row">' +
              '<div class="cart-qty" role="group" aria-label="Quantity">' +
                '<button class="cart-qty-btn" data-act="dec" aria-label="−">−</button>' +
                '<span class="cart-qty-val">' + it.quantity + '</span>' +
                '<button class="cart-qty-btn" data-act="inc" aria-label="+">+</button>' +
              '</div>' +
              editBtn +
            '</div>' +
            '<span class="cart-item-price">' + new Intl.NumberFormat('ru-RU').format(it.unit_price * it.quantity) + ' ' + cur + '</span>' +
          '</div>' +
          '<button class="cart-item-remove" data-id="' + it.id + '" aria-label="' + esc(t('cart.remove', 'Удалить')) + '">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
          '</button>' +
        '</div>');
    }).join('');

    state.items.forEach(function (it) {
      var row = body.querySelector('.cart-item[data-id="' + it.id + '"]');
      thumbInto(row.querySelector('.cart-item-thumb img'), it);
      row.querySelectorAll('.cart-qty-btn').forEach(function (b) {
        b.addEventListener('click', function () {
          var item = state.items.find(function (i) { return i.id === it.id; });
          if (!item) return;
          setQty(it.id, item.quantity + (b.dataset.act === 'inc' ? 1 : -1));
        });
      });
      row.querySelector('.cart-item-remove').addEventListener('click', function () { remove(it.id); });
    });

    var totalEl = document.getElementById('cartTotal');
    if (totalEl) totalEl.textContent = new Intl.NumberFormat('ru-RU').format(state.total || 0);
    if (foot) foot.style.display = 'flex';
  }

  /* ── open / close (iOS scroll lock + Android back button) ───── */
  var scrollY = 0;
  function openDrawer() {
    ensureDrawer();
    var drawer = document.getElementById('cartDrawer');
    if (drawer.classList.contains('active')) return;
    drawer.classList.add('active');
    document.getElementById('cartBackdrop').classList.add('active');
    document.body.classList.add('menu-open');
    scrollY = window.scrollY || 0;
    document.body.style.position = 'fixed';
    document.body.style.top = -scrollY + 'px';
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    try { history.pushState({ loomBag: 1 }, ''); } catch (e) {}
  }
  async function open() {
    ensureDrawer();
    await load();
    openDrawer();
  }
  function close(fromPopstate) {
    var drawer = document.getElementById('cartDrawer');
    if (!drawer || !drawer.classList.contains('active')) return;
    drawer.classList.remove('active');
    var bd = document.getElementById('cartBackdrop');
    if (bd) bd.classList.remove('active');
    document.body.classList.remove('menu-open');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    window.scrollTo(0, scrollY);
    if (!fromPopstate && history.state && history.state.loomBag) {
      try { history.back(); } catch (e) {}
    }
  }
  window.addEventListener('popstate', function () {
    var drawer = document.getElementById('cartDrawer');
    if (drawer && drawer.classList.contains('active')) close(true);
  });

  /* ── boot ───────────────────────────────────────────────────── */
  function boot() {
    ensureDrawer();
    var btn = document.getElementById('navCartBtn');
    if (btn) btn.addEventListener('click', open);
    /* language switch: item meta lines are JS-rendered */
    window.addEventListener('loom:langchange', render);
    load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.LOOM_CART = {
    load: load, sync: sync, add: add, remove: remove, setQty: setQty,
    open: open, close: close, updateBadge: updateBadge, toast: toast,
    thumbInto: thumbInto, summarize: summarize,
    get state() { return state; },
  };
})();
