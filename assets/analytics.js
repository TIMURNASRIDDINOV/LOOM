/* ================================================================
   LOOM — Google Analytics 4 + Microsoft Clarity behind consent (LOOM-283).

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
     text that looks like a phone or email. Clarity masks those areas.
================================================================ */
(function () {
  'use strict';
  var GA4_ID = 'G-CX2PR981YW';
  var CLARITY_ID = 'z3lrdtn5pv';
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
  }

  /* Accepted earlier, declined now: stop both, drop their first-party
     cookies, and reload so neither script stays in the page. */
  function withdraw() {
    gtag('consent', 'update', { analytics_storage: 'denied' });
    try { if (w.clarity) w.clarity('consent', false); } catch (e) { /* tag not loaded yet */ }
    var host = location.hostname.split('.');
    d.cookie.split(';').forEach(function (c) {
      var name = c.split('=')[0].trim();
      if (!/^(_ga|_cl)/.test(name)) return;
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

  var CSS =
    '#loom-consent{position:fixed;left:16px;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:10005;' +
      'max-width:560px;margin:0 auto;padding:1rem 1.1rem;background:var(--paper-3);color:var(--ink);' +
      'border:var(--rule);box-shadow:var(--hard);font-family:var(--font-body);font-size:var(--text-sm);line-height:1.5}' +
    '#loom-consent p{margin:0 0 .8rem}' +
    '#loom-consent a{color:inherit;text-decoration:underline;text-underline-offset:2px}' +
    '#loom-consent .lc-actions{display:flex;flex-wrap:wrap;gap:.6rem;justify-content:flex-end}' +
    '#loom-consent .btn{padding:.65rem 1.2rem}';

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
        '<button type="button" class="btn btn--outline" data-consent="denied" data-i18n="consent.decline">' + t('consent.decline') + '</button>' +
        '<button type="button" class="btn btn--solid" data-consent="granted" data-i18n="consent.accept">' + t('consent.accept') + '</button>' +
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

  d.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('a, button, [role="button"]') : null;
    if (!el) return;
    if (el.hasAttribute('data-consent-open')) { e.preventDefault(); banner(); return; }
    var v = el.getAttribute('data-consent');
    if (v === 'granted' || v === 'denied') { choose(v); return; }
    if (started) gtag('event', 'ui_click', clickParams(el));
  }, true);

  /* Funnel bridge: same event names in GA4, once per session (the
     sessionStorage key is track.js's own dedupe), no change to track.js. */
  var T = w.LOOM_TRACK;
  if (T && typeof T.event === 'function') {
    var orig = T.event;
    T.event = function (name) {
      var first = true;
      try { first = !sessionStorage.getItem('loom_evt_' + name); } catch (e) { /* private mode */ }
      orig(name);
      if (name && first && started) gtag('event', name);
    };
  }

  var choice = stored();
  if (choice === 'granted') start();
  else if (choice !== 'denied') banner();
})();
