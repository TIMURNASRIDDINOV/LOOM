import type { StudioState } from '../state/studio'

// The admin order view and the print-master pipeline read `design_json` v2
// (see `configurator.js:_buildDesignJson` and `admin/assets/order-detail.js`).
// The app's studio is a reduced editor — at most one artwork and one text layer
// per face — but it must serialise into the *same* v2 shape, in the same
// normalised coordinate space, or an app order can't be produced.

const TEX_SIZE = 2048
const LEGACY_PRINT_AREA = { x: 560, y: 360, w: 928, h: 1120 }
const REF_RECT = { w: LEGACY_PRINT_AREA.w, h: LEGACY_PRINT_AREA.h }
const PLATEN_CM = { w: 30, h: 40 }

type Element = Record<string, unknown>

/**
 * The studio positions layers as a percentage offset from the centre of the
 * print rect; v2 wants `nx`/`ny` normalised 0–1 inside that rect.
 */
function normalised(offsetPct: { x: number; y: number }) {
  return {
    nx: +(0.5 + offsetPct.x / 100).toFixed(5),
    ny: +(0.5 + offsetPct.y / 100).toFixed(5),
  }
}

function serializeFace(face: StudioState['front']): { printRect: typeof LEGACY_PRINT_AREA; elements: Element[] } {
  const elements: Element[] = []

  if (face.art) {
    const { nx, ny } = normalised(face.art.offset)
    elements.push({
      id: face.art.id,
      type: 'image',
      nx,
      ny,
      rotation: face.art.rotation,
      name: face.art.name,
      scalePct: face.art.sizePct,
      key: face.art.uploadKey ?? null,
    })
  }

  if (face.text?.content) {
    const { nx, ny } = normalised(face.text.offset)
    elements.push({
      id: face.text.id,
      type: 'text',
      nx,
      ny,
      rotation: face.text.rotation,
      content: face.text.content,
      font: face.text.font,
      size: face.text.size,
      color: face.text.color,
      bold: true,
      italic: false,
    })
  }

  return { printRect: { ...LEGACY_PRINT_AREA }, elements }
}

export function buildDesignJson(s: StudioState): string {
  return JSON.stringify({
    v: 2,
    shirtColor: s.color,
    size: s.size,
    texSize: TEX_SIZE,
    refRect: { w: REF_RECT.w, h: REF_RECT.h },
    platenCm: { w: PLATEN_CM.w, h: PLATEN_CM.h },
    source: 'app',
    front: serializeFace(s.front),
    back: serializeFace(s.back),
  })
}

/** A ready-made product bought as-is carries no print. */
export function buildPlainDesignJson(size: string, color = '#FFFFFF'): string {
  return JSON.stringify({ v: 2, plain: true, shirtColor: color, size, source: 'app' })
}

const COLOR_NAMES: Record<string, string> = {
  '#FFFFFF': 'Белый',
  '#1C1C1C': 'Чёрный',
  '#E2D9CC': 'Песочный',
  '#9BA3AF': 'Серый',
  '#2B3E5E': 'Тёмно-синий',
  '#4D6642': 'Хаки',
}

/** The one-line summary shown on cart rows and order cards. */
export function summarizeDesign(designJson: string): string {
  let d: Record<string, unknown> = {}
  try {
    d = JSON.parse(designJson || '{}')
  } catch {
    return ''
  }
  const bits: string[] = []
  if (typeof d.shirtColor === 'string') {
    bits.push(COLOR_NAMES[d.shirtColor.toUpperCase()] ?? d.shirtColor)
  }
  if (typeof d.size === 'string') bits.push(d.size)
  if (d.plain) {
    bits.push('Без принта')
    return bits.join(' · ')
  }
  const front = d.front as { elements?: Element[] } | undefined
  const els = front?.elements ?? []
  const text = els.find((e) => e.type === 'text')
  if (text?.content) bits.push(`«${text.content}»`)
  const image = els.find((e) => e.type === 'image')
  if (image?.name) bits.push(String(image.name))
  return bits.join(' · ')
}
