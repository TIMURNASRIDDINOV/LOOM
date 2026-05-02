// R2 upload helpers

const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
}

const MAX_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB

export function validateUpload(
  contentType: string,
  size: number,
): { ok: true; ext: string } | { ok: false; error: string } {
  const ext = ALLOWED_CONTENT_TYPES[contentType]
  if (!ext) return { ok: false, error: 'Content-Type must be image/png, image/jpeg, or image/svg+xml' }
  if (size > MAX_SIZE_BYTES) return { ok: false, error: 'File must be ≤ 5 MB' }
  if (size <= 0) return { ok: false, error: 'Invalid file size' }
  return { ok: true, ext }
}

export function generateLogoKey(ext: string): string {
  return `logos/${crypto.randomUUID()}.${ext}`
}
