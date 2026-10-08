import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { api, uploadDataUrl } from '../api/client'
import type { Mockups } from '../lib/mockup-html'

// The backend cart (`/api/cart`) is account-bound and auth-only, but the design
// lets you build a garment and reach the cart before signing in. So the app
// keeps the cart locally and pushes it to the server at checkout, right after
// the Telegram sign-in that an order requires anyway.

export type CartItem = {
  /** Local id — the server assigns its own on sync. */
  id: string
  productId: number | null
  name: string
  /** Remote thumbnail URL, or a bundled asset for the fallback garment. */
  image: string | null
  unitPrice: number
  quantity: number
  designJson: string
  meta: string
  logoKey: string | null
  /** Front and back mockups (JPEG data URLs) drawn at add-to-cart, uploaded at sync. */
  mockups?: Mockups | null
  /** R2 keys of those mockups once uploaded, so a retried checkout reuses them. */
  mockupKeys?: Mockups | null
}

const KEY = 'loom_cart_v1'

type CartCtx = {
  items: CartItem[]
  ready: boolean
  count: number
  total: number
  add: (item: Omit<CartItem, 'id' | 'quantity'> & { quantity?: number }) => void
  setQty: (id: string, q: number) => void
  remove: (id: string) => void
  clear: () => void
  /** Pushes the local cart to the server; returns the server item count. */
  sync: () => Promise<number>
}

const Ctx = createContext<CartCtx | null>(null)

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (raw) setItems(JSON.parse(raw) as CartItem[])
      })
      .catch(() => {
        // A corrupt entry just starts an empty cart.
      })
      .finally(() => setReady(true))
  }, [])

  useEffect(() => {
    if (ready) AsyncStorage.setItem(KEY, JSON.stringify(items)).catch(() => {})
  }, [items, ready])

  const add: CartCtx['add'] = useCallback((item) => {
    setItems((prev) =>
      prev.concat([{ ...item, id: `c_${Date.now()}_${prev.length}`, quantity: item.quantity ?? 1 }]),
    )
  }, [])

  const setQty = useCallback((id: string, q: number) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, quantity: Math.max(1, Math.min(99, q)) } : i)),
    )
  }, [])

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id))
  }, [])

  const clear = useCallback(() => setItems([]), [])

  const sync = useCallback(async () => {
    // Replace the server cart wholesale — the local one is authoritative.
    await api('/api/cart', { method: 'DELETE', auth: true })
    const uploaded: Record<string, Mockups> = {}
    for (const it of items) {
      // Uploads need the session, which only exists from checkout on. A failed
      // one is not fatal: the order still goes through, the admin shows no mockup.
      const up = async (side: 'front' | 'back') => {
        const done = it.mockupKeys?.[side]
        const data = it.mockups?.[side]
        if (done || !data) return done ?? null
        return uploadDataUrl(data, `${side}-mockup.jpg`).catch(() => null)
      }
      const [front, back] = await Promise.all([up('front'), up('back')])
      uploaded[it.id] = { front, back }
      await api('/api/cart', {
        method: 'POST',
        auth: true,
        body: {
          productId: it.productId ?? undefined,
          designJson: it.designJson,
          unitPrice: it.unitPrice,
          quantity: it.quantity,
          logoKey: it.logoKey ?? undefined,
          frontMockupKey: front ?? undefined,
          backMockupKey: back ?? undefined,
        },
      })
    }
    setItems((prev) => prev.map((i) => (uploaded[i.id] ? { ...i, mockupKeys: uploaded[i.id] } : i)))
    return items.length
  }, [items])

  const count = items.reduce((a, i) => a + i.quantity, 0)
  const total = items.reduce((a, i) => a + i.unitPrice * i.quantity, 0)

  return (
    <Ctx.Provider value={{ items, ready, count, total, add, setQty, remove, clear, sync }}>
      {children}
    </Ctx.Provider>
  )
}

export function useCart(): CartCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useCart must be used inside <CartProvider>')
  return v
}
