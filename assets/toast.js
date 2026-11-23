/* ================================================================
   LOOM — toasts (LOOM-373). One module for the customer site.

   Usage: <script src="assets/toast.js?v=N"></script> (early on the page).
   Public API: window.LOOM_TOAST(message, kind, ms) → dismiss()
     kind: 'success' | 'error' | 'warning' | 'info' (default 'info')
     ms:   life in ms (default 4000, errors 6000)

   Sonner-style stack: bottom-right on desktop, bottom full width on a
   phone. Newest in front, older ones scaled and offset behind, the stack
   fans out on hover/focus. Click, swipe or the close button dismisses.
   Identical messages within 4 s show once. Max 3 visible.

   Also catches uncaught errors and rejected promises and shows a generic,
   translated message (never the stack or a server body). Noise is ignored:
   ResizeObserver loops, cross-origin "Script error.", extension scripts,
   aborted requests.

   Styles use the Atelye tokens (assets/atelye.css) with fallbacks and are
   injected once. The admin panel has its own copy in admin/assets/ui.js
   on purpose (separate design systems).
================================================================ */
'use strict';
(function () {
  if (window.LOOM_TOAST) return;

  var MAX = 3, GAP = 8, PEEK = 12, DEDUPE_MS = 4000, EXIT_MS = 250;

  var STR = {
    region:  { uz: 'Bildirishnomalar', ru: 'Уведомления', en: 'Notifications' },
    close:   { uz: 'Yopish', ru: 'Закрыть', en: 'Close' },
    generic: { uz: 'Nimadir noto‘g‘ri ketdi. Sahifani yangilab ko‘ring.', ru: 'Что-то пошло не так. Попробуйте обновить страницу.', en: 'Something went wrong. Try reloading the page.' },
    network: { uz: 'Server bilan aloqa yo‘q. Internetni tekshiring.', ru: 'Нет связи с сервером. Проверьте интернет.', en: 'Cannot reach the server. Check your connection.' }
  };
  function s(key) {
    var lang = 'ru';
    try { lang = (window.LOOM_I18N && window.LOOM_I18N.getLang()) || document.documentElement.lang || 'ru'; } catch (e) { /* default */ }
    return STR[key][lang] || STR[key].ru;
  }

  var ICON = {
    success: '<path d="M8 12.5l2.5 2.5L16 9.5"/>',
    error:   '<path d="M12 7.5v5.5M12 16.5v.01"/>',
    warning: '<path d="M12 8v5M12 16.5v.01"/>',
    info:    '<path d="M12 11v5.5M12 7.5v.01"/>'
  };
  function svg(kind) {
    return '<svg class="lt-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.25"/>' + ICON[kind] + '</svg>';
  }

  var CSS =
    '.lt{position:fixed;z-index:10050;right:24px;bottom:calc(24px + env(safe-area-inset-bottom,0px));width:356px;max-width:calc(100vw - 32px);height:var(--lt-hc,0);margin:0;padding:0;list-style:none;pointer-events:none}' +
    '.lt:hover,.lt:focus-within{height:var(--lt-he,0)}' +
    '.lt-item{position:absolute;right:0;bottom:0;left:0;box-sizing:border-box;display:flex;align-items:flex-start;gap:10px;padding:14px 40px 14px 14px;-webkit-tap-highlight-color:transparent;' +
      'background:var(--surface,#fff);color:var(--ink,#14171a);border-radius:var(--r-panel,12px);box-shadow:var(--e1,0 0 0 1px rgba(20,23,26,.16),0 6px 14px -6px rgba(14,18,24,.28));' +
      'font:500 14px/1.4 var(--f,system-ui,sans-serif);overflow-wrap:anywhere;pointer-events:auto;cursor:pointer;touch-action:none;user-select:none;' +
      'transform-origin:50% 100%;transform:translate(var(--lt-sx,0),calc(var(--lt-yc,0px) + var(--lt-sy,0px))) scale(var(--lt-s,1));' +
      'transition:transform 400ms cubic-bezier(.22,1,.36,1),opacity 400ms cubic-bezier(.22,1,.36,1)}' +
    '.lt:hover .lt-item,.lt:focus-within .lt-item{transform:translate(var(--lt-sx,0),calc(var(--lt-ye,0px) + var(--lt-sy,0px)))}' +
    '.lt-item.is-enter{transform:translateY(100%);opacity:0;transition:none}' +
    '.lt-item.is-leaving,.lt:hover .lt-item.is-leaving{opacity:0;transform:translate(var(--lt-sx,0),calc(var(--lt-yc,0px) + var(--lt-sy,0px) + 40%)) scale(var(--lt-s,1));transition:transform 250ms cubic-bezier(.22,1,.36,1),opacity 250ms cubic-bezier(.22,1,.36,1);pointer-events:none}' +
    '.lt-item.is-swiping{transition:none}' +
    // Collapsed, the cards behind take the front card's height and hide their text, so only clean edges peek.
    '.lt:not(:hover):not(:focus-within) .lt-item:not([data-front]){height:var(--lt-fh);overflow:hidden}' +
    '.lt-item>*{transition:opacity 400ms}' +
    '.lt:not(:hover):not(:focus-within) .lt-item:not([data-front])>*{opacity:0}' +
    '.lt-icon{flex:none;margin-top:-1px}' +
    '.lt-item[data-kind="success"] .lt-icon{color:var(--ok,#1d7a46)}' +
    '.lt-item[data-kind="error"] .lt-icon{color:var(--alert,#c4291d)}' +
    '.lt-item[data-kind="warning"] .lt-icon{color:#b26b00}' +
    '.lt-item[data-kind="info"] .lt-icon{color:var(--mut,#59616a)}' +
    '.lt-x{position:absolute;top:8px;right:8px;width:28px;height:28px;display:grid;place-items:center;padding:0;border:0;border-radius:var(--r-chip,6px);background:none;color:var(--mut,#59616a);font:inherit;font-size:18px;line-height:1;cursor:pointer}' +
    '.lt-x:hover{background:var(--surface2,#e9ecef);color:var(--ink,#14171a)}' +
    '.lt-x:focus-visible{outline:2px solid var(--ink,#14171a);outline-offset:1px}' +
    '@media (max-width:600px){.lt{right:16px;left:16px;width:auto;max-width:none;bottom:calc(16px + env(safe-area-inset-bottom,0px))}}' +
    '@media (prefers-reduced-motion:reduce){.lt-item,.lt-item.is-leaving{transition:opacity 150ms linear!important}.lt-item.is-enter{transform:none}}';

  var list = null, items = [], recent = {}, paused = false;

  function root() {
    if (!list) {
      var st = document.createElement('style');
      st.textContent = CSS;
      document.head.appendChild(st);
      list = document.createElement('ol');
      list.className = 'lt';
      list.setAttribute('aria-label', s('region'));
      list.addEventListener('mouseenter', function () { setPaused(true); });
      list.addEventListener('mouseleave', function () { setPaused(false); });
      list.addEventListener('focusin', function () { setPaused(true); });
      list.addEventListener('focusout', function (e) { if (!list.contains(e.relatedTarget)) setPaused(false); });
    }
    // In full screen only that element is drawn, so the stack goes inside it.
    var host = document.fullscreenElement || document.body;
    if (list.parentNode !== host) host.appendChild(list);
    return list;
  }

  // Collapsed: newest at 0, older ones PEEK px higher and 5% smaller each.
  // Expanded (hover/focus): a readable column, one item height + GAP apart.
  function layout() {
    var live = items.filter(function (it) { return !it.leaving; });
    // it.h: natural height, measured on insert (a back card is clamped later).
    var y = 0, front = live[0] ? live[0].h : 0;
    if (list) list.style.setProperty('--lt-fh', front + 'px');
    live.forEach(function (it, i) {
      var h = it.h, st = it.el.style;
      if (i === 0) it.el.setAttribute('data-front', ''); else it.el.removeAttribute('data-front');
      st.zIndex = String(MAX + 1 - i);
      st.setProperty('--lt-yc', (-PEEK * i) + 'px');
      st.setProperty('--lt-ye', (-y) + 'px');
      st.setProperty('--lt-s', String(1 - 0.05 * i));
      y += h + GAP;
    });
    if (!list) return;
    list.style.setProperty('--lt-hc', live.length ? (front + PEEK * Math.min(live.length - 1, MAX - 1)) + 'px' : '0px');
    list.style.setProperty('--lt-he', Math.max(0, y - GAP) + 'px');
  }

  function setPaused(p) {
    paused = p;
    items.forEach(function (it) { if (p) it.pause(); else it.resume(); });
  }

  function toast(message, kind, ms) {
    var type = ICON[kind] ? kind : 'info';
    var text = String(message == null ? '' : message);
    var key = type + '|' + text, now = Date.now();
    if (recent[key] && now - recent[key].at < DEDUPE_MS && !recent[key].item.leaving) return recent[key].item.dismiss;

    var el = document.createElement('li');
    el.className = 'lt-item is-enter';
    el.setAttribute('data-kind', type);
    el.setAttribute('data-front', ''); // unclamped, so it.h below is the natural height
    // Errors interrupt (assertive); everything else waits its turn.
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    el.setAttribute('aria-atomic', 'true');
    el.innerHTML = svg(type) + '<span class="lt-msg"></span><button type="button" class="lt-x" aria-label="' + s('close') + '">×</button>';
    el.querySelector('.lt-msg').textContent = text;

    var life = ms || (type === 'error' ? 6000 : 4000), left = life, started = 0, timer = 0;
    var it = {
      el: el, leaving: false,
      pause: function () { if (timer) { clearTimeout(timer); timer = 0; left -= Date.now() - started; } },
      resume: function () { if (!timer && !it.leaving) { started = Date.now(); timer = setTimeout(dismiss, Math.max(left, 1000)); } },
      dismiss: dismiss
    };
    function dismiss() {
      if (it.leaving) return;
      it.leaving = true;
      clearTimeout(timer);
      el.classList.add('is-leaving');
      layout();
      setTimeout(function () {
        el.remove();
        items = items.filter(function (x) { return x !== it; });
        layout();
      }, EXIT_MS + 30);
    }

    el.querySelector('.lt-x').addEventListener('click', function (e) { e.stopPropagation(); dismiss(); });
    bindSwipe(el, dismiss);

    var l = root();
    l.insertBefore(el, l.firstChild);
    it.h = el.offsetHeight;
    items.unshift(it);
    recent[key] = { at: now, item: it };
    items.filter(function (x) { return !x.leaving; }).slice(MAX).forEach(function (x) { x.dismiss(); });
    layout();
    void el.offsetHeight; // commit the start state so the entrance animates
    el.classList.remove('is-enter');
    if (!paused) it.resume();
    return dismiss;
  }

  // A tap dismisses; a drag past 45 px (any direction but up) flings it away.
  function bindSwipe(el, dismiss) {
    var x0 = 0, y0 = 0, dx = 0, dy = 0, down = false;
    el.addEventListener('pointerdown', function (e) {
      if (e.button || e.target.closest('.lt-x')) return;
      down = true; x0 = e.clientX; y0 = e.clientY; dx = dy = 0;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* old browser */ }
      el.classList.add('is-swiping');
    });
    el.addEventListener('pointermove', function (e) {
      if (!down) return;
      dx = e.clientX - x0; dy = Math.max(0, e.clientY - y0);
      var horiz = Math.abs(dx) > dy;
      el.style.setProperty('--lt-sx', horiz ? dx + 'px' : '0px');
      el.style.setProperty('--lt-sy', horiz ? '0px' : dy + 'px');
    });
    function end() {
      if (!down) return;
      down = false;
      el.classList.remove('is-swiping');
      var moved = Math.max(Math.abs(dx), dy);
      if (moved < 6 || moved > 45) { dismiss(); return; }
      el.style.setProperty('--lt-sx', '0px');
      el.style.setProperty('--lt-sy', '0px');
    }
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', function () { dx = dy = 0; down = false; el.classList.remove('is-swiping'); el.style.setProperty('--lt-sx', '0px'); el.style.setProperty('--lt-sy', '0px'); });
  }

  window.LOOM_TOAST = toast;

  // ── Global error hooks ──────────────────────────────────────────
  function noise(msg, file) {
    msg = String(msg || '');
    if (/ResizeObserver loop/i.test(msg)) return true;
    if (msg === 'Script error.' || msg === 'Script error') return true; // cross-origin, no details
    if (file && (/^(chrome|moz|safari|safari-web)-extension:/.test(file) || (file.indexOf('http') === 0 && file.indexOf(location.origin) !== 0))) return true;
    return false;
  }
  function isNetwork(r) {
    return r && r.name === 'TypeError' && /Failed to fetch|Load failed|NetworkError|Network request failed/i.test(r.message || '');
  }

  window.addEventListener('error', function (e) {
    // A failed <img>/<script>/<link> reports with the element as target; not ours to toast.
    if (e.target && e.target !== window) return;
    if (noise(e.message, e.filename)) return;
    toast(s('generic'), 'error');
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    if (r && (r.name === 'AbortError' || r.loomToasted)) return;
    if (noise(r && (r.message || r), r && r.stack && (String(r.stack).match(/(https?|[a-z-]+-extension):\/\/[^\s)]+/) || [])[0])) return;
    toast(s(isNetwork(r) ? 'network' : 'generic'), 'error');
  });
})();
