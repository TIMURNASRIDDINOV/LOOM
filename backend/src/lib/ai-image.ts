// Image plumbing for the Workers AI spike: one normaliser for every model
// output shape, plus the PNG inspection the cutout endpoint uses to prove a
// background removal actually happened.

/** A normalised model output: raw bytes plus what they actually are. */
export interface NormalisedImage {
  bytes: Uint8Array
  /** Sniffed from magic bytes, never from the model's docs. */
  mime: string
  ext: string
  /** Which branch the output took — logged so shape drift is visible. */
  shape: string
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/**
 * Content sniffing by magic bytes. Model docs disagree with reality here:
 * flux-1-schnell is documented as returning "an image" and returns JPEG, while
 * older SD models stream PNG. Storing a JPEG under a .png key would make the
 * cutout debugging untrustworthy, so the extension follows the bytes.
 */
function sniff(b: Uint8Array): { mime: string; ext: string } {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: 'image/png', ext: 'png' }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return { mime: 'image/webp', ext: 'webp' }
  return { mime: 'application/octet-stream', ext: 'bin' }
}

/**
 * THE normaliser. Every model output in the registry passes through here.
 *
 * Shapes handled (all verified against the live service except Response, which
 * is defensive):
 *   { image: "<base64>" }  — flux-1-schnell, flux-2-klein-*, leonardo/*
 *   ReadableStream         — older SD-family models
 *   ArrayBuffer / TypedArray
 *   Response
 */
export async function toImageBytes(out: unknown): Promise<NormalisedImage> {
  const finish = (bytes: Uint8Array, shape: string): NormalisedImage => {
    if (bytes.length === 0) throw new Error(`model returned 0 bytes (shape: ${shape})`)
    return { bytes, ...sniff(bytes), shape }
  }

  if (out instanceof ReadableStream) {
    const buf = await new Response(out).arrayBuffer()
    return finish(new Uint8Array(buf), 'ReadableStream')
  }

  if (out instanceof Response) {
    const buf = await out.arrayBuffer()
    return finish(new Uint8Array(buf), 'Response')
  }

  if (out instanceof ArrayBuffer) {
    return finish(new Uint8Array(out), 'ArrayBuffer')
  }

  if (ArrayBuffer.isView(out)) {
    const v = out as ArrayBufferView
    return finish(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), 'TypedArray')
  }

  if (out && typeof out === 'object' && 'image' in out) {
    const img = (out as { image: unknown }).image
    if (typeof img === 'string') return finish(decodeBase64(img), 'object.image (base64)')
    // Some models nest a stream or buffer under .image rather than a string.
    return toImageBytes(img)
  }

  throw new Error(
    `unrecognised model output shape: ${Object.prototype.toString.call(out)}` +
      (out && typeof out === 'object' ? ` keys=[${Object.keys(out).join(',')}]` : ''),
  )
}

// ─── PNG inspection ──────────────────────────────────────────────────────────

export interface PngInfo {
  isPng: boolean
  /** 0 grey, 2 RGB, 3 palette, 4 grey+alpha, 6 RGBA */
  colorType: number | null
  /** True when the pixel format carries alpha, or a tRNS chunk declares it. */
  hasAlpha: boolean
  hasTrns: boolean
}

/**
 * Reads the IHDR colour type and scans the chunk table for tRNS, without
 * decompressing pixel data. This is what tells a real cutout apart from a
 * transform that silently passed the original through: a generated source is
 * RGB (colourType 2) or JPEG, a segmented result is RGBA (colourType 6).
 */
export function inspectPng(bytes: Uint8Array): PngInfo {
  const isPng =
    bytes.length > 33 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  if (!isPng) return { isPng: false, colorType: null, hasAlpha: false, hasTrns: false }

  // 8 signature + 4 length + 4 "IHDR" + 4 width + 4 height + 1 bit depth = 25
  const colorType = bytes[25]

  let hasTrns = false
  let off = 8
  while (off + 12 <= bytes.length) {
    const len =
      (bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7])
    if (type === 'tRNS') { hasTrns = true; break }
    // tRNS always precedes IDAT; stop rather than walk the whole pixel payload.
    if (type === 'IDAT' || type === 'IEND') break
    if (len < 0) break
    off += 12 + len
  }

  return {
    isPng: true,
    colorType,
    hasAlpha: colorType === 4 || colorType === 6,
    hasTrns,
  }
}
