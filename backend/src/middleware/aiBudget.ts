import { createMiddleware } from 'hono/factory'
import { sumAiNeuronsSince, sumAiUsdSince } from '../db/queries'
import {
  DAILY_NEURON_CAP,
  DAILY_USD_CAP,
  FREE_TIER_DAILY_NEURONS,
  MAX_RUN_NEURONS,
  MAX_RUN_USD,
  estimateRun,
  getModel,
  hasGoogleModel,
  nextUtcReset,
  utcDayStart,
} from '../lib/ai-models'
import type { AiEnv } from '../types'

// Validates a generate request and refuses it if dispatching would push either
// budget over its cap. Two currencies, two caps:
//   Workers AI → neurons, DAILY_NEURON_CAP (below the free tier)
//   Google     → dollars, DAILY_USD_CAP (real money, no free tier)
//
// Every check is BEFORE dispatch: neither provider refunds a call that discovers
// it is over budget halfway through. Google is additionally fail-closed — if the
// API key is unset, its models are refused rather than silently skipped.
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

  // Google models are real money — refuse them outright if no key is configured,
  // rather than dispatching and getting an opaque auth error per image.
  if (hasGoogleModel(modelIds) && !c.env.GEMINI_API_KEY) {
    return c.json(
      {
        error:
          'Google (Nano Banana) models need a Gemini API key, which is not configured. ' +
          'Set it with `wrangler secret put GEMINI_API_KEY`, or deselect the Google models.',
        code: 'google_key_missing',
      },
      400,
    )
  }

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

  const { neurons: estNeurons, usd: estUsd } = estimateRun(modelIds, requested)

  // ─── Per-run ceilings (request-intrinsic, checked before the daily gates) ────

  if (estNeurons > MAX_RUN_NEURONS) {
    return c.json(
      {
        error:
          `This run's estimated ${estNeurons.toLocaleString('en-US')} neurons exceeds the ` +
          `${MAX_RUN_NEURONS.toLocaleString('en-US')}-neuron per-run limit. ` +
          `Split it into smaller runs — deselect a model or lower the count.`,
        code: 'run_limit_exceeded',
        estNeurons,
        maxPerRun: MAX_RUN_NEURONS,
      },
      429,
    )
  }

  if (estUsd > MAX_RUN_USD) {
    return c.json(
      {
        error:
          `This run's estimated $${estUsd.toFixed(2)} exceeds the $${MAX_RUN_USD.toFixed(2)} ` +
          `per-run limit for paid (Google) models. Lower the count or deselect a Google model.`,
        code: 'run_usd_limit_exceeded',
        estUsd,
        maxPerRunUsd: MAX_RUN_USD,
      },
      429,
    )
  }

  // ─── Daily gates ──────────────────────────────────────────────────────────────

  const dayStart = utcDayStart()
  const usedNeuronsToday = await sumAiNeuronsSince(c.env.DB, dayStart)
  const remainingNeurons = DAILY_NEURON_CAP - usedNeuronsToday

  if (estNeurons > remainingNeurons) {
    return c.json(
      {
        error:
          `This run would spend an estimated ${estNeurons.toLocaleString('en-US')} neurons, ` +
          `but only ${Math.max(0, remainingNeurons).toLocaleString('en-US')} remain of today's ` +
          `${DAILY_NEURON_CAP.toLocaleString('en-US')} cap. ` +
          `Deselect a model, lower the count, or wait for the 00:00 UTC reset.`,
        code: 'neuron_budget_exceeded',
        estNeurons,
        usedToday: usedNeuronsToday,
        remaining: Math.max(0, remainingNeurons),
        cap: DAILY_NEURON_CAP,
        freeTier: FREE_TIER_DAILY_NEURONS,
        resetsAt: nextUtcReset(),
      },
      429,
    )
  }

  let usedUsdToday = 0
  if (estUsd > 0) {
    usedUsdToday = await sumAiUsdSince(c.env.DB, dayStart)
    const remainingUsd = DAILY_USD_CAP - usedUsdToday
    if (estUsd > remainingUsd) {
      return c.json(
        {
          error:
            `This run would spend an estimated $${estUsd.toFixed(2)} on Google models, ` +
            `but only $${Math.max(0, remainingUsd).toFixed(2)} remain of today's ` +
            `$${DAILY_USD_CAP.toFixed(2)} paid cap. ` +
            `Deselect a Google model, lower the count, or wait for the 00:00 UTC reset.`,
          code: 'usd_budget_exceeded',
          estUsd,
          usedUsdToday,
          remainingUsd: Math.max(0, remainingUsd),
          capUsd: DAILY_USD_CAP,
          resetsAt: nextUtcReset(),
        },
        429,
      )
    }
  }

  c.set('aiPlan', {
    prompt: prompt.trim(),
    models: modelIds,
    count: requested,
    seed: parsedSeed,
    estNeurons,
    estUsd,
    usedNeuronsToday,
    usedUsdToday,
  })

  await next()
})
