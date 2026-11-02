import type { OrderItem } from '../../api/orders'
import type { Product } from '../../api/types'
import { summarizeDesign } from '../../api/design'
import type { Lang, TFn } from '../../i18n'

// Small formatters for the order screens (W30, W31).

/** The API sends epoch ms; a seconds value (< 1e11) is lifted so either reads right. */
export const toMs = (ts: number) => (ts < 1e11 ? ts * 1000 : ts)

/** `19 okt` — the month names come from the dictionary. */
export function dayLabel(ts: number, t: TFn): string {
  const d = new Date(toMs(ts))
  return `${d.getDate()} ${t('months').split(',')[d.getMonth()] ?? ''}`
}

/** `14:20`, device time. */
export function timeLabel(ts: number): string {
  const d = new Date(toMs(ts))
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Items in an order: the header row of a cart checkout stores `{ multi, itemCount }`; anything else is one. */
export function lineCount(designJson: string): number {
  try {
    const d = JSON.parse(designJson || '{}') as { multi?: boolean; itemCount?: unknown }
    const n = Number(d.itemCount)
    return d.multi && Number.isInteger(n) && n > 0 ? n : 1
  } catch {
    return 1
  }
}

type Named = Product & { name_uz?: string | null }

/** The product's name in the interface language; the order line keeps only the Russian one. */
export function itemName(it: OrderItem, products: Product[], lang: Lang, t: TFn): string {
  const p = products.find((x) => x.id === it.product_id) as Named | undefined
  const own = p && (lang === 'en' ? p.name_en : lang === 'uz' ? p.name_uz : p.name_ru)
  return own || it.product_name || t('st.defaultProduct')
}

/** `Oq · L · «text» · 1 dona` */
export function itemMeta(it: OrderItem, t: TFn): string {
  // A non-breaking space keeps "1 dona" on one line.
  const qty = t('orders.qty', { n: it.quantity }).replace(' ', '\u00A0')
  return [summarizeDesign(it.design_json, t), qty].filter(Boolean).join(' · ')
}
