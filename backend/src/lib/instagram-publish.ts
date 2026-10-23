// Instagram publishing cron (PRD-213 R-4, LOOM-271).
//
// Every 5 minutes: due approved posts go through Meta's Content Publishing
// flow: POST /<IG_USER_ID>/media → poll the container's status_code until
// FINISHED → POST /<IG_USER_ID>/media_publish → GET /<media>?fields=permalink.
//
// Safety rules:
// - publish_paused other than '0' (or no token) means no request to Meta at all.
// - Only status approved with approved_by set is taken, and each post is
//   claimed with a conditional UPDATE, so two runs never publish one post.
// - The token goes in the Authorization header, never in a URL, a log or an
//   error message.
// - A container id, once saved, is never re-created: a later run polls it
//   again, and a container Meta already published fails instead of posting twice.

import type { IgPost, IgPublishFields } from '../db/queries'
import { claimIgPost, getIgSetting, listDueIgPosts, pauseIgPublishing, settleIgPost } from '../db/queries'
import { composeCaption } from './instagram'
import { escapeHtml, sendTelegramMessage } from './telegram'
import type { Bindings } from '../types'

export const IG_GRAPH = 'https://graph.facebook.com/v23.0'
export const IG_MAX_PER_RUN = 5
export const IG_MAX_ATTEMPTS = 3
const RUN_BUDGET_MS = 60_000
const POLL_MS = 5_000
const CALL_TIMEOUT_MS = 10_000
// A post left in publishing longer than this belongs to no live run. Must stay above RUN_BUDGET_MS.
const LEASE_MS = 3 * 60_000

// Meta error codes that mean "try again later": unknown/temporary, throttling, rate limits.
const RETRY_CODES = new Set([1, 2, 4, 9, 17, 32, 341, 613, 80002])

type Env = Pick<Bindings, 'DB' | 'IG_ACCESS_TOKEN' | 'IG_USER_ID' | 'TELEGRAM_BOT_TOKEN' | 'TELEGRAM_CHAT_ID'>

export interface PublishDeps {
  fetch: typeof fetch
  now: () => number
  sleep: (ms: number) => Promise<void>
  /** One HTML message to the admin Telegram chat. */
  notify: (html: string) => Promise<unknown>
}

class GraphError extends Error {
  constructor(message: string, readonly kind: 'retry' | 'fail' | 'token') {
    super(message)
  }
}

type Json = Record<string, any>

export async function publishDuePosts(env: Env, overrides: Partial<PublishDeps> = {}): Promise<void> {
  const deps: PublishDeps = {
    fetch: (input, init) => fetch(input, init),
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    notify: async (html) => {
      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, html)
    },
    ...overrides,
  }
  const token = env.IG_ACCESS_TOKEN
  const user = env.IG_USER_ID
  // Kill switch (R-2): a missing row reads as paused, like the admin API.
  if ((await getIgSetting(env.DB, 'publish_paused'))?.value !== '0' || !token || !user) return

  const db = env.DB
  const start = deps.now()
  const iso = (ms = deps.now()) => new Date(ms).toISOString()

  async function graph(method: 'GET' | 'POST', path: string, params?: Record<string, string>): Promise<Json> {
    let res: Response
    try {
      res = await deps.fetch(`${IG_GRAPH}/${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}` },
        body: params ? new URLSearchParams(params) : undefined,
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      })
    } catch (err) {
      throw new GraphError(`Meta не ответил: ${err instanceof Error ? err.name : 'error'}`, 'retry')
    }
    const data = (await res.json().catch(() => null)) as Json | null
    const error = data?.error as Json | undefined
    if (res.ok && data && !error) return data
    const code = Number(error?.code)
    // Meta's text, minus anything that could carry the token.
    const text = String(error?.error_user_msg || error?.message || `HTTP ${res.status}`).split(token!).join('***').slice(0, 500)
    const message = Number.isNaN(code) ? text : `${text} (code ${code})`
    if (code === 190) throw new GraphError(message, 'token')
    if (res.status >= 500 || res.status === 429 || RETRY_CODES.has(code) || error?.is_transient === true) throw new GraphError(message, 'retry')
    throw new GraphError(message, 'fail')
  }

  async function tokenRejected(message: string) {
    if (await pauseIgPublishing(db, iso())) {
      await deps.notify(`⛔ Instagram: Meta отклонил токен, публикация поставлена на паузу. Обновите IG_ACCESS_TOKEN и включите публикацию в админке.\n${escapeHtml(message)}`)
    }
  }

  // R-4: posts wait for quota without spending an attempt.
  let left: number
  try {
    const limit = await graph('GET', `${user}/content_publishing_limit?fields=quota_usage,config`)
    const row = limit.data?.[0]
    left = Number(row?.config?.quota_total) - Number(row?.quota_usage)
    if (Number.isNaN(left)) left = IG_MAX_PER_RUN // Meta still enforces it; its refusal is a retry.
  } catch (err) {
    if (err instanceof GraphError && err.kind === 'token') await tokenRejected(err.message)
    else console.error('[instagram] publishing limit check failed')
    return
  }
  if (left <= 0) return

  const posts = await listDueIgPosts(db, iso(), iso(start - LEASE_MS), Math.min(IG_MAX_PER_RUN, left))
  for (const post of posts) {
    if (deps.now() - start > RUN_BUDGET_MS - POLL_MS) break
    if (!(await claimIgPost(db, post, iso()))) continue
    try {
      const done = await publishOne(post)
      console.log(`[instagram] post ${post.id}: ${done ? 'published' : 'container still processing'}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const kind = err instanceof GraphError ? err.kind : 'retry'
      if (kind === 'token') {
        // R-5: back to approved with attempts unchanged; nothing else runs until the owner switches publishing on.
        await settleIgPost(db, post.id, { status: 'approved', error: message }, iso())
        await tokenRejected(message)
        return
      }
      const attempts = post.attempts + 1
      const failed = kind === 'fail' || attempts >= IG_MAX_ATTEMPTS
      const fields: IgPublishFields = { status: failed ? 'failed' : 'approved', attempts, error: message }
      // R-5: exactly one message per post that becomes failed.
      if (await settleIgPost(db, post.id, fields, iso()) && failed) {
        await deps.notify(`⚠️ Instagram: пост #${post.id} не опубликован.\n${escapeHtml(message)}`)
      }
      console.error(`[instagram] post ${post.id}: ${failed ? 'failed' : 'will retry'}`)
    }
  }

  /** True when published; false when the container is still processing (polled again next run). */
  async function publishOne(post: IgPost): Promise<boolean> {
    let container = post.ig_container_id
    if (!container) {
      if (!post.media_url) throw new GraphError('У поста нет изображения.', 'fail')
      const created = await graph('POST', `${user}/media`, { image_url: post.media_url, caption: composeCaption(post) })
      container = String(created.id)
      await settleIgPost(db, post.id, { ig_container_id: container }, iso())
    }
    for (;;) {
      const state = await graph('GET', `${container}?fields=status_code,status`)
      if (state.status_code === 'FINISHED') break
      if (state.status_code === 'PUBLISHED') {
        throw new GraphError('Контейнер уже опубликован в Instagram — проверьте ленту, повторная публикация не выполнена.', 'fail')
      }
      if (state.status_code !== 'IN_PROGRESS') {
        throw new GraphError(`${state.status_code ?? 'UNKNOWN'}: ${state.status ?? 'Meta не приняла изображение.'}`, 'fail')
      }
      if (deps.now() + POLL_MS - start > RUN_BUDGET_MS) return false
      await deps.sleep(POLL_MS)
    }
    const media = String((await graph('POST', `${user}/media_publish`, { creation_id: container })).id)
    // The post is live now: a missing permalink must not turn it into a failure.
    const permalink = await graph('GET', `${media}?fields=permalink`).then((r) => (r.permalink ? String(r.permalink) : null), () => null)
    await settleIgPost(db, post.id, { status: 'published', ig_media_id: media, permalink, published_at: iso(), error: null }, iso())
    return true
  }
}
