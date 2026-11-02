// The host side of the 3D scene page (LOOM-262): what the app knows about the
// page and what it does when the page, the network or the WebView process fails.
// Pure, so the same state machine drives the native WebView host (Model3D.tsx)
// and the web iframe host (Model3D.web.tsx), and can be run without a device.

/** How long the host waits for `ready` before it shows the retry state. */
export const SCENE_WATCHDOG_MS = 20000

/** The facts the diagnostics overlay shows. Posted by the page; shown, never sent anywhere. */
export type SceneDiag = {
  webgl2: boolean | null
  gpu: string | null
  maxTex: number | null
  dpr: number | null
  w: number | null
  h: number | null
  /** Drawing buffer of the canvas, px. */
  canvas: [number, number] | null
  env: boolean | null
  /** ms since the page began: scripts done / model fetched and parsed / first frame drawn. */
  tScripts: number | null
  tGlb: number | null
  tFirst: number | null
  lastError: string | null
}

/** 'unavailable': this device cannot show 3D. 'load': something did not arrive in time or at all. */
export type SceneErrorKind = 'load' | 'unavailable'

export type SceneState = {
  status: 'loading' | 'ready' | 'error'
  kind: SceneErrorKind
  pct: number
  printable: boolean
  diag: SceneDiag
  /** Bumped by Retry: the host remounts the page under a new key. */
  attempt: number
}

export type PageMessage =
  | { type: 'progress'; pct: number }
  | { type: 'ready'; printable?: boolean }
  | { type: 'error'; message?: string; kind?: SceneErrorKind }
  | { type: 'diag'; diag: Partial<SceneDiag> }
  | { type: string }

export type SceneAction =
  | { type: 'page'; msg: PageMessage }
  /** Detected by the host: watchdog, HTTP error, render process gone. */
  | { type: 'fail'; reason: string; kind?: SceneErrorKind }
  | { type: 'retry' }
  /** The screen lost focus and the page was unmounted. */
  | { type: 'reset' }

const NO_DIAG: SceneDiag = {
  webgl2: null, gpu: null, maxTex: null, dpr: null, w: null, h: null,
  canvas: null, env: null, tScripts: null, tGlb: null, tFirst: null, lastError: null,
}

export const INITIAL_SCENE: SceneState = { status: 'loading', kind: 'load', pct: 0, printable: true, diag: NO_DIAG, attempt: 0 }

export function sceneReducer(s: SceneState, a: SceneAction): SceneState {
  switch (a.type) {
    case 'retry':
      return { ...INITIAL_SCENE, attempt: s.attempt + 1 }
    case 'reset':
      return { ...INITIAL_SCENE, attempt: s.attempt }
    case 'fail':
      return { ...s, status: 'error', kind: a.kind ?? 'load', diag: { ...s.diag, lastError: a.reason } }
    case 'page': {
      const m = a.msg as any
      switch (m.type) {
        case 'progress':
          return typeof m.pct === 'number' ? { ...s, pct: m.pct } : s
        case 'ready':
          return { ...s, status: 'ready', printable: m.printable !== false }
        case 'error':
          return {
            ...s,
            status: 'error',
            kind: m.kind === 'unavailable' ? 'unavailable' : 'load',
            diag: { ...s.diag, lastError: s.diag.lastError ?? (m.message ? String(m.message) : null) },
          }
        case 'diag':
          // The page sends its whole diag object each time; an error the host recorded stays.
          return m.diag && typeof m.diag === 'object' ? { ...s, diag: { ...s.diag, ...m.diag, lastError: m.diag.lastError ?? s.diag.lastError } } : s
        default:
          return s
      }
    }
  }
}

/** Parses what the page posts (a JSON string); null for anything that is not ours. */
export function parsePageMessage(raw: unknown): PageMessage | null {
  if (typeof raw !== 'string') return null
  try {
    const m = JSON.parse(raw)
    return m && typeof m.type === 'string' ? m : null
  } catch {
    return null
  }
}
