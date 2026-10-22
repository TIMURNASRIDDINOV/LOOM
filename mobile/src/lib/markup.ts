/**
 * Designer markup for a design: each distinct marketplace artwork is charged
 * once, however many faces carry it. Mirrors artworkMarkupTotal() in the web
 * configurator.js (first-seen price per artwork id wins).
 */
export type MarkupLayer = { artworkId?: number; price: number }

export function artworkMarkupTotal(layers: (MarkupLayer | null | undefined)[]): number {
  const seen = new Map<number, number>()
  for (const l of layers) {
    if (l?.artworkId && !seen.has(l.artworkId)) seen.set(l.artworkId, l.price || 0)
  }
  let sum = 0
  for (const price of seen.values()) sum += price
  return sum
}
