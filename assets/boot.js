/* ================================================================
   LOOM — pre-paint boot guard. Loaded synchronously in <head> on
   every customer page.

   0. Theme bootstrap: stamps data-theme + color-scheme on <html>
      BEFORE first paint (localStorage `loom_theme`, else system
      preference). Owns the theme API (window.__loomTheme) and the
      delegated [data-theme-set] click handler for the nav dots.

   1. Page-transition arrival: when the previous page left through
      the red curtain wipe (sessionStorage flag), paint the cover
      BEFORE first render via html.page-covered::after (theme.css),
      so the new page never flashes. motion.js wipes it away; the
      timeout is a failsafe if a CDN script is blocked.

   2. Intro preloader hold (opt-in): pages with the intro carry
      data-intro on this script tag:
        <script src="assets/boot.js" data-intro></script>

   Reduced-motion users skip 1–2; the theme always applies.
================================================================ */
(function () {
  'use strict';
  var d = document.documentElement;
  var KEY = 'loom_theme';
  var META_COLORS = { light: '#f4f2ed', dark: '#151412' };

  function stored() {
    try { var v = localStorage.getItem(KEY); return (v === 'light' || v === 'dark') ? v : null; }
    catch (e) { return null; }
  }
  function systemTheme() {
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
      ? 'dark' : 'light';
  }
  function effective() { return stored() || systemTheme(); }

  function paintMeta(theme) {
    var m = document.querySelector('meta[name="theme-color"]');
    if (!m) {
      m = document.createElement('meta');
      m.setAttribute('name', 'theme-color');
      (document.head || d).appendChild(m);
    }
    m.setAttribute('content', META_COLORS[theme] || META_COLORS.light);
  }

  function markDots(theme) {
    var dots = document.querySelectorAll('[data-theme-set]');
    for (var i = 0; i < dots.length; i++) {
      dots[i].classList.toggle('active', dots[i].getAttribute('data-theme-set') === theme);
    }
  }

  function apply(theme) {
    d.setAttribute('data-theme', theme);
    d.style.colorScheme = theme;
    paintMeta(theme);
    markDots(theme);
  }

  var animTimer = null;
  function set(theme, opts) {
    if (theme !== 'light' && theme !== 'dark') return;
    try { localStorage.setItem(KEY, theme); } catch (e) { /* private mode */ }
    if (!opts || opts.animate !== false) {
      d.classList.add('theme-anim');
      clearTimeout(animTimer);
      animTimer = setTimeout(function () { d.classList.remove('theme-anim'); }, 420);
    }
    apply(theme);
    try {
      window.dispatchEvent(new CustomEvent('loom:themechange', { detail: { theme: theme } }));
    } catch (e) { /* CustomEvent unsupported — theme still applied */ }
  }

  /* stamp before first paint, transitions suppressed for two frames */
  apply(effective());
  d.classList.add('theme-booting');
  function unboot() { d.classList.remove('theme-booting'); }
  function scheduleUnboot() {
    (window.requestAnimationFrame || window.setTimeout)(function () {
      (window.requestAnimationFrame || window.setTimeout)(unboot);
    });
  }
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', function () {
      markDots(effective()); /* nav dots exist only after layout.js injects them */
      scheduleUnboot();
    });
  } else {
    scheduleUnboot();
  }

  /* nav dots (injected later by layout.js) — one delegated listener */
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-theme-set]') : null;
    if (b) set(b.getAttribute('data-theme-set'));
  });

  /* no explicit choice yet → follow live system changes */
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onSys = function () { if (!stored()) set(systemTheme(), { animate: true }); };
    if (mq.addEventListener) mq.addEventListener('change', onSys);
    else if (mq.addListener) mq.addListener(onSys);
  }

  /* apply() without the localStorage write — for contexts that own the theme
     only while they are open (the Telegram Mini App follows the Telegram
     client). Persisting there would clobber the visitor's own dots choice for
     normal browsing, and pin them out of following system changes. */
  window.__loomTheme = { KEY: KEY, effective: effective, set: set, applyOnly: apply };
})();

(function () {
  try {
    var d = document.documentElement;

    /* consume the wipe flag unconditionally — a mid-session
       reduced-motion toggle must not strand it for the whole session */
    var hadWipe = false;
    var wipeRaw = sessionStorage.getItem('loom_wipe');
    if (wipeRaw) {
      sessionStorage.removeItem('loom_wipe');
      hadWipe = true;
    }
    /* motion.js keys the intro off this: curtain arrivals never intro */
    window.__loomArrivedViaWipe = hadWipe;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    /* 1. arriving mid-wipe: paint the cover before first render.
       motion.js clears this failsafe when it takes over the reveal. */
    if (hadWipe) {
      d.classList.add('page-covered');
      window.__loomCoverFailsafe = setTimeout(function () {
        /* recover through the same wipe-out animation instead of a
           hard snap (cover simply vanishing reads as a glitch) */
        d.classList.add('page-reveal');
        setTimeout(function () {
          d.classList.remove('page-covered', 'page-reveal');
        }, 600);
      }, 1900);
    }

    /* 2. fresh-arrival intro hold: direct opens AND refreshes play the
       full intro; internal curtain navigations and back/forward skip it
       (must mirror motion.js wantsIntro() or the page flashes) */
    var navType = 'navigate';
    try {
      var pe = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
      if (pe && pe.type) navType = pe.type;
    } catch (e) { /* Navigation Timing unsupported — treat as fresh */ }

    var me = document.currentScript;
    if (me && me.hasAttribute('data-intro') && !hadWipe && navType !== 'back_forward') {
      d.classList.add('motion-hold');
      setTimeout(function () {
        d.classList.remove('motion-hold');
      }, 1800);
    }
  } catch (e) { /* storage blocked — never hold the page */ }
})();
