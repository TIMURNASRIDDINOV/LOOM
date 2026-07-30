/* ================================================================
   LOOM — checkout page logic (checkout.html).

   Flow: fire the network work immediately (payment methods need no
   auth, so it starts before the auth gate resolves) → require auth →
   load cart + user → prefill contact, lazy-load Leaflet and mount the
   shared address picker (saved-address chips from the account preset)
   → validate → POST /api/cart/checkout with the structured payload
   (payment method, lat/lng, details) → success screen, or redirect to
   the provider's payment URL.

   Loading rules that matter here:
   · Leaflet (CSS+JS) is fetched on demand by ensureLeaflet(), NOT as a
     blocking tag. The auth/cart round trips no longer queue behind a
     third-party CDN.
   · If Leaflet never arrives (CDN blocked), the picker degrades to a
     plain address field instead of hard-blocking the order.
   · cart.js skips its own initial load on this page, so /api/cart is
     fetched exactly once.
================================================================ */
'use strict';
(function () {
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
  function fmt(n) { return new Intl.NumberFormat('ru-RU').format(n) + ' ' + t('cfg.currency', 'сум'); }
  function authHeaders(json) {
    var h = json ? { 'Content-Type': 'application/json' } : {};
    var token = window.LOOM_AUTH && window.LOOM_AUTH.getToken && window.LOOM_AUTH.getToken();
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }
  function $(id) { return document.getElementById(id); }
  function show(id, mode) { var el = $(id); if (el) el.style.display = mode || 'block'; }
  function hide(id) { var el = $(id); if (el) el.style.display = 'none'; }

  var picker = null;          // LOOM_ADDRESS instance, or null when degraded
  var manualAddress = false;  // true → plain text field replaced the map
  var payMethod = 'cod';
  var user = null;
  var placing = false;

  /* ── Leaflet on demand ──────────────────────────────────────────
     Both the stylesheet and the script are injected here so a page
     that never mounts a map never pays for them, and so neither can
     delay DOMContentLoaded / the checkout API calls. */
  var LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  var LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  var LEAFLET_JS_SRI = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
  var LEAFLET_CSS_SRI = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
  var leafletPromise = null;
  /* NOT `typeof window.L !== 'undefined'` — the Lenis UMD bundle also
     publishes a global `L`, so on any page carrying smooth scroll that
     test passes while Leaflet is absent, and L.map() then throws. */
  function hasLeaflet() {
    return !!(window.L && typeof window.L.map === 'function' && typeof window.L.tileLayer === 'function');
  }
  function ensureLeaflet() {
    if (hasLeaflet()) return Promise.resolve();
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise(function (resolve, reject) {
      /* Wait for the stylesheet too. A dynamically injected <link> does not
         block anything, so the script can win the race and L.map() would
         then measure a container with none of Leaflet's layout rules
         applied — tiles land in the wrong place. */
      var cssDone = new Promise(function (done) {
        var existing = document.querySelector('link[data-leaflet]');
        if (existing) { existing.sheet ? done() : existing.addEventListener('load', done); return; }
        var css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = LEAFLET_CSS;
        css.integrity = LEAFLET_CSS_SRI;
        css.crossOrigin = '';
        css.setAttribute('data-leaflet', '');
        css.onload = done;
        css.onerror = done;   // unstyled map beats no map at all
        document.head.appendChild(css);
      });
      var s = document.createElement('script');
      s.src = LEAFLET_JS;
      s.integrity = LEAFLET_JS_SRI;
      s.crossOrigin = '';
      s.async = true;
      s.onload = function () { cssDone.then(resolve); };
      s.onerror = function () { reject(new Error('leaflet failed to load')); };
      document.head.appendChild(s);
      // a hung CDN must not strand the customer on a map that never appears
      setTimeout(function () {
        if (!hasLeaflet()) reject(new Error('leaflet timed out'));
      }, 12000);
    });
    return leafletPromise;
  }

  /* Plain-text address fallback — the order must remain placeable
     even when the map CDN is unreachable. */
  function mountManualAddress(host) {
    manualAddress = true;
    host.innerHTML =
      '<div class="co-warn" style="margin:0 0 0.7rem">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--warn)" stroke-width="2" stroke-linecap="round" style="flex-shrink:0;margin-top:1px"><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
        '<span>' + esc(t('co.mapOffline', 'Карта недоступна. Введите адрес вручную — курьер свяжется с вами для уточнения.')) + '</span>' +
      '</div>' +
      '<input class="f-input" id="co-address-manual" autocomplete="street-address" placeholder="' +
        esc(t('co.addrPh', 'Улица, дом, ориентир')) + '">';
  }
  /* One accessor for both modes → validate()/place() stay mode-agnostic. */
  function readAddress() {
    if (manualAddress) {
      var el = $('co-address-manual');
      var v = el ? el.value.trim() : '';
      return v ? { lat: null, lng: null, address: v } : null;
    }
    if (!picker) return null;
    var a = picker.get();
    // settled but still reverse-geocoding → address is not known yet.
    // Submitting here used to save an order with an empty address.
    return a && a.address ? a : null;
  }
  function addressPending() {
    return !manualAddress && !!picker && !!picker.get() && !picker.get().address;
  }

  /* ── phone mask: +998 XX XXX-XX-XX ──────────────────────────── */
  function fmtPhone(digits) {
    var d = digits.replace(/\D/g, '');
    if (d.startsWith('998')) d = d.slice(3);
    d = d.slice(0, 9);
    var out = '+998';
    if (d.length) out += ' ' + d.slice(0, 2);
    if (d.length > 2) out += ' ' + d.slice(2, 5);
    if (d.length > 5) out += '-' + d.slice(5, 7);
    if (d.length > 7) out += '-' + d.slice(7, 9);
    return out;
  }
  /* Reformatting on every keystroke used to shove the caret to the end,
     making mid-number edits impossible. Re-anchor it to the same digit. */
  function applyPhoneMask(el) {
    var before = el.value;
    var caret = el.selectionStart == null ? before.length : el.selectionStart;
    var digitsBefore = before.slice(0, caret).replace(/\D/g, '').length;
    var next = fmtPhone(before);
    if (next === before) return;
    el.value = next;
    var pos = 0, seen = 0;
    while (pos < next.length && seen < digitsBefore) {
      if (/\d/.test(next.charAt(pos))) seen++;
      pos++;
    }
    try { el.setSelectionRange(pos, pos); } catch (e) { /* not a text input */ }
  }
  function phoneDigits() {
    var d = ($('co-phone').value || '').replace(/\D/g, '');
    return d.startsWith('998') ? d : '998' + d;
  }
  function phoneValid() { return /^998\d{9}$/.test(phoneDigits()); }

  /* ── payment tiles ──────────────────────────────────────────── */
  var PAY_LABELS = {
    cod: { name: function () { return t('co.cod', 'При получении'); }, hint: function () { return t('co.codHint', 'Наличными или картой'); } },
    payme: { name: function () { return 'Payme'; }, hint: function () { return ''; } },
    click: { name: function () { return 'Click'; }, hint: function () { return ''; } },
    uzum: { name: function () { return 'Uzum'; }, hint: function () { return ''; } },
  };
  function renderPayTiles(avail) {
    var box = $('co-pay');
    if (!box) return;
    // a method that went unavailable between renders must not stay selected
    if (!avail[payMethod]) payMethod = 'cod';
    box.innerHTML = ['cod', 'payme', 'click', 'uzum'].map(function (m) {
      var on = !!avail[m];
      return (
        '<label class="co-pay-tile' + (m === payMethod ? ' active' : '') + (on ? '' : ' disabled') + '" data-method="' + m + '">' +
          '<input type="radio" name="co-pay" value="' + m + '"' + (on ? '' : ' disabled') + (m === payMethod ? ' checked' : '') + '>' +
          '<span class="co-pay-mark"></span>' +
          '<span style="min-width:0">' +
            '<span class="co-pay-name">' + esc(PAY_LABELS[m].name()) + '</span>' +
            (PAY_LABELS[m].hint() ? '<span class="co-pay-hint">' + esc(PAY_LABELS[m].hint()) + '</span>' : '') +
          '</span>' +
          (on ? '' : '<span class="co-soon">' + esc(t('co.soon', 'Скоро')) + '</span>') +
        '</label>');
    }).join('');
    box.querySelectorAll('.co-pay-tile:not(.disabled)').forEach(function (tile) {
      tile.addEventListener('click', function () {
        payMethod = tile.dataset.method;
        box.querySelectorAll('.co-pay-tile').forEach(function (x) {
          x.classList.toggle('active', x === tile);
        });
      });
    });
  }

  /* ── order summary ──────────────────────────────────────────── */
  function renderSummary() {
    var box = $('co-items');
    if (!box) return;
    var items = window.LOOM_CART.state.items;
    box.innerHTML = items.map(function (it) {
      var meta = window.LOOM_CART.summarize(it.design_json).map(esc).join(' · ');
      return (
        '<div class="co-item" data-id="' + it.id + '">' +
          '<div class="co-item-thumb">' +
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/></svg>' +
            '<img alt="" loading="lazy" decoding="async" style="display:none">' +
          '</div>' +
          '<div class="co-item-info">' +
            '<span class="co-item-name">' + esc(it.product_name || t('cart.item', 'Футболка')) + (it.quantity > 1 ? ' ×' + it.quantity : '') + '</span>' +
            (meta ? '<span class="co-item-meta">' + meta + '</span>' : '') +
          '</div>' +
          '<span class="co-item-price">' + fmt(it.unit_price * it.quantity) + '</span>' +
        '</div>');
    }).join('');
    items.forEach(function (it) {
      var img = box.querySelector('.co-item[data-id="' + it.id + '"] img');
      if (img) window.LOOM_CART.thumbInto(img, it);
    });
    $('co-subtotal').textContent = fmt(window.LOOM_CART.state.total);
    $('co-total').textContent = fmt(window.LOOM_CART.state.total);
  }

  /* ── saved address chips ────────────────────────────────────── */
  function renderSaved() {
    var preset = null;
    try { preset = user && user.location_preset ? JSON.parse(user.location_preset) : null; } catch (e) {}
    if (!preset || !preset.address || manualAddress) return;
    var box = $('co-saved');
    box.style.display = 'flex';
    box.innerHTML =
      '<button type="button" class="co-saved-chip" id="co-saved-chip">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>' +
        '<span>' + esc(t('co.savedAddr', 'Сохранённый адрес')) + ': ' + esc(preset.address) + '</span>' +
      '</button>';
    $('co-saved-chip').addEventListener('click', function () {
      this.classList.add('active');
      if (picker && preset.lat && preset.lng) picker.set(preset.lat, preset.lng, 17);
      else if (picker) {
        // no coords stored — try searching the saved text
        var input = document.querySelector('.addr-search-input');
        if (input) { input.value = preset.address; input.dispatchEvent(new Event('input')); }
      }
    });
  }

  /* ── validation + submit ────────────────────────────────────── */
  function banner(msg, actionHtml) {
    var b = $('co-banner');
    if (!b) return;
    if (!msg) { b.classList.remove('show'); b.innerHTML = ''; return; }
    b.innerHTML = '<span>' + esc(msg) + '</span>' + (actionHtml || '');
    b.classList.add('show');
    b.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  /* phone_not_verified is a hard server gate and the login modal is the
     only place the Telegram link happens — hand the customer that door
     instead of a message they cannot act on. */
  function verifyPhoneBanner(msg) {
    banner(msg, '<button type="button" class="btn btn--solid" id="co-verify-btn" style="margin-top:0.7rem">' +
      esc(t('co.verifyCta', 'Подтвердить через Telegram')) + '</button>');
    var btn = $('co-verify-btn');
    if (!btn) return;
    btn.addEventListener('click', async function () {
      if (!window.LOOM_LOGIN_MODAL) return;
      try {
        var next = await window.LOOM_LOGIN_MODAL.open();
        if (next) {
          user = next;
          if (user.phone_verified) {
            hide('co-phone-warn');
            show('co-phone-badge', 'inline-flex');
            banner(null);
          }
        }
      } catch (e) { /* customer closed the modal */ }
    });
  }
  function validate() {
    var ok = true;
    banner(null);
    var name = $('co-name').value.trim();
    $('co-name-err').textContent = name.length >= 2 ? '' : t('co.needName', 'Укажите имя');
    if (name.length < 2) ok = false;
    $('co-phone-err').textContent = phoneValid() ? '' : t('co.needPhone', 'Укажите корректный номер');
    if (!phoneValid()) ok = false;
    var addr = readAddress();
    if (addr) {
      $('co-addr-err').textContent = '';
    } else {
      /* separate key per mode — t() returns the catalogued string, so a
         mode-dependent *fallback* would never actually surface */
      $('co-addr-err').textContent = addressPending()
        ? t('co.addrPending', 'Определяем адрес — подождите секунду')
        : manualAddress
          ? t('co.needAddrManual', 'Укажите адрес доставки')
          : t('co.needAddr', 'Укажите адрес на карте');
      ok = false;
    }
    return ok;
  }

  async function place() {
    if (placing) return;             // belt-and-braces against a double tap
    if (!validate()) return;
    var btn = $('co-place');
    var label = btn.innerHTML;
    placing = true;
    btn.disabled = true;
    btn.innerHTML =
      '<svg class="spinner" width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity=".25"/><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/></svg>' +
      '<span>' + esc(t('co.placing', 'Оформляем…')) + '</span>';
    var redirecting = false;
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

      var fullName = ($('co-name').value.trim() + ' ' + $('co-surname').value.trim()).trim();
      var payload = {
        customerName: fullName,
        customerPhone: '+' + phoneDigits(),
        address: addr.address,
        addressDetails: Object.keys(details).length ? details : undefined,
        comment: $('co-comment').value.trim() || undefined,
        paymentMethod: payMethod,
      };
      // manual fallback has no pin — omit rather than send nulls the
      // backend would reject as non-numbers
      if (typeof addr.lat === 'number' && typeof addr.lng === 'number') {
        payload.addressLat = addr.lat;
        payload.addressLng = addr.lng;
      }

      var res = await fetch(api() + '/api/cart/checkout', {
        method: 'POST', headers: authHeaders(true), credentials: 'include',
        body: JSON.stringify(payload),
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        if (data.code === 'phone_not_verified') {
          show('co-phone-warn', 'flex');
          verifyPhoneBanner(data.error || t('co.phoneWarn', 'Для заказа подтвердите номер через Telegram'));
        } else if (res.status === 401) {
          banner(t('co.sessionLost', 'Сессия истекла. Войдите заново, чтобы оформить заказ.'));
        } else {
          banner(data.error || t('co.errGeneric', 'Не удалось оформить заказ. Попробуйте ещё раз.'));
        }
        return;
      }
      // paid online → provider page; COD → success screen
      if (data.paymentUrl) { redirecting = true; location.href = data.paymentUrl; return; }
      window.LOOM_CART.load(); // server cleared it — refresh the badge
      hide('co-grid');
      $('co-success-num').textContent = data.id
        ? t('co.successNum', 'Номер заказа') + ' · #' + data.id
        : '';
      show('co-success');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      banner(t('co.errNetwork', 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.'));
    } finally {
      // leave the button spinning while the browser navigates away
      if (!redirecting) {
        placing = false;
        btn.disabled = false;
        btn.innerHTML = label;
      }
    }
  }

  /* ── boot ───────────────────────────────────────────────────── */
  /* Payment methods need no auth, so this round trip runs in parallel
     with (not after) the auth gate. Started at script-execute time. */
  var DEFAULT_METHODS = { cod: true, payme: false, click: false, uzum: false };
  var methodsPromise = fetch(api() + '/api/payments/methods')
    .then(function (r) { return r.ok ? r.json() : DEFAULT_METHODS; })
    .catch(function () { return DEFAULT_METHODS; });

  function fatal(msg) {
    hide('co-loading');
    var el = $('co-error');
    if (!el) return;
    var textEl = $('co-error-text');
    if (textEl && msg) textEl.textContent = msg;
    el.style.display = 'block';
  }

  async function boot() {
    // 1. auth gate
    try {
      user = window.LOOM_LOGIN_MODAL
        ? await window.LOOM_LOGIN_MODAL.requireAuth()
        : (window.LOOM_AUTH ? await window.LOOM_AUTH.getCurrentUser() : null);
    } catch (e) { user = null; }
    if (!user) { location.href = 'index.html'; return; }

    // 2. cart + payment methods (cart.js deliberately skips its own
    //    initial load here, so this is the page's only /api/cart call)
    var results = await Promise.all([window.LOOM_CART.load(), methodsPromise]);
    var methods = results[1] && typeof results[1] === 'object' ? results[1] : DEFAULT_METHODS;

    hide('co-loading');
    if (!window.LOOM_CART.state.items.length) {
      show('co-empty');
      return;
    }
    show('co-grid', 'grid');

    // 3. prefill contact
    // Telegram/Mini App accounts carry first_name/last_name instead of name
    var parts = (user.name || '').split(/\s+/);
    $('co-name').value = parts[0] || user.first_name || '';
    $('co-surname').value = parts.slice(1).join(' ') || user.last_name || '';
    if (user.phone) $('co-phone').value = fmtPhone(user.phone);
    if (user.phone_verified) show('co-phone-badge', 'inline-flex');
    else show('co-phone-warn', 'flex');
    $('co-phone').addEventListener('input', function () { applyPhoneMask(this); });

    // 4. payment + summary + submit — wired BEFORE the map so the form
    //    is usable the moment it appears, even on a slow Leaflet fetch
    renderPayTiles(methods);
    renderSummary();
    window.addEventListener('loom:langchange', function () {
      renderPayTiles(methods);
      renderSummary();
    });
    $('co-place').addEventListener('click', place);

    // 5. address picker (+ saved preset), lazily
    var initial = null;
    try {
      var preset = user.location_preset ? JSON.parse(user.location_preset) : null;
      if (preset && preset.lat && preset.lng) initial = { lat: preset.lat, lng: preset.lng };
    } catch (e) {}
    var host = $('co-address');
    try {
      await ensureLeaflet();
      picker = window.LOOM_ADDRESS ? window.LOOM_ADDRESS.mount(host, { initial: initial }) : null;
      if (!picker) mountManualAddress(host);
    } catch (e) {
      mountManualAddress(host);
    }
    renderSaved();
  }

  function start() {
    boot().catch(function (e) {
      // never leave the customer on a blank page
      try { console.error('[checkout]', e); } catch (_) {}
      fatal(t('co.errBoot', 'Не удалось загрузить оформление заказа. Обновите страницу.'));
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
