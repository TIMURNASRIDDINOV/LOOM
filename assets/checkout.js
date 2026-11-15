/* ================================================================
   LOOM — checkout (checkout.html), Atelye skin (PRD-216, LOOM-323).

   Flow: payment methods are fetched at once (no auth needed) → auth
   gate (no user = login.html?next=checkout.html) → cart → contact
   prefill, address (saved address or the map picker, plain field
   when the map cannot load), payment tiles → validate → POST
   /api/cart/checkout with paymentMethod 'p2p' → order.html?id=<id>,
   which is the payment screen.

   Money rules:
   · Only a card transfer (p2p) can be ordered. Payme / Click / Uzum
     are "Tez orada".
   · No order unless GET /api/payments/methods says p2p:true. A site
     deployed before its Worker would otherwise create COD orders
     (plan R2). The check runs again on every submit.
   · Delivery and every amount on screen come from the server cart
     (delivery, payable); the server prices the order again anyway.
================================================================ */
'use strict';
(function () {
  function api() {
    if (window.LOOM_CONFIG && window.LOOM_CONFIG.API_BASE) return window.LOOM_CONFIG.API_BASE;
    return location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? 'http://localhost:8787' : 'https://api.loomdesign.uz';
  }
  // Server refusal codes for an item that can no longer be sold (backend/src/lib/variant.ts).
  var UNSOLD = {
    product_unavailable: ['cfg.productUnavailable', 'Bu mahsulot hozir mavjud emas'],
    size_unavailable: ['cfg.sizeUnavailable', 'Bu o‘lcham mavjud emas — boshqasini tanlang'],
    color_unavailable: ['cfg.colorUnavailable', 'Bu rang mavjud emas — boshqasini tanlang'],
    print_unavailable: ['cfg.blankNote', 'Bu mahsulot bosmasiz sotiladi'],
  };
  var LOGIN = 'login.html?next=checkout.html';

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
  function som(n) {
    try { if (window.LOOM_I18N && window.LOOM_I18N.formatPrice) return window.LOOM_I18N.formatPrice(n); } catch (e) { /* fall through */ }
    return new Intl.NumberFormat('ru-RU').format(n || 0) + ' so‘m';
  }
  function authHeaders(json) {
    var h = json ? { 'Content-Type': 'application/json' } : {};
    var token = window.LOOM_AUTH && window.LOOM_AUTH.getToken && window.LOOM_AUTH.getToken();
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }
  function $(id) { return document.getElementById(id); }
  function show(id, on) { var el = $(id); if (el) el.hidden = !on; }
  function places() { return document.querySelectorAll('[data-co-place]'); }
  var IC = {
    alert: 'M12 8v5M12 16.5h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
    shirt: 'M8 4l-5 3 2 4 2-1v10h10V10l2 1 2-4-5-3a4 4 0 01-8 0z',
  };
  function ic(n) { return '<svg class="atl-ic atl-ic-s" viewBox="0 0 24 24" aria-hidden="true"><path d="' + IC[n] + '"/></svg>'; }

  var picker = null;          // LOOM_ADDRESS instance, or null when degraded
  var manualAddress = false;  // true = plain text field replaced the map
  var useSaved = false;       // the saved address option is chosen
  var preset = null;          // user.location_preset {address, lat?, lng?}
  var user = null;
  var methods = { p2p: false };
  var methodsFailed = false;
  var placing = false;

  /* ── idempotency: one key per (user, cart, form) attempt ─────── */
  var pendingAttempt = null;
  function checkoutKey(payload) {
    var body = Object.assign({}, payload); delete body.sessionId;
    var fingerprint = JSON.stringify({ user: user && user.id, items: window.LOOM_CART.state.items.map(function (item) {
      return { id: item.id, quantity: item.quantity, design: item.design_json };
    }), body: body });
    if (!pendingAttempt) { try { pendingAttempt = JSON.parse(sessionStorage.getItem('loom_checkout_attempt') || 'null'); } catch (_) {} }
    if (!pendingAttempt || pendingAttempt.fingerprint !== fingerprint) {
      pendingAttempt = { fingerprint: fingerprint, key: window.crypto && window.crypto.randomUUID
        ? window.crypto.randomUUID() : 'checkout_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) };
      try { sessionStorage.setItem('loom_checkout_attempt', JSON.stringify(pendingAttempt)); } catch (_) {}
    }
    return pendingAttempt.key;
  }
  function clearCheckoutKey() {
    pendingAttempt = null;
    try { sessionStorage.removeItem('loom_checkout_attempt'); } catch (_) {}
  }

  /* ── payment methods (no auth) ──────────────────────────────── */
  function fetchMethods() {
    return fetch(api() + '/api/payments/methods')
      .then(function (r) { if (!r.ok) throw new Error('methods ' + r.status); return r.json(); })
      .then(function (m) { methodsFailed = false; methods = m && typeof m === 'object' ? m : { p2p: false }; })
      .catch(function () { methodsFailed = true; methods = { p2p: false }; });
  }
  var methodsPromise = fetchMethods();
  function p2pOn() { return methods.p2p === true; }

  /* ── Leaflet on demand (CSS + JS injected only when the map mounts) ── */
  var LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  var LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  var LEAFLET_JS_SRI = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
  var LEAFLET_CSS_SRI = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
  var leafletPromise = null;
  /* Not `typeof window.L`: the Lenis UMD bundle also publishes a global L. */
  function hasLeaflet() {
    return !!(window.L && typeof window.L.map === 'function' && typeof window.L.tileLayer === 'function');
  }
  function ensureLeaflet() {
    if (hasLeaflet()) return Promise.resolve();
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise(function (resolve, reject) {
      /* wait for the stylesheet too, or tiles land in the wrong place */
      var cssDone = new Promise(function (done) {
        var css = document.createElement('link');
        css.rel = 'stylesheet'; css.href = LEAFLET_CSS; css.integrity = LEAFLET_CSS_SRI; css.crossOrigin = '';
        css.onload = done; css.onerror = done;   // unstyled map beats no map
        document.head.appendChild(css);
      });
      var s = document.createElement('script');
      s.src = LEAFLET_JS; s.integrity = LEAFLET_JS_SRI; s.crossOrigin = ''; s.async = true;
      s.onload = function () { cssDone.then(resolve); };
      s.onerror = function () { reject(new Error('leaflet failed to load')); };
      document.head.appendChild(s);
      // a hung CDN must not strand the customer on a map that never appears
      setTimeout(function () { if (!hasLeaflet()) reject(new Error('leaflet timed out')); }, 12000);
    });
    return leafletPromise;
  }

  /* ── address: saved option, map picker, or plain field ──────── */
  function mountManualAddress(host) {
    manualAddress = true;
    picker = null;
    host.innerHTML =
      '<div class="atl-field">' +
        '<label class="atl-field-l" for="co-address-manual" data-i18n="atl.co.addr">' + esc(t('atl.co.addr', 'Manzil')) + '</label>' +
        '<input class="atl-inp" id="co-address-manual" autocomplete="street-address" maxlength="300" aria-describedby="co-addr-err"' +
          ' data-i18n-attr="placeholder:atl.co.addrPh" placeholder="' + esc(t('atl.co.addrPh', 'Ko‘cha, uy, mo‘ljal…')) + '">' +
        '<span class="atl-hint" data-i18n="co.mapOffline">' + esc(t('co.mapOffline', 'Xarita mavjud emas. Manzilni qo‘lda kiriting — kuryer aniqlashtirish uchun bog‘lanadi.')) + '</span>' +
      '</div>';
  }
  var mapMounting = null;
  function mountMap() {
    if (picker || manualAddress) return Promise.resolve();
    if (mapMounting) return mapMounting;
    var host = $('co-address');
    var initial = preset && preset.lat && preset.lng ? { lat: preset.lat, lng: preset.lng } : null;
    mapMounting = ensureLeaflet().then(function () {
      picker = window.LOOM_ADDRESS ? window.LOOM_ADDRESS.mount(host, { initial: initial }) : null;
      if (!picker) mountManualAddress(host);
    }).catch(function () { mountManualAddress(host); });
    return mapMounting;
  }
  function opt(name, value, title, sub, on, off, tag) {
    return '<button type="button" class="atl-opt" role="radio" data-' + name + '="' + value + '" aria-checked="' + !!on + '"' +
        (off ? ' aria-disabled="true"' : '') + ' tabindex="' + (on ? '0' : '-1') + '">' +
      '<span class="atl-opt-rd"></span>' +
      '<span class="atl-opt-tx"><b>' + esc(title) + '</b>' + (sub ? '<i>' + esc(sub) + '</i>' : '') + '</span>' +
      (tag ? '<span class="atl-tag">' + esc(tag) + '</span>' : '') +
    '</button>';
  }
  function renderAddrChoice() {
    var box = $('co-addr-choice');
    if (!preset || !preset.address) { box.hidden = true; return; }
    box.hidden = false;
    box.setAttribute('aria-label', t('atl.co.addr', 'Manzil'));
    box.innerHTML =
      opt('addr', 'saved', preset.address, t('atl.co.savedAddr', 'saqlangan manzil'), useSaved) +
      opt('addr', 'other', t('atl.co.otherAddr', 'Boshqa manzil'), t('atl.co.otherAddrSub', 'Xaritada yoki qo‘lda kiriting'), !useSaved);
  }
  function chooseAddr(v) {
    useSaved = v === 'saved';
    renderAddrChoice();
    $('co-address').hidden = useSaved;
    fieldErr('co-addr-err', null);
    if (!useSaved) mountMap().then(function () { if (picker && picker.invalidate) picker.invalidate(); });
  }
  function readAddress() {
    if (useSaved && preset && preset.address) {
      return { lat: typeof preset.lat === 'number' ? preset.lat : null, lng: typeof preset.lng === 'number' ? preset.lng : null, address: preset.address };
    }
    if (manualAddress) {
      var el = $('co-address-manual');
      var v = el ? el.value.trim() : '';
      return v ? { lat: null, lng: null, address: v } : null;
    }
    if (!picker) return null;
    var a = picker.get();
    // settled but still reverse-geocoding: the address is not known yet
    return a && a.address ? a : null;
  }
  function addressPending() {
    return !useSaved && !manualAddress && !!picker && !!picker.get() && !picker.get().address;
  }

  /* ── radio groups: click + arrow keys (role=radio buttons) ───── */
  function wireRadios(box, attr, onPick) {
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[role="radio"]');
      if (!b || b.getAttribute('aria-disabled') === 'true') return;
      onPick(b.getAttribute('data-' + attr));
    });
    box.addEventListener('keydown', function (e) {
      if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].indexOf(e.key) < 0) return;
      var all = Array.prototype.filter.call(box.querySelectorAll('[role="radio"]'), function (b) {
        return b.getAttribute('aria-disabled') !== 'true';
      });
      if (all.length < 2) return;
      e.preventDefault();
      var i = all.indexOf(document.activeElement);
      var next = all[(i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
      onPick(next.getAttribute('data-' + attr));
      var again = box.querySelector('[data-' + attr + '="' + next.getAttribute('data-' + attr) + '"]');
      if (again) again.focus();
    });
  }

  /* ── phone: +998 is a fixed prefix, the field holds 9 digits ─── */
  function nine(v) {
    var d = String(v || '').replace(/\D/g, '');
    if (d.length > 9 && d.indexOf('998') === 0) d = d.slice(3);
    return d.slice(0, 9);
  }
  function fmtPhone(v) {
    var d = nine(v);
    return [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean).join(' ');
  }
  /* keep the caret on the same digit while the mask re-spaces the text */
  function applyPhoneMask(el) {
    var before = el.value;
    var caret = el.selectionStart == null ? before.length : el.selectionStart;
    var digitsBefore = before.slice(0, caret).replace(/\D/g, '').length;
    var next = fmtPhone(before);
    if (next === before) return;
    el.value = next;
    var pos = 0, seen = 0;
    while (pos < next.length && seen < digitsBefore) { if (/\d/.test(next.charAt(pos))) seen++; pos++; }
    try { el.setSelectionRange(pos, pos); } catch (e) { /* not a text input */ }
  }
  function phoneValid() { return /^\d{9}$/.test(nine($('co-phone').value)); }
  function verified() {
    return !!(user && user.phone_verified) && user.phone && nine(user.phone) === nine($('co-phone').value);
  }
  function paintVerified() {
    var ok = verified();
    show('co-phone-ok', ok);
    show('co-verify', !ok && !(user && user.phone_verified));
  }

  /* ── payment tiles ──────────────────────────────────────────── */
  function renderPay() {
    var soon = t('atl.soon', 'Tez orada');
    var on = p2pOn();
    $('co-pay').innerHTML =
      opt('pay', 'p2p', t('atl.co.p2p', 'Kartaga o‘tkazma'), t('atl.co.p2pSub', 'LOOM kartasiga, buyurtmadan oldin to‘liq summa'), on, !on, on ? '' : soon) +
      opt('pay', 'payme', 'Payme', '', false, true, soon) +
      opt('pay', 'click', 'Click', '', false, true, soon) +
      opt('pay', 'uzum', 'Uzum Bank', '', false, true, soon);
  }

  /* ── summary + totals (all amounts from the server cart) ──────── */
  function renderSummary() {
    var C = window.LOOM_CART, s = C.state;
    var box = $('co-items');
    box.innerHTML = s.items.map(function (it) {
      var name = C.productName(it) + (it.quantity > 1 ? ' × ' + it.quantity : '');
      return '<div class="atl-row" data-id="' + esc(it.id) + '">' +
          '<span class="atl-cv atl-thumb">' + ic('shirt') + '<img alt="" loading="lazy" decoding="async" style="display:none"></span>' +
          '<span class="atl-row-tx"><b>' + esc(name) + '</b><i class="atl-num">' + esc(som(it.unit_price * it.quantity)) + '</i></span>' +
        '</div>';
    }).join('');
    s.items.forEach(function (it) {
      var img = box.querySelector('[data-id="' + it.id + '"] img');
      if (!img) return;
      img.addEventListener('load', function () { var svg = img.previousElementSibling; if (svg) svg.remove(); }, { once: true });
      C.thumbInto(img, it);
    });
    var delivery = s.delivery || 0;
    var payable = typeof s.payable === 'number' ? s.payable : (s.total || 0) + delivery;
    $('co-sub').textContent = som(s.total || 0);
    $('co-deliv').textContent = som(delivery);
    $('co-total').textContent = som(payable);
    $('co-bar-total').textContent = som(payable);
    $('co-delivery-lg').textContent = t('atl.co.delivery', 'Yetkazib berish · {amount}').replace('{amount}', som(delivery));
    var sr = document.querySelector('[data-co-sr]');
    if (sr) sr.textContent = ' · ' + som(payable);
  }

  /* ── messages ───────────────────────────────────────────────── */
  function banner(msg) {
    var b = $('co-banner');
    if (!msg) { b.hidden = true; b.innerHTML = ''; return; }
    b.innerHTML = ic('alert') + '<span class="atl-banner-tx">' + esc(msg) + '</span>';
    b.hidden = false;
    try { b.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { b.scrollIntoView(); }
  }
  function toastErr(msg) {
    var old = document.getElementById('co-toast');
    if (old) old.remove();
    var el = document.createElement('div');
    el.id = 'co-toast';
    el.className = 'atl-toast atl-toast-err';
    el.setAttribute('role', 'alert');
    el.innerHTML = ic('alert') + '<span>' + esc(msg) + '</span>';
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 4000);
  }
  function fieldErr(id, msg, inputBox) {
    var el = $(id);
    el.hidden = !msg;
    el.innerHTML = msg ? ic('alert') + '<span>' + esc(msg) + '</span>' : '';
    if (inputBox) {
      if (msg) inputBox.setAttribute('aria-invalid', 'true');
      else inputBox.removeAttribute('aria-invalid');
    }
  }
  /* payment closed: say so and keep the money buttons off */
  function paintGate() {
    var open = p2pOn();
    Array.prototype.forEach.call(places(), function (b) { b.disabled = !open || placing; });
    if (!open) banner(methodsFailed ? t('atl.co.noServer', 'Server bilan aloqa yo‘q. Qayta urinib ko‘ring.') : t('atl.co.p2pOff', 'To‘lov vaqtincha ishlamayapti. Bir necha daqiqadan keyin sahifani yangilang.'));
  }

  function validate() {
    var ok = true;
    var name = $('co-name').value.trim();
    fieldErr('co-name-err', name.length >= 2 ? null : t('co.needName', 'Ismingizni kiriting'), $('co-name'));
    if (name.length < 2) ok = false;
    fieldErr('co-phone-err', phoneValid() ? null : t('co.needPhone', 'To‘g‘ri raqam kiriting'), $('co-phone-box'));
    if (!phoneValid()) ok = false;
    var addr = readAddress();
    if (addr) fieldErr('co-addr-err', null);
    else {
      fieldErr('co-addr-err', addressPending()
        ? t('co.addrPending', 'Manzil aniqlanmoqda — bir soniya kuting')
        : manualAddress ? t('atl.co.needAddr', 'Yetkazib berish manzilini kiriting') : t('co.needAddr', 'Xaritada manzilni belgilang'));
      var mi = $('co-address-manual');
      if (mi) mi.setAttribute('aria-invalid', 'true');
      ok = false;
    }
    if (!ok) {
      if (!addr) banner(t('atl.co.notSent', 'Buyurtma yuborilmadi. Yetkazib berish manzilini kiriting.'));
      var first = document.querySelector('#co-form [aria-invalid="true"]');
      if (first) { var f = first.matches('input,textarea') ? first : first.querySelector('input'); if (f) f.focus({ preventScroll: true }); }
    }
    return ok;
  }

  function setSending(on) {
    placing = on;
    Array.prototype.forEach.call(places(), function (b) {
      b.disabled = on || !p2pOn();
      if (on) b.setAttribute('aria-busy', 'true'); else b.removeAttribute('aria-busy');
      var label = b.querySelector('[data-co-label]');
      if (!label) return;
      if (on) {
        label.removeAttribute('data-i18n');
        label.innerHTML = '<span class="atl-spin" aria-hidden="true"></span> ' + esc(t('atl.sending', 'Yuborilmoqda…'));
      } else {
        label.setAttribute('data-i18n', 'atl.co.toPay');
        label.textContent = t('atl.co.toPay', 'To‘lovga o‘tish');
      }
    });
  }

  function sessionId() {
    if (window.LOOM_TRACK && window.LOOM_TRACK.getSessionId) return window.LOOM_TRACK.getSessionId();
    var sid = null;
    try { sid = sessionStorage.getItem('loom_sid'); } catch (_) {}
    if (!sid) {
      sid = 'sid_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
      try { sessionStorage.setItem('loom_sid', sid); } catch (_) {}
    }
    return sid;
  }

  async function place() {
    if (placing) return;             // a double tap sends one order
    banner(null);
    // R2: re-ask the server; a closed card transfer never orders
    if (!p2pOn()) {
      setSending(true);
      await fetchMethods();
      setSending(false);
      renderPay();
      paintGate();
      if (!p2pOn()) return;
    }
    if (!validate()) return;
    setSending(true);
    var leaving = false;
    try {
      var addr = readAddress();
      var details = {
        entrance: $('co-entrance').value.trim() || undefined,
        apartment: $('co-apartment').value.trim() || undefined,
        floor: $('co-floor').value.trim() || undefined,
        intercom: $('co-intercom').value.trim() || undefined,
        note: $('co-courier').value.trim() || undefined,
      };
      Object.keys(details).forEach(function (k) { if (details[k] === undefined) delete details[k]; });
      var payload = {
        customerName: $('co-name').value.trim(),
        customerPhone: '+998' + nine($('co-phone').value),
        address: addr.address,
        addressDetails: Object.keys(details).length ? details : undefined,
        paymentMethod: 'p2p',
        platform: 'web',
      };
      // the plain field has no pin: omit rather than send nulls
      if (typeof addr.lat === 'number' && typeof addr.lng === 'number') {
        payload.addressLat = addr.lat;
        payload.addressLng = addr.lng;
      }
      if (window.LOOM_TRACK) { window.LOOM_TRACK.event('cfg_checkout_submit'); window.LOOM_TRACK.event('cfg_order'); }
      payload.sessionId = sessionId();
      var headers = authHeaders(true);
      headers['Idempotency-Key'] = checkoutKey(payload);
      var res = await fetch(api() + '/api/cart/checkout', {
        method: 'POST', headers: headers, credentials: 'include', body: JSON.stringify(payload),
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) { refused(res.status, data); return; }
      clearCheckoutKey();
      if (!data.id) { banner(t('co.errGeneric', 'Buyurtma yuborilmadi. Qayta urinib ko‘ring.')); return; }
      leaving = true;
      window.LOOM_CART.load();   // the server emptied the cart: refresh the badge
      location.href = 'order.html?id=' + encodeURIComponent(data.id);
    } catch (e) {
      toastErr(t('atl.co.noServer', 'Server bilan aloqa yo‘q. Qayta urinib ko‘ring.'));
    } finally {
      if (!leaving) setSending(false);
    }
  }

  /* every server refusal shows a message the customer can act on */
  function refused(status, data) {
    var code = data && data.code;
    if (code === 'price_changed') {
      window.LOOM_CART.sync(data); renderSummary();
      banner(t('co.priceChanged', 'Narxlar o‘zgardi. Yangi summani tekshirib, buyurtmani qayta tasdiqlang.'));
    } else if (code === 'cart_changed') {
      (Array.isArray(data.items) ? Promise.resolve(window.LOOM_CART.sync(data)) : window.LOOM_CART.load()).then(renderSummary);
      banner(t('co.errGeneric', 'Buyurtma yuborilmadi. Qayta urinib ko‘ring.'));
    } else if (code === 'cart_empty') {
      window.LOOM_CART.load().then(function () { showEmpty(); });
    } else if (code === 'phone_not_verified') {
      show('co-verify', true);
      banner(t('atl.co.verifyBanner', 'Buyurtma uchun raqamni Telegram orqali tasdiqlang.'));
    } else if (code === 'payment_method_unavailable') {
      banner(t('atl.co.methodOff', 'Bu to‘lov usuli hozir ishlamaydi. Sahifani yangilab, qayta urinib ko‘ring.'));
    } else if (code === 'artwork_price_changed') {
      banner(data.artworkTitle
        ? t('artwork_price_changed_title', 'Dizayn narxi o‘zgardi: «{title}». Bu buyumni savatdan olib tashlab, qayta qo‘shing.')
          .replace('{title}', function () { return data.artworkTitle; })
        : t('artwork_price_changed', data.error || ''));
    } else if (status === 401) {
      banner(t('co.sessionLost', 'Sessiya tugadi. Buyurtma berish uchun qayta kiring.'));
      setTimeout(function () { location.href = LOGIN; }, 2500);
    } else if (UNSOLD[code]) {
      banner(t(UNSOLD[code][0], UNSOLD[code][1]));
    } else {
      banner(data && data.error || t('co.errGeneric', 'Buyurtma yuborilmadi. Qayta urinib ko‘ring.'));
    }
  }

  /* ── states ─────────────────────────────────────────────────── */
  function hideAll() { ['co-loading', 'co-error', 'co-empty', 'co-grid', 'co-bar'].forEach(function (id) { show(id, false); }); document.body.classList.remove('atl-abar-on'); }
  function showEmpty() { hideAll(); show('co-empty', true); }
  function fatal() { hideAll(); show('co-error', true); }
  function paintTitle() {
    var h = document.querySelector('.atl-mbar h1');
    if (h) h.textContent = t('atl.co.title', 'Rasmiylashtirish');
    document.title = 'LOOM — ' + t('atl.co.title', 'Rasmiylashtirish');
  }

  async function boot() {
    paintTitle();
    var reload = document.querySelector('[data-co-reload]');
    if (reload) reload.addEventListener('click', function () { location.reload(); });

    // 1. auth gate: login comes back here
    try { user = window.LOOM_AUTH ? await window.LOOM_AUTH.getCurrentUser() : null; } catch (e) { user = null; }
    if (!user) { location.replace(LOGIN); return; }

    // 2. cart + payment methods (cart.js skips its own load on this page)
    await Promise.all([window.LOOM_CART.load(), methodsPromise]);
    if (window.LOOM_CART.state.failed) { fatal(); return; }
    hideAll();
    if (!window.LOOM_CART.state.items.length) { showEmpty(); return; }
    show('co-grid', true);
    show('co-bar', true);
    document.body.classList.add('atl-abar-on');

    // 3. contact
    $('co-name').value = (user.name || [user.first_name, user.last_name].filter(Boolean).join(' ') || '').trim();
    if (user.phone) $('co-phone').value = fmtPhone(user.phone);
    $('co-phone').addEventListener('input', function () { applyPhoneMask(this); paintVerified(); });
    paintVerified();

    // 4. payment, summary, submit: usable before the map arrives
    renderPay();
    renderSummary();
    paintGate();
    wireRadios($('co-pay'), 'pay', function () { /* p2p is the only live method */ });
    $('co-form').addEventListener('submit', function (e) { e.preventDefault(); place(); });
    Array.prototype.forEach.call(places(), function (b) { b.addEventListener('click', place); });
    window.addEventListener('loom:langchange', function () {
      paintTitle(); renderPay(); renderSummary(); renderAddrChoice();
      if (!p2pOn()) paintGate();
    });

    // 5. address: saved address first, the map only when needed
    try {
      preset = user.location_preset;
      if (typeof preset === 'string') preset = JSON.parse(preset);
    } catch (e) { preset = null; }
    if (preset && preset.address) {
      wireRadios($('co-addr-choice'), 'addr', chooseAddr);
      chooseAddr('saved');
    } else {
      await mountMap();
    }
  }

  function start() {
    boot().catch(function (e) {
      try { console.error('[checkout]', e); } catch (_) {}
      fatal();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
