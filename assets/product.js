/* ================================================================
   LOOM — product page (product.html?slug=…, Atelye skin, LOOM-323).

   GET /api/products/:slug → name, price, colour swatches, sizes (none
   pre-selected: Tim's rule), the garment on the grid canvas tinted to
   the chosen colour, and the buy actions:
     custom       Dizayn qo‘shish → configurator.html?slug=…
                  Printsiz savatga → POST /api/cart (plain garment)
     blank/ready  Savatga qo‘shish → POST /api/cart
   A cart action without a size outlines the sizes and says so.
   Phone: garment on top, fixed action bar. Desktop: panel left.
   Telegram: the panel's main CTA carries data-tma-main (shell.js puts
   it on the MainButton); the bar hides its own copy.
   Unknown slug → the 404 block. Markup is atl-* plus pd-* (page CSS).
================================================================ */
'use strict';
(function () {
  var root = document.getElementById('pd-root');
  if (!root) return;
  var body = document.body;

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
  function token() {
    try { return window.LOOM_AUTH && window.LOOM_AUTH.getToken && window.LOOM_AUTH.getToken(); }
    catch (e) { return null; }
  }
  function lang() {
    try { return window.LOOM_I18N.getLang(); } catch (e) { return 'uz'; }
  }
  function price(n) {
    var I = window.LOOM_I18N;
    return I && I.formatPrice ? I.formatPrice(n) : Number(n).toLocaleString('ru-RU') + ' so‘m';
  }
  var P = {
    bag: 'M5 8h14l-1 12H6zM9 8V7a3 3 0 016 0v1',
    ruler: 'M3 16l13-13 5 5L8 21zM7 12l2 2M10 9l2 2M13 6l2 2',
    alert: 'M12 3l10 18H2zM12 10v4M12 17.5h.01',
    truck: 'M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z',
    card: 'M3 6h18v12H3zM3 10h18M7 15h4',
    shirt: 'M8 4l-5 3 2 4 3-1v10h8V10l3 1 2-4-5-3a4 4 0 01-8 0z'
  };
  function ic(n, s) {
    return '<svg class="atl-ic' + (s ? ' atl-ic-s' : '') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + P[n] + '"/></svg>';
  }

  /* Phone top bar: product name instead of the placeholder, plus the
     cart (no bottom nav on this page). Added before DOMContentLoaded so
     the shell's count fetch fills the badge. */
  var barTitle = document.querySelector('.atl-mbar h1');
  if (barTitle) barTitle.textContent = t('atl.nav.catalog', 'Katalog');
  var mbar = document.querySelector('.atl-mbar-sub');
  if (mbar) {
    var cl = document.createElement('a');
    cl.className = 'atl-ib';
    cl.href = 'cart.html';
    cl.setAttribute('data-atl-cart-link', '');
    cl.setAttribute('aria-label', t('atl.nav.cart', 'Savat'));
    cl.innerHTML = ic('bag') + '<span class="atl-bdg" data-atl-cart hidden>0</span>';
    mbar.appendChild(cl);
  }

  var slug = new URLSearchParams(location.search).get('slug') || '';
  var S = { p: null, state: 'loading', color: 0, size: '', need: false, busy: false };

  function colorsOf(p) {
    var c = p.config && Array.isArray(p.config.colors) ? p.config.colors : [];
    return c.filter(function (x) { return x && x.available !== false && /^#[0-9a-f]{6}$/i.test(x.hex || ''); });
  }
  function sizesOf(p) {
    var s = p.config && Array.isArray(p.config.sizes) ? p.config.sizes : [];
    return s.length ? s.map(String) : ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  }
  function colorName(c) {
    var l = lang();
    return c['name_' + l] || c.name_ru || c.name_en || c.hex;
  }
  function nameOf(p) {
    var I = window.LOOM_I18N;
    return (I && I.productName ? I.productName(p) : p.name_ru) || p.slug || '';
  }
  function safePath(s) { return s && /^[\w\/.-]+$/.test(s) ? s : ''; }

  /* Photoreal transparent pictures, by slug (LOOM-343). A garment without
     one still tints the configurator's flat art: add its picture here when
     it exists. */
  var PHOTO = { 'tshirt-regular': 'images/home/hero-tee-v1.webp' };

  /* The garment: a transparent picture tinted to the colour, else the
     catalogue photo. */
  function garment(p, col) {
    var fa = p.config && p.config.flat_art && p.config.flat_art.front;
    var art = PHOTO[p.slug] || safePath(fa && (fa.src || fa.src_small));
    var alt = esc(nameOf(p) + (col ? ', ' + colorName(col) : ''));
    if (art) {
      var u = 'url(' + art + ')';
      return '<span class="pd-g is-tint">' +
        '<span class="pd-tint" style="background:' + (col ? col.hex : '#ffffff') + ';-webkit-mask-image:' + u + ';mask-image:' + u + '"></span>' +
        '<img src="' + esc(art) + '" alt="' + alt + '"></span>';
    }
    var ph = /^https:\/\//.test(p.thumbnail_url || '') ? p.thumbnail_url : '';
    return ph ? '<span class="pd-g"><img src="' + esc(ph) + '" alt="' + alt + '"></span>' : '';
  }

  function row(icon, b, s) {
    return '<div class="atl-row"><span class="atl-row-ico">' + ic(icon, 1) + '</span>' +
      '<span class="atl-row-tx"><b>' + esc(b) + '</b><i>' + esc(s) + '</i></span></div>';
  }

  function render() {
    root.removeAttribute('aria-busy');
    var bar = document.getElementById('pd-bar');
    if (S.state !== 'ok') {
      if (bar) bar.remove();
      body.classList.remove('atl-abar-on');
      root.innerHTML = S.state === 'missing'
        ? '<div class="atl-empty atl-center">' +
            '<span class="atl-cv"><span class="pd-404">404</span></span>' +
            '<h1 class="atl-t2">' + esc(t('atl.nf.title', 'Sahifa so‘kilib ketdi.')) + '</h1>' +
            '<p class="atl-lead">' + esc(t('atl.nf.lead', 'Bunday sahifa yo‘q — u olib tashlangan bo‘lishi yoki havolada xato bo‘lishi mumkin. Konstruktor esa joyida.')) + '</p>' +
            '<div class="atl-btns pd-nf-btns">' +
              '<a class="atl-btn atl-btn-p" href="configurator.html" data-tma-main>' + esc(t('atl.nav.create', 'Dizayn yaratish')) + '</a>' +
              '<a class="atl-btn" href="catalog.html">' + esc(t('atl.nav.catalog', 'Katalog')) + '</a>' +
              '<a class="atl-btn" href="index.html">' + esc(t('atl.nav.home', 'Bosh sahifa')) + '</a>' +
            '</div></div>'
        : '<div class="atl-empty">' +
            '<h1 class="atl-t2">' + esc(t('atl.state.errT', 'Nimadir noto‘g‘ri ketdi')) + '</h1>' +
            '<p class="atl-lead">' + esc(t('atl.state.errL', 'Sahifani yuklab bo‘lmadi. Internetni tekshirib, yangilang.')) + '</p>' +
            '<div class="atl-btns"><button type="button" class="atl-btn atl-btn-g" data-retry>' + esc(t('atl.reload', 'Yangilash')) + '</button></div></div>';
      return;
    }

    var p = S.p;
    var type = p.product_type || 'custom';
    var custom = type === 'custom';
    var cols = colorsOf(p);
    var col = cols[S.color] || null;
    var nm = nameOf(p);
    var pr = price(p.price);
    var tag = type === 'blank' ? t('atl.blankOnly', 'Faqat printsiz') : type === 'ready' ? t('catalog.readyBadge', 'Tayyor dizayn') : '';
    var cfgHref = 'configurator.html?slug=' + encodeURIComponent(p.slug);
    var addDesign = esc(t('atl.prod.addDesign', 'Dizayn qo‘shish'));
    var blankTo = esc(t('atl.prod.blankToCart', 'Printsiz savatga'));
    var toCart = esc(t('atl.prod.addToCart', 'Savatga qo‘shish'));
    var dis = S.busy ? ' disabled' : '';
    var desc = p['description_' + lang()];

    document.title = nm + ' — LOOM';
    if (barTitle) barTitle.textContent = nm;

    var ctas = custom
      ? '<a class="atl-btn atl-btn-p" href="' + cfgHref + '" data-tma-main>' + addDesign + '</a>' +
        '<button type="button" class="atl-btn" data-add' + dis + '>' + blankTo + '</button>'
      : '<button type="button" class="atl-btn atl-btn-p" data-add data-tma-main' + dis + '>' + toCart + '</button>';

    root.innerHTML =
      '<div class="atl-two atl-two-left">' +
        '<div class="atl-stick pd-info">' +
          '<nav class="atl-only-d pd-crumb"><a href="catalog.html">' + esc(t('atl.nav.catalog', 'Katalog')) + '</a><span aria-hidden="true">/</span><span>' + esc(nm) + '</span></nav>' +
          '<div class="pd-head"><h1 class="atl-t1">' + esc(nm) + '</h1>' +
            '<p class="atl-t2 atl-num">' + esc(pr) + '</p>' +
            (tag ? '<span class="atl-tag">' + esc(tag) + '</span>' : '') + '</div>' +
          (cols.length ? '<div class="atl-grp pd-col-grp"><h2 id="pd-col-h">' + esc(t('atl.prod.color', 'Rang: {color}').replace('{color}', col ? colorName(col) : '')) + '</h2>' +
            '<div class="atl-szs" role="group" aria-labelledby="pd-col-h">' +
              cols.map(function (c, i) {
                return '<button type="button" class="atl-sw" data-col="' + i + '" aria-pressed="' + (i === S.color) + '" aria-label="' + esc(colorName(c)) + '">' +
                  '<i style="background:' + c.hex + '"></i></button>';
              }).join('') + '</div></div>' : '') +
          '<div class="atl-grp' + (S.need ? ' atl-szs-need' : '') + '" id="pd-size-grp">' +
            '<div class="atl-hd"><h2 id="pd-size-h">' + esc(t('atl.prod.size', 'O‘lcham')) + '</h2>' +
              '<button type="button" class="atl-lnk" data-sizes aria-haspopup="dialog">' + ic('ruler', 1) + ' ' + esc(t('atl.prod.sizeTable', 'O‘lchamlar jadvali')) + '</button></div>' +
            '<div class="atl-szs" role="group" aria-labelledby="pd-size-h">' +
              sizesOf(p).map(function (z) {
                return '<button type="button" class="atl-sz" data-size="' + esc(z) + '" aria-pressed="' + (z === S.size) + '">' + esc(z) + '</button>';
              }).join('') + '</div>' +
            (S.need ? '<span class="atl-ferr" role="alert">' + ic('alert', 1) + esc(t('atl.prod.pickSize', 'O‘lchamni tanlang')) + '</span>' : '') +
          '</div>' +
          '<div class="atl-only-d"><div class="atl-btns">' + ctas + '</div></div>' +
          (desc ? '<p class="atl-lead">' + esc(desc) + '</p>' : '') +
          '<div class="atl-lst">' +
            row('truck', t('atl.prod.delivery', 'Yetkazish {amount}').replace('{amount}', price(30000)), t('atl.prod.deliverySub', 'Toshkentda ishlab chiqarishdan keyin 2–4 ish kuni')) +
            row('card', t('atl.prod.prepay', 'Oldindan to‘lov'), t('atl.prod.prepaySub', 'LOOM kartasiga o‘tkazma, chek bilan')) +
            (custom ? row('shirt', t('atl.prod.area', 'Bosma maydoni 30 × 40 sm'), t('atl.prod.areaSub', 'Rangi ekranda bosmadan biroz farq qilishi mumkin')) : '') +
          '</div>' +
        '</div>' +
        '<div class="atl-cv pd-stage">' + garment(p, col) + '</div>' +
      '</div>';

    /* phone action bar */
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'pd-bar';
      bar.className = 'atl-abar atl-abar-fit';
      body.appendChild(bar);
      body.classList.add('atl-abar-on');
    }
    var sizeLine = S.need && !S.size
      ? '<span class="atl-warn">' + esc(t('atl.prod.noSize', 'O‘lcham tanlanmagan')) + '</span>'
      : '<span>' + esc(S.size ? t('atl.prod.sizeIs', 'O‘lcham: {size}').replace('{size}', S.size) : t('atl.prod.sizeNone', 'O‘lcham: —')) + '</span>';
    bar.innerHTML = '<div class="atl-abar-pr"><b>' + esc(pr) + '</b>' + sizeLine + '</div>' +
      (custom
        ? '<button type="button" class="atl-btn" data-add' + dis + '><span class="pd-long">' + blankTo + '</span><span class="pd-short">' + esc(t('atl.prod.blankShort', 'Printsiz')) + '</span></button>' +
          '<a class="atl-btn atl-btn-p pd-main" href="' + cfgHref + '"><span class="pd-long">' + addDesign + '</span><span class="pd-short">' + esc(t('atl.prod.addDesignShort', 'Dizayn')) + '</span></a>'
        : '<button type="button" class="atl-btn atl-btn-p pd-main" data-add' + dis + '>' + toCart + '</button>');
    fitBar();
  }

  /* long labels first; short ones when the price column would overflow */
  function fitBar() {
    var bar = document.getElementById('pd-bar');
    if (!bar) return;
    bar.classList.remove('pd-bar-short');
    var pr = bar.firstChild;
    if (pr && pr.scrollWidth > pr.clientWidth + 1) bar.classList.add('pd-bar-short');
  }
  window.addEventListener('resize', fitBar);

  /* re-render keeps keyboard focus on the same control */
  function update() {
    var a = document.activeElement;
    var key = a && (a.getAttribute('data-size') != null ? '[data-size="' + a.getAttribute('data-size') + '"]'
      : a.getAttribute('data-col') != null ? '[data-col="' + a.getAttribute('data-col') + '"]' : '');
    render();
    if (key) { var el = root.querySelector(key); if (el) el.focus(); }
  }

  function toast(msg, err, link) {
    var old = document.getElementById('pd-toast');
    if (old) old.remove();
    var el = document.createElement('div');
    el.id = 'pd-toast';
    el.className = 'atl-toast' + (err ? ' atl-toast-err' : '');
    el.setAttribute('role', err ? 'alert' : 'status');
    el.textContent = msg;
    if (link) el.insertAdjacentHTML('beforeend', link);
    body.appendChild(el);
    setTimeout(function () { el.remove(); }, link && window.matchMedia('(min-width: 900px)').matches ? 5000 : 2800);
  }

  function toLogin() {
    var here = location.pathname.replace(/^\//, '') + location.search;
    location.href = 'login.html?next=' + encodeURIComponent(here || 'catalog.html');
  }

  function addToCart() {
    var p = S.p;
    if (!S.size) {
      S.need = true;
      render();
      var grp = document.getElementById('pd-size-grp');
      if (grp) {
        grp.scrollIntoView({ block: 'center', behavior: 'smooth' });
        var first = grp.querySelector('[data-size]');
        if (first) first.focus({ preventScroll: true });
      }
      return;
    }
    if (!token()) { toLogin(); return; }
    var col = colorsOf(p)[S.color];
    var design = p.product_type === 'ready'
      ? { ready: true, size: S.size }
      : { plain: true, shirtColor: col ? col.hex : '#FFFFFF', size: S.size };
    S.busy = true;
    update();
    fetch(api() + '/api/cart', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
      body: JSON.stringify({ productId: p.id, designJson: JSON.stringify(design), unitPrice: p.price, quantity: 1 })
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; });
      })
      .then(function (res) {
        if (res.status === 401) { toLogin(); return; }
        if (!res.ok) {
          var k = { product_unavailable: 'cfg.productUnavailable', size_unavailable: 'cfg.sizeUnavailable', color_unavailable: 'cfg.colorUnavailable' }[res.j.code];
          toast((k && t(k, '')) || t('cfg.toastAddError', 'Qo‘shishda xatolik'), true);
          return;
        }
        var items = (res.j && res.j.items) || [];
        // desktop cart drawer (cart.js) shows the server cart just returned
        if (window.LOOM_CART && res.j && Array.isArray(res.j.items)) window.LOOM_CART.sync(res.j);
        if (window.LOOM_SHELL) window.LOOM_SHELL.setCount(items.reduce(function (s, i) { return s + (i.quantity || 1); }, 0));
        if (window.LOOM_TRACK) window.LOOM_TRACK.event('cfg_cart');
        // desktop only: a link that opens the cart drawer (phones keep the plain toast)
        toast(t('cart.added', 'Savatga qo‘shildi') + ' · ' + S.size, false,
          '<a class="atl-only-d pd-toast-lnk" href="cart.html" data-atl-cart-link>' + esc(t('atl.cart.goCart', 'Savatga o‘tish')) + '</a>');
      })
      .catch(function () { toast(t('atl.state.offline', 'Internet yo‘q.'), true); })
      .then(function () { S.busy = false; update(); });
  }

  /* size chart sheet */
  var dim = document.getElementById('pd-dim');
  var sheet = document.getElementById('pd-sizes');
  var opener = null;
  function openSheet(from) {
    opener = from;
    dim.hidden = false;
    sheet.hidden = false;
    sheet.querySelector('[data-close]').focus();
  }
  function closeSheet() {
    if (sheet.hidden) return;
    dim.hidden = true;
    sheet.hidden = true;
    var o = opener && document.contains(opener) ? opener : root.querySelector('[data-sizes]');
    if (o) o.focus();
  }
  dim.addEventListener('click', closeSheet);
  sheet.querySelector('[data-close]').addEventListener('click', closeSheet);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-size],[data-col],[data-add],[data-sizes],[data-retry]');
    if (!el) return;
    if (el.hasAttribute('data-size')) {
      var z = el.getAttribute('data-size');
      S.size = S.size === z ? '' : z;
      if (S.size) S.need = false;
      update();
    } else if (el.hasAttribute('data-col')) {
      S.color = parseInt(el.getAttribute('data-col'), 10) || 0;
      update();
    } else if (el.hasAttribute('data-add')) {
      if (!S.busy) addToCart();
    } else if (el.hasAttribute('data-sizes')) {
      openSheet(el);
    } else if (el.hasAttribute('data-retry')) {
      load();
    }
  });
  window.addEventListener('loom:langchange', function () { if (S.state !== 'loading') update(); });

  function load() {
    if (!/^[\w-]{1,80}$/.test(slug)) { S.state = 'missing'; notFound(); return; }
    S.state = 'loading';
    fetch(api() + '/api/products/' + encodeURIComponent(slug))
      .then(function (r) {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (p) {
        if (!p || !p.active) { S.state = 'missing'; notFound(); return; }
        S.p = p;
        S.state = 'ok';
        render();
      })
      .catch(function () { S.state = 'error'; render(); });
  }
  function notFound() {
    var m = document.createElement('meta');
    m.name = 'robots';
    m.content = 'noindex';
    document.head.appendChild(m);
    render();
  }

  load();
})();
