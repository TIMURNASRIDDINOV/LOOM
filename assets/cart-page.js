/* ================================================================
   LOOM — cart page (cart.html, the Savat tab). PRD-216, LOOM-323.

   Data and API calls come from assets/cart.js (window.LOOM_CART);
   this file only draws the page. Lines: garment thumb, name, design
   summary, price, quantity, edit (configurator.html?item=ID), remove.
   Totals: items, delivery and the payable total from the server cart.
   Phone: an action bar with the total replaces the bottom nav while
   the cart has items. Telegram: the visible CTA is the MainButton.
   No login needed to look: without a session the cart is empty, and
   login is asked at checkout.
================================================================ */
'use strict';
(function () {
  var C = window.LOOM_CART;
  if (!C) return;

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
  function $(id) { return document.getElementById(id); }
  var P = {
    shirt: 'M8 4l-5 3 2 4 2-1v10h10V10l2 1 2-4-5-3a4 4 0 01-8 0z',
    edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  };
  function ic(n) { return '<svg class="atl-ic atl-ic-s" viewBox="0 0 24 24" aria-hidden="true"><path d="' + P[n] + '"/></svg>'; }
  function hasDesign(item) {
    try { return !JSON.parse(item.design_json || '{}').plain; } catch (e) { return true; }
  }
  function count(s) { return s.items.reduce(function (n, i) { return n + (i.quantity || 1); }, 0); }

  function line(it) {
    var meta = C.summarize(it.design_json).join(' · ');
    var edit = hasDesign(it)
      ? '<a class="atl-ib" href="configurator.html?item=' + encodeURIComponent(it.id) + '" aria-label="' + esc(t('atl.cart.edit', 'O‘zgartirish')) + '">' + ic('edit') + '</a>'
      : '';
    return '<div class="atl-row atl-cart-row" data-id="' + esc(it.id) + '">' +
        '<span class="atl-cv atl-thumb">' + ic('shirt') + '<img alt="" loading="lazy" decoding="async" style="display:none"></span>' +
        '<span class="atl-row-tx">' +
          '<b>' + esc(C.productName(it)) + '</b>' +
          (meta ? '<i>' + esc(meta) + '</i>' : '') +
          (it.unavailable ? '<span class="atl-warn">' + esc(t('cfg.productUnavailable', 'Bu mahsulot hozir mavjud emas')) + '</span>' : '') +
          '<b class="atl-num" data-price></b>' +
          '<span class="atl-cart-ctl">' +
            '<span class="atl-qty" role="group">' +
              '<button type="button" data-act="dec" aria-label="' + esc(t('atl.cart.dec', 'Kamaytirish')) + '">−</button>' +
              '<output aria-live="polite" data-qty></output>' +
              '<button type="button" data-act="inc" aria-label="' + esc(t('atl.cart.inc', 'Ko‘paytirish')) + '">+</button>' +
            '</span>' +
            edit +
            '<button type="button" class="atl-ib" data-act="del" aria-label="' + esc(t('atl.cart.remove', 'O‘chirish')) + '">' + ic('trash') + '</button>' +
          '</span>' +
        '</span>' +
      '</div>';
  }

  var drawnIds = null, drawnLang = null;
  function render() {
    var s = C.state;
    var items = s.items || [];
    $('cp-loading').hidden = true;
    $('cp-error').hidden = !s.failed;
    $('cp-empty').hidden = !!s.failed || items.length > 0;
    $('cp-filled').hidden = !items.length;
    $('cp-bar').hidden = !items.length;
    document.body.classList.toggle('atl-abar-on', items.length > 0);
    // Telegram MainButton follows the visible main action
    $('cp-cta').toggleAttribute('data-tma-main', items.length > 0);
    $('cp-empty-cta').toggleAttribute('data-tma-main', !items.length && !s.failed);

    var n = count(s);
    var h = document.querySelector('.atl-mbar h1');
    var title = n ? t('atl.cart.titleN', 'Savat · {n}').replace('{n}', n) : t('atl.cart.title', 'Savat');
    if (h) h.textContent = title;
    var h1 = $('cp-h1');
    if (h1) { h1.removeAttribute('data-i18n'); h1.textContent = title; }
    document.title = 'LOOM — ' + t('atl.cart.title', 'Savat');
    if (!items.length) { drawnIds = null; return; }

    // Rebuild the list only when the lines change; quantity updates patch
    // in place so focus stays on the +/− button.
    var lang = window.LOOM_I18N && window.LOOM_I18N.getLang ? window.LOOM_I18N.getLang() : '';
    var ids = items.map(function (i) { return i.id; }).join(',');
    var box = $('cp-items');
    if (ids !== drawnIds || lang !== drawnLang) {
      box.innerHTML = items.map(line).join('');
      items.forEach(function (it) {
        var img = box.querySelector('[data-id="' + it.id + '"] img');
        if (!img) return;
        img.addEventListener('load', function () { var svg = img.previousElementSibling; if (svg) svg.remove(); }, { once: true });
        C.thumbInto(img, it);
      });
      drawnIds = ids; drawnLang = lang;
    }
    items.forEach(function (it) {
      var row = box.querySelector('[data-id="' + it.id + '"]');
      if (!row) return;
      row.querySelector('[data-qty]').textContent = it.quantity;
      row.querySelector('[data-price]').textContent = som(it.unit_price * it.quantity);
      row.querySelector('[data-act="dec"]').disabled = it.quantity <= 1;
      row.querySelector('[data-act="inc"]').disabled = it.quantity >= 99;
    });
    var delivery = s.delivery || 0;
    var payable = typeof s.payable === 'number' ? s.payable : (s.total || 0) + delivery;
    $('cp-sub').textContent = som(s.total || 0);
    $('cp-deliv').textContent = som(delivery);
    $('cp-total').textContent = som(payable);
    $('cp-bar-total').textContent = som(payable);
    var sr = document.querySelector('[data-cp-sr]');
    if (sr) sr.textContent = ' · ' + som(payable);
  }

  function boot() {
    $('cp-items').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]');
      if (!b || b.disabled) return;
      var id = b.closest('[data-id]').getAttribute('data-id');
      var it = C.state.items.find(function (i) { return String(i.id) === id; });
      if (!it) return;
      var act = b.getAttribute('data-act');
      if (act === 'del') {
        b.disabled = true;
        C.remove(it.id).then(function () {
          // the line is gone: keep keyboard focus on the page, not on <body>
          var next = document.querySelector('#cp-items button[data-act="del"]') || $('cp-empty-cta');
          if (next && next.offsetParent) next.focus();
        });
      } else {
        C.setQty(it.id, it.quantity + (act === 'inc' ? 1 : -1));
      }
    });
    var reload = document.querySelector('[data-cp-reload]');
    if (reload) reload.addEventListener('click', function () { location.reload(); });
    window.addEventListener('loom:cart', render);
    window.addEventListener('loom:langchange', function () { drawnLang = null; render(); });
    C.load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
