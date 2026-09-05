import { Platform } from 'react-native'

// Turn a picked image into something a WebView page can draw.
//
// expo-image-picker hands back `file://` (or `ph://` on iOS) URIs. The 3D scene
// runs inside a WebView whose document is loomdesign.uz, and a page from that
// origin cannot read the device's files — so the bytes are inlined as a data:
// URI. Remote URLs (marketplace artwork on api.loomdesign.uz) pass straight
// through; they are served with `Access-Control-Allow-Origin: *`.

const cache = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()

export function isLocalUri(uri: string): boolean {
  return /^(file|ph|content|assets-library):/.test(uri)
}

/** Resolves a data: URI for a local file; remote/data URIs are returned as-is. */
export async function toDisplayableSrc(uri: string, mime = 'image/png'): Promise<string> {
  if (!isLocalUri(uri)) return uri
  const hit = cache.get(uri)
  if (hit) return hit
  const pending = inflight.get(uri)
  if (pending) return pending

  const p = (async () => {
    let b64: string
    if (Platform.OS === 'web') {
      const blob = await (await fetch(uri)).blob()
      b64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
        r.onerror = () => reject(r.error)
        r.readAsDataURL(blob)
      })
    } else {
      // Loaded lazily so the web bundle never pulls the native module in.
      const FS = await import('expo-file-system/legacy')
      b64 = await FS.readAsStringAsync(uri, { encoding: 'base64' })
    }
    const src = `data:${mime};base64,${b64}`
    cache.set(uri, src)
    inflight.delete(uri)
    return src
  })()
  inflight.set(uri, p)
  return p
}

/** Synchronous cache read — what the render path uses while the async read runs. */
export function cachedSrc(uri: string | null): string | null {
  if (!uri) return null
  if (!isLocalUri(uri)) return uri
  return cache.get(uri) ?? null
}
