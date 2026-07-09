/* ================================================================
   LOOM — pre-paint boot guard. Loaded synchronously in <head> on
   every customer page.

   1. Page-transition arrival: when the previous page left through
      the red curtain wipe (sessionStorage flag), paint the cover
      BEFORE first render via html.page-covered::after (theme.css),
      so the new page never flashes. motion.js wipes it away; the
      timeout is a failsafe if a CDN script is blocked.

   2. Intro preloader hold (opt-in): pages with the intro carry
      data-intro on this script tag:
        <script src="assets/boot.js" data-intro></script>

   Reduced-motion users skip both.
================================================================ */
(function () {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var d = document.documentElement;

    /* 1. arriving mid-wipe */
    if (sessionStorage.getItem('loom_wipe')) {
      sessionStorage.removeItem('loom_wipe');
      d.classList.add('page-covered');
      setTimeout(function () {
        d.classList.remove('page-covered', 'page-reveal');
      }, 1900);
    }

    /* 2. first-visit intro hold */
    var me = document.currentScript;
    if (me && me.hasAttribute('data-intro') && !sessionStorage.getItem('loom_intro_v1')) {
      d.classList.add('motion-hold');
      setTimeout(function () {
        d.classList.remove('motion-hold');
      }, 1800);
    }
  } catch (e) { /* storage blocked — never hold the page */ }
})();
