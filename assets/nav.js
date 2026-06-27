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

    function open() {
      menu.classList.add('active');
      if (backdrop) backdrop.classList.add('active');
      document.body.classList.add('menu-open');
      toggle.setAttribute('aria-expanded', 'true');
      menu.setAttribute('aria-hidden', 'false');
    }
    function close() {
      menu.classList.remove('active');
      if (backdrop) backdrop.classList.remove('active');
      document.body.classList.remove('menu-open');
      toggle.setAttribute('aria-expanded', 'false');
      menu.setAttribute('aria-hidden', 'true');
    }

    toggle.addEventListener('click', open);
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (backdrop) backdrop.addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
    menu.querySelectorAll('.mobile-menu-link').forEach(function (l) {
      l.addEventListener('click', function () {
        // keep menu open only for the language row; nav links close it
        if (!l.closest('.mobile-lang')) close();
      });
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
