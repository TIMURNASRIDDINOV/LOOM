// Shared production renderer. Coordinates are normalized; output is a physical
// platen at 300 DPI, never a garment texture or a lower-resolution preview.
export const PRINT_DPI = 300;
const DEFAULT_REF = { w: 928, h: 1120 };

export async function imageFromBlob(blob, key = '') {
  if (/hei[cf]/i.test(blob.type) || /\.hei[cf]$/i.test(key)) {
    if (!window.HeicTo) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = new URL('./vendor/heic-to.js?v=1', import.meta.url).href;
        script.onload = resolve; script.onerror = () => reject(new Error('Image decoder unavailable'));
        document.head.appendChild(script);
      });
    }
    blob = await window.HeicTo({ blob, type: 'image/png' });
  }
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => { image.release = () => { image.onload = image.onerror = null; image.removeAttribute('src'); URL.revokeObjectURL(url); }; resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Print source cannot be decoded')); };
    image.src = url;
  });
}

export function printDimensions(cm, dpi = PRINT_DPI) {
  if (!cm || !Number.isFinite(cm.w) || !Number.isFinite(cm.h) || cm.w <= 0 || cm.h <= 0 || cm.w > 100 || cm.h > 100) throw new Error('Invalid print dimensions');
  const width = Math.ceil(cm.w / 2.54 * dpi), height = Math.ceil(cm.h / 2.54 * dpi);
  // The 30x40cm platen fits just below the 2^24-pixel canvas limit. Larger
  // platens need a tiled workflow; refusing is preferable to reducing DPI.
  if (width * height > 16777216) throw new Error('Print platen exceeds canvas capacity');
  return { width, height, dpi };
}

export async function renderPrint(design, face, { loadImage, canvasFactory = () => document.createElement('canvas') } = {}) {
  const cm = design.platenCm || { w: 30, h: 40 }, dims = printDimensions(cm);
  const ref = design.refRect || DEFAULT_REF, tex = design.texSize || 2048;
  const canvas = canvasFactory(); canvas.width = dims.width; canvas.height = dims.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Print canvas unavailable');
  const details = [];
  try {
    for (const el of design[face]?.elements || []) {
      if (el.placeholder) continue;
      const x = el.nx * dims.width, y = el.ny * dims.height;
      ctx.save(); ctx.translate(x, y); ctx.rotate(el.rotation || 0);
      try {
        if (el.type === 'image') {
          const key = el.originalKey || el.artworkKey || el.key;
          if (!key || !loadImage) throw new Error('Original print source missing');
          const image = await loadImage(key, el);
          try {
            const w = image.naturalWidth || image.width, h = image.naturalHeight || image.height;
            if (!w || !h) throw new Error('Original print source is empty');
            const long = (el.scalePct ?? 100) / 100 * tex * 0.30 * dims.width / ref.w;
            const scale = long / Math.max(w, h);
            ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(image, -w * scale / 2, -h * scale / 2, w * scale, h * scale);
            const vector = /\.svg$/i.test(key);
            details.push({ id: el.id, key, dpi: vector ? null : Math.max(w, h) / long * PRINT_DPI, vector });
          } finally { if (image.release) image.release(); else if (image.close) image.close(); }
        } else if (el.type === 'text' && el.content) {
          const weight = el.bold ? 'bold' : 'normal', style = el.italic ? 'italic' : 'normal', font = el.font || 'Arial';
          let size = (el.size || 160) * dims.height / ref.h;
          if (document.fonts) await document.fonts.load(`${style} ${weight} ${size}px "${font}"`, el.content);
          ctx.font = `${style} ${weight} ${size}px "${font}"`;
          const width = ctx.measureText(el.content).width;
          if (width > dims.width * 0.98) size = Math.max(1, size * dims.width * 0.98 / width);
          ctx.font = `${style} ${weight} ${size}px "${font}"`;
          ctx.fillStyle = el.color || '#000000'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(el.content, 0, 0);
        }
      } finally { ctx.restore(); }
    }
    return { canvas, ...dims, imageDetails: details, lowSourceDpi: details.some(d => !d.vector && d.dpi < 299.5) };
  } catch (error) { canvas.width = canvas.height = 0; throw error; }
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Canvas PNG bytes with an explicit physical-resolution pHYs chunk. */
export async function printPng(canvas, dpi = PRINT_DPI) {
  const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Print encoding failed')), 'image/png'));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunk = new Uint8Array(21), view = new DataView(chunk.buffer);
  view.setUint32(0, 9); chunk.set([112, 72, 89, 115], 4);
  view.setUint32(8, Math.round(dpi / 0.0254)); view.setUint32(12, Math.round(dpi / 0.0254)); chunk[16] = 1;
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  const parts = [bytes.subarray(0, 33), chunk];
  for (let offset = 33; offset < bytes.length;) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
    const end = offset + length + 12;
    if (!(bytes[offset + 4] === 112 && bytes[offset + 5] === 72 && bytes[offset + 6] === 89 && bytes[offset + 7] === 115)) parts.push(bytes.subarray(offset, end));
    offset = end;
  }
  return new Blob(parts, { type: 'image/png' });
}
