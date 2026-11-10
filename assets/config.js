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
  window.LOOM_FLAGS = {
    lab: false,
    cfgPhone: true,
  }
})()
