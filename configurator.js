/* ================================================================
  LOOM 3D T-Shirt Configurator — configurator.js
  Three.js r128 | GLTFLoader | OrbitControls
  ================================================================ */

"use strict";

// ================================================================
// SECTION 1 — CONSTANTS
// ================================================================

const TEX_SIZE = 2048; // Offscreen texture canvas dimensions (2048 for crisp logo quality)

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
const PLATEN_W_FRAC = 0.55;
const PLATEN_TOP_FRAC = 0.20;

// Pre-mesh fallback, and the unit basis for the UI's px/% sliders: a font-size of
// 160 means 160px in a rect this tall, scaled proportionally in any real rect.
const LEGACY_PRINT_AREA = { x: 560, y: 360, w: 928, h: 1120 };
const REF_RECT = { w: LEGACY_PRINT_AREA.w, h: LEGACY_PRINT_AREA.h };

// Resolved per view once the model's mesh is available (see resolvePrintRects).
const PRINT_RECTS = { front: { ...LEGACY_PRINT_AREA }, back: { ...LEGACY_PRINT_AREA } };
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
const DEFAULT_SHIRT_COLOR = SHIRT_COLORS[0].hex;

function shirtColorDef(hex) {
  const h = String(hex || "").toUpperCase();
  return SHIRT_COLORS.find((c) => c.hex.toUpperCase() === h) || null;
}

// Font options (system + Google)
const FONT_OPTIONS = [
  { value: "Arial", label: "Arial" },
  { value: "Georgia", label: "Georgia" },
  { value: "Impact", label: "Impact" },
  { value: "Courier New", label: "Courier New" },
  { value: "Pacifico", label: "Pacifico (Script)" },
];

// Cloudflare Worker endpoint for Telegram order notifications
const WORKER_URL =
  window.LOOM_CONFIG?.TELEGRAM_WORKER_URL
  ?? "https://loom-telegram-orders.timurnasriddinov56.workers.dev";

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

/** Does this view have anything on it? */
function _viewHasContent(view) {
  return elementsOf(view).some((e) => e.type === "text" ? !!e.content : !!e.img);
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

// Selected shirt size
let selectedSize = "L";

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
  initThreeJS();
  initCanvasTextures();

  // UI + render loop first — nothing in them depends on the product,
  // and a slow /api/products response must not leave dead controls
  initUI();
  animate();

  // Auth nav
  if (window.LOOM_AUTH) window.LOOM_AUTH.renderAuthNav();

  // Editing a bag item? Resolve its product slug BEFORE the product load,
  // then re-apply the saved design once textures are ready.
  const editItem = await prepareCartEdit();

  // Load product from ?slug= param, then load its GLB (or fallback)
  await loadProductFromSlug();

  if (editItem) applyCartEditDesign(editItem);
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
    // resolve slug so loadProductFromSlug pulls the right GLB + price
    if (item.product_id && !qs.get("slug")) {
      try {
        const pr = await fetch(getApiBase() + "/api/products");
        if (pr.ok) {
          const products = await pr.json();
          const p = (products || []).find((x) => x.id === item.product_id);
          if (p && p.slug) {
            const url = new URL(location.href);
            url.searchParams.set("slug", p.slug);
            history.replaceState(null, "", url.toString());
          }
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
    document.querySelectorAll(".size-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.size === d.size));
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
        dst.elements.push(el);
        uploadedFileData[el.id] = { base64: dataUrl, name: s.name || "", type: blob.type, size: blob.size };
      } catch (e) { /* logo fetch failed — text still rehydrates */ }
    }
    dst.selId = dst.elements.length ? dst.elements[dst.elements.length - 1].id : null;
  }

  syncPanelFromState();

  drawTexture("front");
  drawTexture("back");
  if (typeof applyActiveTexture === "function") applyActiveTexture();
  showToast(CT("cfg.editingFromCart", "Редактируем товар из корзины — сохранится при добавлении"));
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
  renderer.toneMapping = THREE.LinearToneMapping;
  renderer.toneMappingExposure = 0.82;
  container.appendChild(renderer.domElement);

  // Neutral studio environment (PMREM) for realistic fabric shading
  if (typeof THREE.RoomEnvironment === "function") {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(
      new THREE.RoomEnvironment(),
      0.04,
    ).texture;
  }

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

  // Responsive resize — window AND container layout changes
  window.addEventListener("resize", onWindowResize);
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(onWindowResize).observe(container);
  }
}

function setupLighting() {
  // Very soft ambient — just enough to lift pure shadow off black
  scene.add(new THREE.AmbientLight(0xffffff, 0.08));

  // Hemisphere — subtle top/bottom bias, not a light source itself
  const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 0.12);
  hemi.position.set(0, 1, 0);
  scene.add(hemi);

  // Key light: front-right — defines shape without blowing out white
  const key = new THREE.DirectionalLight(0xffffff, 0.45);
  key.position.set(2.5, 3.5, 3);
  scene.add(key);

  // Fill light: front-left — very subtle rim
  const fill = new THREE.DirectionalLight(0xffffff, 0.12);
  fill.position.set(-3, 1.5, 2);
  scene.add(fill);
}

let _lastResizeW = 0;
let _lastResizeH = 0;

function onWindowResize() {
  const container = document.getElementById("three-container");
  if (!container || !renderer || !camera) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w === 0 || h === 0) return;
  // iOS fires resize every time the URL bar collapses mid-scroll —
  // bail early so the camera never snaps while the user is browsing
  if (w === _lastResizeW && h === _lastResizeH) return;
  _lastResizeW = w;
  _lastResizeH = h;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);

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

  // Initial draw
  drawPlainTexture();
  drawTexture("front");
  drawTexture("back");
}

function drawPlainTexture() {
  const ctx = plainTexCanvas.getContext("2d");

  ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
  ctx.fillStyle = designState.shirtColor;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  plainTexture.needsUpdate = true;
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
  texture.needsUpdate = true;
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
  if (renderer && camera && scene) renderer.render(scene, camera);
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
function applyProductToHeader(product) {
  if (!product) return;
  const numFmt = new Intl.NumberFormat("ru-RU").format(product.price);
  const fmt = numFmt + " сум";
  document
    .querySelectorAll(".summary-price .summary-val, .summary-price .summary-value, .configurator-price")
    .forEach((el) => { el.textContent = fmt; });
  ["panel-price", "foot-price-num", "sheet-price-num"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = numFmt;
  });
  if (!product.name_ru) return;
  // Drop the i18n key so a language switch won't overwrite the product name
  ["panel-product-name", "sheet-product-name"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) { el.removeAttribute("data-i18n"); el.textContent = product.name_ru; }
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

async function loadProductFromSlug() {
  const slug = new URLSearchParams(window.location.search).get("slug");
  let glbUrl = "assets/models/t_shirt.glb?v=1";

  if (!slug) {
    // No slug → name the default garment instead of leaving the placeholder.
    // Purely cosmetic: the model still comes from the bundled default, so a
    // failed or slow catalog call costs nothing but the generic headline.
    try {
      const def = await fetchDefaultProduct();
      if (def) {
        currentProduct = def;
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
        if (product.glb_url) glbUrl = product.glb_url;
        applyProductToHeader(product);
      }
    } catch (e) {
      console.warn("Product fetch failed, using default model:", e);
    }
  }

  loadShirtModel(glbUrl);
}

function loadShirtModel(glbUrl) {
  const loader = new THREE.GLTFLoader();

  loader.load(
    glbUrl || "assets/models/t_shirt.glb?v=1",

    // onLoad
    function (gltf) {
      const object = gltf.scene;

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

        const mat = new THREE.MeshStandardMaterial({
          map,
          side: THREE.FrontSide,
          roughness: 0.7,
          metalness: 0.0,
        });

        if (!isFrontBody && !isBackBody) {
          mat.color.set(0xffffff);
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

      // Ensure maps/colors are coherent right after model load.
      applyActiveTexture();

      // Auto-fit: normalize size and frame camera to fill ~75% of viewport.
      fitCameraToObject(object);

      // Extract UV→world triangles AFTER the fit (which scales the model), so the
      // 2D editor's texture↔screen map uses final world positions.
      buildMeshTris();

      // Hide loading overlay
      hideLoadingOverlay();
    },

    // onProgress
    function (xhr) {
      if (xhr.total) {
        const pct = Math.round((xhr.loaded / xhr.total) * 100);
        const el = document.getElementById("loading-pct");
        if (el) el.textContent = pct + "%";
      }
    },

    // onError — log error, show canvas message, fall back to placeholder geometry
    function (err) {
      console.error('[LOOM] 3D model failed to load:', err);
      const loadingEl = document.getElementById('loading-overlay');
      if (loadingEl) loadingEl.style.display = 'none';
      createPlaceholderShirt();
      hideLoadingOverlay();
    },
  );
}

/**
 * Placeholder t-shirt built from Three.js primitives.
 * Drop a real .glb or .obj file into assets/models/ to replace this.
 */
function createPlaceholderShirt() {
  const group = new THREE.Group();

  shirtMaterials = [];
  frontPrintMaterials = [];
  backPrintMaterials = [];
  plainColorMaterials = [];

  const mat = new THREE.MeshStandardMaterial({
    map: frontTexture,
    roughness: 0.78,
    metalness: 0,
    side: THREE.FrontSide,
  });
  shirtMaterials.push(mat);
  frontPrintMaterials.push(mat);

  // Body
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 2.0, 0.18, 4, 8, 2),
    mat,
  );
  group.add(body);

  // Left sleeve
  const lSleeve = new THREE.Mesh(
    new THREE.BoxGeometry(0.75, 0.52, 0.16, 2, 2, 1),
    mat.clone(),
  );
  lSleeve.material.map = plainTexture;
  lSleeve.material.color.set(0xffffff);
  shirtMaterials.push(lSleeve.material);
  plainColorMaterials.push(lSleeve.material);
  lSleeve.position.set(-1.1, 0.76, 0);
  lSleeve.rotation.z = 0.35;
  group.add(lSleeve);

  // Right sleeve
  const rSleeve = new THREE.Mesh(
    new THREE.BoxGeometry(0.75, 0.52, 0.16, 2, 2, 1),
    mat.clone(),
  );
  rSleeve.material.map = plainTexture;
  rSleeve.material.color.set(0xffffff);
  shirtMaterials.push(rSleeve.material);
  plainColorMaterials.push(rSleeve.material);
  rSleeve.position.set(1.1, 0.76, 0);
  rSleeve.rotation.z = -0.35;
  group.add(rSleeve);

  // Collar
  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.07, 8, 24, Math.PI),
    mat.clone(),
  );
  collar.material.map = plainTexture;
  collar.material.color.set(0xffffff);
  shirtMaterials.push(collar.material);
  plainColorMaterials.push(collar.material);
  collar.position.set(0, 1.08, 0);
  group.add(collar);

  group.scale.setScalar(0.72);
  scene.add(group);
  shirtObject = group;
  applyActiveTexture();
  console.info(
    "Placeholder shirt rendered. Replace assets/models/oversized-tshirt.obj with a proper GLB for best results.",
  );
}

function hideLoadingOverlay() {
  const overlay = document.getElementById("loading-overlay");
  if (!overlay) return;
  overlay.style.opacity = "0";
  setTimeout(() => (overlay.style.display = "none"), 500);
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

  // Look slightly above center to keep focus on chest area.
  // Aim x/z at the TORSO, not the full bbox — the posed sleeves drag the
  // bbox centre sideways, which parks even a centred print off-axis.
  const torsoMeshes = frontBodyMeshes.concat(backBodyMeshes);
  let aim = center;
  if (torsoMeshes.length) {
    const tb = new THREE.Box3();
    torsoMeshes.forEach((m) => tb.expandByObject(m));
    aim = tb.getCenter(new THREE.Vector3());
  }
  const chestTarget = new THREE.Vector3(
    aim.x,
    center.y + size.y * 0.16,
    aim.z,
  );
  const verticalOffset = size.y * 0.08;

  const fov = THREE.MathUtils.degToRad(camera.fov);
  // Frame against the distance from the AIM POINT to the furthest edge, not the
  // half-height: the camera looks above centre, so the hem is further from the
  // axis than size.y/2 and was being cropped (~82px of it) off the bottom.
  const camY = chestTarget.y + verticalOffset;
  const halfV = Math.max(camY - box.min.y, box.max.y - camY);
  const fitHeightDist = halfV / Math.tan(fov * 0.5);
  const fitWidthDist = (size.x * 0.5) / Math.tan(fov * 0.5) / Math.max(camera.aspect, 0.01);

  // 88% fill — leaves a small breathing margin around the garment.
  const distance = Math.max(fitHeightDist, fitWidthDist) / 0.88;

  // Anchor the front/back views on the GARMENT'S facing axis, not world Z.
  // The scan is rotated ~25° in world space; a world-axis camera views it
  // obliquely, and from an oblique view no print placement can look centred.
  const facing = garmentFacingDir();
  _garmentFacing = facing.clone();
  CAM_VIEWS.front.x = chestTarget.x + facing.x * distance;
  CAM_VIEWS.front.y = chestTarget.y + verticalOffset;
  CAM_VIEWS.front.z = chestTarget.z + facing.z * distance;
  CAM_VIEWS.back.x = chestTarget.x - facing.x * distance;
  CAM_VIEWS.back.y = chestTarget.y + verticalOffset;
  CAM_VIEWS.back.z = chestTarget.z - facing.z * distance;

  camera.near = Math.max(0.01, distance / 120);
  camera.far = Math.max(50, distance * 20 + size.length());
  camera.updateProjectionMatrix();

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

  if (renderer && scene && camera) renderer.render(scene, camera);
}

// ================================================================
// SECTION 8 — ANIMATION LOOP
// ================================================================

function animate() {
  requestAnimationFrame(animate);

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
  const pos = CAM_VIEWS[view];
  const target = INITIAL_VIEW.target || new THREE.Vector3(0, 0, 0);
  camera.position.set(pos.x, pos.y, pos.z);
  controls.target.set(target.x, target.y, target.z);
  controls.update();
  camAnim.active = false;
  if (renderer && camera && scene) renderer.render(scene, camera);
}

function bindResetViewButton() {
  const btn = document.getElementById("btn-reset-view");
  if (!btn) return;

  btn.addEventListener("click", () => {
    if (!INITIAL_VIEW.position || !INITIAL_VIEW.target) return;

    designState.activeView = "front";
    const btnFront = document.getElementById("btn-view-front");
    const btnBack = document.getElementById("btn-view-back");
    if (btnFront && btnBack) {
      btnFront.classList.add("active");
      btnFront.setAttribute("aria-pressed", "true");
      btnBack.classList.remove("active");
      btnBack.setAttribute("aria-pressed", "false");
    }

    camAnim.targetX = INITIAL_VIEW.position.x;
    camAnim.targetY = INITIAL_VIEW.position.y;
    camAnim.targetZ = INITIAL_VIEW.position.z;
    camAnim.targetLookX = INITIAL_VIEW.target.x;
    camAnim.targetLookY = INITIAL_VIEW.target.y;
    camAnim.targetLookZ = INITIAL_VIEW.target.z;
    camAnim.active = true;

    applyActiveTexture();
    refreshDesignCanvas();
  });
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
  if (!flatMode) return;
  const ae = document.activeElement;
  if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
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
  bindOrderModal();
  bindMobileNav();
  bindSizeSelector();
  bindCenterButtons();
  bindLayerControls();
  bindFlatEditor();
  bindSurfaceToggle();
  bindSheet();
  bindMoreMenu();
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
    // Summary tab (if visible) + order-modal summary use translated color/labels
    try { if (typeof updateSummaryTab === "function") updateSummaryTab(); } catch (e) {}
    try { if (typeof renderCart === "function") renderCart(); } catch (e) {}
    // JS-written labels: the CTA swaps between two keys by state, and the
    // flat editor paints its "область печати" caption into a canvas.
    try { if (typeof updateCartCta === "function") updateCartCta(); } catch (e) {}
    try { if (typeof renderFlatEditor === "function") renderFlatEditor(); } catch (e) {}
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
    else el.scalePct = Math.max(10, Math.min(200, v));
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
    document.querySelectorAll(".size-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.size === d.size));
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
  if (ti) { ti.focus(); ti.select(); }
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
const FLAT_ACCENT = "rgba(10,132,255,0.95)";

let _flatCv = null, _flatCtx = null;
let _flatBox = null;    // garment box in CSS px
let _flatRect = null;   // print rect in CSS px — the space elements live in
let _flatUI = null;     // { corners:[4], rotate:{x,y} } in CSS px, for hit testing
let _flatBoxes = {};    // element id → drawn box, this face, this render
let _flatGesture = null;
let _flatPinch = null;
const _flatPointers = new Map();
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

// Tinting a 1200px image every pointermove is far too slow, so the coloured
// garment is composited once into an offscreen canvas and reused until the
// face, size or colour actually changes.
const _flatTint = { key: null, cv: null };

function _flatGarmentLayer(face, box, color) {
  const w = Math.max(1, Math.round(box.w)), h = Math.max(1, Math.round(box.h));
  const key = face + "|" + w + "x" + h + "|" + color;
  if (_flatTint.key === key && _flatTint.cv) return _flatTint.cv;

  const cv = document.createElement("canvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const face = designState.activeView;
  _flatArtImg(face); // kicks off the load on first use; repaints on arrival

  const box = _flatGarmentBox(face, W, H);
  _flatBox = box;
  ctx.drawImage(_flatGarmentLayer(face, box, designState.shirtColor), box.x, box.y, box.w, box.h);

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
  ctx.strokeStyle = FLAT_ACCENT;
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
  if (!hit) {
    // Empty garment → drop the selection, the way every canvas editor does.
    if (_flatActiveId()) { selectElement(null); renderFlatEditor(); }
    return;
  }

  e.preventDefault();
  _flatPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { _flatCv.setPointerCapture(e.pointerId); } catch (_) {}

  const el = _flatActiveEl();
  if (!el) return;
  const b = _flatBoxes[el.id];
  const center = b ? { x: b.cx, y: b.cy } : p;

  if (hit.type === "move") {
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
  const empty = !_viewHasContent(designState.activeView);
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
  const cv = document.getElementById("flat-canvas");
  if (!cv) return;
  _flatCv = cv;
  _flatCtx = cv.getContext("2d");

  cv.addEventListener("pointerdown", _flatOnPointerDown);
  window.addEventListener("pointermove", _flatOnPointerMove);
  window.addEventListener("pointerup", _flatOnPointerUp);
  window.addEventListener("pointercancel", _flatOnPointerUp);

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
// Three resting heights, one per step's actual need. Colour deliberately does
// NOT go full height: the entire point of a configurator is watching the
// garment change, and a sheet that covers the shirt while you pick its colour
// is the same mistake as a full-screen wizard page.
// Must match --peek in the phone stylesheet: the CSS derives the stage height
// and the Перед/Зад position from it, and this drives the snap points.
const SHEET_PEEK = 54;      // dvh — design: garment gets the screen
const SHEET_MID  = 62;      // dvh — colour/size: garment still visible above
const SHEET_FULL = 86;      // dvh — order: a summary, nothing to watch
const SHEET_H = { design: SHEET_PEEK, color: SHEET_MID, order: SHEET_FULL };
let currentStep = "design";
let _sheetOpen = false;

function _isSheetLayout() {
  return window.matchMedia("(max-width: 900px)").matches;
}

function setStep(step) {
  if (SHEET_STEPS.indexOf(step) < 0) step = "design";
  currentStep = step;

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
  snapSheetToStep();
}

/** Rest the sheet at the height this step actually needs. */
function snapSheetToStep() {
  const sheet = document.getElementById("studio-sheet");
  if (!sheet) return;
  const h = SHEET_H[currentStep] || SHEET_PEEK;
  _sheetOpen = h >= SHEET_FULL;
  sheet.style.setProperty("--sheet-h", h + "dvh");
}

/**
 * Tick only what the user has genuinely done. Colour and size always hold a
 * valid value, so ticking them would claim credit for work nobody did — which
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
  const rest = SHEET_H[currentStep] || SHEET_PEEK;
  sheet.style.setProperty("--sheet-h", (_sheetOpen ? SHEET_FULL : rest) + "dvh");
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
    if (open) place();
  });
  window.addEventListener("resize", () => { if (menu && menu.classList.contains("open")) place(); });
  window.addEventListener("scroll", close, true);
  if (menu) menu.querySelectorAll(".dock-more-item").forEach((i) => i.addEventListener("click", close));
  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target) && !(menu && menu.contains(e.target))) close();
  });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
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

  document.querySelectorAll(".surface-btn").forEach((b) => {
    const on2 = (b.dataset.surface === "flat") === flatMode;
    b.classList.toggle("active", on2);
    b.setAttribute("aria-selected", String(on2));
  });

  if (flatMode) renderFlatEditor();
  else if (typeof onWindowResize === "function") onWindowResize();
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
let _flatRewardShown = false;
function maybeShowFirstDesignReward() {
  if (_flatRewardShown || !_viewHasContent(designState.activeView)) return;
  _flatRewardShown = true;
  setFlatMode(false);
  setTimeout(() => { if (!flatMode) setFlatMode(true); }, 2200);
}

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
  designState.shirtColor = s.shirtColor;
  Object.keys(uploadedFileData).forEach((k) => delete uploadedFileData[k]);
  Object.assign(uploadedFileData, s.files);
  if (designState.activeView !== s.activeView) setActiveView(s.activeView);
  syncPanelFromState();
  redrawActive();
  updateViewToggleMarkers();
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
  document.body.appendChild(t);

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
  if (ti) ti.value = isText ? el.content : "";

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
  return Object.assign(base, { name: el.name, scalePct: el.scalePct, key: el.key || null });
}

function _serializeView(view) {
  const r = printRect(view);
  return {
    printRect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) },
    elements: elementsOf(view).filter((e) => e.type === "text" ? !!e.content : !!e.img).map(_serializeElement),
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
    const up = await fetch(getApiBase() + "/api/uploads", { method: "POST", body: fd });
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
  return elementsOf(view).filter((e) => e.type === "text" && e.content);
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
  if (!_viewHasContent(view)) return null;
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
  elementsOf(view).forEach((el) => drawElementIn(ctx, el, r, false));
  return c.toDataURL("image/png");
}

// Capture production proofs for the current design: shadow-free flat print PNGs +
// 3D garment mockups (JPEG). Uploads them and returns R2 keys + the mockup data
// URLs (so the Telegram worker payload can reuse them without re-rendering).
async function captureProofs() {
  const active = { front: _viewHasContent("front"), back: _viewHasContent("back") };

  // Flat print masters (artwork-only, transparent, hi-res) for non-empty views.
  const printData = {
    front: active.front ? _renderPrintCanvas("front") : null,
    back: active.back ? _renderPrintCanvas("back") : null,
  };

  // 3D mockups — _snapshotURL captures the CURRENT camera, so choreograph it per view.
  const mockData = { front: null, back: null };
  if (renderer && camera && controls && scene) {
    // Snapshot the user's ACTUAL live view — addToCart leaves them editing, so we
    // must restore the exact camera/orbit afterwards, not snap to a canned preset.
    const camPos = camera.position.clone();
    const camTgt = controls.target.clone();
    drawTexture("front");
    drawTexture("back");
    applyActiveTexture();
    ["front", "back"].forEach((v) => {
      camera.position.set(CAM_VIEWS[v].x, CAM_VIEWS[v].y, CAM_VIEWS[v].z);
      // Pin the look-at too — CAM_VIEWS anchors assume the fitted target, and a
      // user-panned orbit target would tilt both mockups off-axis.
      if (INITIAL_VIEW.target) controls.target.copy(INITIAL_VIEW.target);
      controls.update();
      renderer.render(scene, camera);
      mockData[v] = _snapshotURL("image/jpeg", 0.85);
    });
    camera.position.copy(camPos);
    controls.target.copy(camTgt);
    controls.update();
    renderer.render(scene, camera);
  }

  // Interactive 3D review model — the exact textured garment, baked, for the admin.
  const glbDataUrl = await captureGLB();

  // Upload everything in parallel. Mockups upload only for active views (a blank
  // side's plain-garment render isn't worth storing); prints already gated above.
  const [frontPrintKey, backPrintKey, frontMockupKey, backMockupKey, modelKey] = await Promise.all([
    printData.front ? _uploadDataUrl(printData.front, "front-print.png") : null,
    printData.back ? _uploadDataUrl(printData.back, "back-print.png") : null,
    active.front && mockData.front ? _uploadDataUrl(mockData.front, "front-mockup.jpg") : null,
    active.back && mockData.back ? _uploadDataUrl(mockData.back, "back-mockup.jpg") : null,
    glbDataUrl ? _uploadDataUrl(glbDataUrl, "model.glb") : null,
  ]);

  return {
    frontPrintKey, backPrintKey, frontMockupKey, backMockupKey, modelKey,
    frontMockupData: mockData.front, backMockupData: mockData.back,
  };
}
async function addToCart(opts) {
  opts = opts || {}; // { openDrawer=true } — buyNow() passes false and navigates itself
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
        unitPrice: currentProduct ? currentProduct.price : 150000,
        quantity: 1,
      });
    } catch (err) {
      if (err && err.status === 401) showToast(CT("cfg.toastLoginCart", "Войдите, чтобы добавить в корзину"), "error");
      else showToast(err.message || CT("cfg.toastAddError", "Ошибка добавления"), "error");
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

  SHIRT_COLORS.forEach(({ name, hex, i18n, light }) => {
    const btn = document.createElement("button");
    btn.className =
      "swatch-btn" + (hex === designState.shirtColor ? " selected" : "");
    btn.title = i18n ? CT(i18n, name) : name;
    btn.dataset.hex = hex;
    btn.style.background = hex;
    if (light) btn.style.border = "2px solid #D1D5DB";

    btn.addEventListener("click", () => selectShirtColor(hex, btn));
    container.appendChild(btn);
  });
}

// ----------------------------------------------------------------
// Size selector
// ----------------------------------------------------------------
function bindSizeSelector() {
  document.querySelectorAll(".size-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      trackStep("cfg_style");
      selectedSize = btn.dataset.size;
      document.querySelectorAll(".size-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.size === selectedSize);
      });
    });
  });
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
function setActiveView(view) {
  if (designState.activeView === view) return;
  designState.activeView = view;

  [["btn-view-front", "front"], ["btn-view-back", "back"]].forEach(([id, v]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle("active", v === view);
    btn.setAttribute("aria-pressed", String(v === view));
  });

  // Animate camera to selected view
  setCameraView(view);

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
  designState.shirtColor = hex;

  // Update swatch selection highlight
  document.querySelectorAll(".swatch-btn").forEach((b) => {
    b.classList.toggle("selected", b.dataset.hex === hex);
  });

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
  if (renderer && camera && scene && !flatMode) renderer.render(scene, camera);
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
    t.content = textIn.value;
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

function handleImageFile(file) {
  if (!file.type.startsWith("image/")) {
    showToast(
      "Пожалуйста, загрузите файл изображения (PNG, JPG, SVG)",
      "error",
    );
    return;
  }

  if (file.size > 15 * 1024 * 1024) {
    showToast("Файл слишком большой (макс. 15 МБ)", "error");
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      // Downscale phone-camera photos: the texture canvas is 2048px, so
      // anything larger only makes every redraw (and the order upload)
      // pay for pixels that can never be seen
      let finalImg = img;
      let finalData = e.target.result;
      const maxDim = Math.max(img.naturalWidth || 0, img.naturalHeight || 0);
      if (maxDim > TEX_SIZE && file.type !== "image/svg+xml") {
        const k = TEX_SIZE / maxDim;
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * k);
        c.height = Math.round(img.naturalHeight * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        finalData = c.toDataURL(file.type === "image/jpeg" ? "image/jpeg" : "image/png", 0.92);
        finalImg = new Image();
        finalImg.src = finalData;
      }

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
      el.name = file.name;
      el.scalePct = scalePct;
      el.key = null; // re-uploaded on the next order

      // Store (possibly downscaled) file data per ELEMENT for order submission
      uploadedFileData[el.id] = {
        base64: finalData,
        name: file.name,
        type: file.type,
        size: file.size,
      };

      syncPanelFromState();
      redrawActive();
      updateViewToggleMarkers();
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
  const btnReset = document.getElementById("btn-reset-design");
  const btnOrder = document.getElementById("btn-place-order");

  if (btnReset) btnReset.addEventListener("click", resetDesign);
  if (btnOrder) btnOrder.addEventListener("click", buyNow);
}

/**
 * Capture renderer.domElement WITHOUT the on-shirt selection handles, then
 * restore the live (handled) view. Used for every snapshot/export so editing
 * handles never bake into the saved PNG / order preview.
 */
function _snapshotURL(type, quality) {
  const prev = _showHandles;
  _showHandles = false;
  try {
    drawTexture("front");
    drawTexture("back");
    if (renderer && scene && camera) renderer.render(scene, camera);
    return renderer.domElement.toDataURL(type, quality);
  } finally {
    _showHandles = prev;
    redrawActive();
    if (renderer && scene && camera) renderer.render(scene, camera);
  }
}

function updateSummaryTab() {
  // Take a snapshot of the Three.js renderer
  if (renderer) {
    const snap = document.getElementById("summary-snapshot");
    if (snap) {
      const ctx = snap.getContext("2d");
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, snap.width, snap.height);
        // Crop to center square
        const src = renderer.domElement;
        const side = Math.min(src.width, src.height);
        const sx = (src.width - side) / 2;
        const sy = (src.height - side) / 2;
        ctx.drawImage(src, sx, sy, side, side, 0, 0, snap.width, snap.height);
      };
      img.src = _snapshotURL();
    }
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
      if (el.type === "text" && el.content) texts.push(`${label}: ${el.content}`);
      if (el.type === "image" && el.img) logos.push(`${label}: ${el.name || "logo"}`);
    });
  });
  const fonts = [...new Set(
    ["front", "back"].flatMap((v) => elementsOf(v).filter((e) => e.type === "text" && e.content).map((e) => e.font)),
  )];
  setEl("sum-text", texts.join(" · ") || "—");
  setEl("sum-font", fonts.join(", ") || "—");
  setEl("sum-image", logos.join(" · ") || CT("cfg.notUploaded", "Не загружено"));
}

function resetDesign() {
  markUndo("reset");
  designState.shirtColor = DEFAULT_SHIRT_COLOR;
  selectedSize = "L";

  ["front", "back"].forEach((v) => {
    designState[v].elements = [];
    designState[v].selId = null;
  });

  // Reset size buttons
  document.querySelectorAll(".size-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.size === "L");
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

  // Reselect white swatch
  document.querySelectorAll(".swatch-btn").forEach((b) => {
    b.classList.toggle("selected", b.dataset.hex === DEFAULT_SHIRT_COLOR);
  });

  syncPanelFromState();
  drawTexture("front");
  drawTexture("back");
  applyActiveTexture();
  renderFlatEditor();
  updateViewToggleMarkers();
  showUndoToast(CT("cfg.wasReset", "Дизайн сброшен"));
}

// ================================================================
// SECTION 15 — SAVE DESIGN (screenshot download)
// ================================================================

function bindSaveDesign() {
  const btn = document.getElementById("btn-save-design");
  if (!btn) return;

  btn.addEventListener("click", () => {
    if (!renderer) return;
    // Render one extra frame to ensure latest state
    renderer.render(scene, camera);
    const url = _snapshotURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = "my-loom-design.png";
    a.click();
    showToast("Дизайн сохранён!", "success");
  });
}

// ================================================================
// SECTION 16 — ORDER MODAL
// ================================================================

// Map hex → display name for the order summary.
function getColorName(hex) {
  const def = shirtColorDef(hex);
  if (def) return def.i18n ? CT(def.i18n, def.name) : def.name;
  return COLOR_NAMES[hex] || hex; // custom picker colours keep their stored name
}

async function openOrderModal(cartMode) {
  cartMode = cartMode === true;
  window.__cartCheckout = cartMode;

  // Orders require a Telegram-VERIFIED phone number (no random numbers).
  let user = null;
  if (window.LOOM_AUTH) {
    try { user = await window.LOOM_AUTH.getCurrentUser(); } catch (_) {}
  }

  if (!user || !user.phone_verified) {
    if (window.LOOM_LOGIN_MODAL) {
      if (user && !user.phone_verified) {
        showToast(CT('order.verifyPhone', 'Подтвердите номер телефона через Telegram, чтобы оформить заказ.'), 'error');
      }
      try {
        await window.LOOM_LOGIN_MODAL.open();      // phone → Telegram contact → verified
      } catch (_) { return; }                       // user cancelled
      // Refresh the cached profile so phone_verified is current
      if (window.LOOM_AUTH) { try { user = await window.LOOM_AUTH.getCurrentUser(true); } catch (_) {} }
    } else if (!user) {
      window.location.href = 'login.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search);
      return;
    }
    if (!user || !user.phone_verified) return;      // still unverified → abort
  }

  _openOrderModalInner(cartMode);
}

function _openOrderModalInner(cartMode) {
  // Cart-checkout mode hides the single-item summary (items already in cart)
  const summaryEl = document.querySelector("#orderModal .order-summary");
  if (summaryEl) summaryEl.style.display = cartMode ? "none" : "";

  updateSummaryTab(); // ensures snapshot + summary info are fresh

  // Populate the existing order modal's summary section
  const setTxt = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };

  setTxt("summaryColor", getColorName(designState.shirtColor));
  setTxt("summarySize", selectedSize);
  setTxt("summaryScale", _scaleSummary("front") + "%");
  setTxt("summaryText", _textSummary("front") || CT("order.textNone", "Не указан"));
  setTxt("summaryFont", _fontSummary("front") || "—");
  setTxt("summaryImage", _logoSummary("front") || CT("cfg.notUploaded", "Не загружено"));
  const _price = currentProduct ? currentProduct.price : 150000;
  setTxt("summaryPrice", window.LOOM_I18N ? window.LOOM_I18N.formatPrice(_price) : (_price.toLocaleString("ru-RU") + " " + CT("cfg.currency", "сум")));

  // Copy 3D renderer screenshot into summary canvas
  const summaryCanvas = document.getElementById("summaryCanvas");
  if (summaryCanvas && renderer) {
    const sc = summaryCanvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      sc.clearRect(0, 0, summaryCanvas.width, summaryCanvas.height);
      const src = renderer.domElement;
      const side = Math.min(src.width, src.height);
      const sx = (src.width - side) / 2;
      const sy = (src.height - side) / 2;
      sc.drawImage(
        src,
        sx,
        sy,
        side,
        side,
        0,
        0,
        summaryCanvas.width,
        summaryCanvas.height,
      );
    };
    img.src = _snapshotURL();
  }

  // Show the modal
  const modal = document.getElementById("orderModal");
  if (modal) {
    modal.style.display = "flex";
    document.body.classList.add("modal-open");

    // Auth prefill — hide badge first, then check
    const badge = document.getElementById("auth-order-badge");
    if (badge) badge.style.display = "none";

    if (window.LOOM_AUTH) {
      window.LOOM_AUTH.getCurrentUser().then((user) => {
        if (!user) return;
        const nameIn = document.getElementById("nameInput");
        const phoneIn = document.getElementById("phoneInput");
        if (nameIn && !nameIn.value && user.name) nameIn.value = user.name;
        if (phoneIn && !phoneIn.value && user.phone) phoneIn.value = user.phone;
        if (badge) badge.style.display = "block";
        _setupSavedLocation(user); // offer the saved default address
      });
    }

    // desktop only — on phones autofocus pops the keyboard over the
    // order summary before the user has even seen it
    if (window.matchMedia("(pointer: fine)").matches) {
      setTimeout(() => {
        const ni = document.getElementById("nameInput");
        if (ni) ni.focus();
      }, 350);
    }
  }

  // Store design config in modal for submission
  const config = {
    color: designState.shirtColor,
    colorName: getColorName(designState.shirtColor),
    size: selectedSize,
    text: _textSummary("front"),
    font: _fontSummary("front"),
    imageName: _logoSummary("front") || "Не загружено",
    scale: _scaleSummary("front"),
    frontText: _textSummary("front"),
    backText: _textSummary("back"),
    timestamp: new Date().toISOString(),
  };
  localStorage.setItem("loomDesignConfig", JSON.stringify(config));
  if (modal) modal.dataset.designConfig = JSON.stringify(config);
}

// Offer the user's saved default address in the order modal with a
// "Use saved / Enter new" toggle (fixes: saved settings address ignored at checkout).
function _setupSavedLocation(user) {
  const card = document.getElementById("savedLocationCard");
  if (!card) return;

  let preset = null;
  try {
    const raw = user && user.location_preset;
    preset = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
  } catch (_) { preset = null; }

  const addrInput = document.getElementById("addressInput");

  if (!preset || !preset.address) {
    card.style.display = "none";
    window.__savedLocCoords = null;
    return;
  }

  card.style.display = "block";
  const textEl = document.getElementById("savedLocationText");
  if (textEl) textEl.textContent = preset.address;

  const useSaved = document.getElementById("useSavedLocation");
  const enterNew = document.getElementById("enterNewLocation");

  function ensureAddressMode() {
    // Make sure the manual "Address" (text) mode is showing
    const toggleAddr = document.getElementById("toggleAddress");
    if (toggleAddr && !toggleAddr.classList.contains("active")) toggleAddr.click();
  }

  function activate(which) {
    if (useSaved) useSaved.classList.toggle("active", which === "saved");
    if (enterNew) enterNew.classList.toggle("active", which === "new");
    ensureAddressMode();
    if (which === "saved") {
      if (addrInput) addrInput.value = preset.address;
      window.__savedLocCoords =
        preset.lat && preset.lng ? { lat: preset.lat, lng: preset.lng } : null;
    } else {
      if (addrInput) { addrInput.value = ""; addrInput.focus(); }
      window.__savedLocCoords = null;
    }
    if (typeof validateLocation === "function") validateLocation();
  }

  if (!card.dataset.bound) {
    card.dataset.bound = "1";
    if (useSaved) useSaved.addEventListener("click", (e) => { e.preventDefault(); activate("saved"); });
    if (enterNew) enterNew.addEventListener("click", (e) => { e.preventDefault(); activate("new"); });
  }

  // Default to the saved address on open (unless the user already typed something)
  if (addrInput && !addrInput.value.trim()) activate("saved");
}

function closeOrderModal() {
  const modal = document.getElementById("orderModal");
  if (modal) modal.style.display = "none";
  document.body.classList.remove("modal-open");

  // Reset form
  const form = document.getElementById("orderForm");
  if (form) form.reset();

  document
    .querySelectorAll(".field-error")
    .forEach((e) => (e.textContent = ""));
  document
    .querySelectorAll(".field-success")
    .forEach((e) => (e.style.display = "none"));
  document
    .querySelectorAll(".form-input")
    .forEach((e) => e.classList.remove("error", "success"));

  const pi = document.getElementById("phoneInput");
  if (pi) pi.value = "+998";
}

function bindOrderModal() {
  // Trigger from Summary tab's "Заказать" button (already wired in bindSummaryTab)
  // Also keep legacy order-btn if it exists anywhere
  const legacyBtn = document.getElementById("order-btn");
  if (legacyBtn) legacyBtn.addEventListener("click", buyNow);

  const close = document.getElementById("modalClose");
  const backdrop = document.getElementById("modalBackdrop");
  if (close) close.addEventListener("click", closeOrderModal);
  if (backdrop) backdrop.addEventListener("click", closeOrderModal);

  document.addEventListener("keydown", (e) => {
    if (
      e.key === "Escape" &&
      document.getElementById("orderModal")?.style.display === "flex"
    ) {
      closeOrderModal();
    }
  });

  // Phone formatting — caret-preserving: rewriting the value throws the
  // caret to the end, which makes mid-string edits on mobile a fight
  const phone = document.getElementById("phoneInput");
  if (phone) {
    phone.value = "+998";
    phone.addEventListener("input", function (e) {
      const el = e.target;
      const before = el.value;
      const caret = el.selectionStart == null ? before.length : el.selectionStart;
      // digits left of the caret (ignoring the +998 prefix) survive the reformat
      let digitsLeft = before.slice(0, caret).replace(/\D/g, "").replace(/^998/, "").length;

      let v = before.replace(/\D/g, "");
      if (v.startsWith("998")) v = v.slice(3);
      v = v.slice(0, 9);
      let fmt = "+998";
      if (v.length > 0) fmt += " " + v.slice(0, 2);
      if (v.length > 2) fmt += " " + v.slice(2, 5);
      if (v.length > 5) fmt += "-" + v.slice(5, 7);
      if (v.length > 7) fmt += "-" + v.slice(7, 9);
      el.value = fmt;

      // place the caret after the same digit it followed before
      let pos = 4; // just after "+998"
      while (digitsLeft > 0 && pos < fmt.length) {
        pos++;
        if (/\d/.test(fmt[pos - 1])) digitsLeft--;
      }
      try { el.setSelectionRange(pos, pos); } catch (err) { /* type=tel quirk — harmless */ }
    });
  }

  // Location toggle
  const toggleMap = document.getElementById("toggleMap");
  const toggleAddr = document.getElementById("toggleAddress");
  if (toggleMap && toggleAddr) {
    let locationType = "address";
    let mapInit = false;

    toggleMap.addEventListener("click", function () {
      locationType = "map";
      toggleMap.classList.add("active");
      toggleAddr.classList.remove("active");
      document.getElementById("mapContainer").style.display = "block";
      document.getElementById("addressContainer").style.display = "none";
      if (!mapInit) {
        initYandexMap();
        mapInit = true;
      }
    });

    toggleAddr.addEventListener("click", function () {
      locationType = "address";
      toggleAddr.classList.add("active");
      toggleMap.classList.remove("active");
      document.getElementById("addressContainer").style.display = "block";
      document.getElementById("mapContainer").style.display = "none";
    });

    // Expose to form submission
    window._getLocationType = () => locationType;
  }

  // Form submission
  const form = document.getElementById("orderForm");
  if (form) form.addEventListener("submit", handleOrderSubmit);

  // Validation helpers
  const nameIn = document.getElementById("nameInput");
  const phoneIn = document.getElementById("phoneInput");
  const addrIn = document.getElementById("addressInput");
  if (nameIn) nameIn.addEventListener("blur", validateNameField);
  if (phoneIn) phoneIn.addEventListener("blur", validatePhoneField);
  if (addrIn) addrIn.addEventListener("blur", validateLocation);
}

// Map coords
let selectedCoords = { lat: 41.2995, lng: 69.2401 };

function initYandexMap() {
  const saved = localStorage.getItem("loom_map_coords");
  if (saved) {
    try {
      selectedCoords = JSON.parse(saved);
    } catch (e) {}
  }

  // Lazy-load the Yandex Maps API on first use — the static <script>
  // used to cost every configurator visitor the full payload up front
  if (typeof ymaps === "undefined") {
    if (window.__loomYmapsLoading) return;
    window.__loomYmapsLoading = true;
    const s = document.createElement("script");
    s.src = "https://api-maps.yandex.ru/2.1/?apikey=&lang=ru_RU";
    s.onload = () => { window.__loomYmapsLoading = false; _createYandexMap(); };
    s.onerror = () => { window.__loomYmapsLoading = false; };
    document.head.appendChild(s);
    return;
  }
  _createYandexMap();
}

function _createYandexMap() {
  if (typeof ymaps === "undefined") return;
  ymaps.ready(() => {
    const map = new ymaps.Map("map", {
      center: [selectedCoords.lat, selectedCoords.lng],
      zoom: 13,
      controls: ["zoomControl"],
    });

    const update = () => {
      const c = map.getCenter();
      selectedCoords = { lat: c[0], lng: c[1] };
      const el = document.getElementById("mapCoords");
      if (el)
        el.textContent = `Координаты: ${c[0].toFixed(4)}, ${c[1].toFixed(4)}`;
      localStorage.setItem("loom_map_coords", JSON.stringify(selectedCoords));
    };
    map.events.add("boundschange", update);
    update();
  });
}

function validateNameField() {
  const el = document.getElementById("nameInput");
  const err = document.getElementById("nameError");
  const ok = el.nextElementSibling.nextElementSibling;
  if (el.value.trim().length < 2) {
    el.classList.add("error");
    el.classList.remove("success");
    if (err) err.textContent = "Минимум 2 символа";
    if (ok) ok.style.display = "none";
    return false;
  }
  el.classList.remove("error");
  el.classList.add("success");
  if (err) err.textContent = "";
  if (ok) ok.style.display = "block";
  return true;
}

function validatePhoneField() {
  const el = document.getElementById("phoneInput");
  const err = document.getElementById("phoneError");
  const ok = el.nextElementSibling.nextElementSibling;
  const v = el.value.replace(/\D/g, "");
  if (v.length !== 12 || !v.startsWith("998")) {
    el.classList.add("error");
    el.classList.remove("success");
    if (err) err.textContent = "Введите корректный номер";
    if (ok) ok.style.display = "none";
    return false;
  }
  el.classList.remove("error");
  el.classList.add("success");
  if (err) err.textContent = "";
  if (ok) ok.style.display = "block";
  return true;
}

function validateLocation() {
  const locType = window._getLocationType
    ? window._getLocationType()
    : "address";
  const err = document.getElementById("locationError");
  if (locType === "map") {
    if (err) err.textContent = "";
    return true;
  }
  const addr = document.getElementById("addressInput");
  if (addr && addr.value.trim().length < 10) {
    if (err) err.textContent = "Введите полный адрес";
    return false;
  }
  if (err) err.textContent = "";
  return true;
}

// Export the textured garment as a binary glTF (.glb) data URL — the EXACT model
// the customer designed (baked textures), for the admin's interactive 3D review +
// download. Exports just shirtObject (no lights/camera). Best-effort: resolves null
// on any failure so it never blocks an order.
async function captureGLB() {
  return new Promise((resolve) => {
    if (!shirtObject || typeof THREE.GLTFExporter === "undefined") { resolve(null); return; }
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      drawTexture("front");
      drawTexture("back");
      const exporter = new THREE.GLTFExporter();
      // Safety net — never hang the order flow if serialization stalls.
      setTimeout(() => finish(null), 20000);
      exporter.parse(
        shirtObject,
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

// Submit the account cart as a single multi-item order (Phase 2 checkout).
async function handleCartCheckout(o) {
  try {
    const res = await fetch(getApiBase() + "/api/cart/checkout", {
      method: "POST",
      headers: _authHeaders(true),
      credentials: "include",
      body: JSON.stringify({
        customerName: o.nameVal,
        customerPhone: o.phoneFmt,
        address: o.addrVal || null,
        coordinates: o.locType === "map" ? o.coords : null,
        comment: o.comment || null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      showToast("Войдите, чтобы оформить заказ", "error");
    } else if (res.status === 403) {
      showToast("⛔ " + (data.error || "Доступ запрещён"), "error");
    } else if (res.ok) {
      window.__cartCheckout = false;
      closeOrderModal();
      await loadCart();
      renderCart();
      updateCartCount();
      showToast("Заказ оформлен! №" + data.id);
    } else {
      showToast(data.error || "Ошибка оформления заказа", "error");
    }
  } catch (e) {
    showToast("Ошибка сети. Попробуйте снова.", "error");
  } finally {
    o.btn.disabled = false;
    if (o.txt) o.txt.style.display = "block";
    if (o.loader) o.loader.style.display = "none";
  }
}

async function handleOrderSubmit(event) {
  event.preventDefault();

  if (!validateNameField() || !validatePhoneField() || !validateLocation())
    return;

  const btn = document.getElementById("submitBtn");
  const txt = document.getElementById("submitText");
  const loader = document.getElementById("submitLoader");
  btn.disabled = true;
  if (txt) txt.style.display = "none";
  if (loader) loader.style.display = "flex";

  try {
    const locType = window._getLocationType ? window._getLocationType() : "address";
    const addrVal = document.getElementById("addressInput")?.value.trim() || "";
    const coords = locType === "map"
      ? `${selectedCoords.lat}, ${selectedCoords.lng}`
      : "Не указаны";
    const nameVal = [
      document.getElementById("nameInput")?.value.trim(),
      document.getElementById("surnameInput")?.value.trim(),
    ].filter(Boolean).join(" ");
    const phoneFmt = document.getElementById("phoneInput")?.value.trim() || "";
    const comment = document.getElementById("commentInput")?.value.trim() || "";

    // ── Cart-checkout mode: submit the whole cart as ONE multi-item order ──
    if (window.__cartCheckout) {
      await handleCartCheckout({ nameVal, phoneFmt, addrVal, coords, comment, locType, btn, txt, loader });
      return;
    }

    // ── 1. Upload both logos to R2 (front + back, independently) ──────────
    const [logoKey, backLogoKey] = await Promise.all([_uploadLogoFor("front"), _uploadLogoFor("back")]);
    if (_logoUploadIncomplete("front") || _logoUploadIncomplete("back")) {
      showToast("Ошибка загрузки логотипа. Пожалуйста, попробуйте снова перед отправкой заказа.", "error");
      btn.disabled = false;
      if (txt) txt.style.display = "block";
      if (loader) loader.style.display = "none";
      return;
    }

    // ── 2. Capture production proofs: shadow-free print masters + 3D mockups.
    //      Persisted with the order so the admin can reprint the EXACT artwork.
    //      Mockup data URLs are reused for the Telegram notification below.
    const proofs = await captureProofs();
    const frontScreenshot = proofs.frontMockupData;
    const backScreenshot = proofs.backMockupData;

    // ── 3. Build FULL design JSON (placement, rotation, both views) ────────
    const designJson = _buildDesignJson();

    // ── 4. POST /api/orders ────────────────────────────────────────────────
    const totalPrice = currentProduct ? currentProduct.price : 150000;
    const apiHeaders = { "Content-Type": "application/json" };
    if (window.LOOM_AUTH) {
      const token = window.LOOM_AUTH.getToken();
      if (token) apiHeaders["Authorization"] = "Bearer " + token;
    }

    const apiBody = {
      customerName: nameVal,
      customerPhone: phoneFmt,
      address: addrVal || null,
      coordinates: locType === "map" ? coords : null,
      comment: comment || null,
      designJson,
      logoKey,
      backLogoKey,
      frontPrintKey: proofs.frontPrintKey,
      backPrintKey: proofs.backPrintKey,
      frontMockupKey: proofs.frontMockupKey,
      backMockupKey: proofs.backMockupKey,
      modelKey: proofs.modelKey,
      totalPrice,
      productId: currentProduct ? currentProduct.id : null,
    };

    const apiRes = await fetch(getApiBase() + "/api/orders", {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify(apiBody),
    });

    let orderId = null;
    if (apiRes.status === 403) {
      const errData = await apiRes.json().catch(() => ({}));
      const bannedMsg = (errData.error || '').toLowerCase().includes('block')
        ? 'Ваш аккаунт заблокирован. Размещение заказов недоступно.'
        : (errData.error || 'Доступ запрещён.')
      showToast('⛔ ' + bannedMsg, 'error')
      return
    } else if (apiRes.ok) {
      const apiData = await apiRes.json();
      orderId = apiData.id;
    } else {
      const errData = await apiRes.json().catch(() => ({}));
      console.warn("API order failed:", errData.error);
    }

    // ── 5. Also notify Telegram worker (non-blocking, best effort) ─────────
    const workerPayload = {
      item: currentProduct ? currentProduct.name_ru : "Футболка",
      color: getColorName(designState.shirtColor),
      size: selectedSize,
      frontText: _textSummary("front"),
      backText: _textSummary("back"),
      frontImage: _logoSummary("front") || "Не загружено",
      backImage: _logoSummary("back") || "Не загружено",
      mapCoordinates: coords,
      customerName: nameVal,
      phone: phoneFmt,
      address: addrVal,
      comment,
      timestamp: new Date().toISOString(),
      orderId: orderId || "?",
      frontScreenshot,
      backScreenshot,
    };
    fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(workerPayload),
    }).catch(() => {});

    const idLabel = orderId ? ` #${orderId}` : "";
    showToast("✅ Заказ" + idLabel + " принят!", "success");
    setTimeout(closeOrderModal, 2500);

  } catch (err) {
    console.error("Order error:", err);
    showToast("❌ Ошибка отправки: " + err.message, "error");
  } finally {
    btn.disabled = false;
    if (txt) txt.style.display = "block";
    if (loader) loader.style.display = "none";
  }
}

// ================================================================
// SECTION 17 — TOAST NOTIFICATION
// ================================================================

function showToast(message, type = "success") {
  const existing = document.getElementById("loom-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "loom-toast";
  const bg = type === "success" ? "var(--ok)" : "var(--danger)";

  toast.style.cssText = `
    position:fixed; bottom:calc(24px + env(safe-area-inset-bottom)); left:50%;
    transform:translateX(-50%) translateY(20px);
    width:max-content; max-width:calc(100vw - 32px); text-align:center;
    background:${bg}; color:var(--on-accent); padding:14px 24px; border-radius:12px;
    font-family:var(--font-body); font-size:.95rem; font-weight:500;
    box-shadow:var(--menu-shadow); display:flex; align-items:center; gap:10px;
    z-index:10001; opacity:0; transition:opacity .3s ease,transform .3s ease;
    pointer-events:none;
  `;
  toast.innerHTML = `<span>${message}</span>`;
  document.body.appendChild(toast);

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

// ================================================================
// SECTION 19 — TEST UTILITY (console debugging)
// ================================================================

window.testTelegramConnection = async function () {
  const data = {
    item: "Тестовый заказ",
    color: "Белый",
    text: "Тест",
    font: "Arial",
    imageUploaded: "Не загружено",
    scale: "100%",
    customerName: "Тест Тестович",
    phone: "+998 90 123-45-67",
    phoneClean: "998901234567",
    address: "Тестовый адрес",
    timestamp: new Date().toISOString(),
  };
  try {
    const r = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = r.ok ? "✅ OK" : `❌ ${r.status}`;
    console.log(result, await r.text());
    showToast(result, r.ok ? "success" : "error");
  } catch (e) {
    console.error(e);
    showToast("❌ " + e.message, "error");
  }
};
