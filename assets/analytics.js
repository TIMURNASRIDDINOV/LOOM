/* ================================================================
   LOOM — Google Analytics 4 + Microsoft Clarity behind consent (LOOM-283)
   and Yandex Metrika with Webvisor (LOOM-289).

   Loaded with defer on every customer page except auth/callback.html
   (its query string carries the OAuth code). On pages with track.js it
   sits right after it, so the funnel bridge is in place before any
   configurator step fires.

   - Nothing reaches Google or Clarity before the visitor accepts:
     gtag.js and the Clarity tag are injected only after consent.
     Consent Mode v2 defaults are all denied; accept grants
     analytics_storage only (LOOM runs no Google ads, ad_* stay denied).
   - The choice lives in localStorage `loom_consent` ('granted' or
     'denied'). Any [data-consent-open] element reopens the banner
     (the footer links to it on privacy.html).
   - GA4: page_view (UTM kept) and enhanced measurement (scroll depth
     etc., switched in GA4 admin), `ui_click` for links and buttons,
     and the track.js funnel events (cfg_*) mirrored once per session,
     like track.js itself, without a second request to the D1 tracker.
   - Never sends form values or personal data: click text inside
     [data-clarity-mask] areas (the auth nav slots in layout.js, the
     checkout, account, login and register forms) is dropped, and so is
     text that looks like a phone or email. Clarity masks those areas;
     Webvisor hides them through the matching ym-hide-content class and
     gets ym-disable-keys on every field the visitor focuses.
   - Yandex Metrika: set YM_ID below. While it is 0, Metrika is a no-op:
     no tag.js, no request to Yandex. The site is multi-page (history
     calls only tweak the query string or guard the bag drawer), so no
     virtual hits are needed.
================================================================ */
(function () {
  'use strict';
  var GA4_ID = 'G-CX2PR981YW';
  var CLARITY_ID = 'z3lrdtn5pv';
  var YM_ID = 114015332; // Yandex Metrika counter number (loomdesign.uz). 0 = Metrika off.
  var KEY = 'loom_consent';
  var w = window, d = document;

  /* A Telegram Mini App launch URL carries signed initData in its hash;
     never measure that page view (later navigations have no hash). */
  if (/tgWebAppData/.test(location.hash)) return;

  w.dataLayer = w.dataLayer || [];
  function gtag() { w.dataLayer.push(arguments); }
  gtag('consent', 'default', {
    ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    analytics_storage: 'denied'
  });

  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function save(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* private mode: ask again next page */ } }
  function t(k) { return w.LOOM_I18N ? w.LOOM_I18N.t(k) : k; }

  function load(src) {
    var s = d.createElement('script');
    s.async = true;
    s.src = src;
    d.head.appendChild(s);
  }

  var started = false;
  function start() {
    if (started) return;
    started = true;
    gtag('consent', 'update', { analytics_storage: 'granted' });
    gtag('js', new Date());
    gtag('config', GA4_ID);
    load('https://www.googletagmanager.com/gtag/js?id=' + GA4_ID);
    w.clarity = w.clarity || function () { (w.clarity.q = w.clarity.q || []).push(arguments); };
    w.clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' });
    load('https://www.clarity.ms/tag/' + CLARITY_ID);
    if (YM_ID) {
      w.ym = w.ym || function () { (w.ym.a = w.ym.a || []).push(arguments); };
      w.ym.l = +new Date();
      w.ym(YM_ID, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: true });
      load('https://mc.yandex.ru/metrika/tag.js?id=' + YM_ID);
    }
  }

  /* Accepted earlier, declined now: stop both, drop their first-party
     cookies, and reload so neither script stays in the page. */
  function withdraw() {
    gtag('consent', 'update', { analytics_storage: 'denied' });
    try { if (w.clarity) w.clarity('consent', false); } catch (e) { /* tag not loaded yet */ }
    var host = location.hostname.split('.');
    d.cookie.split(';').forEach(function (c) {
      var name = c.split('=')[0].trim();
      if (!/^(_ga|_cl|_ym)/.test(name)) return;
      d.cookie = name + '=; Max-Age=0; path=/';
      for (var i = 0; i < host.length - 1; i++) {
        d.cookie = name + '=; Max-Age=0; path=/; domain=' + host.slice(i).join('.');
      }
    });
    location.reload();
  }

  function choose(v) {
    var was = stored();
    save(v);
    var el = d.getElementById('loom-consent');
    if (el) el.remove();
    if (v === 'granted') start();
    else if (was === 'granted') withdraw();
  }

  /* Atelye look, self-contained: the banner also shows on the
     configurator, which does not load atelye.css, so every token has a
     fallback and the buttons are the banner's own (44 px+ targets).
     Phones: above the bottom nav / action bar. Hidden while the
     first-visit onboarding (html.atl-onb-open) is on screen. */
  var CSS =
    '#loom-consent{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:70;' +
      'max-width:560px;margin:0 auto;padding:14px;display:flex;flex-direction:column;gap:12px;' +
      'background:var(--surface,#fff);color:var(--ink,#14171a);border-radius:12px;' +
      'box-shadow:0 0 0 1px var(--ln,rgba(20,23,26,.16)),0 10px 28px -10px rgba(14,18,24,.35);' +
      'font:400 14px/1.45 var(--f,"Archivo",system-ui,sans-serif)}' +
    'body.atl-has-bnav #loom-consent{bottom:calc(var(--atl-bnav-h,60px) + var(--atl-sb,env(safe-area-inset-bottom,0px)) + 12px)}' +
    'body.atl-abar-on #loom-consent{bottom:calc(76px + var(--atl-sb,env(safe-area-inset-bottom,0px)))}' +
    'html.atl-onb-open #loom-consent,html.tma #loom-consent{display:none}' +
    '#loom-consent p{margin:0}' +
    '#loom-consent a{color:inherit;text-decoration:underline;text-underline-offset:3px}' +
    '#loom-consent .lc-actions{display:flex;gap:8px}' +
    '#loom-consent .lc-btn{flex:1 1 0;min-height:48px;padding:0 14px;border:0;border-radius:8px;cursor:pointer;text-align:center;' +
      'font:700 14.5px var(--f,"Archivo",system-ui,sans-serif);background:none;color:inherit;box-shadow:inset 0 0 0 1.5px currentColor}' +
    '#loom-consent .lc-btn:hover{background:var(--surface2,#e9ecef)}' +
    '#loom-consent .lc-ok{background:var(--ink,#14171a);color:var(--surface,#fff);box-shadow:none}' +
    '#loom-consent .lc-ok:hover{background:var(--ink,#14171a);opacity:.88}' +
    '#loom-consent .lc-btn:focus-visible{outline:2px solid var(--ink,#14171a);outline-offset:2px}' +
    '@media (min-width:900px){#loom-consent,body.atl-has-bnav #loom-consent,body.atl-abar-on #loom-consent{left:auto;right:24px;bottom:24px;width:420px}}';

  function banner() {
    if (d.getElementById('loom-consent')) return;
    if (!d.getElementById('loom-consent-css')) {
      var st = d.createElement('style');
      st.id = 'loom-consent-css';
      st.textContent = CSS;
      d.head.appendChild(st);
    }
    var el = d.createElement('div');
    el.id = 'loom-consent';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Cookies');
    el.innerHTML =
      '<p><span data-i18n="consent.text">' + t('consent.text') + '</span> ' +
        '<a href="privacy.html#analytics" data-i18n="consent.more">' + t('consent.more') + '</a></p>' +
      '<div class="lc-actions">' +
        '<button type="button" class="lc-btn" data-consent="denied" data-i18n="consent.decline">' + t('consent.decline') + '</button>' +
        '<button type="button" class="lc-btn lc-ok" data-consent="granted" data-i18n="consent.accept">' + t('consent.accept') + '</button>' +
      '</div>';
    d.body.appendChild(el);
  }

  function clickParams(el) {
    var text = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    // ponytail: pattern catches emails and phone-like digit runs, also long prices; ids still identify the control
    if (el.closest('[data-clarity-mask]') || /@|\d[\d\s()+-]{6,}\d/.test(text)) text = '';
    var href = '';
    if (typeof el.href === 'string' && el.href) {
      try {
        var u = new URL(el.href);
        href = u.origin === location.origin ? u.pathname
          : /^https?:$/.test(u.protocol) ? u.host + u.pathname : u.protocol;
      } catch (e) { /* unparseable href: leave empty */ }
    }
    var sec = el.closest('section, header, footer, nav, aside, dialog, form');
    return {
      element_id: el.id || '',
      element_text: text,
      href: href,
      page_path: location.pathname,
      section: sec ? (sec.id || sec.tagName.toLowerCase()) : ''
    };
  }

  /* Webvisor: never record typed values, whatever page the field is on. */
  d.addEventListener('focusin', function (e) {
    var el = e.target;
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.classList.add('ym-disable-keys');
  }, true);

  d.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('a, button, [role="button"]') : null;
    if (!el) return;
    if (el.hasAttribute('data-consent-open')) { e.preventDefault(); banner(); return; }
    var v = el.getAttribute('data-consent');
    if (v === 'granted' || v === 'denied') { choose(v); return; }
    if (started) gtag('event', 'ui_click', clickParams(el));
  }, true);

  /* Funnel bridge: same event names in GA4 and as Metrika goals, once per session (the
     sessionStorage key is track.js's own dedupe), no change to track.js. */
  var T = w.LOOM_TRACK;
  if (T && typeof T.event === 'function') {
    var orig = T.event;
    T.event = function (name) {
      var first = true;
      try { first = !sessionStorage.getItem('loom_evt_' + name); } catch (e) { /* private mode */ }
      orig(name);
      if (name && first && started) {
        gtag('event', name);
        if (YM_ID) w.ym(YM_ID, 'reachGoal', name); // LOOM-339: one JS-event goal per name in Metrika
      }
    };
  }

  var choice = stored();
  if (choice === 'granted') start();
  else if (choice !== 'denied') banner();
})();
