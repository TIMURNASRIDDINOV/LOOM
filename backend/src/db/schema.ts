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
  created_at: number
  // Added in migration 0003
  telegram_user_id: number | null
  telegram_username: string | null
  first_name: string | null
  last_name: string | null
  role: string
  status: string
  last_login_at: number | null
  avatar_key: string | null
}

export interface AuthSession {
  id: string
  phone: string
  status: string   // pending|verified|failed|expired
  jwt: string | null
  user_id: number | null
  telegram_user_id: number | null
  created_at: number
  expires_at: number
}

export interface UserActivity {
  id: number
  user_id: number
  action: string
  metadata: string | null
  created_at: number
}

export interface NotificationSent {
  id: number
  user_id: number
  message: string
  button_label: string | null
  button_url: string | null
  telegram_message_id: number | null
  sent_at: number
  sent_by_admin_id: number | null
  status: string
  error_detail: string | null
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
