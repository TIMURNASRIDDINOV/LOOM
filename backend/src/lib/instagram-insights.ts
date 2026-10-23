// Weekly Instagram insights pull (PRD-213 R-9, LOOM-273).
//
// Read-only: it runs while publishing is paused, and never writes to Meta.
// Per-media lifetime metrics for every post this system published in the
// last 90 days, plus daily account metrics for the last 7 days, upserted into
// ig_insights. Meta answers missing data with an empty set: that is no row,
// never 0. A token error (code 190) stops the pull with one Telegram message.

import { listPublishedIgMediaIds, upsertIgInsights, type IgInsight } from '../db/queries'
import { GraphError, graphClient, type PublishDeps } from './instagram-publish'
import { escapeHtml, sendTelegramMessage } from './telegram'
import type { Bindings } from '../types'

// Metric names checked against the Graph API reference for the pinned v23.0
// (IG_GRAPH). Media: FEED image metrics; `impressions` is gone for media made
// after 2024-07-02. Account: the metrics that still return a daily time series
// (`follower_count` is hidden below 100 followers; that request is skipped).
export const IG_MEDIA_METRICS = ['reach', 'views', 'likes', 'comments', 'shares', 'saved', 'total_interactions'] as const
export const IG_ACCOUNT_METRICS = ['reach', 'follower_count'] as const

const DAY_MS = 86_400_000

type Env = Pick<Bindings, 'DB' | 'IG_ACCESS_TOKEN' | 'IG_USER_ID' | 'TELEGRAM_BOT_TOKEN' | 'TELEGRAM_CHAT_ID'>

export async function pullInsights(env: Env, overrides: Partial<Pick<PublishDeps, 'fetch' | 'now' | 'notify'>> = {}): Promise<void> {
  const deps = {
    fetch: ((input, init) => fetch(input, init)) as typeof fetch,
    now: Date.now,
    notify: async (html: string) => {
      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, html)
    },
    ...overrides,
  }
  const user = env.IG_USER_ID
  if (!env.IG_ACCESS_TOKEN || !user) return
  const graph = graphClient(env.IG_ACCESS_TOKEN, deps.fetch)
  const now = deps.now()
  const fetchedAt = new Date(now).toISOString()

  const jobs: { scope: IgInsight['scope']; media: string | null; path: string }[] = []
  for (const media of await listPublishedIgMediaIds(env.DB, new Date(now - 90 * DAY_MS).toISOString())) {
    jobs.push({ scope: 'media', media, path: `${media}/insights?metric=${IG_MEDIA_METRICS.join(',')}` })
  }
  const since = Math.floor((now - 7 * DAY_MS) / 1000)
  const until = Math.floor(now / 1000)
  // One request per account metric: a metric Meta hides must not take the other with it.
  for (const metric of IG_ACCOUNT_METRICS) {
    jobs.push({ scope: 'account', media: null, path: `${user}/insights?metric=${metric}&period=day&since=${since}&until=${until}` })
  }

  let stored = 0
  for (const job of jobs) {
    let body: Record<string, any>
    try {
      body = await graph('GET', job.path)
    } catch (err) {
      if (err instanceof GraphError && err.kind === 'token') {
        await deps.notify(`⛔ Instagram: Meta отклонил токен, сбор статистики остановлен. Обновите IG_ACCESS_TOKEN.\n${escapeHtml(err.message)}`)
        return
      }
      // One post or metric Meta refuses is skipped; the next weekly run tries again.
      console.error(`[instagram] insights ${job.scope} ${job.media ?? ''} skipped: ${err instanceof Error ? err.message : 'error'}`)
      continue
    }
    const rows: IgInsight[] = []
    for (const item of Array.isArray(body.data) ? body.data : []) {
      for (const point of Array.isArray(item?.values) ? item.values : []) {
        if (typeof point?.value !== 'number' || !Number.isFinite(point.value)) continue
        rows.push({
          scope: job.scope,
          ig_media_id: job.media,
          metric: String(item.name),
          period: String(item.period ?? 'lifetime'),
          end_time: point.end_time ? String(point.end_time) : null,
          value: point.value,
        })
      }
    }
    await upsertIgInsights(env.DB, rows, fetchedAt)
    stored += rows.length
  }
  console.log(`[instagram] insights: ${stored} values from ${jobs.length} requests`)
}
