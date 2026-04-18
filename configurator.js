/* ================================================================
  LOOM 3D T-Shirt Configurator — configurator.js
  Three.js r128 | GLTFLoader | OrbitControls
  ================================================================ */

"use strict";

// ================================================================
// SECTION 1 — CONSTANTS
// ================================================================

const TEX_SIZE = 1024; // Offscreen texture canvas dimensions

// Print area in texture UV space (center-chest region, 0–1024 coordinates)
const PRINT_AREA = { x: 280, y: 180, w: 464, h: 560 };

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

// 12 preset shirt colors
const SHIRT_COLORS = [
  { name: "Белый", hex: "#FFFFFF" },
  { name: "Чёрный", hex: "#1F2937" },
  { name: "Тёмно-синий", hex: "#1E3A5F" },
  { name: "Красный", hex: "#C0392B" },
  { name: "Синий", hex: "#2980B9" },
  { name: "Зелёный", hex: "#27AE60" },
  { name: "Серый", hex: "#6B7280" },
  { name: "Жёлтый", hex: "#F1C40F" },
  { name: "Розовый", hex: "#E91E8C" },
  { name: "Фиолетовый", hex: "#8E44AD" },
  { name: "Оранжевый", hex: "#E67E22" },
  { name: "Бордовый", hex: "#800020" },
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
  "https://loom-telegram-orders.timurnasriddinov56.workers.dev";

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

  front: {
    text: {
      content: "",
      font: "Arial",
      size: 80,
      color: "#000000",
      bold: false,
      italic: false,
      x: TEX_SIZE / 2,
      y: TEX_SIZE * 0.38,
    },
    image: {
      img: null,
      name: "",
      x: TEX_SIZE / 2,
      y: TEX_SIZE * 0.38,
      scalePct: 100,
    },
  },

  back: {
    text: {
      content: "",
      font: "Arial",
      size: 80,
      color: "#000000",
      bold: false,
      italic: false,
      x: TEX_SIZE / 2,
      y: TEX_SIZE * 0.38,
    },
    image: {
      img: null,
      name: "",
      x: TEX_SIZE / 2,
      y: TEX_SIZE * 0.38,
      scalePct: 100,
    },
  },
};

// Uploaded file metadata (for order submission)
let uploadedFileData = null;

// ================================================================
// SECTION 3 — THREE.JS GLOBALS
// ================================================================

let scene, camera, renderer, controls;
let shirtObject = null; // The loaded OBJ group
let shirtMaterials = []; // All MeshStandardMaterial instances on the shirt
let frontPrintMaterials = []; // Materials that should always show front design map
let backPrintMaterials = []; // Materials that should always show back design map
let plainColorMaterials = []; // Materials that should stay plain shirt color (no print map)

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

document.addEventListener("DOMContentLoaded", function () {
  initThreeJS();
  initCanvasTextures();
  loadShirtModel();
  initUI();
  animate();
});

// ================================================================
// SECTION 5 — THREE.JS SETUP
// ================================================================

function initThreeJS() {
  const container = document.getElementById("three-container");

  // Scene with soft light-gray background
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd7dce3);

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
  });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(w, h);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
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
  // Ambient — soft global fill
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));

  // Hemisphere — warm sky / neutral ground for fabric depth
  const hemi = new THREE.HemisphereLight(0xfff5e6, 0xb8b8bc, 0.6);
  hemi.position.set(0, 1, 0);
  scene.add(hemi);

  // Key light: front-right, above
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(2.5, 3.5, 3);
  scene.add(key);

  // Fill light: front-left, cooler & dimmer
  const fill = new THREE.DirectionalLight(0xe4ecff, 0.4);
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
  frontTexture.encoding = THREE.sRGBEncoding;
  backTexture.encoding = THREE.sRGBEncoding;
  plainTexture.encoding = THREE.sRGBEncoding;

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

  // Subtle seam shadow for textile depth.
  const grad = ctx.createLinearGradient(0, 0, 0, TEX_SIZE * 0.12);
  grad.addColorStop(0, "rgba(0,0,0,0.08)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE * 0.12);

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
    const natW = layer.image.img.naturalWidth || layer.image.img.width;
    const natH = layer.image.img.naturalHeight || layer.image.img.height;
    // scalePct of 100 → the image fills ~35% of texture width
    const factor =
      (layer.image.scalePct / 100) * ((TEX_SIZE * 0.35) / Math.max(natW, natH));
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

  uvAttributes.forEach((uv) => {
    for (let i = 0; i < uv.count; i++) {
      const uNorm = (uv.getX(i) - minU) / rangeU;
      const vNorm = (uv.getY(i) - minV) / rangeV;
      uv.setXY(i, uNorm, vNorm);
    }
    uv.needsUpdate = true;
  });
}

// ================================================================
// SECTION 7 — MODEL LOADING
// ================================================================

function loadShirtModel() {
  const loader = new THREE.GLTFLoader();

  loader.load(
    "assets/models/t_shirt.glb",

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

    // onError — fall back to a placeholder geometry
    function (err) {
      console.warn("GLB load failed, using placeholder geometry:", err);
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

/** Smoothly move camera to front or back position. */
function setCameraView(view) {
  const pos = CAM_VIEWS[view];
  const target = INITIAL_VIEW.target || new THREE.Vector3(0, 0, 0);
  camAnim.targetX = pos.x;
  camAnim.targetY = pos.y;
  camAnim.targetZ = pos.z;
  camAnim.targetLookX = target.x;
  camAnim.targetLookY = target.y;
  camAnim.targetLookZ = target.z;
  camAnim.active = true;
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
  bindSummaryTab();
  bindSaveDesign();
  bindOrderModal();
  bindMobileNav();
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

      // Refresh design canvas whenever text / image tab is shown
      if (target === "text" || target === "image") refreshDesignCanvas();

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
    uploadedFileData = null;
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
      // Center in print area
      layer.x = PRINT_AREA.x + PRINT_AREA.w / 2;
      layer.y = PRINT_AREA.y + PRINT_AREA.h / 2;

      // Store original file data for order submission
      uploadedFileData = {
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
  if (btnOrder) btnOrder.addEventListener("click", openOrderModal);
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

  const colorName =
    COLOR_NAMES[designState.shirtColor] || designState.shirtColor;
  setEl("sum-color", colorName);
  setEl("sum-text", designState.front.text.content || "—");
  setEl(
    "sum-font",
    designState.front.text.content ? designState.front.text.font : "—",
  );
  setEl("sum-image", designState.front.image.name || "Не загружено");
}

function resetDesign() {
  designState.shirtColor = "#FFFFFF";

  ["front", "back"].forEach((v) => {
    designState[v].text = {
      content: "",
      font: "Arial",
      size: 80,
      color: "#000000",
      bold: false,
      italic: false,
      x: TEX_SIZE / 2,
      y: TEX_SIZE * 0.38,
    };
    designState[v].image = {
      img: null,
      name: "",
      x: TEX_SIZE / 2,
      y: TEX_SIZE * 0.38,
      scalePct: 100,
    };
  });

  uploadedFileData = null;

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
    fs.value = 80;
  }
  const fl = document.getElementById("font-size-display");
  if (fl) fl.textContent = "80px";
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
  return COLOR_NAMES[hex] || hex;
}

function openOrderModal() {
  updateSummaryTab(); // ensures snapshot + summary info are fresh

  // Populate the existing order modal's summary section
  const front = designState.front;
  const setTxt = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };

  setTxt("summaryColor", getColorName(designState.shirtColor));
  setTxt("summaryScale", front.image.scalePct + "%");
  setTxt("summaryText", front.text.content || "Не указан");
  setTxt("summaryFont", front.text.font);
  setTxt("summaryImage", front.image.name || "Не загружено");

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
    setTimeout(() => {
      const ni = document.getElementById("nameInput");
      if (ni) ni.focus();
    }, 350);
  }

  // Store design config in modal for submission
  const config = {
    color: designState.shirtColor,
    colorName: getColorName(designState.shirtColor),
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
  if (legacyBtn) legacyBtn.addEventListener("click", openOrderModal);

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
    const locType = window._getLocationType
      ? window._getLocationType()
      : "address";
    const addrVal = document.getElementById("addressInput")?.value.trim() || "";
    const coords =
      locType === "map"
        ? `${selectedCoords.lat}, ${selectedCoords.lng}`
        : "Не указаны";
    const nameVal = [
      document.getElementById("nameInput")?.value.trim(),
      document.getElementById("surnameInput")?.value.trim(),
    ]
      .filter(Boolean)
      .join(" ");
    const phoneFmt = document.getElementById("phoneInput")?.value.trim() || "";
    const comment = document.getElementById("commentInput")?.value.trim() || "";
    const front = designState.front;

    const orderData = {
      item: "Футболка Oversized",
      color: getColorName(designState.shirtColor),
      text: front.text.content || "Не указан",
      font: front.text.font,
      imageUploaded: front.image.name || "Не загружено",
      scale: front.image.scalePct + "%",
      mapCoordinates: coords,
      customerName: nameVal,
      phone: phoneFmt,
      phoneClean: phoneFmt.replace(/\D/g, ""),
      address: addrVal,
      comment: comment,
      timestamp: new Date().toISOString(),
      originalFile: uploadedFileData || null,
    };

    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orderData),
    });

    if (!res.ok) throw new Error(`Server error ${res.status}`);

    showToast("✅ Заказ отправлен!", "success");
    setTimeout(closeOrderModal, 2000);
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
