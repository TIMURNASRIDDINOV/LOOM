// AI text-to-image model registry — the single source of truth for the admin
// model-comparison spike (routes/admin-ai.ts + middleware/aiBudget.ts).
//
// TWO PROVIDERS, TWO CURRENCIES:
//   'workers-ai' — Cloudflare Workers AI, billed in NEURONS (free tier
//                  10,000/day). estNeurons is the per-image estimate.
//   'google'     — Google Gemini image API ("Nano Banana"), billed in DOLLARS,
//                  no free tier. estUsd is the per-image estimate.
// A model uses exactly one currency; the other estimate is 0. The budget guard
// enforces a separate cap per currency.
//
// Estimates are deliberate upper bounds — over-counting keeps us inside budget,
// under-counting does not. The Workers AI numbers were validated against the
// published per-tile pricing (klein-4b = 26.05 × 4 tiles ≈ 104; klein-9b =
// 1363.64/MP ≈ 1364). flux-2-dev and the Google models are marked unverified —
// see `verified` below.
//
// ─── Input shapes are NOT uniform, and are NOT all documented ────────────────
// Verified against the live service:
//   flux-1-schnell   flat  { prompt, steps, seed }          → base64 JPEG
//   leonardo/*       flat  { prompt, width, height, ... }   → base64
//   flux-2-*         { multipart: { body: <stream>, contentType } } → base64 JPEG
// The FLUX.2 models reject every flat shape with "5006: required properties at
// '/' are 'multipart'". They want a literal multipart/form-data body.

export type Provider = 'workers-ai' | 'google'

export interface AiModel {
  /** Model id. For Workers AI, passed to env.AI.run(); for Google, the Gemini model path. */
  id: string
  /** Shown in the admin panel */
  label: string
  provider: Provider
  /** Estimated neurons for one image (Workers AI). 0 for Google models. */
  estNeurons: number
  /** Estimated USD for one image (Google). 0 for Workers AI models. */
  estUsd: number
  /** Family — used for grouping and UI labels */
  family: 'flux' | 'leonardo' | 'gemini'
  /** Whether the model accepts a `seed`/reproducibility input without erroring */
  supportsSeed: boolean
  /**
   * Whether `seed` ACTUALLY reproduces the same image — verified empirically.
   * true = byte-identical confirmed, false = confirmed ignored, null = untested.
   */
  seedDeterministic: boolean | null
  /**
   * Whether a real generation has been run and its output confirmed. The five
   * original Workers AI models are verified; flux-2-dev could not be run (free
   * tier was exhausted the day it was added) and the Google models cannot be
   * run without an API key. The UI badges unverified models so a reviewer knows
   * the cost/output is an estimate from docs, not a measurement.
   */
  verified: boolean
  /** Per-run image cap. Slow/expensive models cap low so the browser doesn't time out. */
  maxCount: number
  /** Build the Workers AI input payload. Unused for Google models (see lib/google-image.ts). */
  buildInput(prompt: string, seed?: number): Record<string, unknown>
}

/**
 * FLUX.2 wants a real multipart/form-data body, streamed, with an explicit
 * contentType alongside it. A fresh random boundary per call so a prompt
 * containing the boundary string cannot corrupt the body.
 */
function fluxMultipart(prompt: string, seed?: number): Record<string, unknown> {
  const boundary = `----loom${crypto.randomUUID().replace(/-/g, '')}`
  const field = (name: string, value: string) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`

  let body = field('prompt', prompt)
  if (seed !== undefined) body += field('seed', String(seed))
  body += `--${boundary}--\r\n`

  const bytes = new TextEncoder().encode(body)
  return {
    multipart: {
      body: new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(bytes)
          ctrl.close()
        },
      }),
      contentType: `multipart/form-data; boundary=${boundary}`,
    },
  }
}

export const AI_MODELS: readonly AiModel[] = [
  // ─── Workers AI (neurons, free tier) ──────────────────────────────────────
  {
    id: '@cf/black-forest-labs/flux-1-schnell',
    label: 'FLUX.1 [schnell]',
    provider: 'workers-ai',
    estNeurons: 58,
    estUsd: 0,
    family: 'flux',
    supportsSeed: true,
    seedDeterministic: false,  // verified: same seed → different image
    verified: true,
    maxCount: 4,
    // Distilled model: 4 steps is its design point; the estimate only holds there.
    buildInput: (prompt, seed) => ({ prompt, steps: 4, ...(seed !== undefined && { seed }) }),
  },
  {
    id: '@cf/black-forest-labs/flux-2-klein-4b',
    label: 'FLUX.2 klein 4B',
    provider: 'workers-ai',
    estNeurons: 104,
    estUsd: 0,
    family: 'flux',
    supportsSeed: true,
    seedDeterministic: false,  // verified: same seed → different image (byte hashes differ)
    verified: true,
    maxCount: 4,
    buildInput: fluxMultipart,
  },
  {
    id: '@cf/black-forest-labs/flux-2-klein-9b',
    label: 'FLUX.2 klein 9B',
    provider: 'workers-ai',
    estNeurons: 1364,
    estUsd: 0,
    family: 'flux',
    supportsSeed: true,
    seedDeterministic: null,  // untested; 4B in the same family ignores seed
    verified: true,
    maxCount: 2,
    buildInput: fluxMultipart,
  },
  {
    id: '@cf/black-forest-labs/flux-2-dev',
    label: 'FLUX.2 [dev]',
    provider: 'workers-ai',
    // ESTIMATE, NOT MEASURED: published price is 37.50 neurons/output-tile/step;
    // a 1024² image is 4 output tiles, so ~28 steps ≈ 4,200 neurons. The real
    // step count is the model's own default and could not be measured — the free
    // tier was exhausted the day this was added. Confirmed only that the input
    // contract is the same multipart body as the klein models (the flat shape
    // returned the 5006 schema error, the multipart shape reached the quota).
    // Deliberately set just under MAX_RUN_NEURONS so one image is allowed;
    // measure with a real run after the 00:00 UTC reset and correct.
    estNeurons: 4200,
    estUsd: 0,
    family: 'flux',
    supportsSeed: true,
    seedDeterministic: null,  // untested; every other FLUX model ignores seed
    verified: false,
    maxCount: 1,
    buildInput: fluxMultipart,
  },

  // ─── Leonardo on Workers AI (neurons, free tier) ──────────────────────────
  {
    id: '@cf/leonardo/lucid-origin',
    label: 'Leonardo Lucid Origin',
    provider: 'workers-ai',
    estNeurons: 2850,
    estUsd: 0,
    family: 'leonardo',
    supportsSeed: true,
    seedDeterministic: true,  // verified: same seed → byte-identical image
    verified: true,
    maxCount: 1,
    buildInput: (prompt, seed) => ({
      prompt, width: 1024, height: 1024, num_steps: 4, guidance: 4.5,
      ...(seed !== undefined && { seed }),
    }),
  },
  {
    id: '@cf/leonardo/phoenix-1.0',
    label: 'Leonardo Phoenix 1.0',
    provider: 'workers-ai',
    estNeurons: 2380,
    estUsd: 0,
    family: 'leonardo',
    supportsSeed: true,
    seedDeterministic: null,  // untested; lucid-origin in the same family honours seed
    verified: true,
    maxCount: 1,
    buildInput: (prompt, seed) => ({
      prompt, width: 1024, height: 1024, num_steps: 25, guidance: 2,
      ...(seed !== undefined && { seed }),
    }),
  },

  // ─── Google Gemini image ("Nano Banana") — PAID, no free tier ─────────────
  // UNVERIFIED: built from Google's REST docs, not a live run — there is no
  // API key to probe with. The request/response shape lives in lib/google-image.ts.
  // Requires env.GEMINI_API_KEY; the guard refuses these models if it is unset.
  {
    id: 'gemini-3-pro-image',
    label: 'Nano Banana Pro (Gemini 3 Pro Image)',
    provider: 'google',
    estNeurons: 0,
    estUsd: 0.134,  // ~$0.134 / image at 1K–2K (docs); $0.24 at 4K
    family: 'gemini',
    supportsSeed: false,  // Gemini image gen has no seed parameter
    seedDeterministic: null,
    verified: false,
    maxCount: 1,
    buildInput: (prompt) => ({ prompt }),
  },
  {
    id: 'gemini-3.1-flash-image',
    label: 'Nano Banana 2 (Gemini 3.1 Flash Image)',
    provider: 'google',
    estNeurons: 0,
    estUsd: 0.05,  // ~$0.05 / image at 2K (docs) — half the Pro price
    family: 'gemini',
    supportsSeed: false,
    seedDeterministic: null,
    verified: false,
    maxCount: 1,
    buildInput: (prompt) => ({ prompt }),
  },
] as const

// ─── Workers AI neuron budget ────────────────────────────────────────────────

/** Cloudflare's free allowance. Shown in the UI for context — never the gate. */
export const FREE_TIER_DAILY_NEURONS = 10_000

/**
 * The neuron gate the budget middleware enforces. Below the free tier so that
 * estimate drift (ours are estimates, Cloudflare's are not) cannot push a run
 * over the real limit. Once on the Workers Paid plan this becomes the actual
 * spend limit, not just a free-tier guard — set it deliberately.
 */
export const DAILY_NEURON_CAP = 9_000

/** Largest estimated neuron spend a single generate request may cost. */
export const MAX_RUN_NEURONS = 4_500

// ─── Google USD budget ───────────────────────────────────────────────────────
// Google image models have NO free tier — every image is real money. These caps
// are the ONLY thing between a run and a bill, so they default deliberately low.

/** Max estimated USD the Google models may spend per UTC day. */
export const DAILY_USD_CAP = 1.0

/** Max estimated USD a single generate request may cost via Google. */
export const MAX_RUN_USD = 0.5

export const MODEL_IDS: readonly string[] = AI_MODELS.map((m) => m.id)

export function getModel(id: string): AiModel | null {
  return AI_MODELS.find((m) => m.id === id) ?? null
}

/**
 * Estimated cost of `count` images from each of `modelIds`, split by currency.
 * Each model's per-run cap clamps its own count.
 */
export function estimateRun(modelIds: string[], count: number): { neurons: number; usd: number } {
  let neurons = 0
  let usd = 0
  for (const id of modelIds) {
    const m = getModel(id)
    if (!m) continue
    const n = Math.min(count, m.maxCount)
    neurons += m.estNeurons * n
    usd += m.estUsd * n
  }
  return { neurons, usd }
}

/** True if any of the given model ids is a paid Google model. */
export function hasGoogleModel(modelIds: string[]): boolean {
  return modelIds.some((id) => getModel(id)?.provider === 'google')
}

/** Epoch ms of 00:00 UTC today — the lower bound of the daily usage sum. */
export function utcDayStart(now: number = Date.now()): number {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** Epoch ms of the next 00:00 UTC reset — surfaced to the admin page. */
export function nextUtcReset(now: number = Date.now()): number {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
}

/** Registry shape safe to send to the browser (no functions). */
export function publicRegistry() {
  return AI_MODELS.map(
    ({ id, label, provider, estNeurons, estUsd, family, supportsSeed, seedDeterministic, verified, maxCount }) => ({
      id, label, provider, estNeurons, estUsd, family, supportsSeed, seedDeterministic, verified, maxCount,
    }),
  )
}
