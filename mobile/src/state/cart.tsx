import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { ApiError, api, uploadDataUrl } from '../api/client'
import { fetchProducts } from '../api/catalog'
import type { Product } from '../api/types'
import { colorName, tStatic, useI18n, type Lang, type TFn } from '../i18n'
import { productConfig, swatchName } from '../lib/product-config'
import type { Mockups } from '../lib/mockup-html'
import { useAuth } from './auth'

// The cart has two homes. Signed in, `/api/cart` is the cart: the list and the
// total shown are what the server returned, and a quantity change or a removal
// is a PATCH or DELETE (prices and totals are the server's). Signed out there
// is no server cart to talk to, but the design lets you build a garment and
// reach the cart first, so the device keeps a local one in `pending`.
//
// `pending` also holds anything signed-in that has not reached the server yet:
// `add()` always lands there first (it carries the mockup data URLs, which can
// only be uploaded with a session) and is flushed to the server straight away,
// or later if the phone is offline. Checkout flushes before it posts.
//
// ponytail: a POST whose response is lost is retried, so a flaky link can add
// an item twice; an idempotency key on POST /api/cart would close that.

export type CartItem = {
  /** `c_…` for a pending item; the server's row id (as a string) once synced. */
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
  /** Front and back mockups (JPEG data URLs) drawn at add-to-cart, uploaded when the item is flushed. */
  mockups?: Mockups | null
  /** R2 keys of those mockups once uploaded, so a retried flush reuses them. */
  mockupKeys?: Mockups | null
}

type Row = {
  id: number
  product_id: number | null
  product_name_ru: string | null
  product_name_uz: string | null
  product_name_en: string | null
  design_json: string
  unit_price: number
  quantity: number
  logo_key: string | null
}
type Server = { items: Row[]; total: number }

const KEY = 'loom_cart_v1'
const EMPTY: Server = { items: [], total: 0 }
const isPending = (id: string) => id.startsWith('c_')

type CartCtx = {
  items: CartItem[]
  ready: boolean
  /** Signed in and the server cart is being read. */
  loading: boolean
  /** The last server read or flush failed — offline, say. Cleared by `reload`. */
  error: Error | null
  /** Set when an item was dropped because the server no longer sells it. */
  notice: string | null
  dismissNotice: () => void
  count: number
  /** The server's total, plus any item still waiting to be uploaded. */
  total: number
  add: (item: Omit<CartItem, 'id' | 'quantity'> & { quantity?: number }) => void
  /** Below 1 removes. Rejects when the server could not be reached. */
  setQty: (id: string, q: number) => Promise<void>
  remove: (id: string) => Promise<void>
  /** Empties the app's view of the cart (the server clears its own at checkout). */
  clear: () => void
  /** Uploads what is pending; returns how many items the server cart holds. Rejects while any could not be sent. */
  sync: () => Promise<number>
  /** Reads the server cart again (and flushes). */
  reload: () => Promise<void>
}

const Ctx = createContext<CartCtx | null>(null)

/** What the item's design says, in the interface language: colour · size · print. */
function describe(row: Row, product: Product | undefined, lang: Lang, t: TFn): string {
  let d: { shirtColor?: unknown; size?: unknown; plain?: unknown; front?: { elements?: unknown[] }; back?: { elements?: unknown[] } } = {}
  try {
    d = JSON.parse(row.design_json) as typeof d
  } catch {
    // an unreadable design just gets no description
  }
  const hex = typeof d.shirtColor === 'string' ? d.shirtColor : null
  const swatch = hex ? productConfig(product).colors.find((c) => c.hex === hex.toUpperCase()) : undefined
  const layers = (d.front?.elements?.length ?? 0) + (d.back?.elements?.length ?? 0)
  const print = d.plain
    ? t(product?.product_type === 'ready' ? 'catalog.readyDesign' : 'common.noPrint')
    : layers > 0
      ? t(layers === 1 ? 'home.layer1' : 'home.layerN', { n: layers })
      : null
  return [hex ? (swatch ? swatchName(swatch, lang, t) : colorName(hex, t)) : null, typeof d.size === 'string' ? d.size : null, print]
    .filter(Boolean)
    .join(' · ')
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { signedIn } = useAuth()
  const { t, lang } = useI18n()
  const [pending, setPending] = useState<CartItem[]>([])
  const [ready, setReady] = useState(false)
  const [server, setServerState] = useState<Server>(EMPTY)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Refs mirror the state the async paths read, so a flush that runs while the
  // user keeps adding never works from a stale closure.
  const pendingRef = useRef<CartItem[]>([])
  const serverRef = useRef<Server>(EMPTY)
  const signedInRef = useRef(false)
  const running = useRef<Promise<void> | null>(null)
  const again = useRef(false)

  const commit = useCallback((next: CartItem[]) => {
    pendingRef.current = next
    setPending(next)
  }, [])
  const setServer = useCallback((next: Server) => {
    serverRef.current = next
    setServerState(next)
  }, [])

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (raw) commit([...(JSON.parse(raw) as CartItem[]), ...pendingRef.current])
      })
      .catch(() => {
        // A corrupt entry just starts an empty cart.
      })
      .finally(() => setReady(true))
  }, [commit])

  useEffect(() => {
    if (ready) AsyncStorage.setItem(KEY, JSON.stringify(pending)).catch(() => {})
  }, [pending, ready])

  const load = useCallback(async () => {
    const [r, ps] = await Promise.all([
      api<Server>('/api/cart', { auth: true }),
      fetchProducts().catch(() => null),
    ])
    if (ps) setProducts(ps)
    setServer(r)
  }, [setServer])

  const push = useCallback(async (it: CartItem) => {
    // Mockups upload with the session. A failed one is not fatal: the order
    // still goes through, the admin shows no mockup.
    const up = async (side: 'front' | 'back') => {
      const done = it.mockupKeys?.[side]
      const data = it.mockups?.[side]
      if (done || !data) return done ?? null
      return uploadDataUrl(data, `${side}-mockup.jpg`).catch(() => null)
    }
    const [front, back] = await Promise.all([up('front'), up('back')])
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
  }, [])

  /** Sends every pending item, then reads the server cart. One run at a time; a call during a run queues another pass. */
  const flush = useCallback((): Promise<void> => {
    if (!signedInRef.current) return Promise.resolve()
    if (running.current) {
      again.current = true
      return running.current
    }
    const run = (async () => {
      setLoading(true)
      setError(null)
      try {
        do {
          again.current = false
          for (const it of [...pendingRef.current]) {
            try {
              await push(it)
            } catch (e) {
              // Offline, a server fault, a lapsed session or rate limit: keep it for the next flush.
              if (!(e instanceof ApiError) || [0, 401, 429].includes(e.status) || e.status >= 500) throw e
              // The server will not sell it (product, size or colour switched off): drop it, say so.
              setNotice(tStatic('cart.dropped', { name: it.name }))
            }
            commit(pendingRef.current.filter((x) => x.id !== it.id))
          }
          await load()
        } while (again.current)
      } catch (e) {
        setError(e as Error)
        throw e
      } finally {
        setLoading(false)
        running.current = null
      }
    })()
    running.current = run
    return run
  }, [commit, load, push])

  useEffect(() => {
    signedInRef.current = signedIn
    if (!ready) return
    if (signedIn) flush().catch(() => {})
    else {
      setServer(EMPTY)
      setError(null)
    }
  }, [signedIn, ready, flush, setServer])

  const add: CartCtx['add'] = useCallback(
    (item) => {
      commit(
        pendingRef.current.concat([
          { ...item, id: `c_${Date.now()}_${pendingRef.current.length}`, quantity: item.quantity ?? 1 },
        ]),
      )
      flush().catch(() => {})
    },
    [commit, flush],
  )

  const remove = useCallback(
    async (id: string) => {
      if (isPending(id)) {
        commit(pendingRef.current.filter((i) => i.id !== id))
        return
      }
      setServer(await api<Server>(`/api/cart/${id}`, { method: 'DELETE', auth: true }))
    },
    [commit, setServer],
  )

  const setQty = useCallback(
    async (id: string, q: number) => {
      if (q < 1) return remove(id)
      const quantity = Math.min(99, q)
      if (isPending(id)) {
        commit(pendingRef.current.map((i) => (i.id === id ? { ...i, quantity } : i)))
        return
      }
      setServer(await api<Server>(`/api/cart/${id}`, { method: 'PATCH', auth: true, body: { quantity } }))
    },
    [commit, remove, setServer],
  )

  const clear = useCallback(() => {
    commit([])
    setServer(EMPTY)
  }, [commit, setServer])

  const sync = useCallback(async () => {
    await flush()
    if (pendingRef.current.length) throw new ApiError(tStatic('common.offline'), 0)
    return serverRef.current.items.length
  }, [flush])

  const items = useMemo<CartItem[]>(() => {
    const synced = server.items.map((r) => {
      const p = products.find((x) => x.id === r.product_id)
      return {
        id: String(r.id),
        productId: r.product_id,
        name:
          (lang === 'uz' ? r.product_name_uz : lang === 'en' ? r.product_name_en : r.product_name_ru) ??
          r.product_name_ru ??
          t('st.defaultProduct'),
        image: p?.thumbnail_url ?? null,
        unitPrice: r.unit_price,
        quantity: r.quantity,
        designJson: r.design_json,
        meta: describe(r, p, lang, t),
        logoKey: r.logo_key,
      }
    })
    return [...synced, ...pending]
  }, [server, pending, products, lang, t])

  const count = items.reduce((a, i) => a + i.quantity, 0)
  const total = server.total + pending.reduce((a, i) => a + i.unitPrice * i.quantity, 0)
  const dismissNotice = useCallback(() => setNotice(null), [])

  return (
    <Ctx.Provider
      value={{ items, ready, loading, error, notice, dismissNotice, count, total, add, setQty, remove, clear, sync, reload: flush }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useCart(): CartCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useCart must be used inside <CartProvider>')
  return v
}
