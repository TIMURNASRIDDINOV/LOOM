/* ================================================================
   LOOM — pre-paint boot guard. Loaded synchronously in <head> with
   a data-intro attribute on pages that run the intro preloader:
     <script src="assets/boot.js" data-intro></script>
   Hides the body for the first frames ONLY when the intro is about
   to cover the screen, so there is no unstyled flash in between.
   motion.js lifts the hold; the timeout is a failsafe if any CDN
   script is blocked. Reduced-motion users never get held.
================================================================ */
(function () {
  try {
    var me = document.currentScript;
    if (!me || !me.hasAttribute('data-intro')) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!sessionStorage.getItem('loom_intro_v1')) {
      document.documentElement.classList.add('motion-hold');
      setTimeout(function () {
        document.documentElement.classList.remove('motion-hold');
      }, 1800);
    }
  } catch (e) { /* storage blocked — never hold the page */ }
})();
