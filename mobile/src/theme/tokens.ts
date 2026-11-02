// Design tokens lifted from `assets/theme.css` §11 via the "LOOM app v2" design
// (W-Web-System): 2px ink rules, hard offset shadows, radius 0, and a 12px text
// floor with AA contrast — secondary text is ink at 72%, never lighter.

export const C = {
  ink: '#131311',
  paper: '#f4f2ed',
  paper2: '#ebe8e1',
  coral: '#fc5044',
  deep: '#c8352b',
  white: '#ffffff',
  telegram: '#1A78A5',
  green: '#15803d',
  amber: '#a16207',

  line: 'rgba(19,19,17,.16)',
  /** "ink-70" in the design: secondary text. AA on paper and white. */
  i70: 'rgba(19,19,17,.72)',
  /** Inactive icons (tab bar). */
  inactive: '#575652',
  /** Placeholders only — below AA for running text. */
  i55: 'rgba(19,19,17,.55)',
  i38: 'rgba(19,19,17,.38)',
  i09: 'rgba(19,19,17,.09)',
  onInk55: 'rgba(244,242,237,.55)',
} as const

// Rules: 2px ink for structure, 1px for internal dividers.
export const RULE = 2
export const HAIR = 1

/**
 * Hard offset shadow: `offset(2)` hard-sm (buttons, inputs, cards), `offset(3)`
 * hard, `offset(3, C.coral)` focus, `offset(6, C.coral)` the pressed-card lift.
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

// The built-in size list. A product's config (LOOM-166) may carry others.
export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'] as const
export type Size = string

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
