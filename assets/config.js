'use strict'
;(function () {
  const h = window.location.hostname
  window.LOOM_CONFIG = {
    API_BASE: (h === 'localhost' || h === '127.0.0.1')
      ? 'http://localhost:8787'
      : 'https://api.loomdesign.uz',
    TELEGRAM_WORKER_URL: 'https://loom-telegram-orders.timurnasriddinov56.workers.dev',
  }
})()
