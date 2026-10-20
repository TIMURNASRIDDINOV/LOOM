'use strict'
;(function () {
  const h = window.location.hostname
  window.LOOM_CONFIG = {
    API_BASE: (h === 'localhost' || h === '127.0.0.1')
      ? 'http://localhost:8787'
      : /^[a-z0-9-]+\.loom-site-d94\.pages\.dev$/.test(h)
        ? 'https://loom-backend-staging.timurnasriddinov56.workers.dev'
        : 'https://api.loomdesign.uz',
  }

  // Feature flags. `lab` is the customer-facing LOOM Lab (AI print generation):
  // the whole UI is built and shipped, but every entry point stays in its
  // "coming soon" state until this is true — so releasing it is a one-line
  // change here, not another deploy of the pages.
  window.LOOM_FLAGS = {
    lab: false,
  }
})()
