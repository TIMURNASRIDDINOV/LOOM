# 3D models — provenance and encoding

## `t_shirt.glb` — source of truth, 6,786,916 bytes

Sketchfab export (generator `Sketchfab-14.32.1`). f32 POSITION/NORMAL/TEXCOORD_0,
u32 indices, no compression extension, **no embedded textures** — the 6.46 MB BIN
chunk is pure geometry (10 meshes, 122,543 vertices).

**Do not delete or overwrite this file.** It is the re-encode source and the rollback.
It is no longer the file the configurator downloads.

## `t_shirt.meshopt.glb` — the file we ship, 1,600,204 bytes

Regenerate with exactly:

    npx @gltf-transform/cli@4.4.2 meshopt \
      assets/models/t_shirt.glb \
      assets/models/t_shirt.meshopt.glb \
      --level high

Applies `EXT_meshopt_compression` + `KHR_mesh_quantization` (POSITION 14-bit,
NORMAL 10-bit). Decoded by `MeshoptDecoder`, registered on the loader via
`GLTFLoader.setMeshoptDecoder()`. three r128 supports both extensions natively.

### Two things that must not change

**1. Use `meshopt`, never `optimize`.**

`gltf-transform optimize` defaults to `--flatten --join --palette --simplify`, all on.
On this asset that collapses 21 nodes / 10 meshes / 2 materials into **1 node, 1 mesh,
1 material** and drops 58% of the vertices (122,543 → 50,951). It produces a much
smaller file (396,812 bytes) and it silently breaks the product:

`configurator.js` decides which mesh receives the front print, the back print or a
plain colour by walking *ancestor node names* (`Body_Front_Node_4`, `Body_Back_Node_5`,
`Sleeves_Node_*`, `Ribbing_Node_*`) — see `nodeHasAnyNameInHierarchy()`. There are only
two materials in the file, so material names alone cannot tell front from back. Flatten
those nodes away and every body mesh classifies as *front*: the back design disappears,
and the front design gets painted onto the sleeves and collar.

**2. TEXCOORD_0 must stay f32 — do not quantize it.**

Not a precision concern. `normalizeModelUVsGlobally()` in `configurator.js` rescales UVs
at load time using `uv.getX(i)` / `uv.setXY(i, …)`. On a quantized attribute three r128
hands back the **raw integer** (e.g. `24977`), not the normalized `0.381`; the function
then writes a float back into a `Uint16Array`, which truncates every UV to `0`. The whole
print collapses to texel (0,0). This happens identically at 12, 14 and 16 bits, so a
higher `--quantize-texcoord` does not help.

gltf-transform declines to quantize these UVs on its own (`warn: quantize: Skipping
TEXCOORD_0; out of [0,1] range` — the atlas spans u ≈ ±256, v ≈ −406…344), which is why
the plain `meshopt` command is safe. Keeping UVs at f32 costs ~980 KB of the 1.6 MB.
Recovering it means teaching `normalizeModelUVsGlobally()` to read normalized integer
attributes, or baking the normalization into the asset and dropping the runtime pass.

### Next candidate: Draco + pre-normalized UVs (~916 KB, not yet verified)

Recorded so it isn't lost. **Unverified — these are leads for the harness, not results.**

Plain `gltf-transform draco` on the original (no destructive flags, hierarchy
preserved) reportedly gives **684,032 bytes** against meshopt's 1,600,204 — worth
~916 KB. Draco's decoder is heavier (`draco_wasm_wrapper.js` + `draco_decoder.wasm`
≈ 74.8 KB gzipped vs meshopt's 6.5 KB) and slower on mid-range Android, which is why
meshopt won the first round on total first-load bytes; that trade shifts once the
model is behind an interaction gate and the decoder is no longer on the critical path.

Draco's default 12-bit texcoord quantization is catastrophic at this asset's ~750-unit
UV span. But pre-normalizing UVs into `[0,1]` first is a verified no-op (max Δ 0 —
`normalizeModelUVsGlobally()` is idempotent, so the runtime pass becomes an identity
transform), and against a `[0,1]` span 12 bits is sub-texel at 2048². That combination
would also let `normalizeModelUVsGlobally()` be deleted outright, which removes the
`getX()`-on-quantized-attribute trap described above.

Before adopting it, re-run the render comparison (original vs candidate, front and
back, fine-grid + text pattern, plus a shading-only pass) — the same check that
qualified the meshopt build.

### Verified

Rendered original vs. encoded through the configurator's own pipeline
(`normalizeModelUVsGlobally` + the same material classification), front and back, with a
2048² test pattern of 16 px grid, 128 px rules and fine text:

| view | max Δ/channel | mean Δ/channel | front / back meshes |
|---|---|---|---|
| front | 56 | 0.090 | 3 / 3 (unchanged) |
| back | 56 | 0.128 | 3 / 3 (unchanged) |
| front, shading only (no map) | 56 | 0.057 | — |

Residual is sub-pixel antialiasing on 1 px grid lines at silhouette edges, from 14-bit
position quantization. No UV drift, no seams, no warping, no shading artefacts.
