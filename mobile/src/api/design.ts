import type { StudioState } from '../state/studio'
import { LEGACY_PRINT_AREA, PLATEN_CM, REF_RECT, TEX_SIZE, deg2rad, normalised } from '../lib/print'
import { colorName, tStatic, type TFn } from '../i18n'

// The admin order view and the print-master pipeline read `design_json` v2
// (see `configurator.js:_buildDesignJson` and `admin/assets/order-detail.js`).
// The app's studio is a reduced editor — at most one artwork and one text layer
// per face — but it must serialise into the *same* v2 shape, in the same
// normalised coordinate space and units, or an app order can't be produced:
//
//   · nx/ny      — 0–1 inside the print rect
//   · rotation   — RADIANS (the admin shows `rotation * 180 / π`)
//   · scalePct   — image long edge = scalePct% of 0.30·TEX·(rect.w/REF.w)
//   · size       — text px in the 928×1120 reference rect
//   · key        — R2 key of the bitmap to print; for marketplace artwork the
//                  artwork's own file, plus `artworkId` for the designer's cut

type Element = Record<string, unknown>

function serializeFace(face: StudioState['front']): { printRect: typeof LEGACY_PRINT_AREA; elements: Element[] } {
  const elements: Element[] = []

  if (face.art) {
    const { nx, ny } = normalised(face.art.offset)
    elements.push({
      id: face.art.id,
      type: 'image',
      nx,
      ny,
      rotation: deg2rad(face.art.rotation),
      name: face.art.name,
      scalePct: face.art.sizePct,
      key: face.art.uploadKey ?? null,
      ...(face.art.artworkId ? { artworkId: face.art.artworkId, author: face.art.author ?? null } : {}),
    })
  }

  if (face.text?.content) {
    const { nx, ny } = normalised(face.text.offset)
    elements.push({
      id: face.text.id,
      type: 'text',
      nx,
      ny,
      rotation: deg2rad(face.text.rotation),
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

/** True when a design references a print asset that has not been uploaded yet. */
export function designMissingUploads(s: StudioState): boolean {
  return [s.front.art, s.back.art].some((a) => a && a.uri && !a.uploadKey && !a.pattern)
}

/** The one-line summary shown on cart rows and order cards. */
export function summarizeDesign(designJson: string, t: TFn = tStatic): string {
  let d: Record<string, unknown> = {}
  try {
    d = JSON.parse(designJson || '{}')
  } catch {
    return ''
  }
  const bits: string[] = []
  if (typeof d.shirtColor === 'string') bits.push(colorName(d.shirtColor, t))
  if (typeof d.size === 'string') bits.push(d.size)
  if (d.plain) {
    bits.push(t('common.noPrint'))
    return bits.join(' · ')
  }
  if (d.multi) {
    bits.push(t('common.itemsN', { n: String(d.itemCount ?? '') }).trim())
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
