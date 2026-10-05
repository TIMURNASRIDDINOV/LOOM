import { C } from '../theme/tokens'

// The Leaflet + OpenStreetMap page behind the delivery-pin picker, shared by
// the native WebView and the web <iframe>. Same stack as the website's
// address picker (assets/address-picker.js): no API key, no billing account,
// and couriers get coordinates in the same shape web orders already carry.
//
// Leaflet's stock chrome — rounded blue zoom buttons, a link-blue attribution
// bar and full-colour raster tiles — is the one surface in the app that looked
// like someone else's product. The tile pane is filtered down to the paper/ink
// palette and every control is redrawn as a LOOM slab, so the map reads as a
// printed street plan rather than an embedded widget.

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
  #map{font-family:'IBM Plex Mono',ui-monospace,monospace}

  /* Tiles printed in the palette: warm greyscale, a touch more contrast so
     streets stay legible once the colour is gone. Markers and controls live
     in their own panes, so the coral pin is untouched. */
  .leaflet-tile-pane{filter:grayscale(1) sepia(.18) saturate(.65) contrast(1.12) brightness(1.04)}

  /* Zoom — two ink slabs with a hard shadow, not pill buttons. */
  .leaflet-control-zoom{border:0!important;box-shadow:3px 3px 0 ${C.ink}!important;margin:10px!important}
  /* .leaflet-touch's own bar rule is more specific, so match it. */
  .leaflet-touch .leaflet-control-zoom a,.leaflet-control-zoom a{
    width:34px;height:34px;line-height:32px;border-radius:0!important;
    background:${C.paper};color:${C.ink};border:2px solid ${C.ink};
    font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:17px;font-weight:600;
    text-indent:0;text-align:center}
  .leaflet-touch .leaflet-control-zoom a:first-child,.leaflet-control-zoom a:first-child{border-bottom-width:0}
  .leaflet-control-zoom a:hover,.leaflet-control-zoom a:active{background:#fff;color:${C.ink}}
  .leaflet-control-zoom a.leaflet-disabled{background:${C.paper};color:rgba(19,19,17,.28)}

  /* Attribution — a mono footnote, not a blue link bar. */
  .leaflet-control-attribution{
    background:rgba(244,242,237,.92)!important;
    border-top:1px solid rgba(19,19,17,.16);border-left:1px solid rgba(19,19,17,.16);
    font:8.5px/1.4 'IBM Plex Mono',ui-monospace,monospace!important;
    color:rgba(19,19,17,.5)!important;padding:3px 6px!important;margin:0!important}
  .leaflet-control-attribution a{color:rgba(19,19,17,.5)!important;text-decoration:none}

  /* The pin: a coral chip on an ink stem. Hard edges, hard shadow — the same
     vocabulary as every other block in the app. */
  .loom-pin{position:relative;width:20px;height:30px}
  .loom-pin b{position:absolute;left:0;top:0;width:20px;height:20px;box-sizing:border-box;
    background:${C.coral};border:2px solid ${C.ink};box-shadow:2px 2px 0 ${C.ink}}
  .loom-pin i{position:absolute;left:9px;top:20px;width:2px;height:10px;background:${C.ink}}
  .leaflet-marker-draggable{cursor:grab}
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

  var map = L.map('map', { zoomControl: false, attributionControl: true })
    .setView([${start.lat}, ${start.lng}], ${zoom});

  L.control.zoom({ position: 'topright' }).addTo(map);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19,
  }).addTo(map);

  var icon = L.divIcon({ className: '', html: '<div class="loom-pin"><b></b><i></i></div>',
    iconSize: [20, 30], iconAnchor: [10, 30] });
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
