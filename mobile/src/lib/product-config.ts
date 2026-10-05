import { fetchProducts, useAsync } from '../api/catalog'
import type { PrintArea, Product } from '../api/types'
import { colorName, type Lang, type TFn } from '../i18n'
import { useStudio } from '../state/studio'
import { COLORS, SIZES } from '../theme/tokens'
import { PLATEN_CM } from './print'

// LOOM-166: swatches, sizes and the print area come from the product's
// `config` (GET /api/products, LOOM-165), like on the web. A product without
// one (an API before migration 0022) keeps the app's built-in lists.

export type Swatch = { hex: string; names?: Record<Lang, string>; available: boolean }

export type Config = { sizes: string[]; colors: Swatch[]; printArea: PrintArea }

/** The values the web configurator and migration 0022 default to. */
export const DEFAULT_PRINT_AREA: PrintArea = { platen_cm: PLATEN_CM, width_frac: 0.55, top_frac: 0.2 }

export function productConfig(p?: Product | null): Config {
  const c = p?.config
  return {
    sizes: c?.sizes?.length ? c.sizes : [...SIZES],
    colors: c?.colors?.length
      ? c.colors.map((x) => ({
          hex: x.hex.toUpperCase(),
          names: { uz: x.name_uz, ru: x.name_ru, en: x.name_en },
          available: x.available !== false,
        }))
      : COLORS.map((x) => ({ hex: x.hex.toUpperCase(), available: true })),
    printArea: c?.print_area ?? DEFAULT_PRINT_AREA,
  }
}

export function swatchName(sw: Swatch, lang: Lang, t: TFn): string {
  return sw.names?.[lang] || colorName(sw.hex, t)
}

export function colorOk(cfg: Config, hex: string): boolean {
  return cfg.colors.some((c) => c.available && c.hex === hex.toUpperCase())
}

/**
 * The studio's garment: its product, or the default garment (the first custom
 * product, as on the web and the server) when none was picked. `unavailable`
 * is a picked product that is no longer in the active catalogue.
 */
export function useStudioProduct() {
  const { s } = useStudio()
  const { data: products } = useAsync(fetchProducts, [])
  const product = !products
    ? undefined
    : s.productId != null
      ? products.find((p) => p.id === s.productId)
      : products.find((p) => (p.product_type ?? 'custom') !== 'ready')
  return {
    product,
    unavailable: !!products && s.productId != null && !product,
    config: productConfig(product),
  }
}
