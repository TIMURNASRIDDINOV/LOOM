/* LOOM Admin — synchronous theme bootstrap.
   MUST be loaded in <head>, BEFORE any page content, and NOT async/deferred.
   It sets data-theme + color-scheme on <html> before the first paint, so the
   page never flashes the wrong theme. Pairs with theme.css. */
(function () {
  'use strict'
  var KEY = 'loom_admin_theme'
  var root = document.documentElement

  function effective(stored) {
    if (stored === 'light' || stored === 'dark') return stored
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
      ? 'dark' : 'light'
  }

  var stored
  try { stored = localStorage.getItem(KEY) || 'system' } catch (e) { stored = 'system' }
  var eff = effective(stored)

  root.setAttribute('data-theme', eff)
  root.style.colorScheme = eff

  // Suppress transitions for the very first paint, then re-enable so that
  // user-initiated theme switches still animate.
  root.classList.add('theme-booting')
  function unboot() { root.classList.remove('theme-booting') }
  function schedule() {
    (window.requestAnimationFrame || window.setTimeout)(function () {
      (window.requestAnimationFrame || window.setTimeout)(unboot)
    })
  }
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', schedule)
  } else {
    schedule()
  }

  // Shared helpers for layout.js
  window.__loomTheme = { KEY: KEY, effective: effective }
})()
