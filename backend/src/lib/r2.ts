// R2 upload + serving helpers.
//
// Uploads: the stored type comes from the file's leading bytes, never from the
// client-declared MIME type or filename.
// Serving: every route that streams a bucket object goes through
// serveObject(), which picks the content type from the key's extension (keys
// are server-generated) and marks the response as inert data.

export type Sniffed = { mime: string; ext: string }

/** Identify a file by its magic bytes. Only formats we accept are recognised. */
export function sniffType(bytes: Uint8Array): Sniffed | null {
  const b = bytes
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return { mime: 'image/png', ext: 'png' }
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' }
  }
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' }
  }
  if (b.length >= 4 && ascii(b, 0, 4) === 'glTF') {
    return { mime: 'model/gltf-binary', ext: 'glb' }
  }
  return null
}

function ascii(b: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...b.subarray(from, to))
}

// Uploads bucket: print artwork, mockups, the textured review model.
const UPLOAD_TYPES = new Set(['image/png', 'image/jpeg', 'model/gltf-binary'])
export const AVATAR_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

/** Old avatar keys were derived from the user id; they are never served. */
export const LEGACY_AVATAR_KEY = /^avatars\/user_\d+\.[a-z]+$/

const MAX_SIZE_BYTES = 15 * 1024 * 1024 // 15 MB — fits 2048² print-artwork PNGs

/** Validate an upload by content. Returns the type to store it under. */
export function validateUpload(
  bytes: Uint8Array,
  allowed: Set<string> = UPLOAD_TYPES,
  maxBytes = MAX_SIZE_BYTES,
): { ok: true; type: Sniffed } | { ok: false; error: string } {
  if (bytes.length <= 0) return { ok: false, error: 'Invalid file size' }
  if (bytes.length > maxBytes) return { ok: false, error: `File must be ≤ ${Math.round(maxBytes / 1048576)} MB` }
  const type = sniffType(bytes)
  if (!type || !allowed.has(type.mime)) {
    return { ok: false, error: 'Unsupported file type. Use PNG or JPEG.' }
  }
  return { ok: true, type }
}

export function generateLogoKey(ext: string): string {
  return `logos/${crypto.randomUUID()}.${ext}`
}

const TYPE_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  glb: 'model/gltf-binary',
}

/** Content type for a stored key, from a fixed table. Unknown → opaque bytes. */
export function contentTypeForKey(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? ''
  return TYPE_BY_EXT[ext] ?? 'application/octet-stream'
}

/**
 * Stream a bucket object. Stored httpMetadata is ignored on purpose; the
 * response is typed from the key and carries headers that stop a browser
 * from treating it as a document.
 */
export function serveObject(object: R2ObjectBody, key: string, cacheControl: string): Response {
  const headers = new Headers()
  headers.set('content-type', contentTypeForKey(key))
  headers.set('x-content-type-options', 'nosniff')
  headers.set('content-security-policy', "default-src 'none'; sandbox")
  headers.set('etag', object.httpEtag)
  headers.set('cache-control', cacheControl)
  return new Response(object.body, { headers })
}
