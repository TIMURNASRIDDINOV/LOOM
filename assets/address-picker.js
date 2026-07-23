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
   · theme-aware tiles (CARTO light/dark), swaps live on theme change

   Returns { get, set, destroy }. get() → {lat, lng, address} | null.
   Requires Leaflet (CSS+JS) on the page.
================================================================ */
'use strict';
(function () {
  if (window.LOOM_ADDRESS) return;

  var TASHKENT = [41.2995, 69.2401];
  var UZ_BBOX = '55.9,37.1,73.2,45.6'; // lon,lat,lon,lat — bias search to Uzbekistan
  var TILES = {
    light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  };
  var TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

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
    /* feature-test Leaflet rather than just `typeof L` — the Lenis UMD
       bundle publishes its own global `L`, which would sail past a bare
       existence check and then blow up on L.map(). Returning null lets
       the caller degrade to a plain address field. */
    if (!container) return null;
    if (!window.L || typeof window.L.map !== 'function' || typeof window.L.tileLayer !== 'function') return null;

    var state = { lat: null, lng: null, address: '', settled: false };
    var destroyed = false;

    container.classList.add('addr-picker');
    container.innerHTML =
      '<div class="addr-search">' +
        '<svg class="addr-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>' +
        '<input type="text" class="addr-search-input" autocomplete="off" placeholder="' +
          esc(t('addr.searchPh', 'Улица, дом — начните вводить…')) + '">' +
        '<div class="addr-suggest" hidden></div>' +
      '</div>' +
      '<div class="addr-map-wrap">' +
        '<div class="addr-map"></div>' +
        '<div class="addr-pin" aria-hidden="true">' +
          '<svg width="34" height="44" viewBox="0 0 34 44"><path d="M17 1C8.2 1 1 8.1 1 16.9 1 28.9 17 43 17 43S33 28.9 33 16.9C33 8.1 25.8 1 17 1Z" fill="var(--accent, #fc5044)" stroke="var(--on-accent, #fff)" stroke-width="2"/><circle cx="17" cy="17" r="5.5" fill="var(--on-accent, #fff)"/></svg>' +
        '</div>' +
        '<button type="button" class="addr-locate" aria-label="' + esc(t('addr.locate', 'Моё местоположение')) + '">' +
          '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="addr-line">' +
        '<span class="addr-line-text" data-state="idle">' + esc(t('addr.moveMap', 'Передвиньте карту, чтобы указать точку')) + '</span>' +
      '</div>';

    var input = container.querySelector('.addr-search-input');
    var suggestBox = container.querySelector('.addr-suggest');
    var lineText = container.querySelector('.addr-line-text');
    var mapEl = container.querySelector('.addr-map');

    /* map + theme-aware tiles */
    var initial = opts.initial && opts.initial.lat ? [opts.initial.lat, opts.initial.lng] : TASHKENT;
    var map = L.map(mapEl, { center: initial, zoom: opts.initial && opts.initial.lat ? 16 : 12, zoomControl: true, attributionControl: true });
    map.attributionControl.setPrefix(false);
    var theme = (document.documentElement.getAttribute('data-theme') === 'dark') ? 'dark' : 'light';
    var tiles = L.tileLayer(TILES[theme], { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);
    function onTheme(e) {
      var next = (e.detail && e.detail.theme) === 'dark' ? 'dark' : 'light';
      tiles.setUrl(TILES[next]);
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
          return '<button type="button" class="addr-suggest-item" data-i="' + i + '">' +
            '<span>' + esc(it.label) + '</span>' +
            (it.sublabel ? '<small>' + esc(it.sublabel) + '</small>' : '') +
          '</button>';
        }).join('');
        suggestBox.hidden = false;
        suggestBox.querySelectorAll('.addr-suggest-item').forEach(function (b) {
          b.addEventListener('click', function () {
            var it = items[+b.dataset.i];
            suggestBox.hidden = true;
            input.value = it.label + (it.sublabel ? ', ' + it.sublabel : '');
            map.setView([it.lat, it.lng], 17); // fires moveend → reverse → state
          });
        });
      } catch (e) { suggestBox.hidden = true; }
    }, 350);
    input.addEventListener('input', lookup);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); var f = suggestBox.querySelector('.addr-suggest-item'); if (f) f.click(); }
      if (e.key === 'Escape') suggestBox.hidden = true;
    });
    document.addEventListener('click', function (e) {
      if (!container.contains(e.target)) suggestBox.hidden = true;
    });

    /* locate me */
    container.querySelector('.addr-locate').addEventListener('click', function () {
      if (!navigator.geolocation) return;
      announce(t('addr.locating', 'Определяем адрес…'), 'busy');
      navigator.geolocation.getCurrentPosition(
        function (pos) { map.setView([pos.coords.latitude, pos.coords.longitude], 17); },
        function () { announce(t('addr.geoFail', 'Не удалось определить местоположение'), 'error'); },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });

    /* fix Leaflet sizing inside initially-hidden containers */
    setTimeout(function () { map.invalidateSize(); }, 60);

    if (opts.initial && opts.initial.lat) settle();

    function get() {
      return state.settled
        ? { lat: +state.lat.toFixed(6), lng: +state.lng.toFixed(6), address: state.address }
        : null;
    }
    function set(lat, lng, zoom) { map.setView([lat, lng], zoom || 16); }
    function invalidate() { map.invalidateSize(); }
    function destroy() {
      destroyed = true;
      window.removeEventListener('loom:themechange', onTheme);
      map.remove();
      container.innerHTML = '';
    }
    return { get: get, set: set, destroy: destroy, invalidate: invalidate, map: map };
  }

  window.LOOM_ADDRESS = { mount: mount };
})();
