'use strict'
;(function () {
  // Generate or retrieve a stable session ID for this browser session
  function getSessionId() {
    let sid = sessionStorage.getItem('loom_sid')
    if (!sid) {
      sid = 'sid_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
      sessionStorage.setItem('loom_sid', sid)
    }
    return sid
  }

  function detectDevice() {
    const ua = navigator.userAgent
    if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) {
      return /iPad|Tablet/i.test(ua) ? 'tablet' : 'mobile'
    }
    return 'desktop'
  }

  function detectOs() {
    const ua = navigator.userAgent
    if (/Android/i.test(ua))     return 'android'
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
    if (/Windows/i.test(ua))     return 'windows'
    if (/Mac OS X/i.test(ua))    return 'mac'
    if (/Linux/i.test(ua))       return 'linux'
    return 'other'
  }

  function detectBrowser() {
    const ua = navigator.userAgent
    if (/SamsungBrowser/i.test(ua)) return 'samsung'
    if (/Edge|Edg\//i.test(ua))    return 'edge'
    if (/OPR|Opera/i.test(ua))     return 'opera'
    if (/Firefox/i.test(ua))       return 'firefox'
    if (/Chrome/i.test(ua))        return 'chrome'
    if (/Safari/i.test(ua))        return 'safari'
    return 'other'
  }

  function send() {
    const API = window.LOOM_CONFIG
      ? window.LOOM_CONFIG.API_BASE
      : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
          ? 'http://localhost:8787'
          : 'https://api.loomdesign.uz')

    const payload = {
      session_id: getSessionId(),
      page: window.location.pathname + window.location.search,
      device_type: detectDevice(),
      os: detectOs(),
      browser: detectBrowser(),
      referrer: document.referrer || null,
    }

    // Use sendBeacon for reliability; fall back to fetch
    const url = API + '/api/files/track'
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, blob)
    } else {
      fetch(url, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } }).catch(() => {})
    }
  }

  // Send once per session per page load (don't re-track on SPA navigation for now)
  const trackKey = 'loom_tracked_' + window.location.pathname
  if (!sessionStorage.getItem(trackKey)) {
    sessionStorage.setItem(trackKey, '1')
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', send)
    } else {
      send()
    }
  }
})()
