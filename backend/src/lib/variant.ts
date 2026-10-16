import { getActiveProducts, getProductById } from '../db/queries'

// LOOM-166: the size and colour a customer picked must exist in the product's
// config (migration 0022) at cart and at checkout. Clients translate `code`.
export type VariantError = {
  error: string
  code: 'product_unavailable' | 'size_unavailable' | 'color_unavailable' | 'print_unavailable'
}

const PRODUCT: VariantError = { error: 'This product is unavailable', code: 'product_unavailable' }
const SIZE: VariantError = { error: 'This size is unavailable', code: 'size_unavailable' }
const COLOR: VariantError = { error: 'This colour is unavailable', code: 'color_unavailable' }
const PRINT: VariantError = { error: 'This product is sold without a print', code: 'print_unavailable' }

// LOOM-220: black was the slate #1F2937 before it became #000000. A cart item
// still on #1F2937 is sold as black on a product that offers #000000 instead.
const LEGACY_BLACK = '#1F2937'
const BLACK = '#000000'

// The print and logo files of a cart or order item (mockup and model keys are previews).
type PrintFiles = {
  logo_key?: string | null
  back_logo_key?: string | null
  front_print_key?: string | null
  back_print_key?: string | null
}

/** True when a side of the design has a layer: v2 elements, or the legacy text or image. */
function hasLayers(d: Record<string, unknown>): boolean {
  return ['front', 'back'].some((side) => {
    const v = d[side] as { elements?: unknown; text?: { content?: unknown }; image?: { name?: unknown } } | null
    return !!v && typeof v === 'object' &&
      ((Array.isArray(v.elements) && v.elements.length > 0) || !!v.text?.content || !!v.image?.name)
  })
}

/**
 * `{ designJson }` when the item may be sold: the JSON to store, which is the
 * one sent unless a legacy black was rewritten to #000000. An item without a
 * product id is made on the default garment (the first active custom product,
 * as the configurator picks it), so it is checked against that product's config.
 * A 'blank' product (LOOM-226) is sold with colour and size only.
 */
export async function checkVariant(
  db: D1Database,
  productId: number | null,
  designJson: string,
  files: PrintFiles = {},
): Promise<VariantError | { designJson: string }> {
  const ok = { designJson }
  const p = productId != null
    ? await getProductById(db, productId)
    : (await getActiveProducts(db)).find((x) => (x.product_type || 'custom') === 'custom') ?? null
  if (productId != null && (!p || !p.active)) return PRODUCT
  if (!p) return ok

  let d: Record<string, unknown> = {}
  try {
    const j: unknown = JSON.parse(designJson)
    if (j && typeof j === 'object') d = j as Record<string, unknown>
  } catch { /* checked as empty */ }

  if (p.product_type === 'blank' && (hasLayers(d) ||
    files.logo_key || files.back_logo_key || files.front_print_key || files.back_print_key)) return PRINT

  let sizes: unknown, colors: unknown
  try {
    sizes = JSON.parse(p.sizes_json as string)
    colors = JSON.parse(p.colors_json as string)
  } catch {
    return ok // no config columns yet (Worker before 0022): nothing to check against
  }
  if (!Array.isArray(sizes) || !Array.isArray(colors)) return ok

  if (typeof d.size !== 'string' || !sizes.includes(d.size)) return SIZE
  // A ready-made design is sold in its own colour; one is checked only when sent.
  if (d.shirtColor == null && p.product_type === 'ready') return ok
  const offered = (hex: string) => colors.some((c: { hex?: unknown; available?: unknown }) =>
    c && c.available === true && String(c.hex).toUpperCase() === hex)
  const hex = String(d.shirtColor ?? '').toUpperCase()
  if (offered(hex)) return ok
  if (hex === LEGACY_BLACK && offered(BLACK)) return { designJson: JSON.stringify({ ...d, shirtColor: BLACK }) }
  return COLOR
}
