import { createMiddleware } from 'hono/factory'
import { sumAiNeuronsSince } from '../db/queries'
import {
  DAILY_NEURON_CAP,
  FREE_TIER_DAILY_NEURONS,
  MAX_RUN_NEURONS,
  estimateRunCost,
  getModel,
  nextUtcReset,
  utcDayStart,
} from '../lib/ai-models'
import type { AiEnv } from '../types'

// Validates a generate request and refuses it if dispatching would push the
// day's estimated neuron spend past DAILY_NEURON_CAP.
//
// The check is BEFORE dispatch, not after: Workers AI has no refund, so a run
// that discovers it is over budget halfway through has already spent the
// neurons. The cap sits below Cloudflare's 10,000/day free tier to absorb the
// gap between our estimates and their billing.
//
// Use AFTER requireAdmin:
//   ai.post('/generate', requireAdmin, aiBudget, handler)
export const aiBudget = createMiddleware<AiEnv>(async (c, next) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { prompt, models, count, seed } = body as Record<string, unknown>

  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return c.json({ error: 'prompt is required' }, 400)
  }
  if (prompt.length > 2000) {
    return c.json({ error: 'prompt must be ≤ 2000 characters' }, 400)
  }
  if (!Array.isArray(models) || models.length === 0) {
    return c.json({ error: 'models must be a non-empty array' }, 400)
  }

  const unknown = models.filter((m) => typeof m !== 'string' || !getModel(m))
  if (unknown.length > 0) {
    return c.json({ error: `Unknown model(s): ${unknown.join(', ')}`, code: 'unknown_model' }, 400)
  }
  const modelIds = models as string[]

  // count defaults to 2, then is clamped per model by its own maxCount — the
  // slow Leonardo models cap at 1 so the browser does not time out waiting.
  const rawCount = count === undefined ? 2 : Number(count)
  if (!Number.isInteger(rawCount) || rawCount < 1) {
    return c.json({ error: 'count must be a positive integer' }, 400)
  }
  const requested = Math.min(rawCount, 4)

  let parsedSeed: number | undefined
  if (seed !== undefined && seed !== null && seed !== '') {
    const s = Number(seed)
    if (!Number.isInteger(s) || s < 0) {
      return c.json({ error: 'seed must be a non-negative integer' }, 400)
    }
    parsedSeed = s
  }

  const estCost = estimateRunCost(modelIds, requested)

  // ─── Per-run ceiling ─────────────────────────────────────────────────────────
  // Request-intrinsic: this run is too big regardless of how much daily budget
  // is left, so it is checked before the time-dependent daily gate and its
  // message is about splitting the run, not waiting for the reset.

  if (estCost > MAX_RUN_NEURONS) {
    return c.json(
      {
        error:
          `This run's estimated ${estCost.toLocaleString('en-US')} neurons exceeds the ` +
          `${MAX_RUN_NEURONS.toLocaleString('en-US')}-neuron per-run limit. ` +
          `Split it into smaller runs — deselect a model or lower the count.`,
        code: 'run_limit_exceeded',
        estCost,
        maxPerRun: MAX_RUN_NEURONS,
      },
      429,
    )
  }

  // ─── The daily gate ───────────────────────────────────────────────────────────

  const dayStart = utcDayStart()
  const usedToday = await sumAiNeuronsSince(c.env.DB, dayStart)
  const remaining = DAILY_NEURON_CAP - usedToday

  if (estCost > remaining) {
    return c.json(
      {
        error:
          `This run would spend an estimated ${estCost.toLocaleString('en-US')} neurons, ` +
          `but only ${Math.max(0, remaining).toLocaleString('en-US')} remain of today's ` +
          `${DAILY_NEURON_CAP.toLocaleString('en-US')} cap. ` +
          `Deselect a model, lower the count, or wait for the 00:00 UTC reset.`,
        code: 'neuron_budget_exceeded',
        estCost,
        usedToday,
        remaining: Math.max(0, remaining),
        cap: DAILY_NEURON_CAP,
        freeTier: FREE_TIER_DAILY_NEURONS,
        resetsAt: nextUtcReset(),
      },
      429,
    )
  }

  c.set('aiPlan', {
    prompt: prompt.trim(),
    models: modelIds,
    count: requested,
    seed: parsedSeed,
    estCost,
    usedToday,
  })

  await next()
})
