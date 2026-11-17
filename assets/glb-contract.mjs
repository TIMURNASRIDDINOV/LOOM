// Shared by admin and the Worker: inspect the container before any R2 write.
export const MAX_MODEL_BYTES = 3 * 1024 * 1024;

export function inspectGarmentGlb(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 20) throw new Error('Invalid GLB file');
  if (buffer.byteLength > MAX_MODEL_BYTES) throw new Error('Model must be at most 3 MB');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) {
    throw new Error('Expected a complete glTF 2.0 binary (.glb) file');
  }
  let doc = null, binBytes = 0;
  for (let offset = 12; offset < buffer.byteLength;) {
    if (offset + 8 > buffer.byteLength) throw new Error('Truncated GLB chunk');
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
    if (length % 4 || offset + 8 + length > buffer.byteLength) throw new Error('Invalid GLB chunk length');
    if (offset === 12 && type !== 0x4e4f534a) throw new Error('GLB must start with a JSON chunk');
    if (type === 0x4e4f534a) {
      if (doc) throw new Error('Duplicate GLB JSON chunk');
      try { doc = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, offset + 8, length))); }
      catch { throw new Error('Invalid GLB JSON'); }
    } else if (type === 0x004e4942) binBytes += length;
    offset += 8 + length;
  }
  if (!doc || doc.asset?.version !== '2.0') throw new Error('Expected glTF 2.0');
  if ([...(doc.extensionsUsed || []), ...(doc.extensionsRequired || [])].includes('KHR_draco_mesh_compression')) {
    throw new Error('Draco is not supported; export with Meshopt and floating-point UVs');
  }
  if (!Array.isArray(doc.buffers) || !doc.buffers.length || doc.buffers.some((buffer, index) =>
    buffer.uri || !(buffer.byteLength > 0) || (index === 0 ? buffer.byteLength > binBytes : buffer.extensions?.EXT_meshopt_compression?.fallback !== true))) {
    throw new Error('Model must contain its geometry in the GLB binary chunk');
  }
  for (const bv of doc.bufferViews || []) {
    const buffer = doc.buffers[bv.buffer];
    if (!buffer || !(bv.byteLength > 0) || (bv.byteOffset ?? 0) < 0 || (bv.byteOffset ?? 0) + bv.byteLength > buffer.byteLength) throw new Error('Invalid model buffer view');
    const compressed = bv.extensions?.EXT_meshopt_compression;
    if (compressed && (compressed.buffer !== 0 || !(compressed.byteLength > 0) || (compressed.byteOffset ?? 0) < 0 || (compressed.byteOffset ?? 0) + compressed.byteLength > binBytes)) throw new Error('Invalid Meshopt buffer view');
  }
  if ((doc.images || []).some((image) => image.uri && !image.uri.startsWith('data:'))) throw new Error('External model textures are not supported');
  const counts = { front: 0, back: 0, plain: 0, triangles: 0 };
  const roots = doc.scenes?.[doc.scene ?? 0]?.nodes;
  if (!Array.isArray(roots)) throw new Error('Model needs a scene');
  const path = new Set();
  function walk(index, names) {
    if (!Number.isInteger(index) || !doc.nodes?.[index] || path.has(index)) throw new Error('Invalid model node hierarchy');
    path.add(index);
    const node = doc.nodes[index];
    const chain = names.concat(String(node.name || '').toLowerCase());
    if (node.mesh !== undefined) {
      const mesh = doc.meshes?.[node.mesh];
      if (!Array.isArray(mesh?.primitives) || !mesh.primitives.length) throw new Error('Invalid model mesh');
      for (const primitive of mesh.primitives) {
        if (primitive.extensions?.KHR_draco_mesh_compression) throw new Error('Draco is not supported');
        const uv = doc.accessors?.[primitive.attributes?.TEXCOORD_0];
        if (uv && (uv.componentType !== 5126 || uv.normalized || uv.type !== 'VEC2')) throw new Error('TEXCOORD_0 must be FLOAT32, without UV quantization');
        const face = chain.some((n) => n.includes('body_back')) ? 'back'
          : chain.some((n) => n.includes('body_front')) ? 'front' : 'plain';
        if (face !== 'plain' && !uv) throw new Error('Body_Front and Body_Back must have TEXCOORD_0 UVs');
        const position = doc.accessors?.[primitive.attributes?.POSITION];
        if (!position || !(position.count > 0)) throw new Error('Model mesh has no positions');
        if ((primitive.mode ?? 4) !== 4) throw new Error('Model must use triangle primitives');
        const vertices = primitive.indices === undefined ? position.count : doc.accessors?.[primitive.indices]?.count;
        if (!(vertices > 0) || vertices % 3) throw new Error('Invalid triangle count');
        counts.triangles += vertices / 3;
        counts[face]++;
      }
    }
    for (const child of node.children || []) walk(child, chain);
    path.delete(index);
  }
  for (const root of roots) walk(root, []);
  if (!counts.front || !counts.back) throw new Error('Model needs both Body_Front and Body_Back meshes');
  return counts;
}
