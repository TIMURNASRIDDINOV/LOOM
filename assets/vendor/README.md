# Vendored third-party code

Served from our own origin instead of a public CDN. Every third-party origin costs a
DNS lookup, a TCP connection and a TLS handshake before the first byte arrives, and
`cdnjs.cloudflare.com` / `cdn.jsdelivr.net` do not necessarily resolve to the Tashkent
PoP that `loomdesign.uz` does for our users. Same bytes, closer, and on a connection
the browser has already opened.

Files here are **verbatim upstream** — never hand-edited. Each was verified byte-identical
to the npm registry tarball, not just to the CDN copy that was serving it.

To upgrade one: download it from the pinned URL at the new version, re-verify against the
npm tarball, update this file, and **bump its `?v=` at every reference** — `/assets/*`
ships `immutable` for a year (see `_headers`), so a changed file with an unchanged `?v=`
is invisible to returning visitors for up to twelve months.

| File | Package | Version | Upstream URL | Referenced by |
|---|---|---|---|---|
| `gsap.min.js` | gsap | 3.12.5 | `https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js` | index, catalog, login, register, checkout, account, configurator |
| `ScrollTrigger.min.js` | gsap | 3.12.5 | `https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js` | index, catalog, account |
| `lenis.min.js` | lenis | 1.1.14 | `https://cdn.jsdelivr.net/npm/lenis@1.1.14/dist/lenis.min.js` | index, catalog, account |
| `three.min.js` | three | 0.128.0 | `https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js` | `configurator.js` (`THREE_CHUNKS`) |
| `GLTFLoader.js` | three | 0.128.0 | `…/three@0.128.0/examples/js/loaders/GLTFLoader.js` | `configurator.js` |
| `OrbitControls.js` | three | 0.128.0 | `…/three@0.128.0/examples/js/controls/OrbitControls.js` | `configurator.js` |
| `RoomEnvironment.js` | three | 0.128.0 | `…/three@0.128.0/examples/js/environments/RoomEnvironment.js` | `configurator.js` |
| `GLTFExporter.js` | three | 0.128.0 | `…/three@0.128.0/examples/js/exporters/GLTFExporter.js` | `configurator.js` |
| `meshopt_decoder.js` | meshoptimizer | 0.25.0 | `https://cdn.jsdelivr.net/npm/meshoptimizer@0.25.0/meshopt_decoder.js` | `configurator.js` |

All at `?v=1`.

## Sizes

| File | Raw | gzip |
|---|---:|---:|
| `three.min.js` | 603,445 | 148,752 |
| `GLTFLoader.js` | 96,550 | 21,888 |
| `gsap.min.js` | 72,214 | 28,085 |
| `GLTFExporter.js` | 57,871 | 13,880 |
| `ScrollTrigger.min.js` | 43,380 | 17,663 |
| `meshopt_decoder.js` | 32,869 | 8,207 |
| `OrbitControls.js` | 26,375 | 5,396 |
| `lenis.min.js` | 12,790 | 3,637 |
| `RoomEnvironment.js` | 3,425 | 1,041 |
| **Total** | **948,919** | **248,549** |

Only `gsap.min.js` is on the critical path of a normal page load. The five three files
plus the decoder are injected on demand when the 3D preview opens — see `SECTION 4B` in
`configurator.js`. `ScrollTrigger` and `lenis` load on the three pages that scroll.

## The three files

`three@0.128.0`'s `examples/js/*` are classic scripts that patch the global `THREE`
namespace, so they must load **after** `three.min.js` and in that order.
`ensureThreeLoaded()` chains them; do not parallelise.

`meshopt_decoder.js` is pinned to meshoptimizer **0.25.0** rather than the 1.0.1 that
encodes the model, because from 1.0.0 the package ships only ESM and CJS and these pages
load classic `<script>`. Details, and the verification that the older decoder reads the
newer bitstream correctly, are in `assets/models/README.md`.

## Integrity

    gsap.min.js            sha384-g4NTh/Iv5PPU4xPyhEWqPcwtNXOvdaDI8LLnyYfyNZOjKJeYQyjzQ9X5275eBjpt
    ScrollTrigger.min.js   sha384-Z3REaz79l2IaAZqJsSABtTbhjgOUYyV3p90XNnAPCSHg3EMTz1fouunq9WZRtj3d
    lenis.min.js           sha384-O55L/6rhHr9CFvrxqv5luxOCcmVaBmETbZbJDP+Do8T0pztTACsFBD/IXCNkj7DV
    three.min.js           sha384-CI3ELBVUz9XQO+97x6nwMDPosPR5XvsxW2ua7N1Xeygeh1IxtgqtCkGfQY9WWdHu
    GLTFLoader.js          sha384-fljlqkjWlmSFjkESkQvm77heIZpoWmXEOzlCA7kOpGUH+95Zk0yGfQieWM2q136E
    OrbitControls.js       sha384-wagZhIFgY4hD+7awjQjR4e2E294y6J2HSnd8eTNc15ZubTeQeVRZwhQJ+W6hnBsf
    RoomEnvironment.js     sha384-UpJYDNQ/8wDmBlzh4lZ9VMbunag9yRAOGFiBWYVaf6/FCnrwc9qlto25EZVLhpph
    GLTFExporter.js        sha384-rGtaymDtw9nk80MOKrYMkPbGnrELAWx6L/Lxn7kG4sc4+09Aa1xll+AwI+/ZKGSz
    meshopt_decoder.js     sha384-qtyoEcJqidpmpJZePD4g2NeV9GzkrFg09oxBPqPuxVAfoSLNPySYr8NfweaEe2n8

## Still third-party (not vendored)

Deliberately out of scope for this pass — recorded so the list stays honest:

- **Leaflet 1.9.4** (`unpkg.com`) — `assets/map-picker.js`, `assets/checkout.js`,
  `admin/order.html`, `admin/user-detail.html`. Lazy-loaded on demand, so it does not
  appear on a normal page load, but it is a third origin when a map opens.
- **three 0.128.0** (`cdn.jsdelivr.net`) — `admin/order.html` still loads it from the CDN.
  The same files now exist here; pointing it at them would remove the duplication.
- **Chart.js 4.4.0** (`cdn.jsdelivr.net`) — `admin/dashboard.html`. Admin only.
- **Google Fonts** (`fonts.googleapis.com` + `fonts.gstatic.com`) — still the only
  third-party origins on a customer page load, ~160 KB of woff2 for a ru/uz visitor.
