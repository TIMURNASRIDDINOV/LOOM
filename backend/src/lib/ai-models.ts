// Workers AI text-to-image model registry — the single source of truth for the
// admin model-comparison spike (routes/admin-ai.ts + middleware/aiBudget.ts).
//
// `estNeurons` is the ESTIMATED cost of ONE image, used by the budget guard to
// refuse a run BEFORE it is dispatched. Cloudflare bills the real number after
// the fact, so these are deliberately upper-bound estimates — over-counting
// keeps us inside the free tier, under-counting does not.
//
// Free tier: 10,000 neurons / day, resets at 00:00 UTC.
//
// ─── Input shapes are NOT uniform, and are NOT all documented ────────────────
// Verified empirically against the live service (wrangler dev --remote):
//   flux-1-schnell   flat  { prompt, steps, seed }          → base64 JPEG in .image
//   leonardo/*       flat  { prompt, width, height, ... }   → base64 in .image
//   flux-2-klein-*   { multipart: { body: <stream>, contentType } } → base64 JPEG
// The klein models publish no input schema and reject every flat shape with
// "5006: required properties at '/' are 'multipart'". They want a literal
// multipart/form-data body. See kleinMultipart() below.

export interface AiModel {
  /** Workers AI model id passed straight to env.AI.run() */
  id: string
  /** Shown in the admin panel */
  label: string
  /** Estimated neurons for one image at the size this registry requests */
  estNeurons: number
  /** Family — used for grouping and for the UI's cost warning */
  family: 'flux' | 'leonardo'
  /** Whether the model accepts a `seed` input without erroring (all current entries do) */
  supportsSeed: boolean
  /**
   * Whether `seed` ACTUALLY reproduces the same image — verified empirically,
   * because accepting the parameter and honouring it are different things.
   * true = byte-identical output confirmed, false = confirmed ignored,
   * null = not tested (each test costs real neurons).
   *
   * This is the difference between a comparable re-run and a coin flip, so the
   * admin page labels every model with it rather than implying seed works.
   */
  seedDeterministic: boolean | null
  /**
   * Per-run image cap. The Leonardo models take tens of seconds per image, so
   * the UI refuses to queue more than one — the browser gives up long before
   * the Worker does.
   */
  maxCount: number
  /** Build the model-specific input payload. All shape divergence lives here. */
  buildInput(prompt: string, seed?: number): Record<string, unknown>
}

/**
 * FLUX.2 klein wants a real multipart/form-data body, streamed, with an
 * explicit contentType alongside it. A fresh random boundary per call so a
 * prompt containing the boundary string cannot corrupt the body.
 */
function kleinMultipart(prompt: string, seed?: number): Record<string, unknown> {
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
  {
    id: '@cf/black-forest-labs/flux-1-schnell',
    label: 'FLUX.1 [schnell]',
    estNeurons: 58,
    family: 'flux',
    supportsSeed: true,
    seedDeterministic: false,  // verified: same seed → different image
    maxCount: 4,
    // schnell is a distilled model: 4 steps is its design point, and the
    // estimate above only holds there. steps:8 roughly doubles the real cost
    // (4 tiles × 4.80 + 8 × 9.60 = 96) without a matching quality gain.
    buildInput: (prompt, seed) => ({ prompt, steps: 4, ...(seed !== undefined && { seed }) }),
  },
  {
    id: '@cf/black-forest-labs/flux-2-klein-4b',
    label: 'FLUX.2 klein 4B',
    estNeurons: 104,
    family: 'flux',
    supportsSeed: true,
    seedDeterministic: false,  // verified: same seed → different image (byte hashes differ)
    maxCount: 4,
    // Only prompt + seed are sent: those are the fields verified to work.
    // width/height are unverified against the unpublished schema — adding them
    // risks a 5006 validation error on every klein call.
    buildInput: kleinMultipart,
  },
  {
    id: '@cf/black-forest-labs/flux-2-klein-9b',
    label: 'FLUX.2 klein 9B',
    estNeurons: 1364,
    family: 'flux',
    supportsSeed: true,
    seedDeterministic: null,  // untested; 4B in the same family ignores seed
    maxCount: 2,
    buildInput: kleinMultipart,
  },
  {
    id: '@cf/leonardo/lucid-origin',
    label: 'Leonardo Lucid Origin',
    estNeurons: 2850,
    family: 'leonardo',
    supportsSeed: true,
    seedDeterministic: true,  // verified: same seed → byte-identical image
    maxCount: 1,
    buildInput: (prompt, seed) => ({
      prompt, width: 1024, height: 1024, num_steps: 4, guidance: 4.5,
      ...(seed !== undefined && { seed }),
    }),
  },
  {
    id: '@cf/leonardo/phoenix-1.0',
    label: 'Leonardo Phoenix 1.0',
    estNeurons: 2380,
    family: 'leonardo',
    supportsSeed: true,
    seedDeterministic: null,  // untested; lucid-origin in the same family honours seed
    maxCount: 1,
    buildInput: (prompt, seed) => ({
      prompt, width: 1024, height: 1024, num_steps: 25, guidance: 2,
      ...(seed !== undefined && { seed }),
    }),
  },
] as const

/** Cloudflare's free allowance. Shown in the UI for context — never used as the gate. */
export const FREE_TIER_DAILY_NEURONS = 10_000

/**
 * The gate the budget middleware enforces. Deliberately below the free tier so
 * that estimate drift (our numbers are estimates, Cloudflare's are not) cannot
 * push a test run over the real limit.
 */
export const DAILY_NEURON_CAP = 9_000

/**
 * Per-run ceiling: the largest estimated spend a SINGLE generate request may
 * cost, independent of how much daily budget is left. A safety net against a
 * fat-fingered selection (every model at once) eating a big slice of the day in
 * one click. Half the daily cap, so no single run burns more than half a day —
 * still comfortably allows any one model, or the whole FLUX line-up, in one go.
 * Tune here; the guard, the API and the admin UI all read this one number.
 */
export const MAX_RUN_NEURONS = 4_500

export const MODEL_IDS: readonly string[] = AI_MODELS.map((m) => m.id)

export function getModel(id: string): AiModel | null {
  return AI_MODELS.find((m) => m.id === id) ?? null
}

/** Total estimated neurons for `count` images from each of `modelIds`. */
export function estimateRunCost(modelIds: string[], count: number): number {
  return modelIds.reduce(
    (sum, id) => {
      const m = getModel(id)
      if (!m) return sum
      return sum + m.estNeurons * Math.min(count, m.maxCount)
    },
    0,
  )
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
  return AI_MODELS.map(({ id, label, estNeurons, family, supportsSeed, seedDeterministic, maxCount }) => ({
    id, label, estNeurons, family, supportsSeed, seedDeterministic, maxCount,
  }))
}
