// Mirrors `backend/src/db/schema.ts`. Kept hand-written rather than generated so
// the app only carries the fields it actually renders.

export type ProductType = 'custom' | 'ready'

export type Product = {
  id: number
  slug: string
  name_ru: string
  name_en: string | null
  description_ru: string | null
  price: number
  glb_url: string | null
  thumbnail_url: string | null
  base_colors: string | null // JSON: ["#FFFFFF","#1F2937"]
  product_type: ProductType
  active: number
  display_order: number
}

export type OrderStatus = 'new' | 'confirmed' | 'producing' | 'shipped' | 'delivered' | 'cancelled'

export type Order = {
  id: number
  product_id: number | null
  customer_name: string
  customer_phone: string
  address: string | null
  comment: string | null
  design_json: string
  total_price: number
  status: OrderStatus
  created_at: number
  updated_at: number
}

export type Me = {
  id: number
  email: string | null
  name: string | null
  phone: string | null
  avatar_url?: string | null
  telegram_user_id?: number | null
  telegram_username?: string | null
  first_name?: string | null
  last_name?: string | null
  location_preset?: string | null
  orders_count?: number
  total_spent?: number
  // Migration 0017 — designer opt-in
  is_designer?: number
  designer_handle?: string | null
  designer_bio?: string | null
}

/** A graphic published by a designer, as the marketplace serves it. */
export type Artwork = {
  id: number
  title: string
  tags: string | null
  markup: number
  width: number | null
  height: number | null
  image_url: string
  author: string
  created_at: number
}

/** The designer's own view, which also carries moderation state. */
export type MyArtwork = Artwork & {
  status: 'pending' | 'approved' | 'rejected'
  reject_note: string | null
}

export type TelegramStart = {
  session_id: string
  telegram_deep_link: string
  expires_at: number
}

export type TelegramStatus = {
  status: 'pending' | 'verified' | 'failed' | 'expired'
  token?: string
}
