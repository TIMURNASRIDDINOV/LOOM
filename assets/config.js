'use strict'
;(function () {
  const h = window.location.hostname
  window.LOOM_CONFIG = {
    API_BASE: (h === 'localhost' || h === '127.0.0.1')
      ? 'http://localhost:8787'
      : 'https://api.loomdesign.uz',
  }

  // Feature flags. `lab` is the customer-facing LOOM Lab (AI print generation):
  // the whole UI is built and shipped, but every entry point stays in its
  // "coming soon" state until this is true — so releasing it is a one-line
  // change here, not another deploy of the pages.
  // `cfgPhone` is the three-step phone configurator (PRD-214, LOOM-292):
  // below 901px configurator.html shows Kiyim → Dizayn → Joylash with a
  // header progress and a one-row bar. Off = today's bottom sheet.
  // `cfgDesktop` is the same three steps on desktop (PRD-214, LOOM-298):
  // from 901px the left panel is an accordion of Kiyim → Dizayn → Joylash
  // with a pinned price and CTA, and the preview carries three controls.
  // Off = today's desktop panel.
  // `cfgAtelye` is the Atelye phone configurator (PRD-215, LOOM-307..315):
  // below 901px the garment fills the screen, tools sit on its edges and an
  // action bar holds the two buy buttons. On, it replaces the cfgPhone flow
  // whatever cfgPhone says. Off (or missing) = the cfgPhone flow. Desktop
  // is unchanged either way. Tim switches it on (PRD-215 rollout step 3).
  window.LOOM_FLAGS = {
    lab: false,
    cfgPhone: true,
    cfgDesktop: false,
    cfgAtelye: true,
  }
})()
