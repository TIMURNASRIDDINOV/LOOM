'use strict'

/* LOOM Admin — toasts and confirm dialogs.
   Replaces alert()/confirm(), which block the page, cannot be themed, and give
   a destructive action the same two grey buttons as a harmless one.
   Styling lives in theme.css (.toast-stack / .dialog-*). */

;(function () {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }

  // ── Toasts (LOOM-373: Sonner-style stack) ─────────────────────────────
  // Newest in front, up to 3 more peeking behind (scaled, offset); the stack
  // fans out on hover/focus and pauses its timers. Click, swipe or × dismiss.
  // Identical messages within 4 s show once, so a caller's own error toast and
  // apiJSON's automatic one collapse into one. The customer site has its own
  // copy in assets/toast.js on purpose: separate design systems.
  const MAX = 3, GAP = 8, PEEK = 12, DEDUPE_MS = 4000, EXIT_MS = 250
  const TOAST_ICONS = {
    success: '<path d="M8 12.5l2.5 2.5L16 9.5"/>',
    error:   '<path d="M12 7.5v5.5M12 16.5v.01"/>',
    warning: '<path d="M12 8v5M12 16.5v.01"/>',
    info:    '<path d="M12 11v5.5M12 7.5v.01"/>',
  }
  let stack = null, items = [], paused = false
  const recent = {}

  function getStack() {
    if (!stack) {
      stack = document.createElement('ol')
      stack.className = 'toast-stack'
      stack.setAttribute('aria-label', 'Уведомления')
      const pause = (p) => { paused = p; items.forEach((it) => (p ? it.pause() : it.resume())) }
      stack.addEventListener('mouseenter', () => pause(true))
      stack.addEventListener('mouseleave', () => pause(false))
      stack.addEventListener('focusin', () => pause(true))
      stack.addEventListener('focusout', (e) => { if (!stack.contains(e.relatedTarget)) pause(false) })
    }
    if (!stack.isConnected) document.body.appendChild(stack)
    return stack
  }

  function layout() {
    const live = items.filter((it) => !it.leaving)
    // it.h: natural height, measured on insert (a back card is clamped later).
    let y = 0
    if (stack) stack.style.setProperty('--t-fh', (live[0] ? live[0].h : 0) + 'px')
    live.forEach((it, i) => {
      const st = it.el.style
      it.el.toggleAttribute('data-front', i === 0)
      st.zIndex = String(MAX + 1 - i)
      st.setProperty('--t-yc', (-PEEK * i) + 'px')
      st.setProperty('--t-ye', (-y) + 'px')
      st.setProperty('--t-s', String(1 - 0.05 * i))
      y += it.h + GAP
    })
    if (!stack) return
    const front = live[0] ? live[0].h : 0
    stack.style.setProperty('--t-hc', live.length ? (front + PEEK * (live.length - 1)) + 'px' : '0px')
    stack.style.setProperty('--t-he', Math.max(0, y - GAP) + 'px')
  }

  function toast(message, kind, ms) {
    const type = TOAST_ICONS[kind] ? kind : 'info'
    const text = String(message == null ? '' : message)
    const key = type + '|' + text, now = Date.now()
    const prev = recent[key]
    if (prev && now - prev.at < DEDUPE_MS && !prev.item.leaving) return prev.item.dismiss

    const el = document.createElement('li')
    el.className = 'toast toast--' + type + ' is-enter'
    el.setAttribute('data-front', '') // unclamped, so it.h below is the natural height
    // Errors interrupt (assertive); confirmations wait their turn.
    el.setAttribute('role', type === 'error' ? 'alert' : 'status')
    el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite')
    el.setAttribute('aria-atomic', 'true')
    el.innerHTML =
      '<svg class="toast-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.25"/>' + TOAST_ICONS[type] + '</svg>' +
      '<span class="toast-msg">' + esc(text) + '</span>' +
      '<button type="button" class="toast-x" aria-label="Закрыть">×</button>'

    let left = ms || (type === 'error' ? 6000 : 4000), started = 0, timer = 0
    const it = {
      el, leaving: false, dismiss,
      pause() { if (timer) { clearTimeout(timer); timer = 0; left -= Date.now() - started } },
      resume() { if (!timer && !it.leaving) { started = Date.now(); timer = setTimeout(dismiss, Math.max(left, 1000)) } },
    }
    function dismiss() {
      if (it.leaving) return
      it.leaving = true
      clearTimeout(timer)
      el.classList.add('is-leaving')
      layout()
      setTimeout(() => { el.remove(); items = items.filter((x) => x !== it); layout() }, EXIT_MS + 30)
    }
    el.querySelector('.toast-x').addEventListener('click', (e) => { e.stopPropagation(); dismiss() })
    bindSwipe(el, dismiss)

    const s = getStack()
    s.insertBefore(el, s.firstChild)
    it.h = el.offsetHeight
    items.unshift(it)
    recent[key] = { at: now, item: it }
    items.filter((x) => !x.leaving).slice(MAX).forEach((x) => x.dismiss())
    layout()
    void el.offsetHeight // commit the start state so the entrance animates
    el.classList.remove('is-enter')
    if (!paused) it.resume()
    return dismiss
  }

  // A tap dismisses; a drag past 45 px (sideways or down) flings it away.
  function bindSwipe(el, dismiss) {
    let x0 = 0, y0 = 0, dx = 0, dy = 0, down = false
    const reset = () => { el.style.setProperty('--t-sx', '0px'); el.style.setProperty('--t-sy', '0px') }
    el.addEventListener('pointerdown', (e) => {
      if (e.button || e.target.closest('.toast-x')) return
      down = true; x0 = e.clientX; y0 = e.clientY; dx = dy = 0
      try { el.setPointerCapture(e.pointerId) } catch { /* old browser */ }
      el.classList.add('is-swiping')
    })
    el.addEventListener('pointermove', (e) => {
      if (!down) return
      dx = e.clientX - x0; dy = Math.max(0, e.clientY - y0)
      const horiz = Math.abs(dx) > dy
      el.style.setProperty('--t-sx', horiz ? dx + 'px' : '0px')
      el.style.setProperty('--t-sy', horiz ? '0px' : dy + 'px')
    })
    el.addEventListener('pointerup', () => {
      if (!down) return
      down = false
      el.classList.remove('is-swiping')
      const moved = Math.max(Math.abs(dx), dy)
      if (moved < 6 || moved > 45) dismiss(); else reset()
    })
    el.addEventListener('pointercancel', () => { down = false; el.classList.remove('is-swiping'); reset() })
  }

  // ── Confirm dialog ────────────────────────────────────────────────────
  // Returns a Promise<boolean>. Focus is trapped and returned to whatever was
  // focused before, so keyboard users do not lose their place.
  function confirmDialog(opts) {
    const o = opts || {}
    return new Promise((resolve) => {
      const previous = document.activeElement

      const backdrop = document.createElement('div')
      backdrop.className = 'dialog-backdrop'
      backdrop.innerHTML =
        '<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">' +
          '<h2 class="dialog-title" id="dlg-title">' + esc(o.title || 'Подтвердите действие') + '</h2>' +
          (o.body ? '<p class="dialog-body">' + esc(o.body) + '</p>' : '') +
          '<div class="dialog-actions">' +
            '<button type="button" class="btn" data-act="cancel">' + esc(o.cancelLabel || 'Отмена') + '</button>' +
            '<button type="button" class="btn ' + (o.danger ? 'btn--danger' : 'btn--primary') + '" data-act="ok">' +
              esc(o.confirmLabel || 'Подтвердить') +
            '</button>' +
          '</div>' +
        '</div>'
      document.body.appendChild(backdrop)

      const okBtn = backdrop.querySelector('[data-act="ok"]')
      const cancelBtn = backdrop.querySelector('[data-act="cancel"]')
      // A destructive dialog opens on Cancel, so Enter never destroys anything.
      ;(o.danger ? cancelBtn : okBtn).focus()

      function close(result) {
        document.removeEventListener('keydown', onKey, true)
        backdrop.remove()
        if (previous && previous.focus) previous.focus()
        resolve(result)
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(false); return }
        if (e.key !== 'Tab') return
        const focusables = [cancelBtn, okBtn]
        const i = focusables.indexOf(document.activeElement)
        e.preventDefault()
        const next = e.shiftKey ? (i <= 0 ? focusables.length - 1 : i - 1)
                                : (i === focusables.length - 1 ? 0 : i + 1)
        focusables[next].focus()
      }

      okBtn.addEventListener('click', () => close(true))
      cancelBtn.addEventListener('click', () => close(false))
      backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(false) })
      document.addEventListener('keydown', onKey, true)
    })
  }

  // Turn an API rejection into something an admin can act on. The backend
  // marks permission failures with code:'forbidden' (middleware/requireAdmin).
  function apiErrorMessage(err) {
    if (err && err.data && err.data.code === 'forbidden') {
      return err.data.error || 'Недостаточно прав для этого действия.'
    }
    if (err && err.status === 401) return 'Сессия истекла — войдите заново.'
    return (err && err.message) || 'Не удалось выполнить действие.'
  }

  window.LOOM_UI = { toast, confirmDialog, apiErrorMessage, esc }
})()
