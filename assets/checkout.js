/* ================================================================
   LOOM — checkout page logic (checkout.html).

   Flow: require auth → load cart + user + payment methods →
   prefill contact, mount the shared address picker (saved-address
   chips from the account preset) → validate → POST /api/cart/checkout
   with the structured payload (payment method, lat/lng, details) →
   success screen, or redirect to the provider's payment URL.
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

  var picker = null;
  var payMethod = 'cod';
  var user = null;

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
    var items = window.LOOM_CART.state.items;
    box.innerHTML = items.map(function (it) {
      var meta = window.LOOM_CART.summarize(it.design_json).map(esc).join(' · ');
      return (
        '<div class="co-item" data-id="' + it.id + '">' +
          '<div class="co-item-thumb">' +
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/></svg>' +
            '<img alt="" loading="lazy" style="display:none">' +
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
    if (!preset || !preset.address) return;
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
  function banner(msg) {
    var b = $('co-banner');
    if (!msg) { b.classList.remove('show'); return; }
    b.textContent = msg;
    b.classList.add('show');
    b.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function validate() {
    var ok = true;
    banner(null);
    var name = $('co-name').value.trim();
    $('co-name-err').textContent = name.length >= 2 ? '' : t('co.needName', 'Укажите имя');
    if (name.length < 2) ok = false;
    $('co-phone-err').textContent = phoneValid() ? '' : t('co.needPhone', 'Укажите корректный номер');
    if (!phoneValid()) ok = false;
    var addr = picker && picker.get();
    $('co-addr-err').textContent = addr ? '' : t('co.needAddr', 'Укажите адрес на карте');
    if (!addr) ok = false;
    return ok;
  }

  async function place() {
    if (!validate()) return;
    var btn = $('co-place');
    var label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML =
      '<svg class="spinner" width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity=".25"/><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/></svg>' +
      '<span>' + esc(t('co.placing', 'Оформляем…')) + '</span>';
    try {
      var addr = picker.get();
      var details = {
        entrance: $('co-entrance').value.trim() || undefined,
        apartment: $('co-apartment').value.trim() || undefined,
        floor: $('co-floor').value.trim() || undefined,
        intercom: $('co-intercom').value.trim() || undefined,
        note: $('co-courier').value.trim() || undefined,
      };
      Object.keys(details).forEach(function (k) { if (details[k] === undefined) delete details[k]; });

      var fullName = ($('co-name').value.trim() + ' ' + $('co-surname').value.trim()).trim();
      var res = await fetch(api() + '/api/cart/checkout', {
        method: 'POST', headers: authHeaders(true), credentials: 'include',
        body: JSON.stringify({
          customerName: fullName,
          customerPhone: '+' + phoneDigits(),
          address: addr.address,
          addressLat: addr.lat,
          addressLng: addr.lng,
          addressDetails: Object.keys(details).length ? details : undefined,
          comment: $('co-comment').value.trim() || undefined,
          paymentMethod: payMethod,
        }),
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        if (data.code === 'phone_not_verified') {
          $('co-phone-warn').style.display = 'flex';
          banner(data.error || t('co.phoneWarn', 'Для заказа подтвердите номер через Telegram'));
        } else {
          banner(data.error || t('co.errGeneric', 'Не удалось оформить заказ. Попробуйте ещё раз.'));
        }
        return;
      }
      // paid online → provider page; COD → success screen
      if (data.paymentUrl) { location.href = data.paymentUrl; return; }
      window.LOOM_CART.load(); // server cleared it — refresh the badge
      $('co-grid').style.display = 'none';
      $('co-success-num').textContent = t('co.successNum', 'Номер заказа') + ' · #' + data.id;
      $('co-success').style.display = 'block';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      banner(t('co.errGeneric', 'Не удалось оформить заказ. Попробуйте ещё раз.'));
    } finally {
      btn.disabled = false;
      btn.innerHTML = label;
    }
  }

  /* ── boot ───────────────────────────────────────────────────── */
  async function boot() {
    // 1. auth gate
    try {
      user = window.LOOM_LOGIN_MODAL
        ? await window.LOOM_LOGIN_MODAL.requireAuth()
        : (window.LOOM_AUTH ? await window.LOOM_AUTH.getCurrentUser() : null);
    } catch (e) { user = null; }
    if (!user) { location.href = 'index.html'; return; }

    // 2. cart + payment methods in parallel
    var methods = { cod: true, payme: false, click: false, uzum: false };
    var results = await Promise.all([
      window.LOOM_CART.load(),
      fetch(api() + '/api/payments/methods').then(function (r) { return r.ok ? r.json() : methods; }).catch(function () { return methods; }),
    ]);
    methods = results[1];

    if (!window.LOOM_CART.state.items.length) {
      $('co-empty').style.display = 'block';
      return;
    }
    $('co-grid').style.display = 'grid';

    // 3. prefill contact
    var parts = (user.name || '').split(/\s+/);
    $('co-name').value = parts[0] || '';
    $('co-surname').value = parts.slice(1).join(' ');
    if (user.phone) $('co-phone').value = fmtPhone(user.phone);
    if (user.phone_verified) $('co-phone-badge').style.display = 'inline-flex';
    else $('co-phone-warn').style.display = 'flex';
    $('co-phone').addEventListener('input', function () { this.value = fmtPhone(this.value); });

    // 4. address picker (+ saved preset)
    var initial = null;
    try {
      var preset = user.location_preset ? JSON.parse(user.location_preset) : null;
      if (preset && preset.lat && preset.lng) initial = { lat: preset.lat, lng: preset.lng };
    } catch (e) {}
    picker = window.LOOM_ADDRESS.mount('#co-address', { initial: initial });
    renderSaved();

    // 5. payment + summary + submit
    renderPayTiles(methods);
    renderSummary();
    window.addEventListener('loom:langchange', function () {
      renderPayTiles(methods);
      renderSummary();
    });
    $('co-place').addEventListener('click', place);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
