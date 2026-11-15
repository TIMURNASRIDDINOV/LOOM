/* ================================================================
   LOOM — shared address picker (Uber-style).

   One component, reused anywhere an address is captured:
     LOOM_ADDRESS.mount(container, { onChange, initial })

   UX model (what Uber/Yandex Go do):
   · search-first — autocomplete as you type (Photon/Komoot, RU labels)
   · the PIN IS FIXED at map center — the MAP moves under it; on every
     settle the pin location is reverse-geocoded (Nominatim) into a
     human address, so text and coordinates can never disagree
   · "locate me" button
   · theme-aware OpenFreeMap vector map (positron / dark), swaps live on
     theme change; attribution comes from each map's own sources
   · if OpenFreeMap does not draw, it falls back on its own to VersaTiles,
     then to plain OpenStreetMap tiles (all free, no key)

   LOOM_ADDRESS.load() fetches MapLibre GL JS (CSS + JS) on demand.
   Returns { get, set, destroy }. get() → {lat, lng, address} | null.
   mount() returns null when MapLibre is missing or WebGL is unavailable,
   so the caller can fall back to a plain address field.
================================================================ */
'use strict';
(function () {
  if (window.LOOM_ADDRESS) return;

  var TASHKENT = [69.2401, 41.2995]; // [lng, lat], MapLibre order
  var UZ_BBOX = '55.9,37.1,73.2,45.6'; // lon,lat,lon,lat — bias search to Uzbekistan
  var OSM_RASTER = {
    version: 8,
    sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>' } },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  };
  /* Tried in order; the next one takes over when the current one does not draw. */
  var PROVIDERS = [
    { light: 'https://tiles.openfreemap.org/styles/positron', dark: 'https://tiles.openfreemap.org/styles/dark' },
    { light: 'https://tiles.versatiles.org/assets/styles/gray/style.json', dark: 'https://tiles.versatiles.org/assets/styles/colorful-dark/style.json' },
    { light: OSM_RASTER, dark: OSM_RASTER }, // no dark variant
  ];
  var FALLBACK_MS = 12000;   // nothing drawn by then: try the next map
  var FALLBACK_ERRORS = 3;   // tile errors before the first full draw
  /* MapLibre 5.x is the last line with a classic-script build (6.x is ESM
     only). Verified byte-identical to the npm tarball. */
  var ML = 'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/maplibre-gl';
  var ML_JS_SRI = 'sha384-5+cfbwT0iiub6VsQAdn6yz16nr6sDiQoHx6tm4O8OVYXHYOxcffFmCJBL0dgdvGp';
  var ML_CSS_SRI = 'sha384-uTttxo/aOKbdE5RlD/SPzSDoDmNvGlUYPjONi2MN/b7c9HPSvW07OIuyP7uL6jxK';

  function hasLib() { return !!(window.maplibregl && typeof window.maplibregl.Map === 'function'); }
  var loading = null;
  function load() {
    if (hasLib()) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      /* wait for the stylesheet too, or controls land in the wrong place */
      var cssDone = new Promise(function (done) {
        var css = document.createElement('link');
        css.rel = 'stylesheet'; css.href = ML + '.css'; css.integrity = ML_CSS_SRI; css.crossOrigin = 'anonymous';
        css.onload = done; css.onerror = done;   // unstyled map beats no map
        document.head.appendChild(css);
      });
      var s = document.createElement('script');
      s.src = ML + '.js'; s.integrity = ML_JS_SRI; s.crossOrigin = 'anonymous'; s.async = true;
      s.onload = function () { cssDone.then(resolve); };
      s.onerror = function () { reject(new Error('maplibre failed to load')); };
      document.head.appendChild(s);
      // a hung CDN must not strand the customer on a map that never appears
      setTimeout(function () { if (!hasLib()) reject(new Error('maplibre timed out')); }, 12000);
    }).catch(function (e) { loading = null; throw e; });
    return loading;
  }

  function t(key, fallback) {
    try {
      var s = window.LOOM_I18N && window.LOOM_I18N.t(key);
      return s && s !== key ? s : fallback;
    } catch (e) { return fallback; }
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function debounce(fn, ms) {
    var timer = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  /* Photon (Komoot) — free geocoding autocomplete with CORS + RU labels */
  async function suggest(query) {
    /* lang=default → local names (Photon supports only default/de/en/fr;
       for Uzbekistan "default" IS the native RU/UZ street naming) */
    var url = 'https://photon.komoot.io/api/?q=' + encodeURIComponent(query) +
      '&lang=default&limit=5&bbox=' + UZ_BBOX;
    var res = await fetch(url);
    if (!res.ok) return [];
    var data = await res.json();
    return (data.features || []).map(function (f) {
      var p = f.properties || {};
      var main = [p.name, p.street, p.housenumber].filter(Boolean).join(', ');
      var sub = [p.city || p.county, p.state, p.country].filter(Boolean).join(', ');
      return {
        label: main || sub,
        sublabel: main ? sub : '',
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
      };
    });
  }

  /* Nominatim reverse — pin position → human address */
  async function reverse(lat, lng) {
    var url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ru' +
      '&lat=' + lat + '&lon=' + lng;
    var res = await fetch(url);
    if (!res.ok) return null;
    var d = await res.json();
    if (!d || !d.address) return d && d.display_name || null;
    var a = d.address;
    // Uber-style short line: street + house, then district/city
    var parts = [
      [a.road || a.pedestrian || a.residential || a.neighbourhood, a.house_number].filter(Boolean).join(', '),
      a.suburb || a.city_district || a.borough,
      a.city || a.town || a.village,
    ].filter(Boolean);
    return parts.join(', ') || d.display_name || null;
  }

  function mount(container, opts) {
    opts = opts || {};
    if (typeof container === 'string') container = document.querySelector(container);
    if (!container || !hasLib()) return null;

    var state = { lat: null, lng: null, address: '', settled: false };
    var destroyed = false;

    container.classList.add('atl-addr');
    container.innerHTML =
      '<div class="atl-addr-search">' +
        '<svg class="atl-addr-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>' +
        '<input type="text" class="atl-addr-search-input" autocomplete="off" placeholder="' +
          esc(t('addr.searchPh', 'Улица, дом — начните вводить…')) + '">' +
        '<div class="atl-addr-suggest" hidden></div>' +
      '</div>' +
      '<div class="atl-addr-map-wrap">' +
        '<div class="atl-addr-map"></div>' +
        '<div class="atl-addr-pin" aria-hidden="true">' +
          '<svg width="34" height="44" viewBox="0 0 34 44"><path d="M17 1C8.2 1 1 8.1 1 16.9 1 28.9 17 43 17 43S33 28.9 33 16.9C33 8.1 25.8 1 17 1Z" fill="var(--cta)" stroke="var(--on-cta)" stroke-width="2"/><circle cx="17" cy="17" r="5.5" fill="var(--on-cta)"/></svg>' +
        '</div>' +
        '<button type="button" class="atl-addr-locate" aria-label="' + esc(t('addr.locate', 'Моё местоположение')) + '">' +
          '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="atl-addr-line">' +
        '<span class="atl-addr-line-text" data-state="idle">' + esc(t('addr.moveMap', 'Передвиньте карту, чтобы указать точку')) + '</span>' +
      '</div>';

    var input = container.querySelector('.atl-addr-search-input');
    var suggestBox = container.querySelector('.atl-addr-suggest');
    var lineText = container.querySelector('.atl-addr-line-text');
    var mapEl = container.querySelector('.atl-addr-map');

    /* map + theme-aware style */
    var initial = opts.initial && opts.initial.lat ? [opts.initial.lng, opts.initial.lat] : TASHKENT;
    var theme = (document.documentElement.getAttribute('data-theme') === 'dark') ? 'dark' : 'light';
    var map;
    var prov = 0, drawn = false, styleReady = false, errors = 0, guard = null;
    try {
      map = new maplibregl.Map({
        container: mapEl, style: PROVIDERS[0][theme], center: initial,
        zoom: opts.initial && opts.initial.lat ? 16 : 12, maxZoom: 19,
        attributionControl: { compact: false },
        dragRotate: false, pitchWithRotate: false, touchPitch: false,
      });
    } catch (e) { container.innerHTML = ''; container.classList.remove('atl-addr'); return null; } // no WebGL
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');

    /* fallback: a map counts as working once it has drawn fully (idle) */
    function watch() {
      drawn = false; styleReady = false; errors = 0;
      clearTimeout(guard);
      guard = setTimeout(nextProvider, FALLBACK_MS);
    }
    function nextProvider() {
      if (destroyed || drawn || prov >= PROVIDERS.length - 1) return;
      prov++;
      watch();
      map.setStyle(PROVIDERS[prov][theme], { diff: false });
    }
    map.on('style.load', function () { styleReady = true; });
    map.on('idle', function () { if (!drawn) { drawn = true; clearTimeout(guard); } });
    map.on('error', function () {
      if (drawn) return;                       // a stray tile later on is not an outage
      if (!styleReady || ++errors >= FALLBACK_ERRORS) nextProvider();
    });
    watch();

    function onTheme(e) {
      var next = (e.detail && e.detail.theme) === 'dark' ? 'dark' : 'light';
      if (next === theme) return;
      theme = next;
      if (PROVIDERS[prov].light === PROVIDERS[prov].dark) return; // nothing to swap
      watch();
      map.setStyle(PROVIDERS[prov][theme], { diff: false });
    }
    window.addEventListener('loom:themechange', onTheme);

    function announce(txt, stateName) {
      lineText.textContent = txt;
      lineText.setAttribute('data-state', stateName);
    }
    function emit() {
      if (opts.onChange) opts.onChange(get());
    }

    /* centered-pin reverse geocode on map settle */
    var revSeq = 0;
    var settle = debounce(async function () {
      if (destroyed) return;
      var c = map.getCenter();
      state.lat = c.lat; state.lng = c.lng; state.settled = true;
      var seq = ++revSeq;
      announce(t('addr.locating', 'Определяем адрес…'), 'busy');
      try {
        var addr = await reverse(c.lat.toFixed(6), c.lng.toFixed(6));
        if (destroyed || seq !== revSeq) return; // stale response — a newer drag won
        state.address = addr || (c.lat.toFixed(5) + ', ' + c.lng.toFixed(5));
        announce(state.address, 'ok');
      } catch (e) {
        if (seq !== revSeq) return;
        state.address = c.lat.toFixed(5) + ', ' + c.lng.toFixed(5);
        announce(state.address, 'ok');
      }
      emit();
    }, 450);
    map.on('moveend', settle);

    /* search autocomplete */
    var lookup = debounce(async function () {
      var q = input.value.trim();
      if (q.length < 3) { suggestBox.hidden = true; suggestBox.innerHTML = ''; return; }
      try {
        var items = await suggest(q);
        if (destroyed) return;
        if (!items.length) { suggestBox.hidden = true; return; }
        suggestBox.innerHTML = items.map(function (it, i) {
          return '<button type="button" class="atl-addr-suggest-item" data-i="' + i + '">' +
            '<span>' + esc(it.label) + '</span>' +
            (it.sublabel ? '<small>' + esc(it.sublabel) + '</small>' : '') +
          '</button>';
        }).join('');
        suggestBox.hidden = false;
        suggestBox.querySelectorAll('.atl-addr-suggest-item').forEach(function (b) {
          b.addEventListener('click', function () {
            var it = items[+b.dataset.i];
            suggestBox.hidden = true;
            input.value = it.label + (it.sublabel ? ', ' + it.sublabel : '');
            map.jumpTo({ center: [it.lng, it.lat], zoom: 17 }); // fires moveend → reverse → state
          });
        });
      } catch (e) { suggestBox.hidden = true; }
    }, 350);
    input.addEventListener('input', lookup);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); var f = suggestBox.querySelector('.atl-addr-suggest-item'); if (f) f.click(); }
      if (e.key === 'Escape') suggestBox.hidden = true;
    });
    document.addEventListener('click', function (e) {
      if (!container.contains(e.target)) suggestBox.hidden = true;
    });

    /* locate me */
    container.querySelector('.atl-addr-locate').addEventListener('click', function () {
      if (!navigator.geolocation) return;
      announce(t('addr.locating', 'Определяем адрес…'), 'busy');
      navigator.geolocation.getCurrentPosition(
        function (pos) { map.jumpTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 17 }); },
        function () { announce(t('addr.geoFail', 'Не удалось определить местоположение'), 'error'); },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });

    /* fix sizing inside initially-hidden containers */
    setTimeout(function () { if (!destroyed) map.resize(); }, 60);

    if (opts.initial && opts.initial.lat) settle();

    function get() {
      return state.settled
        ? { lat: +state.lat.toFixed(6), lng: +state.lng.toFixed(6), address: state.address }
        : null;
    }
    function set(lat, lng, zoom) { map.jumpTo({ center: [lng, lat], zoom: zoom || 16 }); }
    function invalidate() { map.resize(); }
    function destroy() {
      destroyed = true;
      clearTimeout(guard);
      window.removeEventListener('loom:themechange', onTheme);
      map.remove();
      container.innerHTML = '';
    }
    return { get: get, set: set, destroy: destroy, invalidate: invalidate, map: map };
  }

  window.LOOM_ADDRESS = { mount: mount, load: load };
})();
