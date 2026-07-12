/* ================================================================
   LOOM — Shared header & footer, defined once and injected on load.
   Edit the markup here and every page follows.

   Usage (script order matters — before i18n.js/auth.js/nav.js):
     <body data-page="home" [data-cart] [data-no-footer]>
     data-page      → which nav link gets .active
                      (home | catalog | configurator | account)
     data-cart      → include the cart button (configurator)
     data-no-footer → skip the footer (configurator's 100vh studio)

   Keeps the exact ID/class contract used by nav.js, auth.js
   (auth-nav-slot), i18n.js (lang-switcher-mount, data-i18n).
================================================================ */
'use strict';
(function () {
  var body = document.body;
  if (!body || body.dataset.loomLayout === 'done') return;
  body.dataset.loomLayout = 'done';

  var page = body.getAttribute('data-page') || '';
  function act(name) { return page === name ? ' active' : ''; }

  var cartBtn = body.hasAttribute('data-cart')
    ? '<button class="nav-cart-btn" id="navCartBtn" aria-label="Cart">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>' +
        '<span class="cart-count" id="cartCount">0</span>' +
      '</button>'
    : '';

  var header =
    '<nav class="nav">' +
      '<div class="nav-content">' +
        '<a href="index.html" class="nav-brand">LOOM<span class="nav-brand-slash">/</span></a>' +
        '<div class="nav-links">' +
          '<a href="index.html" class="nav-link' + act('home') + '" data-i18n="nav.home">Главная</a>' +
          '<a href="catalog.html" class="nav-link' + act('catalog') + '" data-i18n="nav.catalog">Каталог</a>' +
          '<a href="configurator.html" class="nav-link' + act('configurator') + '" data-i18n="nav.configure">Кастомизация</a>' +
        '</div>' +
        '<div class="nav-right">' +
          /* mobile-only pill (nav.css) — the configurator CTA must live in
             the one persistent surface phones have */
          '<a href="configurator.html" class="nav-cta" data-i18n="nav.start">Создать дизайн</a>' +
          cartBtn +
          '<div class="lang-switcher-mount"></div>' +
          '<div class="auth-nav-slot"></div>' +
          '<button class="nav-hamburger" id="menuToggle" aria-label="Menu" aria-expanded="false">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
    '</nav>' +

    '<div class="mobile-backdrop" id="mobileBackdrop"></div>' +
    '<div class="mobile-menu" id="mobileMenu" aria-hidden="true">' +
      '<div class="mobile-menu-header">' +
        '<span class="mobile-menu-brand">LOOM/</span>' +
        '<button class="mobile-menu-close" id="menuClose" aria-label="Close menu">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="mobile-menu-links">' +
        '<a href="index.html" class="mobile-menu-link' + act('home') + '" data-i18n="nav.home">Главная</a>' +
        '<a href="catalog.html" class="mobile-menu-link' + act('catalog') + '" data-i18n="nav.catalog">Каталог</a>' +
        '<a href="configurator.html" class="mobile-menu-link' + act('configurator') + '" data-i18n="nav.configure">Кастомизация</a>' +
        '<a href="account.html" class="mobile-menu-link' + act('account') + '" id="mobile-account-link" data-i18n="nav.account">Личный кабинет</a>' +
        '<a href="configurator.html" class="mobile-menu-link mobile-menu-link--cta" data-i18n="nav.start">Создать дизайн</a>' +
      '</div>' +
      '<div class="mobile-auth-slot"></div>' + /* login state / logout — filled by auth.js */
      '<div class="mobile-lang">' +
        '<span class="mobile-lang-label" data-i18n="nav.language">Язык</span>' +
        '<div class="lang-switcher-mount"></div>' +
      '</div>' +
    '</div>';

  var footer =
    '<footer class="site-footer">' +
      '<div class="container">' +
        '<div class="site-footer__top">' +
          '<p class="site-footer__brand">LOOM<span class="slash">/</span></p>' +
          '<div class="site-footer__cols">' +
            '<div>' +
              '<p class="site-footer__heading" data-i18n="footer.navTitle">Навигация</p>' +
              '<ul class="site-footer__links">' +
                '<li><a href="index.html" data-i18n="nav.home">Главная</a></li>' +
                '<li><a href="catalog.html" data-i18n="nav.catalog">Каталог</a></li>' +
                '<li><a href="configurator.html" data-i18n="nav.configure">Кастомизация</a></li>' +
                '<li><a href="account.html" data-i18n="nav.account">Личный кабинет</a></li>' +
              '</ul>' +
            '</div>' +
            '<div>' +
              '<p class="site-footer__heading" data-i18n="footer.socialTitle">Связь</p>' +
              '<ul class="site-footer__links">' +
                '<li><a href="https://www.instagram.com/loom_uz?igsh=MTI3OWxzNTloZTNvdw%3D%3D&utm_source=qr" target="_blank" rel="noopener noreferrer">Instagram</a></li>' +
                '<li><a href="https://t.me/looom_design_bot" target="_blank" rel="noopener noreferrer">Telegram</a></li>' +
                '<li><a href="mailto:loom.uzbekistan@gmail.com" data-i18n="footer.contact">Контакты</a></li>' +
              '</ul>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="site-footer__bottom">' +
          '<span>© 2026 LOOM — loomdesign.uz</span>' +
          '<span data-i18n="footer.location">Ташкент, Узбекистан</span>' +
        '</div>' +
      '</div>' +
    '</footer>';

  body.insertAdjacentHTML('afterbegin', header);
  if (!body.hasAttribute('data-no-footer')) {
    body.insertAdjacentHTML('beforeend', footer);
  }
})();
