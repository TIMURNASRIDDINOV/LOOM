// TypeScript types mirroring the D1 schema

export const ORDER_STATUSES = [
  'new',
  'confirmed',
  'producing',
  'shipped',
  'delivered',
  'cancelled',
] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]

export interface Product {
  id: number
  slug: string
  name_ru: string
  name_en: string | null
  description_ru: string | null
  price: number
  glb_key: string | null
  thumbnail_key: string | null
  base_colors: string | null  // JSON: ["#FFFFFF","#1F2937"]
  active: number
  display_order: number
  created_at: number
  updated_at: number
}

export interface User {
  id: number
  email: string
  password_hash: string
  name: string | null
  phone: string | null
  avatar_key: string | null
  location_preset: string | null  // JSON: {address, lat, lng}
  created_at: number
}

export interface PageVisit {
  id: number
  session_id: string
  page: string
  device_type: string | null
  os: string | null
  browser: string | null
  referrer: string | null
  visited_at: number
}

export interface Admin {
  id: number
  email: string
  password_hash: string
  created_at: number
}

export interface Order {
  id: number
  user_id: number | null
  product_id: number | null
  customer_name: string
  customer_phone: string
  address: string | null
  coordinates: string | null
  comment: string | null
  design_json: string
  logo_key: string | null
  total_price: number
  status: OrderStatus
  created_at: number
  updated_at: number
}

export interface OrderStatusLog {
  id: number
  order_id: number
  old_status: string | null
  new_status: string
  changed_by: number | null
  changed_at: number
  note: string | null
}
