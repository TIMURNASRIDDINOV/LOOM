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
    open: open, updateBadge: updateBadge, toast: toast,
    thumbInto: thumbInto, summarize: summarize,
    get state() { return state; },
  };
})();
