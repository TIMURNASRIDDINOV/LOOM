import { useCallback, useEffect, useState } from 'react'
import type { ImageSourcePropType } from 'react-native'
import { api } from './client'
import type { Artwork, MyArtwork, Order, Product } from './types'

// Product photography ships in the bundle so the catalog paints instantly and
// still reads correctly offline. A product's own `thumbnail_url` wins when the
// backend has one; otherwise the slug picks a bundled shot.
const BUNDLED: Record<string, ImageSourcePropType> = {
  tshirt: require('../../assets/products/tshirt_regular_white_001.jpg'),
  'tshirt-2': require('../../assets/products/tshirt_regular_white_002.jpg'),
  'tshirt-cropped': require('../../assets/products/tshirt_cropped_white_001.jpg'),
  'tshirt-muscle': require('../../assets/products/tshirt_muscle_white_001.jpg'),
  hoodie: require('../../assets/products/hoodie_regular_white_001.jpg'),
  'hoodie-2': require('../../assets/products/hoodie_regular_white_002.jpg'),
  'hoodie-zip': require('../../assets/products/hoodie_ziphoodie_white_001.jpg'),
  polo: require('../../assets/products/polo_regular_white_001.jpg'),
  sweatshirt: require('../../assets/products/sweatshirt_regular_white_001.jpg'),
  sweatpants: require('../../assets/products/sweatpants_regular_white_001.jpg'),
  cap: require('../../assets/products/cap_regular_white_001.jpg'),
}

export const GARMENT_FLAT = require('../../assets/garment/tshirt_flat_white_1200.png')

function bundledFor(slug: string): ImageSourcePropType {
  const s = slug.toLowerCase()
  if (s.includes('zip')) return BUNDLED['hoodie-zip']
  if (s.includes('hood') || s.includes('худи')) return BUNDLED.hoodie
  if (s.includes('polo') || s.includes('поло')) return BUNDLED.polo
  if (s.includes('sweatshirt') || s.includes('свитшот')) return BUNDLED.sweatshirt
  if (s.includes('sweatpants') || s.includes('брюки')) return BUNDLED.sweatpants
  if (s.includes('crop')) return BUNDLED['tshirt-cropped']
  if (s.includes('muscle')) return BUNDLED['tshirt-muscle']
  if (s.includes('cap') || s.includes('кепка')) return BUNDLED.cap
  return BUNDLED.tshirt
}

export function productImage(p: Pick<Product, 'slug' | 'thumbnail_url'>): ImageSourcePropType {
  return p.thumbnail_url ? { uri: p.thumbnail_url } : bundledFor(p.slug)
}

/** Small fetch-once hook — the app has no server-cache library and needs none. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await fn())
    } catch (e) {
      setError(e as Error)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    fn()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e as Error))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, error, loading, reload: run }
}

// Home, catalog, studio and the product page all need the catalog. Without a
// shared promise each mount fires its own request; one in-flight fetch plus a
// short TTL collapses them into a single call.
let cache: { at: number; products: Product[] } | null = null
let inFlight: Promise<Product[]> | null = null
const TTL_MS = 60_000

export function fetchProducts(force = false): Promise<Product[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.products)
  if (inFlight) return inFlight

  inFlight = api<{ products: Product[] }>('/api/products')
    .then((r) => {
      cache = { at: Date.now(), products: r.products }
      return r.products
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/** Drops the cache so the next fetch hits the network (pull-to-refresh). */
export function invalidateProducts() {
  cache = null
}

export function fetchMyOrders() {
  return api<{ orders: Order[] }>('/api/me/orders', { auth: true }).then((r) => r.orders)
}

// ─── Designer marketplace (migration 0017) ───────────────────────────────────

/** Approved artwork, as the marketplace lists it. */
export function fetchArtworks() {
  return api<{ items: Artwork[] }>('/api/artworks').then((r) => r.items)
}

/** The signed-in designer's own submissions, in every moderation state. */
export function fetchMyArtworks() {
  return api<{ items: MyArtwork[] }>('/api/designer/artworks', { auth: true }).then((r) => r.items)
}

export function submitArtwork(body: {
  title: string
  tags?: string | null
  image_key: string
  width?: number | null
  height?: number | null
  markup: number
}) {
  return api<{ id: number; status: string }>('/api/designer/artworks', {
    method: 'POST',
    auth: true,
    body,
  })
}
