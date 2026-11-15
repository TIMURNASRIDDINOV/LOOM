/* ================================================================
   LOOM — shared bag (cart). One module for every page.

   Usage: <body data-cart> + <script src="assets/cart.js"></script>
   (after config.js / i18n.js / auth.js; layout.js provides the nav
   button #navCartBtn + badge #cartCount).

   Owns: cart state, API calls (quantity → PATCH, remove → DELETE),
   authenticated mockup thumbnails and the background 3D model upload.
   The cart UI is one page for every entry point: cart.html
   (assets/cart-page.js). open() goes there (LOOM-325).

   Public API: window.LOOM_CART = { load, sync, add, remove, setQty,
   uploadModel, open, state, updateBadge }

   state = { items, total (items only), delivery, payable (items +
   delivery), failed (true when the last load could not reach the
   server) }. Every change fires `loom:cart` on window.
================================================================ */
'use strict';
(function () {
  if (window.LOOM_CART) return;

  var ATELYE = !!document.querySelector('link[href*="assets/atelye.css"]');
  var EMPTY = function () { return { items: [], total: 0, delivery: 0, payable: 0 }; };
  var state = EMPTY();
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
    if (ATELYE) {
      el.className = 'atl-toast' + (type === 'error' ? ' atl-toast-err' : '');
      el.setAttribute('role', type === 'error' ? 'alert' : 'status');
      el.textContent = msg;
      document.body.appendChild(el);
      setTimeout(function () { el.remove(); }, 2600);
      return;
    }
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

  /* ── badge ──────────────────────────────────────────────────── */
  function updateBadge() {
    var n = state.items.reduce(function (s, i) { return s + (i.quantity || 1); }, 0);
    var el = document.getElementById('cartCount');
    if (el) { el.textContent = n; el.classList.toggle('show', n > 0); }
    // pages without the bottom nav (product, order) have no #cartCount: tell the shell
    else if (window.LOOM_SHELL && window.LOOM_SHELL.setCount) window.LOOM_SHELL.setCount(n);
    try { window.dispatchEvent(new CustomEvent('loom:cart', { detail: state })); } catch (e) { /* old browser */ }
  }

  /* ── API ────────────────────────────────────────────────────── */
  function sync(json) {
    if (json && Array.isArray(json.items)) state = json;
    updateBadge();
    return state;
  }
  async function load() {
    try {
      var res = await fetch(api() + '/api/cart', { headers: authHeaders(false), credentials: 'include' });
      if (res.ok) state = await res.json();
      else { state = EMPTY(); state.failed = res.status !== 401; }
    } catch (e) { state = EMPTY(); state.failed = true; }
    updateBadge();
    return state;
  }
  async function add(payload) {
    var res = await fetch(api() + '/api/cart', {
      method: 'POST', headers: authHeaders(true), credentials: 'include',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      var e = await res.json().catch(function () { return {}; });
      throw Object.assign(new Error(e.error || 'add failed'), { status: res.status, code: e.code });
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
    state.payable = state.total + (state.delivery || 0);
    updateBadge();
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

  /* ── 3D review model: background upload that outlives the page ──
     (LOOM-206) The bag item already carries the model's reserved key. The
     .glb (~6 MB, ~30 s on a slow mobile uplink) waits in IndexedDB until its
     PUT lands, and every page with the bag (checkout too) resumes an upload
     that leaving a page cut off. */
  var saving = Promise.resolve();
  var putting = {};
  function models(mode, fn) {
    return new Promise(function (resolve) {
      try {
        var open = indexedDB.open('loom-models', 1);
        open.onupgradeneeded = function () { open.result.createObjectStore('glb', { keyPath: 'key' }); };
        open.onerror = function () { resolve(null); };
        open.onsuccess = function () {
          var db = open.result, req;
          try { req = fn(db.transaction('glb', mode).objectStore('glb')); } catch (e) { db.close(); resolve(null); return; }
          req.onsuccess = function () { db.close(); resolve(req.result); };
          req.onerror = function () { db.close(); resolve(null); };
        };
      } catch (e) { resolve(null); }
    });
  }
  function putModel(key, blob) {
    if (putting[key]) return;
    putting[key] = true;
    fetch(api() + '/api/uploads/' + key, {
      method: 'PUT', headers: Object.assign(authHeaders(false), { 'Content-Type': 'model/gltf-binary' }),
      credentials: 'include', body: blob,
    }).then(function (res) {
      // Stored, or never will be (not ours, already there, invalid): forget it.
      // 401, 429 and 5xx stay for the next page.
      if (res.ok || [400, 404, 409].indexOf(res.status) >= 0) {
        return models('readwrite', function (s) { return s.delete(key); });
      }
    }).catch(function () { /* page left or offline: resumed on the next page */ })
      .then(function () { delete putting[key]; });
  }
  // Resolves once the .glb is built and kept on the device; the upload runs on.
  function uploadModel(key, glb) {
    saving = Promise.resolve(glb).then(function (blob) {
      if (!key || !blob) return;
      return models('readwrite', function (s) { return s.put({ key: key, blob: blob, at: Date.now() }); })
        .then(function () { putModel(key, blob); });
    });
    return saving;
  }
  function resumeModels() {
    models('readonly', function (s) { return s.getAll(); }).then(function (rows) {
      (rows || []).forEach(function (r) {
        if (Date.now() - r.at > 7 * 864e5) models('readwrite', function (s) { return s.delete(r.key); });
        else putModel(r.key, r.blob);
      });
    });
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
  var COLOR_NAMES = { '#FFFFFF': { ru: 'Белый', uz: 'Oq', en: 'White' }, '#000000': { ru: 'Чёрный', uz: 'Qora', en: 'Black' }, '#1F2937': { ru: 'Тёмный', uz: 'To‘q', en: 'Dark' } };
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
  function productName(item) {
    var lang = window.LOOM_I18N && window.LOOM_I18N.getLang ? window.LOOM_I18N.getLang() : 'ru';
    return item['product_name_' + lang] || item.product_name_ru || item.product_name || item.product_name_en || item.product_name_uz || t('cart.item', 'Футболка');
  }

  /* ── open: the one cart page ──────────────────────────────────
     A 3D model still being kept on the device would be lost with the
     page: wait for it (≤ 5 s), then go. */
  function open() {
    return Promise.race([saving, new Promise(function (r) { setTimeout(r, 5000); })])
      .then(function () { location.href = 'cart.html'; });
  }

  /* ── desktop drawer (LOOM-333) ────────────────────────────────
     From 900 px on an Atelye page, the header Savat link opens a 460 px
     drawer instead of leaving the page: lines, the server's totals and
     Rasmiylashtirish directly under Jami. Focus moves in and is kept
     there; Esc, the dimmer and the close button shut it and focus goes
     back to the link. Phones and the cart/checkout pages keep the link. */
  var DESK = '(min-width: 900px)';
  var dr = null, drOpener = null;
  var DI = {
    x: 'M6 6l12 12M18 6L6 18',
    shirt: 'M8 4l-5 3 2 4 2-1v10h10V10l2 1 2-4-5-3a4 4 0 01-8 0z',
    edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  };
  function dic(n, small) { return '<svg class="atl-ic' + (small ? ' atl-ic-s' : '') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + DI[n] + '"/></svg>'; }
  function desc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function drawerOn() {
    var page = document.body.getAttribute('data-page');
    // the configurator loads cfg-atelye.css, not atelye.css (LOOM-338)
    return (ATELYE || document.documentElement.classList.contains('cfg-atelye-d')) &&
      page !== 'cart' && page !== 'checkout' &&
      !document.documentElement.classList.contains('tma') &&
      !!(window.matchMedia && window.matchMedia(DESK).matches);
  }
  function drawerHtml() {
    var items = state.items || [];
    var n = items.reduce(function (s, i) { return s + (i.quantity || 1); }, 0);
    var title = n ? t('atl.cart.titleN', 'Savat · {n}').replace('{n}', n) : t('atl.cart.title', 'Savat');
    var head = '<div class="atl-drw-hd"><h2 class="atl-t3" id="atl-drw-h">' + desc(title) + '</h2>' +
      '<button type="button" class="atl-ib" data-drw-close aria-label="' + desc(t('atl.close', 'Yopish')) + '">' + dic('x') + '</button></div>';
    if (!items.length) {
      return head + '<div class="atl-drw-bd"><div class="atl-empty">' +
        '<p class="atl-t3">' + desc(t('atl.cart.empty', 'Savat bo‘sh')) + '</p>' +
        '<p class="atl-sm">' + desc(t('atl.cart.emptyLead', '')) + '</p>' +
        '<div class="atl-btns" style="width:100%"><a class="atl-btn atl-btn-p" href="configurator.html">' + desc(t('atl.nav.create', 'Dizayn yaratish')) + '</a>' +
        '<a class="atl-btn" href="catalog.html">' + desc(t('atl.cart.toCatalog', 'Katalogga o‘tish')) + '</a></div></div></div>';
    }
    var lines = items.map(function (it) {
      var meta = summarize(it.design_json).join(' · ');
      var design = true;
      try { design = !JSON.parse(it.design_json || '{}').plain; } catch (e) { design = true; }
      return '<div class="atl-row atl-drw-row" data-id="' + desc(it.id) + '">' +
        '<span class="atl-cv atl-thumb">' + dic('shirt', 1) + '<img alt="" decoding="async" style="display:none"></span>' +
        '<span class="atl-row-tx"><span class="atl-drw-top"><b>' + desc(productName(it)) + '</b><b class="atl-num">' + desc(fmt(it.unit_price * it.quantity)) + '</b></span>' +
          (meta ? '<i>' + desc(meta) + '</i>' : '') +
          (it.unavailable ? '<span class="atl-warn">' + desc(t('cfg.productUnavailable', 'Bu mahsulot hozir mavjud emas')) + '</span>' : '') +
          '<span class="atl-drw-ctl"><span class="atl-qty" role="group">' +
            '<button type="button" data-drw="dec" aria-label="' + desc(t('atl.cart.dec', 'Kamaytirish')) + '"' + (it.quantity <= 1 ? ' disabled' : '') + '>−</button>' +
            '<output>' + desc(it.quantity) + '</output>' +
            '<button type="button" data-drw="inc" aria-label="' + desc(t('atl.cart.inc', 'Ko‘paytirish')) + '"' + (it.quantity >= 99 ? ' disabled' : '') + '>+</button></span>' +
            (design ? '<a class="atl-ib" href="configurator.html?item=' + encodeURIComponent(it.id) + '" aria-label="' + desc(t('atl.cart.edit', 'O‘zgartirish')) + '">' + dic('edit', 1) + '</a>' : '') +
            '<button type="button" class="atl-ib" data-drw="del" aria-label="' + desc(t('atl.cart.remove', 'O‘chirish')) + '">' + dic('trash', 1) + '</button>' +
          '</span></span></div>';
    }).join('');
    var delivery = state.delivery || 0;
    var payable = typeof state.payable === 'number' ? state.payable : (state.total || 0) + delivery;
    return head + '<div class="atl-drw-bd atl-lst">' + lines + '</div>' +
      '<div class="atl-drw-ft"><div class="atl-price-lines">' +
        '<div><span>' + desc(t('atl.sum.items', 'Mahsulotlar')) + '</span><span>' + desc(fmt(state.total || 0)) + '</span></div>' +
        '<div><span>' + desc(t('atl.sum.delivery', 'Yetkazib berish')) + '</span><span>' + desc(fmt(delivery)) + '</span></div>' +
        '<div class="atl-price-tot"><span>' + desc(t('atl.sum.total', 'Jami')) + '</span><span>' + desc(fmt(payable)) + '</span></div></div>' +
        '<a class="atl-btn atl-btn-p atl-btn-w" href="checkout.html">' + desc(t('atl.cart.checkout', 'Rasmiylashtirish')) + '</a>' +
        '<p class="atl-sm">' + desc(t('atl.cart.prepayNote', '')) + '</p></div>';
  }
  function paintDrawer() {
    if (!dr) return;
    var a = document.activeElement, keep = null;
    if (a && dr.panel.contains(a)) {
      var row = a.closest('[data-id]');
      keep = a.hasAttribute('data-drw') && row ? '[data-id="' + row.getAttribute('data-id') + '"] [data-drw="' + a.getAttribute('data-drw') + '"]' : null;
    }
    dr.panel.innerHTML = drawerHtml();
    (state.items || []).forEach(function (it) {
      var img = dr.panel.querySelector('[data-id="' + it.id + '"] img');
      if (!img) return;
      img.addEventListener('load', function () { var svg = img.previousElementSibling; if (svg) svg.remove(); }, { once: true });
      thumbInto(img, it);
    });
    var f = keep && dr.panel.querySelector(keep);
    if (a && dr.panel.contains(a) && !document.contains(a)) (f && !f.disabled ? f : dr.panel.querySelector('[data-drw-close]')).focus();
  }
  function focusables() {
    return Array.prototype.filter.call(dr.panel.querySelectorAll('a[href],button:not([disabled])'), function (el) { return el.offsetParent !== null; });
  }
  function openDrawer(from) {
    if (dr) return;
    drOpener = from || null;
    var dim = document.createElement('div');
    dim.className = 'atl-dim atl-drw-dim';
    var panel = document.createElement('aside');
    panel.className = 'atl-drw';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'atl-drw-h');
    document.body.appendChild(dim);
    document.body.appendChild(panel);
    dr = { dim: dim, panel: panel };
    paintDrawer();
    dim.addEventListener('click', closeDrawer);
    panel.addEventListener('click', function (e) {
      if (e.target.closest('[data-drw-close]')) return closeDrawer();
      var b = e.target.closest('button[data-drw]');
      if (!b || b.disabled) return;
      var id = b.closest('[data-id]').getAttribute('data-id');
      var it = state.items.find(function (i) { return String(i.id) === id; });
      if (!it) return;
      var act = b.getAttribute('data-drw');
      if (act === 'del') { b.disabled = true; remove(it.id); }
      else setQty(it.id, it.quantity + (act === 'inc' ? 1 : -1));
    });
    panel.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); return closeDrawer(); }
      if (e.key !== 'Tab') return;
      var all = focusables();
      if (!all.length) return;
      var first = all[0], last = all[all.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    document.documentElement.classList.add('atl-drw-open');
    panel.querySelector('[data-drw-close]').focus();
  }
  function closeDrawer() {
    if (!dr) return;
    dr.dim.remove();
    dr.panel.remove();
    dr = null;
    document.documentElement.classList.remove('atl-drw-open');
    var o = drOpener && document.contains(drOpener) ? drOpener : document.querySelector('.atl-hdr [data-atl-cart-link]');
    if (o) o.focus();
  }
  window.addEventListener('loom:cart', paintDrawer);
  window.addEventListener('loom:langchange', paintDrawer);
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-atl-cart-link]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !drawerOn()) return;
    e.preventDefault();
    // the toast's link: hand focus back to the header link, not the vanishing toast
    openDrawer(a.closest('.atl-toast') ? document.querySelector('.atl-hdr [data-atl-cart-link]') : a);
  }, true); // capture: runs before motion.js's page-leave wipe on the configurator (LOOM-338)

  /* ── boot ───────────────────────────────────────────────────── */
  function boot() {
    var btn = document.getElementById('navCartBtn');
    if (btn) btn.addEventListener('click', open);
    /* checkout.js and cart-page.js own the cart fetch on their pages
       (checkout must load AFTER the auth gate; loading here too would
       duplicate the request and race a not-yet-logged-in 401 into the
       state). */
    var page = document.body.getAttribute('data-page');
    if (page !== 'checkout' && page !== 'cart') load();
    resumeModels();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.LOOM_CART = {
    productName: productName,
    load: load, sync: sync, add: add, remove: remove, setQty: setQty, uploadModel: uploadModel,
    open: open, updateBadge: updateBadge, toast: toast, openDrawer: openDrawer, closeDrawer: closeDrawer,
    thumbInto: thumbInto, summarize: summarize,
    get state() { return state; },
  };
})();
