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
    },
    image: {
      img: null,
      name: "",
      x: TEX_SIZE / 2,
      y: TEX_SIZE * 0.30,
      scalePct: 100,
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
    },
    image: {
      img: null,
      name: "",
      x: TEX_SIZE / 2,
      y: TEX_SIZE * 0.30,
      scalePct: 100,
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

  // Load product from ?slug= param, then load its GLB (or fallback)
  await loadProductFromSlug();

  initUI();
  animate();

  // Auth nav
  if (window.LOOM_AUTH) window.LOOM_AUTH.renderAuthNav();
});

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
  renderer.setPixelRatio(window.devicePixelRatio || 1);
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

function onWindowResize() {
  const container = document.getElementById("three-container");
  if (!container || !renderer || !camera) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w === 0 || h === 0) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(w, h, false);

  // Keep the model framing stable when container size/aspect changes.
  if (shirtObject) fitCameraToObject(shirtObject);
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
    ctx.drawImage(
      layer.image.img,
      layer.image.x - dw / 2,
      layer.image.y - dh / 2,
      dw,
      dh,
    );
    ctx.restore();
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
    // Subtle drop-shadow for legibility on light-colored shirts
    ctx.shadowColor = "rgba(0,0,0,0.12)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;
    ctx.fillText(layer.text.content, layer.text.x, layer.text.y);
    ctx.restore();
  }

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
      const res = await fetch(getApiBase() + "/api/products/" + encodeURIComponent(slug));
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
        } else if (isBackBody) {
          backPrintMaterials.push(mat);
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
// SECTION 9b — 3D LOGO DRAG (screen-space delta → texture coords)
// ================================================================

const _rc = new THREE.Raycaster();
const _rcMouse = new THREE.Vector2();
let _logoDragging = false;
let _dragStartClientX = 0, _dragStartClientY = 0;
let _dragBaseX = 0, _dragBaseY = 0;
let _dragObj = null;

/**
 * Returns the design element the on-shirt drag should move: the active layer
 * (text or logo) if it has content, otherwise whichever element exists.
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

/** Returns true if the mouse/touch event hits any part of the shirt. */
function _hitsShirt(e) {
  if (!shirtObject || !renderer || !camera) return false;
  const canvas = renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  _rcMouse.x = ((cx - rect.left) / rect.width) * 2 - 1;
  _rcMouse.y = -((cy - rect.top) / rect.height) * 2 + 1;
  _rc.setFromCamera(_rcMouse, camera);
  const meshes = [];
  shirtObject.traverse((c) => { if (c.isMesh) meshes.push(c); });
  return _rc.intersectObjects(meshes, false).length > 0;
}

function bindLogoDrag3D() {
  const canvas = renderer.domElement;

  function texScale() {
    // Shirt fills ~75% of viewport height; map screen pixels → texture pixels
    return TEX_SIZE / (canvas.clientHeight * 0.75);
  }

  // Pointer events unify mouse + touch and live in the SAME event stream as
  // OrbitControls (which also uses pointer events). We intercept in the capture
  // phase BEFORE OrbitControls' own pointerdown listener, and — when a logo/text
  // is being dragged — stop propagation + disable the controls so the camera
  // does not orbit underneath us. This is the fix for "can't move the logo/text".
  function onDown(e) {
    if (e.button != null && e.button !== 0 && e.pointerType === "mouse") return;
    const d = _activeDraggable();
    if (!d) return;
    if (!_hitsShirt(e)) return;

    _logoDragging = true;
    _dragObj = d;
    if (controls) controls.enabled = false; // freeze camera while repositioning
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}

    _dragStartClientX = e.clientX;
    _dragStartClientY = e.clientY;
    _dragBaseX = d.x;
    _dragBaseY = d.y;

    canvas.style.cursor = "grabbing";
    e.stopPropagation();     // keep OrbitControls' bubble-phase pointerdown from firing
    e.preventDefault();
  }

  function onMove(e) {
    if (!_logoDragging || !_dragObj) {
      // Hover affordance: show a grab cursor over a draggable element
      if (_activeDraggable() && _hitsShirt(e)) canvas.style.cursor = "grab";
      else canvas.style.cursor = "";
      return;
    }
    const sc = texScale();
    const nx = _dragBaseX + (e.clientX - _dragStartClientX) * sc;
    const ny = _dragBaseY + (e.clientY - _dragStartClientY) * sc;
    // Clamp into the printable area so the element never leaves the print zone
    _dragObj.x = Math.max(PRINT_AREA.x, Math.min(PRINT_AREA.x + PRINT_AREA.w, nx));
    _dragObj.y = Math.max(PRINT_AREA.y, Math.min(PRINT_AREA.y + PRINT_AREA.h, ny));
    redrawActive();
    e.preventDefault();
  }

  function onUp(e) {
    if (!_logoDragging) return;
    _logoDragging = false;
    _dragObj = null;
    if (controls) controls.enabled = true; // hand control back to the camera
    try { if (e && e.pointerId != null) canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    canvas.style.cursor = "";
  }

  // Capture phase → our handler runs before OrbitControls' pointerdown
  canvas.addEventListener("pointerdown", onDown, true);
  canvas.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.style.touchAction = "none";
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
  bindLogoDrag3D();
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
    });
  });
}

// ================================================================
// SECTION 10b — CART (Phase 2: account-bound cart + multi-item checkout)
// ================================================================
let cartState = { items: [], total: 0 };

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
function updateCartCount() {
  const n = (cartState.items || []).reduce((s, i) => s + (i.quantity || 1), 0);
  const el = document.getElementById("cartCount");
  if (el) { el.textContent = n; el.classList.toggle("show", n > 0); }
}
async function loadCart() {
  try {
    const res = await fetch(getApiBase() + "/api/cart", { headers: _authHeaders(false), credentials: "include" });
    cartState = res.ok ? await res.json() : { items: [], total: 0 };
  } catch { cartState = { items: [], total: 0 }; }
  updateCartCount();
  return cartState;
}
function _summarizeDesign(designJson) {
  let d = {};
  try { d = JSON.parse(designJson || "{}"); } catch { d = {}; }
  const color = d.shirtColor ? getColorName(d.shirtColor) : "";
  const size = d.size || "";
  const text = (d.front && d.front.text && d.front.text.content) || d.text || "";
  const hasLogo = !!(d.front && d.front.image && d.front.image.name);
  return { color, size, text, hasLogo };
}
function _buildDesignJson() {
  const front = designState.front, back = designState.back;
  return JSON.stringify({
    shirtColor: designState.shirtColor,
    size: selectedSize,
    front: {
      text: { content: front.text.content, font: front.text.font, size: front.text.size, color: front.text.color, bold: front.text.bold, italic: front.text.italic },
      image: { name: front.image.name, scalePct: front.image.scalePct },
    },
    back: {
      text: { content: back.text.content, font: back.text.font },
      image: { name: back.image.name, scalePct: back.image.scalePct },
    },
  });
}
async function _uploadCurrentLogo() {
  const logoFile = uploadedFileData.front || uploadedFileData.back;
  if (!logoFile || !logoFile.base64) return null;
  try {
    const [header, b64] = logoFile.base64.split(",");
    const mime = header.match(/:(.*?);/)?.[1] || "image/png";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const fd = new FormData();
    fd.append("file", new File([new Blob([bytes], { type: mime })], logoFile.name || "logo.png", { type: mime }));
    const up = await fetch(getApiBase() + "/api/uploads", { method: "POST", body: fd });
    if (up.ok) return (await up.json()).key || null;
  } catch (e) { /* non-fatal */ }
  return null;
}
async function addToCart() {
  // Account-bound cart → require login first
  let user = null;
  try {
    user = window.LOOM_LOGIN_MODAL
      ? await window.LOOM_LOGIN_MODAL.requireAuth()
      : (window.LOOM_AUTH ? await window.LOOM_AUTH.getCurrentUser() : null);
  } catch { return; } // login modal cancelled
  if (!user) { showToast(CT("cfg.toastLoginCart", "Войдите, чтобы добавить в корзину"), "error"); return; }

  const btn = document.getElementById("btn-add-to-cart");
  if (btn) btn.disabled = true;
  try {
    const logoKey = await _uploadCurrentLogo();
    const designJson = _buildDesignJson();
    const res = await fetch(getApiBase() + "/api/cart", {
      method: "POST",
      headers: _authHeaders(true),
      credentials: "include",
      body: JSON.stringify({
        productId: currentProduct ? currentProduct.id : null,
        designJson,
        logoKey,
        unitPrice: currentProduct ? currentProduct.price : 150000,
        quantity: 1,
      }),
    });
    if (res.status === 401) { showToast(CT("cfg.toastLoginCart", "Войдите, чтобы добавить в корзину"), "error"); return; }
    if (!res.ok) { const e = await res.json().catch(() => ({})); showToast(e.error || CT("cfg.toastAddError", "Ошибка добавления"), "error"); return; }
    cartState = await res.json();
    updateCartCount();
    renderCart();
    showToast(CT("cfg.toastAddedCart", "Добавлено в корзину"));
    openCartDrawer();
  } catch (e) {
    showToast("Ошибка сети", "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}
async function removeFromCart(id) {
  try {
    const res = await fetch(getApiBase() + "/api/cart/" + encodeURIComponent(id), {
      method: "DELETE", headers: _authHeaders(false), credentials: "include",
    });
    if (res.ok) cartState = await res.json();
  } catch (e) { /* ignore */ }
  updateCartCount();
  renderCart();
}
function renderCart() {
  const body = document.getElementById("cartBody");
  const foot = document.getElementById("cartFoot");
  const totalEl = document.getElementById("cartTotal");
  if (!body) return;
  const items = cartState.items || [];
  const fmt = (n) => new Intl.NumberFormat("ru-RU").format(n);
  if (!items.length) {
    body.innerHTML = '<p class="cart-empty">' + _esc(CT("cfg.cartEmpty", "Корзина пуста")) + '</p>';
    if (foot) foot.style.display = "none";
    return;
  }
  const cur = CT("cfg.currency", "сум");
  body.innerHTML = items.map((it) => {
    const s = _summarizeDesign(it.design_json);
    const meta = [s.color, s.size, s.text ? "«" + _esc(s.text) + "»" : "", s.hasLogo ? CT("cfg.layerLogo", "Логотип") : "", (it.quantity > 1 ? "×" + it.quantity : "")].filter(Boolean).join(" · ");
    return `
      <div class="cart-item">
        <div class="cart-item-thumb" style="display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.3)">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/></svg>
        </div>
        <div class="cart-item-info">
          <span class="cart-item-name">${_esc(it.product_name || "Футболка")}</span>
          <span class="cart-item-meta">${meta}</span>
          <span class="cart-item-price">${fmt(it.unit_price * (it.quantity || 1))} ${cur}</span>
        </div>
        <button class="cart-item-remove" data-id="${it.id}" aria-label="Удалить">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>`;
  }).join("");
  body.querySelectorAll(".cart-item-remove").forEach((b) =>
    b.addEventListener("click", () => removeFromCart(b.dataset.id)));
  if (totalEl) totalEl.textContent = fmt(cartState.total || 0);
  if (foot) foot.style.display = "flex";
}
function openCartDrawer() {
  document.getElementById("cartDrawer")?.classList.add("active");
  document.getElementById("cartBackdrop")?.classList.add("active");
  document.body.classList.add("menu-open");
}
async function openCart() {
  await loadCart();
  renderCart();
  openCartDrawer();
}
function closeCart() {
  document.getElementById("cartDrawer")?.classList.remove("active");
  document.getElementById("cartBackdrop")?.classList.remove("active");
  document.body.classList.remove("menu-open");
}
function bindCart() {
  document.getElementById("navCartBtn")?.addEventListener("click", openCart);
  document.getElementById("cartClose")?.addEventListener("click", closeCart);
  document.getElementById("cartBackdrop")?.addEventListener("click", closeCart);
  document.getElementById("btn-add-to-cart")?.addEventListener("click", addToCart);
  document.getElementById("cartCheckoutBtn")?.addEventListener("click", () => {
    if (!cartState.items || !cartState.items.length) { showToast("Корзина пуста"); return; }
    closeCart();
    openOrderModal(true); // open checkout in cart mode
  });
  loadCart();
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

      // Refresh design preview when the design tab is shown
      if (target === "design") refreshDesignCanvas();

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
    redrawActive();
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
    redrawActive();
  });

  colorPkr.addEventListener("input", () => {
    getTxt().color = colorPkr.value;
    colorLbl.textContent = colorPkr.value.toUpperCase();
    redrawActive();
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
    redrawActive();
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

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const layer = designState[designState.activeView].image;
      layer.img = img;
      layer.name = file.name;
      layer.scalePct = 100;
      layer.x = TEX_SIZE / 2;
      layer.y = TEX_SIZE * 0.30;

      // Store original file data per view for order submission
      uploadedFileData[designState.activeView] = {
        base64: e.target.result,
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
  if (btnOrder) btnOrder.addEventListener("click", () => openOrderModal(false));
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
      img.src = renderer.domElement.toDataURL();
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
    };
    designState[v].image = {
      img: null,
      name: "",
      x: TEX_SIZE / 2,
      y: TEX_SIZE * 0.30,
      scalePct: 100,
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
    const url = renderer.domElement.toDataURL("image/png");
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

function openOrderModal(cartMode) {
  cartMode = cartMode === true;
  window.__cartCheckout = cartMode;
  // Strict auth gate — must be logged in to place an order
  if (window.LOOM_AUTH) {
    window.LOOM_AUTH.getCurrentUser().then((user) => {
      if (!user) {
        window.location.href = 'login.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search)
        return
      }
      _openOrderModalInner(cartMode)
    })
    return
  }
  _openOrderModalInner(cartMode)
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
    img.src = renderer.domElement.toDataURL();
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

    setTimeout(() => {
      const ni = document.getElementById("nameInput");
      if (ni) ni.focus();
    }, 350);
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
  if (legacyBtn) legacyBtn.addEventListener("click", () => openOrderModal(false));

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

  // Phone formatting
  const phone = document.getElementById("phoneInput");
  if (phone) {
    phone.value = "+998";
    phone.addEventListener("input", function (e) {
      let v = e.target.value.replace(/\D/g, "");
      if (v.startsWith("998")) v = v.slice(3);
      v = v.slice(0, 9);
      let fmt = "+998";
      if (v.length > 0) fmt += " " + v.slice(0, 2);
      if (v.length > 2) fmt += " " + v.slice(2, 5);
      if (v.length > 5) fmt += "-" + v.slice(5, 7);
      if (v.length > 7) fmt += "-" + v.slice(7, 9);
      e.target.value = fmt;
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

async function captureGLB() {
  return new Promise((resolve) => {
    if (!scene || typeof THREE.GLTFExporter === "undefined") {
      resolve(null);
      return;
    }
    drawTexture("front");
    drawTexture("back");
    if (renderer) renderer.render(scene, camera);

    const exporter = new THREE.GLTFExporter();
    exporter.parse(
      scene,
      (glb) => {
        const bytes = new Uint8Array(glb);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        resolve("data:model/gltf-binary;base64," + btoa(binary));
      },
      { binary: true, embedImages: true },
    );
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

    // ── 1. Upload logo to R2 if present ───────────────────────────────────
    let logoKey = null;
    const logoFile = uploadedFileData.front || uploadedFileData.back;
    if (logoFile && logoFile.base64) {
      try {
        // Convert base64 data URL to Blob
        const [header, b64] = logoFile.base64.split(",");
        const mime = header.match(/:(.*?);/)?.[1] || "image/png";
        const byteChars = atob(b64);
        const bytes = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
        const blob = new Blob([bytes], { type: mime });

        const fd = new FormData();
        fd.append("file", new File([blob], logoFile.name || "logo.png", { type: mime }));

        const uploadRes = await fetch(getApiBase() + "/api/uploads", {
          method: "POST",
          body: fd,
        });
        if (!uploadRes.ok) {
          showToast("Ошибка загрузки логотипа. Пожалуйста, попробуйте снова перед отправкой заказа.", "error");
          btn.disabled = false;
          if (txt) txt.style.display = "block";
          if (loader) loader.style.display = "none";
          return;
        }
        const uploadData = await uploadRes.json();
        logoKey = uploadData.key || null;
      } catch (uploadErr) {
        console.error("Logo upload failed:", uploadErr);
        showToast("Ошибка загрузки логотипа. Пожалуйста, попробуйте снова перед отправкой заказа.", "error");
        btn.disabled = false;
        if (txt) txt.style.display = "block";
        if (loader) loader.style.display = "none";
        return;
      }
    }

    // ── 2. Capture screenshots for Telegram (kept for worker notification) ─
    let frontScreenshot = null;
    let backScreenshot = null;
    if (renderer) {
      const savedView = designState.activeView;
      drawTexture("front");
      drawTexture("back");
      applyActiveTexture();

      camera.position.set(CAM_VIEWS.front.x, CAM_VIEWS.front.y, CAM_VIEWS.front.z);
      controls.update();
      renderer.render(scene, camera);
      frontScreenshot = renderer.domElement.toDataURL("image/jpeg", 0.85);

      camera.position.set(CAM_VIEWS.back.x, CAM_VIEWS.back.y, CAM_VIEWS.back.z);
      controls.update();
      renderer.render(scene, camera);
      backScreenshot = renderer.domElement.toDataURL("image/jpeg", 0.85);

      camera.position.set(CAM_VIEWS[savedView].x, CAM_VIEWS[savedView].y, CAM_VIEWS[savedView].z);
      controls.update();
      renderer.render(scene, camera);
    }

    // ── 3. Build design JSON ───────────────────────────────────────────────
    const front = designState.front;
    const designJson = JSON.stringify({
      shirtColor: designState.shirtColor,
      size: selectedSize,
      front: {
        text: { content: front.text.content, font: front.text.font, size: front.text.size, color: front.text.color, bold: front.text.bold, italic: front.text.italic },
        image: { name: front.image.name, scalePct: front.image.scalePct },
      },
      back: {
        text: { content: designState.back.text.content, font: designState.back.text.font },
        image: { name: designState.back.image.name, scalePct: designState.back.image.scalePct },
      },
    });

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
  const bg = type === "success" ? "#10b981" : "#ef4444";

  toast.style.cssText = `
    position:fixed; bottom:24px; left:50%; transform:translateX(-50%) translateY(20px);
    background:${bg}; color:#fff; padding:14px 24px; border-radius:12px;
    font-family:'Inter',-apple-system,sans-serif; font-size:.95rem; font-weight:500;
    box-shadow:0 8px 30px rgba(0,0,0,.2); display:flex; align-items:center; gap:10px;
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
