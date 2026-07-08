/* ================================================================
   LOOM — pre-paint boot guard. Loaded synchronously in <head>.
   Hides the body for the first frames ONLY when a covering layer
   (intro preloader / page-transition veil) is about to own the
   screen, so there is no flash of unstyled content in between.
   motion.js lifts the hold; the timeout is a failsafe if any CDN
   script is blocked. Reduced-motion users never get held.
================================================================ */
(function () {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var inTransition = !!sessionStorage.getItem('loom_veil');
    var wantsIntro = !sessionStorage.getItem('loom_intro_v1');
    if (wantsIntro || inTransition) {
      document.documentElement.classList.add('motion-hold');
      setTimeout(function () {
        document.documentElement.classList.remove('motion-hold');
      }, 1800);
    }
  } catch (e) { /* storage blocked — never hold the page */ }
})();
