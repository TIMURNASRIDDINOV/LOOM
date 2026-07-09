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
  var hasGSAP = typeof window.gsap !== 'undefined';
  var hasST = hasGSAP && typeof window.ScrollTrigger !== 'undefined';

  if (hasST) gsap.registerPlugin(ScrollTrigger);

  function release() { doc.classList.remove('motion-hold'); }

  /* ── Lenis smooth scroll ─────────────────────────────────── */
  function initLenis() {
    if (reduced || !hasGSAP || typeof window.Lenis === 'undefined') return;
    if (document.body.hasAttribute('data-no-smooth')) return;
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
    el.innerHTML =
      '<span class="loader__brand">LOOM<span class="slash">/</span></span>' +
      '<div class="loader__frame">' +
      LOADER_IMAGES.map(function (src, i) {
        return '<img src="' + src + '" alt="" ' + (i ? 'loading="eager"' : '') + (i === 0 ? ' class="on"' : '') + '>';
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
    tl.to(count, {
      v: 100, duration: 1.7, ease: 'power2.inOut',
      onUpdate: function () {
        countEl.textContent = String(Math.round(count.v)).padStart(3, '0');
      }
    }, 0);
    tl.to(el.querySelector('.loader__bar'), { scaleX: 1, duration: 1.7, ease: 'power2.inOut' }, 0);
    tl.to(el.querySelector('.loader__frame'), { opacity: 0, y: -14, duration: 0.3, ease: 'power2.in' }, 1.75);
    tl.to(el, { yPercent: -100, duration: 0.65, ease: 'expo.inOut' }, 1.95);
  }

  /* ── Page transitions: a fast fade-out, nothing more.
     (A full-screen cover panel read as a bug — removed.) ────── */
  function initTransitions() {
    if (reduced || !hasGSAP) return;

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
      gsap.to(document.body, {
        opacity: 0, duration: 0.16, ease: 'power1.out',
        onComplete: function () { location.href = url.href; }
      });
    });

    /* bfcache restore: never come back faded out */
    window.addEventListener('pageshow', function (e) {
      if (e.persisted) { gsap.set(document.body, { opacity: 1 }); release(); }
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
    if (hasST && group.getBoundingClientRect().top > window.innerHeight * 0.92) {
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
    if (reduced || !hasGSAP) return;
    document.querySelectorAll('[data-stagger]').forEach(function (g) {
      delete g.dataset.staggerBound;
    });
    document.querySelectorAll('.product-grid').forEach(function (grid) {
      if (grid.dataset.staggerBound) return;
      grid.dataset.staggerBound = '1';
      gsap.fromTo(grid.children, { y: 26, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.7, ease: 'expo.out', stagger: 0.06, clearProps: 'transform,opacity' });
    });
    if (hasST) ScrollTrigger.refresh();
  };

  /* ── Marquee: duplicate content until track ≥ 2× viewport ── */
  function initMarquees() {
    document.querySelectorAll('.marquee__track').forEach(function (track) {
      if (track.dataset.marqueeDone) return;
      track.dataset.marqueeDone = '1';
      var original = track.innerHTML;
      var safety = 0;
      while (track.scrollWidth < window.innerWidth * 2 && safety < 12) {
        track.innerHTML += original;
        safety++;
      }
      /* constant speed regardless of content length (~90 px/s) */
      var dur = Math.max(14, Math.round(track.scrollWidth / 2 / 90));
      track.style.setProperty('--marquee-dur', dur + 's');
    });
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

  /* release() must always run, even with no GSAP or reduced motion */
  if (reduced || !hasGSAP) release();

  if (document.readyState === 'loading') {
    /* registered after i18n.js's own listener → runs after translations apply */
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* absolute failsafe */
  window.addEventListener('load', release);
})();
