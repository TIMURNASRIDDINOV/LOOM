import { getActiveProducts, getArtworkById, getCartItems, getProductById, type CartItem } from '../db/queries'

export function artworkIdsIn(designJson: string): number[] {
  let design: Record<string, unknown>
  try { design = JSON.parse(designJson) } catch { return [] }
  const ids = new Set<number>()
  for (const side of ['front', 'back']) {
    const face = design?.[side] as { elements?: { artworkId?: unknown }[] } | undefined
    if (!Array.isArray(face?.elements)) continue
    for (const element of face.elements) {
      const id = Number(element?.artworkId)
      if (Number.isSafeInteger(id) && id > 0) ids.add(id)
    }
  }
  return [...ids]
}

/** The garment plus each approved designer artwork once per item. */
export async function priceDesign(db: D1Database, productId: number | null, designJson: string) {
  const product = productId != null ? await getProductById(db, productId)
    : (await getActiveProducts(db)).find((p) => (p.product_type || 'custom') === 'custom')
  if (!product || !Number.isSafeInteger(product.price) || product.price < 0) return null
  let unitPrice = product.price
  for (const id of artworkIdsIn(designJson)) {
    const art = await getArtworkById(db, id)
    if (art?.status === 'approved' && Number.isSafeInteger(art.markup) && art.markup >= 0) unitPrice += art.markup
  }
  if (!Number.isSafeInteger(unitPrice)) return null
  return { productId: product.id, unitPrice, available: !!product.active }
}

/** Refresh the user's quote before displaying it or attempting checkout. */
export async function cartSnapshot(db: D1Database, userId: number) {
  const original = await getCartItems(db, userId)
  const items: (CartItem & { unavailable?: boolean })[] = []
  const updates: D1PreparedStatement[] = []
  let priceChanged = false
  for (const item of original) {
    const quote = await priceDesign(db, item.product_id, item.design_json)
    if (!quote) { items.push({ ...item, unit_price: 0, unavailable: true }); continue }
    priceChanged ||= quote.unitPrice !== item.unit_price
    items.push({ ...item, product_id: quote.productId, unit_price: quote.unitPrice, unavailable: !quote.available })
    if (quote.unitPrice !== item.unit_price || quote.productId !== item.product_id) {
      updates.push(db.prepare('UPDATE cart_items SET unit_price = ?, product_id = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .bind(quote.unitPrice, quote.productId, Date.now(), item.id, userId))
    }
  }
  if (updates.length) await db.batch(updates)
  return { items, total: items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0), priceChanged }
}
