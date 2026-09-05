# Garment models — sourcing research (2026-09-05)

Where to get proper 3D garments for every product in the catalog, what licence
each comes with, and how to get one into the configurator. Companion to
[`README.md`](README.md), which explains why the current hoodie fails.

## What a model must have

`configurator.js` and `mobile/src/lib/scene-html.ts` decide where the print
goes by **node names**, and they lay the 30×40 cm platen on the front panel's
**UV island**. So a candidate is usable only if:

| Requirement | Why |
|---|---|
| Nodes (or parents) named `Body_Front` / `Body_Back`; sleeves/collar named `Sleeve*` / `Rib*`/`Neck*`/`Collar*` | `nodeHasAnyNameInHierarchy()` routes the front texture, back texture and plain colour by these tokens. Anything else renders with no print. |
| Front panel unwrapped as **one contiguous UV island**, same for the back | `measurePrintRect()` fits one rectangle to the panel's UV bbox. A chest split over several islands prints as fragments (this is the hoodie's problem). |
| `TEXCOORD_0` present on every body mesh, stored as **f32** | UVs are normalised at load; quantised UVs collapse to (0,0). |
| ≤ ~250k triangles after cleanup | The t-shirt is 238k and loads in 1.6 MB with meshopt. Bigger models stall mid-range Android. |
| Licence that allows commercial use and modification | We re-topologise, rename, re-encode and ship the file in a paid product. |

Run the vetting tool on any download before spending time in Blender:

```bash
cd tools/glb-inspect && npm install
node inspect.mjs ~/Downloads/some-garment.glb
```

It prints the node tree, per-mesh UV ranges and the exact FRONT/BACK/plain
classification the configurator would apply, then a verdict. On our own files:
`t_shirt.meshopt.glb` → *usable as-is*; `hoodie-regular.glb` → *needs work*
(0 front, 0 back, 465k tris).

Almost no downloadable garment ships with our node names, so **every candidate
below needs a 20–40 minute Blender pass**: select the front panel faces → separate
→ rename node `Body_Front`; same for `Body_Back`; sleeves/hood/cuffs → `Sleeves` /
`Ribbing`; check each panel is one UV island (UV editor → select all → *Seams from
islands*); decimate to ≤ 250k tris; export glTF Binary with UVs, no compression.
Then encode and upload (see *Shipping a model* below).

## Licences, in plain terms

| Source / licence | Commercial use | Modify | Attribution | Notes |
|---|---|---|---|---|
| Sketchfab **CC-BY 4.0** | yes | yes | **required**: author name + link to the model, wherever the model is used | Most free garments. Put credits on `privacy.html` (add a "3D models" section) and in the app's About row. |
| Sketchfab **CC0** | yes | yes | no | Rare for clothing. Filterable on Sketchfab. |
| Sketchfab **Free Standard** | yes, all media | yes | no | Sketchfab's own licence for free non-CC uploads; NoAI tag may apply. |
| Sketchfab **CC-BY-NC** | **no** | — | — | Skip. |
| BlenderKit **Royalty Free** (free tier) | yes | yes | no | Needs the BlenderKit add-on in Blender to download. |
| CGTrader **Royalty Free** (free models) | yes, as part of a product | yes | no | Must not be re-distributable on its own — a GLB behind our API is fine. |
| TurboSquid **free** | **no** (non-commercial only; cannot be upgraded) | — | — | Skip. |
| CLO-SET CONNECT free garments | per item; distribution limits on trims/fabrics | yes | — | Needs CLO software to export; check each item's terms. |
| Meshy "CC0" | yes | yes | no | AI-generated meshes: bad topology and UVs, not "proper". Skip. |

Sources: [Sketchfab licence filters](https://sketchfab.com/blogs/community/refine-downloadable-model-searches-with-new-license-filters/),
[Sketchfab licences](https://sketchfab.com/licenses), [CGTrader Royalty Free](https://help.cgtrader.com/hc/en-us/articles/360015124437-Royalty-Free-License),
[CGTrader free models commercially](https://help.cgtrader.com/hc/en-us/articles/360015122437-Can-I-commercially-use-a-free-model),
[TurboSquid licence tiers](https://blog.turbosquid.com/turbosquid-license-tiers/), [CLO-SET CONNECT terms](https://legal.clo-set.com/modal-tou-connect).

## Candidates per product

Vertex/face counts are Sketchfab's. UV layout could **not** be verified without
downloading (Sketchfab downloads need a signed-in account), so treat "UV" notes
as expectations from the authoring tool, to be confirmed with `inspect.mjs`.

### Oversized T-shirt (tshirt-regular, tshirt-2)

| Model | Licence | Geometry | Notes |
|---|---|---|---|
| [Oversize T-Shirt (FREE)](https://sketchfab.com/3d-models/oversize-t-shirt-free-679118b2f75548daaff9910f1aad90bc) — erebus3d | CC-BY | 138k verts / 277k tris, 6 textures | **First choice.** Proper oversized drape, PBR maps. Needs decimation to ~200k and node renaming. |
| [oversized_t-shirt](https://sketchfab.com/3d-models/oversized-t-shirt-e6f9b60f58404ccaa40e8e3bdb4edc95) — ap-school (re-uploaded by others) | CC-BY | 238k verts / 426k tris | Heavier; garment-tool export so panels are probably clean islands. Decimate hard. |
| [T-SHIRT 3D MOCKUP (EDITABLE)](https://sketchfab.com/3d-models/t-shirt-3d-mockup-editable-6dc3e98682c84212bcd6dc1df3e0260a) — Vougeoniva | CC-BY | 77k verts / 154k tris, no textures | Built for print mockups (front/back editable in Photoshop) → UV layout is likely exactly what we need. Regular fit rather than oversized. |
| [Oversize T-Shirt GAME READY](https://sketchfab.com/3d-models/oversize-t-shirt-game-ready-super-low-poly-74338ce284664c66bc9ccf365602953b) — chmilstudio | CC-BY | 562 verts | Too coarse for a smooth print surface; fine as a placeholder only. |

### Cropped / muscle tee (tshirt-cropped, tshirt-muscle)

No good free cropped tee found. Options: derive both from the oversized tee in
Blender (crop the hem / remove sleeves — 15 minutes each, same UV layout), or
[Hangers Pack tank top / t-shirt / long sleeve](https://sketchfab.com/3d-models/hangers-pack-tank-top-tshirt-men-long-sleeve-t-s-e7a03de4e430450697f06884e40b927c)
— kopofx, CC-BY, 6.9k verts, no textures (low detail, flat display shapes).

### Hoodie (hoodie-regular) and zip hoodie (hoodie-zip)

| Model | Licence | Geometry | Notes |
|---|---|---|---|
| [Green and white hoodie](https://sketchfab.com/3d-models/green-and-white-hoodie-af100701826e4bb9abc1ff1a1d24ab1e) — Style3DMeta | CC-BY | 57k verts / 114k tris, 5 textures | **First choice.** Style3D (pattern-based garment software) exports: each pattern piece is its own UV island, so front/back panels are already clean. Official Style3D account, exports gltf/glb. |
| [Pink Drawstring Hooded Sweatshirt](https://sketchfab.com/3d-models/pink-drawstring-hooded-sweatshirt-fd03f442026f4252b2507dda53bba564) — Style3DMeta | CC-BY | 55k verts / 110k tris | Same pipeline; women's cut. |
| [Color Block Zip-up Hoodie](https://sketchfab.com/3d-models/color-block-zip-up-hoodie-cf8468faccc5429586a41a9cea26ecc0) — Style3DMeta | CC-BY | 59k verts / 117k tris | **Zip hoodie candidate.** Zip splits the front into two panels — print rect must be placed per side or on the back only. |
| [Hoodie](https://sketchfab.com/3d-models/hoodie-d51e89bfa33646ba8771ddf972dc1af2) — kurmanin | CC-BY | 78k verts / 152k tris, 4 textures | Marvelous Designer export ("casual hooded sweatshirt"); MD also unwraps by pattern piece. |
| [Urban Streetwear Hoodie](https://sketchfab.com/3d-models/urban-streetwear-hoodie-3d-clothing-a4f197dad3494271a5f798b68f055aa8) — grandriley | Free Standard (no attribution) | 34k verts / 66k tris, 7 textures | Game-ready, "clean topology, UV mapping". Lightest realistic option. |
| [Hoodie](https://sketchfab.com/3d-models/hoodie-97611a53e3b846f69e0655b210f72b2f) — virtualpandora | CC-BY | 133k verts / 240k tris | Heavier fallback. |

### Sweatshirt (sweatshirt-regular)

| Model | Licence | Geometry | Notes |
|---|---|---|---|
| [Basic sweatshirt](https://sketchfab.com/3d-models/basic-sweatshirt-92800a4c11ce4b8daccb75e60035535f) — kurmanin | CC-BY | 10k verts / 20k tris | Game-ready, low poly but smooth enough for a crewneck; quickest to prepare. |
| [Sweatshirt and Sweatpants](https://sketchfab.com/3d-models/sweatshirt-and-sweatpants-b4de80f56c2c47089478b75950752690) — geeneear | CC-BY | 59k verts / 116k tris | Gives the pants too. |

### Sweatpants (sweatpants-regular)

| Model | Licence | Geometry | Notes |
|---|---|---|---|
| [Male sweatpants and sweatshirt (anorak)](https://sketchfab.com/3d-models/male-sweatpants-and-sweatshirt-anorak-f72f208b242a415c84d0087a790faa5f) — kurmanin | CC-BY | 7.6k verts total; pants 1.9k verts, 2048² textures | Game-ready, rigged for MetaHuman (strip the armature). Print area on trousers is the thigh — a small platen; front/back naming still applies per leg panel. |
| [fadeblack 3D sweatpants Mockup](https://sketchfab.com/3d-models/fadeblack-3d-sweatpants-mockup-ddd0cd5906744544b6b722d0f3f19994) — saeidmarimi06 | CC-BY | 117k verts / 233k tris | Made as a print mockup; heavier. |
| [Simple Sweatpants Model](https://sketchfab.com/3d-models/simple-sweatpants-model-9c6f80d0d57c439084fb0dc13f268442) — earlymonke | CC-BY | 5.5k verts | Low-detail fallback. |

### Cap (cap-regular)

| Model | Licence | Geometry | Notes |
|---|---|---|---|
| [Baseball Cap 01 Package](https://sketchfab.com/3d-models/baseball-cap-01-package-823e79f5e5ee41668abce9d8755c4926) — didpubs | CC-BY | 7.5k verts / 14.7k tris, "comes with UVs" | **First choice.** Clean product-viz cap; the front two panels are the print area. |
| [Baseball Hat 028](https://sketchfab.com/3d-models/baseball-hat-028-d9edc7c821f44c65a4f68e2509f04e6d) — jmcgregor | CC-BY | 26k verts / 51k tris, no textures | Higher detail. |
| [Baseball Cap](https://sketchfab.com/3d-models/baseball-cap-1c1d34d73fd94e6b9e8f82b1eb7194a0) — vanart | CC-BY | 47k verts / 93k tris | Photoshop-3D test asset; check UVs. |
| Avoid the "NY / Yankees 59FIFTY" models | — | — | Team trademarks on the mesh/texture. |

Caps have no "back" panel in our sense: classify the front panels as
`Body_Front`, everything else plain, and set the product's print area smaller
(the platen constant is per-view in `configurator.js`; a cap needs ~12×6 cm).
That is a small code change, not a model problem.

### Polo (polo-regular)

| Model | Licence | Geometry | Notes |
|---|---|---|---|
| [Polo Shirt](https://www.blenderkit.com/asset-gallery-detail/16a42310-9bc9-4a12-8866-52a776912ae9/) — Giovani França, BlenderKit | Royalty Free, free | 10.9k faces, single 4K UV set | **First choice.** Download via the BlenderKit add-on inside Blender, export GLB. |
| [T-shirt Polo Lengan Pendek](https://sketchfab.com/3d-models/t-shirt-polo-lengan-pendek-74c33d16b31346f1a46a55c3ec8e8a78) — Ikal.Ichwan | CC-BY | 26k verts / 54k tris, no textures | "Made for t-shirt preview / presentation" — mockup-oriented, likely clean UVs. Long-sleeve variant exists. |
| [Realistic Yellow Polo Shirt](https://sketchfab.com/3d-models/realistic-yellow-polo-shirt-eafdb4b360f04e839df432bf7ed23877) — MotionStudioArts | CC-BY | 42k verts / 74k tris | Realistic fallback. |

## Shipping a model

1. Vet: `node tools/glb-inspect/inspect.mjs model.glb` → fix in Blender until *usable*.
2. Encode exactly like the t-shirt (see README — `meshopt`, never `optimize`):
   `npx @gltf-transform/cli@4.4.2 meshopt in.glb out.glb --level high`
3. Upload under a **new** R2 key (files are served `immutable` for a year): admin → Товары → product → GLB, or `wrangler r2 object put loom-models/glb/<slug>-v2.glb --file out.glb` and set `glb_key`.
4. Open the product in the studio (web and app), front and back, with a text layer and an image: the print must sit centred on the chest and the back must show the back design.
5. Credits: for CC-BY models add author + model link to `privacy.html` ("3D-модели") and the app's About text.

## Not verified / open

- UV island layout of every Sketchfab candidate (needs download + `inspect.mjs`).
- Whether Style3DMeta's GLB exports keep the pattern-piece UV islands after Sketchfab's re-processing (the FBX from Style3D Atelier certainly does).
- The cap needs a per-product platen size in code before a cap model is useful.

Search API used: `https://api.sketchfab.com/v3/search?type=models&q=<term>&downloadable=true`.
