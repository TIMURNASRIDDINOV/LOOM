// Central environment types for Hono

export type Bindings = {
  DB: D1Database
  LOOM_MODELS: R2Bucket
  LOOM_UPLOADS: R2Bucket
  RATE_LIMIT: KVNamespace
  JWT_SECRET: string
  TELEGRAM_BOT_TOKEN: string
  TELEGRAM_CHAT_ID: string
  ENVIRONMENT: string
}

// Used by user-auth middleware and routes
export type UserEnv = {
  Bindings: Bindings
  Variables: { userId: number }
}

// Used by admin-auth middleware and routes
export type AdminEnv = {
  Bindings: Bindings
  Variables: { adminId: number }
}

// Base env — no Variables set (public routes, top-level app)
export type BaseEnv = {
  Bindings: Bindings
}
