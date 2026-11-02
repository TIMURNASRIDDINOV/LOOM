// Small colour maths for the colour chips: which mark reads on a chip, and
// when a text colour would vanish into the garment.

function channels(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.replace(/./g, (c) => c + c)
  const n = parseInt(h.slice(0, 6), 16)
  if (h.length < 6 || Number.isNaN(n)) return [128, 128, 128]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** WCAG relative luminance, 0 (black) – 1 (white). */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio, 1 (identical) – 21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Ink or white, whichever reads better on this chip colour. */
export function markOn(hex: string, ink: string, white: string): string {
  return contrastRatio(hex, white) >= contrastRatio(hex, ink) ? white : ink
}

/**
 * Text printed in `text` on a garment of `garment` is lost when the two are the
 * same colour, or close enough that it cannot be read (white on sand, ink on
 * black). Below 1.5:1 nothing can be made out.
 */
export function sameAsGarment(text: string, garment: string): boolean {
  return contrastRatio(text, garment) < 1.5
}
