/* ================================================================
   LOOM — Atelye site shell (PRD-216, LOOM-323). Styles: atelye.css.
   Replaces layout.js + nav.js on every Atelye page (the configurator
   keeps the old pair).

   Usage — load after config.js / i18n.js / auth.js / tma.js and before
   page scripts, at the end of <body>:
     <body data-page="catalog" [data-title="Klassik futbolka"]
           [data-back="catalog.html"] [data-no-nav] [data-no-footer]>
       <main id="main"> ... </main>
       <script src="assets/shell.js?v=1"></script>

     data-page      home | catalog | product | cart | checkout | order |
                    login | account | market | designers | designer |
                    lab | help | legal | 404 — marks the active link
     data-title     phone top bar shows Back + this title instead of
                    the logo (sub pages)
     data-title-key i18n key for data-title (re-translated on language
                    change; data-title stays the Uzbek fallback)
     data-back      where Back goes when there is no history
                    (default index.html); also the Telegram BackButton
     data-no-nav    no phone bottom nav (pages with their own action bar)
     data-no-footer no footer

   Draws: skip link, phone top bar, desktop header (logo, Katalog,
   Market, Dizaynerlar, Lab, Yordam, language, theme, cart, profile,
   Dizayn yaratish), phone bottom nav (Asosiy, Katalog, Yaratish,
   Savat, Profil), the footer and an offline strip at the top of
   <main> while the browser reports no connection.

   Cart count: the bottom-nav badge is #cartCount, so cart.js (when the
   page loads it) keeps writing there; the shell mirrors that number
   into the header badge. Without cart.js the shell fetches the count
   once for a logged-in user.

   Telegram Mini App (html.tma, set by tma.js): no bars, no footer.
   The page marks its main CTA with [data-tma-main]; the shell mirrors
   its text and disabled state into Telegram's MainButton, hides the
   page button (html.tma-main) and forwards MainButton clicks to it.
   Sub pages (not home) get Telegram's BackButton.

   window.LOOM_SHELL = { setCount, syncMain }
================================================================ */
'use strict';
(function () {
  var body = document.body;
  if (!body || window.LOOM_SHELL) return;

  var root = document.documentElement;
  var page = body.getAttribute('data-page') || '';
  var title = body.getAttribute('data-title') || '';
  var titleKey = body.getAttribute('data-title-key') || '';
  var backHref = body.getAttribute('data-back') || 'index.html';
  var isTma = root.classList.contains('tma');

  /* ── helpers ─────────────────────────────────────────────────── */
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
  /* text with its i18n key, so i18n.js re-translates on language change */
  function tx(key, fallback) {
    return '<span data-i18n="' + key + '">' + esc(t(key, fallback)) + '</span>';
  }
  function lbl(key, fallback) {
    return 'aria-label="' + esc(t(key, fallback)) + '" data-i18n-attr="aria-label:' + key + '"';
  }
  var P = {
    back: 'M15 5l-7 7 7 7',
    home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    plus: 'M12 5v14M5 12h14',
    bag: 'M5 8h14l-1 12H6zM9 8V7a3 3 0 016 0v1',
    user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
    help: 'M12 3a9 9 0 100 18 9 9 0 000-18zM9.5 9.5a2.5 2.5 0 015 0c0 2-2.5 2-2.5 4M12 17h.01',
    search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
    sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
    moon: 'M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z'
  };
  function ic(n) {
    return '<svg class="atl-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="' + P[n] + '"/></svg>';
  }
  function token() {
    try { return window.LOOM_AUTH && window.LOOM_AUTH.getToken && window.LOOM_AUTH.getToken(); }
    catch (e) { return null; }
  }
  /* Telegram/phone logins hold a cookie, not a token; auth.js caches
     their /me in sessionStorage. Either one means "maybe signed in". */
  function signedIn() {
    if (token()) return true;
    try { return !!sessionStorage.getItem('loom_user'); } catch (e) { return false; }
  }
  function api() {
    if (window.LOOM_CONFIG && window.LOOM_CONFIG.API_BASE) return window.LOOM_CONFIG.API_BASE;
    return location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? 'http://localhost:8787' : 'https://api.loomdesign.uz';
  }
  function cur(on) { return on ? ' aria-current="page"' : ''; }

  var ACTIVE = { product: 'catalog', designer: 'designers', checkout: 'cart', order: 'account', login: 'account' };
  var active = ACTIVE[page] || page;
  /* account.html shows its own signed-out screen, so the link never
     depends on how (or whether) the visitor is signed in. */
  var profileHref = 'account.html';
  var wm = 'LOOM<i></i>';

  /* ── language picker (header + footer) ───────────────────────── */
  var LANG_NAMES = { uz: 'O‘zbekcha', ru: 'Русский', en: 'English' };
  function langSelect(id) {
    var I = window.LOOM_I18N;
    var langs = (I && I.LANGS) || ['uz', 'ru', 'en'];
    var now = I ? I.getLang() : 'uz';
    return '<select class="atl-lang" id="' + id + '" ' + lbl('atl.nav.language', 'Til') + '>' +
      langs.map(function (l) {
        return '<option value="' + l + '"' + (l === now ? ' selected' : '') + '>' + esc(LANG_NAMES[l] || l) + '</option>';
      }).join('') + '</select>';
  }

  /* ── markup ──────────────────────────────────────────────────── */
  var skip = '<a class="atl-skip" href="#main">' + tx('atl.nav.skipToMain', 'Asosiy qismga o‘tish') + '</a>';

  var mbar = title
    ? '<div class="atl-mbar atl-mbar-sub">' +
        '<a class="atl-ib" href="' + esc(backHref) + '" data-atl-back ' + lbl('atl.nav.back', 'Orqaga') + '>' + ic('back') + '</a>' +
        (titleKey ? '<h1>' + tx(titleKey, title) + '</h1>' : '<h1>' + esc(title) + '</h1>') +
      '</div>'
    : '<div class="atl-mbar">' +
        '<a class="atl-wm" href="index.html" ' + lbl('atl.nav.homeAria', 'LOOM bosh sahifa') + '>' + wm + '</a>' +
        '<span class="atl-mbar-sp"></span>' +
        '<a class="atl-ib" href="help.html" ' + lbl('atl.nav.help', 'Yordam') + '>' + ic('help') + '</a>' +
        '<a class="atl-ib" href="catalog.html" ' + lbl('atl.nav.search', 'Qidirish') + '>' + ic('search') + '</a>' +
      '</div>';

  var HDR = [
    ['catalog', 'catalog.html', 'atl.nav.catalog', 'Katalog', ''],
    ['market', 'market.html', 'atl.nav.market', 'Market', ''],
    ['designers', 'designers.html', 'atl.nav.designers', 'Dizaynerlar', ''],
    ['lab', 'lab.html', 'atl.nav.lab', 'LOOM Lab', ' class="atl-hdr-wide"'],
    ['help', 'help.html', 'atl.nav.help', 'Yordam', '']
  ];
  var hdr =
    '<header class="atl-hdr">' +
      '<a class="atl-wm" href="index.html" ' + lbl('atl.nav.homeAria', 'LOOM bosh sahifa') + '>' + wm + '</a>' +
      '<nav ' + lbl('atl.nav.main', 'Asosiy') + '>' +
        HDR.map(function (h) {
          return '<a href="' + h[1] + '"' + h[4] + cur(active === h[0]) + '>' + tx(h[2], h[3]) + '</a>';
        }).join('') +
      '</nav>' +
      '<div class="atl-hdr-r">' +
        langSelect('atl-lang-hdr') +
        '<button type="button" class="atl-ib" data-atl-theme></button>' +
        '<a class="atl-ib" href="cart.html" data-atl-cart-link ' + lbl('atl.nav.cart', 'Savat') + '>' + ic('bag') +
          '<span class="atl-bdg" data-atl-cart hidden>0</span></a>' +
        '<a class="atl-ib" href="' + profileHref + '"' + cur(active === 'account') + ' ' + lbl('atl.nav.profile', 'Profil') + '>' + ic('user') + '</a>' +
        '<a class="atl-btn atl-btn-p" href="configurator.html">' + tx('atl.nav.create', 'Dizayn yaratish') + '</a>' +
      '</div>' +
    '</header>';

  var BN = [
    ['home', 'index.html', 'home', 'atl.nav.tabHome', 'Asosiy'],
    ['catalog', 'catalog.html', 'grid', 'atl.nav.catalog', 'Katalog'],
    ['configurator', 'configurator.html', 'plus', 'atl.nav.tabCreate', 'Yaratish'],
    ['cart', 'cart.html', 'bag', 'atl.nav.cart', 'Savat'],
    ['account', profileHref, 'user', 'atl.nav.profile', 'Profil']
  ];
  var bnav =
    '<nav class="atl-bnav" ' + lbl('atl.nav.main', 'Asosiy') + '>' +
      BN.map(function (b) {
        var icon = b[0] === 'configurator' ? '<span class="atl-bnav-mk">' + ic(b[2]) + '</span>' : ic(b[2]);
        var badge = b[0] === 'cart' ? '<span class="atl-bdg" id="cartCount" data-atl-cart hidden>0</span>' : '';
        return '<a href="' + esc(b[1]) + '"' + cur(active === b[0]) + (b[0] === 'cart' ? ' data-atl-cart-link' : '') + '>' +
          icon + badge + '<span class="atl-bnav-t" data-i18n="' + b[3] + '">' + esc(t(b[3], b[4])) + '</span></a>';
      }).join('') +
    '</nav>';

  var foot =
    '<footer class="atl-foot">' +
      '<nav ' + lbl('atl.foot.aria', 'Pastki') + '>' +
        '<a href="help.html">' + tx('atl.nav.help', 'Yordam') + '</a>' +
        '<a href="privacy.html">' + tx('atl.foot.legal', 'Maxfiylik va shartlar') + '</a>' +
        '<a href="designers.html">' + tx('atl.foot.becomeDesigner', 'Dizayner bo‘lish') + '</a>' +
        '<a href="lab.html">' + tx('atl.nav.lab', 'LOOM Lab') + '</a>' +
        langSelect('atl-lang-foot') +
      '</nav>' +
      '<p class="atl-foot-meta">' + tx('atl.foot.address', 'Toshkent, O‘zbekiston') +
        ' · <a href="https://t.me/looom_design_bot" rel="noopener">' + tx('atl.foot.contact', 'Telegram: @looom_design_bot') + '</a>' +
        ' · © 2026 LOOM</p>' +
    '</footer>';

  /* ── inject ──────────────────────────────────────────────────── */
  var main = document.querySelector('main');
  if (main) {
    if (!main.id) main.id = 'main';
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  }
  var top = document.createElement('div');
  top.innerHTML = skip + mbar + hdr;
  var end = document.createElement('div');
  end.innerHTML = (body.hasAttribute('data-no-footer') ? '' : foot) +
                  (body.hasAttribute('data-no-nav') ? '' : bnav);
  if (main && main.id !== 'main') top.querySelector('.atl-skip').setAttribute('href', '#' + main.id);
  while (top.lastChild) body.insertBefore(top.lastChild, body.firstChild);
  while (end.firstChild) body.appendChild(end.firstChild);
  if (!body.hasAttribute('data-no-nav')) body.classList.add('atl-has-bnav');

  /* ── back: history first, data-back when the page was opened directly ── */
  function goBack() {
    var ref = document.referrer;
    if (history.length > 1 && ref && ref.indexOf(location.origin) === 0) history.back();
    else location.href = backHref;
  }
  var backLink = body.querySelector('[data-atl-back]');
  if (backLink) backLink.addEventListener('click', function (e) { e.preventDefault(); goBack(); });

  /* ── language ────────────────────────────────────────────────── */
  Array.prototype.forEach.call(body.querySelectorAll('.atl-lang'), function (sel) {
    sel.addEventListener('change', function () {
      if (window.LOOM_I18N) window.LOOM_I18N.setLang(sel.value);
    });
  });
  window.addEventListener('loom:langchange', function (e) {
    var l = e && e.detail && e.detail.lang;
    Array.prototype.forEach.call(body.querySelectorAll('.atl-lang'), function (sel) { if (l) sel.value = l; });
    paintTheme();
    setCount(count);
  });

  /* ── theme: the button sets the opposite theme (boot.js handles
        [data-theme-set] clicks) ─────────────────────────────────── */
  var themeBtn = body.querySelector('[data-atl-theme]');
  function paintTheme() {
    if (!themeBtn) return;
    var dark = root.getAttribute('data-theme') === 'dark';
    themeBtn.setAttribute('data-theme-set', dark ? 'light' : 'dark');
    themeBtn.setAttribute('aria-label', t('atl.nav.theme', 'Mavzu') + ': ' + (dark ? t('atl.theme.light', 'Yorug‘') : t('atl.theme.dark', 'Qorong‘i')));
    themeBtn.innerHTML = ic(dark ? 'sun' : 'moon');
  }
  paintTheme();
  window.addEventListener('loom:themechange', paintTheme);

  /* ── cart count ──────────────────────────────────────────────── */
  var count = 0;
  function setCount(n) {
    count = Math.max(0, parseInt(n, 10) || 0);
    Array.prototype.forEach.call(body.querySelectorAll('[data-atl-cart]'), function (b) {
      if (b.textContent !== String(count)) b.textContent = String(count);
      b.hidden = count <= 0;
    });
    var label = count > 0 ? t('atl.nav.cartCount', 'Savat, {n} ta').replace('{n}', count) : t('atl.nav.cart', 'Savat');
    Array.prototype.forEach.call(body.querySelectorAll('[data-atl-cart-link]'), function (a) {
      a.setAttribute('aria-label', label);
    });
  }
  var nb = document.getElementById('cartCount');
  if (nb && window.MutationObserver) {
    new MutationObserver(function () {
      var n = parseInt(nb.textContent, 10) || 0;
      if (n !== count) setCount(n);
    }).observe(nb, { childList: true, characterData: true, subtree: true });
  }
  function fetchCount() {
    if (window.LOOM_CART || !signedIn()) return;
    var h = token() ? { Authorization: 'Bearer ' + token() } : {};
    fetch(api() + '/api/cart', { headers: h, credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !Array.isArray(j.items)) return;
        setCount(j.items.reduce(function (s, i) { return s + (i.quantity || 1); }, 0));
      })
      .catch(function () { /* offline: no badge */ });
  }
  /* cart.js boots on DOMContentLoaded; decide after it had its chance */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fetchCount);
  else fetchCount();

  /* ── offline strip ───────────────────────────────────────────── */
  var off = null;
  function offline() {
    var gone = navigator.onLine === false;
    if (gone && !off && main) {
      off = document.createElement('p');
      off.className = 'atl-banner';
      off.setAttribute('role', 'status');
      off.innerHTML = '<svg class="atl-ic atl-ic-s" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 9a15 15 0 0120 0M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0M12 19.5h.01M3 3l18 18"/></svg>' +
        '<span class="atl-banner-tx" data-i18n="atl.state.offline">' + esc(t('atl.state.offline', 'Internet yo‘q.')) + '</span>';
      main.insertBefore(off, main.firstChild);
    } else if (!gone && off) {
      off.remove();
      off = null;
    }
  }
  window.addEventListener('online', offline);
  window.addEventListener('offline', offline);
  offline();

  /* ── Telegram Mini App: MainButton + BackButton ──────────────── */
  var W = null;
  var queued = false;
  function syncMain() {
    queued = false;
    if (!W || !W.MainButton) return;
    var src = document.querySelector('[data-tma-main]');
    if (!src) {
      root.classList.remove('tma-main');
      W.MainButton.hide();
      return;
    }
    root.classList.add('tma-main');
    var off = src.disabled || src.getAttribute('aria-disabled') === 'true';
    W.MainButton.setParams({
      text: (src.textContent || '').replace(/\s+/g, ' ').trim(),
      color: '#d93529', text_color: '#ffffff',
      is_active: !off, is_visible: true
    });
  }
  function queueMain() {
    if (queued) return;
    queued = true;
    (window.requestAnimationFrame || setTimeout)(syncMain);
  }
  function tmaInit() {
    var T = window.Telegram && window.Telegram.WebApp;
    if (!T || W) return;
    W = T;
    if (W.MainButton) {
      W.MainButton.onClick(function () {
        var src = document.querySelector('[data-tma-main]');
        if (src && !src.disabled && src.getAttribute('aria-disabled') !== 'true') src.click();
      });
      if (window.MutationObserver) {
        new MutationObserver(queueMain).observe(body, {
          subtree: true, childList: true, characterData: true,
          attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'data-tma-main', 'hidden']
        });
      }
      syncMain();
    }
    if (W.BackButton && page !== 'home') {
      W.BackButton.onClick(goBack);
      W.BackButton.show();
    }
  }
  if (isTma) {
    tmaInit();
    window.addEventListener('loom:tma-ready', tmaInit);
  }

  if (window.LOOM_I18N && window.LOOM_I18N.applyTo) {
    try { window.LOOM_I18N.applyTo(document); } catch (e) { /* strings stay Uzbek */ }
  }

  window.LOOM_SHELL = { setCount: setCount, syncMain: queueMain };
})();
