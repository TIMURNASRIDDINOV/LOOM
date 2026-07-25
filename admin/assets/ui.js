'use strict'

/* LOOM Admin — toasts and confirm dialogs.
   Replaces alert()/confirm(), which block the page, cannot be themed, and give
   a destructive action the same two grey buttons as a harmless one.
   Styling lives in theme.css (.toast-stack / .dialog-*). */

;(function () {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  // ── Toasts ────────────────────────────────────────────────────────────
  let stack = null
  function getStack() {
    if (!stack || !stack.isConnected) {
      stack = document.createElement('div')
      stack.className = 'toast-stack'
      // Announced politely: a toast is confirmation, not an interruption.
      stack.setAttribute('role', 'status')
      stack.setAttribute('aria-live', 'polite')
      document.body.appendChild(stack)
    }
    return stack
  }

  const TOAST_ICONS = { success: '✓', error: '!', info: '·' }

  function toast(message, kind, ms) {
    const type = kind || 'info'
    const el = document.createElement('div')
    el.className = 'toast toast--' + type
    el.innerHTML =
      '<span class="toast-icon" aria-hidden="true">' + (TOAST_ICONS[type] || '·') + '</span>' +
      '<span>' + esc(message) + '</span>'
    getStack().appendChild(el)

    const life = ms || (type === 'error' ? 6000 : 3500)
    const timer = setTimeout(dismiss, life)
    function dismiss() {
      clearTimeout(timer)
      el.classList.add('is-leaving')
      setTimeout(() => el.remove(), 180)
    }
    el.addEventListener('click', dismiss)
    return dismiss
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
