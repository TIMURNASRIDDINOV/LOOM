/* ================================================================
   LOOM — Shared navbar behaviour (mobile slide-over menu).
   Works with the canonical markup: #menuToggle, #menuClose,
   #mobileMenu, #mobileBackdrop and the .active / body.menu-open classes.
   Idempotent — safe to load alongside a page that also wires its own.
================================================================ */
'use strict';
(function () {
  if (window.__loomNavBound) return;
  window.__loomNavBound = true;

  function init() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      try { window.lucide.createIcons(); } catch (e) {}
    }

    var toggle   = document.getElementById('menuToggle');
    var closeBtn = document.getElementById('menuClose');
    var menu     = document.getElementById('mobileMenu');
    var backdrop = document.getElementById('mobileBackdrop');
    if (!toggle || !menu) return;

    /* iOS Safari ignores body{overflow:hidden} for touch scrolling —
       the reliable lock is position:fixed with the scroll offset
       baked in, restored on close */
    var lockY = 0;
    function open() {
      lockY = window.scrollY || 0;
      menu.classList.add('active');
      if (backdrop) backdrop.classList.add('active');
      document.body.classList.add('menu-open');
      document.body.style.position = 'fixed';
      document.body.style.top = -lockY + 'px';
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.width = '100%';
      if (window.LOOM_LENIS) window.LOOM_LENIS.stop();
      toggle.setAttribute('aria-expanded', 'true');
      menu.setAttribute('aria-hidden', 'false');
    }
    function close() {
      if (!menu.classList.contains('active')) return;
      menu.classList.remove('active');
      if (backdrop) backdrop.classList.remove('active');
      document.body.classList.remove('menu-open');
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.width = '';
      window.scrollTo(0, lockY);
      if (window.LOOM_LENIS) window.LOOM_LENIS.start();
      toggle.setAttribute('aria-expanded', 'false');
      menu.setAttribute('aria-hidden', 'true');
    }

    toggle.addEventListener('click', open);
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (backdrop) backdrop.addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
    // delegate: also covers links rendered later (auth.js mobile row);
    // language buttons are <button>s and keep the menu open
    menu.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href]');
      if (a && !a.closest('.mobile-lang')) close();
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth >= 768) close();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
