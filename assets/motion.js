/* ================================================================
   LOOM — Shared motion system (GSAP + ScrollTrigger + Lenis, all CDN)
   One file drives every page:

   · Lenis smooth scrolling            (skip: body[data-no-smooth])
   · Session-once preloader            (opt-in: body[data-preloader])
   · Page-transition veil (cover → navigate → reveal)
   · Masked line reveals               [data-reveal="mask"]
   · Fade-up reveals                   [data-reveal]
   · Staggered grid entrances          [data-stagger]
   · Seamless marquee                  .marquee
   · Magnetic hover on CTAs            .magnetic

   Progressive enhancement rules:
   - Content is NEVER hidden by CSS; initial states are set from JS
     right before animating, so a failed CDN just means "no motion".
   - prefers-reduced-motion disables everything.
   - Masks wrap AROUND [data-i18n] nodes so the language switcher can
     rewrite text without destroying animation structure.
================================================================ */
'use strict';
(function () {
  if (window.__loomMotionBound) return;
  window.__loomMotionBound = true;

  var INTRO_KEY = 'loom_intro_v1';
  var doc = document.documentElement;

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarse = window.matchMedia('(pointer: coarse)').matches;
  var hasGSAP = typeof window.gsap !== 'undefined';
  var hasST = hasGSAP && typeof window.ScrollTrigger !== 'undefined';

  if (hasST) gsap.registerPlugin(ScrollTrigger);

  function release() { doc.classList.remove('motion-hold'); }

  /* ── Lenis smooth scroll ─────────────────────────────────── */
  function initLenis() {
    if (reduced || !hasGSAP || typeof window.Lenis === 'undefined') return;
    if (document.body.hasAttribute('data-no-smooth')) return;
    /* touch scrolling is already native momentum — Lenis would only
       add a permanent per-frame rAF tax (and lagSmoothing(0) globally) */
    if (!window.matchMedia('(pointer: fine)').matches) return;
    var lenis = new Lenis({ lerp: 0.11, wheelMultiplier: 1 });
    lenis.on('scroll', function () { if (hasST) ScrollTrigger.update(); });
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
    window.LOOM_LENIS = lenis;
  }

  /* ── Preloader (000 → 100 over the product sequence) ─────── */
  var LOADER_IMAGES = [
    'products/tshirt_regular_white_001.jpg',
    'products/hoodie_regular_white_001.jpg',
    'products/polo_regular_white_001.jpg',
    'products/sweatshirt_regular_white_001.jpg',
    'products/cap_regular_white_001.jpg',
    'products/tshirt_muscle_white_001.jpg'
  ];

  function wantsIntro() {
    if (reduced || !hasGSAP) return false;
    if (!document.body.hasAttribute('data-preloader')) return false;
    try { return !sessionStorage.getItem(INTRO_KEY); } catch (e) { return false; }
  }

  function runIntro(done) {
    try { sessionStorage.setItem(INTRO_KEY, '1'); } catch (e) {}
    window.scrollTo(0, 0); /* the intro always reveals from the top */

    var el = document.createElement('div');
    el.className = 'loader';
    el.setAttribute('aria-hidden', 'true');
    /* phones: fewer frames, less data, shorter hold — same choreography */
    var frames = coarse ? LOADER_IMAGES.slice(0, 4) : LOADER_IMAGES;
    el.innerHTML =
      '<span class="loader__brand">LOOM<span class="slash">/</span></span>' +
      '<div class="loader__frame">' +
      frames.map(function (src, i) {
        return '<img src="' + src + '" alt="" decoding="async"' + (i === 0 ? ' class="on"' : '') + '>';
      }).join('') +
      '</div>' +
      '<span class="loader__count">000</span>' +
      '<span class="loader__bar"></span>';
    document.body.appendChild(el);
    release(); /* loader now covers the page — safe to show body */

    var count = { v: 0 };
    var countEl = el.querySelector('.loader__count');
    var imgs = el.querySelectorAll('.loader__frame img');
    var idx = 0;
    var flip = setInterval(function () {
      imgs[idx].classList.remove('on');
      idx = (idx + 1) % imgs.length;
      imgs[idx].classList.add('on');
    }, 240);

    var tl = gsap.timeline({
      onComplete: function () {
        clearInterval(flip);
        el.remove();
        done();
      }
    });
    var D = coarse ? 1.1 : 1.7; /* count duration — mobile waits less */
    tl.to(count, {
      v: 100, duration: D, ease: 'power2.inOut',
      onUpdate: function () {
        countEl.textContent = String(Math.round(count.v)).padStart(3, '0');
      }
    }, 0);
    tl.to(el.querySelector('.loader__bar'), { scaleX: 1, duration: D, ease: 'power2.inOut' }, 0);
    tl.to(el.querySelector('.loader__frame'), { opacity: 0, y: -14, duration: 0.3, ease: 'power2.in' }, D + 0.05);
    tl.to(el, { yPercent: -100, duration: 0.65, ease: 'expo.inOut' }, D + 0.25);
  }

  /* ── Page transitions: accent curtain wipe (reference-style).
     Leaving: a red curtain wipes UP from the bottom (clip-path),
     then the browser navigates. Arriving: boot.js pre-painted the
     cover via html.page-covered::after, and we wipe it off through
     the top. Both legs ~0.5s, eased. ─────────────────────────── */
  var WIPE_KEY = 'loom_wipe';
  var activeWipe = null; /* leave-leg state: { el, tween, cancelled } */

  function initTransitions() {
    if (reduced || !hasGSAP) return;

    /* arrival leg — the cover is already painted; lift it */
    if (doc.classList.contains('page-covered')) {
      /* we own the cleanup now — stop boot.js's blunt failsafe from
         yanking the cover away mid-animation on slow (cold-CDN) loads */
      if (window.__loomCoverFailsafe) {
        clearTimeout(window.__loomCoverFailsafe);
        window.__loomCoverFailsafe = null;
      }
      release();
      /* double-rAF: let the first frame paint fully covered */
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          doc.classList.add('page-reveal');
          /* theme.css shortens the reveal to 0.38s on coarse pointers */
          setTimeout(function () {
            doc.classList.remove('page-covered', 'page-reveal');
          }, coarse ? 450 : 700);
        });
      });
    }

    /* leave leg */
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#' || a.target === '_blank' || a.hasAttribute('download')) return;
      if (/^(https?:|mailto:|tel:)/i.test(href) && a.host !== location.host) return;
      var url = new URL(href, location.href);
      if (url.pathname === location.pathname && url.hash) return; /* same-page anchor */

      e.preventDefault();
      var w = document.createElement('div');
      w.className = 'wipe';
      w.setAttribute('aria-hidden', 'true');
      document.body.appendChild(w);
      try { sessionStorage.setItem(WIPE_KEY, '1'); } catch (err) {}
      var state = { el: w, cancelled: false };
      gsap.set(w, { clipPath: 'inset(100% 0% 0% 0%)' });
      state.tween = gsap.to(w, {
        clipPath: 'inset(0% 0% 0% 0%)',
        /* every tap pays this toll before the request even starts —
           keep it snappy on touch */
        duration: coarse ? 0.28 : 0.5,
        ease: coarse ? 'power1.in' : 'power2.in',
        onComplete: function () {
          if (state.cancelled) return;
          location.href = url.href;
          /* if the navigation never happens (Esc / stop button /
             offline), do not leave the page under an opaque curtain */
          setTimeout(function () {
            state.cancelled = true;
            w.remove();
            try { sessionStorage.removeItem(WIPE_KEY); } catch (err) {}
          }, coarse ? 1500 : 3000);
        }
      });
      activeWipe = state;
    });

    /* bfcache restore: never come back covered, and kill the frozen
       tween — otherwise its onComplete re-fires and force-navigates */
    window.addEventListener('pageshow', function (e) {
      if (e.persisted) {
        if (activeWipe) {
          activeWipe.cancelled = true;
          if (activeWipe.tween) activeWipe.tween.kill();
          activeWipe = null;
        }
        document.querySelectorAll('.wipe').forEach(function (el) { el.remove(); });
        doc.classList.remove('page-covered', 'page-reveal');
        try { sessionStorage.removeItem(WIPE_KEY); } catch (err) {}
        release();
      }
    });
  }

  /* ── Reveals ─────────────────────────────────────────────── */
  /* Wrap each direct child of [data-reveal="mask"] in an overflow-hidden
     line, keeping the child (and its data-i18n) intact inside. */
  function splitMask(el) {
    if (el.dataset.maskDone) return [];
    el.dataset.maskDone = '1';
    var lines = [];
    Array.prototype.slice.call(el.children).forEach(function (child) {
      var wrap = document.createElement('span');
      wrap.className = 'mask-line';
      child.parentNode.insertBefore(wrap, child);
      wrap.appendChild(child);
      lines.push(child);
    });
    return lines;
  }

  function revealNow(targets, opts) {
    gsap.fromTo(targets,
      { yPercent: opts.mask ? 130 : 0, y: opts.mask ? 0 : 26, opacity: opts.mask ? 1 : 0 },
      {
        yPercent: 0, y: 0, opacity: 1,
        duration: opts.mask ? 0.95 : 0.8,
        ease: 'expo.out',
        stagger: opts.stagger || 0,
        delay: opts.delay || 0,
        clearProps: 'transform,opacity',
        onComplete: function () {
          /* drop the clipping once revealed — overflow:hidden would keep
             shaving Cyrillic descenders (р, у, д) off the settled text */
          targets.forEach(function (t) {
            if (t.parentElement && t.parentElement.classList.contains('mask-line')) {
              t.parentElement.style.overflow = 'visible';
            }
          });
        }
      });
  }

  function bindReveal(el, delay) {
    if (el.dataset.revealBound) return;
    el.dataset.revealBound = '1';

    var mask = el.getAttribute('data-reveal') === 'mask';
    var targets = mask ? splitMask(el) : [el];
    if (!targets.length) targets = [el];

    var opts = { mask: mask, stagger: mask ? 0.09 : 0, delay: delay || parseFloat(el.getAttribute('data-delay') || 0) };

    /* above the fold → play immediately (after intro); below → on scroll */
    var rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.9) {
      revealNow(targets, opts);
    } else if (hasST) {
      gsap.set(targets, mask ? { yPercent: 130 } : { y: 26, opacity: 0 });
      ScrollTrigger.create({
        trigger: el, start: 'top 88%', once: true,
        onEnter: function () { revealNow(targets, { mask: mask, stagger: opts.stagger }); }
      });
    } else {
      revealNow(targets, opts);
    }
  }

  function bindStagger(group) {
    if (group.dataset.staggerBound) return;
    group.dataset.staggerBound = '1';
    var kids = Array.prototype.slice.call(group.children);
    if (!kids.length) return;
    /* narrow screens collapse grids to one column ~3 viewports tall —
       one group trigger would run cards long before they are seen;
       give each row its own entrance instead */
    if (hasST && window.matchMedia('(max-width: 640px)').matches) {
      gsap.set(kids, { y: 30, opacity: 0 });
      ScrollTrigger.batch(kids, {
        start: 'top 92%', once: true,
        onEnter: function (batch) {
          gsap.to(batch, { y: 0, opacity: 1, duration: 0.6, ease: 'expo.out', stagger: 0.07, clearProps: 'transform,opacity' });
        }
      });
    } else if (hasST && group.getBoundingClientRect().top > window.innerHeight * 0.92) {
      gsap.set(kids, { y: 30, opacity: 0 });
      ScrollTrigger.create({
        trigger: group, start: 'top 86%', once: true,
        onEnter: function () {
          gsap.to(kids, { y: 0, opacity: 1, duration: 0.75, ease: 'expo.out', stagger: 0.07, clearProps: 'transform,opacity' });
        }
      });
    } else {
      gsap.fromTo(kids, { y: 30, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.75, ease: 'expo.out', stagger: 0.07, clearProps: 'transform,opacity' });
    }
  }

  function initReveals() {
    if (reduced || !hasGSAP) return;
    document.querySelectorAll('[data-reveal]').forEach(function (el) { bindReveal(el); });
    document.querySelectorAll('[data-stagger]').forEach(bindStagger);
  }

  /* Catalog cards render after an API fetch — this hook re-scans.
     (products-catalog.js already calls window._initReveal.) */
  window._initReveal = function () {
    initCardMedia(); /* re-scan API-rendered cards for second photos */
    if (reduced || !hasGSAP) return;
    document.querySelectorAll('[data-stagger]').forEach(function (g) {
      delete g.dataset.staggerBound;
    });
    document.querySelectorAll('.product-grid').forEach(function (grid) {
      if (grid.dataset.staggerBound) return;
      grid.dataset.staggerBound = '1';
      var kids = Array.prototype.slice.call(grid.children);
      if (!kids.length) return;
      if (hasST) {
        /* per-row entrances — animating the whole grid at once plays
           most cards offscreen (especially in the 1-col mobile layout) */
        gsap.set(kids, { y: 26, opacity: 0 });
        ScrollTrigger.batch(kids, {
          start: 'top 92%', once: true,
          onEnter: function (batch) {
            gsap.to(batch, { y: 0, opacity: 1, duration: 0.7, ease: 'expo.out', stagger: 0.06, clearProps: 'transform,opacity' });
          }
        });
      } else {
        gsap.fromTo(kids, { y: 26, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.7, ease: 'expo.out', stagger: 0.06, clearProps: 'transform,opacity' });
      }
    });
    if (hasST) ScrollTrigger.refresh();
  };

  /* ── Marquee ─────────────────────────────────────────────── */
  function initMarquees() {
    document.querySelectorAll('.marquee__track').forEach(function (track) {
      if (track.dataset.marqueeDone) return;
      track.dataset.marqueeDone = '1';
      /* fill to ≥ 1× viewport, then mirror the whole thing once — the
         two identical halves make the -50% keyframe loop seamless
         (an odd number of copies would visibly jump at each restart) */
      var original = track.innerHTML;
      var safety = 0;
      while (track.scrollWidth < window.innerWidth && safety < 12) {
        track.innerHTML += original;
        safety++;
      }
      track.innerHTML += track.innerHTML;
      /* constant speed regardless of content length (~90 px/s) */
      var dur = Math.max(14, Math.round(track.scrollWidth / 2 / 90));
      track.style.setProperty('--marquee-dur', dur + 's');
    });
    /* don't burn frames while offscreen */
    if ('IntersectionObserver' in window) {
      var mio = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var t = en.target.querySelector('.marquee__track');
          if (t) t.style.animationPlayState = en.isIntersecting ? 'running' : 'paused';
        });
      });
      document.querySelectorAll('.marquee').forEach(function (m) { mio.observe(m); });
    }
  }

  /* ── Product-card second photo ───────────────────────────────
     Markup ships <img data-src> so the bytes are only spent where
     they can be seen. Hover-capable: hydrate for the hover swap.
     Touch: hydrate lazily near the viewport, then crossfade to the
     on-model shot after a beat (theme.css .swap, hover:none only). */
  function initCardMedia() {
    var hoverable = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (hoverable) {
      document.querySelectorAll('.pcard__media-alt img[data-src]').forEach(function (img) {
        img.loading = 'lazy'; img.decoding = 'async';
        img.src = img.dataset.src; img.removeAttribute('data-src');
      });
      return;
    }
    if (reduced || !('IntersectionObserver' in window)) return;
    if (!window.__loomSwapIO) {
      window.__loomSwapIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var media = en.target;
          if (en.isIntersecting) {
            var img = media.querySelector('.pcard__media-alt img[data-src]');
            if (img) { img.decoding = 'async'; img.src = img.dataset.src; img.removeAttribute('data-src'); }
            media.__swapTimer = setTimeout(function () { media.classList.add('swap'); }, 1600);
          } else {
            clearTimeout(media.__swapTimer);
            media.classList.remove('swap');
          }
        });
      }, { threshold: 0.65 });
    }
    document.querySelectorAll('.pcard__media, .product-card__image-container').forEach(function (media) {
      if (media.dataset.swapBound) return;
      /* only tiles that actually carry a second photo */
      if (!media.querySelector('.pcard__media-alt img')) return;
      media.dataset.swapBound = '1';
      window.__loomSwapIO.observe(media);
    });
  }

  /* ── Custom cursor (pointer: fine only) ──────────────────── */
  /* Reference-style: the NATIVE cursor stays visible; a small accent
     dot trails behind it, grows over interactive elements, and fades
     out when the pointer is idle or leaves the window. Native-only
     zones: text fields, maps. Opt out per page: <body data-no-cursor>. */
  function initCursor() {
    if (reduced || !hasGSAP) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    if (document.body.hasAttribute('data-no-cursor')) return;

    var c = document.createElement('div');
    c.className = 'cursor';
    c.setAttribute('aria-hidden', 'true');
    document.body.appendChild(c);

    gsap.set(c, { xPercent: -50, yPercent: -50, scale: 0.34 });
    /* the lag is the point — the dot visibly follows behind the pointer */
    var xTo = gsap.quickTo(c, 'x', { duration: 0.35, ease: 'power3.out' });
    var yTo = gsap.quickTo(c, 'y', { duration: 0.35, ease: 'power3.out' });
    var sTo = gsap.quickTo(c, 'scale', { duration: 0.25, ease: 'power3.out' });

    /* Pointer events, capture phase:
       - compat mouse events are suppressed while canvas tools
         (OrbitControls / decal editor) preventDefault their drags;
         pointermove is not, and capture beats stopPropagation
       - pointerType filter keeps touch taps on hybrid laptops from
         summoning a phantom dot */
    var idleTimer = null;
    var firstMove = true;
    document.addEventListener('pointermove', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      if (firstMove) {
        /* appear where the pointer already is — no streak from 0,0 */
        firstMove = false;
        gsap.set(c, { x: e.clientX, y: e.clientY });
      } else {
        xTo(e.clientX); yTo(e.clientY);
      }
      c.classList.add('cursor--on');
      c.classList.remove('cursor--idle');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () { c.classList.add('cursor--idle'); }, 1800);
    }, { passive: true, capture: true });

    document.addEventListener('pointerover', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      var t = e.target;
      if (!t || !t.closest) return;
      /* text fields & maps: follower gets out of the way */
      if (t.closest('input, textarea, select, .leaflet-container, [data-cursor="native"]')) {
        c.classList.add('cursor--hide');
        return;
      }
      c.classList.remove('cursor--hide');
      if (t.closest('.pcard, .product-card__image-container')) {
        c.classList.add('cursor--grow');
        sTo(1);
      } else if (t.closest('a, button, [role="button"], label')) {
        c.classList.add('cursor--grow');
        sTo(0.8);
      } else {
        c.classList.remove('cursor--grow');
        sTo(0.34);
      }
    }, { capture: true });

    /* window re-entry: the next pointerover re-evaluates hide state,
       so no unconditional un-hide here (it would expose the dot over
       a text field the pointer lands on) */
    doc.addEventListener('mouseleave', function () { c.classList.add('cursor--hide'); });
  }

  /* ── Magnetic hover (pointer: fine only) ─────────────────── */
  function initMagnetic() {
    if (reduced || !hasGSAP) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    document.querySelectorAll('.magnetic').forEach(function (el) {
      var xTo = gsap.quickTo(el, 'x', { duration: 0.35, ease: 'power3.out' });
      var yTo = gsap.quickTo(el, 'y', { duration: 0.35, ease: 'power3.out' });
      el.addEventListener('mousemove', function (e) {
        var r = el.getBoundingClientRect();
        xTo((e.clientX - (r.left + r.width / 2)) * 0.3);
        yTo((e.clientY - (r.top + r.height / 2)) * 0.3);
      });
      el.addEventListener('mouseleave', function () { xTo(0); yTo(0); });
    });
  }

  /* ── Boot ────────────────────────────────────────────────── */
  function init() {
    initLenis();
    initMarquees();
    initMagnetic();
    initCursor();
    initCardMedia();

    initTransitions();

    if (wantsIntro()) {
      /* postpone hero reveal until the loader lifts */
      document.querySelectorAll('[data-reveal],[data-stagger]').forEach(function (el) {
        if (el.getBoundingClientRect().top < window.innerHeight && hasGSAP) {
          gsap.set(el.getAttribute('data-stagger') !== null ? el.children : el, { opacity: 0 });
        }
      });
      runIntro(function () {
        document.querySelectorAll('[data-reveal],[data-stagger]').forEach(function (el) {
          gsap.set(el.getAttribute('data-stagger') !== null ? el.children : el, { clearProps: 'opacity' });
        });
        initReveals();
      });
    } else {
      release();
      initReveals();
    }
  }

  /* release() must always run, even with no GSAP or reduced motion —
     and a pre-painted transition cover must never stick around */
  if (reduced || !hasGSAP) {
    release();
    doc.classList.remove('page-covered', 'page-reveal');
  }

  if (document.readyState === 'loading') {
    /* registered after i18n.js's own listener → runs after translations apply */
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* absolute failsafe + recalc scroll-trigger positions once images load */
  window.addEventListener('load', function () {
    release();
    if (hasST && !reduced) ScrollTrigger.refresh();
  });
})();
