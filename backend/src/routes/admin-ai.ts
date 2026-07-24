import { Hono } from 'hono'
import { insertAiUsage, listAiRuns, sumAiNeuronsSince } from '../db/queries'
import { requireAdmin } from '../middleware/requireAdmin'
import { aiBudget } from '../middleware/aiBudget'
import { toImageBytes } from '../lib/ai-image'
import {
  DAILY_NEURON_CAP,
  FREE_TIER_DAILY_NEURONS,
  getModel,
  nextUtcReset,
  publicRegistry,
  utcDayStart,
} from '../lib/ai-models'
import type { AiEnv } from '../types'

// Admin-only harness for comparing Workers AI text-to-image models on t-shirt
// artwork. A spike: the point is to decide which model LOOM ships with, so
// everything here is about making models comparable — same prompt, same seed,
// same grid — not about serving customers.

const ai = new Hono<AiEnv>()

/** Max concurrent env.AI.run() calls. Above this, Workers AI starts queueing anyway. */
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

// ─── GET /api/admin/ai/models ────────────────────────────────────────────────
// The registry, minus the input-builder functions.

ai.get('/ai/models', requireAdmin, (c) =>
  c.json({ models: publicRegistry(), cap: DAILY_NEURON_CAP, freeTier: FREE_TIER_DAILY_NEURONS }),
)

// ─── GET /api/admin/ai/budget ────────────────────────────────────────────────

ai.get('/ai/budget', requireAdmin, async (c) => {
  const usedToday = await sumAiNeuronsSince(c.env.DB, utcDayStart())
  return c.json({
    usedToday,
    cap: DAILY_NEURON_CAP,
    freeTier: FREE_TIER_DAILY_NEURONS,
    remaining: Math.max(0, DAILY_NEURON_CAP - usedToday),
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
// aiBudget has already validated the body and confirmed the whole run fits in
// today's remaining neurons — see middleware/aiBudget.ts. It hands over a plan.

ai.post('/ai/generate', requireAdmin, aiBudget, async (c) => {
  const plan = c.get('aiPlan')
  const runId = crypto.randomUUID()

  // Expand models × count into a flat job list, clamped by each model's own
  // maxCount (the Leonardo models are slow enough that 2+ times out browsers).
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
      index,
      estNeurons: model.estNeurons,
      seed: plan.seed ?? null,
    }

    try {
      const raw = await model.buildInput(plan.prompt, plan.seed)
      const out = await c.env.AI.run(model.id, raw)

      // Ledger the spend as soon as the call returns. Rows are written for
      // failures too (see the catch) — a call that errors upstream can still
      // have burned neurons, and not counting it is how a run drifts past the
      // free tier unnoticed. Over-counting a pre-dispatch validation error is
      // the safe direction to be wrong in.
      await insertAiUsage(c.env.DB, {
        model: model.id,
        est_neurons: model.estNeurons,
        run_id: runId,
        prompt: plan.prompt,
      })

      const img = await toImageBytes(out)
      const key = `ai-tests/${runId}/${model.id}/${index}.${img.ext}`

      await c.env.LOOM_UPLOADS.put(key, img.bytes, {
        httpMetadata: { contentType: img.mime },
      })

      return {
        ...base,
        ok: true as const,
        key,
        // Reuses the existing admin media endpoint (admin.ts) — no new
        // public surface, no R2 custom domain needed.
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

      await insertAiUsage(c.env.DB, {
        model: model.id,
        est_neurons: model.estNeurons,
        run_id: runId,
        prompt: plan.prompt,
      }).catch(() => { /* ledger failure must not mask the model error */ })

      return { ...base, ok: false as const, error: message, ms: Date.now() - started }
    }
  })

  const usedToday = await sumAiNeuronsSince(c.env.DB, utcDayStart())

  return c.json({
    runId,
    prompt: plan.prompt,
    seed: plan.seed ?? null,
    count: plan.count,
    estCost: plan.estCost,
    usedToday,
    remaining: Math.max(0, DAILY_NEURON_CAP - usedToday),
    cap: DAILY_NEURON_CAP,
    resetsAt: nextUtcReset(),
    results,
  })
})

export default ai
