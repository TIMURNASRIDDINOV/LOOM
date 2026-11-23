/* ================================================================
   LOOM — Vaul-style drag for bottom sheets (LOOM-374).

   window.LOOM_SHEET.attach(panel, opts) makes a bottom sheet follow
   the finger 1:1 from anywhere on it, the way https://vaul.emilkowal.ski
   does, in plain JS. The sheet keeps its own open/close classes and
   CSS transitions; this only drives it while a finger is down and
   then hands the release back to CSS (the sheet's transition should
   use Vaul's curve: 500ms cubic-bezier(0.32, 0.72, 0, 1)).

   opts:
     onClose()        dismiss mode: called on release past 25% of the
                      height or a fast downward flick; otherwise the
                      sheet springs back. Upward drag rubber-bands.
     backdrop         dismiss mode: its opacity follows the drag.
     snap             snap mode instead of dismiss: { levels() →
                      [{ name, px }] low to high, current() → name,
                      set(name) }. The drag changes the height; release
                      lands on the nearest level, or the next one in
                      the flick's direction. Never dismisses.
     scroller         inner scroll box: a drag on it scrolls while it is
                      scrolled away from the top (or, in snap mode, while
                      the sheet is at its top level and the drag is up).
     enabled()        optional; false = leave the gesture alone.

   Inputs, selects, textareas and [data-sheet-no-drag] never start a
   drag. A drag that moved swallows the click that follows it.
================================================================ */
'use strict';
(function () {
  if (window.LOOM_SHEET) return;
  var NO_DRAG = 'input, textarea, select, [contenteditable], [data-sheet-no-drag]';
  var FLICK = 0.4; // px per ms, Vaul's velocity threshold

  // Past the edge the sheet moves less and less (log curve).
  function rubber(d) { return 12 * Math.log1p(d / 12); }

  function attach(panel, opts) {
    opts = opts || {};
    var snap = opts.snap, scroller = opts.scroller;
    var g = null; // the gesture while a pointer is down
    var swallow = 0; // when the last drag ended

    function owns(dx, dy, target) {
      if (Math.abs(dx) > Math.abs(dy)) return false; // horizontal rows keep their scroll
      if (!scroller || !scroller.contains(target)) return true;
      if (dy > 0) return scroller.scrollTop <= 0;
      if (!snap) return false;
      var lv = snap.levels();
      return snap.current() !== lv[lv.length - 1].name; // grow first, then scroll
    }

    function down(e) {
      if (g || e.button > 0 || (opts.enabled && !opts.enabled())) return;
      if (e.target.closest && e.target.closest(NO_DRAG)) return;
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, on: null, h: panel.getBoundingClientRect().height, pts: [] };
    }

    function decide(x, y, target) {
      if (g.on !== null) return g.on;
      var dx = x - g.x, dy = y - g.y;
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return false;
      g.on = owns(dx, dy, target);
      if (g.on) {
        g.y = y; // start from here, so the sheet does not jump the slop
        panel.style.transition = 'none';
        panel.style.userSelect = 'none';
        if (opts.backdrop) opts.backdrop.style.transition = 'none';
      }
      return g.on;
    }

    function move(e) {
      if (!g || e.pointerId !== g.id || !decide(e.clientX, e.clientY, e.target)) return;
      var dy = e.clientY - g.y;
      g.pts.push([e.timeStamp, dy]);
      if (g.pts.length > 5) g.pts.shift();
      if (snap) {
        var lv = snap.levels(), lo = lv[0].px, hi = lv[lv.length - 1].px;
        var h = g.h - dy;
        if (h > hi) h = hi + rubber(h - hi);
        else if (h < lo) h = lo - rubber(lo - h);
        panel.style.height = h + 'px';
      } else {
        panel.style.transform = 'translateY(' + (dy >= 0 ? dy : -rubber(-dy)) + 'px)';
        if (opts.backdrop) opts.backdrop.style.opacity = String(Math.max(0, 1 - dy / g.h));
      }
    }

    function up(e) {
      if (!g || e.pointerId !== g.id) return;
      var was = g;
      g = null;
      if (!was.on) return;
      swallow = Date.now();
      var p = was.pts, last = p[p.length - 1] || [0, 0], first = p[0] || last;
      var dt = last[0] - first[0];
      var v = dt > 0 ? (last[1] - first[1]) / dt : 0; // px per ms, down is +
      var dy = last[1];
      panel.style.transition = panel.style.userSelect = '';
      if (opts.backdrop) opts.backdrop.style.transition = '';
      if (snap) {
        var lv = snap.levels(), h = was.h - dy, i = 0, cur = 0;
        lv.forEach(function (l, j) {
          if (Math.abs(l.px - h) < Math.abs(lv[i].px - h)) i = j;
          if (l.name === snap.current()) cur = j;
        });
        if (Math.abs(v) > FLICK) i = Math.max(0, Math.min(lv.length - 1, cur + (v > 0 ? -1 : 1)));
        panel.style.height = '';
        snap.set(lv[i].name);
        return;
      }
      panel.style.transform = '';
      if (opts.backdrop) opts.backdrop.style.opacity = '';
      if (e.type !== 'pointercancel' && (dy > was.h * 0.25 || v > FLICK)) opts.onClose && opts.onClose();
    }

    panel.addEventListener('pointerdown', down);
    // On window: a mouse that leaves the sheet mid-drag keeps driving it.
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    // Touch: claim the gesture before the browser starts a scroll (which would
    // cancel the pointer). Only when the sheet owns it; inner scroll stays native.
    panel.addEventListener('touchmove', function (e) {
      var t = e.touches[0];
      if (g && t && e.cancelable && decide(t.clientX, t.clientY, e.target)) e.preventDefault();
    }, { passive: false });
    panel.addEventListener('click', function (e) {
      if (Date.now() - swallow > 400) return;
      swallow = 0;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }

  window.LOOM_SHEET = { attach: attach };
})();
