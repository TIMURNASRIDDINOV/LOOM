import { inspectGarmentGlb } from '../../assets/glb-contract.mjs?v=1';

let libraries;
function loadLibraries() {
  if (!libraries) libraries = (async () => {
    for (const name of ['three.min.js', 'meshopt_decoder.js', 'GLTFLoader.js']) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/assets/vendor/' + name + '?v=1';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Could not load the model preview; try again'));
        document.head.append(script);
      });
    }
  })().catch((error) => { libraries = null; throw error; });
  return libraries;
}

// Inspect without uploading. Each face is shown with its own UV print box.
export async function previewModel(file, host, area) {
  if (!/\.glb$/i.test(file.name)) throw new Error('Model must have .glb extension');
  if (file.size > 3 * 1024 * 1024) throw new Error('Model must be at most 3 MB');
  const buffer = await file.arrayBuffer();
  const counts = inspectGarmentGlb(buffer);
  await loadLibraries();
  const THREE = window.THREE;
  const loader = new THREE.GLTFLoader().setMeshoptDecoder(window.MeshoptDecoder);
  const gltf = await new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e8e8e8');
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 1.2));
  const light = new THREE.DirectionalLight(0xffffff, 0.8);
  light.position.set(2, 4, 5); scene.add(light);
  const model = gltf.scene;
  scene.add(model); model.updateMatrixWorld(true);
  const bounds = { minU: Infinity, minV: Infinity, maxU: -Infinity, maxV: -Infinity };
  const meshes = { front: [], back: [], plain: [] };
  model.traverse((mesh) => {
    if (!mesh.isMesh) return;
    let node = mesh, names = '';
    while (node) { names += ' ' + (node.name || '').toLowerCase(); node = node.parent; }
    const face = names.includes('body_back') ? 'back' : names.includes('body_front') ? 'front' : 'plain';
    meshes[face].push(mesh);
    const uv = mesh.geometry.attributes.uv;
    if (!uv) return;
    for (let i = 0; i < uv.count; i++) {
      bounds.minU = Math.min(bounds.minU, uv.getX(i)); bounds.maxU = Math.max(bounds.maxU, uv.getX(i));
      bounds.minV = Math.min(bounds.minV, uv.getY(i)); bounds.maxV = Math.max(bounds.maxV, uv.getY(i));
    }
  });
  const spanU = bounds.maxU - bounds.minU, spanV = bounds.maxV - bounds.minV;
  if (!(spanU > 0 && spanV > 0)) throw new Error('Model UVs have no printable area');
  const resources = [];
  for (const [face, list] of Object.entries(meshes)) {
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const mesh of list) {
      const uv = mesh.geometry.attributes.uv;
      if (!uv) continue;
      for (let i = 0; i < uv.count; i++) {
        const u = (uv.getX(i) - bounds.minU) / spanU, v = (uv.getY(i) - bounds.minV) / spanV;
        uv.setXY(i, u, v);
        u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
      }
      uv.needsUpdate = true;
    }
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = face === 'front' ? '#cfddd0' : face === 'back' ? '#d1d8ec' : '#cccccc';
    ctx.fillRect(0, 0, 1024, 1024);
    if (face !== 'plain') {
      const width = (u1 - u0) * area.width_frac * 1024;
      const height = width * area.platen_cm.h / area.platen_cm.w;
      const x = (u0 + u1) * 512 - width / 2, y = Math.min(v1 * 1024 - height, v0 * 1024 + area.top_frac * width);
      ctx.fillStyle = 'rgba(219,54,45,.35)'; ctx.fillRect(x, y, width, height);
      ctx.strokeStyle = '#af2018'; ctx.lineWidth = 5; ctx.strokeRect(x, y, width, height);
    }
    const texture = new THREE.CanvasTexture(canvas); texture.flipY = false;
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, side: THREE.DoubleSide });
    resources.push(texture, material);
    for (const mesh of list) {
      for (const old of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) old.dispose();
      mesh.material = material;
    }
  }
  const box = new THREE.Box3().setFromObject(model), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const panelCenter = (list) => new THREE.Box3().setFromObject(list[0]).getCenter(new THREE.Vector3());
  const direction = panelCenter(meshes.front).sub(panelCenter(meshes.back)); direction.y = 0;
  if (direction.lengthSq() < 1e-8) direction.set(0, 0, 1); else direction.normalize();
  const render = new THREE.WebGLRenderer({ antialias: true });
  render.setSize(640, 400); render.domElement.style.cssText = 'width:100%;height:auto;display:block';
  const camera = new THREE.PerspectiveCamera(35, 0.8, 0.001, 10000);
  const distance = Math.max(size.y, size.x / 0.8) / (2 * Math.tan(35 * Math.PI / 360)) * 1.15;
  render.setScissorTest(true);
  for (const [index, sign] of [[0, 1], [1, -1]]) {
    camera.position.copy(center).addScaledVector(direction, distance * sign); camera.lookAt(center);
    render.setViewport(index * 320, 0, 320, 400); render.setScissor(index * 320, 0, 320, 400);
    render.render(scene, camera);
  }
  const note = document.createElement('p');
  note.textContent = `FRONT ${counts.front} · BACK ${counts.back} · plain ${counts.plain} · ${counts.triangles.toLocaleString()} triangles. Front / Back; red = print area (UV placement preview).`;
  host.replaceChildren(note, render.domElement);
  return () => { render.dispose(); resources.forEach((r) => r.dispose()); model.traverse((m) => m.geometry?.dispose()); };
}
