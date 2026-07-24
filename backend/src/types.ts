// Central environment types for Hono

// Narrow structural types for the Workers AI + Images bindings. Declared here
// rather than leaning on the ambient `Ai` / `ImagesBinding` globals so a bump
// of @cloudflare/workers-types cannot break the build over surface we do not
// use. This is exactly the subset routes/admin-ai.ts and routes/ai-cutout.ts
// call, and it is what the live service was probed against.
export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>
}

export interface ImagesTransformer {
  transform(t: Record<string, unknown>): ImagesTransformer
  output(o: { format: string }): Promise<{ response(): Response }>
}

export interface LoomImagesBinding {
  input(stream: ReadableStream): ImagesTransformer
}

export type Bindings = {
  DB: D1Database
  LOOM_MODELS: R2Bucket
  LOOM_UPLOADS: R2Bucket
  RATE_LIMIT: KVNamespace
  // Workers AI + Images — admin-only design-generation spike (see routes/admin-ai.ts)
  AI: AiBinding
  IMAGES: LoomImagesBinding
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
  // Google Gemini image API ("Nano Banana") — optional. When unset, the paid
  // Google models are refused by the budget guard and disabled in the admin UI.
  // Set via: wrangler secret put GEMINI_API_KEY
  GEMINI_API_KEY?: string
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

// A generate request that has passed validation AND the neuron budget guard.
// Built by middleware/aiBudget.ts so the route handler never re-parses the body
// or re-derives the cost it was cleared for.
export type AiPlan = {
  prompt: string
  models: string[]
  count: number
  seed?: number
  // Split cost estimates the guard cleared this run for (neurons + paid USD).
  estNeurons: number
  estUsd: number
  usedNeuronsToday: number
  usedUsdToday: number
}

// Used by the admin AI spike routes (admin auth + a budget-checked plan)
export type AiEnv = {
  Bindings: Bindings
  Variables: { adminId: number; adminRole: string; aiPlan: AiPlan }
}
