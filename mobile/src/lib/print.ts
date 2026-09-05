import type { ArtLayer, FaceState, StudioState, TextLayer } from '../state/studio'

// ─── Print geometry shared by the 2D stage, the 3D preview and design_json ────
//
// Everything below mirrors `configurator.js` on the web. The three surfaces the
// customer sees (flat stage, 3D garment) and the one the print shop receives
// (design_json → print master) must agree on what "58% size, 3 mm left of
// centre" means, so the numbers live in one place.

/** Offscreen texture side, px. The web bakes every garment texture at this size. */
export const TEX_SIZE = 2048

/** The DTG platen — the physical print area. */
export const PLATEN_CM = { w: 30, h: 40 }

/** Unit basis for sizes: a text `size` of 160 means 160 px in a rect this tall. */
export const REF_RECT = { w: 928, h: 1120 }
export const LEGACY_PRINT_AREA = { x: 560, y: 360, w: 928, h: 1120 }

/**
 * Image scale semantics, from `drawElementIn`: at scalePct 100 the image's long
 * edge spans `TEX_SIZE * 0.30 * (rect.w / REF_RECT.w)` px, i.e. this fraction
 * of the print rect's width.
 */
export const IMAGE_FRAC_AT_100 = (TEX_SIZE * 0.3) / REF_RECT.w // ≈ 0.662

/** Long edge of an image in cm on the garment, for the given scalePct. */
export function imageCm(scalePct: number): number {
  return PLATEN_CM.w * IMAGE_FRAC_AT_100 * (scalePct / 100)
}

/** Offset in percent of the print rect that equals one millimetre. */
export const MM_PCT = { x: 100 / (PLATEN_CM.w * 10), y: 100 / (PLATEN_CM.h * 10) }

/** Percent offset from the rect centre → normalised 0–1 inside the rect. */
export function normalised(offsetPct: { x: number; y: number }) {
  return {
    nx: +(0.5 + offsetPct.x / 100).toFixed(5),
    ny: +(0.5 + offsetPct.y / 100).toFixed(5),
  }
}

export const deg2rad = (d: number) => (d * Math.PI) / 180

// ─── Scene description handed to the 3D WebView ──────────────────────────────

export type SceneImage = {
  type: 'image'
  id: string
  nx: number
  ny: number
  /** radians, like the web */
  rotation: number
  scalePct: number
  /** https URL or data: URI — never a file:// path, the WebView cannot read those */
  src: string | null
}

export type SceneText = {
  type: 'text'
  id: string
  nx: number
  ny: number
  rotation: number
  content: string
  font: string
  /** px in REF_RECT space */
  size: number
  color: string
  bold: boolean
}

export type SceneElement = SceneImage | SceneText

export type SceneDesign = {
  shirtColor: string
  front: SceneElement[]
  back: SceneElement[]
}

function faceElements(face: FaceState, artSrc: string | null): SceneElement[] {
  const out: SceneElement[] = []
  if (face.art) {
    const a: ArtLayer = face.art
    const { nx, ny } = normalised(a.offset)
    out.push({
      type: 'image',
      id: a.id,
      nx,
      ny,
      rotation: deg2rad(a.rotation),
      scalePct: a.sizePct,
      src: artSrc,
    })
  }
  if (face.text?.content) {
    const t: TextLayer = face.text
    const { nx, ny } = normalised(t.offset)
    out.push({
      type: 'text',
      id: t.id,
      nx,
      ny,
      rotation: deg2rad(t.rotation),
      content: t.content,
      font: t.font,
      size: t.size,
      color: t.color,
      bold: true,
    })
  }
  return out
}

/**
 * Build the scene for the 3D preview. `resolveSrc` turns a layer's URI into
 * something the WebView can load (remote URLs pass through, local files come
 * back as data URIs, or null while still reading).
 */
export function toSceneDesign(
  s: StudioState,
  resolveSrc: (uri: string | null) => string | null,
): SceneDesign {
  return {
    shirtColor: s.color,
    front: faceElements(s.front, resolveSrc(s.front.art?.uri ?? null)),
    back: faceElements(s.back, resolveSrc(s.back.art?.uri ?? null)),
  }
}
