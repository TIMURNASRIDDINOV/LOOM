// Central environment types for Hono

import type { Capability } from './lib/permissions'

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
  PAYME_LIVE?: string
  CLICK_MERCHANT_ID?: string
  CLICK_SERVICE_ID?: string
  CLICK_SECRET?: string
  UZUM_MERCHANT_ID?: string
  UZUM_SECRET?: string
  // Social sign-in (migration 0017). A provider is offered to the app only
  // once both of its values are set:
  //   wrangler secret put GOOGLE_CLIENT_SECRET   (etc.)
  // Google issues one client id per platform and a code is only redeemable by
  // the id that obtained it. Android/iOS are public clients with no secret.
  GOOGLE_CLIENT_ID_ANDROID?: string
  GOOGLE_CLIENT_ID_IOS?: string
  GOOGLE_CLIENT_ID_WEB?: string
  GOOGLE_CLIENT_SECRET?: string
  FACEBOOK_CLIENT_ID?: string
  FACEBOOK_CLIENT_SECRET?: string
  DISCORD_CLIENT_ID?: string
  DISCORD_CLIENT_SECRET?: string
  // Google Gemini image API ("Nano Banana") — optional. When unset, the paid
  // Google models are refused by the budget guard and disabled in the admin UI.
  // Set via: wrangler secret put GEMINI_API_KEY
  GEMINI_API_KEY?: string
  // Instagram publishing (PRD-213), Worker secrets only. The admin API reports
  // whether both are set, never their values; LOOM-271 is the only reader.
  IG_ACCESS_TOKEN?: string
  IG_USER_ID?: string
  // Instagram ads (PRD-213 Phase 3, LOOM-276), Worker secrets only. The ad
  // account id (with or without act_), a token with ads_management + ads_read
  // on it, and the Facebook Page linked to the Instagram account.
  META_AD_ACCOUNT_ID?: string
  META_ADS_ACCESS_TOKEN?: string
  META_PAGE_ID?: string
  // GA4 Data API readout for the admin Overview (lib/ga4.ts). Optional: when
  // unset, GET /api/admin/analytics/ga4 answers { configured: false }.
  //   wrangler secret put GA4_PROPERTY_ID           (numeric property id)
  //   wrangler secret put GA4_SA_KEY < key.json     (service-account JSON key)
  GA4_PROPERTY_ID?: string
  GA4_SA_KEY?: string
  // Clarity Data Export token for the daily snapshot cron (lib/clarity.ts).
  // Optional: when unset, the cron does nothing and
  // GET /api/admin/analytics/clarity answers { configured: false }.
  //   wrangler secret put CLARITY_API_TOKEN   (Clarity, Settings, Data Export)
  CLARITY_API_TOKEN?: string
}

// Used by user-auth middleware and routes
export type UserEnv = {
  Bindings: Bindings
  Variables: { userId: number }
}

// Used by admin-auth middleware and routes.
// adminCaps is the admin's effective capability set (role preset + per-admin
// overrides), resolved once per request by middleware/requireAdmin.ts.
export type AdminEnv = {
  Bindings: Bindings
  Variables: { adminId: number; adminRole: string; adminCaps: Set<Capability> }
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

// Used by the admin AI spike routes (admin auth + a budget-checked plan).
// Mirrors AdminEnv's Variables so requireAdmin/requireCap compose here too.
export type AiEnv = {
  Bindings: Bindings
  Variables: { adminId: number; adminRole: string; adminCaps: Set<Capability>; aiPlan: AiPlan }
}
