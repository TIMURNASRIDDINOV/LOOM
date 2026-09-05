// Design tokens lifted verbatim from `assets/theme.css` via the
// `LOOM Mobile App.dc.html` prototype. The app softens the web's 2px rules to
// 1.5px and keeps hard offset shadows only on primary CTAs and the active step
// — everything else is a hairline.

export const C = {
  ink: '#131311',
  paper: '#f4f2ed',
  coral: '#fc5044',
  deep: '#c8352b',
  white: '#ffffff',
  telegram: '#1A78A5',
  green: '#15803d',
  amber: '#a16207',

  line: 'rgba(19,19,17,.16)',
  i70: 'rgba(19,19,17,.7)',
  i55: 'rgba(19,19,17,.55)',
  i38: 'rgba(19,19,17,.38)',
  i09: 'rgba(19,19,17,.09)',
  onInk55: 'rgba(244,242,237,.55)',
} as const

// Rules: 1.5 hairline for structure, 1 for internal dividers.
export const RULE = 1.5
export const HAIR = 1

/**
 * Hard offset shadow — reserved for primary CTAs and the active step.
 *
 * The design's shadow is a solid displaced rectangle (`box-shadow: 3px 3px 0
 * #131311`), not a blur. `boxShadow` carries that verbatim and renders the
 * same on both platforms; the legacy `shadow*` props can only fake it on iOS,
 * and Android's `elevation` always blurs, which would drop the offset
 * silently.
 */
export function offset(size: number, color: string = C.ink) {
  return { boxShadow: `${size}px ${size}px 0 ${color}` } as const
}

/** No shadow, spelled out so styles can switch between the two shapes. */
export const noShadow = { boxShadow: 'none' } as const

export const F = {
  display: 'InterTight',
  displayBold: 'InterTight_700Bold',
  displaySemi: 'InterTight_600SemiBold',
  displayExtra: 'InterTight_800ExtraBold',
  displayMedium: 'InterTight_500Medium',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemi: 'Inter_600SemiBold',
  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
  monoSemi: 'IBMPlexMono_600SemiBold',
  monoBold: 'IBMPlexMono_700Bold',
} as const

// Garment colours. Names live in the i18n dictionary (`colorName()` in
// src/i18n) so the studio speaks the interface language.
export const COLORS: { hex: string }[] = [
  { hex: '#FFFFFF' },
  { hex: '#1c1c1c' },
  { hex: '#e2d9cc' },
  { hex: '#9ba3af' },
  { hex: '#2b3e5e' },
  { hex: '#4d6642' },
]

export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'] as const
export type Size = (typeof SIZES)[number]

export type OrderStatusKey = 'new' | 'confirmed' | 'producing' | 'shipped' | 'delivered'

/** The status ladder; labels come from `statusLabel()` in src/i18n. */
export const STATUSES: { k: OrderStatusKey; c: string }[] = [
  { k: 'new', c: '#3b82f6' },
  { k: 'confirmed', c: '#eab308' },
  { k: 'producing', c: '#f97316' },
  { k: 'shipped', c: '#a855f7' },
  { k: 'delivered', c: '#22c55e' },
]

export function fmt(n: number): string {
  // ru-RU grouping with a non-breaking thin space, matching the web storefront.
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}
