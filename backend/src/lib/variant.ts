import { getActiveProducts, getProductById } from '../db/queries'

// LOOM-166: the size and colour a customer picked must exist in the product's
// config (migration 0022) at cart and at checkout. Clients translate `code`.
export type VariantError = {
  error: string
  code: 'product_unavailable' | 'size_unavailable' | 'color_unavailable'
}

const PRODUCT: VariantError = { error: 'This product is unavailable', code: 'product_unavailable' }
const SIZE: VariantError = { error: 'This size is unavailable', code: 'size_unavailable' }
const COLOR: VariantError = { error: 'This colour is unavailable', code: 'color_unavailable' }

/**
 * null when the item may be sold. An item without a product id is made on the
 * default garment (the first active custom product, as the configurator picks
 * it), so it is checked against that product's config.
 */
export async function checkVariant(
  db: D1Database,
  productId: number | null,
  designJson: string,
): Promise<VariantError | null> {
  const p = productId != null
    ? await getProductById(db, productId)
    : (await getActiveProducts(db)).find((x) => (x.product_type || 'custom') !== 'ready') ?? null
  if (productId != null && (!p || !p.active)) return PRODUCT
  if (!p) return null

  let sizes: unknown, colors: unknown
  try {
    sizes = JSON.parse(p.sizes_json as string)
    colors = JSON.parse(p.colors_json as string)
  } catch {
    return null // no config columns yet (Worker before 0022): nothing to check against
  }
  if (!Array.isArray(sizes) || !Array.isArray(colors)) return null

  let d: Record<string, unknown> = {}
  try { d = JSON.parse(designJson) as Record<string, unknown> } catch { /* checked as empty */ }

  if (typeof d.size !== 'string' || !sizes.includes(d.size)) return SIZE
  // A ready-made design is sold in its own colour; one is checked only when sent.
  if (d.shirtColor == null && p.product_type === 'ready') return null
  const hex = String(d.shirtColor ?? '').toUpperCase()
  const ok = colors.some((c: { hex?: unknown; available?: unknown }) =>
    c && c.available === true && String(c.hex).toUpperCase() === hex)
  return ok ? null : COLOR
}
