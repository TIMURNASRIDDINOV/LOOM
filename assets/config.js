'use strict'
;(function () {
  const h = window.location.hostname
  window.LOOM_CONFIG = {
    API_BASE: (h === 'localhost' || h === '127.0.0.1')
      ? 'http://localhost:8787'
      : 'https://api.loomdesign.uz',
  }

  // Report only structural locations. Error messages/URLs can contain customer data.
  let reports = 0
  function reportError(kind, error) {
    if (reports >= 3) return
    reports++
    const stack = error && typeof error.stack === 'string' ? error.stack : ''
    const locations = (stack.match(/:\d{1,7}:\d{1,7}(?=\)|\s|$)/g) || []).slice(0, 12).join(' ')
    const payload = JSON.stringify({ kind, surface: window.location.pathname.startsWith('/admin') ? 'admin' : 'web', stack: locations })
    const url = window.LOOM_CONFIG.API_BASE + '/api/files/client-error'
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }))) return
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {})
    } catch (_) { /* Reporting must never break the page. */ }
  }
  window.LOOM_REPORT_ERROR = reportError
  window.addEventListener('error', function (event) { reportError('error', event.error) })
  window.addEventListener('unhandledrejection', function (event) { reportError('unhandledrejection', event.reason) })

  // Feature flags. `lab` is the customer-facing LOOM Lab (AI print generation):
  // the whole UI is built and shipped, but every entry point stays in its
  // "coming soon" state until this is true — so releasing it is a one-line
  // change here, not another deploy of the pages.
  window.LOOM_FLAGS = {
    lab: false,
  }
})()
