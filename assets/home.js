/* ================================================================
   LOOM — home page (index.html), Atelye (PRD-216, LOOM-323).

   1. Intro loader: wordmark, bar and 000–100 counter, then the red
      curtain wipes into the page. index.html's head script decides
      whether it plays (html.atl-intro); a tap skips it.
   2. First-visit onboarding: three skippable cards, language picked
      on the first. Shown once; a visitor who already chose a language
      is not on a first visit. ?welcome (or ?welcome=2|3) shows it on
      demand. Never inside Telegram (it has its own first-visit flow).
   3. Garments from GET /api/products (skeleton, then cards, or an
      error block with one retry), designer prints from
      GET /api/artworks (section stays hidden when empty or failed).
      The offline strip comes from shell.js.
================================================================ */
'use strict';
(function () {
  var d = document.documentElement;
  var $ = function (id) { return document.getElementById(id); };
  var I = function () { return window.LOOM_I18N; };
  function t(key, fb) {
    try { var s = I() && I().t(key); return s && s !== key ? s : fb; } catch (e) { return fb; }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function api() { return (window.LOOM_CONFIG && window.LOOM_CONFIG.API_BASE) || 'https://api.loomdesign.uz'; }
  function money(n) { return I() ? I().formatPrice(n) : Number(n).toLocaleString('ru-RU') + ' so‘m'; }
  var q = new URLSearchParams(location.search);
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var desk = window.matchMedia && matchMedia('(min-width: 900px)').matches;

  /* ── 1. Intro loader ─────────────────────────────────────────── */
  var afterIntro = [];
  function introDone() { afterIntro.splice(0).forEach(function (f) { f(); }); }

  function intro() {
    var el = $('atl-splash');
    if (!el || !d.classList.contains('atl-intro')) return introDone();
    clearTimeout(window.__atlIntroFailsafe);
    window.scrollTo(0, 0);
    var hold = !!window.__atlIntroHold;
    var coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    /* desktop: the whole intro (count + wipe) stays within 1.2 s */
    var D = reduce ? 0 : desk ? 600 : (coarse ? 1100 : 1600);
    var WIPE = desk ? 480 : 880;
    el.style.setProperty('--atl-intro-d', D + 'ms');
    var n = $('atl-splash-n'), t0 = performance.now(), raf = 0, ended = false;

    (function count(now) {
      var p = Math.min(1, ((now || t0) - t0) / (D || 1));
      n.textContent = String(Math.round(100 * (1 - Math.pow(1 - p, 3)))).padStart(3, '0');
      if (p < 1) raf = requestAnimationFrame(count);
    })();

    function finish() {
      if (ended) return;
      ended = true;
      cancelAnimationFrame(raf);
      n.textContent = '100';
      function off() { d.classList.remove('atl-intro'); introDone(); }
      var cur = el.querySelector('.atl-splash-cur');
      if (reduce || !cur.animate) return off();
      /* the curtain rises over the loader, the loader goes, the curtain lifts off */
      var wipe = cur.animate([
        { transform: 'translateY(100%)' },
        { transform: 'translateY(0)', offset: 0.5 },
        { transform: 'translateY(-100%)' }
      ], { duration: WIPE, easing: 'cubic-bezier(.2, 0, 0, 1)' });
      setTimeout(function () {
        el.style.background = 'none';
        [].forEach.call(el.children, function (c) { if (c !== cur) c.style.visibility = 'hidden'; });
      }, WIPE / 2);
      wipe.onfinish = off;
    }
    el.addEventListener('click', finish);
    if (!hold) setTimeout(finish, desk ? D : D + 120);
  }

  /* ── 2. Onboarding ───────────────────────────────────────────── */
  var ONB_KEY = 'loom_onb';
  var TEE = '<img src="configuratorprodutcs/tshirt_flat_white_600.png" alt="" width="600" height="600">';
  var ART = [
    '<span class="atl-onb-g">' + TEE + '</span>',
    '<span class="atl-onb-g">' + TEE + '<img class="atl-hero-pr" src="images/lab/suzani.png" alt="" width="400" height="400"></span>',
    '<span class="atl-onb-g"><svg viewBox="0 0 300 340" aria-hidden="true"><rect x="40" y="110" width="220" height="150" rx="10" fill="var(--surface)" stroke="var(--ink)" stroke-width="3"/><path d="M40 150h220" stroke="var(--ink)" stroke-width="3"/><circle cx="150" cy="205" r="30" fill="none" stroke="var(--cta)" stroke-width="4"/><path d="M138 205l9 9 16-18" fill="none" stroke="var(--cta)" stroke-width="4"/></svg></span>'
  ];

  function wantsOnboarding() {
    if (d.classList.contains('tma')) return false;
    if (q.has('welcome')) return true;
    try { return !localStorage.getItem(ONB_KEY) && !localStorage.getItem('loom_lang'); }
    catch (e) { return false; }
  }

  function onboarding() {
    var box = $('atl-onb');
    if (!box || !wantsOnboarding()) return;
    var card = Math.min(3, Math.max(1, parseInt(q.get('welcome'), 10) || 1));
    var opener = document.activeElement;

    function close() {
      try { localStorage.setItem(ONB_KEY, '1'); } catch (e) {}
      box.hidden = true;
      d.style.overflow = '';
      d.classList.remove('atl-onb-open');
      setInert(false);
      document.removeEventListener('keydown', onKey);
      if (opener && opener.focus) opener.focus();
    }
    function btn(cls, href, key, fb, attr) {
      return (href ? '<a class="atl-btn ' + cls + '" href="' + href + '"' : '<button type="button" class="atl-btn ' + cls + '"') +
        ' ' + (attr || '') + '>' + esc(t(key, fb)) + (href ? '</a>' : '</button>');
    }
    /* desktop: one dialog, the three cards side by side */
    function renderDesk(focus) {
      box.classList.add('atl-onb-d');
      $('atl-onb-art').hidden = true;
      $('atl-onb-dots').hidden = true;
      $('atl-onb-skip').hidden = true;
      $('atl-onb-l').hidden = true;
      $('atl-onb-h').textContent = t('atl.onb.title', 'LOOM qanday ishlaydi');
      var cur = I() ? I().getLang() : 'ru';
      [].forEach.call($('atl-onb-lang').children, function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === cur));
      });
      var top = box.querySelector('.atl-onb-top');
      if (!top.querySelector('[data-onb-x]')) {
        top.insertAdjacentHTML('beforeend', '<button type="button" class="atl-ib" data-onb-close data-onb-x>' +
          '<svg class="atl-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>');
      }
      top.querySelector('[data-onb-x]').setAttribute('aria-label', t('atl.close', 'Yopish'));
      var cards = $('atl-onb-cards');
      if (!cards) {
        cards = document.createElement('div');
        cards.id = 'atl-onb-cards';
        cards.className = 'atl-onb-cards';
        $('atl-onb-l').parentNode.insertBefore(cards, $('atl-onb-btns'));
      }
      cards.innerHTML = ART.map(function (a, i) {
        return '<div class="atl-onb-card"><span class="atl-cv">' + a + '</span>' +
          '<b class="atl-t3">' + esc(t('atl.onb.t' + (i + 1), '')) + '</b><p>' + esc(t('atl.onb.l' + (i + 1), '')) + '</p></div>';
      }).join('');
      $('atl-onb-btns').innerHTML = btn('', '', 'atl.skip', 'O‘tkazib yuborish', 'data-onb-close') +
        btn('atl-btn-p', 'configurator.html', 'atl.nav.create', 'Dizayn yaratish', 'data-onb-done');
      if (focus) $('atl-onb-h').focus();
    }
    function render(focus) {
      if (desk) return renderDesk(focus);
      $('atl-onb-art').innerHTML = ART[card - 1];
      $('atl-onb-h').textContent = t('atl.onb.t' + card, '');
      $('atl-onb-l').textContent = t('atl.onb.l' + card, '');
      var dots = $('atl-onb-dots');
      dots.setAttribute('aria-label', card + ' / 3');
      [].forEach.call(dots.children, function (i, k) { i.classList.toggle('atl-on', k === card - 1); });
      $('atl-onb-lang').hidden = card !== 1;
      $('atl-onb-skip').hidden = card === 1;
      var cur = I() ? I().getLang() : 'ru';
      [].forEach.call($('atl-onb-lang').children, function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === cur));
      });
      $('atl-onb-btns').innerHTML = card < 3
        ? btn('atl-btn-g', '', 'atl.next', 'Keyingi', 'data-onb-next') +
          (card === 1 ? btn('', '', 'atl.skip', 'O‘tkazib yuborish', 'data-onb-close') : '')
        : btn('atl-btn-p', 'configurator.html', 'atl.nav.create', 'Dizayn yaratish', 'data-onb-done') +
          btn('', 'catalog.html', 'atl.home.toCatalog', 'Katalogni ko‘rish', 'data-onb-done');
      if (focus) $('atl-onb-h').focus();
    }
    /* the page behind the dialog is out of reach for focus and readers */
    function setInert(on) {
      [].forEach.call(document.body.children, function (el) {
        if (el !== box && el.tagName !== 'SCRIPT' && el.id !== 'loom-consent') el.inert = on;
      });
    }
    function onKey(e) {
      if (e.key === 'Escape') return close();
      if (e.key !== 'Tab') return;
      var f = [].filter.call(box.querySelectorAll('a[href],button,[tabindex="0"]'), function (x) { return x.offsetParent; });
      if (!f.length) return;
      if (e.shiftKey && (document.activeElement === f[0] || !box.contains(document.activeElement))) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }

    box.addEventListener('click', function (e) {
      var b = e.target.closest('button,a');
      if (!b) return;
      if (b.hasAttribute('data-lang')) { if (I()) I().setLang(b.getAttribute('data-lang')); return; }
      if (b.hasAttribute('data-onb-next')) { card++; render(true); return; }
      if (b.hasAttribute('data-onb-close')) return close();
      if (b.hasAttribute('data-onb-done')) { try { localStorage.setItem(ONB_KEY, '1'); } catch (x) {} }
    });
    window.addEventListener('loom:langchange', function () { if (!box.hidden) render(false); });
    document.addEventListener('keydown', onKey);
    render(false);
    box.hidden = false;
    d.style.overflow = 'hidden';
    d.classList.add('atl-onb-open');
    setInert(true);
    $('atl-onb-h').focus();
  }
  afterIntro.push(onboarding);
  intro();

  /* ── 3. Content ──────────────────────────────────────────────── */
  var products = null;

  function productName(p) {
    return I() && I().productName ? I().productName(p) : (p.name_ru || p.slug || '');
  }
  function garmentCard(p) {
    var img = p.thumbnail_url
      ? '<img src="' + esc(p.thumbnail_url) + '" alt="" loading="lazy" decoding="async">' : '';
    return '<a class="atl-pc" href="product.html?slug=' + encodeURIComponent(p.slug) + '">' +
      '<span class="atl-cv atl-gtile">' + img + '</span>' +
      '<span class="atl-pc-nm">' + esc(productName(p)) + '</span>' +
      '<span class="atl-pc-pr">' + esc(money(p.price)) + '</span>' +
      (p.product_type === 'blank' ? '<span class="atl-tag">' + esc(t('atl.blankOnly', 'Faqat printsiz')) + '</span>' : '') +
      '</a>';
  }
  function renderGarments() {
    var box = $('home-garments');
    if (!products) return;
    box.removeAttribute('aria-busy');
    box.innerHTML = products.map(garmentCard).join('');
  }
  function loadGarments() {
    var box = $('home-garments');
    fetch(api() + '/api/products').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      /* garments only: ready-made designs live in the catalogue */
      products = (data.products || []).filter(function (p) {
        return p.active !== false && (p.product_type || 'custom') !== 'ready';
      }).slice(0, 6);
      renderGarments();
    }).catch(function () {
      /* the static cards from index.html (LOOM-328) stay as they are */
      if (box.querySelector('a.atl-pc')) return;
      /* the error block replaces the row (a row would squeeze it) */
      box.hidden = true;
      var err = document.createElement('div');
      err.className = 'atl-empty';
      err.setAttribute('role', 'alert');
      err.innerHTML = '<h3 class="atl-t2" data-i18n="atl.state.errT">' + esc(t('atl.state.errT', 'Nimadir noto‘g‘ri ketdi')) + '</h3>' +
        '<p class="atl-lead" data-i18n="atl.state.errL">' + esc(t('atl.state.errL', '')) + '</p>' +
        '<button type="button" class="atl-btn atl-btn-g" data-i18n="atl.reload">' + esc(t('atl.reload', 'Yangilash')) + '</button>';
      err.querySelector('button').addEventListener('click', function () { location.reload(); });
      box.parentNode.appendChild(err);
    });
  }

  function loadWorks() {
    fetch(api() + '/api/artworks?page=1').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      var items = (data.items || []).filter(function (a) { return a.image_url; }).slice(0, 6);
      if (!items.length) return;
      $('home-works-list').innerHTML = items.map(function (a) {
        var author = String(a.author || 'LOOM');
        return '<a class="atl-pc" href="market.html">' +
          '<span class="atl-cv atl-gtile atl-home-work"><img src="' + esc(a.image_url) + '" alt="" loading="lazy" decoding="async"></span>' +
          '<span class="atl-pc-nm">' + esc(a.title) + '</span>' +
          '<span class="atl-sm">' + esc(author.charAt(0) === '@' ? author : '@' + author) + '</span></a>';
      }).join('');
      $('home-works').hidden = false;
    }).catch(function () { /* secondary content: stays hidden */ });
  }

  /* Desktop, signed in: a dark strip under the header while an order
     still waits for its card transfer (links to the payment screen). */
  var unpaid = null;
  function paintStrip() {
    var old = $('home-strip');
    if (old) old.remove();
    if (!unpaid) return;
    var min = Math.ceil((unpaid.pay_deadline - Date.now()) / 60000);
    if (min < 1) return;
    var el = document.createElement('div');
    el.id = 'home-strip';
    el.className = 'atl-home-strip';
    el.setAttribute('role', 'status');
    el.innerHTML = '<svg class="atl-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2"/></svg>' +
      '<span>' + esc(t('atl.home.unpaid', 'Buyurtma {id}: {left}').replace('{id}', '#' + unpaid.id)
        .replace('{left}', t('atl.orders.payWithin', '{min} daqiqa ichida to‘lang').replace('{min}', min))) + '</span>' +
      '<a class="atl-btn atl-btn-p" href="order.html?id=' + encodeURIComponent(unpaid.id) + '">' + esc(t('atl.co.toPay', 'To‘lovga o‘tish')) + '</a>';
    var hd = document.querySelector('.atl-hdr');
    if (hd) hd.parentNode.insertBefore(el, hd.nextSibling);
  }
  function loadUnpaid() {
    var tok = window.LOOM_AUTH && window.LOOM_AUTH.getToken && window.LOOM_AUTH.getToken();
    var cached = false;
    try { cached = !!sessionStorage.getItem('loom_user'); } catch (e) { /* private mode */ }
    if (!desk || d.classList.contains('tma') || (!tok && !cached)) return;
    fetch(api() + '/api/me/orders', { credentials: 'include', headers: tok ? { Authorization: 'Bearer ' + tok } : {} })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var now = Date.now();
        unpaid = ((j && j.orders) || []).filter(function (o) {
          return o.payment_method === 'p2p' && o.status === 'new' &&
            (o.payment_status === 'unpaid' || o.payment_status === 'failed') && o.pay_deadline > now;
        }).sort(function (a, b) { return a.pay_deadline - b.pay_deadline; })[0] || null;
        paintStrip();
      })
      .catch(function () { /* no strip */ });
  }
  window.addEventListener('loom:langchange', paintStrip);

  window.addEventListener('loom:langchange', renderGarments);
  loadUnpaid();
  loadGarments();
  loadWorks();
})();
