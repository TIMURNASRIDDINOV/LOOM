import { useCallback, useState } from 'react'
import { useRouter } from 'expo-router'

import { fetchProducts } from '../../api/catalog'
import { summarizeDesign } from '../../api/design'
import { addOrderItemToCart, fetchOrder, type OrderItem } from '../../api/orders'
import type { Product } from '../../api/types'
import { useI18n } from '../../i18n'
import { useCart } from '../../state/cart'
import { useToast } from '../../state/toast'
import { itemName } from './format'

/**
 * "Takrorlash": every line of a past order goes back into the cart, one POST to
 * `/api/cart` each — the server re-checks product, size and colour. A line that
 * is refused is named in a toast and the others stay. The app's cart screen
 * reads the on-device cart (`state/cart.tsx`), so an accepted line is added
 * there too; checkout replaces the server cart from it. With at least one line
 * added the shopper lands on /cart.
 */
export function useRepeatOrder() {
  const router = useRouter()
  const { t, lang } = useI18n()
  const cart = useCart()
  const { flash } = useToast()
  const [busyId, setBusyId] = useState<number | null>(null)

  const repeat = useCallback(
    async (orderId: number, lines?: OrderItem[]) => {
      setBusyId(orderId)
      try {
        const items = lines ?? (await fetchOrder(orderId)).items
        const products: Product[] = await fetchProducts().catch(() => [])
        const failed: string[] = []
        let added = 0
        for (const it of items) {
          const name = itemName(it, products, lang, t)
          try {
            await addOrderItemToCart(it)
            cart.add({
              productId: it.product_id,
              name,
              image: null,
              unitPrice: it.unit_price,
              quantity: it.quantity,
              designJson: it.design_json,
              meta: summarizeDesign(it.design_json, t),
              logoKey: it.logo_key,
              mockupKeys: { front: it.front_mockup_key, back: it.back_mockup_key },
            })
            added++
          } catch {
            failed.push(name)
          }
        }
        if (failed.length) flash(t('orders.repeatFail', { names: failed.join(', ') }))
        if (added) router.push('/cart')
      } catch (e) {
        flash((e as Error).message)
      } finally {
        setBusyId(null)
      }
    },
    [cart, flash, lang, router, t],
  )

  return { repeat, busyId }
}
