import { C } from '../theme/tokens'

// The Leaflet + OpenStreetMap page behind the delivery-pin picker, shared by
// the native WebView and the web <iframe>. Same stack as the website's
// address picker (assets/address-picker.js): no API key, no billing account,
// and couriers get coordinates in the same shape web orders already carry.

const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist'
// Tashkent, matching the web picker's default centre.
const DEFAULT = { lat: 41.2995, lng: 69.2401 }

export type Pin = { lat: number; lng: number; address?: string }

export function buildMapHtml(initial: Pin | null): string {
  const start = initial ?? DEFAULT
  const zoom = initial ? 16 : 12

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="${LEAFLET}/leaflet.css">
<script src="${LEAFLET}/leaflet.js"></script>
<style>
  html,body,#map{margin:0;height:100%;width:100%;background:#ebe8e1}
  .leaflet-control-attribution{font-size:9px}
  /* The coral pin, drawn in CSS so it needs no image asset. */
  .loom-pin{width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;
    border-top:22px solid ${C.coral};filter:drop-shadow(0 3px 4px rgba(0,0,0,.35))}
</style>
</head>
<body>
<div id="map"></div>
<script>
(function () {
  var post = function (m) {
    var s = JSON.stringify(m);
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
    else if (window.parent && window.parent !== window) window.parent.postMessage(s, '*');
  };
  if (!window.L) return post({ type: 'error' });

  var map = L.map('map', { zoomControl: true, attributionControl: true })
    .setView([${start.lat}, ${start.lng}], ${zoom});

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19,
  }).addTo(map);

  var icon = L.divIcon({ className: '', html: '<div class="loom-pin"></div>',
    iconSize: [18, 22], iconAnchor: [9, 22] });
  var marker = L.marker([${start.lat}, ${start.lng}], { icon: icon, draggable: true }).addTo(map);

  // Nominatim is the same reverse geocoder the web picker uses. A failure just
  // leaves the typed address alone rather than blanking it.
  var lookup = function (lat, lng) {
    post({ type: 'pin', lat: lat, lng: lng });
    fetch('https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&accept-language=ru&lat=' + lat + '&lon=' + lng)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.display_name) post({ type: 'pin', lat: lat, lng: lng, address: d.display_name });
      })
      .catch(function () {});
  };

  map.on('click', function (e) {
    marker.setLatLng(e.latlng);
    lookup(e.latlng.lat, e.latlng.lng);
  });
  marker.on('dragend', function () {
    var p = marker.getLatLng();
    lookup(p.lat, p.lng);
  });

  post({ type: 'ready' });
})();
</script>
</body>
</html>`
}
