// Central environment types for Hono

export type Bindings = {
  DB: D1Database
  LOOM_MODELS: R2Bucket
  LOOM_UPLOADS: R2Bucket
  RATE_LIMIT: KVNamespace
  JWT_SECRET: string
  TELEGRAM_BOT_TOKEN: string
  TELEGRAM_CHAT_ID: string
  TELEGRAM_WEBHOOK_SECRET: string
  BOT_USERNAME: string
  ENVIRONMENT: string
  // Payment providers (optional — checkout falls back to COD until set;
  // see lib/payments.ts for the wrangler secret names)
  PAYME_MERCHANT_ID?: string
  PAYME_KEY?: string
  CLICK_MERCHANT_ID?: string
  CLICK_SERVICE_ID?: string
  CLICK_SECRET?: string
  UZUM_MERCHANT_ID?: string
  UZUM_SECRET?: string
}

// Used by user-auth middleware and routes
export type UserEnv = {
  Bindings: Bindings
  Variables: { userId: number }
}

// Used by admin-auth middleware and routes
export type AdminEnv = {
  Bindings: Bindings
  Variables: { adminId: number; adminRole: string }
}

// Base env — no Variables set (public routes, top-level app)
export type BaseEnv = {
  Bindings: Bindings
}
