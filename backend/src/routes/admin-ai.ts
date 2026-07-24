import { Hono } from 'hono'
import { insertAiUsage, listAiRuns, sumAiNeuronsSince, sumAiUsdSince } from '../db/queries'
import { requireAdmin } from '../middleware/requireAdmin'
import { aiBudget } from '../middleware/aiBudget'
import { toImageBytes, type NormalisedImage } from '../lib/ai-image'
import { generateGeminiImage } from '../lib/google-image'
import {
  DAILY_NEURON_CAP,
  DAILY_USD_CAP,
  FREE_TIER_DAILY_NEURONS,
  MAX_RUN_NEURONS,
  MAX_RUN_USD,
  getModel,
  nextUtcReset,
  publicRegistry,
  utcDayStart,
  type AiModel,
} from '../lib/ai-models'
import type { AiEnv } from '../types'

// Admin-only harness for comparing text-to-image models on t-shirt artwork.
// A spike: the point is to decide which model LOOM ships with, so everything
// here is about making models comparable — same prompt, same grid — not about
// serving customers. Two providers: Workers AI (neurons, free) and Google
// Gemini (dollars, paid).

const ai = new Hono<AiEnv>()

/** Max concurrent generations. Above this, Workers AI queues anyway. */
const MAX_IN_FLIGHT = 3

/** Runs `fn` over `items` with at most `limit` in flight, preserving input order in `out`. */
async function pooled<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

function extForMime(mime: string): string {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  return 'png'
}

/**
 * Provider-agnostic single-image generation. Both providers land here as bytes,
 * so the R2 upload, ledger and cutout paths downstream do not branch.
 */
async function generateOne(
  c: { env: AiEnv['Bindings'] },
  model: AiModel,
  prompt: string,
  seed?: number,
): Promise<NormalisedImage> {
  if (model.provider === 'google') {
    // Guaranteed present: the budget guard refuses Google models without a key.
    const r = await generateGeminiImage(c.env.GEMINI_API_KEY!, model.id, prompt)
    return { bytes: r.bytes, mime: r.mime, ext: extForMime(r.mime), shape: 'gemini inlineData' }
  }
  const out = await c.env.AI.run(model.id, model.buildInput(prompt, seed))
  return toImageBytes(out)
}

// ─── GET /api/admin/ai/models ────────────────────────────────────────────────

ai.get('/ai/models', requireAdmin, (c) =>
  c.json({
    models: publicRegistry(),
    cap: DAILY_NEURON_CAP,
    freeTier: FREE_TIER_DAILY_NEURONS,
    maxPerRun: MAX_RUN_NEURONS,
    capUsd: DAILY_USD_CAP,
    maxPerRunUsd: MAX_RUN_USD,
    // Paid Google models are selectable only when the key is configured.
    googleEnabled: !!c.env.GEMINI_API_KEY,
  }),
)

// ─── GET /api/admin/ai/budget ────────────────────────────────────────────────

ai.get('/ai/budget', requireAdmin, async (c) => {
  const dayStart = utcDayStart()
  const [usedToday, usedUsdToday] = await Promise.all([
    sumAiNeuronsSince(c.env.DB, dayStart),
    sumAiUsdSince(c.env.DB, dayStart),
  ])
  return c.json({
    usedToday,
    cap: DAILY_NEURON_CAP,
    freeTier: FREE_TIER_DAILY_NEURONS,
    maxPerRun: MAX_RUN_NEURONS,
    remaining: Math.max(0, DAILY_NEURON_CAP - usedToday),
    usedUsdToday,
    capUsd: DAILY_USD_CAP,
    maxPerRunUsd: MAX_RUN_USD,
    remainingUsd: Math.max(0, DAILY_USD_CAP - usedUsdToday),
    googleEnabled: !!c.env.GEMINI_API_KEY,
    resetsAt: nextUtcReset(),
  })
})

// ─── GET /api/admin/ai/runs ──────────────────────────────────────────────────

ai.get('/ai/runs', requireAdmin, async (c) => {
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') ?? '20', 10) || 20))
  return c.json({ runs: await listAiRuns(c.env.DB, limit) })
})

// ─── POST /api/admin/ai/generate ─────────────────────────────────────────────
// Body: { prompt: string, models: string[], count?: number = 2, seed?: number }
//
// aiBudget has already validated the body and confirmed the run fits BOTH the
// neuron and USD caps, and that any Google model has a key — see aiBudget.ts.

ai.post('/ai/generate', requireAdmin, aiBudget, async (c) => {
  const plan = c.get('aiPlan')
  const runId = crypto.randomUUID()

  // Expand models × count into a flat job list, clamped by each model's maxCount.
  const jobs = plan.models.flatMap((id) => {
    const model = getModel(id)!
    const n = Math.min(plan.count, model.maxCount)
    return Array.from({ length: n }, (_, i) => ({ model, index: i }))
  })

  const results = await pooled(jobs, MAX_IN_FLIGHT, async ({ model, index }) => {
    const started = Date.now()
    const base = {
      model: model.id,
      label: model.label,
      provider: model.provider,
      index,
      estNeurons: model.estNeurons,
      estUsd: model.estUsd,
      seed: plan.seed ?? null,
    }

    // Ledger the (billable) attempt up front, with the right currency, so a
    // crash mid-generation still counts against budget. Rows are written for
    // failures too — an upstream error can still have been billed, and not
    // counting it is exactly how a run drifts past budget unnoticed.
    const ledger = () =>
      insertAiUsage(c.env.DB, {
        model: model.id,
        est_neurons: model.estNeurons,
        est_cost_usd: model.estUsd,
        provider: model.provider,
        run_id: runId,
        prompt: plan.prompt,
      }).catch(() => { /* ledger failure must not mask the model result */ })

    try {
      const img = await generateOne(c, model, plan.prompt, plan.seed)
      await ledger()

      const key = `ai-tests/${runId}/${model.id}/${index}.${img.ext}`
      await c.env.LOOM_UPLOADS.put(key, img.bytes, { httpMetadata: { contentType: img.mime } })

      return {
        ...base,
        ok: true as const,
        key,
        url: `/api/admin/media/${key}`,
        cutoutUrl: `/api/ai/cutout/${key}`,
        mime: img.mime,
        bytes: img.bytes.length,
        outputShape: img.shape,
        ms: Date.now() - started,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[ai/generate] ${model.id} #${index} failed:`, message)
      await ledger()
      return { ...base, ok: false as const, error: message, ms: Date.now() - started }
    }
  })

  const dayStart = utcDayStart()
  const [usedToday, usedUsdToday] = await Promise.all([
    sumAiNeuronsSince(c.env.DB, dayStart),
    sumAiUsdSince(c.env.DB, dayStart),
  ])

  return c.json({
    runId,
    prompt: plan.prompt,
    seed: plan.seed ?? null,
    count: plan.count,
    estNeurons: plan.estNeurons,
    estUsd: plan.estUsd,
    usedToday,
    remaining: Math.max(0, DAILY_NEURON_CAP - usedToday),
    cap: DAILY_NEURON_CAP,
    usedUsdToday,
    remainingUsd: Math.max(0, DAILY_USD_CAP - usedUsdToday),
    capUsd: DAILY_USD_CAP,
    resetsAt: nextUtcReset(),
    results,
  })
})

export default ai
