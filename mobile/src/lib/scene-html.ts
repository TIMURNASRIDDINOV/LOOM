import { LEGACY_PRINT_AREA, PLATEN_CM, REF_RECT, TEX_SIZE } from './print'

// The 3D garment page that runs inside the WebView (and inside an <iframe> on
// the web target). It is the web configurator's rendering pipeline, ported
// function for function from `configurator.js`:
//
//   · normalizeModelUVsGlobally  — pack every UV island into one 0–1 atlas
//   · node-name classification   — Body_Front / Body_Back get the design
//                                  textures, sleeves and ribbing stay plain
//   · measurePrintRect           — lay the 30×40 cm platen on each panel
//   · drawElementIn              — identical size/position maths for images
//                                  and text, so the 3D preview shows what the
//                                  print shop will receive
//   · fitCameraToObject          — aim at the torso along the garment's own
//                                  facing axis, 88% fill
//
// The page is loaded ONCE per model; every later change (colour, layers, view)
// arrives through `window.__loom.update()` / `setView()` so the mesh, the
// environment map and the decoder are never re-downloaded on a keystroke.
//
// Scripts come from loomdesign.uz's own vendored copies (assets/vendor), which
// is also why the WebView is given that origin as its base URL: the same
// three.js r128 build, and requests to api.loomdesign.uz carry an Origin the
// Worker already allows.

// Overridable only for the web preview, where the dev proxy fronts the site's
// static files as well (see scripts/dev-proxy.js). Native builds always use
// the real origin — it is also what the WebView's document is given as its
// base URL.
export const SITE_ORIGIN = process.env.EXPO_PUBLIC_SITE_ORIGIN ?? 'https://loomdesign.uz'

/** The web's default garment — meshopt-compressed, 1.6 MB instead of 6.8 MB. */
export const DEFAULT_MODEL_URL = `${SITE_ORIGIN}/assets/models/t_shirt.meshopt.glb?v=1`

const VENDOR = [
  'three.min.js',
  'GLTFLoader.js',
  'OrbitControls.js',
  'RoomEnvironment.js',
  'meshopt_decoder.js',
].map((f) => `${SITE_ORIGIN}/assets/vendor/${f}?v=1`)

const FONTS_CSS =
  'https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;700;800&family=Inter:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600;700&display=swap'

export type SceneConfig = {
  glbUrl: string
  background: string
  /** `'front' | 'back'` */
  view: string
  /** Idle turntable until the first touch — a demo nicety. */
  autoRotate: boolean
}

export function buildSceneHtml(cfg: SceneConfig): string {
  const CONFIG = JSON.stringify({
    ...cfg,
    TEX_SIZE,
    REF_RECT,
    PLATEN_CM,
    LEGACY_PRINT_AREA,
    PLATEN_W_FRAC: 0.55,
    PLATEN_TOP_FRAC: 0.2,
  })

  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">' +
    `<link rel="stylesheet" href="${FONTS_CSS}">` +
    '<style>' +
    `html,body{margin:0;height:100%;background:${cfg.background};overflow:hidden;` +
    '-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}' +
    '#c{width:100%;height:100%;display:block;touch-action:none;outline:none}' +
    // Preload the three faces so canvas text renders in them on the first bake.
    '#f{position:absolute;left:-9999px;top:0;font-size:12px}' +
    '#f .a{font-family:"Inter Tight";font-weight:700}#f .b{font-family:"Inter";font-weight:700}' +
    '#f .c{font-family:"IBM Plex Mono";font-weight:700}' +
    '</style>' +
    VENDOR.map((src) => `<script src="${src}"></script>`).join('') +
    '</head><body>' +
    '<canvas id="c"></canvas>' +
    '<div id="f"><span class="a">LOOM</span><span class="b">LOOM</span><span class="c">LOOM</span></div>' +
    '<script>' +
    'window.__LOOM_CFG=' +
    CONFIG +
    ';' +
    SCENE_JS +
    '</script></body></html>'
  )
}

// Plain ES5-ish JS so it runs unmodified inside any WebView. Kept as one string
// so the file above stays a template and this stays code.
const SCENE_JS = String.raw`
(function () {
  var CFG = window.__LOOM_CFG;
  var TEX = CFG.TEX_SIZE, REF = CFG.REF_RECT;

  function post(m) {
    var s = JSON.stringify(m);
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
    else if (window.parent && window.parent !== window) window.parent.postMessage(s, '*');
  }
  function fail(why) { post({ type: 'error', message: why }); }
  if (!window.THREE || !THREE.GLTFLoader || !THREE.OrbitControls) return fail('three.js did not load');

  // ── Renderer / scene ──────────────────────────────────────────────────────
  var canvas = document.getElementById('c');
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.LinearToneMapping;
  renderer.toneMappingExposure = 0.82;

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.05, 100);
  camera.position.set(0, 0, 3.2);

  if (typeof THREE.RoomEnvironment === 'function') {
    var pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
  }
  scene.add(new THREE.AmbientLight(0xffffff, 0.08));
  var hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 0.12); hemi.position.set(0, 1, 0); scene.add(hemi);
  var key = new THREE.DirectionalLight(0xffffff, 0.45); key.position.set(2.5, 3.5, 3); scene.add(key);
  var fill = new THREE.DirectionalLight(0xffffff, 0.12); fill.position.set(-3, 1.5, 2); scene.add(fill);

  var controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.05;
  controls.enablePan = false;
  controls.minDistance = 1.5; controls.maxDistance = 6;
  controls.minPolarAngle = 0.2; controls.maxPolarAngle = Math.PI / 1.8;
  controls.autoRotate = !!CFG.autoRotate; controls.autoRotateSpeed = 0.7;
  controls.addEventListener('start', function () { controls.autoRotate = false; camAnim = null; post({ type: 'interact' }); });

  // ── Canvas textures: front, back, plain ───────────────────────────────────
  function mkCanvas() { var c = document.createElement('canvas'); c.width = c.height = TEX; return c; }
  var cv = { front: mkCanvas(), back: mkCanvas(), plain: mkCanvas() };
  var tex = {};
  var maxAniso = renderer.capabilities.getMaxAnisotropy();
  ['front', 'back', 'plain'].forEach(function (k) {
    var t = new THREE.CanvasTexture(cv[k]);
    t.flipY = false; t.encoding = THREE.sRGBEncoding;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true; t.anisotropy = maxAniso;
    tex[k] = t;
  });

  var design = { shirtColor: '#FFFFFF', front: [], back: [] };
  var PRINT = { front: null, back: null };
  var images = {}; // src → HTMLImageElement (loaded) | 'loading' | 'error'

  function drawPlain() {
    var g = cv.plain.getContext('2d');
    g.clearRect(0, 0, TEX, TEX); g.fillStyle = design.shirtColor; g.fillRect(0, 0, TEX, TEX);
    tex.plain.needsUpdate = true;
  }

  // Identical to the web's drawElementIn() with a flat rect (the print master path).
  function drawElement(g, el, rect) {
    var cx = rect.x + el.nx * rect.w, cy = rect.y + el.ny * rect.h;
    var rot = el.rotation || 0;
    if (el.type === 'image') {
      var img = el.src ? images[el.src] : null;
      if (!img || img === 'loading' || img === 'error') return;
      var natW = img.naturalWidth || img.width, natH = img.naturalHeight || img.height;
      if (!natW || !natH) return;
      var maxDim = (el.scalePct / 100) * (TEX * 0.30) * (rect.w / REF.w);
      var f = maxDim / Math.max(natW, natH);
      var dw = natW * f, dh = natH * f;
      g.save(); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.translate(cx, cy); g.rotate(rot); g.drawImage(img, -dw / 2, -dh / 2, dw, dh); g.restore();
      return;
    }
    if (!el.content) return;
    var size = el.size * (rect.h / REF.h);
    var weight = el.bold ? 'bold' : 'normal';
    g.save();
    g.font = 'normal ' + weight + ' ' + size + 'px "' + el.font + '"';
    var w = g.measureText(el.content).width, maxW = rect.w * 0.98;
    if (w > maxW) { size = Math.max(1, size * (maxW / w)); g.font = 'normal ' + weight + ' ' + size + 'px "' + el.font + '"'; }
    g.fillStyle = el.color; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.12)'; g.shadowBlur = 6; g.shadowOffsetX = 1; g.shadowOffsetY = 2;
    g.translate(cx, cy); g.rotate(rot); g.fillText(el.content, 0, 0); g.restore();
  }

  function drawView(view) {
    var g = cv[view].getContext('2d');
    g.clearRect(0, 0, TEX, TEX);
    g.drawImage(cv.plain, 0, 0, TEX, TEX);
    var rect = PRINT[view] || CFG.LEGACY_PRINT_AREA;
    (design[view] || []).forEach(function (el) { drawElement(g, el, rect); });
    tex[view].needsUpdate = true;
  }

  var redrawQueued = false;
  function redraw() {
    if (redrawQueued) return;
    redrawQueued = true;
    requestAnimationFrame(function () {
      redrawQueued = false;
      drawPlain(); drawView('front'); drawView('back');
      materials.forEach(function (m) { m.needsUpdate = true; });
    });
  }

  function ensureImage(src) {
    if (!src || images[src]) return;
    images[src] = 'loading';
    var img = new Image();
    if (!/^data:/.test(src)) img.crossOrigin = 'anonymous';
    img.onload = function () { images[src] = img; redraw(); };
    img.onerror = function () { images[src] = 'error'; post({ type: 'imageError', src: src.slice(0, 80) }); redraw(); };
    img.src = src;
  }

  // ── Model pipeline (ports of configurator.js) ─────────────────────────────
  function nodeHasAnyNameInHierarchy(node, tokens) {
    var cur = node;
    while (cur) {
      var name = (cur.name || '').toLowerCase();
      for (var i = 0; i < tokens.length; i++) if (name.indexOf(tokens[i]) !== -1) return true;
      cur = cur.parent;
    }
    return false;
  }

  function normalizeModelUVsGlobally(object) {
    var geoms = [], minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    // Read through the accessor so a KHR_mesh_quantization (normalized integer)
    // attribute yields real 0–1 values, not raw Uint16 counts.
    var read = function (uv, i, ax) {
      var raw = ax === 0 ? uv.getX(i) : uv.getY(i);
      if (!uv.normalized) return raw;
      var A = uv.array;
      if (A instanceof Uint16Array) return raw / 65535;
      if (A instanceof Uint8Array) return raw / 255;
      if (A instanceof Int16Array) return Math.max(raw / 32767, -1);
      if (A instanceof Int8Array) return Math.max(raw / 127, -1);
      return raw;
    };
    object.traverse(function (ch) {
      if (!ch.isMesh || !ch.geometry || !ch.geometry.attributes || !ch.geometry.attributes.uv) return;
      var uv = ch.geometry.attributes.uv; geoms.push(ch.geometry);
      for (var i = 0; i < uv.count; i++) {
        var u = read(uv, i, 0), v = read(uv, i, 1);
        if (u < minU) minU = u; if (u > maxU) maxU = u; if (v < minV) minV = v; if (v > maxV) maxV = v;
      }
    });
    if (!geoms.length) return;
    var rangeU = maxU - minU || 1, rangeV = maxV - minV || 1, uni = Math.max(rangeU, rangeV);
    var shiftU = (1 - rangeU / uni) / 2, shiftV = (1 - rangeV / uni) / 2;
    geoms.forEach(function (geo) {
      var uv = geo.attributes.uv;
      // Always land in a fresh Float32 attribute: writing floats back into a
      // quantized Uint16 buffer truncates every UV to 0 (see assets/models/README.md).
      var arr = new Float32Array(uv.count * 2);
      for (var i = 0; i < uv.count; i++) {
        arr[i * 2] = (read(uv, i, 0) - minU) / uni + shiftU;
        arr[i * 2 + 1] = (read(uv, i, 1) - minV) / uni + shiftV;
      }
      geo.setAttribute('uv', new THREE.BufferAttribute(arr, 2));
    });
  }

  var materials = [], frontMeshes = [], backMeshes = [], garment = null, facing = new THREE.Vector3(0, 0, 1);

  // UV triangles of a face's meshes with their world-space corners, binned on a
  // coarse grid — the web's buildMeshTris/texToWorldMesh, so a texel can be
  // asked both "is there fabric here" and "where on the body is that".
  function buildUvIndex(meshes) {
    var tris = [], BN = 48, bins = [], v = new THREE.Vector3();
    for (var b = 0; b < BN * BN; b++) bins.push([]);
    meshes.forEach(function (m) {
      var uv = m.geometry.attributes.uv, pos = m.geometry.attributes.position, idx = m.geometry.index;
      if (!uv || !pos) return;
      var world = function (i) { v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m.matrixWorld); return [v.x, v.y, v.z]; };
      var n = idx ? idx.count : uv.count;
      for (var i = 0; i + 2 < n; i += 3) {
        var a = idx ? idx.getX(i) : i, bb = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
        var t = { ua: uv.getX(a), va: uv.getY(a), ub: uv.getX(bb), vb: uv.getY(bb), uc: uv.getX(c), vc: uv.getY(c),
                  pa: world(a), pb: world(bb), pc: world(c) };
        var ti = tris.push(t) - 1;
        var u0 = Math.floor(Math.min(t.ua, t.ub, t.uc) * BN), u1 = Math.floor(Math.max(t.ua, t.ub, t.uc) * BN);
        var v0 = Math.floor(Math.min(t.va, t.vb, t.vc) * BN), v1 = Math.floor(Math.max(t.va, t.vb, t.vc) * BN);
        for (var x = Math.max(0, u0); x <= Math.min(BN - 1, u1); x++)
          for (var y = Math.max(0, v0); y <= Math.min(BN - 1, v1); y++) bins[y * BN + x].push(ti);
      }
    });
    return { tris: tris, bins: bins, BN: BN };
  }
  // World position under a texel (barycentric), or null where there is no fabric.
  function worldAt(ix, u, v) {
    if (!ix || !ix.tris.length) return null;
    var bx = Math.floor(u * ix.BN), by = Math.floor(v * ix.BN);
    if (bx < 0 || by < 0 || bx >= ix.BN || by >= ix.BN) return null;
    var list = ix.bins[by * ix.BN + bx];
    for (var i = 0; i < list.length; i++) {
      var t = ix.tris[list[i]];
      var d = (t.vb - t.vc) * (t.ua - t.uc) + (t.uc - t.ub) * (t.va - t.vc);
      if (!d) continue;
      var l1 = ((t.vb - t.vc) * (u - t.uc) + (t.uc - t.ub) * (v - t.vc)) / d;
      var l2 = ((t.vc - t.va) * (u - t.uc) + (t.ua - t.uc) * (v - t.vc)) / d;
      var l3 = 1 - l1 - l2;
      if (l1 >= -1e-4 && l2 >= -1e-4 && l3 >= -1e-4) {
        return [l1 * t.pa[0] + l2 * t.pb[0] + l3 * t.pc[0],
                l1 * t.pa[1] + l2 * t.pb[1] + l3 * t.pc[1],
                l1 * t.pa[2] + l2 * t.pb[2] + l3 * t.pc[2]];
      }
    }
    return null;
  }
  function hasFabric(ix, u, v) { return !!worldAt(ix, u, v); }

  // The garment's left-right axis (facing rotated 90° about Y) and the lateral
  // coordinate of its symmetry plane: the mesh is mirror-symmetric, so the
  // centre of the torso's bounding box along that axis is the centreline.
  function lateralAxis() { return { x: facing.z, z: -facing.x }; }
  function latOf(p, L) { return p[0] * L.x + p[2] * L.z; }
  function symmetryPlaneLat() {
    var L = lateralAxis(), lo = Infinity, hi = -Infinity, v = new THREE.Vector3();
    frontMeshes.concat(backMeshes).forEach(function (m) {
      var p = m.geometry.attributes.position;
      for (var i = 0; i < p.count; i += 3) {
        v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m.matrixWorld);
        var lat = v.x * L.x + v.z * L.z;
        if (lat < lo) lo = lat; if (lat > hi) hi = lat;
      }
    });
    return lo < hi ? (lo + hi) / 2 : 0;
  }

  // The web's measurePrintRect: the platen is centred on the column that lands
  // on the garment's symmetry plane (a panel's own UV extents wrap round the
  // sides by different amounts front and back, so they cannot be used), and
  // hung from the neckline found on that column.
  function measurePrintRect(meshes) {
    if (!meshes.length) return null;
    var ix = buildUvIndex(meshes);
    var u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    ix.tris.forEach(function (t) {
      u0 = Math.min(u0, t.ua, t.ub, t.uc); u1 = Math.max(u1, t.ua, t.ub, t.uc);
      v0 = Math.min(v0, t.va, t.vb, t.vc); v1 = Math.max(v1, t.va, t.vb, t.vc);
    });
    var top = v0 * TEX, bottom = v1 * TEX, L = u0 * TEX, R = u1 * TEX;
    var panelW = R - L, panelH = bottom - top;
    if (!(panelW > 0) || !(panelH > 0)) return null;

    var lat0 = symmetryPlaneLat(), LA = lateralAxis();
    var rowCentre = function (ty) {
      var best = null, bestD = Infinity;
      for (var tx = L; tx <= R; tx += 3) {
        var w = worldAt(ix, tx / TEX, ty / TEX);
        if (!w) continue;
        var d = Math.abs(latOf(w, LA) - lat0);
        if (d < bestD) { bestD = d; best = tx; }
      }
      return best;
    };
    var cands = [0.30, 0.45, 0.60].map(function (f) { return rowCentre(top + panelH * f); })
      .filter(function (n) { return n != null; }).sort(function (a, b) { return a - b; });
    if (!cands.length) return null;
    var centerTx = cands[(cands.length - 1) >> 1];

    var neckTy = null;
    for (var ty2 = top; ty2 <= bottom; ty2 += 2) {
      if (hasFabric(ix, centerTx / TEX, ty2 / TEX)) { neckTy = ty2; break; }
    }
    if (neckTy == null) return null;

    var w = CFG.PLATEN_W_FRAC * panelW, h = w * (CFG.PLATEN_CM.h / CFG.PLATEN_CM.w);
    var x = centerTx - w / 2, y = neckTy + CFG.PLATEN_TOP_FRAC * w;
    if (!(w > 0) || !(h > 0) || w > panelW || h > panelH) return null;
    x = Math.max(L, Math.min(R - w, x)); y = Math.max(top, Math.min(bottom - h, y));
    return { x: x, y: y, w: w, h: h };
  }

  function centroid(meshes) {
    var s = new THREE.Vector3(), v = new THREE.Vector3(), n = 0;
    meshes.forEach(function (m) {
      var p = m.geometry.attributes.position;
      for (var i = 0; i < p.count; i += 7) { v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m.matrixWorld); s.add(v); n++; }
    });
    return n ? s.multiplyScalar(1 / n) : null;
  }
  function garmentFacingDir() {
    var f = centroid(frontMeshes), b = centroid(backMeshes);
    if (!f || !b) return new THREE.Vector3(0, 0, 1);
    var d = f.sub(b); d.y = 0;
    return d.lengthSq() > 1e-8 ? d.normalize() : new THREE.Vector3(0, 0, 1);
  }

  var CAM = { front: new THREE.Vector3(0, 0, 3.2), back: new THREE.Vector3(0, 0, -3.2) }, TARGET = new THREE.Vector3();
  var camAnim = null;

  function fitCamera(object) {
    object.updateMatrixWorld(true);
    var box0 = new THREE.Box3().setFromObject(object), size0 = box0.getSize(new THREE.Vector3());
    var max0 = Math.max(size0.x, size0.y, size0.z);
    if (max0 > 0) { object.scale.multiplyScalar(2.2 / max0); object.updateMatrixWorld(true); }
    var box = new THREE.Box3().setFromObject(object), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    if (!(size.x > 0 && size.y > 0 && size.z > 0)) return;
    var torso = frontMeshes.concat(backMeshes), aim = center;
    if (torso.length) { var tb = new THREE.Box3(); torso.forEach(function (m) { tb.expandByObject(m); }); aim = tb.getCenter(new THREE.Vector3()); }
    var chest = new THREE.Vector3(aim.x, center.y + size.y * 0.16, aim.z), vOff = size.y * 0.08;
    var fov = THREE.MathUtils.degToRad(camera.fov), camY = chest.y + vOff;
    var halfV = Math.max(camY - box.min.y, box.max.y - camY);
    var dH = halfV / Math.tan(fov * 0.5), dW = (size.x * 0.5) / Math.tan(fov * 0.5) / Math.max(camera.aspect, 0.01);
    var dist = Math.max(dH, dW) / 0.88;
    facing = garmentFacingDir();
    CAM.front.set(chest.x + facing.x * dist, chest.y + vOff, chest.z + facing.z * dist);
    CAM.back.set(chest.x - facing.x * dist, chest.y + vOff, chest.z - facing.z * dist);
    TARGET.copy(chest);
    camera.near = Math.max(0.01, dist / 120); camera.far = Math.max(50, dist * 20 + size.length());
    camera.updateProjectionMatrix();
    camera.position.copy(CFG.view === 'back' ? CAM.back : CAM.front);
    controls.target.copy(chest); controls.minDistance = dist * 0.7; controls.maxDistance = dist * 1.8; controls.update();
  }

  // Time-based (600 ms), not frame-based: a throttled or backgrounded WebView
  // must still land on the destination on its next frame.
  function setView(view) {
    var to = view === 'back' ? CAM.back : CAM.front;
    controls.autoRotate = false;
    camAnim = { from: camera.position.clone(), to: to.clone(), start: performance.now(), ms: 600 };
  }

  // ── Load ──────────────────────────────────────────────────────────────────
  var loader = new THREE.GLTFLoader();
  if (typeof MeshoptDecoder !== 'undefined') loader.setMeshoptDecoder(MeshoptDecoder);
  loader.load(CFG.glbUrl, function (gltf) {
    var object = gltf.scene;
    normalizeModelUVsGlobally(object);
    object.traverse(function (ch) {
      if (!ch.isMesh) return;
      var mName = ((Array.isArray(ch.material) ? (ch.material[0] && ch.material[0].name) : (ch.material && ch.material.name)) || '').toLowerCase();
      var isRib = mName.indexOf('rib') !== -1 || mName.indexOf('neck') !== -1 || mName.indexOf('collar') !== -1 || nodeHasAnyNameInHierarchy(ch, ['rib', 'neck', 'collar']);
      var isSleeve = mName.indexOf('sleeve') !== -1 || nodeHasAnyNameInHierarchy(ch, ['sleeve']);
      var isBack = nodeHasAnyNameInHierarchy(ch, ['body_back']);
      var isFront = nodeHasAnyNameInHierarchy(ch, ['body_front']) || (mName.indexOf('body') !== -1 && !isBack && !isSleeve && !isRib);
      var map = isFront ? tex.front : isBack ? tex.back : tex.plain;
      var mat = new THREE.MeshStandardMaterial({ map: map, side: THREE.FrontSide, roughness: 0.7, metalness: 0 });
      ch.material = mat; materials.push(mat);
      if (isFront) frontMeshes.push(ch); else if (isBack) backMeshes.push(ch);
    });
    scene.add(object); garment = object;
    object.updateMatrixWorld(true);

    // The centreline search needs the garment's facing axis before the camera fit.
    facing = garmentFacingDir();
    PRINT.front = measurePrintRect(frontMeshes);
    PRINT.back = measurePrintRect(backMeshes);
    fitCamera(object);
    redraw();
    post({ type: 'ready', printable: frontMeshes.length > 0, front: !!PRINT.front, back: !!PRINT.back });
  }, function (xhr) {
    if (xhr.total) post({ type: 'progress', pct: Math.round((xhr.loaded / xhr.total) * 100) });
  }, function (err) {
    fail('GLB failed to load: ' + (err && err.message ? err.message : String(err)));
  });

  // ── Public API for the host ───────────────────────────────────────────────
  window.__loom = {
    update: function (d) {
      design = d || design;
      ['front', 'back'].forEach(function (v) { (design[v] || []).forEach(function (el) { if (el.type === 'image' && el.src) ensureImage(el.src); }); });
      redraw();
    },
    setView: setView,
    resetView: function () { setView(CFG.view); },
    // Introspection for the web preview / QA — never used by the app itself.
    debug: function () {
      return {
        camera: camera.position.toArray(), target: controls.target.toArray(),
        camFront: CAM.front.toArray(), camBack: CAM.back.toArray(), facing: facing.toArray(),
        frontMeshes: frontMeshes.length, backMeshes: backMeshes.length, materials: materials.length,
        print: PRINT, anim: !!camAnim, view: CFG.view
      };
    }
  };
  window.addEventListener('message', function (e) {
    var m = e.data;
    if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { return; } }
    if (!m || !m.type) return;
    if (m.type === 'update') window.__loom.update(m.design);
    if (m.type === 'view') setView(m.view);
  });
  window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { redraw(); });

  (function loop() {
    requestAnimationFrame(loop);
    if (camAnim) {
      var t = Math.min(1, (performance.now() - camAnim.start) / camAnim.ms);
      var k = 1 - Math.pow(1 - t, 3);
      camera.position.lerpVectors(camAnim.from, camAnim.to, k);
      controls.target.copy(TARGET);
      if (t >= 1) camAnim = null;
    }
    controls.update();
    renderer.render(scene, camera);
  })();
})();
`
