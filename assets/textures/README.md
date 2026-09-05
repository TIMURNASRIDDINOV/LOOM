# Fabric detail maps

`fabric-jersey-normal.jpg` and `fabric-jersey-roughness.jpg` give every garment
its woven-cotton surface under the design. They are tiled into the 2048² atlas
at load (`FABRIC_TILES` in `configurator.js` / `mobile/src/lib/scene-html.ts`)
and applied as `normalMap` / `roughnessMap` on the shirt materials, so a plain
white garment reads as fabric instead of smooth plastic. Models that ship their
own normal map with native 0–1 UVs keep it; these are the fallback.

Source: [ambientCG Fabric036](https://ambientcg.com/view?id=Fabric036), CC0 1.0
(public domain). Downscaled from the 1K JPG set to 512² — at 12 tiles across
the atlas each tile covers ~170 px, so 1K adds bytes without adding detail.

| File | Bytes | From |
|---|---:|---|
| `fabric-jersey-normal.jpg` | see `ls -la` | `Fabric036_1K-JPG_NormalGL.jpg` (OpenGL convention, which three.js expects) |
| `fabric-jersey-roughness.jpg` | see `ls -la` | `Fabric036_1K-JPG_Roughness.jpg` |

Both are referenced with `?v=1` and served `immutable` (see `_headers`); bump
the query string when replacing them.
