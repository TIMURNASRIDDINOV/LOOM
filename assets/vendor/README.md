# Vendored third-party code

Served from our own origin instead of a public CDN. Every third-party host costs a
DNS lookup, a TCP connection and a TLS handshake before the first byte, and those
hosts do not necessarily resolve to the Tashkent PoP that `loomdesign.uz` does.

Files here are **verbatim upstream** — never hand-edited. To change one, re-download
it from the pinned URL below at a new version, update this file, and bump the `?v=`
in every referencing `.html` (`/assets/*` ships `immutable` for a year; see `_headers`).

| File | Package | Version | Upstream URL | Referenced by |
|---|---|---|---|---|
| `meshopt_decoder.js` | [meshoptimizer](https://github.com/zeux/meshoptimizer) | 0.25.0 | `https://cdn.jsdelivr.net/npm/meshoptimizer@0.25.0/meshopt_decoder.js` | `configurator.html` (`?v=1`) |

## `meshopt_decoder.js`

32,869 bytes raw, 8,207 gzipped. Defines the global `MeshoptDecoder`; handed to
`GLTFLoader` by `attachGeometryDecoder()` in `configurator.js`, which is the single
call site.

Decodes `assets/models/t_shirt.meshopt.glb` (modes `ATTRIBUTES` + `TRIANGLES`,
filters `NONE` + `OCTAHEDRAL`).

**Why 0.25.0 and not 1.x.** The model is encoded by `@gltf-transform/cli@4.4.2`,
which bundles `meshoptimizer ~1.0.1`. From 1.0.0 the package ships only ESM
(`meshopt_decoder.mjs`) and CJS — 0.25.0 is the last release with a classic build
that sets a global, which is what this page's non-module `<script defer>` loading
needs. The `EXT_meshopt_compression` bitstream is stable across the two, and the
0.25.0 decoder was verified against the 1.0.1-encoded artifact by rendering it
through the configurator's own pipeline: pixel-identical to the uncompressed
original (max Δ 56/channel, mean 0.09, entirely sub-pixel AA at silhouette edges).

If the page ever moves to ES modules, switch to `meshoptimizer@1.0.1`'s
`meshopt_decoder.mjs` to match the encoder exactly.

Verified byte-identical to the npm registry tarball, not just the CDN copy:

    sha384-qtyoEcJqidpmpJZePD4g2NeV9GzkrFg09oxBPqPuxVAfoSLNPySYr8NfweaEe2n8
