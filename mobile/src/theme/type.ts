import type { TextStyle } from 'react-native'
import { C, F } from './tokens'

// The prototype writes type as CSS `font:` shorthands (`700 38px/.98 'Inter
// Tight'`). These helpers keep the same three-part shape — weight-family, size,
// line-height multiplier — so a value can be traced straight back to the design.

type Opts = { color?: string; ls?: number; upper?: boolean; align?: TextStyle['textAlign'] }

function make(family: string, size: number, lh: number, o: Opts = {}): TextStyle {
  const s: TextStyle = {
    fontFamily: family,
    fontSize: size,
    lineHeight: Math.round(size * lh * 100) / 100,
    color: o.color ?? C.ink,
  }
  if (o.ls !== undefined) s.letterSpacing = o.ls * size
  if (o.upper) s.textTransform = 'uppercase'
  if (o.align) s.textAlign = o.align
  return s
}

/** `font: 700 <size>/<lh> 'Inter Tight'` — headlines, buttons, product names. */
export const disp = (size: number, lh = 1.1, o: Opts = {}) => make(F.displayBold, size, lh, o)
export const dispSemi = (size: number, lh = 1.15, o: Opts = {}) => make(F.displaySemi, size, lh, o)
export const dispExtra = (size: number, lh = 1, o: Opts = {}) => make(F.displayExtra, size, lh, o)

/** `font: 400 <size>/<lh> Inter` — running copy. */
export const body = (size: number, lh = 1.6, o: Opts = {}) => make(F.body, size, lh, o)
export const bodyMed = (size: number, lh = 1.4, o: Opts = {}) => make(F.bodyMedium, size, lh, o)
export const bodySemi = (size: number, lh = 1.2, o: Opts = {}) => make(F.bodySemi, size, lh, o)

/** `font: 400 <size>/<lh> 'IBM Plex Mono'` — labels, prices, meta. */
export const mono = (size: number, lh = 1.4, o: Opts = {}) => make(F.mono, size, lh, o)
export const monoMed = (size: number, lh = 1.2, o: Opts = {}) => make(F.monoMedium, size, lh, o)
export const monoSemi = (size: number, lh = 1.4, o: Opts = {}) => make(F.monoSemi, size, lh, o)
export const monoBold = (size: number, lh = 1.2, o: Opts = {}) => make(F.monoBold, size, lh, o)

/**
 * The recurring eyebrow: uppercase mono, wide tracking, muted.
 * `font:600 10.5px/1.4 mono; letter-spacing:.26em; text-transform:uppercase`
 */
export const kicker = (size = 10.5, o: Opts = {}) =>
  monoSemi(size, 1.4, { ls: 0.26, upper: true, color: C.deep, ...o })

/** Field/section label: `600 9.5px mono, .14em, uppercase, i55`. */
export const label = (size = 9.5, o: Opts = {}) =>
  monoSemi(size, 1, { ls: 0.14, upper: true, color: C.i55, ...o })
