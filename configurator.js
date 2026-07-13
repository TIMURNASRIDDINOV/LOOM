/* ================================================================
  LOOM 3D T-Shirt Configurator — configurator.js
  Three.js r128 | GLTFLoader | OrbitControls
  ================================================================ */

"use strict";

// ================================================================
// SECTION 1 — CONSTANTS
// ================================================================

const TEX_SIZE = 2048; // Offscreen texture canvas dimensions (2048 for crisp logo quality)

// Print area in texture UV space (center-chest region, scaled to 2048)
const PRINT_AREA = { x: 560, y: 360, w: 928, h: 1120 };

// Live bounding boxes (texture-space) of each element, recomputed on every
// drawTexture() — used for per-element hit testing + resize handles.
const _boxes = { front: { text: null, image: null }, back: { text: null, image: null } };
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

// Available shirt colors
const SHIRT_COLORS = [
  { name: "Белый", hex: "#FFFFFF" },
  { name: "Чёрный", hex: "#1F2937" },
];

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

// activeView determines which face the user is editing ('front' | 'back')
const designState = {
  shirtColor: "#FFFFFF",
  activeView: "front",
  activeLayer: "text", // which element the on-shirt drag + design panel edits

  front: {
    text: {
      content: "",
      font: "Arial",
      size: 160,
      color: "#000000",
      bold: false,
      italic: false,
      x: TEX_SIZE / 2,
      y: TEX_SIZE * 0.35,
      rotation: 0,
    },
    image: {
      img: null,
      name: "",
      x: TEX_SIZE / 2,
      y: TEX_SIZE * 0.30,
      scalePct: 100,
      rotation: 0,
    },
  },

  back: {
    text: {
      content: "",
      font: "Arial",
      size: 160,
      color: "#000000",
      bold: false,
      italic: false,
      x: TEX_SIZE / 2,
      y: TEX_SIZE * 0.35,
      rotation: 0,
    },
    image: {
      img: null,
      name: "",
      x: TEX_SIZE / 2,
      y: TEX_SIZE * 0.30,
      scalePct: 100,
      rotation: 0,
    },
  },
};

// Uploaded file metadata per view (for order submission)
const uploadedFileData = { front: null, back: null };

// Selected shirt size
let selectedSize = "L";

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
    if (srcL.text && srcL.text.content) {
      Object.assign(dst.text, {
        content: srcL.text.content,
        font: srcL.text.font || dst.text.font,
        size: srcL.text.size || dst.text.size,
        color: srcL.text.color || dst.text.color,
        bold: !!srcL.text.bold,
        italic: !!srcL.text.italic,
        x: srcL.text.x != null ? srcL.text.x : dst.text.x,
        y: srcL.text.y != null ? srcL.text.y : dst.text.y,
        rotation: srcL.text.rotation || 0,
      });
    }
    if (srcL.image && srcL.image.name) {
      const field = view === "front" ? "logo" : "back-logo";
      try {
        const fr = await fetch(getApiBase() + "/api/cart/" + item.id + "/file/" + field, {
          headers: _authHeaders(false), credentials: "include",
        });
        if (fr.ok) {
          const blob = await fr.blob();
          const dataUrl = await new Promise((resolve) => {
            const R = new FileReader();
            R.onload = () => resolve(R.result);
            R.readAsDataURL(blob);
          });
          await new Promise((resolve) => {
            const img = new Image();
            img.onload = () => { dst.image.img = img; resolve(); };
            img.onerror = resolve;
            img.src = dataUrl;
          });
          dst.image.name = srcL.image.name;
          dst.image.scalePct = srcL.image.scalePct || 100;
          dst.image.x = srcL.image.x != null ? srcL.image.x : dst.image.x;
          dst.image.y = srcL.image.y != null ? srcL.image.y : dst.image.y;
          dst.image.rotation = srcL.image.rotation || 0;
          uploadedFileData[view] = { base64: dataUrl, name: srcL.image.name, type: blob.type, size: blob.size };
        }
      } catch (e) { /* logo fetch failed — text still rehydrates */ }
    }
  }

  // reflect the active view's text in the panel controls
  const t = designState[designState.activeView].text;
  const textIn = document.getElementById("text-content-input");
  if (textIn) textIn.value = t.content;
  const imgCtrl = document.getElementById("image-controls");
  if (imgCtrl && designState[designState.activeView].image.img) imgCtrl.style.display = "flex";

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
 * Redraws the texture for a given view (front or back).
 * Layers: base color → uploaded image → text
 * After drawing, sets needsUpdate = true so Three.js re-uploads to GPU.
 */
function drawTexture(view) {
  const canvas = view === "front" ? frontTexCanvas : backTexCanvas;
  const texture = view === "front" ? frontTexture : backTexture;
  const layer = designState[view];
  const ctx = canvas.getContext("2d");

  drawPlainTexture();

  // 1. Base shirt color fill
  ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
  ctx.drawImage(plainTexCanvas, 0, 0, TEX_SIZE, TEX_SIZE);

  // Reset this view's element boxes; they are filled in as each layer draws.
  _boxes[view] = { text: null, image: null };

  // 3. Uploaded image layer
  if (layer.image.img) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const natW = layer.image.img.naturalWidth || layer.image.img.width;
    const natH = layer.image.img.naturalHeight || layer.image.img.height;
    // scalePct of 100 → the image fills ~30% of texture width
    const factor =
      (layer.image.scalePct / 100) * ((TEX_SIZE * 0.30) / Math.max(natW, natH));
    const dw = natW * factor;
    const dh = natH * factor;
    ctx.translate(layer.image.x, layer.image.y);
    ctx.rotate(layer.image.rotation || 0);
    ctx.drawImage(layer.image.img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
    _boxes[view].image = { cx: layer.image.x, cy: layer.image.y, w: dw, h: dh, rot: layer.image.rotation || 0 };
  }

  // 4. Text layer
  if (layer.text.content) {
    ctx.save();
    const weight = layer.text.bold ? "bold" : "normal";
    const style = layer.text.italic ? "italic" : "normal";
    ctx.font = `${style} ${weight} ${layer.text.size}px "${layer.text.font}"`;
    ctx.fillStyle = layer.text.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const _tw = ctx.measureText(layer.text.content).width;
    // Subtle drop-shadow for legibility on light-colored shirts
    ctx.shadowColor = "rgba(0,0,0,0.12)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;
    ctx.translate(layer.text.x, layer.text.y);
    ctx.rotate(layer.text.rotation || 0);
    ctx.fillText(layer.text.content, 0, 0);
    ctx.restore();
    _boxes[view].text = { cx: layer.text.x, cy: layer.text.y, w: Math.max(_tw, 40), h: layer.text.size * 1.25, rot: layer.text.rotation || 0 };
  }

  // 5. Selection handles are drawn on a separate 2D overlay (see SECTION 9b),
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

async function loadProductFromSlug() {
  const slug = new URLSearchParams(window.location.search).get("slug");
  let glbUrl = "assets/models/t_shirt.glb";

  if (slug) {
    try {
      // 5s cap — on a stalled mobile connection the default model must
      // still appear instead of an endless spinner
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      if (ctrl) setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(getApiBase() + "/api/products/" + encodeURIComponent(slug), ctrl ? { signal: ctrl.signal } : undefined);
      if (res.ok) {
        const product = await res.json();
        currentProduct = product;
        if (product.glb_url) glbUrl = product.glb_url;
        // Update price display
        const priceEls = document.querySelectorAll(".summary-price .summary-val, .summary-price .summary-value, .configurator-price");
        const fmt = new Intl.NumberFormat("ru-RU").format(product.price) + " сум";
        priceEls.forEach(el => { el.textContent = fmt; });
        // New studio panel header + footer price
        const numFmt = new Intl.NumberFormat("ru-RU").format(product.price);
        const nameEl = document.getElementById("panel-product-name");
        // Drop the i18n key so a language switch won't overwrite the product name
        if (nameEl && product.name_ru) { nameEl.removeAttribute("data-i18n"); nameEl.textContent = product.name_ru; }
        ["panel-price", "foot-price-num"].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.textContent = numFmt;
        });
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
    glbUrl || "assets/models/t_shirt.glb",

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
  const chestTarget = new THREE.Vector3(
    center.x,
    center.y + size.y * 0.16,
    center.z,
  );
  const verticalOffset = size.y * 0.08;

  const fov = THREE.MathUtils.degToRad(camera.fov);
  const fitHeightDist = (size.y * 0.5) / Math.tan(fov * 0.5);
  const fitWidthDist =
    (size.x * 0.5) / Math.tan(fov * 0.5) / Math.max(camera.aspect, 0.01);

  // 75% viewport fill target (between 70-80%).
  const distance = Math.max(fitHeightDist, fitWidthDist) / 0.75;

  CAM_VIEWS.front.x = chestTarget.x;
  CAM_VIEWS.front.y = chestTarget.y + verticalOffset;
  CAM_VIEWS.front.z = chestTarget.z + distance;
  CAM_VIEWS.back.x = chestTarget.x;
  CAM_VIEWS.back.y = chestTarget.y + verticalOffset;
  CAM_VIEWS.back.z = chestTarget.z - distance;

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
  renderer.render(scene, camera);
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
    ctx.save();
    ctx.strokeStyle = "rgba(10, 132, 255, 0.55)";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(
      PRINT_AREA.x * sc,
      PRINT_AREA.y * sc,
      PRINT_AREA.w * sc,
      PRINT_AREA.h * sc,
    );
    ctx.setLineDash([]);
    ctx.restore();
  });
}

// ----------------------------------------------------------------
// Text drag on design-canvas
// ----------------------------------------------------------------
(function () {
  let dragging = false,
    ox = 0,
    oy = 0;
  const sc = TEX_SIZE / DESIGN_CANVAS_SIZE; // scale: canvas px → texture px

  document.addEventListener("DOMContentLoaded", () => {
    const dc = document.getElementById("design-canvas");
    if (!dc) return;

    dc.addEventListener("mousedown", (e) => {
      dragging = true;
      const r = dc.getBoundingClientRect();
      ox =
        (e.clientX - r.left) * sc - designState[designState.activeView].text.x;
      oy =
        (e.clientY - r.top) * sc - designState[designState.activeView].text.y;
      dc.style.cursor = "move";
    });

    dc.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const r = dc.getBoundingClientRect();
      const tx = (e.clientX - r.left) * sc - ox;
      const ty = (e.clientY - r.top) * sc - oy;
      const txt = designState[designState.activeView].text;
      txt.x = Math.max(PRINT_AREA.x, Math.min(PRINT_AREA.x + PRINT_AREA.w, tx));
      txt.y = Math.max(PRINT_AREA.y, Math.min(PRINT_AREA.y + PRINT_AREA.h, ty));
      redrawActive();
    });

    const stopDrag = () => {
      dragging = false;
      dc.style.cursor = "default";
    };
    dc.addEventListener("mouseup", stopDrag);
    dc.addEventListener("mouseleave", stopDrag);

    // Touch
    dc.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        const t = e.touches[0],
          r = dc.getBoundingClientRect();
        dragging = true;
        ox =
          (t.clientX - r.left) * sc -
          designState[designState.activeView].text.x;
        oy =
          (t.clientY - r.top) * sc - designState[designState.activeView].text.y;
      },
      { passive: false },
    );
    dc.addEventListener(
      "touchmove",
      (e) => {
        if (!dragging) return;
        e.preventDefault();
        const t = e.touches[0],
          r = dc.getBoundingClientRect();
        const tx = (t.clientX - r.left) * sc - ox;
        const ty = (t.clientY - r.top) * sc - oy;
        const txt = designState[designState.activeView].text;
        txt.x = Math.max(
          PRINT_AREA.x,
          Math.min(PRINT_AREA.x + PRINT_AREA.w, tx),
        );
        txt.y = Math.max(
          PRINT_AREA.y,
          Math.min(PRINT_AREA.y + PRINT_AREA.h, ty),
        );
        redrawActive();
      },
      { passive: false },
    );
    dc.addEventListener("touchend", () => {
      dragging = false;
    });
  });
})();

// ----------------------------------------------------------------
// Image drag on design-canvas-img
// ----------------------------------------------------------------
(function () {
  let dragging = false,
    ox = 0,
    oy = 0;
  const sc = TEX_SIZE / DESIGN_CANVAS_SIZE;

  document.addEventListener("DOMContentLoaded", () => {
    const dc = document.getElementById("design-canvas-img");
    if (!dc) return;

    dc.addEventListener("mousedown", (e) => {
      dragging = true;
      const r = dc.getBoundingClientRect();
      const img = designState[designState.activeView].image;
      ox = (e.clientX - r.left) * sc - img.x;
      oy = (e.clientY - r.top) * sc - img.y;
      dc.style.cursor = "move";
    });

    dc.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const r = dc.getBoundingClientRect();
      const img = designState[designState.activeView].image;
      const tx = (e.clientX - r.left) * sc - ox;
      const ty = (e.clientY - r.top) * sc - oy;
      img.x = Math.max(PRINT_AREA.x, Math.min(PRINT_AREA.x + PRINT_AREA.w, tx));
      img.y = Math.max(PRINT_AREA.y, Math.min(PRINT_AREA.y + PRINT_AREA.h, ty));
      redrawActive();
    });

    const stop = () => {
      dragging = false;
      dc.style.cursor = "default";
    };
    dc.addEventListener("mouseup", stop);
    dc.addEventListener("mouseleave", stop);

    dc.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        const t = e.touches[0],
          r = dc.getBoundingClientRect();
        dragging = true;
        const img = designState[designState.activeView].image;
        ox = (t.clientX - r.left) * sc - img.x;
        oy = (t.clientY - r.top) * sc - img.y;
      },
      { passive: false },
    );
    dc.addEventListener(
      "touchmove",
      (e) => {
        if (!dragging) return;
        e.preventDefault();
        const t = e.touches[0],
          r = dc.getBoundingClientRect();
        const img = designState[designState.activeView].image;
        const tx = (t.clientX - r.left) * sc - ox;
        const ty = (t.clientY - r.top) * sc - oy;
        img.x = Math.max(
          PRINT_AREA.x,
          Math.min(PRINT_AREA.x + PRINT_AREA.w, tx),
        );
        img.y = Math.max(
          PRINT_AREA.y,
          Math.min(PRINT_AREA.y + PRINT_AREA.h, ty),
        );
        redrawActive();
      },
      { passive: false },
    );
    dc.addEventListener("touchend", () => {
      dragging = false;
    });
  });
})();

// ================================================================
// SECTION 9b — ACTIVE-ELEMENT HELPERS
// ================================================================

/**
 * Returns the design element the active layer points at (if it has content).
 */
function _activeDraggable() {
  const layer = designState[designState.activeView];
  const hasText = !!(layer.text && layer.text.content);
  const hasImg = !!(layer.image && layer.image.img);
  const pref = designState.activeLayer;
  if (pref === "text" && hasText) return layer.text;
  if (pref === "image" && hasImg) return layer.image;
  if (hasImg) return layer.image;
  if (hasText) return layer.text;
  return null;
}

// The kind ('text' | 'image') of the active, content-bearing element, or null.
function _activeKind() {
  const layer = designState[designState.activeView];
  const hasText = !!(layer.text && layer.text.content);
  const hasImg = !!(layer.image && layer.image.img);
  const pref = designState.activeLayer;
  if (pref === "text" && hasText) return "text";
  if (pref === "image" && hasImg) return "image";
  if (hasImg) return "image";
  if (hasText) return "text";
  return null;
}

function _clampX(x) { return Math.max(PRINT_AREA.x, Math.min(PRINT_AREA.x + PRINT_AREA.w, x)); }
function _clampY(y) { return Math.max(PRINT_AREA.y, Math.min(PRINT_AREA.y + PRINT_AREA.h, y)); }
function _syncSlider(id, dispId, val, suffix) {
  const s = document.getElementById(id); if (s) s.value = val;
  const d = document.getElementById(dispId); if (d) d.textContent = val + suffix;
}
// Reflect a click-to-select layer change in the design panel UI.
function _syncLayerUI(kind) {
  if (designState.activeLayer === kind) return;
  designState.activeLayer = kind;
  document.querySelectorAll(".layer-btn").forEach((x) => {
    const on = x.dataset.layer === kind;
    x.classList.toggle("active", on);
    x.setAttribute("aria-selected", on ? "true" : "false");
  });
  const tc = document.getElementById("design-text-controls");
  const lc = document.getElementById("design-logo-controls");
  if (tc) tc.style.display = kind === "text" ? "flex" : "none";
  if (lc) lc.style.display = kind === "image" ? "flex" : "none";
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
  const pa = PRINT_AREA;
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

// The active element's 4 box corners (TL,TR,BR,BL) in TEXTURE space, rotated.
function _elementBoxTex(kind) {
  const box = _boxes[designState.activeView] && _boxes[designState.activeView][kind];
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

function _boxQuadPage(kind) {
  const b = _elementBoxTex(kind);
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

// Is there a (non-active) element under the pointer? Return its kind for select.
function _otherKindAt(px, py) {
  const cur = _activeKind();
  for (const k of ["text", "image"]) {
    if (k === cur) continue;
    const layer = designState[designState.activeView][k];
    const has = k === "text" ? !!layer.content : !!layer.img;
    if (!has) continue;
    const q = _boxQuadPage(k);
    if (q && _pointInQuad(px, py, q)) return k;
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
  _updateEditScale();
  const toL = (p) => ({ x: p.x - rect.left, y: p.y - rect.top }); // page → canvas-local

  // Print-area guide — sample its border live via mesh projection (follows orbit)
  const pa = PRINT_AREA, SEG = 10;
  const edge = [];
  for (let i = 0; i <= SEG; i++) edge.push([pa.x + (i / SEG) * pa.w, pa.y]);
  for (let i = 1; i <= SEG; i++) edge.push([pa.x + pa.w, pa.y + (i / SEG) * pa.h]);
  for (let i = SEG - 1; i >= 0; i--) edge.push([pa.x + (i / SEG) * pa.w, pa.y + pa.h]);
  for (let i = SEG - 1; i >= 1; i--) edge.push([pa.x, pa.y + (i / SEG) * pa.h]);
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1; ctx.setLineDash([6, 6]);
  ctx.beginPath();
  let started = false;
  for (const [tx, ty] of edge) {
    const s = texToScreenMesh(tx, ty); if (!s) continue;
    const l = toL(s); started ? ctx.lineTo(l.x, l.y) : (ctx.moveTo(l.x, l.y), started = true);
  }
  ctx.closePath(); ctx.stroke();
  ctx.restore();

  // Active-element selection box + handles
  const kind = _activeKind();
  const box = kind ? _elementBoxTex(kind) : null;
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
    const c = toL(texToScreenPA(PRINT_AREA.x + PRINT_AREA.w / 2, PRINT_AREA.y + PRINT_AREA.h / 2));
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
  if (!editMode) return;
  if (e.pointerType === "mouse" && e.button != null && e.button !== 0) return;
  // Second finger during an active edit gesture → pinch (scale + rotate)
  if (_gesture && _pointers.size >= 1) {
    _pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (_pointers.size >= 2) { e.preventDefault(); e.stopPropagation(); _startPinch(); }
    return;
  }
  let hit = _activeKind() ? _hitTest(e.clientX, e.clientY) : null;
  if (!hit) {
    const other = _otherKindAt(e.clientX, e.clientY);
    if (other) { _syncLayerUI(other); drawEditor(); hit = { type: "move" }; }
  }
  if (!hit) return; // empty shirt/background → let OrbitControls orbit
  // TAKE OVER this gesture: suppress orbit, capture the pointer.
  e.preventDefault(); e.stopPropagation();
  if (controls) controls.enabled = false;
  _pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { renderer.domElement.setPointerCapture(e.pointerId); } catch (_) {}
  const kind = _activeKind();
  const el = designState[designState.activeView][kind];
  const center = texToScreenMesh(el.x, el.y) || { x: e.clientX, y: e.clientY };
  if (hit.type === "move") {
    _gesture = { type: "move", lastX: e.clientX, lastY: e.clientY, rawX: el.x, rawY: el.y };
  } else if (hit.type === "scale") {
    const d0 = Math.hypot(e.clientX - center.x, e.clientY - center.y);
    _gesture = { type: "scale", d0: Math.max(8, d0), startSize: kind === "text" ? el.size : el.scalePct };
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
  const kind = _activeKind();
  if (!kind) return;
  const el = designState[designState.activeView][kind];

  if (_gesture.type === "move") {
    // Accumulate the UNSNAPPED position so centre-snap magnetism never pins the
    // element (it starts at centre-X); snap only adjusts the displayed value.
    const d = _screenToTexDelta(_gesture.rawX, _gesture.rawY, e.clientX - _gesture.lastX, e.clientY - _gesture.lastY);
    _gesture.lastX = e.clientX; _gesture.lastY = e.clientY;
    _gesture.rawX = _clampX(_gesture.rawX + d.dtx);
    _gesture.rawY = _clampY(_gesture.rawY + d.dty);
    let nx = _gesture.rawX, ny = _gesture.rawY;
    const cxp = PRINT_AREA.x + PRINT_AREA.w / 2, cyp = PRINT_AREA.y + PRINT_AREA.h / 2;
    const thr = 8 * _editScale;
    _gesture.snapX = !e.ctrlKey && Math.abs(nx - cxp) < thr;
    _gesture.snapY = !e.ctrlKey && Math.abs(ny - cyp) < thr;
    if (_gesture.snapX) nx = cxp;
    if (_gesture.snapY) ny = cyp;
    el.x = nx; el.y = ny;
    scheduleRedraw();
  } else if (_gesture.type === "scale") {
    const center = texToScreenPA(el.x, el.y);
    const ratio = Math.hypot(e.clientX - center.x, e.clientY - center.y) / _gesture.d0;
    if (kind === "text") {
      el.size = Math.round(Math.max(24, Math.min(240, _gesture.startSize * ratio)));
      _syncSlider("font-size-slider", "font-size-display", el.size, "px");
    } else {
      el.scalePct = Math.round(Math.max(10, Math.min(200, _gesture.startSize * ratio)));
      _syncSlider("image-scale-slider", "image-scale-display", el.scalePct, "%");
    }
    scheduleRedraw();
  } else if (_gesture.type === "rotate") {
    const center = texToScreenPA(el.x, el.y);
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
  let hit = _activeKind() ? _hitTest(e.clientX, e.clientY) : null;
  if (!hit && _otherKindAt(e.clientX, e.clientY)) hit = { type: "move" };
  // No design hit → leave it to OrbitControls' grab cursor (empty = orbit).
  _stage.style.cursor = !hit ? ""
    : hit.type === "rotate" ? "grab"
    : hit.type === "scale" ? "nwse-resize" : "move";
}

// ── Two-finger pinch (scale + rotate) ───────────────────────────
function _startPinch() {
  const kind = _activeKind();
  if (!kind) return;
  const el = designState[designState.activeView][kind];
  const pts = [..._pointers.values()];
  const d0 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  const a0 = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
  _pinch = { d0: Math.max(8, d0), a0, startSize: kind === "text" ? el.size : el.scalePct, startRot: el.rotation || 0 };
  _gesture = null;
}
function _updatePinch() {
  const kind = _activeKind();
  if (!kind || !_pinch) return;
  const el = designState[designState.activeView][kind];
  const pts = [..._pointers.values()];
  if (pts.length < 2) return;
  const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  const a = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
  const ratio = d / _pinch.d0;
  if (kind === "text") {
    el.size = Math.round(Math.max(24, Math.min(240, _pinch.startSize * ratio)));
    _syncSlider("font-size-slider", "font-size-display", el.size, "px");
  } else {
    el.scalePct = Math.round(Math.max(10, Math.min(200, _pinch.startSize * ratio)));
    _syncSlider("image-scale-slider", "image-scale-display", el.scalePct, "%");
  }
  el.rotation = _pinch.startRot + (a - _pinch.a0);
  scheduleRedraw();
}

// ── Keyboard (nudge / delete) ───────────────────────────────────
function _onEdKeyDown(e) {
  if (!editMode) return;
  const ae = document.activeElement;
  if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
  const kind = _activeKind();
  if (!kind) return;
  const el = designState[designState.activeView][kind];
  const step = (e.shiftKey ? 10 : 1) * _editScale;
  if (e.key === "ArrowLeft") el.x = _clampX(el.x - step);
  else if (e.key === "ArrowRight") el.x = _clampX(el.x + step);
  else if (e.key === "ArrowUp") el.y = _clampY(el.y - step);
  else if (e.key === "ArrowDown") el.y = _clampY(el.y + step);
  else if (e.key === "Delete" || e.key === "Backspace") { _deleteActiveElement(); e.preventDefault(); return; }
  else return;
  e.preventDefault();
  redrawActive();
}

function _deleteActiveElement() {
  const view = designState.activeView;
  const kind = _activeKind();
  if (!kind) return;
  if (kind === "text") {
    designState[view].text.content = "";
    const ti = document.getElementById("text-content-input");
    if (ti) ti.value = "";
  } else {
    designState[view].image.img = null;
    designState[view].image.name = "";
    uploadedFileData[view] = null;
    const ic = document.getElementById("image-controls");
    if (ic) ic.style.display = "none";
  }
  redrawActive();
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
  if (!designTabActive) return;
  if (editMode) enterPreviewMode(); else enterEditMode();
}

// Called by the tab navigation when the Design tab opens/closes.
function setDesignEditing(active) {
  designTabActive = active;
  const chip = document.getElementById("btn-toggle-preview");
  if (chip) chip.style.display = active ? "inline-flex" : "none";
  if (active) {
    // Start face-on for a clean placing view; the user can orbit freely after.
    setCameraView(designState.activeView);
    enterEditMode();
  } else {
    enterPreviewMode();
  }
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
  if (chip) chip.addEventListener("click", togglePreview);
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
  bindLayerSwitch();
  bindCart();
  bindSizeGuide();
  bindLangChange();
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
  });
}

// ----------------------------------------------------------------
// Layer switch (Text / Logo) in the unified Design tab
// ----------------------------------------------------------------
function bindLayerSwitch() {
  const btns = document.querySelectorAll(".layer-btn");
  const textCtl = document.getElementById("design-text-controls");
  const logoCtl = document.getElementById("design-logo-controls");
  btns.forEach((b) => {
    b.addEventListener("click", () => {
      const layer = b.dataset.layer; // 'text' | 'image'
      designState.activeLayer = layer;
      btns.forEach((x) => {
        const on = x.dataset.layer === layer;
        x.classList.toggle("active", on);
        x.setAttribute("aria-selected", on ? "true" : "false");
      });
      if (textCtl) textCtl.style.display = layer === "text" ? "flex" : "none";
      if (logoCtl) logoCtl.style.display = layer === "image" ? "flex" : "none";
      _selectedKind = layer;
      redrawActive(); // move the selection box to the newly active element
    });
  });
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
function _buildDesignJson() {
  const front = designState.front, back = designState.back;
  return JSON.stringify({
    shirtColor: designState.shirtColor,
    size: selectedSize,
    front: {
      text: { content: front.text.content, font: front.text.font, size: front.text.size, color: front.text.color, bold: front.text.bold, italic: front.text.italic, x: front.text.x, y: front.text.y, rotation: front.text.rotation || 0 },
      image: { name: front.image.name, scalePct: front.image.scalePct, x: front.image.x, y: front.image.y, rotation: front.image.rotation || 0 },
    },
    back: {
      text: { content: back.text.content, font: back.text.font, size: back.text.size, color: back.text.color, bold: back.text.bold, italic: back.text.italic, x: back.text.x, y: back.text.y, rotation: back.text.rotation || 0 },
      image: { name: back.image.name, scalePct: back.image.scalePct, x: back.image.x, y: back.image.y, rotation: back.image.rotation || 0 },
    },
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

// Upload the uploaded logo file for ONE view (front/back), or null if none.
function _uploadLogoFor(view) {
  const f = uploadedFileData[view];
  return (f && f.base64) ? _uploadDataUrl(f.base64, f.name || view + "-logo.png") : Promise.resolve(null);
}

function _viewHasContent(view) {
  const l = designState[view];
  return !!(l && (l.text.content || l.image.img));
}

// Render the PRINT master for a view: ONLY the artwork (logo + text), cropped to
// the print area, on a TRANSPARENT background, shadow-free, at PRINT_SCALE× the
// texture resolution. This is the file a print shop reproduces. Uses the exact
// same geometry as drawTexture() so the placement matches the preview pixel-for-pixel.
// Returns a PNG data URL, or null if the view is empty.
const PRINT_SCALE = 3; // 928×1120 → 2784×3360 px (~235 dpi at 30×40 cm)
function _renderPrintCanvas(view) {
  if (!_viewHasContent(view)) return null;
  const layer = designState[view];
  const c = document.createElement("canvas");
  c.width = PRINT_AREA.w * PRINT_SCALE;
  c.height = PRINT_AREA.h * PRINT_SCALE;
  const ctx = c.getContext("2d");
  ctx.scale(PRINT_SCALE, PRINT_SCALE);
  ctx.translate(-PRINT_AREA.x, -PRINT_AREA.y); // texture coords → print-area-local

  if (layer.image.img) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const natW = layer.image.img.naturalWidth || layer.image.img.width;
    const natH = layer.image.img.naturalHeight || layer.image.img.height;
    const factor = (layer.image.scalePct / 100) * ((TEX_SIZE * 0.30) / Math.max(natW, natH));
    const dw = natW * factor, dh = natH * factor;
    ctx.translate(layer.image.x, layer.image.y);
    ctx.rotate(layer.image.rotation || 0);
    ctx.drawImage(layer.image.img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }
  if (layer.text.content) {
    ctx.save();
    const weight = layer.text.bold ? "bold" : "normal";
    const style = layer.text.italic ? "italic" : "normal";
    ctx.font = `${style} ${weight} ${layer.text.size}px "${layer.text.font}"`;
    ctx.fillStyle = layer.text.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.translate(layer.text.x, layer.text.y);
    ctx.rotate(layer.text.rotation || 0);
    ctx.fillText(layer.text.content, 0, 0);
    ctx.restore();
  }
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
  const ok = await addToCart({ openDrawer: false });
  if (ok) location.href = "checkout.html";
}
function bindCart() {
  // drawer, badge, checkout handoff → assets/cart.js; we only own "add"
  document.getElementById("btn-add-to-cart")?.addEventListener("click", () => addToCart());
}

// ----------------------------------------------------------------
// Build color swatch buttons from SHIRT_COLORS array
// ----------------------------------------------------------------
function buildColorSwatches() {
  const container = document.getElementById("color-swatches");
  if (!container) return;

  SHIRT_COLORS.forEach(({ name, hex }) => {
    const btn = document.createElement("button");
    btn.className =
      "swatch-btn" + (hex === designState.shirtColor ? " selected" : "");
    btn.title = name;
    btn.dataset.hex = hex;
    btn.style.background = hex;
    if (hex === "#FFFFFF") btn.style.border = "2px solid #D1D5DB";

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
function bindCenterButtons() {
  const btnCenterText = document.getElementById("btn-center-text");
  if (btnCenterText) {
    btnCenterText.addEventListener("click", () => {
      const txt = designState[designState.activeView].text;
      txt.x = TEX_SIZE / 2;
      txt.y = TEX_SIZE * 0.35;
      redrawActive();
    });
  }

  const btnCenterLogo = document.getElementById("btn-center-logo");
  if (btnCenterLogo) {
    btnCenterLogo.addEventListener("click", () => {
      const img = designState[designState.activeView].image;
      img.x = TEX_SIZE / 2;
      img.y = TEX_SIZE * 0.30;
      redrawActive();
    });
  }
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

      // Enter the flat 2D edit mode on the Design tab; leave it elsewhere.
      setDesignEditing(target === "design");

      // Update summary when that tab opens
      if (target === "summary") updateSummaryTab();
    });
  });
}

// ----------------------------------------------------------------
// Front / Back view toggle
// ----------------------------------------------------------------
function bindViewToggle() {
  const btnFront = document.getElementById("btn-view-front");
  const btnBack = document.getElementById("btn-view-back");
  if (!btnFront || !btnBack) return;

  btnFront.addEventListener("click", () =>
    switchView("front", btnFront, btnBack),
  );
  btnBack.addEventListener("click", () =>
    switchView("back", btnBack, btnFront),
  );
}

function switchView(view, activeBtn, inactiveBtn) {
  designState.activeView = view;
  activeBtn.classList.add("active");
  activeBtn.setAttribute("aria-pressed", "true");
  inactiveBtn.classList.remove("active");
  inactiveBtn.setAttribute("aria-pressed", "false");

  // Animate camera to selected view
  setCameraView(view);

  // Swap texture so the material shows the correct design face
  applyActiveTexture();

  // Refresh the design preview
  refreshDesignCanvas();

  // Re-pin the live overlay to the new face.
  if (editMode) drawEditor();
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
  if (renderer && camera && scene) renderer.render(scene, camera);
}

// ================================================================
// SECTION 12 — TEXT TAB CONTROLS
// ================================================================

function bindTextControls() {
  const textIn = document.getElementById("text-content-input");
  const fontSel = document.getElementById("font-family-select");
  const sizeSldr = document.getElementById("font-size-slider");
  const sizeDisp = document.getElementById("font-size-display");
  const colorPkr = document.getElementById("text-color-picker");
  const colorLbl = document.getElementById("text-color-label");
  const btnBold = document.getElementById("btn-bold");
  const btnItal = document.getElementById("btn-italic");
  const btnRmTxt = document.getElementById("btn-remove-text");

  if (!textIn) return;

  const getTxt = () => designState[designState.activeView].text;

  textIn.addEventListener("input", () => {
    getTxt().content = textIn.value;
    scheduleRedraw(); // coalesce — fast typing must not re-upload per keystroke
  });

  fontSel.addEventListener("change", () => {
    getTxt().font = fontSel.value;
    // Pre-load the font in the browser before redrawing
    document.fonts.load(`24px "${fontSel.value}"`).then(() => redrawActive());
  });

  sizeSldr.addEventListener("input", () => {
    const sz = parseInt(sizeSldr.value);
    getTxt().size = sz;
    sizeDisp.textContent = sz + "px";
    scheduleRedraw();
  });

  colorPkr.addEventListener("input", () => {
    getTxt().color = colorPkr.value;
    colorLbl.textContent = colorPkr.value.toUpperCase();
    scheduleRedraw();
  });

  btnBold.addEventListener("click", () => {
    const txt = getTxt();
    txt.bold = !txt.bold;
    btnBold.classList.toggle("active", txt.bold);
    btnBold.setAttribute("aria-pressed", txt.bold);
    redrawActive();
  });

  btnItal.addEventListener("click", () => {
    const txt = getTxt();
    txt.italic = !txt.italic;
    btnItal.classList.toggle("active", txt.italic);
    btnItal.setAttribute("aria-pressed", txt.italic);
    redrawActive();
  });

  btnRmTxt.addEventListener("click", () => {
    const txt = getTxt();
    txt.content = "";
    textIn.value = "";
    redrawActive();
  });
}

// ================================================================
// SECTION 13 — IMAGE TAB CONTROLS
// ================================================================

function bindImageControls() {
  const uploadArea = document.getElementById("upload-area");
  const fileInput = document.getElementById("logo-file-input");
  const scaleSldr = document.getElementById("image-scale-slider");
  const scaleDisp = document.getElementById("image-scale-display");
  const imgControls = document.getElementById("image-controls");
  const btnRmImg = document.getElementById("btn-remove-image");

  if (!uploadArea || !fileInput) return;

  // Click on upload area triggers file picker
  uploadArea.addEventListener("click", () => fileInput.click());
  uploadArea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });

  // Drag-and-drop onto upload zone
  uploadArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadArea.classList.add("drag-over");
  });
  uploadArea.addEventListener("dragleave", () =>
    uploadArea.classList.remove("drag-over"),
  );
  uploadArea.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadArea.classList.remove("drag-over");
    if (e.dataTransfer.files[0]) handleImageFile(e.dataTransfer.files[0]);
  });

  fileInput.addEventListener("change", function () {
    if (this.files && this.files[0]) handleImageFile(this.files[0]);
  });

  scaleSldr.addEventListener("input", () => {
    const pct = parseInt(scaleSldr.value);
    designState[designState.activeView].image.scalePct = pct;
    scaleDisp.textContent = pct + "%";
    scheduleRedraw();
  });

  btnRmImg.addEventListener("click", () => {
    designState[designState.activeView].image.img = null;
    designState[designState.activeView].image.name = "";
    fileInput.value = "";
    uploadedFileData[designState.activeView] = null;
    if (imgControls) imgControls.style.display = "none";
    redrawActive();
  });
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
      const layer = designState[designState.activeView].image;
      layer.img = finalImg;
      layer.name = file.name;
      layer.scalePct = 100;
      layer.x = TEX_SIZE / 2;
      layer.y = TEX_SIZE * 0.30;
      layer.rotation = 0;
      // Make sure the logo layer is the active selection when freshly added.
      if (typeof _syncLayerUI === "function") _syncLayerUI("image");

      // Store (possibly downscaled) file data per view for order submission
      uploadedFileData[designState.activeView] = {
        base64: finalData,
        name: file.name,
        type: file.type,
        size: file.size,
      };

      // Show scale + drag controls
      const ctrl = document.getElementById("image-controls");
      if (ctrl) ctrl.style.display = "flex";

      // Reset scale slider
      const sl = document.getElementById("image-scale-slider");
      if (sl) {
        sl.value = 100;
        document.getElementById("image-scale-display").textContent = "100%";
      }

      redrawActive();
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
  setEl("sum-text", designState.front.text.content || "—");
  setEl(
    "sum-font",
    designState.front.text.content ? designState.front.text.font : "—",
  );
  setEl("sum-image", designState.front.image.name || CT("cfg.notUploaded", "Не загружено"));
}

function resetDesign() {
  designState.shirtColor = "#FFFFFF";
  selectedSize = "L";

  ["front", "back"].forEach((v) => {
    designState[v].text = {
      content: "",
      font: "Arial",
      size: 160,
      color: "#000000",
      bold: false,
      italic: false,
      x: TEX_SIZE / 2,
      y: TEX_SIZE * 0.35,
      rotation: 0,
    };
    designState[v].image = {
      img: null,
      name: "",
      x: TEX_SIZE / 2,
      y: TEX_SIZE * 0.30,
      scalePct: 100,
      rotation: 0,
    };
  });

  // Reset size buttons
  document.querySelectorAll(".size-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.size === "L");
  });

  uploadedFileData.front = null;
  uploadedFileData.back = null;

  // Reset UI controls to defaults
  const ids = ["text-content-input", "custom-color-hex"];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  const cp = document.getElementById("custom-color-picker");
  if (cp) cp.value = "#FFFFFF";
  const fs = document.getElementById("font-size-slider");
  if (fs) {
    fs.value = 160;
  }
  const fl = document.getElementById("font-size-display");
  if (fl) fl.textContent = "160px";
  const is = document.getElementById("image-scale-slider");
  if (is) {
    is.value = 100;
  }
  const id2 = document.getElementById("image-scale-display");
  if (id2) id2.textContent = "100%";
  const ic = document.getElementById("image-controls");
  if (ic) ic.style.display = "none";
  const fi = document.getElementById("logo-file-input");
  if (fi) fi.value = "";

  const bb = document.getElementById("btn-bold");
  if (bb) {
    bb.classList.remove("active");
    bb.setAttribute("aria-pressed", "false");
  }
  const bi = document.getElementById("btn-italic");
  if (bi) {
    bi.classList.remove("active");
    bi.setAttribute("aria-pressed", "false");
  }

  // Reselect white swatch
  document.querySelectorAll(".swatch-btn").forEach((b) => {
    b.classList.toggle("selected", b.dataset.hex === "#FFFFFF");
  });

  drawTexture("front");
  drawTexture("back");
  applyActiveTexture();
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

// Map hex → Russian color name for order display
function getColorName(hex) {
  // Translate the two base colors; fall back to stored name / hex for custom colors
  const h = (hex || "").toUpperCase();
  if (h === "#FFFFFF") return CT("cfg.colorWhite", "Белый");
  if (h === "#1F2937") return CT("cfg.colorBlack", "Чёрный");
  return COLOR_NAMES[hex] || hex;
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
  const front = designState.front;
  const setTxt = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };

  setTxt("summaryColor", getColorName(designState.shirtColor));
  setTxt("summarySize", selectedSize);
  setTxt("summaryScale", front.image.scalePct + "%");
  setTxt("summaryText", front.text.content || CT("order.textNone", "Не указан"));
  setTxt("summaryFont", front.text.font);
  setTxt("summaryImage", front.image.name || CT("cfg.notUploaded", "Не загружено"));
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
    text: front.text.content,
    font: front.text.font,
    imageName: front.image.name || "Не загружено",
    scale: front.image.scalePct,
    frontText: designState.front.text.content,
    backText: designState.back.text.content,
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
    if ((uploadedFileData.front?.base64 && !logoKey) || (uploadedFileData.back?.base64 && !backLogoKey)) {
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
      frontText: designState.front.text.content || "",
      backText: designState.back.text.content || "",
      frontImage: designState.front.image.name || "Не загружено",
      backImage: designState.back.image.name || "Не загружено",
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
