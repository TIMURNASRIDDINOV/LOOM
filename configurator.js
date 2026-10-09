/* ================================================================
  LOOM 3D T-Shirt Configurator — configurator.js
  Three.js r128 | GLTFLoader | OrbitControls
  ================================================================ */

"use strict";

// ================================================================
// SECTION 1 — CONSTANTS
// ================================================================

const TEX_SIZE = 2048; // Offscreen texture canvas dimensions (2048 for crisp logo quality)

// The default garment, meshopt-compressed: 1.60 MB instead of the 6.79 MB
// uncompressed export. See assets/models/README.md for how it is encoded and
// which gltf-transform flags must never be used on it.
const DEFAULT_MODEL_URL = "assets/models/t_shirt.meshopt.glb?v=1";

// ── Print geometry ───────────────────────────────────────────────
// The print rect is the DTG platen projected into texture space. It cannot be one
// shared constant: normalizeModelUVsGlobally() packs every UV island into one
// atlas, and the front/back islands land at different offsets AND different
// scales, so a single rect can only ever be correct for one of them. Each view's
// rect is therefore measured off its own mesh in resolvePrintRects().
const PLATEN_CM = { w: 30, h: 40 }; // A3 DTG platen — matches admin/assets/order-detail.js
// The panel's full atlas width spans the garment's ~54 cm front width, so the
// 30 cm platen is ~0.55 of it. Top margin is expressed against the platen width
// (0.20 × 30 cm = 6 cm below the neckline) so both stay in proportion.
// These are the defaults; a product's config.print_area replaces all three
// (applyPrintArea, LOOM-166).
let PLATEN_W_FRAC = 0.55;
let PLATEN_TOP_FRAC = 0.20;

// Pre-mesh fallback, and the unit basis for the UI's px/% sliders: a font-size of
// 160 means 160px in a rect this tall, scaled proportionally in any real rect.
const LEGACY_PRINT_AREA = { x: 560, y: 360, w: 928, h: 1120 };
const REF_RECT = { w: LEGACY_PRINT_AREA.w, h: LEGACY_PRINT_AREA.h };

// Resolved per view once the model's mesh is available (see resolvePrintRects).
//
// Seeded with the values resolvePrintRects() measures off the bundled garment,
// rather than with LEGACY_PRINT_AREA. The 3D model is no longer loaded on page
// load, so the measurement now happens only when the user opens the preview —
// but the FLAT editor derives its print-band aspect from these (renderFlatEditor:
// `rect.h = rect.w / (pr.w / pr.h)`), and it is on screen from the first frame.
// Seeding with LEGACY's 0.8286 would show a 10.5% too-tall band until the
// preview was opened. These numbers are what the mesh resolves to, so the flat
// editor is correct immediately and re-resolving later is a no-op.
//
// Every product except hoodie-regular renders on this mesh. Re-measure with
// `JSON.stringify(PRINT_RECTS)` in the console after the model loads if the
// bundled garment is ever replaced.
const DEFAULT_PRINT_RECTS = {
  front: { x: 621.4077537536621, y: 449.80019195556645, w: 769.0009597778321, h: 1025.3346130371094 },
  back:  { x: 669.6164901733398, y: 322.6587879943848,  w: 768.8689483642579, h: 1025.1585978190105 },
};
const PRINT_RECTS = { front: { ...DEFAULT_PRINT_RECTS.front }, back: { ...DEFAULT_PRINT_RECTS.back } };
function printRect(view) {
  return PRINT_RECTS[view || designState.activeView] || LEGACY_PRINT_AREA;
}

// Live bounding boxes (texture-space) of each element, recomputed on every
// drawTexture() — keyed by element id, used for hit testing + resize handles.
const _boxes = { front: {}, back: {} };
// When true, drawTexture() paints a selection outline + corner handles for the
// active element. Turned OFF transiently around snapshots/exports so handles
// never bake into the saved PNG / order preview.
let _showHandles = true;
const HANDLE_TEX = 90; // corner-handle grab radius, in texture px (comfortable target)
const SEL_PAD = 26;    // gap between element and the drawn selection box / handles

// Camera views are finalized by auto-fit after the model loads.
const CAM_VIEWS = {
  front: { x: 0, y: 0, z: 3.2 },
  back: { x: 0, y: 0, z: -3.2 },
};

// Filled after auto-fit so the reset-view button can snap back.
const INITIAL_VIEW = {
  position: null, // THREE.Vector3
  target: null, // THREE.Vector3
};

// Garment facing axis, cached at fit time (the model never moves afterwards).
let _garmentFacing = null;

// Available shirt colors
// Garment colours. Adding one is a single entry here — the swatches, the order
// summary name, the reset default and the flat editor's tint all read from this
// list. `i18n` is the dictionary key for the human name; `light` marks colours
// that need an outline on a light background to be visible as a swatch.
const SHIRT_COLORS = [
  { hex: "#FFFFFF", name: "Белый",  i18n: "cfg.colorWhite", light: true },
  { hex: "#1F2937", name: "Чёрный", i18n: "cfg.colorBlack" },
];

/** The colour a fresh design starts on, and the one Reset returns to. */
let DEFAULT_SHIRT_COLOR = SHIRT_COLORS[0].hex;

function shirtColorDef(hex) {
  const h = String(hex || "").toUpperCase();
  return SHIRT_COLORS.find((c) => c.hex.toUpperCase() === h) || null;
}

/** A colour's name in the visitor's language. Config colours carry their own. */
function colorLabel(def) {
  if (def.names) {
    let lang = "ru";
    try { if (window.LOOM_I18N) lang = window.LOOM_I18N.getLang(); } catch (e) {}
    return def.names[lang] || def.names.ru || def.hex;
  }
  return def.i18n ? CT(def.i18n, def.name) : def.name;
}

/** True when the colour is on the product's list and switched on. */
function colorAvailable(hex) {
  const def = shirtColorDef(hex);
  return !!def && def.available !== false;
}

// Font options (system + Google)
const FONT_OPTIONS = [
  { value: "Arial", label: "Arial" },
  { value: "Georgia", label: "Georgia" },
  { value: "Impact", label: "Impact" },
  { value: "Courier New", label: "Courier New" },
  { value: "Pacifico", label: "Pacifico (Script)" },
];

// API base — resolved via config.js if available
function getApiBase() {
  if (window.LOOM_CONFIG) return window.LOOM_CONFIG.API_BASE;
  const h = window.location.hostname;
  return (h === "localhost" || h === "127.0.0.1")
    ? "http://localhost:8787"
    : "https://api.loomdesign.uz";
}

// i18n helper — translate a key with a Russian fallback when i18n.js is absent
/**
 * Funnel step. Fires at most once per session (track.js dedupes), never throws,
 * and does nothing at all if track.js failed to load — analytics must never be
 * able to break the configurator.
 */
function trackStep(event) {
  try { if (window.LOOM_TRACK) window.LOOM_TRACK.event(event); } catch (e) {}
}

function CT(key, fallback) {
  try { return (window.LOOM_I18N ? window.LOOM_I18N.t(key) : fallback) || fallback; }
  catch (e) { return fallback; }
}

// Product loaded from API (null = using local fallback)
let currentProduct = null;

// Color name lookup for UI display
const COLOR_NAMES = {};
SHIRT_COLORS.forEach((c) => {
  COLOR_NAMES[c.hex] = c.name;
});

// ================================================================
// SECTION 2 — STATE
// ================================================================

// Each view holds an ordered list of elements (text / logo), drawn back-to-front.
// Positions are stored NORMALISED (0–1) inside that view's print rect, so front
// and back share one coordinate space — nx 0.5 is the garment centreline on both
// — and re-measuring a rect never moves existing artwork.
const designState = {
  shirtColor: DEFAULT_SHIRT_COLOR,
  activeView: "front",

  front: { elements: [], selId: null },
  back: { elements: [], selId: null },
};

// Uploaded logo file metadata, keyed by ELEMENT id (for order submission).
const uploadedFileData = {};

let _elSeq = 0;
function _uid() { return "e" + (++_elSeq) + "_" + Date.now().toString(36); }

function newTextElement(over) {
  return Object.assign({
    id: _uid(), type: "text",
    nx: 0.5, ny: 0.32, rotation: 0,
    content: "", font: "Arial", size: 160,
    color: "#000000", bold: false, italic: false,
  }, over || {});
}

function newImageElement(over) {
  return Object.assign({
    id: _uid(), type: "image",
    nx: 0.5, ny: 0.28, rotation: 0,
    img: null, name: "", scalePct: 100, key: null,
  }, over || {});
}

// ── Element accessors ────────────────────────────────────────────
function elementsOf(view) { return designState[view || designState.activeView].elements; }

function selectedElement(view) {
  const v = view || designState.activeView;
  const st = designState[v];
  return st.elements.find((e) => e.id === st.selId) || null;
}

function elementById(id, view) {
  return elementsOf(view).find((e) => e.id === id) || null;
}

/** Select an element (or null) in the active view and refresh the panel + overlay. */
function selectElement(id, opts) {
  const st = designState[designState.activeView];
  if (st.selId === id) return;
  st.selId = id;
  syncPanelFromState();
  if (!opts || opts.redraw !== false) redrawActive();
}

/** Does this view have anything on it? Untouched sample text counts: it is on screen. */
function _viewHasContent(view) {
  return elementsOf(view).some((e) => e.type === "text" ? !!e.content : !!e.img);
}

/** Does this view have printable artwork? Untouched sample text is preview-only. */
function _viewHasPrint(view) {
  return elementsOf(view).some((e) => e.type === "text" ? !!e.content && !e.placeholder : !!e.img);
}

// ── Normalised ⇄ texture-space conversion ────────────────────────
// nx/ny are fractions of the print rect; size/scalePct are expressed against
// REF_RECT so the UI sliders keep their familiar px / % ranges on any garment.
// The (nx, ny) → texture map is the measured grid: nx 0.5 is the garment's
// visual centreline and ny steps are LEVEL on the garment, so placement reads
// straight on a leaning, tilted-unwrap mesh instead of following the atlas.
function elTexX(el, view) { return texXYAt(view, el.nx, el.ny)[0]; }
function elTexY(el, view) { return texXYAt(view, el.nx, el.ny)[1]; }
function elTexSize(el, view) { return el.size * (printRect(view).h / REF_RECT.h); }
function elTexImgMax(el, view) {
  return (el.scalePct / 100) * (TEX_SIZE * 0.30) * (printRect(view).w / REF_RECT.w);
}
function setElTexPos(el, tx, ty, view) {
  // Invert texXYAt with a few Newton steps on the bilinear surface. The map is
  // near-affine (a gently warped rectangle), so this converges in 2-3 steps;
  // texXYAt extrapolates past the borders, keeping the derivative alive there.
  const r = printRect(view);
  let u = (tx - r.x) / r.w, v = (ty - r.y) / r.h;
  for (let k = 0; k < 8; k++) {
    const p = texXYAt(view, u, v);
    const ex = p[0] - tx, ey = p[1] - ty;
    if (Math.abs(ex) < 0.1 && Math.abs(ey) < 0.1) break;
    const h = 0.01;
    const pu = texXYAt(view, u + h, v), pv = texXYAt(view, u, v + h);
    const a = (pu[0] - p[0]) / h, c = (pu[1] - p[1]) / h;
    const b = (pv[0] - p[0]) / h, d = (pv[1] - p[1]) / h;
    const det = a * d - b * c || 1e-6;
    u -= (d * ex - b * ey) / det;
    v -= (-c * ex + a * ey) / det;
    u = Math.max(-0.5, Math.min(1.5, u));
    v = Math.max(-0.5, Math.min(1.5, v));
  }
  el.nx = u;
  el.ny = v;
}

/**
 * Effective font size: the user's chosen size, capped so the string still fits
 * the print rect. Anything wider than the rect is simply cropped out of the print
 * master, so a long line has to shrink. Derived (never written back to el.size),
 * which means deleting characters grows the text back to the size they picked.
 */
function elTextFitSize(el, view, ctx) {
  return elTextFitSizeIn(el, printRect(view), ctx);
}

function elTextFitSizeIn(el, rect, ctx) {
  const size = el.size * (rect.h / REF_RECT.h);
  if (!el.content) return size;
  const weight = el.bold ? "bold" : "normal";
  const style = el.italic ? "italic" : "normal";
  ctx.save();
  ctx.font = `${style} ${weight} ${size}px "${el.font}"`;
  const w = ctx.measureText(el.content).width;
  ctx.restore();
  const maxW = rect.w * 0.98;
  return w > maxW ? Math.max(1, size * (maxW / w)) : size;
}

// Selected shirt size. No default: an order must never carry a size the
// customer did not pick (LOOM-179). sizeChosen() gates the way to step 3.
let selectedSize = null;

// True while a file pick started from "+ Логотип" (add a layer) rather than from
// the upload area (replace the selected layer's artwork).
let _pendingLogoIsNew = false;

// ================================================================
// SECTION 3 — THREE.JS GLOBALS
// ================================================================

let scene, camera, renderer, controls;
let shirtObject = null;
let shirtMaterials = [];
let frontPrintMaterials = [];
let backPrintMaterials = [];
let plainColorMaterials = [];
// Front/back body meshes + their extracted (UV → world-position) triangles, used
// by the 2D editor to map texture coords to screen exactly (no raycasting).
let frontBodyMeshes = [], backBodyMeshes = [];
let _meshTris = { front: null, back: null };


// Per-view canvas textures
let frontTexCanvas, backTexCanvas, plainTexCanvas;
let frontTexture, backTexture, plainTexture;

// Camera animation state (smooth lerp)
const camAnim = {
  active: false,
  targetX: CAM_VIEWS.front.x,
  targetY: CAM_VIEWS.front.y,
  targetZ: CAM_VIEWS.front.z,
  targetLookX: 0,
  targetLookY: 0,
  targetLookZ: 0,
};

// ================================================================
// SECTION 4 — ENTRY POINT
// ================================================================

document.addEventListener("DOMContentLoaded", async function () {
  // three.js and the garment are NOT loaded here — see SECTION 4B. The editing
  // surface is the flat face; the 3D is a preview behind an interaction.
  initCanvasTextures();

  // UI first — nothing in it depends on the product, and a slow /api/products
  // response must not leave dead controls. The render loop starts with the
  // renderer, in ensurePreview3D(); in flat mode it only ever early-returned.
  initUI();
  bindPreview3DPrefetch();

  // Auth nav
  if (window.LOOM_AUTH) window.LOOM_AUTH.renderAuthNav();

  // Editing a bag item? Resolve its product slug BEFORE the product load,
  // then re-apply the saved design once textures are ready.
  const editItem = await prepareCartEdit();

  // Resolve the product from ?slug=. This only records which GLB to use —
  // the model itself is fetched when the preview is opened (SECTION 4B).
  _productReady = loadProductFromSlug();
  await _productReady;

  if (editItem) applyCartEditDesign(editItem);
  // A design chosen in the marketplace lands last, so it sits on top of a
  // restored cart design rather than being overwritten by it.
  else applyPendingArtwork();
});

// ── Edit-from-cart (configurator.html?item=ID) ──────────────────
// Fetches the caller's cart item, points ?slug at its product, and later
// rehydrates designState (text layers + logo pixels via the ownership-checked
// /api/cart/:id/file/* routes).
async function prepareCartEdit() {
  const qs = new URLSearchParams(location.search);
  const id = parseInt(qs.get("item") || "", 10);
  if (!id) return null;
  try {
    const res = await fetch(getApiBase() + "/api/cart/" + id, { headers: _authHeaders(false), credentials: "include" });
    if (!res.ok) return null;
    const item = await res.json();
    window.__loomEditingCartItem = item.id;
    // Resolve the slug so loadProductFromSlug opens the SAME product (GLB,
    // price, config). The API sends it with the item, even for a disabled
    // product; an older API only has the active list, which is an object.
    if (item.product_id && !qs.get("slug")) {
      try {
        let slug = item.product_slug;
        if (!slug) {
          const pr = await fetch(getApiBase() + "/api/products");
          const list = pr.ok ? await pr.json() : null;
          const items = Array.isArray(list) ? list : (list && list.products) || [];
          const p = items.find((x) => x.id === item.product_id);
          slug = p && p.slug;
        }
        if (slug) {
          const url = new URL(location.href);
          url.searchParams.set("slug", slug);
          history.replaceState(null, "", url.toString());
        }
      } catch (e) { /* default model is an acceptable fallback */ }
    }
    return item;
  } catch (e) { return null; }
}

// Legacy design_json (no `v`) → element list. Old x/y are raw texture px measured
// against LEGACY_PRINT_AREA, so normalise through THAT rect, not the live one —
// otherwise reopening an old cart item would shift the artwork.
function _legacyViewToElements(srcL) {
  const L = LEGACY_PRINT_AREA;
  const norm = (s, fbX, fbY) => ({
    nx: ((s.x != null ? s.x : fbX) - L.x) / L.w,
    ny: ((s.y != null ? s.y : fbY) - L.y) / L.h,
  });
  const out = [];
  if (srcL.image && srcL.image.name) {
    out.push(Object.assign(
      { type: "image", rotation: srcL.image.rotation || 0, name: srcL.image.name, scalePct: srcL.image.scalePct || 100, key: null },
      norm(srcL.image, TEX_SIZE / 2, TEX_SIZE * 0.30),
    ));
  }
  if (srcL.text && srcL.text.content) {
    out.push(Object.assign(
      {
        type: "text", rotation: srcL.text.rotation || 0,
        content: srcL.text.content, font: srcL.text.font, size: srcL.text.size,
        color: srcL.text.color, bold: !!srcL.text.bold, italic: !!srcL.text.italic,
      },
      norm(srcL.text, TEX_SIZE / 2, TEX_SIZE * 0.35),
    ));
  }
  return out; // image first — matches the legacy draw order (image under text)
}

async function applyCartEditDesign(item) {
  let d = {};
  try { d = JSON.parse(item.design_json || "{}"); } catch (e) { return; }

  if (d.shirtColor) selectShirtColor(d.shirtColor, null);
  if (d.size) {
    selectedSize = d.size;
    syncPickers();
  }

  for (const view of ["front", "back"]) {
    const srcL = d[view];
    if (!srcL) continue;
    const dst = designState[view];
    // v2 stores an element array in normalised coords; anything older is one text
    // + one image in raw texture px against LEGACY_PRINT_AREA.
    const src = (d.v >= 2 && Array.isArray(srcL.elements))
      ? srcL.elements
      : _legacyViewToElements(srcL);

    for (const s of src) {
      if (s.type === "text") {
        dst.elements.push(newTextElement({
          nx: s.nx, ny: s.ny, rotation: s.rotation || 0,
          content: s.content, font: s.font || "Arial", size: s.size || 160,
          color: s.color || "#000000", bold: !!s.bold, italic: !!s.italic,
        }));
        continue;
      }
      // Logo pixels come back through the ownership-checked cart file route. The
      // columns only hold the FIRST logo per side; extras keep their own R2 key.
      const url = s.key
        ? getApiBase() + "/api/uploads/" + encodeURIComponent(s.key)
        : getApiBase() + "/api/cart/" + item.id + "/file/" + (view === "front" ? "logo" : "back-logo");
      try {
        const fr = await fetch(url, { headers: _authHeaders(false), credentials: "include" });
        if (!fr.ok) continue;
        const blob = await fr.blob();
        const dataUrl = await new Promise((resolve) => {
          const R = new FileReader();
          R.onload = () => resolve(R.result);
          R.readAsDataURL(blob);
        });
        const img = await new Promise((resolve) => {
          const im = new Image();
          im.onload = () => resolve(im);
          im.onerror = () => resolve(null);
          im.src = dataUrl;
        });
        if (!img) continue;
        const el = newImageElement({
          nx: s.nx, ny: s.ny, rotation: s.rotation || 0,
          img, name: s.name || "", scalePct: s.scalePct || 100, key: s.key || null,
        });
        // Carry the designer credit through an edit. Without this, reopening a
        // bag item and saving it would quietly drop the artwork id, and the
        // designer would not be paid for the re-added row.
        if (s.artworkId) {
          el.artworkId = s.artworkId;
          el.artworkPrice = s.artworkPrice || 0;
          el.artworkAuthor = s.artworkAuthor || null;
          el.artworkKey = s.artworkKey || null;
        }
        dst.elements.push(el);
        uploadedFileData[el.id] = { base64: dataUrl, name: s.name || "", type: blob.type, size: blob.size };
      } catch (e) { /* logo fetch failed — text still rehydrates */ }
    }
    dst.selId = dst.elements.length ? dst.elements[dst.elements.length - 1].id : null;
  }

  syncPanelFromState();
  refreshPriceLabels();

  drawTexture("front");
  drawTexture("back");
  if (typeof applyActiveTexture === "function") applyActiveTexture();
  showToast(CT("cfg.editingFromCart", "Редактируем товар из корзины — сохранится при добавлении"));
}

// ================================================================
// SECTION 4B — DEFERRED 3D BOOT
// ================================================================
//
// three.js (603 KB) plus its four example scripts and the 1.60 MB garment used
// to be on the critical path of every configurator load. The editing surface is
// the flat face, so none of it is needed until the user asks for the preview.
// Everything below loads on that interaction instead.
//
// Script injection rather than dynamic import(): r128's examples/js/* are
// classic scripts that patch the THREE global, so going ESM would mean moving
// to examples/jsm/ and an ESM three build — a module-format change to the whole
// 3D path, which does not belong in the same commit as the deferral gate.

// Order matters: three itself must finish before the four scripts that patch
// its global, so these are loaded strictly in sequence, never in parallel.
const THREE_CHUNKS = [
  "assets/vendor/three.min.js?v=1",
  "assets/vendor/GLTFLoader.js?v=1",
  "assets/vendor/OrbitControls.js?v=1",
  "assets/vendor/RoomEnvironment.js?v=1",
  "assets/vendor/GLTFExporter.js?v=1",
  "assets/vendor/meshopt_decoder.js?v=1",
];

const _loadedChunks = new Set();
let _threeReady = null;   // single in-flight promise for the script chain
let _preview3D = null;    // single in-flight promise for the whole boot
let _threeBooted = false;  // renderer, textures and render loop exist (once per page)
let _preview3DReady = false; // the model is on screen; Save PNG is available
let _pendingGlbUrl = null; // resolved by loadProductFromSlug, consumed on open
// LOOM-199: the loaded GLB is the CC BY 4.0 tee (its asset.extras name the
// Sketchfab source), so #model-credit must show while the 3D is on screen.
let _modelCredited = false;
let _productReady = null;  // loadProductFromSlug's promise; gates the model URL

function _loadChunk(src) {
  if (_loadedChunks.has(src)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = false;
    s.onload = () => { _loadedChunks.add(src); resolve(); };
    s.onerror = () => {
      // Drop the failed tag so a retry re-requests instead of stacking dead
      // elements, and so _loadedChunks never records a script that didn't run.
      s.remove();
      reject(new Error("Failed to load " + src));
    };
    document.head.appendChild(s);
  });
}

/**
 * Load three and its example scripts, in order, exactly once.
 *
 * Concurrent callers share one promise, so double-tapping the 3D button cannot
 * inject twice. On failure the promise is cleared — but _loadedChunks keeps the
 * scripts that did succeed, so a retry resumes at the one that broke.
 */
function ensureThreeLoaded() {
  if (_threeReady) return _threeReady;
  _threeReady = THREE_CHUNKS
    .reduce((chain, src) => chain.then(() => _loadChunk(src)), Promise.resolve())
    .catch((err) => { _threeReady = null; throw err; });
  return _threeReady;
}

/**
 * Bring up the 3D preview: scripts, renderer, GPU textures, render loop, model.
 *
 * Idempotent in the same way — one promise, shared by every caller, cleared on
 * failure so the retry button can start over.
 */
function ensurePreview3D() {
  if (_preview3D) {
    // Back in 3D while the load is still running: setFlatMode hid the overlay.
    if (!_preview3DReady) showPreviewLoading(false);
    return _preview3D;
  }
  showPreviewLoading(true);
  announcePreview("cfg.loadingLabel", "Загрузка 3D-превью");
  _preview3D = ensureThreeLoaded()
    .then(() => {
      // A retry after a model failure reuses the renderer it already built.
      if (!_threeBooted) {
        initThreeJS();
        initThreeTextures();
        // Not awaited: the mesh should not wait on two small JPEGs. Materials
        // pick the maps up when they arrive (loadFabricDetail → applyFabricDetail).
        loadFabricDetail();
        animate();
        _threeBooted = true;
      }
      // Wait for ?slug= to resolve so a custom product model isn't loaded on
      // top of the default one. Already settled in the common case; its own
      // failures are swallowed there and fall back to the bundled garment.
      return (_productReady || Promise.resolve()).catch(() => {});
    })
    .then(() => loadShirtModel(_pendingGlbUrl || DEFAULT_MODEL_URL))
    // Open on the side picked in 2D before the 3D existed.
    .then(() => {
      setCameraView(designState.activeView);
      _preview3DReady = true;
      enableSaveDesign();
      announcePreview("cfg.loaded3d", "3D-превью готово");
    })
    .catch((err) => {
      _preview3D = null;
      announcePreview("cfg.load3dFailed", "Не удалось загрузить 3D-превью");
      showPreviewError(err);
      throw err;
    });
  return _preview3D;
}

// ── Preview loading / error states ──────────────────────────────
// The overlay must always terminate. A failed script chain used to be
// impossible; now it is a network away, and a spinner that never resolves is
// worse than an error the user can act on.

// fresh: a new attempt, so the bar starts over as indeterminate.
function showPreviewLoading(fresh) {
  const overlay = document.getElementById("loading-overlay");
  if (!overlay) return;
  overlay.classList.remove("is-error");
  overlay.style.display = "flex";
  overlay.style.opacity = "1";
  if (fresh) setLoadProgress(null);
}

/** #preview-status (aria-live polite): the load's start and end only. The
 *  bar's per-percent aria-valuenow is never spoken unless it has focus. */
function announcePreview(key, fallback) {
  const el = document.getElementById("preview-status");
  if (el) el.textContent = CT(key, fallback);
}

/** Bar and #loading-pct: null = indeterminate (size unknown), else 0-100. */
function setLoadProgress(pct) {
  const bar = document.getElementById("loading-bar");
  const label = document.getElementById("loading-pct");
  const known = pct != null;
  if (bar) {
    bar.classList.toggle("is-indeterminate", !known);
    if (known) bar.setAttribute("aria-valuenow", String(pct));
    else bar.removeAttribute("aria-valuenow");
    if (bar.firstElementChild) bar.firstElementChild.style.transform = known ? "scaleX(" + pct / 100 + ")" : "";
  }
  if (label) label.textContent = known ? pct + "%" : "";
}

// Any failure (scripts or model) leaves the customer on the 2D editor with a
// toast, never an error panel over it; the next 3D tap retries, because the
// catch in ensurePreview3D() has cleared the promise.
function showPreviewError(err) {
  console.error("[LOOM] 3D preview failed to load:", err);
  const overlay = document.getElementById("loading-overlay");
  if (!overlay) return;
  overlay.classList.add("is-error");
  setFlatMode(true); // hides the overlay
  showToast(CT("cfg.load3dFailed", "Не удалось загрузить 3D-превью"), "error");
  const btn = document.getElementById("preview-retry");
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      overlay.classList.remove("is-error");
      ensurePreview3D().catch(() => {});
    });
  }
}

// ── Prefetch on intent ──────────────────────────────────────────
// Not on page load: that would put the model back on the critical path for
// everyone who never opens the preview. Hover / touch / focus on the 3D control
// is a strong enough signal, and buys most of the latency back.

let _prefetched = false;
function prefetchPreview3D() {
  if (_prefetched) return;
  _prefetched = true;
  // rel=prefetch is explicitly the lowest-priority hint, so an in-flight
  // critical request keeps the bandwidth.
  [_pendingGlbUrl || DEFAULT_MODEL_URL, THREE_CHUNKS[0]].forEach((href) => {
    const l = document.createElement("link");
    l.rel = "prefetch";
    l.href = href;
    if (/^https?:/.test(href)) l.crossOrigin = "anonymous";
    document.head.appendChild(l);
  });
}

function bindPreview3DPrefetch() {
  // The camera-mode tiles open the 3D too.
  document.querySelectorAll("#btn-surface-3d, .cam-tile").forEach((btn) => {
    ["mouseenter", "touchstart", "focus"].forEach((evt) => {
      btn.addEventListener(evt, prefetchPreview3D, { once: true, passive: true });
    });
  });
}

// ================================================================
// SECTION 5 — THREE.JS SETUP
// ================================================================

function initThreeJS() {
  const container = document.getElementById("three-container");

  // Transparent scene so the CSS spotlight/vignette behind the canvas shows through
  scene = new THREE.Scene();
  scene.background = null;

  // Perspective camera — FOV 40 for a natural product lens feel
  const w = container.clientWidth || 600;
  const h = container.clientHeight || 600;
  camera = new THREE.PerspectiveCamera(40, w / h, 0.05, 100);
  camera.position.set(CAM_VIEWS.front.x, CAM_VIEWS.front.y, CAM_VIEWS.front.z);
  camera.lookAt(0, 0, 0);

  // WebGL renderer — preserveDrawingBuffer needed for screenshot export
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
    alpha: true,
  });
  // DPR capped at 2 — 3x phone screens quadruple the fill cost for
  // no visible gain on fabric
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.setSize(w, h);
  renderer.outputEncoding = THREE.sRGBEncoding;
  // ACES, not Linear. Linear clips: the old rig had to be held at exposure 0.5
  // to stop a white chest blowing out, and everything else went grey with it.
  // ACES rolls the highlights off instead, so the garment can be lit properly
  // and still keep detail in the brightest folds.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = STUDIO_EXPOSURE;
  // Soft shadows. The single thing that stops a garment reading as a flat
  // cut-out is the sleeve dropping a shadow onto the body.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // Studio environment (PMREM). A photographer's softboxes, not a living room:
  // RoomEnvironment is furniture-shaped and lit the cloth from everywhere at
  // once, which is precisely the "white mess" look.
  scene.environment = buildStudioEnvironment(renderer);

  // Lighting rig
  setupLighting();

  // OrbitControls — smooth damped orbit, locked below horizon
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.enablePan = false;
  controls.autoRotate = false;
  controls.minDistance = 1.5;
  controls.maxDistance = 6;
  controls.minPolarAngle = 0.2;
  controls.maxPolarAngle = Math.PI / 1.8; // prevent orbiting under the shirt
  controls.target.set(0, 0, 0);
  controls.update();
  // A drag or wheel zoom takes the camera back from Turntable (keeps the pose).
  controls.addEventListener("start", stopCamMotion);

  // Responsive resize — window AND container layout changes
  window.addEventListener("resize", onWindowResize);
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(onWindowResize).observe(container);
  }
}

// ── Studio rig ───────────────────────────────────────────────────
// One flat key light is why the garment used to read as a paper cut-out.
// A product shot uses three sources and so does this: a big soft KEY that
// carves the folds, a weak FILL that keeps the shadow side legible, and two
// RIM lights behind that draw a bright edge down the silhouette.
//
// The whole rig lives in a group that follows the camera's azimuth, so the
// key stays front-left of *the viewer* no matter how far the shirt is orbited.
// A fixed rig lights the front beautifully and the back not at all, and the
// back is half of what a customer came to look at.
const STUDIO_EXPOSURE = 0.95;

let studioRig = null;
let keyLight = null;
let shadowWall = null;

/**
 * Build the environment map from an explicit softbox layout, so the
 * reflections on the cloth are the long vertical highlights a studio gives —
 * not the blotchy room the default RoomEnvironment bakes.
 */
function buildStudioEnvironment(rend) {
  if (typeof THREE.PMREMGenerator !== "function") return null;
  const pmrem = new THREE.PMREMGenerator(rend);

  const env = new THREE.Scene();
  const panel = (w, h, color, x, y, z, ry) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
    );
    m.position.set(x, y, z);
    if (ry) m.rotation.y = ry;
    env.add(m);
    return m;
  };

  // Room shell: a dark warm box, so nothing bounces back except our panels.
  env.add(new THREE.Mesh(
    new THREE.BoxGeometry(14, 10, 14),
    new THREE.MeshBasicMaterial({ color: 0x14130f, side: THREE.BackSide }),
  ));

  panel(7, 7, 0xffffff, -3.4, 1.6, 4.2, 0.5);      // key softbox, front-left
  panel(4, 4, 0x8d959f, 4.4, 0.6, 3.0, -0.6);      // cool fill, front-right
  panel(9, 1.8, 0xf2ece2, 0, 4.4, 0, 0);           // overhead strip
  panel(1.8, 6, 0xc9d2dd, -5.2, 0.4, -2.4, 1.2);   // rim strip, back-left
  panel(1.8, 6, 0xc9d2dd, 5.2, 0.4, -2.4, -1.2);   // rim strip, back-right

  const tex = pmrem.fromScene(env, 0.04).texture;
  env.traverse((o) => {
    if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); }
  });
  pmrem.dispose();
  return tex;
}

function setupLighting() {
  // Ambient and hemisphere are deliberately faint. They lift the deepest
  // shadow off pure black and nothing more: every unit of light that arrives
  // from everywhere is a unit that flattens the shape the key just carved.
  scene.add(new THREE.AmbientLight(0xffffff, 0.05));
  const hemi = new THREE.HemisphereLight(0xf7f3ea, 0x33302b, 0.14);
  hemi.position.set(0, 1, 0);
  scene.add(hemi);

  // Everything below is camera-relative: +Z is "towards the viewer".
  studioRig = new THREE.Group();
  scene.add(studioRig);

  // KEY — a close softbox, high front-left, and the only shadow caster. It is
  // a SpotLight rather than a DirectionalLight for one reason: parallel rays
  // light a broad surface at a near-constant angle, so the chest came out one
  // even sheet of white. A positional light falls off across the garment, and
  // that falloff IS the modelling. Measured: with the directional key 67% of
  // garment pixels sat in the top 16 levels; with this one, 86% spread across
  // the three bands below it and nothing clips.
  keyLight = new THREE.SpotLight(0xfff4e8, 3.0, 1, 0.75, 1.0, 2.0);
  keyLight.position.set(-0.62, 0.72, 0.66);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.bias = -0.0006;
  keyLight.shadow.normalBias = 0.02;
  studioRig.add(keyLight);
  studioRig.add(keyLight.target);

  // FILL — front-right, cool and weak: it opens the shadow side without
  // undoing the modelling.
  const fill = new THREE.DirectionalLight(0xdde7f4, 0.28);
  fill.position.set(0.8, 0.26, 0.6);
  studioRig.add(fill);

  // RIMS — behind and wide, one per shoulder. This edge highlight is what
  // makes cotton look like cloth instead of like a white silhouette.
  const rimL = new THREE.DirectionalLight(0xffffff, 0.85);
  rimL.position.set(-0.8, 0.42, -0.7);
  studioRig.add(rimL);

  const rimR = new THREE.DirectionalLight(0xeef4ff, 0.5);
  rimR.position.set(0.85, 0.3, -0.72);
  studioRig.add(rimR);
}

/**
 * Point the rig at the garment once its final size is known. Called after
 * fitCameraToObject(), which is what actually scales the model — a shadow
 * frustum sized before that is either empty or covers the whole world.
 */
function fitStudioToObject(object) {
  if (!object || !studioRig) return;

  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.62;

  studioRig.position.copy(center);

  // Light positions are authored as unit directions; push them out to a
  // sensible distance for this garment. The key sits close (its falloff is
  // the point); the rims are far, so their edge highlight stays even.
  studioRig.children.forEach((l) => {
    if (!l.isDirectionalLight) return;
    l.position.normalize().multiplyScalar(radius * 4);
  });
  keyLight.position.normalize().multiplyScalar(radius * 2.2);
  keyLight.distance = radius * 6;
  keyLight.shadow.camera.near = radius * 0.4;
  keyLight.shadow.camera.far = radius * 8;
  keyLight.shadow.camera.updateProjectionMatrix();

  // Garment casts onto itself (sleeve → body) and takes the key's shadow.
  object.traverse((child) => {
    if (!child.isMesh || child.userData.isLining) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });

  // A soft cast shadow on the backdrop behind the garment. At this camera
  // height a floor shadow is edge-on and invisible; the wall is what a
  // photographer actually sees behind a hanging garment. It rides the rig, so
  // it is always the far side from the viewer.
  if (!shadowWall) {
    shadowWall = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShadowMaterial({ opacity: 0.28, transparent: true, depthWrite: false }),
    );
    shadowWall.receiveShadow = true;
    shadowWall.renderOrder = -1;
    studioRig.add(shadowWall);
  }
  // Wide enough that its own edge never crosses the frame, and close enough
  // behind the garment that the cast shadow stays shirt-shaped instead of
  // smearing into a blob.
  shadowWall.scale.set(radius * 11, radius * 11, 1);
  shadowWall.position.set(0, 0, -radius * 0.85);
}

/**
 * Keep the rig square to the viewer. Called every frame while the 3D is up —
 * an atan2 and one matrix update, which is far cheaper than the orbit itself.
 */
function updateStudioRig() {
  if (!studioRig || !camera) return;
  studioRig.rotation.y = Math.atan2(
    camera.position.x - studioRig.position.x,
    camera.position.z - studioRig.position.z,
  );
}

let _lastResizeW = 0;
let _lastResizeH = 0;
let _refitOnShow = false; // the last fit ran while the 3D was hidden

function onWindowResize() {
  const container = document.getElementById("three-container");
  if (!container || !renderer || !camera) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w === 0 || h === 0) return;
  // iOS fires resize every time the URL bar collapses mid-scroll —
  // bail early so the camera never snaps while the user is browsing
  if (w === _lastResizeW && h === _lastResizeH && !_refitOnShow) return;
  _lastResizeW = w;
  _lastResizeH = h;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);

  // LOOM-209: the model loaded behind the 2D editor, so its fit used the
  // hidden canvas. Fit once more on the real stage, exactly as a load in 3D
  // would (the customer has not orbited yet: there was nothing to see).
  if (_refitOnShow && shirtObject) {
    finishEntrance();
    scene.updateMatrixWorld(true); // the pivot's full scale, before measuring
    fitCameraToObject(shirtObject);
    setCameraView(designState.activeView);
  }

  // Redraw the live overlay for the new size. The camera itself is
  // NOT re-fit here: fitCameraToObject() hard-resets the user's orbit
  // angle and zoom, which read as a jarring jump on every viewport tweak.
  if (editMode) drawEditor();
}

// ================================================================
// SECTION 6 — CANVAS TEXTURE PIPELINE
// ================================================================

function initCanvasTextures() {
  // Create offscreen canvases: front design, back design and plain shirt color.
  frontTexCanvas = document.createElement("canvas");
  frontTexCanvas.width = TEX_SIZE;
  frontTexCanvas.height = TEX_SIZE;

  backTexCanvas = document.createElement("canvas");
  backTexCanvas.width = TEX_SIZE;
  backTexCanvas.height = TEX_SIZE;

  plainTexCanvas = document.createElement("canvas");
  plainTexCanvas.width = TEX_SIZE;
  plainTexCanvas.height = TEX_SIZE;

  // Initial draw
  drawPlainTexture();
  drawTexture("front");
  drawTexture("back");
}

/**
 * Wrap the design canvases as GPU textures. Split out of initCanvasTextures()
 * because it needs both THREE and a live renderer (for getMaxAnisotropy), and
 * neither exists until the user opens the 3D preview. The canvases above are
 * plain 2D and the flat editor draws from them unaided, so everything up to
 * this point still runs on page load.
 *
 * Safe to call only once, from ensurePreview3D() after initThreeJS().
 */
// ── Fabric surface ───────────────────────────────────────────────
// The design canvas carries colour only, so without a normal map a white
// garment renders as smooth plastic. A tileable woven-cotton normal +
// roughness pair (assets/textures, CC0) is tiled into a 2048² atlas at load
// and applied under the design. Pre-tiling into a canvas instead of using
// texture.repeat matters: three r128 drives every map on a material with the
// `map`'s UV transform, and the design canvas must stay at 1×.
//
// A model that ships its own normal map keeps it — but only when its UVs were
// already in 0–1, because normalizeModelUVsGlobally() rescales the UVs the
// model's own textures were authored for. Set by normalizeModelUVsGlobally().
const FABRIC_NORMAL_URL = "assets/textures/fabric-jersey-normal.jpg?v=1";
const FABRIC_ROUGH_URL = "assets/textures/fabric-jersey-roughness.jpg?v=1";
const FABRIC_ENV_INTENSITY = 0.28; // the studio environment was washing white cloth out

// One material for every garment is why a hoodie and a tee looked like the
// same white sheet. Each preset is the same tiled weave read at a different
// scale, with the sheen and roughness that cloth actually has: `tiles` sets
// how many centimetres of cloth one atlas tile covers, `sheen` is the soft
// halo cotton gets at grazing angles. Chosen from the product slug, because
// that is the only garment-type signal the catalog carries.
const FABRIC_PRESETS = {
  jersey: { tiles: 12, normalScale: 0.9, sheen: 0.32, sheenRough: 0.75, rough: 1.0 },
  heavy:  { tiles: 9,  normalScale: 1.15, sheen: 0.26, sheenRough: 0.85, rough: 1.05 },
  fleece: { tiles: 7,  normalScale: 1.5, sheen: 0.5, sheenRough: 0.95, rough: 1.1 },
  pique:  { tiles: 14, normalScale: 1.05, sheen: 0.22, sheenRough: 0.6, rough: 0.95 },
  twill:  { tiles: 16, normalScale: 0.75, sheen: 0.14, sheenRough: 0.5, rough: 0.9 },
};
let fabricPreset = FABRIC_PRESETS.jersey;

/** Which cloth a garment is cut from, guessed from its slug / name. */
function fabricForProduct(product) {
  // Match on every name the product has, not just the Russian one: the
  // patterns below cover both alphabets, and a product named only in Uzbek
  // should still be recognised as a hoodie.
  const tag = [product && product.slug, product && product.name_ru,
               product && product.name_uz, product && product.name_en]
    .filter(Boolean).join(" ").toLowerCase();
  if (/hood|худи|толстов|sweat|свитш/.test(tag)) return FABRIC_PRESETS.fleece;
  if (/polo|поло/.test(tag)) return FABRIC_PRESETS.pique;
  if (/cap|кепк|панам|pant|штан|шорт|short/.test(tag)) return FABRIC_PRESETS.twill;
  if (/oversize|оверсайз|heavy|плотн/.test(tag)) return FABRIC_PRESETS.heavy;
  return FABRIC_PRESETS.jersey;
}

let fabricNormalTexture = null;
let fabricRoughTexture = null;
let _fabricImages = null;
let _modelUvNative = false;

function tileImageToTexture(img) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = TEX_SIZE;
  const g = cv.getContext("2d");
  const tiles = fabricPreset.tiles;
  const step = TEX_SIZE / tiles;
  for (let y = 0; y < tiles; y++) {
    for (let x = 0; x < tiles; x++) g.drawImage(img, x * step, y * step, step, step);
  }
  const t = new THREE.CanvasTexture(cv);
  t.flipY = false; // same convention as the design canvases
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  if (renderer) t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed: " + url));
    img.src = url;
  });
}

/** Load the fabric maps and hand them to every material that exists or appears later. */
function loadFabricDetail() {
  const imgs = _fabricImages
    ? Promise.resolve(_fabricImages)
    : Promise.all([loadImage(FABRIC_NORMAL_URL), loadImage(FABRIC_ROUGH_URL)]);
  return imgs
    .then((pair) => {
      _fabricImages = pair;
      // Re-tiled, not just re-scaled: three r128 drives every map on a
      // material from the `map`'s UV transform, and the design canvas must
      // stay at 1×, so tile density has to be baked into the atlas.
      fabricNormalTexture = tileImageToTexture(pair[0]);
      fabricRoughTexture = tileImageToTexture(pair[1]);
      shirtMaterials.forEach(applyFabricDetail);
      if (renderer && scene && camera && !flatMode) { updateStudioRig(); renderer.render(scene, camera); }
    })
    .catch((e) => {
      // Flat shading is the pre-existing behaviour — never block the preview on this.
      console.warn("[LOOM] fabric detail unavailable:", e.message);
    });
}

/** Give one shirt material its surface: the model's own maps if usable, else our fabric. */
function applyFabricDetail(mat) {
  if (mat.userData.ownNormalMap) return; // authored maps win
  if (!fabricNormalTexture) return;
  const f = fabricPreset;
  mat.normalMap = fabricNormalTexture;
  mat.normalScale = new THREE.Vector2(f.normalScale, f.normalScale);
  mat.roughnessMap = fabricRoughTexture;
  mat.roughness = f.rough; // the map carries the variation (cotton ≈ 0.7–0.85)
  // Sheen is what separates cloth from plastic: a soft halo where the surface
  // turns away from the camera. The API changed shape across three versions —
  // r128 (vendored here) takes a Color and treats null as off, later builds
  // take a float plus a separate sheenColor. Feed whichever this build wants;
  // the placeholder garment is a Standard material and has neither.
  if ("sheen" in mat) {
    if (mat.sheen === null || (mat.sheen && mat.sheen.isColor)) {
      mat.sheen = new THREE.Color(f.sheen, f.sheen, f.sheen);
    } else {
      mat.sheen = f.sheen;
      if ("sheenRoughness" in mat) mat.sheenRoughness = f.sheenRough;
    }
  }
  mat.needsUpdate = true;
}

/** Swap the cloth when the garment changes. No-op before the maps are loaded. */
function setFabricPreset(preset) {
  if (!preset || preset === fabricPreset) return;
  fabricPreset = preset;
  if (!_fabricImages) return;
  loadFabricDetail();
}

function initThreeTextures() {
  frontTexture = new THREE.CanvasTexture(frontTexCanvas);
  backTexture = new THREE.CanvasTexture(backTexCanvas);
  plainTexture = new THREE.CanvasTexture(plainTexCanvas);

  // GLTF UV convention expects textures with flipY disabled.
  frontTexture.flipY = false;
  backTexture.flipY = false;
  plainTexture.flipY = false;

  // sRGB so colors match the chosen hex values
  frontTexture.encoding = THREE.sRGBEncoding;
  backTexture.encoding = THREE.sRGBEncoding;
  plainTexture.encoding = THREE.sRGBEncoding;

  // Trilinear + anisotropic filtering — eliminates the blurry/choppy look
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  [frontTexture, backTexture, plainTexture].forEach((t) => {
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = maxAniso;
  });

  // The canvases already hold whatever the user drew before opening the
  // preview; upload that rather than starting the 3D from a blank shirt.
  frontTexture.needsUpdate = true;
  backTexture.needsUpdate = true;
  plainTexture.needsUpdate = true;
}

function drawPlainTexture() {
  const ctx = plainTexCanvas.getContext("2d");

  ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
  ctx.fillStyle = designState.shirtColor;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Null until the 3D preview is opened — the flat editor reads the canvas
  // directly and needs no GPU upload.
  if (plainTexture) plainTexture.needsUpdate = true;
  updateLiningColor();
}

/**
 * Paint ONE element onto a texture-space 2D context, and return its bounding box.
 * Shared by drawTexture() (garment preview) and _renderPrintCanvas() (print
 * master) so the proof a print shop receives matches the preview exactly.
 * `shadow` is off for print masters — the drop-shadow is a screen-legibility aid.
 */
// Garment bake: warped, so artwork sits on the mesh's wandering centreline and
// bakes LEVEL despite the atlas rows tilting ~2.5°. The print master and the
// dock's guide call drawElementIn with a flat rect and no posFn instead — a
// print shop must receive undistorted artwork.
function drawElement(ctx, el, view, shadow) {
  return drawElementIn(ctx, el, printRect(view), shadow, (nx, ny) => {
    const p = texXYAt(view, nx, ny);
    return { x: p[0], y: p[1], tilt: gridTiltAt(view, nx, ny) };
  });
}

/**
 * Paint an element into ANY target rect, in that rect's own coordinate space.
 *
 * `rect` is where the print area lands in the target context: the texture-space
 * rect for the garment bake, a translated one for the print master, or the flat
 * canvas of a position-guide face. Sizes scale off REF_RECT so the same element
 * renders proportionally identical at every one of those resolutions.
 */
function drawElementIn(ctx, el, rect, shadow, posFn) {
  // posFn (the garment bake) supplies the warped anchor plus the local tilt of
  // the level row direction; flat targets use the rect's own linear space.
  const pos = posFn
    ? posFn(el.nx, el.ny)
    : { x: rect.x + el.nx * rect.w, y: rect.y + el.ny * rect.h, tilt: 0 };
  const cx = pos.x, cy = pos.y;
  const rot = (el.rotation || 0) + (pos.tilt || 0);

  if (el.type === "image") {
    if (!el.img) return null;
    const natW = el.img.naturalWidth || el.img.width;
    const natH = el.img.naturalHeight || el.img.height;
    if (!natW || !natH) return null;
    // scalePct 100 → the image's long edge spans ~66% of the print rect width
    const maxDim = (el.scalePct / 100) * (TEX_SIZE * 0.30) * (rect.w / REF_RECT.w);
    const factor = maxDim / Math.max(natW, natH);
    const dw = natW * factor, dh = natH * factor;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.drawImage(el.img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
    return { cx, cy, w: dw, h: dh, rot };
  }

  if (!el.content) return null;
  const size = elTextFitSizeIn(el, rect, ctx);
  ctx.save();
  const weight = el.bold ? "bold" : "normal";
  const style = el.italic ? "italic" : "normal";
  ctx.font = `${style} ${weight} ${size}px "${el.font}"`;
  ctx.fillStyle = el.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tw = ctx.measureText(el.content).width;
  if (shadow) {
    // Subtle drop-shadow for legibility on light-colored shirts
    ctx.shadowColor = "rgba(0,0,0,0.12)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;
  }
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.fillText(el.content, 0, 0);
  ctx.restore();
  return { cx, cy, w: Math.max(tw, 40), h: size * 1.25, rot };
}

/**
 * Redraws the texture for a given view (front or back).
 * Layers: base color → elements, first in the list drawn first (bottom).
 * After drawing, sets needsUpdate = true so Three.js re-uploads to GPU.
 */
function drawTexture(view) {
  const canvas = view === "front" ? frontTexCanvas : backTexCanvas;
  const texture = view === "front" ? frontTexture : backTexture;
  const ctx = canvas.getContext("2d");

  drawPlainTexture();

  // 1. Base shirt color fill
  ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
  ctx.drawImage(plainTexCanvas, 0, 0, TEX_SIZE, TEX_SIZE);

  // Reset this view's element boxes; they are filled in as each element draws.
  _boxes[view] = {};

  // 2. Elements, bottom-of-list first
  elementsOf(view).forEach((el) => {
    const box = drawElement(ctx, el, view, true);
    if (box) _boxes[view][el.id] = box;
  });

  // 3. Selection handles are drawn on a separate 2D overlay (see SECTION 9b),
  //    NOT baked into the texture — so snapshots/exports are always clean.

  // Signal Three.js to re-upload
  if (texture) texture.needsUpdate = true;
  shirtMaterials.forEach(function (m) {
    m.needsUpdate = true;
  });

  // Refresh the 2D design canvas preview in the panel
  refreshDesignCanvas();
}

/** Redraw whichever view is currently active. */
function redrawActive() {
  drawTexture(designState.activeView);
  // Keep the 2D editor overlay (selection box + handles) in sync with state.
  if (typeof drawEditor === "function" && editMode) drawEditor();
  // …and the flat editor, which is the surface the user actually works on.
  if (typeof renderFlatEditor === "function") renderFlatEditor();
}

/**
 * Frame-coalesced redraw for high-frequency gesture paths (drag /
 * scale / rotate / pinch). pointermove fires at up to 120Hz on
 * ProMotion phones and every redrawActive() re-uploads a 2048px
 * texture + regenerates mipmaps — one redraw per frame is enough.
 */
let _redrawQueued = false;
function scheduleRedraw() {
  if (_redrawQueued) return;
  _redrawQueued = true;
  requestAnimationFrame(() => {
    _redrawQueued = false;
    redrawActive();
  });
}

function updatePlainColorMaterials() {
  plainColorMaterials.forEach((m) => {
    m.map = plainTexture;
    m.color.set(0xffffff);
    m.needsUpdate = true;
  });
}

// ── Lining ───────────────────────────────────────────────────────
// The garment mesh is an open shell: at the neck and the armholes you look
// straight through it. FrontSide leaves a hole, DoubleSide lights the inside
// as though it faced you (a white band across a navy shirt). A real garment
// has an inside, and the inside is darker — so give it one: the same geometry
// again, back faces only, in a shaded-down version of the shirt colour.
let liningMaterial = null;

function liningColor() {
  const c = new THREE.Color(designState.shirtColor || "#ffffff");
  // Interiors sit ~2 stops under the lit face; the floor keeps black cloth
  // from turning into a void.
  c.multiplyScalar(0.34);
  c.r = Math.max(c.r, 0.035); c.g = Math.max(c.g, 0.035); c.b = Math.max(c.b, 0.035);
  return c;
}

/** Duplicate every garment mesh as a back-facing shell inside it. */
function addLining(root) {
  if (!liningMaterial) {
    liningMaterial = new THREE.MeshStandardMaterial({
      color: liningColor(),
      roughness: 0.95,
      metalness: 0,
      side: THREE.BackSide,
    });
  }
  const meshes = [];
  root.traverse((child) => { if (child.isMesh && !child.userData.isLining) meshes.push(child); });
  meshes.forEach((m) => {
    const inner = new THREE.Mesh(m.geometry, liningMaterial);
    inner.userData.isLining = true;
    inner.castShadow = false;      // the outer shell already casts this silhouette
    inner.receiveShadow = true;
    inner.renderOrder = -1;
    m.add(inner);                  // child: inherits the parent's transform exactly
  });
}

function updateLiningColor() {
  if (liningMaterial) liningMaterial.color.copy(liningColor());
}

/**
 * Apply the front or back texture to all shirt mesh materials.
 * Called every time the active view switches.
 */
function applyActiveTexture() {
  frontPrintMaterials.forEach((m) => {
    m.map = frontTexture;
    m.needsUpdate = true;
  });

  backPrintMaterials.forEach((m) => {
    m.map = backTexture;
    m.needsUpdate = true;
  });

  updatePlainColorMaterials();
  if (renderer && camera && scene) { updateStudioRig(); renderer.render(scene, camera); }
}

function nodeHasAnyNameInHierarchy(node, tokens) {
  let current = node;
  while (current) {
    const name = (current.name || "").toLowerCase();
    if (tokens.some((token) => name.includes(token))) return true;
    current = current.parent;
  }
  return false;
}

function normalizeModelUVsGlobally(object) {
  const uvAttributes = [];
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;

  object.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.uv) return;
    const uv = child.geometry.attributes.uv;
    uvAttributes.push(uv);
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
  });

  if (!uvAttributes.length) return;

  const rangeU = maxU - minU || 1;
  const rangeV = maxV - minV || 1;
  // Already a 0–1 atlas → the model's own textures still line up after this pass.
  _modelUvNative = rangeU <= 1.05 && rangeV <= 1.05 && minU >= -0.05 && minV >= -0.05;
  // Uniform scale so shapes aren't stretched
  const uniformRange = Math.max(rangeU, rangeV);
  // Center offset: shift so the whole model is centered at UV (0.5, 0.5)
  // which equals texture pixel TEX_SIZE/2 on both axes.
  const shiftU = (1 - rangeU / uniformRange) / 2;
  const shiftV = (1 - rangeV / uniformRange) / 2;

  uvAttributes.forEach((uv) => {
    for (let i = 0; i < uv.count; i++) {
      const uNorm = (uv.getX(i) - minU) / uniformRange + shiftU;
      const vNorm = (uv.getY(i) - minV) / uniformRange + shiftV;
      uv.setXY(i, uNorm, vNorm);
    }
    uv.needsUpdate = true;
  });
}

// ================================================================
// SECTION 7 — MODEL LOADING
// ================================================================

/**
 * Show which product is being configured. Entering from the nav carries no
 * ?slug, and a price with no product attached ("Создайте свой дизайн — 150 000
 * сум") reads like placeholder text, so the header names the real garment.
 */
// ── Price ────────────────────────────────────────────────────────
// A marketplace design costs the garment plus its designer's markup. The
// server re-reads the markup from the artwork row at checkout, so this is a
// display and cart-hint value, never the source of truth.

function basePrice() {
  return currentProduct ? currentProduct.price : 150000;
}

function artworkMarkupTotal() {
  const seen = {};
  ["front", "back"].forEach((v) => {
    elementsOf(v).forEach((el) => {
      if (el.artworkId && !seen[el.artworkId]) seen[el.artworkId] = el.artworkPrice || 0;
    });
  });
  return Object.keys(seen).reduce((sum, k) => sum + (seen[k] || 0), 0);
}

function currentUnitPrice() {
  return basePrice() + artworkMarkupTotal();
}

/** Repaint every place the total is shown. */
function refreshPriceLabels() {
  const total = currentUnitPrice();
  const numFmt = new Intl.NumberFormat("ru-RU").format(total);
  ["panel-price", "foot-price-num", "sheet-price-num"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = numFmt;
  });
  document
    .querySelectorAll(".summary-price .summary-val, .summary-price .summary-value, .configurator-price")
    .forEach((el) => { el.textContent = numFmt + " " + CT("cfg.currency", "сум"); });
}

/** The product's name in the visitor's language (0020 added name_uz). */
function productName(product) {
  try {
    if (window.LOOM_I18N && window.LOOM_I18N.productName) {
      return window.LOOM_I18N.productName(product);
    }
  } catch (e) { /* i18n not loaded yet */ }
  return (product && (product.name_ru || product.slug)) || "";
}

function applyProductToHeader(product) {
  if (!product) return;
  refreshPriceLabels();
  const name = productName(product);
  if (!name) return;
  // Drop the i18n key: this string is data, not a translation table entry, so
  // i18n.apply() must not overwrite it. Re-applied by hand on a language
  // switch instead — see bindLangChange().
  ["panel-product-name", "sheet-product-name"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) { el.removeAttribute("data-i18n"); el.textContent = name; }
  });
}

/** First customisable product in the catalog — the implicit default garment. */
async function fetchDefaultProduct() {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  if (ctrl) setTimeout(() => ctrl.abort(), 5000);
  const res = await fetch(getApiBase() + "/api/products", ctrl ? { signal: ctrl.signal } : undefined);
  if (!res.ok) return null;
  const list = await res.json();
  const items = Array.isArray(list) ? list : (list && list.products) || [];
  return items.find((p) => (p.product_type || "custom") !== "ready") || null;
}

/**
 * Pick up an artwork the marketplace handed over. market.js writes the chosen
 * work into sessionStorage and sends the visitor here; refetching the image as
 * a File means it goes through exactly the same path as an upload — same
 * downscaling, same print master, same order payload — with the designer's id
 * stamped on the layer so checkout can pay them.
 */
const PENDING_ART_KEY = "loom_pending_art";

async function applyPendingArtwork() {
  let art = null;
  try {
    const raw = sessionStorage.getItem(PENDING_ART_KEY);
    if (!raw) return;
    sessionStorage.removeItem(PENDING_ART_KEY);   // one-shot: a reload must not re-apply it
    art = JSON.parse(raw);
  } catch (e) { return; }
  if (!art || !art.image_url) return;

  try {
    const res = await fetch(art.image_url, { mode: "cors" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const blob = await res.blob();
    const name = (art.title || "artwork").replace(/[^\w\-. ]+/g, "_").slice(0, 60) + ".png";
    const file = new File([blob], name, { type: blob.type || "image/png" });
    _pendingLogoIsNew = true;
    handleImageFile(file, {
      artworkId: art.id,
      markup: art.markup || 0,
      author: art.author || null,
      title: art.title || null,
      imageKey: art.image_key || null,
    });
    const by = art.author ? " · " + art.author : "";
    showToast(CT("mk.applied", "Дизайн добавлен") + by);
  } catch (e) {
    console.warn("[LOOM] could not apply marketplace artwork:", e.message);
    showToast(CT("mk.applyFailed", "Не удалось загрузить работу"), "error");
  }
}

async function loadProductFromSlug() {
  const slug = new URLSearchParams(window.location.search).get("slug");
  let glbUrl = DEFAULT_MODEL_URL;

  if (!slug) {
    // No slug → take name, fabric and model from the default garment. The
    // bundled DEFAULT_MODEL_URL stays as fallback when the catalog call fails
    // or times out (5s), or the product has no glb_url.
    try {
      const def = await fetchDefaultProduct();
      if (def) {
        currentProduct = def;
        applyProductConfig(def);
        setFabricPreset(fabricForProduct(def));
        if (def.glb_url) glbUrl = def.glb_url;
        applyProductToHeader(def);
      }
    } catch (e) {
      console.warn("Default product lookup failed, keeping generic header:", e);
    }
  }

  if (slug) {
    try {
      // 5s cap — on a stalled mobile connection the default model must
      // still appear instead of an endless spinner
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      if (ctrl) setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(getApiBase() + "/api/products/" + encodeURIComponent(slug), ctrl ? { signal: ctrl.signal } : undefined);
      if (res.ok) {
        const product = await res.json();
        // Ready-made designs are bought as-is — no configurator session
        if ((product.product_type || "custom") === "ready") {
          window.location.replace("catalog.html");
          return;
        }
        currentProduct = product;
        applyProductConfig(product);
        setFabricPreset(fabricForProduct(product));
        if (product.glb_url) glbUrl = product.glb_url;
        applyProductToHeader(product);
      } else if (res.status === 404) {
        showProductUnavailable(); // disabled or removed: never sold as the default garment
      }
    } catch (e) {
      console.warn("Product fetch failed, using default model:", e);
    }
  }

  // Remember which garment to fetch; the fetch itself waits for the preview to
  // be opened. ensurePreview3D() awaits _productReady before reading this, so
  // opening the preview early cannot race us into loading the wrong model and
  // then a second one on top of it.
  _pendingGlbUrl = glbUrl;
}

// ── Product config (LOOM-166) ─────────────────────────────────────
// Swatches, sizes and the print area come from the product's `config`
// (GET /api/products[/<slug>], LOOM-165). A null config (an API before
// migration 0022) keeps the built-in lists. Names are data: text only.
let productUnavailable = false;

// Server refusal codes (backend/src/lib/variant.ts) and the same checks here.
const UNSOLD = {
  product_unavailable: ["cfg.productUnavailable", "Этот товар сейчас недоступен"],
  size_unavailable: ["cfg.sizeUnavailable", "Этот размер недоступен — выберите другой"],
  color_unavailable: ["cfg.colorUnavailable", "Этот цвет недоступен — выберите другой"],
};
function unsoldText(code) {
  const k = UNSOLD[code];
  return k ? CT(k[0], k[1]) : "";
}

/** Why the current pick cannot be bought, translated; "" when it can. */
function unsoldReason() {
  if (productUnavailable) return unsoldText("product_unavailable");
  const cfg = currentProduct && currentProduct.config;
  if (!cfg) return "";
  if (Array.isArray(cfg.sizes) && !cfg.sizes.includes(selectedSize)) return unsoldText("size_unavailable");
  if (!colorAvailable(designState.shirtColor)) return unsoldText("color_unavailable");
  return "";
}

/** A disabled or unknown product: say so where its name goes. addToCart refuses. */
function showProductUnavailable() {
  productUnavailable = true;
  ["panel-product-name", "sheet-product-name"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute("data-i18n", "cfg.productUnavailable"); // i18n.apply re-translates it
    el.textContent = unsoldText("product_unavailable");
  });
}

function applyProductConfig(product) {
  const cfg = product && product.config;
  if (!cfg) return;
  try { _applyProductConfig(cfg); }
  catch (e) { console.warn("[LOOM] product config not applied:", e); } // never costs the product load
}
function _applyProductConfig(cfg) {
  applyPrintArea(cfg.print_area);
  if (Array.isArray(cfg.colors) && cfg.colors.length) {
    SHIRT_COLORS.splice(0, SHIRT_COLORS.length, ...cfg.colors.map((c) => ({
      hex: String(c.hex).toUpperCase(),
      name: c.name_ru,
      names: { uz: c.name_uz, ru: c.name_ru, en: c.name_en },
      available: c.available !== false,
    })));
    const first = SHIRT_COLORS.find((c) => c.available);
    if (first) DEFAULT_SHIRT_COLOR = first.hex;
    if (!colorAvailable(designState.shirtColor)) designState.shirtColor = DEFAULT_SHIRT_COLOR;
    buildColorSwatches();
  }
  if (Array.isArray(cfg.sizes) && cfg.sizes.length) buildSizeButtons(cfg.sizes);
  paintShirtColor(designState.shirtColor); // redraws both faces on the new rect
}

// DEFAULT_PRINT_RECTS and FLAT_ART's print boxes were measured at these.
const SEED_W_FRAC = 0.55, SEED_TOP_FRAC = 0.20;

/** The product's platen on the seeded rects: same neckline and centre, its own width, drop and aspect. */
function applyPrintArea(pa) {
  const pc = pa && pa.platen_cm;
  const wf = Number(pa && pa.width_frac), tf = Number(pa && pa.top_frac);
  if (!pc || !(pc.w > 0 && pc.h > 0 && wf > 0 && wf <= 1 && tf >= 0 && tf <= 1)) return;
  PLATEN_CM.w = Number(pc.w);
  PLATEN_CM.h = Number(pc.h);
  PLATEN_W_FRAC = wf;
  PLATEN_TOP_FRAC = tf;
  const k = wf / SEED_W_FRAC;
  ["front", "back"].forEach((v) => {
    const d = DEFAULT_PRINT_RECTS[v], w = d.w * k;
    PRINT_RECTS[v] = { x: d.x + (d.w - w) / 2, y: d.y + tf * w - SEED_TOP_FRAC * d.w, w, h: w * PLATEN_CM.h / PLATEN_CM.w };
    const art = FLAT_ART[v];
    if (!art.seedPrint) art.seedPrint = { ...art.print };
    const f = art.seedPrint, fw = f.w * k;
    art.print = { x: f.x + (f.w - fw) / 2, y: f.y + (tf * fw - SEED_TOP_FRAC * f.w) * art.aspect, w: fw, h: f.h * k };
  });
}

/** Size buttons in the product's order. A size it no longer has is unpicked. */
function buildSizeButtons(sizes) {
  const row = document.getElementById("size-selector");
  if (!row) return;
  if (selectedSize && !sizes.includes(selectedSize)) selectedSize = null;
  row.textContent = "";
  sizes.forEach((sz) => {
    const b = document.createElement("button");
    b.className = "size-btn";
    b.dataset.size = sz;
    b.textContent = sz;
    row.appendChild(b);
  });
  syncPickers();
}

/**
 * Register the decoder for the compressed geometry in DEFAULT_MODEL_URL.
 *
 * Deliberately the only place a codec is named: one vendored file
 * (assets/vendor/meshopt_decoder.js), one function, one call site. Swapping
 * codecs — Draco is the standing candidate, see assets/models/README.md —
 * should touch this function, the <script> tag in configurator.html, and
 * nothing else.
 *
 * Product models fetched from R2 via product.glb_url may be uncompressed.
 * GLTFLoader only calls a registered decoder when the file actually declares
 * EXT_meshopt_compression, so registering unconditionally leaves them alone.
 */
function attachGeometryDecoder(loader) {
  if (typeof MeshoptDecoder === "undefined") {
    // Vendored script missing or blocked. Say so once, clearly: the loader's
    // own error is "setMeshoptDecoder must be called before loading compressed
    // files", which sends you looking in the wrong place.
    console.error("[LOOM] Meshopt decoder not loaded — check assets/vendor/meshopt_decoder.js");
    return loader;
  }
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

function loadShirtModel(glbUrl) {
  const loader = attachGeometryDecoder(new THREE.GLTFLoader());

  // Returns a promise so ensurePreview3D() can sequence on it. A model that
  // fails REJECTS: no stand-in garment, the customer stays in 2D and the next
  // 3D tap retries (ensurePreview3D's catch).
  return new Promise((resolve, reject) => {
  loader.load(
    glbUrl || DEFAULT_MODEL_URL,

    // onLoad
    function (gltf) {
      const object = gltf.scene;
      const extras = (gltf.asset && gltf.asset.extras) || {};
      _modelCredited = String(extras.source || "").indexOf("c1a3e5eb9b5445f4b7d4be82f1127eba") !== -1;
      syncModelCredit();

      // Reset material collections before assigning materials for this model.
      shirtMaterials = [];
      frontPrintMaterials = [];
      backPrintMaterials = [];
      plainColorMaterials = [];
      frontBodyMeshes = [];
      backBodyMeshes = [];

      // Normalize UVs across the whole model to preserve atlas layout
      // and avoid applying the full design on each mesh separately.
      normalizeModelUVsGlobally(object);

      // Replace all mesh materials with a single fabric-like DoubleSide material.
      // Front/back body keep their own maps; sleeves/ribbing stay plain color.
      object.traverse(function (child) {
        if (!child.isMesh) return;

        const originalMaterialName =
          (Array.isArray(child.material)
            ? child.material[0]?.name
            : child.material?.name) || "";
        const matName = originalMaterialName.toLowerCase();

        const isRibbing =
          matName.includes("rib") ||
          matName.includes("neck") ||
          matName.includes("collar") ||
          nodeHasAnyNameInHierarchy(child, ["rib", "neck", "collar"]);
        const isSleeve =
          matName.includes("sleeve") ||
          nodeHasAnyNameInHierarchy(child, ["sleeve"]);
        const isBackBody = nodeHasAnyNameInHierarchy(child, ["body_back"]);
        const isFrontBody =
          nodeHasAnyNameInHierarchy(child, ["body_front"]) ||
          (matName.includes("body") && !isBackBody && !isSleeve && !isRibbing);

        let map = null;
        if (isFrontBody) map = frontTexture;
        if (isBackBody) map = backTexture;
        if (!isFrontBody && !isBackBody) map = plainTexture;

        // Physical, not Standard: cotton needs sheen (see applyFabricDetail).
        // Standard is the fallback for a three build without it — the garment
        // still renders, just without the fibre halo.
        const Fabric = THREE.MeshPhysicalMaterial || THREE.MeshStandardMaterial;
        const mat = new Fabric({
          map,
          // FrontSide, with a BackSide lining added below — see addLining().
          // DoubleSide alone lights the inside of the collar as if it faced
          // the camera, which put a white band across a navy shirt.
          side: THREE.FrontSide,
          roughness: 0.75,
          metalness: 0.0,
          envMapIntensity: FABRIC_ENV_INTENSITY,
        });

        if (!isFrontBody && !isBackBody) {
          mat.color.set(0xffffff);
        }

        // Surface detail. A model authored with its own normal map on native
        // 0–1 UVs keeps it; everything else gets the tiled cotton fabric.
        const orig = Array.isArray(child.material) ? child.material[0] : child.material;
        if (_modelUvNative && orig && orig.normalMap) {
          mat.normalMap = orig.normalMap;
          mat.normalScale = orig.normalScale ? orig.normalScale.clone() : new THREE.Vector2(1, 1);
          if (orig.roughnessMap) { mat.roughnessMap = orig.roughnessMap; mat.roughness = 1.0; }
          mat.userData.ownNormalMap = true;
        } else {
          applyFabricDetail(mat);
        }

        child.material = mat;
        shirtMaterials.push(mat);

        if (isFrontBody) {
          frontPrintMaterials.push(mat);
          frontBodyMeshes.push(child);
        } else if (isBackBody) {
          backPrintMaterials.push(mat);
          backBodyMeshes.push(child);
        } else {
          plainColorMaterials.push(mat);
        }
      });

      scene.add(object);
      shirtObject = object;
      addLining(object);

      // Ensure maps/colors are coherent right after model load.
      applyActiveTexture();

      // Auto-fit: normalize size and frame camera to fill ~75% of viewport.
      fitCameraToObject(object);

      // Lights and the contact shadow follow the garment's final size — which
      // only exists after the fit above rescales the model.
      fitStudioToObject(object);

      // Extract UV→world triangles AFTER the fit (which scales the model), so the
      // 2D editor's texture↔screen map uses final world positions.
      buildMeshTris();

      // The pivot comes only now: every measurement above has read the
      // garment's final world positions, which the entrance never changes.
      startEntrance(object);

      // Hide loading overlay
      hideLoadingOverlay();
      resolve();
    },

    // onProgress
    function (xhr) {
      if (xhr.total) setLoadProgress(Math.round((xhr.loaded / xhr.total) * 100));
    },

    // onError: logged once by showPreviewError()
    reject,
  );
  });
}

// ── Entrance ─────────────────────────────────────────────────────
// The fitted garment sits in a pivot at the aim point. Once per load the pivot
// grows from 0.001 (not 0: a zero scale is a singular matrix) to 1 with a half
// turn. At the end the pivot is the identity, so the garment is exactly where
// the fit put it. Reduced motion skips straight to the end.
const ENTRANCE_MS = 1800;
const _reducedMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
let _pivot = null;       // the garment's parent; exported in the order GLB
let _entrance = null;    // { t0, res } while the entrance runs
let _entranceEnd = Promise.resolve(); // settles when the entrance is over

function startEntrance(object) {
  const at = INITIAL_VIEW.target;
  if (!at || _pivot) return;
  try {
    const pivot = new THREE.Group();
    pivot.position.copy(at);
    object.position.sub(at);
    pivot.add(object);
    scene.add(pivot);
    _pivot = pivot;
    if (_reducedMotion && _reducedMotion.matches) return;
    pivot.scale.setScalar(0.001);
    pivot.rotation.y = Math.PI;
    _entranceEnd = new Promise((res) => { _entrance = { t0: 0, res }; });
  } catch (e) {
    // Never the load-error path: the garment simply shows at full size.
    _entrance = null;
    if (_pivot) { _pivot.scale.setScalar(1); _pivot.rotation.y = 0; }
  }
}

function _stepEntrance(now) {
  // The clock starts on the first frame, so a slow first render can't eat it.
  if (!_entrance.t0) _entrance.t0 = now;
  const p = (now - _entrance.t0) / ENTRANCE_MS;
  if (p >= 1) { finishEntrance(); return; }
  const k = 1 - Math.pow(1 - p, 3); // ease-out
  _pivot.scale.setScalar(0.001 + 0.999 * k);
  _pivot.rotation.y = Math.PI * (1 - k);
}

/** Jump the entrance to its end. Snapshots and the GLB export call it first. */
function finishEntrance() {
  const e = _entrance;
  if (!e) return;
  _entrance = null;
  _pivot.scale.setScalar(1);
  _pivot.rotation.y = 0;
  e.res();
}

function hideLoadingOverlay() {
  const overlay = document.getElementById("loading-overlay");
  if (!overlay) return;
  overlay.style.opacity = "0";
  setTimeout(() => (overlay.style.display = "none"), 500);
}

/**
 * LOOM-209: the free strip of the 3D stage between the 2D/3D pill and the
 * Front/Back toggle, in stage px, when both sit over the stage's centre column
 * (the phone layout; on desktop the pill is in the corner). null otherwise,
 * including while the 3D is hidden.
 */
function chipBand() {
  const box = document.getElementById("three-container");
  const pill = document.querySelector(".surface-toggle");
  const tog = document.querySelector(".view-toggle");
  if (!box || !pill || !tog || !box.clientHeight) return null;
  const c = box.getBoundingClientRect();
  const p = pill.getBoundingClientRect();
  const t = tog.getBoundingClientRect();
  const cx = c.left + c.width / 2;
  const over = (r) => r.height > 0 && r.left < cx && r.right > cx;
  if (!over(p) || !over(t)) return null;
  const GAP = 12; // 8px clear is the floor; the rest absorbs perspective and sampling
  const top = p.bottom - c.top + GAP;
  const bottom = t.top - c.top - GAP;
  if (bottom <= top) return null;
  return { W: c.width, H: c.height, h: bottom - top, dy: (top + bottom - c.height) / 2 };
}

/**
 * Auto-fit model into view so it fills roughly 75% of the viewport.
 * Also computes front/back camera anchors and reasonable zoom limits.
 */
function fitCameraToObject(object) {
  if (!object || !camera || !controls) return;

  object.updateMatrixWorld(true);

  // Normalize model scale first so very small/huge assets frame consistently.
  const initialBox = new THREE.Box3().setFromObject(object);
  const initialSize = initialBox.getSize(new THREE.Vector3());
  const initialMaxDim = Math.max(initialSize.x, initialSize.y, initialSize.z);
  if (initialMaxDim > 0) {
    const desiredMaxDim = 2.2;
    const scale = desiredMaxDim / initialMaxDim;
    object.scale.multiplyScalar(scale);
    object.updateMatrixWorld(true);
  }

  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  if (!(size.x > 0 && size.y > 0 && size.z > 0)) return;

  // Aim at the garment's own centre, level with it, so it sits in the middle
  // of the stage the way the 2D flat does. Aiming at the chest (above centre,
  // camera higher still) pushed the garment down onto the Front/Back toggle.
  // Aim x/z at the TORSO, not the full bbox — the posed sleeves drag the
  // bbox centre sideways, which parks even a centred print off-axis.
  const torsoMeshes = frontBodyMeshes.concat(backBodyMeshes);
  let aim = center;
  if (torsoMeshes.length) {
    const tb = new THREE.Box3();
    torsoMeshes.forEach((m) => tb.expandByObject(m));
    aim = tb.getCenter(new THREE.Vector3());
  }
  const chestTarget = new THREE.Vector3(aim.x, center.y, aim.z);

  // Anchor the front/back views on the GARMENT'S facing axis, not world Z.
  // The scan is rotated ~25° in world space; a world-axis camera views it
  // obliquely, and from an oblique view no print placement can look centred.
  const facing = garmentFacingDir();
  _garmentFacing = facing.clone();

  // Same margin above and below as the 2D stage box leaves under the flat:
  // its bottom padding is what keeps the hem clear of the Front/Back toggle.
  // 88% fill across — a small breathing margin at the sides.
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const stageH = renderer ? renderer.getSize(new THREE.Vector2()).y : 0;
  const stageBox = document.querySelector(".flat-stagebox");
  const clearPx = stageBox ? parseFloat(getComputedStyle(stageBox).paddingBottom) || 0 : 0;
  let fillV = stageH > 0 ? Math.min(0.88, Math.max(0.5, 1 - (2 * clearPx) / stageH)) : 0.88;
  // LOOM-209: where the 2D/3D pill sits over the garment (phone and tablet),
  // fill only the strip between it and the Front/Back toggle; a lens shift
  // below centres the garment in that strip.
  const band = chipBand();
  if (band) fillV = Math.min(0.88, band.h / band.H);
  // Hidden behind the 2D editor: no real stage size and no chips to measure.
  // onWindowResize() fits again once the 3D is shown.
  const box3d = document.getElementById("three-container");
  _refitOnShow = !!box3d && !box3d.clientHeight;
  const tanV = Math.tan(fov * 0.5) * fillV;
  const tanH = Math.tan(fov * 0.5) * Math.max(camera.aspect, 0.01) * 0.88;
  // Fit the real surface from each side, not the bounding box: the garment
  // is deeper on one side, so one shared distance made the Back look bigger
  // than the Front, and the box's corners made both look smaller than needed.
  // The GLB is quantized (normalized ints) and this three.js (r128) does not
  // scale those back on read.
  const NORM = { Int8Array: 127, Uint8Array: 255, Int16Array: 32767, Uint16Array: 65535 };
  const eachVertex = (fn) => object.traverse((m) => {
    const pos = m.isMesh && m.geometry && m.geometry.attributes.position;
    if (!pos) return;
    const q = pos.normalized ? 1 / (NORM[pos.array.constructor.name] || 1) : 1;
    const p = new THREE.Vector3();
    // Every third vertex: the scan is dense (~245k), the extremes move under
    // 0.2px, and a phone does not stall on it during the load.
    for (let i = 0; i < pos.count; i += 3) {
      fn(p.fromBufferAttribute(pos, i).multiplyScalar(q).applyMatrix4(m.matrixWorld).sub(chestTarget));
    }
  });
  const right = new THREE.Vector3(facing.z, 0, -facing.x);
  let distF = 0, distB = 0;
  eachVertex((p) => {
    const reach = Math.max(Math.abs(p.y) / tanV, Math.abs(p.dot(right)) / tanH);
    const depth = p.dot(facing);
    if (reach + depth > distF) distF = reach + depth;
    if (reach - depth > distB) distB = reach - depth;
  });
  const distance = Math.max(distF, distB);
  // Perspective draws the near hem further below centre than the far collar
  // sits above it; lower the aim by half the difference so it is centred.
  let up = 0, down = 0;
  eachVertex((p) => {
    const t = p.y / (distF - p.dot(facing));
    if (t > up) up = t;
    if (-t > down) down = -t;
  });
  chestTarget.y -= ((down - up) / 2) * distF;

  CAM_VIEWS.front.x = chestTarget.x + facing.x * distF;
  CAM_VIEWS.front.y = chestTarget.y;
  CAM_VIEWS.front.z = chestTarget.z + facing.z * distF;
  CAM_VIEWS.back.x = chestTarget.x - facing.x * distB;
  CAM_VIEWS.back.y = chestTarget.y;
  CAM_VIEWS.back.z = chestTarget.z - facing.z * distB;

  camera.near = Math.max(0.01, distance / 120);
  camera.far = Math.max(50, distance * 20 + size.length());
  // A lens shift, not an aim offset: the orbit still turns about the garment.
  if (band) camera.setViewOffset(band.W, band.H, 0, -band.dy, band.W, band.H);
  else camera.clearViewOffset();

  camera.position.set(CAM_VIEWS.front.x, CAM_VIEWS.front.y, CAM_VIEWS.front.z);
  controls.target.copy(chestTarget);
  controls.minDistance = distance * 0.7;
  controls.maxDistance = distance * 1.8;
  controls.update();

  INITIAL_VIEW.position = camera.position.clone();
  INITIAL_VIEW.target = chestTarget.clone();

  camAnim.targetX = camera.position.x;
  camAnim.targetY = camera.position.y;
  camAnim.targetZ = camera.position.z;
  camAnim.targetLookX = controls.target.x;
  camAnim.targetLookY = controls.target.y;
  camAnim.targetLookZ = controls.target.z;
  camAnim.active = false;

  if (renderer && scene && camera) { updateStudioRig(); renderer.render(scene, camera); }
}

// ================================================================
// SECTION 8 — ANIMATION LOOP
// ================================================================

function animate() {
  requestAnimationFrame(animate);

  if (_turn) _stepTurn(performance.now());
  if (_entrance) _stepEntrance(performance.now());

  // Smooth camera lerp for front/back transitions
  if (camAnim.active) {
    const speed = 0.09;
    camera.position.x = THREE.MathUtils.lerp(
      camera.position.x,
      camAnim.targetX,
      speed,
    );
    camera.position.y = THREE.MathUtils.lerp(
      camera.position.y,
      camAnim.targetY,
      speed,
    );
    camera.position.z = THREE.MathUtils.lerp(
      camera.position.z,
      camAnim.targetZ,
      speed,
    );

    controls.target.x = THREE.MathUtils.lerp(
      controls.target.x,
      camAnim.targetLookX,
      speed,
    );
    controls.target.y = THREE.MathUtils.lerp(
      controls.target.y,
      camAnim.targetLookY,
      speed,
    );
    controls.target.z = THREE.MathUtils.lerp(
      controls.target.z,
      camAnim.targetLookZ,
      speed,
    );

    const posDist = camera.position.distanceTo(
      new THREE.Vector3(camAnim.targetX, camAnim.targetY, camAnim.targetZ),
    );
    const lookDist = controls.target.distanceTo(
      new THREE.Vector3(
        camAnim.targetLookX,
        camAnim.targetLookY,
        camAnim.targetLookZ,
      ),
    );
    if (posDist < 0.005 && lookDist < 0.005) {
      camera.position.set(camAnim.targetX, camAnim.targetY, camAnim.targetZ);
      controls.target.set(
        camAnim.targetLookX,
        camAnim.targetLookY,
        camAnim.targetLookZ,
      );
      camAnim.active = false;
    }
  }

  controls.update();
  updateStudioRig();
  // While the flat editor is up the 3D canvas is display:none, so drawing it
  // every frame burns battery on a phone for pixels nobody can see. In split
  // mode it IS on screen, so it draws. Snapshots and exports call
  // renderer.render() explicitly, so they are unaffected either way.
  if (!flatMode) renderer.render(scene, camera);
  // Keep the 2D handles glued to the design as the shirt orbits — but only redraw
  // when the camera actually moved (state changes redraw via redrawActive).
  if (editMode && typeof drawEditor === "function") {
    const k = camera.position.x.toFixed(2) + "," + camera.position.y.toFixed(2) + "," +
      camera.position.z.toFixed(2) + "|" + controls.target.x.toFixed(2) + "," + controls.target.y.toFixed(2);
    if (k !== _lastCamKey) { _lastCamKey = k; drawEditor(); }
  }
}

/** Instantly snap camera to front or back position (no lerp). */
function setCameraView(view) {
  // No camera until the 3D preview boots; ensurePreview3D() opens on designState.activeView then.
  if (!camera || !controls) return;
  const pos = CAM_VIEWS[view];
  const target = INITIAL_VIEW.target || new THREE.Vector3(0, 0, 0);
  camera.position.set(pos.x, pos.y, pos.z);
  controls.target.set(target.x, target.y, target.z);
  controls.update();
  camAnim.active = false;
  if (renderer && camera && scene) { updateStudioRig(); renderer.render(scene, camera); }
}

function bindResetViewButton() {
  const btn = document.getElementById("btn-reset-view");
  if (!btn) return;

  btn.addEventListener("click", () => {
    if (!INITIAL_VIEW.position || !INITIAL_VIEW.target) return;

    // The single side switch (LOOM-186): buttons, texture AND the panel move
    // to the front. It also stops Turntable; the camera glides below.
    setActiveView("front", true);

    camAnim.targetX = INITIAL_VIEW.position.x;
    camAnim.targetY = INITIAL_VIEW.position.y;
    camAnim.targetZ = INITIAL_VIEW.position.z;
    camAnim.targetLookX = INITIAL_VIEW.target.x;
    camAnim.targetLookY = INITIAL_VIEW.target.y;
    camAnim.targetLookZ = INITIAL_VIEW.target.z;
    camAnim.active = true;
  });
}

// ── Camera modes: Free, Turntable, Turntable + zoom ─────────────
// Turntable sets the azimuth from the clock, so one turn takes TURN_MS at any
// frame rate. The zoom tile dollies toward the existing minimum distance and
// back between 30% and 70% of each turn; the orbit limits never change.
const TURN_MS = 8000;
let camMode = "free";
let _turn = null; // running motion: { t0, theta0, r0, zoom, s }
const CAM_MODE_KEYS = {
  free: ["cfg.camFree", "Свободно"],
  turntable: ["cfg.camTurntable", "Вращение"],
  zoom: ["cfg.camTurntableZoom", "Вращение + зум"],
};

function setCamMode(mode) {
  if (!CAM_MODE_KEYS[mode] || mode === camMode) return;
  camMode = mode;
  _turn = null; // Free keeps the pose: the camera simply stops where it is
  _syncCamTiles();
  if (mode === "free") return;
  // Picked in 2D: the same path as the 3D chip. A failed load lands in
  // setFlatMode(true), which selects Free again; the toast is already up.
  if (flatMode) document.getElementById("btn-surface-3d").click();
  if (_preview3D) _preview3D.then(() => { if (camMode === mode && !_turn) _startTurn(); }, () => {});
}

/** Drag, Front/Back, Reset view and 2D end any motion (and the first-design
 *  reward) and select Free. */
function stopCamMotion() {
  cancelReward();
  if (camMode !== "free") setCamMode("free");
}

function _startTurn() {
  if (flatMode || !camera || !controls) return;
  camAnim.active = false;
  const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  _turn = { t0: performance.now(), theta0: s.theta, r0: s.radius, zoom: camMode === "zoom", s };
}

function _stepTurn(now) {
  const T = _turn;
  const p = (now - T.t0) / TURN_MS;
  T.s.setFromVector3(camera.position.clone().sub(controls.target)); // keeps the tilt
  T.s.theta = T.theta0 + 2 * Math.PI * p;
  T.s.radius = T.r0;
  if (T.zoom) {
    const f = p % 1;
    if (f > 0.3 && f < 0.7) {
      // 0.1% above the limit, so float error never puts it under the limit
      const near = Math.min(T.r0, controls.minDistance * 1.001);
      T.s.radius = T.r0 + (near - T.r0) * (1 - Math.cos(2 * Math.PI * (f - 0.3) / 0.4)) / 2;
    }
  }
  camera.position.setFromSpherical(T.s).add(controls.target);
}

function _syncCamTiles() {
  _syncRadios("cam-tiles", ".cam-tile", "active", (b) => b.dataset.cam === camMode);
  const v = document.getElementById("cam-acc-value");
  if (v) {
    const [key, fb] = CAM_MODE_KEYS[camMode];
    v.setAttribute("data-i18n", key);
    v.textContent = CT(key, fb);
  }
}

function setCamAccOpen(open) {
  const head = document.getElementById("cam-acc-head");
  const body = document.getElementById("cam-acc-body");
  if (!head || !body) return;
  head.setAttribute("aria-expanded", String(open));
  body.inert = !open;
}

function bindCamModes() {
  const head = document.getElementById("cam-acc-head");
  const tiles = document.getElementById("cam-tiles");
  if (!head || !tiles) return;
  head.addEventListener("click", () => setCamAccOpen(head.getAttribute("aria-expanded") !== "true"));
  tiles.addEventListener("click", (e) => {
    const b = e.target.closest(".cam-tile");
    if (b) setCamMode(b.dataset.cam);
  });
  _syncCamTiles();
}

// ================================================================
// SECTION 9 — DESIGN CANVAS (2D editing preview in panel)
// ================================================================

const DESIGN_CANVAS_SIZE = 256; // px displayed in panel

/**
 * Redraws BOTH design canvases (text + image tabs share the same texture view).
 */
function refreshDesignCanvas() {
  ["design-canvas", "design-canvas-img"].forEach((id) => {
    const dc = document.getElementById(id);
    if (!dc) return;

    const ctx = dc.getContext("2d");
    const srcCanvas =
      designState.activeView === "front" ? frontTexCanvas : backTexCanvas;

    // Scale the full 1024x1024 texture down to 256x256
    ctx.clearRect(0, 0, DESIGN_CANVAS_SIZE, DESIGN_CANVAS_SIZE);
    ctx.drawImage(srcCanvas, 0, 0, DESIGN_CANVAS_SIZE, DESIGN_CANVAS_SIZE);

    // Draw print-area guide (dashed blue rectangle)
    const sc = DESIGN_CANVAS_SIZE / TEX_SIZE;
    const pr = printRect();
    ctx.save();
    ctx.strokeStyle = "rgba(10, 132, 255, 0.55)";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(pr.x * sc, pr.y * sc, pr.w * sc, pr.h * sc);
    ctx.setLineDash([]);
    ctx.restore();
  });
}

// ================================================================
// SECTION 9b — ACTIVE-ELEMENT HELPERS
// ================================================================

/**
 * The selected element, if it currently has something to draw. Falls back to the
 * topmost drawable element so the handles never vanish after a delete.
 */
function _activeDraggable() {
  const drawable = (e) => (e.type === "text" ? !!e.content : !!e.img);
  const sel = selectedElement();
  if (sel && drawable(sel)) return sel;
  const list = elementsOf();
  for (let i = list.length - 1; i >= 0; i--) if (drawable(list[i])) return list[i];
  return null;
}

// The id of the active, content-bearing element, or null.
function _activeId() {
  const el = _activeDraggable();
  return el ? el.id : null;
}

function _syncSlider(id, dispId, val, suffix) {
  const s = document.getElementById(id); if (s) s.value = val;
  const d = document.getElementById(dispId); if (d) d.textContent = val + suffix;
}

/** Mirror a gesture-driven size/scale change back into the dock's numeric field. */
function _syncSelNum(el) {
  const n = document.getElementById("dock-sel-num");
  if (n && el) n.value = el.type === "text" ? el.size : el.scalePct;
  checkPrintDpi(el); // every scale gesture (drag handle, pinch, flat editor) lands here
}

// ================================================================
// 2D TRANSFORM EDITOR  (flat overlay, decoupled from 3D preview)
// ----------------------------------------------------------------
// Best-practice apparel-customizer model (virtualthreads / Nike By You):
// editing happens on a 2D overlay whose handles are projected LIVE from the
// shirt mesh, so they stay glued to the design at ANY camera angle. Dragging the
// design moves/scales/rotates it; dragging empty shirt ORBITS the product (the
// camera is never locked). The design bakes to the 3D texture via drawTexture so
// the preview stays exact. The "3D / Редактор" chip just shows/hides handles.

let editMode = false;          // design handles shown + editable (orbit still allowed)
let designTabActive = false;   // Design tab currently open
let _ov = null, _ovCtx = null; // overlay canvas + 2d context (pointer-events: none)
let _stage = null;             // #three-container (hosts pointer capture + cursor)
let _editScale = 1;            // texture px per screen px (avg) — nudge/snap units
let _gesture = null;           // active move/scale/rotate gesture
let _pinch = null;             // active two-finger pinch
let _ui = null;                // last-drawn handle positions (page coords) for hit-testing
let _lastCamKey = "";          // camera pose hash → redraw handles only when it moves
const _pointers = new Map();   // pointerId -> {x,y} (only while an edit gesture is active)

const HANDLE_R = 7;            // drawn handle half-size (screen px)
const ROTATE_OFFSET = 34;      // rotate handle distance above the box (screen px)

function _coarsePointer() {
  return !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
}

// ── Exact texture↔screen via mesh projection (no raycasting) ────
// Collect the front/back body geometry as (UV, world-position) triangles, ONCE
// after load. Texture→screen then = find the triangle whose UV contains the
// point, barycentric-interpolate its world position, and camera.project() it.
// Exact (same UVs the bake uses) and fast.
const _UV_BN = 28; // UV bucket grid resolution for fast triangle lookup
function buildMeshTris() {
  if (shirtObject) shirtObject.updateMatrixWorld(true);
  const build = (meshes) => {
    const out = [];
    const tmp = new THREE.Vector3();
    for (const m of meshes) {
      const g = m.geometry;
      if (!g || !g.attributes || !g.attributes.position || !g.attributes.uv) continue;
      const pos = g.attributes.position, uv = g.attributes.uv;
      const idx = g.index ? g.index.array : null;
      const count = idx ? idx.length : pos.count;
      const W = (k) => { tmp.set(pos.getX(k), pos.getY(k), pos.getZ(k)).applyMatrix4(m.matrixWorld); return { x: tmp.x, y: tmp.y, z: tmp.z }; };
      for (let t = 0; t + 2 < count; t += 3) {
        const i0 = idx ? idx[t] : t, i1 = idx ? idx[t + 1] : t + 1, i2 = idx ? idx[t + 2] : t + 2;
        out.push({
          ua: uv.getX(i0), va: uv.getY(i0), pa: W(i0),
          ub: uv.getX(i1), vb: uv.getY(i1), pb: W(i1),
          uc: uv.getX(i2), vc: uv.getY(i2), pc: W(i2),
        });
      }
    }
    return out;
  };
  // UV-space bucket index: each tri added to every bucket its UV bbox overlaps,
  // so texToScreenMesh only tests a handful of candidates (per-frame friendly).
  const index = (tris) => {
    const BN = _UV_BN, buckets = new Array(BN * BN);
    const clampB = (n) => Math.max(0, Math.min(BN - 1, n | 0));
    for (const t of tris) {
      const u0 = Math.min(t.ua, t.ub, t.uc), u1 = Math.max(t.ua, t.ub, t.uc);
      const v0 = Math.min(t.va, t.vb, t.vc), v1 = Math.max(t.va, t.vb, t.vc);
      const bi0 = clampB(u0 * BN), bi1 = clampB(u1 * BN);
      const bj0 = clampB(v0 * BN), bj1 = clampB(v1 * BN);
      for (let bj = bj0; bj <= bj1; bj++) for (let bi = bi0; bi <= bi1; bi++) {
        (buckets[bj * BN + bi] || (buckets[bj * BN + bi] = [])).push(t);
      }
    }
    return { bn: BN, buckets, all: tris };
  };
  _meshTris = {
    front: index(build(frontBodyMeshes)),
    back: index(build(backBodyMeshes)),
  };
  const before = JSON.stringify(PRINT_RECTS);
  resolvePrintRects();
  // The textures were first painted against the legacy fallback rect, before any
  // mesh existed to measure. Anything already placed — a cart item rehydrated
  // while the GLB was still downloading — has to be re-baked against the real
  // rects, or it stays at the fallback's coordinates.
  if (JSON.stringify(PRINT_RECTS) !== before && frontTexCanvas && backTexCanvas) {
    drawTexture("front");
    drawTexture("back");
    applyActiveTexture();
  }
}

/**
 * Measure each face's print rect off its own mesh.
 *
 * The garment is one globally-normalised UV atlas, so the front and back panels
 * sit at different offsets and different scales within it — the reason a single
 * shared rect put artwork ~150px off-centre on the front and ~250px off on the
 * back. For each face we take:
 *   • the panel's texture-space bbox            → the vertical scale reference
 *   • the texture column that maps to the       → the true garment centreline
 *     panel's mid-plane in world X
 * and lay a PLATEN_CM-sized rect on it. The two rects differ in texture px while
 * describing the SAME physical 30×40 cm, which is exactly the point.
 */
function resolvePrintRects() {
  ["front", "back"].forEach((view) => {
    const rect = measurePrintRect(view);
    if (rect) PRINT_RECTS[view] = rect;
  });
  buildCentrelines();
}

// ── Per-height centreline ────────────────────────────────────────
// The stock garment is a posed scan: its midline wanders ~8% of the body width
// between hem and collar. A print rect with one fixed centre column therefore
// reads as off-centre and lopsided at most heights. So instead of a single
// column we measure, for each height, where the torso's own centre actually is,
// and place artwork against THAT. nx 0.5 then sits on the garment's visual
// centreline at whatever height the element happens to be.
const _CENTRELINE_N = 17;                 // rows sampled down the print rect
const _CENTRELINE_M = 5;                  // columns sampled across it
const _centrelines = { front: null, back: null };

// ── Garment-frame lateral axis ───────────────────────────────────
// The scan is rotated ~29° in world space, so "centre in world X" is NOT the
// garment's centre: from the head-on view it reads ~60px right of true. All
// centring math must run along the garment's own left-right axis instead.
function _lateralAxis() {
  const f = _garmentFacing || garmentFacingDir();
  return { x: f.z, z: -f.x }; // facing rotated -90° about Y; (0,0,1) → world X
}
function _latOf(w, L) { return w.x * L.x + w.z * L.z; }

/** Torso width mid-point per world-Y band — front+back together form the tube. */
function _buildTorsoCentreByY() {
  const meshes = frontBodyMeshes.concat(backBodyMeshes);
  if (!meshes.length) return null;
  const L = _lateralAxis();
  const box = new THREE.Box3();
  meshes.forEach((m) => box.expandByObject(m));
  const N = 24, span = box.max.y - box.min.y;
  if (!(span > 0)) return null;
  const lo = new Array(N).fill(Infinity), hi = new Array(N).fill(-Infinity);
  const v = new THREE.Vector3();
  meshes.forEach((m) => {
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m.matrixWorld);
      const k = Math.min(N - 1, Math.max(0, Math.floor((v.y - box.min.y) / span * N)));
      const lat = _latOf(v, L);
      if (lat < lo[k]) lo[k] = lat;
      if (lat > hi[k]) hi[k] = lat;
    }
  });
  const mid = [];
  for (let k = 0; k < N; k++) mid[k] = lo[k] < hi[k] ? (lo[k] + hi[k]) / 2 : null;
  for (let k = 1; k < N; k++) if (mid[k] == null) mid[k] = mid[k - 1];
  for (let k = N - 2; k >= 0; k--) if (mid[k] == null) mid[k] = mid[k + 1];
  if (mid[0] == null) return null;
  // 3-tap smooth — raw bands are noisy where the armhole cuts in
  const sm = mid.map((m, k) => (mid[Math.max(0, k - 1)] + m + mid[Math.min(N - 1, k + 1)]) / 3);
  return { y0: box.min.y, y1: box.max.y, mid: sm };
}

let _torsoCentre = null;
function _torsoCentreAtY(y) {
  if (!_torsoCentre) return 0;
  const { y0, y1, mid } = _torsoCentre;
  const t = Math.max(0, Math.min(1, (y - y0) / (y1 - y0))) * (mid.length - 1);
  const i = Math.min(mid.length - 2, Math.floor(t));
  return mid[i] + (mid[i + 1] - mid[i]) * (t - i);
}

/**
 * Build a row × column grid of texture coordinates for the print area.
 *
 * Every node is solved against a WORLD target: LEVEL heights down the rect and
 * the garment's centre at that height ± symmetric fractions of the platen's
 * real width. Solving texture rows only (the previous scheme) left two scan
 * artifacts visible: a constant atlas width tapers as the physical width
 * drifts, and the atlas rows themselves tilt ~2.5° off level, which tilted the
 * guide AND the baked artwork. Nodes are found by Newton iteration on the
 * texture→world map (a scan line search can't solve two coordinates at once).
 */
function buildCentrelines() {
  _torsoCentre = _buildTorsoCentreByY();
  const L = _lateralAxis();
  ["front", "back"].forEach((view) => {
    const m = _meshTris[view];
    if (!m || !m.all.length || !_torsoCentre) { _centrelines[view] = null; return; }
    const r = PRINT_RECTS[view];

    // Physical extents, measured at the rect's mid row / mid column.
    const midTx = r.x + r.w / 2, midTy = r.y + r.h / 2;
    const wTop = texToWorldMesh(view, midTx, r.y);
    const wBot = texToWorldMesh(view, midTx, r.y + r.h);
    const wl = texToWorldMesh(view, r.x, midTy);
    const wr = texToWorldMesh(view, r.x + r.w, midTy);
    if (!wTop || !wBot || !wl || !wr) { _centrelines[view] = null; return; }
    const yTop = wTop.y, yBot = wBot.y;
    const latL = _latOf(wl, L), latR = _latOf(wr, L);
    const halfW = Math.abs(latR - latL) / 2;
    // The back face is mirrored in the atlas, so +lateral is -u there.
    const flip = latR < latL ? -1 : 1;

    // Fallback Jacobian for probes that fall off the fabric.
    const J0lat = (flip * 2 * halfW) / r.w, J0y = (yBot - yTop) / r.h;

    const solve = (latT, yT, tx, ty) => {
      for (let k = 0; k < 6; k++) {
        const w = texToWorldMesh(view, tx, ty);
        if (!w) { tx = (tx + midTx) / 2; ty = (ty + midTy) / 2; continue; }
        const lat0 = _latOf(w, L);
        const errL = lat0 - latT, errY = w.y - yT;
        if (Math.abs(errL) < 1e-4 && Math.abs(errY) < 1e-4) break;
        // Finite-difference Jacobian [dlat/dtx dlat/dty; dy/dtx dy/dty]
        const h = 4;
        let a = J0lat, b = 0, c = 0, d = J0y;
        let p = texToWorldMesh(view, tx + h, ty), s = h;
        if (!p) { p = texToWorldMesh(view, tx - h, ty); s = -h; }
        if (p) { a = (_latOf(p, L) - lat0) / s; c = (p.y - w.y) / s; }
        p = texToWorldMesh(view, tx, ty + h); s = h;
        if (!p) { p = texToWorldMesh(view, tx, ty - h); s = -h; }
        if (p) { b = (_latOf(p, L) - lat0) / s; d = (p.y - w.y) / s; }
        const det = a * d - b * c;
        if (!det) break;
        tx -= Math.max(-r.w / 4, Math.min(r.w / 4, (d * errL - b * errY) / det));
        ty -= Math.max(-r.h / 4, Math.min(r.h / 4, (-c * errL + a * errY) / det));
      }
      return [tx, ty];
    };

    // ONE centre column for the whole box — the torso centre at the box's mid
    // height. Centring every row at its own height is per-row perfect, but the
    // posed torso LEANS, so the box sheared sideways with it and the eye reads
    // a sheared rectangle as off-centre. A print area is a rigid rectangle:
    // level rows, a single vertical centreline, constant width.
    const cLat = _torsoCentreAtY(yTop + (yBot - yTop) / 2);

    const rows = [];
    for (let i = 0; i < _CENTRELINE_N; i++) {
      const v = i / (_CENTRELINE_N - 1);
      const yT = yTop + (yBot - yTop) * v;
      const cols = [];
      for (let j = 0; j < _CENTRELINE_M; j++) {
        const u = j / (_CENTRELINE_M - 1);
        const latT = cLat + flip * (u - 0.5) * 2 * halfW;
        cols.push(solve(latT, yT, r.x + u * r.w, r.y + v * r.h));
      }
      rows.push(cols);
    }
    _centrelines[view] = rows;
  });
}

/**
 * Texture coordinates [tx, ty] for normalised print position (u, v).
 * Bilinear on the grid; EXTRAPOLATES past the border cells so the Newton
 * inversion in setElTexPos keeps a live derivative at the rect edges.
 */
function texXYAt(view, u, v) {
  const vw = view || designState.activeView;
  const r = printRect(vw);
  const grid = _centrelines[vw];
  if (!grid) return [r.x + u * r.w, r.y + v * r.h];
  const t = v * (grid.length - 1);
  const i = Math.max(0, Math.min(grid.length - 2, Math.floor(t))), ft = t - i;
  const s = u * (_CENTRELINE_M - 1);
  const j = Math.max(0, Math.min(_CENTRELINE_M - 2, Math.floor(s))), fs = s - j;
  const lerp2 = (k) => {
    const a = grid[i][j][k] + (grid[i][j + 1][k] - grid[i][j][k]) * fs;
    const b = grid[i + 1][j][k] + (grid[i + 1][j + 1][k] - grid[i + 1][j][k]) * fs;
    return a + (b - a) * ft;
  };
  return [lerp2(0), lerp2(1)];
}

/**
 * Local angle (radians) of the LEVEL row direction in texture space at (u, v).
 * Baking artwork rotated by this keeps its baseline level on the garment even
 * though the atlas rows tilt ~2.5°. Normalised to (-90°, 90°] so glyphs never
 * flip on the mirrored back face.
 */
function gridTiltAt(view, u, v) {
  const e = 0.05;
  const p0 = texXYAt(view, u - e, v), p1 = texXYAt(view, u + e, v);
  let dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  if (dx < 0) { dx = -dx; dy = -dy; }
  if (!dx && !dy) return 0;
  return Math.atan2(dy, dx);
}

/**
 * LATERAL coordinate of the garment's mirror plane (garment frame, not world X —
 * the scan is rotated ~29°, so a world-X midpoint sits visibly off-centre).
 *
 * Measured from the TORSO only — front + back body panels together. The full
 * model's bbox is skewed by asymmetrically posed sleeves (0.063 on the stock
 * model vs the true 0.004), and either panel alone is skewed the other way
 * because each wraps around the body's sides by a different amount. The two
 * panels as a pair form a closed tube, which is symmetric.
 */
function garmentSymmetryPlaneLat() {
  const meshes = frontBodyMeshes.concat(backBodyMeshes);
  if (!meshes.length) return 0;
  const L = _lateralAxis();
  let lo = Infinity, hi = -Infinity;
  const v = new THREE.Vector3();
  meshes.forEach((m) => {
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m.matrixWorld);
      const lat = _latOf(v, L);
      if (lat < lo) lo = lat;
      if (lat > hi) hi = lat;
    }
  });
  return lo < hi ? (lo + hi) / 2 : 0;
}

/**
 * Horizontal unit vector pointing out of the garment's FRONT.
 *
 * The posed scan is rotated ~25° in world space, so cameras anchored on the
 * world Z axis view the shirt from an angle and the print area reads
 * off-centre no matter how correctly it is placed. Derived from panel vertex
 * centroids (front minus back) rather than averaged normals — the cloth has
 * an inner shell whose normals face backwards and poison any normal average.
 */
function garmentFacingDir() {
  const centroid = (meshes) => {
    const s = new THREE.Vector3(), v = new THREE.Vector3();
    let n = 0;
    meshes.forEach((m) => {
      const p = m.geometry.attributes.position;
      for (let i = 0; i < p.count; i += 7) {
        v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m.matrixWorld);
        s.add(v); n++;
      }
    });
    return n ? s.multiplyScalar(1 / n) : null;
  };
  const f = centroid(frontBodyMeshes), b = centroid(backBodyMeshes);
  if (!f || !b) return new THREE.Vector3(0, 0, 1);
  const d = f.sub(b);
  d.y = 0;
  return d.lengthSq() > 1e-8 ? d.normalize() : new THREE.Vector3(0, 0, 1);
}

function measurePrintRect(view) {
  const m = _meshTris[view];
  if (!m || !m.all.length) return null;

  // Panel bbox in texture space.
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const t of m.all) {
    u0 = Math.min(u0, t.ua, t.ub, t.uc); u1 = Math.max(u1, t.ua, t.ub, t.uc);
    v0 = Math.min(v0, t.va, t.vb, t.vc); v1 = Math.max(v1, t.va, t.vb, t.vc);
  }
  const top = v0 * TEX_SIZE, bottom = v1 * TEX_SIZE;
  const panelL = u0 * TEX_SIZE, panelR = u1 * TEX_SIZE;
  const panelW = panelR - panelL, panelH = bottom - top;
  if (!(panelW > 0) || !(panelH > 0)) return null;

  // ── Centreline ────────────────────────────────────────────────
  // The garment is mirror-symmetric, so its full bounding box gives the symmetry
  // plane; the centreline of a face is the column that lands on it. A panel's own
  // row extremes are NOT usable here — both islands wrap around the body's sides
  // by different amounts, which is what put the back's artwork ~120px off.
  const latPlane = garmentSymmetryPlaneLat();
  const L = _lateralAxis();
  const rowCentre = (ty) => {
    let best = null, bestDx = Infinity;
    for (let tx = panelL; tx <= panelR; tx += 3) {
      const w = texToWorldMesh(view, tx, ty);
      if (!w) continue;
      const dx = Math.abs(_latOf(w, L) - latPlane);
      if (dx < bestDx) { bestDx = dx; best = tx; }
    }
    return best;
  };
  const cands = [0.30, 0.45, 0.60]
    .map((f) => rowCentre(top + panelH * f))
    .filter((n) => n != null)
    .sort((a, b) => a - b);
  if (!cands.length) return null;
  const centerTx = cands[(cands.length - 1) >> 1];

  // ── Neckline on that column ───────────────────────────────────
  // Walking down the centre column, the first row with fabric is the neckline —
  // a far better anchor than the UV bbox top, which is the shoulder/sleeve seam.
  let neckTy = null;
  for (let ty = top; ty <= bottom; ty += 2) {
    if (texToWorldMesh(view, centerTx, ty)) { neckTy = ty; break; }
  }
  if (neckTy == null) return null;

  // ── Lay the platen on it ──────────────────────────────────────
  // Width comes from the panel's HORIZONTAL extent: front and back are the same
  // width in the atlas (they're the same garment width), so the printable area
  // comes out the same size in texture px on both — only the placement differs.
  const w = PLATEN_W_FRAC * panelW;
  const h = w * (PLATEN_CM.h / PLATEN_CM.w);
  let x = centerTx - w / 2;
  let y = neckTy + PLATEN_TOP_FRAC * w;

  // A model with an unexpected unwrap must not push the rect off the fabric.
  if (!(w > 0) || !(h > 0) || w > panelW || h > panelH) return null;
  x = Math.max(panelL, Math.min(panelR - w, x));
  y = Math.max(top, Math.min(bottom - h, y));

  return { x, y, w, h };
}

/** Barycentric texture→world lookup on a face's triangles (no camera involved). */
function texToWorldMesh(view, tx, ty) {
  const m = _meshTris[view];
  if (!m || !m.all.length) return null;
  const u = tx / TEX_SIZE, v = ty / TEX_SIZE;
  const BN = m.bn;
  const bi = Math.max(0, Math.min(BN - 1, (u * BN) | 0));
  const bj = Math.max(0, Math.min(BN - 1, (v * BN) | 0));
  const cand = m.buckets[bj * BN + bi] || m.all;
  for (const t of cand) {
    const v0x = t.ub - t.ua, v0y = t.vb - t.va;
    const v1x = t.uc - t.ua, v1y = t.vc - t.va;
    const den = v0x * v1y - v1x * v0y;
    if (den === 0) continue;
    const v2x = u - t.ua, v2y = v - t.va;
    const wb = (v2x * v1y - v1x * v2y) / den;
    const wc = (v0x * v2y - v2x * v0y) / den;
    const wa = 1 - wb - wc;
    if (wa >= -1e-4 && wb >= -1e-4 && wc >= -1e-4) {
      return {
        x: t.pa.x * wa + t.pb.x * wb + t.pc.x * wc,
        y: t.pa.y * wa + t.pb.y * wb + t.pc.y * wc,
        z: t.pa.z * wa + t.pb.z * wb + t.pc.z * wc,
      };
    }
  }
  return null;
}

const _projV = (typeof THREE !== "undefined") ? new THREE.Vector3() : null;
// texture px → screen (page) px, exact via the active face's mesh triangles.
function texToScreenMesh(tx, ty) {
  const m = _meshTris[designState.activeView];
  if (!m || !m.all.length || !camera || !renderer) return null;
  const u = tx / TEX_SIZE, v = ty / TEX_SIZE; // textures use flipY=false → v = ty/TEX
  const BN = m.bn;
  const bi = Math.max(0, Math.min(BN - 1, (u * BN) | 0));
  const bj = Math.max(0, Math.min(BN - 1, (v * BN) | 0));
  const cand = m.buckets[bj * BN + bi];
  const test = (list) => {
    let bt = null, bwa = 0, bwb = 0, bwc = 0, bestPen = Infinity;
    for (const t of list) {
      const v0x = t.ub - t.ua, v0y = t.vb - t.va;
      const v1x = t.uc - t.ua, v1y = t.vc - t.va;
      const den = v0x * v1y - v1x * v0y;
      if (den === 0) continue;
      const v2x = u - t.ua, v2y = v - t.va;
      const wb = (v2x * v1y - v1x * v2y) / den;
      const wc = (v0x * v2y - v2x * v0y) / den;
      const wa = 1 - wb - wc;
      if (wa >= -1e-4 && wb >= -1e-4 && wc >= -1e-4) return { bt: t, bwa: wa, bwb: wb, bwc: wc, pen: 0 };
      const pen = (wa < 0 ? -wa : 0) + (wb < 0 ? -wb : 0) + (wc < 0 ? -wc : 0);
      if (pen < bestPen) { bestPen = pen; bt = t; bwa = wa; bwb = wb; bwc = wc; }
    }
    return bt ? { bt, bwa, bwb, bwc, pen: bestPen } : null;
  };
  let r = cand && cand.length ? test(cand) : null;
  if (!r || r.pen > 0.02) { const r2 = test(m.all); if (r2 && (!r || r2.pen < r.pen)) r = r2; } // fallback
  if (!r) return null;
  _projV.set(
    r.bt.pa.x * r.bwa + r.bt.pb.x * r.bwb + r.bt.pc.x * r.bwc,
    r.bt.pa.y * r.bwa + r.bt.pb.y * r.bwb + r.bt.pc.y * r.bwc,
    r.bt.pa.z * r.bwa + r.bt.pb.z * r.bwb + r.bt.pc.z * r.bwc,
  ).project(camera);
  const rect = renderer.domElement.getBoundingClientRect();
  return {
    x: rect.left + (_projV.x + 1) / 2 * rect.width,
    y: rect.top + (1 - _projV.y) / 2 * rect.height,
  };
}

// ── Print-area → screen mapping ─────────────────────────────────
// Direct, exact, camera-live projection (texToScreenMesh). Because it tracks the
// CURRENT camera, the editor overlay stays glued to the design even while the
// user orbits the shirt — no cached grid to go stale, no camera lock needed.
function texToScreenPA(tx, ty) { return texToScreenMesh(tx, ty); }

// texture px per screen px at the print-area centre, for the live camera —
// used for snap thresholds and keyboard nudge. Recomputed cheaply on demand.
function _updateEditScale() {
  const pa = printRect();
  const a = texToScreenMesh(pa.x + pa.w / 2, pa.y + pa.h / 2);
  const b = texToScreenMesh(pa.x + pa.w / 2 + 100, pa.y + pa.h / 2);
  const c = texToScreenMesh(pa.x + pa.w / 2, pa.y + pa.h / 2 + 100);
  if (!a) return;
  const sx = b ? 100 / Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)) : _editScale;
  const sy = c ? 100 / Math.max(1, Math.hypot(c.x - a.x, c.y - a.y)) : _editScale;
  _editScale = (sx + sy) / 2;
}
// Convert a SCREEN-space drag delta to a TEXTURE-space delta at point (tx,ty),
// using the LOCAL forward Jacobian (∂screen/∂tex). Robust everywhere the forward
// map is accurate — unlike a global inverse, it can't pick the wrong cell where
// the warped grid folds near the garment's curved edges. Used by the move drag.
function _screenToTexDelta(tx, ty, dsx, dsy) {
  const eps = 4;
  const p = texToScreenPA(tx, ty);
  const px = texToScreenPA(tx + eps, ty), py = texToScreenPA(tx, ty + eps);
  if (!p || !px || !py) return { dtx: 0, dty: 0 };
  const Jxx = (px.x - p.x) / eps, Jyx = (px.y - p.y) / eps; // ∂screen/∂tx
  const Jxy = (py.x - p.x) / eps, Jyy = (py.y - p.y) / eps; // ∂screen/∂ty
  const det = Jxx * Jyy - Jxy * Jyx || 1e-6;
  return {
    dtx: (Jyy * dsx - Jxy * dsy) / det,
    dty: (-Jyx * dsx + Jxx * dsy) / det,
  };
}

// An element's 4 box corners (TL,TR,BR,BL) in TEXTURE space, rotated.
function _elementBoxTex(id) {
  const box = _boxes[designState.activeView] && _boxes[designState.activeView][id];
  if (!box) return null;
  const rot = box.rot || 0;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const hw = box.w / 2, hh = box.h / 2;
  const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([dx, dy]) => ({
    tx: box.cx + dx * cs - dy * sn,
    ty: box.cy + dx * sn + dy * cs,
  }));
  return { cx: box.cx, cy: box.cy, rot, pts };
}

function _boxQuadPage(id) {
  const b = _elementBoxTex(id);
  if (!b) return null;
  const pts = b.pts.map((p) => texToScreenMesh(p.tx, p.ty));
  return pts.every(Boolean) ? pts : null;
}

function _pointInQuad(px, py, q) {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const xi = q[i].x, yi = q[i].y, xj = q[j].x, yj = q[j].y;
    if (((yi > py) !== (yj > py)) &&
        (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-6) + xi)) inside = !inside;
  }
  return inside;
}

// Topmost OTHER element under the pointer, for click-to-select. Walks the list
// back-to-front so the element drawn on top wins, matching what the user sees.
function _otherElementAt(px, py) {
  const cur = _activeId();
  const list = elementsOf();
  for (let i = list.length - 1; i >= 0; i--) {
    const el = list[i];
    if (el.id === cur) continue;
    const q = _boxQuadPage(el.id);
    if (q && _pointInQuad(px, py, q)) return el.id;
  }
  return null;
}

// ── Overlay rendering (screen space) ────────────────────────────
function drawEditor() {
  if (!_ov || !_ovCtx) return;
  const rect = _ov.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const wantW = Math.round(rect.width * dpr), wantH = Math.round(rect.height * dpr);
  if (_ov.width !== wantW || _ov.height !== wantH) { _ov.width = wantW; _ov.height = wantH; }
  const ctx = _ovCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  _ui = null;
  const ready = _meshTris[designState.activeView] && _meshTris[designState.activeView].all.length;
  if (!editMode || !ready) return;
  // The overlay has no depth test, so when the user orbits to the far side the
  // active face's chrome would float over the fabric. Hide it (and its handles —
  // _ui stays null, so hit-testing goes quiet too) until the face turns back.
  if (_garmentFacing && controls) {
    const camDir = camera.position.clone().sub(controls.target).normalize();
    const sign = designState.activeView === "front" ? 1 : -1;
    if (_garmentFacing.dot(camDir) * sign < 0.06) return;
  }
  _updateEditScale();
  const toL = (p) => ({ x: p.x - rect.left, y: p.y - rect.top }); // page → canvas-local

  // Print-area guide — a STRAIGHT-edged quad between the four measured corners,
  // the same treatment the selection box gets. Tracing the border along the mesh
  // made the dashes ride every fold and wrinkle, which read as a crooked box even
  // when the placement was correct. The corners still come off the centreline
  // grid, so the quad stays centred on the garment's true printable band.
  const view = designState.activeView;
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => {
    const p = texXYAt(view, u, v);
    return texToScreenMesh(p[0], p[1]);
  });
  if (corners.every(Boolean)) {
    const scr = corners.map(toL);
    ctx.save();
    ctx.lineWidth = 1; ctx.setLineDash([6, 6]);
    ctx.beginPath();
    scr.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    // Dark-on-light stroke: a white dash was invisible on a white garment, which is
    // the default colour — the user could not see where the printable area ended.
    ctx.strokeStyle = "rgba(0,0,0,0.30)";
    ctx.stroke();
    ctx.restore();
  }

  // Active-element selection box + handles
  const activeId = _activeId();
  const box = activeId ? _elementBoxTex(activeId) : null;
  if (box) {
    const cornersPage = box.pts.map((p) => texToScreenMesh(p.tx, p.ty)); // TL,TR,BR,BL
    if (cornersPage.some((p) => !p)) return; // box partly off the visible mesh
    const scr = cornersPage.map(toL);
    const topMid = { x: (scr[0].x + scr[1].x) / 2, y: (scr[0].y + scr[1].y) / 2 };
    const botMid = { x: (scr[2].x + scr[3].x) / 2, y: (scr[2].y + scr[3].y) / 2 };
    let nx = topMid.x - botMid.x, ny = topMid.y - botMid.y;
    const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    const rotL = { x: topMid.x + nx * ROTATE_OFFSET, y: topMid.y + ny * ROTATE_OFFSET };

    ctx.save();
    // border
    ctx.strokeStyle = "rgba(10,132,255,0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(scr[0].x, scr[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(scr[i].x, scr[i].y);
    ctx.closePath(); ctx.stroke();
    // rotate stem
    ctx.beginPath(); ctx.moveTo(topMid.x, topMid.y); ctx.lineTo(rotL.x, rotL.y); ctx.stroke();
    // corner handles
    const drawSq = (p) => {
      ctx.beginPath();
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "rgba(10,132,255,0.95)";
      ctx.lineWidth = 2;
      ctx.rect(p.x - HANDLE_R, p.y - HANDLE_R, HANDLE_R * 2, HANDLE_R * 2);
      ctx.fill(); ctx.stroke();
    };
    scr.forEach(drawSq);
    // rotate handle (circle)
    ctx.beginPath();
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "rgba(10,132,255,0.95)";
    ctx.lineWidth = 2;
    ctx.arc(rotL.x, rotL.y, HANDLE_R, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.restore();

    _ui = { corners: cornersPage, rotate: { x: rotL.x + rect.left, y: rotL.y + rect.top } };
  }

  // Center snap guides (while moving)
  if (_gesture && (_gesture.snapX || _gesture.snapY)) {
    const c = toL(texToScreenPA(...at(0.5, 0.5)));
    ctx.save();
    ctx.strokeStyle = "rgba(255,90,90,0.85)";
    ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    if (_gesture.snapX) { ctx.beginPath(); ctx.moveTo(c.x, 0); ctx.lineTo(c.x, rect.height); ctx.stroke(); }
    if (_gesture.snapY) { ctx.beginPath(); ctx.moveTo(0, c.y); ctx.lineTo(rect.width, c.y); ctx.stroke(); }
    ctx.restore();
  }
}

// ── Hit testing (page coords) ───────────────────────────────────
function _hitTest(px, py) {
  if (!_ui) return null;
  const R = _coarsePointer() ? 24 : 16;
  if (Math.hypot(px - _ui.rotate.x, py - _ui.rotate.y) <= R) return { type: "rotate" };
  for (let i = 0; i < 4; i++) {
    const c = _ui.corners[i];
    if (Math.hypot(px - c.x, py - c.y) <= R) return { type: "scale", corner: i };
  }
  if (_pointInQuad(px, py, _ui.corners)) return { type: "move" };
  return null;
}

function _normAngle(a) { // → (-π, π]
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

// ── Pointer handlers ────────────────────────────────────────────
// Attached to #three-container in CAPTURE phase, so we see the gesture before
// OrbitControls (on the canvas below). We only take it over — disabling orbit and
// stopping propagation — when it lands on the design or a handle. Otherwise the
// event flows through to OrbitControls and the user ORBITS the shirt.
function _onEdPointerDown(e) {
  if (!EDIT_ON_3D || !editMode) return;
  if (e.pointerType === "mouse" && e.button != null && e.button !== 0) return;
  // Second finger during an active edit gesture → pinch (scale + rotate)
  if (_gesture && _pointers.size >= 1) {
    _pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (_pointers.size >= 2) { e.preventDefault(); e.stopPropagation(); _startPinch(); }
    return;
  }
  let hit = _activeId() ? _hitTest(e.clientX, e.clientY) : null;
  if (!hit) {
    const otherId = _otherElementAt(e.clientX, e.clientY);
    if (otherId) { selectElement(otherId, { redraw: false }); drawEditor(); hit = { type: "move" }; }
  }
  if (!hit) return; // empty shirt/background → let OrbitControls orbit
  // TAKE OVER this gesture: suppress orbit, capture the pointer.
  e.preventDefault(); e.stopPropagation();
  if (controls) controls.enabled = false;
  _pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { renderer.domElement.setPointerCapture(e.pointerId); } catch (_) {}
  const el = _activeDraggable();
  if (!el) return;
  const tx = elTexX(el), ty = elTexY(el);
  const center = texToScreenMesh(tx, ty) || { x: e.clientX, y: e.clientY };
  if (hit.type === "move") {
    _gesture = { type: "move", lastX: e.clientX, lastY: e.clientY, rawX: tx, rawY: ty };
  } else if (hit.type === "scale") {
    const d0 = Math.hypot(e.clientX - center.x, e.clientY - center.y);
    _gesture = { type: "scale", d0: Math.max(8, d0), startSize: el.type === "text" ? el.size : el.scalePct };
  } else if (hit.type === "rotate") {
    const a0 = Math.atan2(e.clientY - center.y, e.clientX - center.x);
    _gesture = { type: "rotate", a0, startRot: el.rotation || 0 };
  }
}

function _onEdPointerMove(e) {
  if (_pointers.has(e.pointerId)) _pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!editMode) return;
  if (_pinch) { _updatePinch(); e.preventDefault(); return; }
  if (!_gesture) { _updateHoverCursor(e); return; }
  const el = _activeDraggable();
  if (!el) return;

  if (_gesture.type === "move") {
    // Accumulate the UNSNAPPED position so centre-snap magnetism never pins the
    // element (it starts at centre-X); snap only adjusts the displayed value.
    const d = _screenToTexDelta(_gesture.rawX, _gesture.rawY, e.clientX - _gesture.lastX, e.clientY - _gesture.lastY);
    _gesture.lastX = e.clientX; _gesture.lastY = e.clientY;
    _gesture.rawX += d.dtx;
    _gesture.rawY += d.dty;
    // Clamp and snap in NORMALISED space — nx 0.5 IS the garment centreline
    // and ny 0.5 the level mid-height, by construction of the grid.
    setElTexPos(el, _gesture.rawX, _gesture.rawY);
    const u = Math.max(0, Math.min(1, el.nx));
    const v = Math.max(0, Math.min(1, el.ny));
    if (u !== el.nx || v !== el.ny) {
      const back = texXYAt(designState.activeView, u, v);
      _gesture.rawX = back[0]; _gesture.rawY = back[1];
    }
    const r = printRect();
    const thrU = (8 * _editScale) / r.w, thrV = (8 * _editScale) / r.h;
    _gesture.snapX = !e.ctrlKey && Math.abs(u - 0.5) < thrU;
    _gesture.snapY = !e.ctrlKey && Math.abs(v - 0.5) < thrV;
    el.nx = _gesture.snapX ? 0.5 : u;
    el.ny = _gesture.snapY ? 0.5 : v;
    scheduleRedraw();
  } else if (_gesture.type === "scale") {
    const center = texToScreenPA(elTexX(el), elTexY(el));
    if (!center) return;
    const ratio = Math.hypot(e.clientX - center.x, e.clientY - center.y) / _gesture.d0;
    if (el.type === "text") {
      el.size = Math.round(Math.max(24, Math.min(240, _gesture.startSize * ratio)));
      _syncSelNum(el);
    } else {
      el.scalePct = Math.round(Math.max(10, Math.min(200, _gesture.startSize * ratio)));
      _syncSelNum(el);
    }
    scheduleRedraw();
  } else if (_gesture.type === "rotate") {
    const center = texToScreenPA(elTexX(el), elTexY(el));
    if (!center) return;
    const a = Math.atan2(e.clientY - center.y, e.clientX - center.x);
    let rot = _gesture.startRot + (a - _gesture.a0);
    if (e.shiftKey) {
      const s = Math.PI / 12; rot = Math.round(rot / s) * s; // 15° steps
    } else {
      for (const s of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        if (Math.abs(_normAngle(rot - s)) < (4 * Math.PI) / 180) { rot = s; break; }
      }
    }
    el.rotation = rot;
    scheduleRedraw();
  }
  e.preventDefault();
}

function _onEdPointerUp(e) {
  if (!_pointers.has(e.pointerId)) return; // wasn't an edit gesture (was orbiting)
  _pointers.delete(e.pointerId);
  if (_pinch && _pointers.size < 2) _pinch = null;
  if (_pointers.size === 0) {
    _gesture = null;
    if (controls && editMode) controls.enabled = true; // restore orbit after the edit
    drawEditor();
  }
  try { renderer.domElement.releasePointerCapture(e.pointerId); } catch (_) {}
}

function _updateHoverCursor(e) {
  if (!_stage) return;
  let hit = _activeId() ? _hitTest(e.clientX, e.clientY) : null;
  if (!hit && _otherElementAt(e.clientX, e.clientY)) hit = { type: "move" };
  // No design hit → leave it to OrbitControls' grab cursor (empty = orbit).
  _stage.style.cursor = !hit ? ""
    : hit.type === "rotate" ? "grab"
    : hit.type === "scale" ? "nwse-resize" : "move";
}

// ── Two-finger pinch (scale + rotate) ───────────────────────────
function _startPinch() {
  const el = _activeDraggable();
  if (!el) return;
  const pts = [..._pointers.values()];
  const d0 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  const a0 = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
  _pinch = { d0: Math.max(8, d0), a0, startSize: el.type === "text" ? el.size : el.scalePct, startRot: el.rotation || 0 };
  _gesture = null;
}
function _updatePinch() {
  const el = _activeDraggable();
  if (!el || !_pinch) return;
  const pts = [..._pointers.values()];
  if (pts.length < 2) return;
  const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  const a = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
  const ratio = d / _pinch.d0;
  if (el.type === "text") {
    el.size = Math.round(Math.max(24, Math.min(240, _pinch.startSize * ratio)));
    _syncSelNum(el);
  } else {
    el.scalePct = Math.round(Math.max(10, Math.min(200, _pinch.startSize * ratio)));
    _syncSelNum(el);
  }
  el.rotation = _pinch.startRot + (a - _pinch.a0);
  scheduleRedraw();
}

// ── Keyboard (nudge / delete) ───────────────────────────────────
// Nudge/delete now target the flat editor, so the step is measured against the
// flat print rect in CSS px — one arrow press moves one on-screen pixel.
function _onEdKeyDown(e) {
  if (!flatMode || e.defaultPrevented) return;
  const ae = document.activeElement;
  if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
  // Arrows and Backspace on a picker, menu or dialog belong to that control:
  // they must never move or delete the artwork behind it.
  if (ae && ae.closest && ae.closest('[role="radiogroup"], [role="menu"], [role="dialog"], dialog')) return;
  const el = _flatActiveEl();
  if (!el) return;
  const r = _flatRect || printRect();
  const du = (e.shiftKey ? 10 : 1) / r.w;
  const dv = (e.shiftKey ? 10 : 1) / r.h;
  if (e.key === "ArrowLeft") el.nx -= du;
  else if (e.key === "ArrowRight") el.nx += du;
  else if (e.key === "ArrowUp") el.ny -= dv;
  else if (e.key === "ArrowDown") el.ny += dv;
  else if (e.key === "Delete" || e.key === "Backspace") { deleteElement(el.id); e.preventDefault(); return; }
  else return;
  el.nx = Math.max(0, Math.min(1, el.nx));
  el.ny = Math.max(0, Math.min(1, el.ny));
  e.preventDefault();
  redrawActive();
}

/** Remove an element from the active view, then select its neighbour. */
function deleteElement(id) {
  const st = designState[designState.activeView];
  const i = st.elements.findIndex((e) => e.id === id);
  if (i < 0) return;
  markUndo("delete");
  st.elements.splice(i, 1);
  delete uploadedFileData[id];
  refreshPriceLabels();
  delete _boxes[designState.activeView][id];
  const next = st.elements[Math.min(i, st.elements.length - 1)];
  st.selId = next ? next.id : null;
  syncPanelFromState();
  redrawActive();
  updateViewToggleMarkers();
  showUndoToast(CT("cfg.deleted", "Слой удалён"));
}

function _deleteActiveElement() {
  const el = _activeDraggable();
  if (el) deleteElement(el.id);
}

// ── Edit / preview (handles on/off) ─────────────────────────────
// Orbit is allowed in BOTH states; the chip only toggles handle visibility.
function _updatePreviewChip() {
  const chip = document.getElementById("btn-toggle-preview");
  if (!chip) return;
  chip.classList.toggle("active", !editMode);
  const lbl = chip.querySelector(".chip-label");
  if (lbl) lbl.textContent = editMode ? "Скрыть рамку" : "Редактор";
}

function enterEditMode() {
  if (!EDIT_ON_3D) return enterPreviewMode();
  editMode = true;
  if (controls) controls.enabled = true; // orbit stays available while editing
  if (_ov) _ov.style.display = "block";
  drawEditor();
  _updatePreviewChip();
}

function enterPreviewMode() {
  editMode = false;
  if (controls) controls.enabled = true;
  if (_ov) _ov.style.display = "none";
  if (_stage) _stage.style.cursor = "";
  drawEditor();
  _updatePreviewChip();
}

function togglePreview() {
  if (editMode) enterPreviewMode(); else enterEditMode();
}

// Editing now lives on the flat face (SECTION 9c). The chip swaps surfaces
// rather than toggling handles, and the 3D shirt stays in preview at all times.
function setDesignEditing(active) {
  designTabActive = active;
  enterPreviewMode();          // 3D never carries handles any more
  setFlatMode(true);           // owns the chip's visibility, split-aware
}

function initDesignEditor() {
  const container = document.getElementById("three-container");
  if (!container) return;
  _stage = container;
  _ov = document.createElement("canvas");
  _ov.id = "editor-canvas";
  // pointer-events:none → empty-area drags fall through to OrbitControls (orbit).
  _ov.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;z-index:10;display:none;pointer-events:none;";
  container.appendChild(_ov);
  _ovCtx = _ov.getContext("2d");
  // Capture phase on the container → we see the gesture before OrbitControls and
  // only steal it (stopPropagation) when it lands on the design/handles.
  container.addEventListener("pointerdown", _onEdPointerDown, true);
  window.addEventListener("pointermove", _onEdPointerMove);
  window.addEventListener("pointerup", _onEdPointerUp);
  window.addEventListener("pointercancel", _onEdPointerUp);
  window.addEventListener("keydown", _onEdKeyDown);
  const chip = document.getElementById("btn-toggle-preview");
  if (chip) chip.addEventListener("click", toggleFlatMode);
}

// ================================================================
// SECTION 10 — UI INITIALIZATION
// ================================================================

function initUI() {
  buildColorSwatches();
  buildFontOptions();
  bindTabNav();
  bindViewToggle();
  bindResetViewButton();
  bindColorControls();
  bindTextControls();
  bindImageControls();
  initDesignEditor();
  bindSummaryTab();
  bindSaveDesign();
  bindMobileNav();
  bindSizeSelector();
  bindPickerKeys();
  bindCenterButtons();
  bindLayerControls();
  bindFlatEditor();
  bindSurfaceToggle();
  bindCamModes();
  bindSheet();
  bindKeyboardLayout();
  bindStepNext();
  bindLab();
  bindMoreMenu();
  bindFullscreen();
  bindCart();
  bindSizeGuide();
  bindLangChange();
  syncPanelFromState();
  // The dock replaced the Design tab, so editing is live from page load.
  setDesignEditing(true);
  trackStep("cfg_open");
}

// Expand/collapse the size guide under the size picker
function bindSizeGuide() {
  const toggle = document.getElementById("sizeGuideToggle");
  const body = document.getElementById("sizeGuideBody");
  if (!toggle || !body) return;
  toggle.addEventListener("click", () => {
    const open = body.hasAttribute("hidden");
    if (open) body.removeAttribute("hidden"); else body.setAttribute("hidden", "");
    toggle.setAttribute("aria-expanded", String(open));
  });
}

// Refresh JS-rendered strings when the language changes
function bindLangChange() {
  window.addEventListener("loom:langchange", () => {
    // Untouched text is a localized sample on the garment, not customer copy.
    // Refresh the sample for the new language while leaving its input empty.
    let refreshedPlaceholder = false;
    ["front", "back"].forEach((view) => {
      elementsOf(view).forEach((el) => {
        if (el.type !== "text" || !el.placeholder) return;
        el.content = CT("cfg.newTextDefault", "Ваш текст");
        refreshedPlaceholder = true;
      });
    });
    if (refreshedPlaceholder) {
      syncPanelFromState();
      drawTexture("front");
      drawTexture("back");
      applyActiveTexture();
    }
    // Summary tab (if visible) uses translated color/labels
    try { if (typeof updateSummaryTab === "function") updateSummaryTab(); } catch (e) {}
    try { if (typeof renderCart === "function") renderCart(); } catch (e) {}
    // JS-written labels: the CTA swaps between two keys by state, and the
    // flat editor paints its "область печати" caption into a canvas.
    try { if (typeof updateCartCta === "function") updateCartCta(); } catch (e) {}
    try { if (typeof renderFlatEditor === "function") renderFlatEditor(); } catch (e) {}
    // The garment's name is data with its own per-language columns, so it is
    // re-resolved here rather than by i18n.apply().
    try { if (currentProduct) applyProductToHeader(currentProduct); } catch (e) {}
    try { buildColorSwatches(); } catch (e) {} // colour names in the new language
  });
}

// ----------------------------------------------------------------
// Dock toolbar — add layers, the shared numeric field, layout save/load
// ----------------------------------------------------------------
function bindLayerControls() {
  const on = (id, ev, fn) => {
    const n = document.getElementById(id);
    if (n) n.addEventListener(ev, fn);
  };

  on("btn-add-text", "click", () => addTextElement());
  on("btn-add-logo", "click", () => {
    // "Загрузить дизайн" always adds a NEW layer.
    _pendingLogoIsNew = true;
    const fi = document.getElementById("logo-file-input");
    if (fi) { fi.value = ""; fi.click(); }
  });
  on("btn-remove-selected", "click", () => {
    const el = selectedElement();
    if (el) deleteElement(el.id);
  });

  // One numeric field for both layer types: font px for text, scale % for a logo.
  on("dock-sel-num", "input", (e) => {
    const el = selectedElement();
    if (!el) return;
    const v = parseInt(e.target.value, 10);
    if (!Number.isFinite(v)) return;
    if (el.type === "text") el.size = Math.max(24, Math.min(240, v));
    else { el.scalePct = Math.max(10, Math.min(200, v)); checkPrintDpi(el); }
    scheduleRedraw();
  });

  on("btn-save-layout", "click", saveLayout);
  on("btn-load-layout", "click", loadLayout);
  on("btn-reset-design", "click", resetDesign);
}

// ── Layout save / load (this browser only) ──────────────────────
// Stores the design — including logo pixels — under one localStorage key. Logos
// are data URLs, so a big upload can blow the ~5MB quota; that's caught and
// reported rather than failing silently.
const LAYOUT_KEY = "loom.configurator.layout";

function saveLayout() {
  try {
    const payload = {
      design: JSON.parse(_buildDesignJson()),
      files: {},
      savedAt: new Date().toISOString(),
    };
    ["front", "back"].forEach((v) => elementsOf(v).forEach((el) => {
      const f = uploadedFileData[el.id];
      if (f && f.base64) payload.files[el.id] = f;
    }));
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(payload));
    showToast(CT("cfg.layoutSaved", "Макет сохранён"));
  } catch (e) {
    const quota = e && (e.name === "QuotaExceededError" || e.code === 22);
    showToast(quota
      ? CT("cfg.layoutTooBig", "Макет слишком большой для сохранения")
      : CT("cfg.layoutSaveError", "Не удалось сохранить макет"), "error");
  }
}

async function loadLayout() {
  let payload = null;
  try { payload = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "null"); }
  catch (e) { /* corrupt entry — treated as none */ }
  if (!payload || !payload.design) {
    showToast(CT("cfg.layoutNone", "Сохранённых макетов нет"), "error");
    return;
  }

  const d = payload.design;
  if (d.shirtColor) selectShirtColor(d.shirtColor, null);
  if (d.size) {
    selectedSize = d.size;
    syncPickers();
  }

  for (const view of ["front", "back"]) {
    const st = designState[view];
    st.elements = [];
    st.selId = null;
    const src = (d.v >= 2 && Array.isArray(d[view]?.elements))
      ? d[view].elements
      : _legacyViewToElements(d[view] || {});
    for (const s of src) {
      if (s.type === "text") { st.elements.push(newTextElement(s)); continue; }
      const f = payload.files && payload.files[s.id];
      if (!f || !f.base64) continue;
      const img = await new Promise((resolve) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => resolve(null);
        im.src = f.base64;
      });
      if (!img) continue;
      const el = newImageElement(Object.assign({}, s, { img, key: null }));
      st.elements.push(el);
      uploadedFileData[el.id] = f;
    }
    st.selId = st.elements.length ? st.elements[st.elements.length - 1].id : null;
  }

  syncPanelFromState();
  refreshPriceLabels();
  drawTexture("front");
  drawTexture("back");
  applyActiveTexture();
  redrawActive();
  showToast(CT("cfg.layoutLoaded", "Макет загружен"));
}

/**
 * Where to drop a new element: just under whatever is already on this side, using
 * the real drawn heights so a second layer never lands on top of the first.
 * `ownH` is the newcomer's own normalised height.
 */
function _stackNy(view, ownH) {
  const gap = 0.02;
  return Math.min(0.94 - ownH / 2, _stackTopNy(view) + gap + ownH / 2);
}

/** Bottom edge (normalised) of the lowest element already on this side. */
function _stackTopNy(view) {
  const r = printRect(view);
  const boxes = _boxes[view] || {};
  let lowest = 0;
  elementsOf(view).forEach((el) => {
    const b = boxes[el.id];
    const h = b ? b.h / r.h : 0.18;
    lowest = Math.max(lowest, el.ny + h / 2);
  });
  return lowest;
}

function addTextElement() {
  const st = designState[designState.activeView];
  const proto = newTextElement({
    content: CT("cfg.newTextDefault", "Ваш текст"),
    // The default shows on the shirt but not in the field, which stays empty
    // under its placeholder: the first keystroke replaces the default instead
    // of mixing into it. Placeholder text is omitted by _serializeView().
    placeholder: true,
    // Black-on-black is invisible; start new text with a colour that reads on
    // the current garment. The user can still pick anything afterwards.
    color: _flatDarkGarment() ? "#FFFFFF" : "#000000",
  });
  // Text box height is size × 1.25, expressed against REF_RECT (see elTexSize).
  const ownH = (proto.size * 1.25) / REF_RECT.h;
  const el = Object.assign(proto, {
    ny: st.elements.length ? _stackNy(designState.activeView, ownH) : 0.32,
  });
  st.elements.push(el);
  st.selId = el.id;
  syncPanelFromState();
  redrawActive();
  updateViewToggleMarkers();
  trackStep("cfg_design_add");
  // No 3D reward here on purpose: adding text focuses the input so the user can
  // type, and swapping the surface out from under a focused field is hostile.
  // The reward fires on the image path, where the action is already finished.
  const ti = document.getElementById("text-content-input");
  if (ti) ti.focus();
  return el;
}

const _ICON_TEXT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>';
const _ICON_IMG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';

// ================================================================
// SECTION 9c — FLAT FACE EDITOR (the primary editing surface)
// ----------------------------------------------------------------
// One face at a time, at full size, over flat garment art. This is where the
// user actually designs; the 3D shirt is a preview they can flip to.
//
// Why flat and not the 3D mesh: this canvas maps 1:1 onto the print rect, so a
// drag is a straight nx/ny change — no mesh projection, no unwrap warp, and
// what you see is literally what the print master bakes. The 3D editing path
// (SECTION 9b) is kept in the file but switched off by EDIT_ON_3D; two
// draggable surfaces for one design is what made this confusing to begin with.

/** Master switch for the legacy 3D drag/scale/rotate path. Kept for reference. */
const EDIT_ON_3D = false;

// Flat garment art per face, plus where the printable area sits ON that art,
// expressed as fractions of the drawn garment box.
//
// `back` has no art yet — the source PNG only ships a front view — so the back
// face falls back to the schematic outline below. Drop a back PNG in here and
// it starts using it; nothing else needs to change.
const FLAT_ART = {
  front: {
    src: "configuratorprodutcs/tshirt_flat_white_1200.png",
    srcSmall: "configuratorprodutcs/tshirt_flat_white_600.png",
    aspect: 1, // source is square
    // Measured against the art: torso x 0.278–0.723, collar ≈0.26, hem 0.863.
    // A 30 cm print on the ~50 cm torso → w ≈ 0.267 of the image, from just
    // below the collar. `h` is nominal: the drawn rect's height is derived at
    // render time from the REAL texture print rect so both spaces agree.
    print: { x: 0.3665, y: 0.285, w: 0.267, h: 0.322 },
  },
  // No back photograph exists, so the back is DERIVED from the front art: same
  // silhouette, sleeves and shading, with the front collar painted out and a
  // shallow back neckline drawn in. Measured from the source: the collar's ink
  // is confined to x 0.300–0.698 / y ≤ 0.255 and the torso under it is pure
  // #FFFFFF, so the patch is seamless. Replace with real back art when you have
  // it — drop `deriveBack` and point src/srcSmall at the new file.
  back: {
    src: "configuratorprodutcs/tshirt_flat_white_1200.png",
    srcSmall: "configuratorprodutcs/tshirt_flat_white_600.png",
    aspect: 1,
    print: { x: 0.3665, y: 0.285, w: 0.267, h: 0.322 },
    deriveBack: {
      // band to flatten (source-atop keeps it inside the garment silhouette)
      patch: { x: 0.28, y: 0.09, w: 0.44, h: 0.18 },
      // The front art's silhouette bulges upward where the collar sits (top
      // edge y 0.140 at centre vs 0.156 at x 0.39). A back has no such bulge,
      // so that hump is cut away and replaced by a shallow neckline curve:
      // endpoints on the shoulder line, quadratic control pulling it down.
      neck: { x1: 0.39, x2: 0.61, y: 0.156, cy: 0.202, seam: 0.015 },
    },
  },
};

// Schematic fallback: the same silhouette the dock used to draw, as a path in a
// 100×118 viewBox, so a face with no photographic art still reads as a garment.
const FLAT_OUTLINE = {
  aspect: 100 / 118,
  body: "M31 8 L18 14 L8 27 L18 36 L24 31 L24 110 L76 110 L76 31 L82 36 L92 27 L82 14 L69 8 C67 13 33 13 31 8 Z",
  neck: "M31 8 C33 13 67 13 69 8",
  // Sized so a design occupies the same share of the garment as on the front
  // art (whose print band is 0.267 of the full box; this box is 0.74-shrunk).
  print: { x: 0.32, y: 0.265, w: 0.36, h: 0.4 },
};

const FLAT_HANDLE_R = 7;        // drawn handle half-size (CSS px)
const FLAT_ROTATE_OFFSET = 34;  // rotate handle distance above the box (CSS px)
// Selection colour: the page's --select token, read on the first draw and
// again on a theme switch (loom:themechange, bound in bindFlatEditor).
let _flatSelect = "";

let _flatCv = null, _flatCtx = null;
let _flatBox = null;    // garment box in CSS px
let _flatRect = null;   // print rect in CSS px — the space elements live in
let _flatUI = null;     // { corners:[4], rotate:{x,y} } in CSS px, for hit testing
let _flatBoxes = {};    // element id → drawn box, this face, this render
let _flatGesture = null;
let _flatPinch = null;
const _flatPointers = new Map();
// Fitting the whole garment leaves the print rect ~46 px wide on a phone: text
// is unreadable and the handles overlap. While a layer is selected in step 1
// the garment is scaled up around the rect instead (_flatZoomBox).
const FLAT_ZOOM_MIN_W = 240; // CSS px
let _flatZoomId = null;      // element the zoomed view last centred on; null = not zoomed
let _flatZoomV = 0.5;        // rect y (0 top … 1 bottom) at the canvas's vertical centre
// Keyed by SRC, not by face: front and back share one file (the back is derived
// from it), so this keeps it to a single fetch and a single decode.
const _flatImgCache = {};

// ── Garment art ─────────────────────────────────────────────────

/** The loaded art for a face, or null if there is none / it failed. */
function _flatArtImg(face) {
  const def = FLAT_ART[face];
  if (!def) return null;
  // The editor is never wider than ~600 CSS px, so the 1200 asset covers retina
  // and the 600 covers everything else. The 4713px original is never shipped.
  const hi = (window.devicePixelRatio || 1) > 1.5;
  const src = (hi ? def.src : def.srcSmall) || def.src;
  if (!(src in _flatImgCache)) {
    const img = new Image();
    img.decoding = "async";
    _flatImgCache[src] = img;
    img.onload = () => renderFlatEditor();
    img.onerror = () => { _flatImgCache[src] = null; renderFlatEditor(); };
    img.src = src;
  }
  return _flatImgCache[src];
}

/** The garment's drawn box: aspect-correct, centred, contained in the canvas. */
function _flatGarmentBox(face, W, H) {
  const img = _flatArtImg(face);
  const usingArt = !!(img && img.complete && img.naturalWidth);
  const aspect = usingArt ? FLAT_ART[face].aspect : FLAT_OUTLINE.aspect;
  let w = W, h = W / aspect;
  if (h > H) { h = H; w = H * aspect; }
  if (!usingArt) {
    // The photographic art carries transparent margins (the garment fills ~72%
    // of its box); the outline path fills its box edge to edge. Shrink it so
    // switching to a face without art doesn't make the garment jump in size.
    w *= 0.74; h *= 0.74;
  }
  return { x: (W - w) / 2, y: (H - h) / 2, w, h, usingArt };
}

/**
 * Scale and shift the garment box so the print rect is big enough to edit:
 * as large as fits with room for the label and handles, and at least
 * FLAT_ZOOM_MIN_W wide where the canvas allows. On a phone that rect is taller
 * than the canvas, so the view shows the band around the selected element.
 */
function _flatZoomBox(face, box, el, W, H) {
  const pf = box.usingArt ? FLAT_ART[face].print : FLAT_OUTLINE.print;
  const pr = printRect(face);
  // Same aspect renderFlatEditor forces on the rect.
  const aspect = pr && pr.w && pr.h ? pr.w / pr.h : (pf.w * box.w) / (pf.h * box.h);
  // Corner handles at the sides; the label and the rotate handle above.
  const mx = 24, mTop = FLAT_ROTATE_OFFSET + 14, mBot = 24;
  const rw = Math.min(W - 2 * mx, Math.max(FLAT_ZOOM_MIN_W, (H - mTop - mBot) * aspect));
  const rh = rw / aspect;
  let ry;
  if (rh + mTop + mBot <= H) {
    ry = (H - rh + mTop - mBot) / 2;
  } else {
    // Centre on a newly selected element; afterwards follow it only once its
    // centre has left the view. Never mid-gesture: move deltas are measured
    // against the rect, so shifting it would make the element run away.
    if (el.id !== _flatZoomId) _flatZoomV = el.ny;
    else if (!_flatGesture && !_flatPinch && Math.abs(el.ny - _flatZoomV) * rh > H / 2) _flatZoomV = el.ny;
    // Never past the rect's top (label, rotate handle) or bottom edge.
    ry = Math.min(mTop, Math.max(H - mBot - rh, H / 2 - _flatZoomV * rh));
  }
  _flatZoomV = (H / 2 - ry) / rh;
  _flatZoomId = el.id;
  const s = rw / (pf.w * box.w);
  box.w *= s; box.h *= s;
  box.x = (W - rw) / 2 - pf.x * box.w;
  box.y = ry - pf.y * box.h;
}

// Tinting a 1200px image every pointermove is far too slow, so the coloured
// garment is composited once into an offscreen canvas and reused until the
// face, size or colour actually changes.
const _flatTint = { key: null, cv: null };

function _flatGarmentLayer(face, box, color) {
  const w = Math.max(1, Math.round(box.w)), h = Math.max(1, Math.round(box.h));
  const key = face + "|" + w + "x" + h + "|" + color;
  if (_flatTint.key === key && _flatTint.cv) return _flatTint.cv;

  const cv = document.createElement("canvas");
  // Capped at 2048 px: a zoomed box runs to thousands of px, and past that the
  // store only costs memory and fill time (the art itself is 1200 px).
  const dpr = Math.min(window.devicePixelRatio || 1, 2, 2048 / Math.max(w, h));
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const c = cv.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);

  const img = _flatArtImg(face);
  if (box.usingArt) {
    c.drawImage(img, 0, 0, w, h);

    // Turn the front art into a back view before tinting, so the colour
    // multiply lands on the finished garment rather than half of one.
    const der = FLAT_ART[face] && FLAT_ART[face].deriveBack;
    if (der) {
      const n = der.neck;
      // 1. Flatten the front collar. source-atop paints only where the garment
      //    already is, so it can never spill into the transparent background.
      c.globalCompositeOperation = "source-atop";
      c.fillStyle = "#FFFFFF";
      c.fillRect(der.patch.x * w, der.patch.y * h, der.patch.w * w, der.patch.h * h);

      // 2. Cut the collar hump out of the silhouette, leaving a back neckline.
      c.globalCompositeOperation = "destination-out";
      c.beginPath();
      c.moveTo(n.x1 * w, 0);
      c.lineTo(n.x2 * w, 0);
      c.lineTo(n.x2 * w, n.y * h);
      c.quadraticCurveTo(0.5 * w, n.cy * h, n.x1 * w, n.y * h);
      c.closePath();
      c.fill();

      // 3. Neckband seam, tucked just under the new edge.
      c.globalCompositeOperation = "source-atop";
      c.beginPath();
      c.moveTo(n.x1 * w, (n.y + n.seam) * h);
      c.quadraticCurveTo(0.5 * w, (n.cy + n.seam) * h, n.x2 * w, (n.y + n.seam) * h);
      c.strokeStyle = "rgba(0,0,0,0.16)";
      c.lineWidth = Math.max(1, w * 0.004);
      c.stroke();
      c.globalCompositeOperation = "source-over";
    }

    // The art is white with soft shading, so multiply gives a coloured garment
    // that keeps its folds; destination-in then restores the cut-out alpha.
    // Both are safe here because this offscreen canvas holds nothing else.
    if (String(color).toUpperCase() !== "#FFFFFF") {
      c.globalCompositeOperation = "multiply";
      c.fillStyle = color;
      c.fillRect(0, 0, w, h);
      c.globalCompositeOperation = "destination-in";
      c.drawImage(img, 0, 0, w, h);
      c.globalCompositeOperation = "source-over";
    }
  } else {
    const s = w / 100; // outline viewBox is 100 wide
    c.save();
    c.scale(s, s);
    c.fillStyle = color;
    c.strokeStyle = "rgba(0,0,0,0.22)";
    c.lineWidth = 1.6 / s;
    const body = new Path2D(FLAT_OUTLINE.body);
    c.fill(body); c.stroke(body);
    c.stroke(new Path2D(FLAT_OUTLINE.neck));
    c.restore();
  }

  _flatTint.key = key; _flatTint.cv = cv;
  return cv;
}

// ── Render ──────────────────────────────────────────────────────

/** Repaint the active face: garment, print rect, elements, selection chrome. */
function renderFlatEditor() {
  const cv = _flatCv || (_flatCv = document.getElementById("flat-canvas"));
  if (!cv) return;
  // Measure the CANVAS, not its parent. The parent's clientWidth/Height are
  // padding-box values, but the canvas is laid out in the content box, so
  // using the parent's numbers drew a surface wider and taller than the space
  // it actually occupies — and the garment, centred in that oversized surface,
  // sat off-centre by half the padding. CSS sizes the element (width/height
  // 100%); we only size the backing store, which does not affect layout.
  const cvRect = cv.getBoundingClientRect();
  if (!cvRect.width || !cvRect.height) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(cvRect.width), H = Math.round(cvRect.height);
  if (cv.width !== W * dpr || cv.height !== H * dpr) {
    cv.width = W * dpr; cv.height = H * dpr;
  }
  const ctx = _flatCtx || (_flatCtx = cv.getContext("2d"));
  if (!_flatSelect) _flatSelect = getComputedStyle(document.documentElement).getPropertyValue("--select").trim() || "#d6382d";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const face = designState.activeView;
  _flatArtImg(face); // kicks off the load on first use; repaints on arrival

  const box = _flatGarmentBox(face, W, H);
  // Zoom only while a layer is being edited: steps 2 and 3 show the whole
  // shirt, because picking a colour needs it.
  const zoomEl = currentStep === "design" ? selectedElement(face) : null;
  if (zoomEl) _flatZoomBox(face, box, zoomEl, W, H);
  else _flatZoomId = null;
  _flatBox = box;

  // Ground the garment the same way the 3D does. Without a shadow a white
  // shirt on the light studio sweep is a white shape on a near-white field —
  // it reads as a gap in the page rather than as a product. Not when zoomed:
  // the garment fills the view, and blurring a box that size is slow on a
  // mid-range phone.
  ctx.save();
  if (!zoomEl) {
    ctx.shadowColor = "rgba(19, 19, 17, 0.22)";
    ctx.shadowBlur = Math.max(18, box.w * 0.09);
    ctx.shadowOffsetX = Math.max(6, box.w * 0.022);
    ctx.shadowOffsetY = Math.max(8, box.w * 0.030);
  }
  ctx.drawImage(_flatGarmentLayer(face, box, designState.shirtColor), box.x, box.y, box.w, box.h);
  ctx.restore();

  const rect = _flatPrintRectIn(face, box);
  _flatRect = rect;

  // Print boundary — dashed, always visible, so the printable band is a fact
  // the user can see rather than something they discover by getting clamped.
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = _flatDarkGarment() ? "rgba(255,255,255,0.42)" : "rgba(0,0,0,0.30)";
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();

  // Elements, bottom-of-list first — same call the garment bake uses.
  _flatBoxes = {};
  const sel = designState[face].selId;
  elementsOf(face).forEach((el) => {
    const b = drawElementIn(ctx, el, rect, false);
    if (b) _flatBoxes[el.id] = b;
  });

  _flatDrawLabel(ctx, rect);
  _flatUI = null;
  const active = _flatActiveId();
  if (active && _flatBoxes[active]) _flatDrawChrome(ctx, _flatBoxes[active]);
  if (_flatGesture && (_flatGesture.snapX || _flatGesture.snapY)) _flatDrawSnap(ctx, rect);

  _flatSyncEmptyState();
  updateViewToggleMarkers();
}

/** The print rect inside a drawn garment box, in the same px as the box. */
function _flatPrintRectIn(face, box) {
  const pf = box.usingArt ? FLAT_ART[face].print : FLAT_OUTLINE.print;
  const rect = {
    x: box.x + pf.x * box.w, y: box.y + pf.y * box.h,
    w: pf.w * box.w, h: pf.h * box.h,
  };
  // WYSIWYG contract: text sizes against rect.h, images against rect.w, and the
  // bake does the same against the texture print rect — so this rect must keep
  // that rect's aspect or the two surfaces quietly disagree about proportions.
  const pr = printRect(face);
  if (pr && pr.w && pr.h) rect.h = rect.w / (pr.w / pr.h);
  return rect;
}

/**
 * A mockup of one face drawn from the flat editor's garment art and painter,
 * for orders placed without the 3D preview. Same picture the customer edited,
 * minus the print boundary and selection chrome. Returns a JPEG data URL.
 */
const FLAT_MOCKUP_PX = 900;
async function _renderFlatMockup(face) {
  const img = _flatArtImg(face);
  if (img && !img.complete) {
    await new Promise((resolve) => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", resolve, { once: true });
      setTimeout(resolve, 4000); // no art in time: the outline stands in
    });
  }
  const S = FLAT_MOCKUP_PX;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#F2F0EB"; // JPEG has no alpha; a white garment needs a ground
  ctx.fillRect(0, 0, S, S);
  const box = _flatGarmentBox(face, S, S);
  ctx.save();
  ctx.shadowColor = "rgba(19, 19, 17, 0.22)";
  ctx.shadowBlur = box.w * 0.09;
  ctx.shadowOffsetX = box.w * 0.022;
  ctx.shadowOffsetY = box.w * 0.030;
  ctx.drawImage(_flatGarmentLayer(face, box, designState.shirtColor), box.x, box.y, box.w, box.h);
  ctx.restore();
  const rect = _flatPrintRectIn(face, box);
  elementsOf(face).forEach((el) => drawElementIn(ctx, el, rect, false));
  return c.toDataURL("image/jpeg", 0.85);
}

function _flatDarkGarment() {
  const h = String(designState.shirtColor || DEFAULT_SHIRT_COLOR).replace("#", "");
  if (h.length !== 6) return false;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) < 140;
}

function _flatDrawLabel(ctx, rect) {
  ctx.save();
  // canvas font strings cannot resolve CSS variables — use a concrete stack
  ctx.font = '500 10px system-ui, -apple-system, sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = _flatDarkGarment() ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.38)";
  ctx.fillText(CT("cfg.printArea", "область печати"), rect.x + rect.w / 2, rect.y - 5);
  ctx.restore();
}

/** The element the handles belong to, or null. */
function _flatActiveId() {
  const st = designState[designState.activeView];
  const drawable = (e) => (e.type === "text" ? !!e.content : !!e.img);
  const sel = st.elements.find((e) => e.id === st.selId);
  if (sel && drawable(sel)) return sel.id;
  return null;
}

function _flatActiveEl() {
  const id = _flatActiveId();
  return id ? elementById(id, designState.activeView) : null;
}

/** Box corners (TL,TR,BR,BL) in CSS px, rotated. */
function _flatCorners(b) {
  const rot = b.rot || 0, cs = Math.cos(rot), sn = Math.sin(rot);
  const hw = b.w / 2 + 4, hh = b.h / 2 + 4;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([dx, dy]) => ({
    x: b.cx + dx * cs - dy * sn,
    y: b.cy + dx * sn + dy * cs,
  }));
}

/** Selection box + 4 scale corners + rotate handle — same language as the 3D overlay. */
function _flatDrawChrome(ctx, b) {
  const c = _flatCorners(b);
  const topMid = { x: (c[0].x + c[1].x) / 2, y: (c[0].y + c[1].y) / 2 };
  const botMid = { x: (c[2].x + c[3].x) / 2, y: (c[2].y + c[3].y) / 2 };
  let nx = topMid.x - botMid.x, ny = topMid.y - botMid.y;
  const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
  const rotL = { x: topMid.x + nx * FLAT_ROTATE_OFFSET, y: topMid.y + ny * FLAT_ROTATE_OFFSET };

  ctx.save();
  ctx.strokeStyle = _flatSelect;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(c[0].x, c[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
  ctx.closePath(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(topMid.x, topMid.y); ctx.lineTo(rotL.x, rotL.y); ctx.stroke();

  ctx.fillStyle = "#fff";
  c.forEach((p) => {
    ctx.beginPath();
    ctx.rect(p.x - FLAT_HANDLE_R, p.y - FLAT_HANDLE_R, FLAT_HANDLE_R * 2, FLAT_HANDLE_R * 2);
    ctx.fill(); ctx.stroke();
  });
  ctx.beginPath();
  ctx.arc(rotL.x, rotL.y, FLAT_HANDLE_R, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.restore();

  _flatUI = { corners: c, rotate: rotL };
}

function _flatDrawSnap(ctx, rect) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,90,90,0.85)";
  ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
  if (_flatGesture.snapX) {
    const x = rect.x + rect.w / 2;
    ctx.beginPath(); ctx.moveTo(x, rect.y); ctx.lineTo(x, rect.y + rect.h); ctx.stroke();
  }
  if (_flatGesture.snapY) {
    const y = rect.y + rect.h / 2;
    ctx.beginPath(); ctx.moveTo(rect.x, y); ctx.lineTo(rect.x + rect.w, y); ctx.stroke();
  }
  ctx.restore();
}

// ── Hit testing ─────────────────────────────────────────────────

function _flatPointInQuad(px, py, q) {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const xi = q[i].x, yi = q[i].y, xj = q[j].x, yj = q[j].y;
    if (((yi > py) !== (yj > py)) &&
        (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-6) + xi)) inside = !inside;
  }
  return inside;
}

/** Canvas-local coords for a pointer event. */
function _flatLocal(e) {
  const r = _flatCv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function _flatHitTest(x, y) {
  if (!_flatUI) return null;
  const R = _coarsePointer() ? 24 : 16;
  if (Math.hypot(x - _flatUI.rotate.x, y - _flatUI.rotate.y) <= R) return { type: "rotate" };
  for (let i = 0; i < 4; i++) {
    const c = _flatUI.corners[i];
    if (Math.hypot(x - c.x, y - c.y) <= R) return { type: "scale", corner: i };
  }
  if (_flatPointInQuad(x, y, _flatUI.corners)) return { type: "move" };
  return null;
}

/** Topmost OTHER element under the pointer, for click-to-select. */
function _flatElementAt(x, y) {
  const cur = _flatActiveId();
  const list = elementsOf(designState.activeView);
  for (let i = list.length - 1; i >= 0; i--) {
    const el = list[i];
    if (el.id === cur) continue;
    const b = _flatBoxes[el.id];
    if (b && _flatPointInQuad(x, y, _flatCorners(b))) return el.id;
  }
  return null;
}

// ── Gestures ────────────────────────────────────────────────────

function _flatOnPointerDown(e) {
  if (!_flatCv) return;
  if (e.pointerType === "mouse" && e.button != null && e.button !== 0) return;

  // Second finger on an active gesture → pinch (scale + rotate).
  if (_flatGesture && _flatPointers.size >= 1) {
    _flatPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (_flatPointers.size >= 2) { e.preventDefault(); _flatStartPinch(); }
    return;
  }

  const p = _flatLocal(e);
  let hit = _flatActiveId() ? _flatHitTest(p.x, p.y) : null;
  if (!hit) {
    const other = _flatElementAt(p.x, p.y);
    if (other) { selectElement(other, { redraw: false }); renderFlatEditor(); hit = { type: "move" }; }
  }
  if (!hit && !_flatActiveId()) {
    // Empty garment → drop the selection, the way every canvas editor does.
    // Any selection, drawn or not: an emptied text layer still holds the zoom.
    if (selectedElement()) { selectElement(null); renderFlatEditor(); }
    return;
  }
  // Off the element this may be the first finger of a pinch, so the deselect
  // waits for pointerup (_flatOnPointerUp).
  if (!hit) hit = { type: "pending" };

  e.preventDefault();
  _flatPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { _flatCv.setPointerCapture(e.pointerId); } catch (_) {}

  const el = _flatActiveEl();
  if (!el) return;
  const b = _flatBoxes[el.id];
  const center = b ? { x: b.cx, y: b.cy } : p;

  if (hit.type === "pending") {
    _flatGesture = hit;
  } else if (hit.type === "move") {
    _flatGesture = { type: "move", lastX: p.x, lastY: p.y };
  } else if (hit.type === "scale") {
    const d0 = Math.hypot(p.x - center.x, p.y - center.y);
    _flatGesture = { type: "scale", d0: Math.max(8, d0), startSize: el.type === "text" ? el.size : el.scalePct };
  } else {
    const a0 = Math.atan2(p.y - center.y, p.x - center.x);
    _flatGesture = { type: "rotate", a0, startRot: el.rotation || 0 };
  }
}

function _flatOnPointerMove(e) {
  if (!_flatCv) return;
  if (_flatPointers.has(e.pointerId)) _flatPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (_flatPinch) { _flatUpdatePinch(); e.preventDefault(); return; }
  if (!_flatGesture) { _flatHoverCursor(e); return; }
  if (_flatGesture.type === "pending") return;

  const el = _flatActiveEl();
  if (!el || !_flatRect) return;
  const p = _flatLocal(e);
  const r = _flatRect;

  if (_flatGesture.type === "move") {
    // On a flat, unwarped canvas a screen delta IS a normalised delta.
    el.nx += (p.x - _flatGesture.lastX) / r.w;
    el.ny += (p.y - _flatGesture.lastY) / r.h;
    _flatGesture.lastX = p.x; _flatGesture.lastY = p.y;
    const u = Math.max(0, Math.min(1, el.nx));
    const v = Math.max(0, Math.min(1, el.ny));
    const thr = 8;
    _flatGesture.snapX = !e.ctrlKey && Math.abs(u - 0.5) * r.w < thr;
    _flatGesture.snapY = !e.ctrlKey && Math.abs(v - 0.5) * r.h < thr;
    el.nx = _flatGesture.snapX ? 0.5 : u;
    el.ny = _flatGesture.snapY ? 0.5 : v;
  } else if (_flatGesture.type === "scale") {
    const b = _flatBoxes[el.id];
    if (!b) return;
    const ratio = Math.hypot(p.x - b.cx, p.y - b.cy) / _flatGesture.d0;
    _flatApplyScale(el, _flatGesture.startSize * ratio);
  } else if (_flatGesture.type === "rotate") {
    const b = _flatBoxes[el.id];
    if (!b) return;
    const a = Math.atan2(p.y - b.cy, p.x - b.cx);
    let rot = _flatGesture.startRot + (a - _flatGesture.a0);
    if (e.shiftKey) {
      const s = Math.PI / 12; rot = Math.round(rot / s) * s; // 15° steps
    } else {
      for (const s of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        if (Math.abs(_normAngle(rot - s)) < (4 * Math.PI) / 180) { rot = s; break; }
      }
    }
    el.rotation = rot;
  }

  e.preventDefault();
  scheduleRedraw();
}

function _flatApplyScale(el, raw) {
  if (el.type === "text") el.size = Math.round(Math.max(24, Math.min(240, raw)));
  else el.scalePct = Math.round(Math.max(10, Math.min(200, raw)));
  _syncSelNum(el);
}

function _flatOnPointerUp(e) {
  if (!_flatPointers.has(e.pointerId)) return;
  _flatPointers.delete(e.pointerId);
  if (_flatPinch && _flatPointers.size < 2) _flatPinch = null;
  if (_flatPointers.size === 0) {
    // No second finger came, so it was a tap on the empty garment. A cancelled
    // touch is not a tap.
    if (e.type === "pointerup" && _flatGesture && _flatGesture.type === "pending") selectElement(null);
    _flatGesture = null;
    renderFlatEditor();
  }
  try { _flatCv.releasePointerCapture(e.pointerId); } catch (_) {}
}

function _flatHoverCursor(e) {
  if (!_flatCv || _coarsePointer()) return;
  const p = _flatLocal(e);
  let hit = _flatActiveId() ? _flatHitTest(p.x, p.y) : null;
  if (!hit && _flatElementAt(p.x, p.y)) hit = { type: "move" };
  _flatCv.style.cursor = !hit ? "default"
    : hit.type === "rotate" ? "grab"
    : hit.type === "scale" ? "nwse-resize" : "move";
}

function _flatStartPinch() {
  const el = _flatActiveEl();
  if (!el) return;
  const pts = [..._flatPointers.values()];
  const d0 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  const a0 = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
  _flatPinch = {
    d0: Math.max(8, d0), a0,
    startSize: el.type === "text" ? el.size : el.scalePct,
    startRot: el.rotation || 0,
  };
  _flatGesture = null;
}

function _flatUpdatePinch() {
  const el = _flatActiveEl();
  if (!el || !_flatPinch) return;
  const pts = [..._flatPointers.values()];
  if (pts.length < 2) return;
  const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  const a = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
  _flatApplyScale(el, _flatPinch.startSize * (d / _flatPinch.d0));
  el.rotation = _flatPinch.startRot + (a - _flatPinch.a0);
  scheduleRedraw();
}

// ── Empty state ─────────────────────────────────────────────────
// An untouched face used to be a bare dashed rectangle with nothing to press.
// The first tap should do something, and the target should be the thing the
// user is already looking at.

function _flatSyncEmptyState() {
  const btn = document.getElementById("flat-empty");
  if (!btn || !_flatRect) return;
  // Not while zoomed: a layer (an emptied text) is being edited, and the
  // prompt would cover the whole view.
  const empty = !_flatZoomId && !_viewHasContent(designState.activeView);
  btn.style.display = empty ? "flex" : "none";
  if (!empty) return;
  // This is the beginner's first action, so it has to be readable ON the
  // garment — light grey on a white tee was almost invisible.
  btn.classList.toggle("on-dark", _flatDarkGarment());
  // _flatRect is canvas-local; the button is positioned in the stagebox, whose
  // padding offsets the canvas — offsetLeft/Top bridge the two spaces.
  btn.style.left = (_flatCv.offsetLeft + _flatRect.x) + "px";
  btn.style.top = (_flatCv.offsetTop + _flatRect.y) + "px";
  btn.style.width = _flatRect.w + "px";
  btn.style.height = _flatRect.h + "px";
  // The print rect is a real 30cm print area, so on a phone it is only ~75px
  // wide. A fixed label size overflowed it; scale the prompt to the rect so it
  // stays inside whatever the garment and viewport make of it.
  const s = Math.max(9, Math.min(17, _flatRect.w * 0.085));
  btn.style.fontSize = s.toFixed(1) + "px";
  // Under ~90px the longest word cannot fit on one line at any legible size,
  // so the prompt becomes just the "+" — which still reads as "tap here".
  btn.classList.toggle("compact", _flatRect.w < 90);
  const plus = btn.querySelector(".flat-empty-plus");
  if (plus) {
    const d = Math.max(24, Math.min(52, _flatRect.w * 0.26));
    plus.style.width = plus.style.height = d.toFixed(0) + "px";
    plus.style.fontSize = (d * 0.5).toFixed(0) + "px";
  }
}

function _flatOpenAddSheet() {
  const sheet = document.getElementById("flat-add-sheet");
  if (sheet) sheet.classList.add("open");
}

function _flatCloseAddSheet() {
  const sheet = document.getElementById("flat-add-sheet");
  if (sheet) sheet.classList.remove("open");
}

// ── Wiring ──────────────────────────────────────────────────────

function bindFlatEditor() {
  window.addEventListener("loom:themechange", () => { _flatSelect = ""; renderFlatEditor(); });
  const cv = document.getElementById("flat-canvas");
  if (!cv) return;
  _flatCv = cv;
  _flatCtx = cv.getContext("2d");

  cv.addEventListener("pointerdown", _flatOnPointerDown);
  window.addEventListener("pointermove", _flatOnPointerMove);
  window.addEventListener("pointerup", _flatOnPointerUp);
  window.addEventListener("pointercancel", _flatOnPointerUp);
  // touch-action:none keeps the pinch away from the page everywhere but iOS
  // Safari, which still zooms the page unless its gesture events are cancelled.
  const ed = cv.closest(".flat-editor") || cv;
  ["gesturestart", "gesturechange"].forEach((t) => ed.addEventListener(t, (e) => e.preventDefault(), { passive: false }));

  const empty = document.getElementById("flat-empty");
  if (empty) empty.addEventListener("click", _flatOpenAddSheet);

  const addText = document.getElementById("flat-add-text");
  if (addText) addText.addEventListener("click", () => { _flatCloseAddSheet(); addTextElement(); });

  const addImg = document.getElementById("flat-add-image");
  if (addImg) addImg.addEventListener("click", () => {
    _flatCloseAddSheet();
    _pendingLogoIsNew = true;
    const fi = document.getElementById("logo-file-input");
    if (fi) { fi.value = ""; fi.click(); }
  });

  const back = document.getElementById("flat-add-backdrop");
  if (back) back.addEventListener("click", _flatCloseAddSheet);
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") _flatCloseAddSheet(); });

  // The canvas is percentage-sized, so a viewport change needs a repaint.
  window.addEventListener("resize", () => renderFlatEditor());
  if (window.ResizeObserver && cv.parentElement) {
    new ResizeObserver(() => renderFlatEditor()).observe(cv.parentElement);
  }
  renderFlatEditor();
}

// The dock's old mini-diagram is gone; anything still calling into it lands here.
function renderPositionGuide() { renderFlatEditor(); }

// ================================================================
// SECTION 9d — MOBILE SHEET + STEPS
// ----------------------------------------------------------------
// Design → Цвет и размер → Заказ, landing on Design because that is what the
// visitor clicked "Кастомизация" for. The sheet slides over the garment rather
// than pushing it, and the price + CTA never leave the base.

const SHEET_STEPS = ["design", "color", "order"];
// Every step rests compact: the entire point of a configurator is watching the
// garment change, so the sheet never covers more than 40% of the screen until
// the customer taps or drags the handle to expand it.
// Must match --peek in the phone stylesheet: the CSS derives the stage height
// and the Перед/Зад position from it, and this drives the snap points.
const SHEET_PEEK = 40;      // dvh — every step's resting height, garment keeps the rest
const SHEET_FULL = 86;      // dvh — expanded with the handle
let currentStep = "design";
let _sheetOpen = false;

function _isSheetLayout() {
  return window.matchMedia("(max-width: 900px)").matches;
}

function setStep(step) {
  if (SHEET_STEPS.indexOf(step) < 0) step = "design";
  if (step === "order" && !sizeChosen()) return;
  if (step !== currentStep) setCamAccOpen(false); // collapsed on step entry
  currentStep = step;
  // The 2D zoom belongs to step 1. Repaint now, before the order summary
  // snapshots the flat canvas.
  renderFlatEditor();

  const sheet = document.getElementById("studio-sheet");
  if (sheet) sheet.dataset.step = step;

  document.querySelectorAll(".step-btn").forEach((b) => {
    const on = b.dataset.step === step;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
  });

  // Steps 2 and 3 reuse the existing tab bodies, so the desktop tabs and the
  // mobile steps can never drift apart — there is only one set of markup.
  const want = step === "order" ? "summary" : "color";
  document.querySelectorAll(".tab-content").forEach((tc) => {
    const on = tc.id === "tab-" + want;
    tc.classList.toggle("active", on);
    tc.style.display = on ? "flex" : "none";
  });
  document.querySelectorAll(".tab-btn").forEach((b) => {
    const on = b.dataset.tab === want;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
  });
  if (step === "order") updateSummaryTab();

  markStepsDone();
  updateStepNext();
  animateStepIn();
  snapSheetToStep();
}

/**
 * Replay the step's entrance animation. Re-adding the class alone does
 * nothing — the browser coalesces the remove and the add into no change — so
 * force a reflow between them.
 */
function animateStepIn() {
  [document.getElementById("design-dock"), document.querySelector(".tab-scroll")]
    .forEach((el) => {
      if (!el) return;
      el.classList.remove("step-in");
      void el.offsetWidth;
      el.classList.add("step-in");
    });
}

// The wizard's forward action. Steps 1 and 2 have exactly one button and it
// says where it goes; the cart button only appears on step 3, where deciding
// is actually the task.
const NEXT_STEP = { design: "color", color: "order" };

function updateStepNext() {
  const label = document.getElementById("step-next-label");
  if (!label) return;
  // The long label wraps to two lines in a narrow panel (a 375px phone sheet,
  // the 300-400px desktop panel), so the panel's width picks the short one.
  const narrow = (document.getElementById("studio-sheet")?.clientWidth || window.innerWidth) <= 560;
  const key = currentStep === "design"
    ? (narrow ? "cfg.nextColorShort" : "cfg.nextColor")
    : (narrow ? "cfg.nextOrderShort" : "cfg.nextOrder");
  label.setAttribute("data-i18n", key);
  label.textContent = CT(
    key,
    currentStep === "design"
      ? (narrow ? "Дальше: цвет" : "Дальше: цвет и размер")
      : "Дальше: заказ",
  );
}

// ── LOOM Lab ────────────────────────────────────────────────────
// The AI half of the product. The admin harness behind it is live
// (backend/src/routes/admin-ai.ts), but nothing customer-facing is wired yet,
// so the tile explains what is coming instead of pretending to work. Flip
// LOOM_FLAGS.lab in assets/config.js to release it.

function labEnabled() {
  try { return !!(window.LOOM_FLAGS && window.LOOM_FLAGS.lab); } catch (e) { return false; }
}

function bindLab() {
  const btn = document.getElementById("btn-lab");
  const sheet = document.getElementById("lab-sheet");
  if (!btn || !sheet) return;

  const shell = document.getElementById("studio-sheet");
  if (shell) shell.classList.toggle("lab-live", labEnabled());

  const close = () => sheet.classList.remove("open");
  btn.addEventListener("click", () => {
    trackStep("cfg_lab_teaser");
    sheet.classList.add("open");
  });
  const backdrop = document.getElementById("lab-sheet-backdrop");
  if (backdrop) backdrop.addEventListener("click", close);
  const closeBtn = document.getElementById("lab-sheet-close");
  if (closeBtn) closeBtn.addEventListener("click", close);
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}

function bindStepNext() {
  const btn = document.getElementById("btn-step-next");
  if (!btn) return;
  btn.addEventListener("click", () => setStep(NEXT_STEP[currentStep] || "order"));
  window.addEventListener("resize", updateStepNext);
  updateStepNext();
}

/** A new step starts with the sheet compact. */
function snapSheetToStep() {
  setSheetOpen(false);
}

/**
 * Tick only what the user has genuinely done. Colour always holds a valid
 * value, so ticking it would claim credit for work nobody did — which
 * is exactly the kind of small lie that makes a wizard feel untrustworthy.
 * Design is the only step that can be meaningfully incomplete.
 */
function markStepsDone() {
  const hasDesign = _viewHasContent("front") || _viewHasContent("back");
  document.querySelectorAll(".step-btn").forEach((b) => {
    b.classList.toggle(
      "done",
      b.dataset.step === "design" && hasDesign && currentStep !== "design",
    );
  });
}

function setSheetOpen(open) {
  _sheetOpen = !!open;
  const sheet = document.getElementById("studio-sheet");
  if (!sheet) return;
  sheet.style.setProperty("--sheet-h", (_sheetOpen ? SHEET_FULL : SHEET_PEEK) + "dvh");
}

function bindSheet() {
  document.querySelectorAll(".step-btn").forEach((b) => {
    b.addEventListener("click", () => setStep(b.dataset.step));
  });

  const sheet = document.getElementById("studio-sheet");
  const handle = document.getElementById("sheet-handle");
  if (!sheet || !handle) return;
  sheet.dataset.step = currentStep;
  snapSheetToStep();

  // Drag the handle to resize; release snaps to whichever height is nearer.
  let drag = null;
  handle.addEventListener("pointerdown", (e) => {
    if (!_isSheetLayout()) return;
    drag = { y: e.clientY, h: sheet.getBoundingClientRect().height, moved: false };
    sheet.classList.add("dragging");
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
  });
  handle.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dy = drag.y - e.clientY;
    if (Math.abs(dy) > 3) drag.moved = true;
    const vh = window.innerHeight;
    const min = (SHEET_PEEK / 100) * vh * 0.72;
    const max = (SHEET_FULL / 100) * vh;
    const h = Math.max(min, Math.min(max, drag.h + dy));
    sheet.style.setProperty("--sheet-h", h + "px");
    e.preventDefault();
  });
  const end = (e) => {
    if (!drag) return;
    const h = sheet.getBoundingClientRect().height;
    const mid = ((SHEET_PEEK + SHEET_FULL) / 2 / 100) * window.innerHeight;
    sheet.classList.remove("dragging");
    // A tap (no movement) toggles — dragging a sheet is not obvious to everyone.
    setSheetOpen(drag.moved ? h > mid : !_sheetOpen);
    drag = null;
    try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

// ── On-screen keyboard ──────────────────────────────────────────
// Chrome 108+ and iOS Safari shrink only the VISUAL viewport for the keyboard,
// so the fixed sheet would sit behind it — with the field being typed in.
// While a field in the sheet has focus and the visual viewport is well short
// of the tallest one seen at this width, body.kb-open pins the studio to the
// visual viewport (--vvt/--vvh, phone stylesheet): garment on top, the layer's
// controls under it, everything else away until the keyboard closes. A hardware
// keyboard shrinks nothing, and a fine pointer (desktop) never qualifies.
function bindKeyboardLayout() {
  const vv = window.visualViewport;
  const sheet = document.getElementById("studio-sheet");
  const dock = document.getElementById("design-dock");
  if (!vv || !sheet || !dock) return;
  const body = document.body;
  const tallest = {}; // per layout width, i.e. per orientation
  let dockScroll = 0;
  const update = () => {
    const w = document.documentElement.clientWidth;
    const h = vv.height * vv.scale; // pinch-zoom is not a keyboard
    // innerHeight keeps the full height while only the visual viewport
    // shrinks, so a rotation with the keyboard already up still has a baseline;
    // where the layout viewport shrinks too, the height seen before counts.
    tallest[w] = Math.max(tallest[w] || 0, h, window.innerHeight);
    const f = document.activeElement;
    const open = _isSheetLayout() && matchMedia("(pointer: coarse)").matches &&
      !!f && sheet.contains(f) && f.matches("input, textarea") && h < tallest[w] * 0.75;
    const was = body.classList.contains("kb-open");
    if (open) {
      body.style.setProperty("--vvt", vv.offsetTop + "px");
      body.style.setProperty("--vvh", vv.height + "px");
    }
    // The dock sheds its other rows while open, which resets its scroll; put
    // it back where the field was when the keyboard closes.
    if (open && !was) dockScroll = dock.scrollTop;
    body.classList.toggle("kb-open", open);
    if (open) f.scrollIntoView({ block: "nearest" });
    else if (was) dock.scrollTop = dockScroll;
  };
  // Only the viewport drives this, never focus on its own: a tap on B or ×
  // moves focus at mousedown, and re-laying out the sheet then would send the
  // tap's click to whatever moved under the finger. The keyboard hiding after
  // that blur is a resize, and that resize is what restores the layout.
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
}

// ── Cart CTA state ──────────────────────────────────────────────
// A blank shirt is a real product, so the button is never disabled — but it
// should say what it will actually do, which doubles as a nudge that nothing
// has been designed yet.
function updateCartCta() {
  const btn = document.getElementById("btn-add-to-cart");
  if (!btn) return;
  const label = btn.querySelector("span[data-i18n]");
  if (!label) return;
  const empty = !_viewHasContent("front") && !_viewHasContent("back");
  const key = empty ? "cfg.orderBlank" : "cfg.addToCart";
  label.setAttribute("data-i18n", key);
  label.textContent = CT(key, empty ? "Заказать без принта" : "В корзину");
  btn.classList.toggle("is-blank", empty);
}

// ── "⋯" overflow menu ───────────────────────────────────────────
function bindMoreMenu() {
  const wrap = document.querySelector(".dock-more");
  const btn = document.getElementById("btn-more");
  if (!wrap || !btn) return;
  const menu = document.getElementById("dock-more-menu");
  // Out of the dock entirely — see the CSS note on backdrop-filter.
  if (menu && menu.parentElement !== document.body) document.body.appendChild(menu);
  const close = () => {
    if (menu) menu.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
  };

  /** Anchor the fixed menu to the button, flipping up if it would overflow. */
  const place = () => {
    if (!menu) return;
    const r = btn.getBoundingClientRect();
    menu.style.visibility = "hidden";
    menu.style.left = "0px"; menu.style.top = "0px";
    const mh = menu.offsetHeight, mw = menu.offsetWidth;
    const below = window.innerHeight - r.bottom;
    menu.style.top = (below < mh + 12 ? r.top - mh - 6 : r.bottom + 6) + "px";
    menu.style.left = Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw)) + "px";
    menu.style.visibility = "";
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!menu) return;
    const open = !menu.classList.contains("open");
    menu.classList.toggle("open", open);
    btn.setAttribute("aria-expanded", String(open));
    if (open) {
      // In full screen only the stage is drawn, so the menu goes inside it.
      (document.fullscreenElement || document.body).appendChild(menu);
      place();
    }
  });
  window.addEventListener("resize", () => { if (menu && menu.classList.contains("open")) place(); });
  window.addEventListener("scroll", close, true);
  if (menu) menu.querySelectorAll(".dock-more-item").forEach((i) => i.addEventListener("click", close));
  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target) && !(menu && menu.contains(e.target))) close();
  });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}

/**
 * Desktop full-screen chip. The stage (.studio) goes full screen; the label
 * stays constant and aria-pressed carries the state. Where the Fullscreen API
 * is off (old Safari, an iframe without allowfullscreen) the chip is removed;
 * at 900px and below CSS never shows it.
 */
function bindFullscreen() {
  const slot = document.querySelector(".chip-fs-slot");
  const btn = document.getElementById("btn-fullscreen");
  const studio = document.querySelector(".studio");
  if (!slot || !btn || !studio) return;
  if (!document.fullscreenEnabled) { slot.remove(); return; }
  btn.addEventListener("click", () => {
    (document.fullscreenElement ? document.exitFullscreen() : studio.requestFullscreen()).catch(() => {});
  });
  // Esc, the chip and addToCart() all end up here.
  document.addEventListener("fullscreenchange", () => {
    btn.setAttribute("aria-pressed", String(document.fullscreenElement === studio));
  });
}

// ── Flat ⇄ 3D ───────────────────────────────────────────────────
// The chip that used to toggle handles now swaps the working surface, because
// the 3D shirt is a preview: you look at it, you do not edit on it.

let flatMode = true;

/**
 * The stage shows exactly one surface. Showing the flat editor and the 3D at
 * once read as two different products competing for the screen, and gave each
 * of them half the space — so they take turns instead.
 */
function setFlatMode(on) {
  flatMode = !!on;
  const flat = document.getElementById("flat-editor");
  const three = document.getElementById("three-container");
  if (flat) flat.style.display = flatMode ? "block" : "none";
  if (three) three.style.display = flatMode ? "none" : "block";
  syncModelCredit();

  document.querySelectorAll(".surface-btn").forEach((b) => {
    const on2 = (b.dataset.surface === "flat") === flatMode;
    b.classList.toggle("active", on2);
    b.setAttribute("aria-selected", String(on2));
  });

  if (flatMode) {
    stopCamMotion();
    // The loader belongs to the 3D surface; a load still running continues
    // behind the 2D editor and ensurePreview3D() shows it again on return.
    const overlay = document.getElementById("loading-overlay");
    if (overlay) overlay.style.display = "none";
    renderFlatEditor();
    return;
  }

  // Every route into the 3D — the toggle, the tab buttons, the first-design
  // reward — lands here, so this is the single gate that boots it. Fire and
  // forget: ensurePreview3D() owns the loading and error states, and a
  // rejection is already surfaced there.
  ensurePreview3D().then(() => {
    if (!flatMode && typeof onWindowResize === "function") onWindowResize();
  }).catch(() => {});
  if (renderer && typeof onWindowResize === "function") onWindowResize();
}

/** LOOM-199: the CC BY credit shows with the 3D, and only for the model it credits. */
function syncModelCredit() {
  const el = document.getElementById("model-credit");
  if (el) el.hidden = flatMode || !_modelCredited;
}

function toggleFlatMode() {
  if (flatMode) trackStep("cfg_preview_3d"); // about to show the 3D
  setFlatMode(!flatMode);
}

function bindSurfaceToggle() {
  document.querySelectorAll(".surface-btn").forEach((b) => {
    b.addEventListener("click", () => {
      const wantFlat = b.dataset.surface === "flat";
      if (wantFlat === flatMode) return;
      if (!wantFlat) trackStep("cfg_preview_3d");
      setFlatMode(wantFlat);
    });
  });
}

// First design placed → show it on the shirt, once. The payoff is the reason
// people came; they should not have to discover the 3D toggle to get it.
// The dwell starts once the model is in and its entrance has played: a fixed
// 2.2s from the flip ran out while a slow load was still showing the loader.
const REWARD_DWELL_MS = 2200;
let _flatRewardShown = false;
let _reward = null; // { timer } from the flip until the flip back
function maybeShowFirstDesignReward() {
  if (_flatRewardShown || !_viewHasContent(designState.activeView)) return;
  _flatRewardShown = true;
  if (!flatMode) return; // already in 3D by choice: nothing to flip
  setFlatMode(false);
  const r = (_reward = {});
  _preview3D.then(() => _entranceEnd).then(() => {
    if (_reward !== r) return;
    r.timer = setTimeout(() => { _reward = null; if (!flatMode) setFlatMode(true); }, REWARD_DWELL_MS);
  }, cancelReward);
}

/** The customer took over: the reward leaves the stage as it is. */
function cancelReward() {
  if (_reward) clearTimeout(_reward.timer);
  _reward = null;
}
// A tile tap or a 2D/3D pick cancels it; a drag does through stopCamMotion.
document.addEventListener("click", (e) => {
  if (_reward && e.target.closest && e.target.closest(".cam-tile, .choice-tile, .surface-btn")) cancelReward();
}, true);

// ── Undo (single level) ─────────────────────────────────────────
// Covers the realistic beginner mistake: something was deleted or everything
// was reset, by accident. Not a history stack — one step back, offered in a
// toast at the moment it is useful.

let _undoSnap = null;

function _snapDesign() {
  const clone = (list) => list.map((e) => Object.assign({}, e));
  return {
    front: { elements: clone(designState.front.elements), selId: designState.front.selId },
    back: { elements: clone(designState.back.elements), selId: designState.back.selId },
    activeView: designState.activeView,
    shirtColor: designState.shirtColor,
    size: selectedSize,
    files: Object.assign({}, uploadedFileData),
  };
}

/** Remember the current design before a destructive action. */
function markUndo(label) {
  _undoSnap = { label: label || "", state: _snapDesign() };
}

function performUndo() {
  if (!_undoSnap) return;
  const s = _undoSnap.state;
  _undoSnap = null;
  designState.front.elements = s.front.elements;
  designState.front.selId = s.front.selId;
  designState.back.elements = s.back.elements;
  designState.back.selId = s.back.selId;
  selectedSize = s.size;
  Object.keys(uploadedFileData).forEach((k) => delete uploadedFileData[k]);
  Object.assign(uploadedFileData, s.files);
  paintShirtColor(s.shirtColor); // both faces and the pickers, not only the active face
  if (designState.activeView !== s.activeView) setActiveView(s.activeView);
  syncPanelFromState();
  redrawActive();
  updateViewToggleMarkers();
  refreshPriceLabels();
}

/** Toast with an action. The plain showToast() is pointer-events:none. */
function showUndoToast(message) {
  const old = document.getElementById("loom-undo-toast");
  if (old) old.remove();

  const t = document.createElement("div");
  t.id = "loom-undo-toast";
  t.className = "undo-toast";
  const label = document.createElement("span");
  label.textContent = message;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "undo-toast-btn";
  btn.textContent = CT("cfg.undo", "Отменить");
  t.appendChild(label);
  t.appendChild(btn);
  (document.fullscreenElement || document.body).appendChild(t);

  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  };
  btn.addEventListener("click", () => { performUndo(); close(); });
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(close, 6000);
}

/**
 * Push the selected element's values into the design panel.
 *
 * Every control is write-only against designState, so anything that changes the
 * selection — flipping Перед/Зад, clicking another element on the shirt, adding
 * or deleting a layer — must call this or the form goes stale and silently edits
 * the wrong element.
 */
function syncPanelFromState() {
  const el = selectedElement();
  const isText = !!el && el.type === "text";
  const isImg = !!el && el.type === "image";

  const show = (id, on, mode) => {
    const n = document.getElementById(id);
    if (n) n.style.display = on ? (mode || "flex") : "none";
  };
  show("dock-sel", !!el);
  show("dock-textrow", isText);

  const icon = document.getElementById("dock-sel-icon");
  if (icon) icon.innerHTML = el ? (isText ? _ICON_TEXT : _ICON_IMG) : "";

  const name = document.getElementById("dock-sel-name");
  if (name) name.textContent = el ? (isText ? "" : (el.name || "")) : "";

  const swatch = document.getElementById("text-color-picker");
  if (swatch) {
    // Only a text layer has a colour; keep the control in place for a logo so the
    // strip doesn't reflow, but disable it.
    swatch.style.visibility = isText ? "visible" : "hidden";
    if (isText) swatch.value = el.color;
  }

  // One numeric field drives font size for text and scale % for a logo.
  const num = document.getElementById("dock-sel-num");
  if (num && el) {
    if (isText) { num.min = 24; num.max = 240; num.value = el.size; num.title = "Размер шрифта, px"; }
    else { num.min = 10; num.max = 200; num.value = el.scalePct; num.title = "Масштаб, %"; }
  }

  const ti = document.getElementById("text-content-input");
  if (ti) ti.value = isText && !el.placeholder ? el.content : "";

  if (isText) {
    const fs = document.getElementById("font-family-select");
    if (fs) fs.value = el.font;
    [["btn-bold", "bold"], ["btn-italic", "italic"]].forEach(([id, prop]) => {
      const b = document.getElementById(id);
      if (!b) return;
      b.classList.toggle("active", !!el[prop]);
      b.setAttribute("aria-pressed", String(!!el[prop]));
    });
  }

  // The drag/resize/rotate hint is advice about a thing that is not there
  // yet until something has been added, so it only appears once it applies.
  const hint = document.querySelector(".dock-hint");
  if (hint) {
    hint.style.display =
      (_viewHasContent("front") || _viewHasContent("back")) ? "" : "none";
  }

  updateViewToggleMarkers();
  renderPositionGuide();
}

// ================================================================
// SECTION 10b — CART (Phase 2: account-bound cart + multi-item checkout)
// ================================================================
// Cart state/UI live in the shared module (assets/cart.js → window.LOOM_CART).
// This file only BUILDS payloads (design json, proofs) and hands them over.

function _esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function _authHeaders(json) {
  const h = json ? { "Content-Type": "application/json" } : {};
  const token = window.LOOM_AUTH && window.LOOM_AUTH.getToken && window.LOOM_AUTH.getToken();
  if (token) h["Authorization"] = "Bearer " + token;
  return h;
}
// Serialise one element. Positions stay NORMALISED; the view's printRect ships
// alongside so the admin can convert to cm without re-deriving the geometry.
function _serializeElement(el) {
  const base = {
    id: el.id, type: el.type,
    nx: +el.nx.toFixed(5), ny: +el.ny.toFixed(5),
    rotation: el.rotation || 0,
  };
  if (el.type === "text") {
    return Object.assign(base, {
      content: el.content, font: el.font, size: el.size,
      color: el.color, bold: !!el.bold, italic: !!el.italic,
    });
  }
  const img = Object.assign(base, { name: el.name, scalePct: el.scalePct, key: el.key || null });
  if (el.artworkId) {
    img.artworkId = el.artworkId;
    img.artworkPrice = el.artworkPrice || 0;
    img.artworkAuthor = el.artworkAuthor || null;
    img.artworkKey = el.artworkKey || null;
  }
  return img;
}

function _serializeView(view) {
  const r = printRect(view);
  return {
    printRect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) },
    // Placeholder copy is preview-only and must never be stored as artwork.
    elements: elementsOf(view).filter((e) => e.type === "text"
      ? !!e.content && !e.placeholder
      : !!e.img).map(_serializeElement),
  };
}

// v2 = normalised, multi-element. Readers must branch on `v`: anything without it
// is the legacy single text + single image in raw texture px (see
// admin/assets/order-detail.js), and must keep rendering against LEGACY_PRINT_AREA.
function _buildDesignJson() {
  return JSON.stringify({
    v: 2,
    shirtColor: designState.shirtColor,
    size: selectedSize,
    texSize: TEX_SIZE,
    refRect: { w: REF_RECT.w, h: REF_RECT.h },
    platenCm: { w: PLATEN_CM.w, h: PLATEN_CM.h },
    front: _serializeView("front"),
    back: _serializeView("back"),
  });
}
// Generic R2 upload from any data URL (logo, flat print PNG, 3D mockup JPEG).
// Returns the R2 key, or null on any failure (non-fatal — proofs are best-effort).
async function _uploadDataUrl(dataUrl, filename) {
  if (!dataUrl) return null;
  try {
    const [header, b64] = dataUrl.split(",");
    const mime = header.match(/:(.*?);/)?.[1] || "image/png";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const fd = new FormData();
    fd.append("file", new File([new Blob([bytes], { type: mime })], filename || "asset.png", { type: mime }));
    // Uploads are tied to the signed-in user, so send the session along.
    const up = await fetch(getApiBase() + "/api/uploads", {
      method: "POST", body: fd, headers: _authHeaders(false), credentials: "include",
    });
    if (up.ok) return (await up.json()).key || null;
  } catch (e) { /* non-fatal */ }
  return null;
}

// The image elements on a view that still carry pixels, in draw order.
function _imageElements(view) {
  return elementsOf(view).filter((e) => e.type === "image" && e.img && uploadedFileData[e.id]);
}

/**
 * Upload every logo on a view and stamp each element's R2 key onto it (so
 * _buildDesignJson can reference them). Resolves to the FIRST key, which is what
 * goes in the order's logo_key / back_logo_key column — those hold one logo per
 * side, and the print master PNG already bakes all of them, so extra logos ride
 * along inside design_json rather than needing a schema change.
 */
async function _uploadLogoFor(view) {
  const els = _imageElements(view);
  if (!els.length) return null;
  const keys = await Promise.all(els.map((el) => {
    const f = uploadedFileData[el.id];
    return _uploadDataUrl(f.base64, f.name || view + "-logo.png");
  }));
  els.forEach((el, i) => { el.key = keys[i] || null; });
  return keys[0] || null;
}

/** Did any logo on this view fail to upload? */
function _logoUploadIncomplete(view) {
  return _imageElements(view).some((el) => !el.key);
}

// ── Plain-text summaries (order modal, Telegram payload) ─────────
// A view can now carry several texts/logos, so these join them instead of
// reaching for a single hard-coded slot.
function _viewTexts(view) {
  return elementsOf(view).filter((e) => e.type === "text" && e.content && !e.placeholder);
}
function _textSummary(view) {
  return _viewTexts(view).map((e) => e.content).join(" · ");
}
function _fontSummary(view) {
  return [...new Set(_viewTexts(view).map((e) => e.font))].join(", ");
}
function _logoSummary(view) {
  return elementsOf(view).filter((e) => e.type === "image" && e.img)
    .map((e) => e.name || "logo").join(" · ");
}
/** Average logo scale on a view — the modal shows one number. */
function _scaleSummary(view) {
  const imgs = elementsOf(view).filter((e) => e.type === "image" && e.img);
  if (!imgs.length) return 100;
  return Math.round(imgs.reduce((a, e) => a + e.scalePct, 0) / imgs.length);
}

// Render the PRINT master for a view: ONLY the artwork (logo + text), cropped to
// the print area, on a TRANSPARENT background, shadow-free, at PRINT_SCALE× the
// texture resolution. This is the file a print shop reproduces. Uses the exact
// same geometry as drawTexture() so the placement matches the preview pixel-for-pixel.
// Returns a PNG data URL, or null if the view is empty.
const PRINT_SCALE = 3; // 928×1120 → 2784×3360 px (~235 dpi at 30×40 cm)
function _renderPrintCanvas(view) {
  if (!_viewHasPrint(view)) return null;
  const r = printRect(view);
  const c = document.createElement("canvas");
  c.width = Math.round(r.w * PRINT_SCALE);
  c.height = Math.round(r.h * PRINT_SCALE);
  const ctx = c.getContext("2d");
  ctx.scale(PRINT_SCALE, PRINT_SCALE);
  ctx.translate(-r.x, -r.y); // texture coords → print-area-local

  // Same painter as the on-garment preview, minus the screen-only drop shadow —
  // but with the FLAT mapping, not the warped one: the centreline warp corrects
  // the posed 3D scan, and a real shirt isn't posed. nx 0.5 must land on the
  // physical platen centre in the file a print shop receives.
  elementsOf(view).forEach((el) => {
    if (el.type === "text" && el.placeholder) return;
    drawElementIn(ctx, el, r, false);
  });
  return c.toDataURL("image/png");
}

// Capture production proofs for the current design: shadow-free flat print PNGs +
// 3D garment mockups (JPEG). Uploads them and returns R2 keys + the mockup data
// URLs (so the Telegram worker payload can reuse them without re-rendering).
async function captureProofs() {
  const active = { front: _viewHasPrint("front"), back: _viewHasPrint("back") };

  // Flat print masters (artwork-only, transparent, hi-res) for non-empty views.
  const printData = {
    front: active.front ? _renderPrintCanvas("front") : null,
    back: active.back ? _renderPrintCanvas("back") : null,
  };

  // 3D mockups — one still frame per side; the customer's camera comes back.
  const mockData = { front: null, back: null };
  if (renderer && camera && controls && scene && shirtObject) {
    applyActiveTexture();
    ["front", "back"].forEach((v) => {
      mockData[v] = _snapshotURL("image/jpeg", 0.85, v);
    });
  }

  // No 3D preview opened: the flat editor's garment stands in, so every order
  // still carries a front and a back mockup.
  if (!mockData.front) mockData.front = await _renderFlatMockup("front");
  if (!mockData.back) mockData.back = await _renderFlatMockup("back");

  // Interactive 3D review model — the exact textured garment, baked, for the admin.
  const glbDataUrl = await captureGLB();

  // Upload everything in parallel. Both mockups always (a blank side still shows
  // the garment); prints only for sides with a design, gated above.
  const [frontPrintKey, backPrintKey, frontMockupKey, backMockupKey, modelKey] = await Promise.all([
    printData.front ? _uploadDataUrl(printData.front, "front-print.png") : null,
    printData.back ? _uploadDataUrl(printData.back, "back-print.png") : null,
    mockData.front ? _uploadDataUrl(mockData.front, "front-mockup.jpg") : null,
    mockData.back ? _uploadDataUrl(mockData.back, "back-mockup.jpg") : null,
    glbDataUrl ? _uploadDataUrl(glbDataUrl, "model.glb") : null,
  ]);

  return {
    frontPrintKey, backPrintKey, frontMockupKey, backMockupKey, modelKey,
    frontMockupData: mockData.front, backMockupData: mockData.back,
  };
}
async function addToCart(opts) {
  opts = opts || {}; // { openDrawer=true } — buyNow() passes false and navigates itself
  if (!sizeChosen()) return false;
  const unsold = unsoldReason();
  if (unsold) { showToast(unsold, "error"); return false; }
  // The login modal and the cart drawer live outside the stage and would be
  // invisible in full screen, so leave it first.
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  // Require real copy or removal before login, uploads, and the cart request.
  for (const view of ["front", "back"]) {
    const pending = elementsOf(view).find((el) => el.type === "text" && el.placeholder);
    if (!pending) continue;
    setStep("design");
    if (_isSheetLayout()) setSheetOpen(true);
    if (designState.activeView !== view) setActiveView(view);
    designState[view].selId = pending.id;
    syncPanelFromState();
    redrawActive();
    showToast(CT("cfg.untouchedTextCart", "Введите текст или удалите этот текстовый слой, чтобы добавить товар в корзину."), "error");
    const input = document.getElementById("text-content-input");
    if (input) {
      requestAnimationFrame(() => {
        // Every layout: on desktop the field can sit under the panel footer.
        input.scrollIntoView({ block: "nearest" });
        if (input.getClientRects().length) input.focus({ preventScroll: true });
      });
    }
    return false;
  }
  // Account-bound cart → require login first
  let user = null;
  try {
    user = window.LOOM_LOGIN_MODAL
      ? await window.LOOM_LOGIN_MODAL.requireAuth()
      : (window.LOOM_AUTH ? await window.LOOM_AUTH.getCurrentUser() : null);
  } catch { return; } // login modal cancelled
  if (!user) { showToast(CT("cfg.toastLoginCart", "Войдите, чтобы добавить в корзину"), "error"); return; }

  const btn = document.getElementById("btn-add-to-cart");
  const orderBtn = document.getElementById("btn-place-order");
  // proofs + uploads take seconds on mobile — the button must say so
  const btnLabel = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML =
      '<svg class="spinner" width="17" height="17" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity=".25"/><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/></svg>' +
      '<span>' + _esc(CT("cfg.preparing", "Готовим макеты…")) + '</span>';
  }
  if (orderBtn) orderBtn.disabled = true;
  try {
    // Capture proofs NOW — the design is only live here; it's gone by checkout.
    const [logoKey, backLogoKey] = await Promise.all([_uploadLogoFor("front"), _uploadLogoFor("back")]);
    const proofs = await captureProofs();
    const designJson = _buildDesignJson();
    try {
      await window.LOOM_CART.add({
        productId: currentProduct ? currentProduct.id : null,
        designJson,
        logoKey,
        backLogoKey,
        frontPrintKey: proofs.frontPrintKey,
        backPrintKey: proofs.backPrintKey,
        frontMockupKey: proofs.frontMockupKey,
        backMockupKey: proofs.backMockupKey,
        modelKey: proofs.modelKey,
        unitPrice: currentUnitPrice(),
        quantity: 1,
      });
    } catch (err) {
      if (err && err.status === 401) showToast(CT("cfg.toastLoginCart", "Войдите, чтобы добавить в корзину"), "error");
      else {
        if (err && err.code === "product_unavailable") showProductUnavailable();
        showToast(unsoldText(err && err.code) || err.message || CT("cfg.toastAddError", "Ошибка добавления"), "error");
      }
      return false;
    }
    // Editing a bag item? The new row replaced it — drop the old one.
    if (window.__loomEditingCartItem) {
      await window.LOOM_CART.remove(window.__loomEditingCartItem);
      window.__loomEditingCartItem = null;
      try {
        const url = new URL(location.href);
        url.searchParams.delete("item");
        history.replaceState(null, "", url.toString());
      } catch (e) { /* cosmetic */ }
      showToast(CT("cfg.toastCartUpdated", "Корзина обновлена"));
    } else {
      showToast(CT("cfg.toastAddedCart", "Добавлено в корзину"));
    }
    if (opts.openDrawer !== false) window.LOOM_CART.open();
    return true;
  } catch (e) {
    showToast("Ошибка сети", "error");
    return false;
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = btnLabel; }
    if (orderBtn) orderBtn.disabled = false;
  }
}

// "Купить сейчас" — Amazon-style buy-now: add the live design to the bag,
// then jump straight to checkout (skipping the drawer).
async function buyNow() {
  trackStep("cfg_order");
  const ok = await addToCart({ openDrawer: false });
  if (ok) location.href = "checkout.html";
}
function bindCart() {
  // drawer, badge, checkout handoff → assets/cart.js; we only own "add"
  document.getElementById("btn-add-to-cart")?.addEventListener("click", () => { trackStep("cfg_cart"); addToCart(); });
}

// ----------------------------------------------------------------
// Build color swatch buttons from SHIRT_COLORS array
// ----------------------------------------------------------------
function buildColorSwatches() {
  const container = document.getElementById("color-swatches");
  if (!container) return;
  container.textContent = ""; // rebuilt for the product's config and on a language switch

  SHIRT_COLORS.forEach((def) => {
    const { hex, light } = def;
    const btn = document.createElement("button");
    btn.className = "swatch-btn";
    btn.title = colorLabel(def);
    btn.setAttribute("aria-label", btn.title);
    btn.dataset.hex = hex;
    btn.style.background = hex;
    if (light) btn.style.border = "2px solid #D1D5DB";

    if (def.available === false) {
      // Switched off in admin: shown struck through, refused with a reason.
      btn.classList.add("is-unavailable");
      btn.setAttribute("aria-disabled", "true");
      btn.title += " — " + CT("cfg.unavailable", "Недоступно");
      btn.addEventListener("click", () => showToast(unsoldText("color_unavailable"), "error"));
    } else {
      btn.addEventListener("click", () => selectShirtColor(hex, btn));
    }
    container.appendChild(btn);
  });
  syncPickers();
}

// ----------------------------------------------------------------
// Picker radio state and keys (colour swatches, sizes)
// ----------------------------------------------------------------
/**
 * The one place the pickers' checked state is written: the visual class,
 * role and aria-checked, and a roving tabindex so Tab enters each group at the
 * checked item (the first one while nothing is checked). Clicks, arrow keys,
 * undo, Reset, saved layouts and cart edits all go through here.
 */
function syncPickers() {
  const hex = String(designState.shirtColor || "").toUpperCase();
  _syncRadios("color-swatches", ".swatch-btn", "selected", (b) => String(b.dataset.hex).toUpperCase() === hex);
  _syncRadios("size-selector", ".size-btn", "active", (b) => b.dataset.size === selectedSize);
}

function _syncRadios(id, sel, cls, isOn) {
  const items = document.querySelectorAll("#" + id + " " + sel);
  let tab = items[0];
  items.forEach((b) => {
    const on = isOn(b);
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(on));
    b.classList.toggle(cls, on);
    b.tabIndex = -1;
    if (on) tab = b;
  });
  if (tab) tab.tabIndex = 0;
}

/** Arrow keys move the choice, skipping switched-off items, like native radios. */
function bindPickerKeys() {
  [["color-swatches", ".swatch-btn"], ["size-selector", ".size-btn"], ["cam-tiles", ".cam-tile"]].forEach(([id, sel]) => {
    const group = document.getElementById(id);
    if (!group) return;
    group.addEventListener("keydown", (e) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step || e.altKey || e.ctrlKey || e.metaKey) return;
      const items = [...group.querySelectorAll(sel)];
      let i = items.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault(); // also tells _onEdKeyDown the key is taken
      for (let n = 1; n < items.length; n++) {
        i = (i + step + items.length) % items.length;
        if (items[i].getAttribute("aria-disabled") !== "true") { items[i].focus(); items[i].click(); return; }
      }
    });
  });
}

// ----------------------------------------------------------------
// Size selector
// ----------------------------------------------------------------
function bindSizeSelector() {
  // Delegated: buildSizeButtons() replaces the buttons with the product's sizes.
  const row = document.getElementById("size-selector");
  if (!row) return;
  row.addEventListener("click", (e) => {
    const btn = e.target.closest(".size-btn");
    if (!btn) return;
    trackStep("cfg_style");
    selectedSize = btn.dataset.size;
    syncPickers();
    row.classList.remove("need-size");
    row.removeAttribute("aria-invalid");
  });
}

/**
 * True when a size is picked. Otherwise it stays on (or returns to) step 2,
 * highlights the size row and says why, so step 3 never opens without one.
 */
function sizeChosen() {
  if (selectedSize) return true;
  if (currentStep !== "color") setStep("color");
  const row = document.getElementById("size-selector");
  if (row) {
    // Restart the pulse on every refused tap.
    row.classList.remove("need-size");
    void row.offsetWidth;
    row.classList.add("need-size");
    row.setAttribute("aria-invalid", "true");
    row.scrollIntoView({ block: "nearest" });
  }
  showToast(CT("cfg.sizeRequired", "Сначала выберите размер"), "error");
  return false;
}

// ----------------------------------------------------------------
// Center buttons for text and logo
// ----------------------------------------------------------------
// "По центру" — nx 0.5 is the garment's measured centreline on BOTH faces, so
// this now actually centres the artwork instead of landing ~150px (front) /
// ~250px (back) to one side, as a fixed TEX_SIZE/2 did.
function bindCenterButtons() {
  const centerSelected = () => {
    const el = selectedElement();
    if (!el) return;
    el.nx = 0.5;
    redrawActive();
  };
  const b = document.getElementById("btn-center-text");
  if (b) b.addEventListener("click", centerSelected);
}

// ----------------------------------------------------------------
// Populate font <select> options
// ----------------------------------------------------------------
function buildFontOptions() {
  const sel = document.getElementById("font-family-select");
  if (!sel) return;
  FONT_OPTIONS.forEach(({ value, label }) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    opt.style.fontFamily = value;
    sel.appendChild(opt);
  });
}

// ----------------------------------------------------------------
// Tab navigation (Color / Text / Image / Summary)
// ----------------------------------------------------------------
function bindTabNav() {
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;

      tabBtns.forEach((b) => {
        b.classList.toggle("active", b.dataset.tab === target);
        b.setAttribute(
          "aria-selected",
          b.dataset.tab === target ? "true" : "false",
        );
      });

      tabContents.forEach((tc) => {
        const active = tc.id === "tab-" + target;
        tc.classList.toggle("active", active);
        if (active) tc.style.display = "flex";
        else tc.style.display = "none";
      });

      // Update summary when that tab opens
      if (target === "summary") updateSummaryTab();
    });
  });
}

// ----------------------------------------------------------------
// Front / Back view toggle
// ----------------------------------------------------------------
function bindViewToggle() {
  [["btn-view-front", "front"], ["btn-view-back", "back"]].forEach(([id, v]) => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener("click", () => setActiveView(v));
  });
}

/** Single entry point for changing face — used by the toggle AND the guide. */
function setActiveView(view, keepCamera) {
  stopCamMotion(); // Front/Back (even the side already shown) ends Turntable
  if (designState.activeView === view) return;
  designState.activeView = view;

  [["btn-view-front", "front"], ["btn-view-back", "back"]].forEach(([id, v]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle("active", v === view);
    btn.setAttribute("aria-pressed", String(v === view));
  });

  // Animate camera to selected view (Reset view glides there itself)
  if (!keepCamera) setCameraView(view);

  // Swap texture so the material shows the correct design face
  applyActiveTexture();

  // Re-point the panel at THIS side's layers. Without this the form keeps showing
  // the other side's text, which reads as "the back won't take a design".
  syncPanelFromState();

  // Refresh the design preview
  refreshDesignCanvas();

  // Re-pin the live overlay to the new face.
  if (editMode) drawEditor();
}

/** Dot on the Перед/Зад buttons marking a side that already carries artwork. */
function updateViewToggleMarkers() {
  [["btn-view-front", "front"], ["btn-view-back", "back"]].forEach(([id, v]) => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.toggle("has-design", _viewHasContent(v));
  });
  // Everything that changes "is there a design?" funnels through here, so the
  // CTA wording and the step ticks ride along rather than needing their own
  // call sites scattered through the add/delete/undo paths.
  if (typeof updateCartCta === "function") updateCartCta();
  if (typeof markStepsDone === "function") markStepsDone();
}

// ================================================================
// SECTION 11 — COLOR TAB CONTROLS
// ================================================================

function bindColorControls() {
  const picker = document.getElementById("custom-color-picker");
  const hexIn = document.getElementById("custom-color-hex");
  if (!picker || !hexIn) return;

  picker.addEventListener("input", () => {
    hexIn.value = picker.value.toUpperCase();
    selectShirtColor(picker.value, null);
  });

  hexIn.addEventListener("input", () => {
    const v = hexIn.value.trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
      picker.value = v;
      selectShirtColor(v, null);
    }
  });
}

function selectShirtColor(hex, clickedBtn) {
  trackStep("cfg_style");
  paintShirtColor(hex);
}

/** Apply a garment colour everywhere it shows, without counting a funnel step. */
function paintShirtColor(hex) {
  designState.shirtColor = hex;

  syncPickers();

  // Keep the custom picker in sync
  const picker = document.getElementById("custom-color-picker");
  const hexIn = document.getElementById("custom-color-hex");
  if (picker) picker.value = hex;
  if (hexIn) hexIn.value = hex.toUpperCase();

  // Redraw both sides so color change shows immediately
  drawTexture("front");
  drawTexture("back");
  applyActiveTexture();
  // The flat editor is the surface the user is actually looking at while they
  // pick a colour, so it has to repaint too — the 3D alone is not enough.
  renderFlatEditor();
  if (renderer && camera && scene && !flatMode) { updateStudioRig(); renderer.render(scene, camera); }
}

// ================================================================
// SECTION 12 — TEXT TAB CONTROLS
// ================================================================

function bindTextControls() {
  const textIn = document.getElementById("text-content-input");
  const fontSel = document.getElementById("font-family-select");
  const colorPkr = document.getElementById("text-color-picker");
  const btnBold = document.getElementById("btn-bold");
  const btnItal = document.getElementById("btn-italic");

  if (!textIn) return;

  // The selected TEXT element, or null when a logo (or nothing) is selected.
  const getTxt = () => {
    const el = selectedElement();
    return el && el.type === "text" ? el : null;
  };

  textIn.addEventListener("input", () => {
    const t = getTxt();
    if (!t) return;
    const enteredText = textIn.value;
    t.placeholder = enteredText.trim().length === 0;
    t.content = t.placeholder
      ? CT("cfg.newTextDefault", "Ваш текст")
      : enteredText;
    updateViewToggleMarkers();
    scheduleRedraw(); // coalesce — fast typing must not re-upload per keystroke
  });

  if (fontSel) fontSel.addEventListener("change", () => {
    const t = getTxt();
    if (!t) return;
    t.font = fontSel.value;
    // Pre-load the font in the browser before redrawing
    document.fonts.load(`24px "${fontSel.value}"`).then(() => redrawActive());
  });

  if (colorPkr) colorPkr.addEventListener("input", () => {
    const t = getTxt();
    if (!t) return;
    t.color = colorPkr.value;
    scheduleRedraw();
  });

  [[btnBold, "bold"], [btnItal, "italic"]].forEach(([btn, prop]) => {
    if (!btn) return;
    btn.addEventListener("click", () => {
      const t = getTxt();
      if (!t) return;
      t[prop] = !t[prop];
      btn.classList.toggle("active", t[prop]);
      btn.setAttribute("aria-pressed", String(t[prop]));
      redrawActive();
    });
  });
}

// ================================================================
// SECTION 13 — IMAGE TAB CONTROLS
// ================================================================

function bindImageControls() {
  const fileInput = document.getElementById("logo-file-input");
  const stage = document.getElementById("three-container");
  if (!fileInput) return;

  fileInput.addEventListener("change", function () {
    if (this.files && this.files[0]) handleImageFile(this.files[0]);
  });

  // Drop an image anywhere on the 3D stage to add it as a new logo layer —
  // the dedicated upload well went away with the dock redesign.
  if (stage) {
    stage.addEventListener("dragover", (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes("Files")) return;
      e.preventDefault();
      stage.classList.add("drag-over");
    });
    stage.addEventListener("dragleave", () => stage.classList.remove("drag-over"));
    stage.addEventListener("drop", (e) => {
      if (!e.dataTransfer || !e.dataTransfer.files[0]) return;
      e.preventDefault();
      stage.classList.remove("drag-over");
      _pendingLogoIsNew = true;
      handleImageFile(e.dataTransfer.files[0]);
    });
  }
}

// Pinned, verbatim upstream (assets/vendor/README.md). Loaded only when the
// browser cannot decode a HEIC photo itself (everything except Safari).
const HEIC_DECODER = "assets/vendor/heic-to.js?v=1";

// Print resolution of a raster logo: the pixels it keeps over its placed size.
// A 100% logo's long edge is 0.30 × TEX_SIZE against REF_RECT's width, and the
// print rect is PLATEN_CM.w wide, so the placed size is the same on any view.
const MIN_PRINT_DPI = 150;
function printDpi(longEdgePx, scalePct) {
  const longCm = (scalePct / 100) * (TEX_SIZE * 0.30 / REF_RECT.w) * PLATEN_CM.w;
  return longEdgePx / (longCm / 2.54);
}

/** Warn once each time a raster logo drops below MIN_PRINT_DPI. SVG is vector. */
function checkPrintDpi(el) {
  if (!el || el.type !== "image" || !el.img) return;
  const f = uploadedFileData[el.id];
  if (f && f.type === "image/svg+xml") return;
  const px = Math.max(el.img.naturalWidth || 0, el.img.naturalHeight || 0);
  const low = px > 0 && printDpi(px, el.scalePct) < MIN_PRINT_DPI;
  if (low && !el._lowDpi) {
    showToast(CT("cfg.uploadLowDpi", "Низкое разрешение: при таком размере печать может быть размытой. Уменьшите изображение или загрузите файл побольше."), "warning");
  }
  el._lowDpi = low;
}

function handleImageFile(file, meta) {
  // Phones often hand over HEIC with an empty or generic type, so the
  // extension counts too.
  const heic = /^image\/hei[cf]$/.test(file.type) || /\.hei[cf]$/i.test(file.name || "");
  if (!file.type.startsWith("image/") && !heic) {
    showToast(CT("cfg.uploadErrType", "Пожалуйста, загрузите файл изображения (PNG, JPG, WebP, HEIC, SVG)"), "error");
    return;
  }

  if (file.size > 15 * 1024 * 1024) {
    showToast(CT("cfg.uploadErrSize", "Файл слишком большой (макс. 15 МБ)"), "error");
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onerror = () => {
      const failed = () => showToast(CT("cfg.uploadErrRead", "Не удалось открыть изображение. Попробуйте файл JPG или PNG."), "error");
      if (!heic) return failed();
      // Convert to JPEG and start over; the result is no longer HEIC, so this
      // cannot loop.
      _loadChunk(HEIC_DECODER)
        .then(() => window.HeicTo({ blob: file, type: "image/jpeg", quality: 0.92 }))
        .then((blob) => handleImageFile(
          new File([blob], (file.name || "photo").replace(/\.hei[cf]$/i, "") + ".jpg", { type: "image/jpeg" }),
          meta,
        ))
        .catch(failed);
    };
    img.onload = () => {
      // Re-encode through a canvas when the image is larger than the 2048px
      // texture (phone photos: those pixels can never be seen, yet every redraw
      // and the order upload would pay for them) or is a format the upload
      // endpoint does not store (only PNG and JPEG; WebP, HEIC, GIF are not).
      let finalImg = img;
      let finalData = e.target.result;
      const maxDim = Math.max(img.naturalWidth || 0, img.naturalHeight || 0);
      const stored = file.type === "image/png" || file.type === "image/jpeg";
      if (file.type !== "image/svg+xml" && (maxDim > TEX_SIZE || !stored)) {
        const k = Math.min(1, TEX_SIZE / maxDim);
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * k);
        c.height = Math.round(img.naturalHeight * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        finalData = c.toDataURL(file.type === "image/jpeg" || heic ? "image/jpeg" : "image/png", 0.92);
        finalImg = new Image();
        finalImg.src = finalData;
      }
      const finalType = finalData.slice(5, finalData.indexOf(";"));

      const apply = () => {
      const st = designState[designState.activeView];
      const sel = selectedElement();
      // "+ Логотип" adds a layer; the upload area swaps the selected layer's art.
      let el = (!_pendingLogoIsNew && sel && sel.type === "image") ? sel : null;
      let scalePct = 100;
      if (!el) {
        // A 100% logo's long edge is 0.30 × TEX_SIZE against REF_RECT's width.
        const fullH = (TEX_SIZE * 0.30) / REF_RECT.h;
        // Shrink a freshly added logo to whatever room is left under the existing
        // layers, so it doesn't land on top of them at its default size.
        const free = Math.max(0, 0.94 - _stackTopNy(designState.activeView));
        if (st.elements.length && free < fullH) {
          scalePct = Math.max(25, Math.round(100 * (free / fullH)));
        }
        const ownH = fullH * (scalePct / 100);
        el = newImageElement({
          ny: st.elements.length ? _stackNy(designState.activeView, ownH) : 0.28,
        });
        st.elements.push(el);
        st.selId = el.id;
      }
      _pendingLogoIsNew = false;

      el.img = finalImg;
      el.name = (meta && meta.title) || file.name;
      el.scalePct = scalePct;
      el.key = null; // re-uploaded on the next order

      // Marketplace artwork carries its designer with it: `artworkId` is what
      // the checkout reads to credit the sale (see cart.ts artworkIdsIn), and
      // the markup is added to the garment's price.
      if (meta && meta.artworkId) {
        el.artworkId = meta.artworkId;
        el.artworkPrice = meta.markup || 0;
        el.artworkAuthor = meta.author || null;
        // The canvas copy is capped at TEX_SIZE, so the re-uploaded logo is a
        // 2048px derivative. Keep the designer's original R2 key alongside it:
        // the print shop should be able to pull the full-resolution file.
        el.artworkKey = meta.imageKey || null;
      } else {
        delete el.artworkId; delete el.artworkPrice;
        delete el.artworkAuthor; delete el.artworkKey;
      }

      // Store (possibly re-encoded) file data per ELEMENT for order submission
      uploadedFileData[el.id] = {
        base64: finalData,
        name: finalType === file.type ? file.name
          : file.name.replace(/\.[^.]*$/, "") + (finalType === "image/jpeg" ? ".jpg" : ".png"),
        type: finalType,
        size: file.size,
      };

      el._lowDpi = false; // new pixels: judge them afresh
      checkPrintDpi(el);
      syncPanelFromState();
      redrawActive();
      updateViewToggleMarkers();
      refreshPriceLabels();
      trackStep("cfg_design_add");
      maybeShowFirstDesignReward();
      }; // apply()

      if (finalImg === img) apply();
      else finalImg.onload = apply;
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ================================================================
// SECTION 14 — SUMMARY TAB
// ================================================================

function bindSummaryTab() {
  const btnOrder = document.getElementById("btn-place-order");

  // #btn-reset-design is bound once, with the other controls. The second
  // addEventListener here was a no-op (same listener, so the DOM dropped it)
  // and only made Reset look double-bound.
  if (btnOrder) btnOrder.addEventListener("click", buyNow);
}

/**
 * The still camera: every image of the 3D (saved PNG, cart mockups, Step 3
 * snapshot) is one frame rendered from the fitted Front or Back pose, with
 * both sides' current design and no selection handles, whatever angle or zoom
 * the customer left the 3D at — and even while the 2D editor is up, when the
 * render loop is idle. The customer's camera is put back exactly; the orbit
 * controls are not touched, so a drag still in its damping carries on.
 */
function _withStillCamera(view, read) {
  finishEntrance(); // full scale, facing front. Turntable cannot move mid-call.
  const pose = CAM_VIEWS[view === "back" ? "back" : "front"];
  const prevHandles = _showHandles;
  const pos = camera.position.clone();
  const quat = camera.quaternion.clone();
  _showHandles = false;
  try {
    drawTexture("front");
    drawTexture("back");
    camera.position.set(pose.x, pose.y, pose.z);
    camera.lookAt(INITIAL_VIEW.target || controls.target);
    updateStudioRig();
    renderer.render(scene, camera);
    return read(renderer.domElement);
  } finally {
    _showHandles = prevHandles;
    camera.position.copy(pos);
    camera.quaternion.copy(quat);
    redrawActive();
    updateStudioRig();
    renderer.render(scene, camera);
  }
}

function _snapshotURL(type, quality, view) {
  return _withStillCamera(view || designState.activeView, (c) => c.toDataURL(type, quality));
}

function updateSummaryTab() {
  // A picture of what they are about to buy. The 3D is the better likeness,
  // but it only exists once the preview has been opened — and most people
  // reach step 3 without ever opening it, which left a black square sitting
  // where the product should be. The flat editor is always drawn, so it is
  // the fallback.
  const snap = document.getElementById("summary-snapshot");
  const drawSnap = (src) => {
    if (!snap || !src || !src.width || !src.height) return;
    const ctx = snap.getContext("2d");
    ctx.clearRect(0, 0, snap.width, snap.height);
    const side = Math.min(src.width, src.height);
    ctx.drawImage(
      src,
      (src.width - side) / 2, (src.height - side) / 2, side, side,
      0, 0, snap.width, snap.height,
    );
  };
  // A fresh still frame, not the 3D canvas as last drawn: with the 2D editor
  // up the render loop is idle, so that canvas predates the latest edits.
  if (snap && renderer && camera && controls && scene && shirtObject) {
    _withStillCamera(designState.activeView, drawSnap);
  } else {
    drawSnap(document.getElementById("flat-canvas"));
  }

  // Update text summary
  const setEl = (id, txt) => {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  };

  setEl("sum-color", getColorName(designState.shirtColor));
  setEl("sum-size", selectedSize);

  // Summarise BOTH sides — a back-only design used to show as an empty summary.
  const texts = [], logos = [];
  ["front", "back"].forEach((v) => {
    const label = v === "front" ? CT("cfg.viewFront", "Перед") : CT("cfg.viewBack", "Зад");
    elementsOf(v).forEach((el) => {
      if (el.type === "text" && el.content && !el.placeholder) texts.push(`${label}: ${el.content}`);
      if (el.type === "image" && el.img) logos.push(`${label}: ${el.name || "logo"}`);
    });
  });
  const fonts = [...new Set(
    ["front", "back"].flatMap((v) => elementsOf(v).filter((e) => e.type === "text" && e.content && !e.placeholder).map((e) => e.font)),
  )];
  setEl("sum-text", texts.join(" · ") || "—");
  setEl("sum-font", fonts.join(", ") || "—");
  setEl("sum-image", logos.join(" · ") || CT("cfg.notUploaded", "Не загружено"));
}

function resetDesign() {
  markUndo("reset");
  designState.shirtColor = DEFAULT_SHIRT_COLOR;
  selectedSize = null;

  ["front", "back"].forEach((v) => {
    designState[v].elements = [];
    designState[v].selId = null;
  });

  Object.keys(uploadedFileData).forEach((k) => delete uploadedFileData[k]);

  // Reset UI controls to defaults
  const ids = ["text-content-input", "custom-color-hex"];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  const cp = document.getElementById("custom-color-picker");
  if (cp) cp.value = DEFAULT_SHIRT_COLOR;
  const fi = document.getElementById("logo-file-input");
  if (fi) fi.value = "";

  ["btn-bold", "btn-italic"].forEach((id) => {
    const b = document.getElementById(id);
    if (!b) return;
    b.classList.remove("active");
    b.setAttribute("aria-pressed", "false");
  });

  syncPickers(); // default colour checked, no size

  syncPanelFromState();
  drawTexture("front");
  drawTexture("back");
  applyActiveTexture();
  renderFlatEditor();
  updateViewToggleMarkers();
  refreshPriceLabels();
  showUndoToast(CT("cfg.wasReset", "Дизайн сброшен"));
}

// ================================================================
// SECTION 15 — SAVE DESIGN (screenshot download)
// ================================================================

function bindSaveDesign() {
  const btn = document.getElementById("btn-save-design");
  if (!btn) return;

  btn.addEventListener("click", () => {
    // aria-disabled keeps the chip focusable, so the hint is said here too
    // (touch has no title tooltip).
    if (!_preview3DReady) {
      showToast(CT("cfg.exportPngNeeds3d", "Откройте 3D-превью, чтобы сохранить PNG"), "warning");
      return;
    }
    const url = _snapshotURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = "loom-design.png";
    a.click();
    showToast(CT("cfg.savedToast", "Дизайн сохранён!"), "success");
  });
}

/** The 3D is on screen: Save becomes a plain button with its normal title. */
function enableSaveDesign() {
  const btn = document.getElementById("btn-save-design");
  if (!btn) return;
  btn.removeAttribute("aria-disabled");
  btn.setAttribute("data-i18n-attr", "aria-label:cfg.save;title:cfg.savePng");
  btn.title = CT("cfg.savePng", "Сохранить дизайн как PNG");
}

// ================================================================
// SECTION 16 — ORDER HELPERS
// ================================================================

// Map hex → display name for the order summary.
function getColorName(hex) {
  const def = shirtColorDef(hex);
  if (def) return colorLabel(def);
  return COLOR_NAMES[hex] || hex; // custom picker colours keep their stored name
}

// Export the textured garment as a binary glTF (.glb) data URL — the EXACT model
// the customer designed (baked textures), for the admin's interactive 3D review +
// download. Exports the garment's pivot (no lights/camera): the garment alone
// would lose the pivot's offset. Best-effort: resolves null on any failure so it
// never blocks an order.
async function captureGLB() {
  return new Promise((resolve) => {
    if (!shirtObject || typeof THREE.GLTFExporter === "undefined") { resolve(null); return; }
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      finishEntrance();
      drawTexture("front");
      drawTexture("back");
      const exporter = new THREE.GLTFExporter();
      // Safety net — never hang the order flow if serialization stalls.
      setTimeout(() => finish(null), 20000);
      exporter.parse(
        _pivot || shirtObject,
        (glb) => {
          try {
            const bytes = new Uint8Array(glb);
            // Chunked base64 (avoids call-stack limits + slow per-char concat on MBs).
            let binary = "";
            const CH = 0x8000;
            for (let i = 0; i < bytes.length; i += CH) {
              binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
            }
            finish("data:model/gltf-binary;base64," + btoa(binary));
          } catch (e) { finish(null); }
        },
        { binary: true, embedImages: true },
      );
    } catch (e) { finish(null); }
  });
}

// ================================================================
// SECTION 17 — TOAST NOTIFICATION
// ================================================================

function showToast(message, type = "success") {
  const existing = document.getElementById("loom-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "loom-toast";
  const bg = type === "success" ? "var(--ok)" : type === "warning" ? "var(--warn)" : "var(--danger)";
  // --warn is dark amber in light mode and yellow in dark mode: --paper-3 reads on both.
  const fg = type === "warning" ? "var(--paper-3)" : "var(--toast-ink)";

  toast.style.cssText = `
    position:fixed; bottom:calc(24px + env(safe-area-inset-bottom)); left:50%;
    transform:translateX(-50%) translateY(20px);
    width:max-content; max-width:calc(100vw - 32px); text-align:center;
    background:${bg}; color:${fg}; padding:14px 24px; border-radius:12px;
    font-family:var(--font-body); font-size:.95rem; font-weight:500;
    box-shadow:var(--menu-shadow); display:flex; align-items:center; gap:10px;
    z-index:10001; opacity:0; transition:opacity .3s ease,transform .3s ease;
    pointer-events:none;
  `;
  const text = document.createElement("span");
  text.textContent = message;
  toast.appendChild(text);
  // In full screen only the stage is drawn, so the toast goes inside it.
  (document.fullscreenElement || document.body).appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateX(-50%) translateY(0)";
  });

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(20px)";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ================================================================
// SECTION 18 — MOBILE NAVIGATION
// ================================================================

function bindMobileNav() {
  if (typeof lucide !== "undefined") lucide.createIcons();

  const toggle = document.getElementById("menuToggle");
  const closeBtn = document.getElementById("menuClose");
  const menu = document.getElementById("mobileMenu");
  const backdrop = document.getElementById("mobileBackdrop");

  if (!toggle || !menu) return;

  const open = () => {
    menu.classList.add("active");
    backdrop.classList.add("active");
    document.body.classList.add("menu-open");
    toggle.setAttribute("aria-expanded", "true");
    menu.setAttribute("aria-hidden", "false");
    const first = menu.querySelector(".mobile-menu-link");
    if (first) first.focus();
  };

  const close = () => {
    menu.classList.remove("active");
    backdrop.classList.remove("active");
    document.body.classList.remove("menu-open");
    toggle.setAttribute("aria-expanded", "false");
    menu.setAttribute("aria-hidden", "true");
    toggle.focus();
  };

  toggle.addEventListener("click", open);
  if (closeBtn) closeBtn.addEventListener("click", close);
  if (backdrop) backdrop.addEventListener("click", close);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menu.classList.contains("active")) close();
  });

  menu
    .querySelectorAll(".mobile-menu-link")
    .forEach((l) => l.addEventListener("click", close));

  window.addEventListener("resize", () => {
    if (window.innerWidth >= 768 && menu.classList.contains("active")) close();
  });
}
