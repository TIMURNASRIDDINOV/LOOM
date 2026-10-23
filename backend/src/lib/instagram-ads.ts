// Instagram ads (PRD-213 R-11, R-12, LOOM-276).
//
// Promotes an already published post: campaign → ad set → ad in the Marketing
// API, every one created with status PAUSED. Tim switches them on in Ads
// Manager; nothing in this repo ever changes an ad's status.
//
// Money rules:
// - Every create goes through createPaused(), which sets status last, so no
//   caller can override it.
// - The monthly cap is checked here before any create (spend this month from
//   insights + budgets not yet ended + the new budget), and Meta's own account
//   spending limit (LOOM-275) backs it up. The cap can be lowered in admin,
//   never raised past ADS_CAP_MAX_USD.
// - The account must be in USD, so budgets and spend compare without conversion.
// - publish_paused other than '0' means no request to Meta at all.
// - The token goes in the Authorization header, never in a URL, a log or an error.

import {
  committedIgAdCents, getIgAd, getIgPost, getIgSetting, insertIgAd, listIgAds, updateIgAd,
} from '../db/queries'
import type { IgAd } from '../db/queries'
import { IG_GRAPH } from './instagram-publish'
import { escapeHtml, sendTelegramMessage } from './telegram'
import type { Bindings } from '../types'

/** Hard ceiling in USD. Raising it needs Tim's written decision (LOOM-276 §5). */
export const ADS_CAP_MAX_USD = 60
export const ADS_MAX_DAYS = 30
const CALL_TIMEOUT_MS = 10_000
const DAY_MS = 86_400_000

export type AdsEnv = Pick<Bindings, 'DB' | 'IG_USER_ID' | 'META_AD_ACCOUNT_ID' | 'META_ADS_ACCESS_TOKEN' | 'META_PAGE_ID' | 'TELEGRAM_BOT_TOKEN' | 'TELEGRAM_CHAT_ID'>

export interface AdsDeps {
  fetch: typeof fetch
  now: () => number
  notify: (html: string) => Promise<unknown>
}

export interface AdsTargeting {
  countries: string[]
  age_min: number
  age_max: number
  genders: number[]
  interests: { id: string; name: string }[]
}

/** A route answer: HTTP status and JSON body. */
export type AdsResult = { status: 200 | 201 | 400 | 404 | 409 | 422 | 423 | 502 | 503; body: Record<string, unknown> }

const fail = (status: AdsResult['status'], code: string, error: string, extra: Record<string, unknown> = {}): AdsResult =>
  ({ status, body: { error, code, ...extra } })

/** The cap in cents from the stored setting: never above ADS_CAP_MAX_USD; unreadable reads as 0 (nothing allowed). */
export function capCents(setting: string | null | undefined): number {
  const usd = Number(setting)
  return Number.isFinite(usd) && usd > 0 ? Math.round(Math.min(usd, ADS_CAP_MAX_USD) * 100) : 0
}

/** AC-3: true when the new budget would take this month past the cap. Reaching it exactly is allowed. */
export function overCap(spentCents: number, committedCents: number, newCents: number, cap: number): boolean {
  return spentCents + committedCents + newCents > cap
}

/** Stored or submitted targeting → a clean copy, or null when it is not valid. */
export function parseTargeting(value: unknown): AdsTargeting | null {
  let t = value
  if (typeof t === 'string') {
    try { t = JSON.parse(t) } catch { return null }
  }
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null
  const o = t as Record<string, unknown>
  const countries = o.countries
  if (!Array.isArray(countries) || !countries.length || countries.length > 25 || !countries.every((c) => typeof c === 'string' && /^[A-Z]{2}$/.test(c))) return null
  const ageMin = Number(o.age_min), ageMax = Number(o.age_max)
  if (!Number.isInteger(ageMin) || !Number.isInteger(ageMax) || ageMin < 18 || ageMax > 65 || ageMin > ageMax) return null
  const genders = o.genders ?? []
  if (!Array.isArray(genders) || !genders.every((g) => g === 1 || g === 2)) return null
  const interests = o.interests ?? []
  if (!Array.isArray(interests) || interests.length > 50) return null
  const clean: AdsTargeting['interests'] = []
  for (const i of interests) {
    if (!i || typeof i !== 'object' || !/^\d{1,30}$/.test(String(i.id)) || typeof i.name !== 'string' || i.name.length > 200) return null
    clean.push({ id: String(i.id), name: i.name })
  }
  return { countries: [...new Set(countries as string[])], age_min: ageMin, age_max: ageMax, genders: [...new Set(genders as number[])], interests: clean }
}

/** Meta's targeting spec for the ad set: Instagram placements only, our audience as given. */
export function targetingSpec(t: AdsTargeting): Record<string, unknown> {
  return {
    geo_locations: { countries: t.countries },
    age_min: t.age_min,
    age_max: t.age_max,
    ...(t.genders.length ? { genders: t.genders } : {}),
    ...(t.interests.length ? { flexible_spec: [{ interests: t.interests }] } : {}),
    publisher_platforms: ['instagram'],
    targeting_automation: { advantage_audience: 0 },
  }
}

export function adsConfigured(env: AdsEnv): boolean {
  return Boolean(env.META_AD_ACCOUNT_ID && env.META_ADS_ACCESS_TOKEN && env.META_PAGE_ID && env.IG_USER_ID)
}

const NOT_CONFIGURED = (): AdsResult =>
  fail(503, 'ig_ads_not_configured', 'Рекламный кабинет Meta не подключён: задайте META_AD_ACCOUNT_ID, META_ADS_ACCESS_TOKEN и META_PAGE_ID.')

class MetaError extends Error {}

type Json = Record<string, any>

function defaults(env: AdsEnv, overrides: Partial<AdsDeps>): AdsDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    now: Date.now,
    notify: async (html) => {
      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, html)
    },
    ...overrides,
  }
}

function client(env: AdsEnv, deps: AdsDeps) {
  const token = env.META_ADS_ACCESS_TOKEN!
  const account = `act_${env.META_AD_ACCOUNT_ID!.replace(/^act_/, '')}`

  async function call(method: 'GET' | 'POST', path: string, params?: Record<string, string>): Promise<Json> {
    let res: Response
    try {
      res = await deps.fetch(`${IG_GRAPH}/${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}` },
        body: params ? new URLSearchParams(params) : undefined,
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      })
    } catch (err) {
      throw new MetaError(`Meta не ответил: ${err instanceof Error ? err.name : 'error'}`)
    }
    const data = (await res.json().catch(() => null)) as Json | null
    const error = data?.error as Json | undefined
    if (res.ok && data && !error) return data
    // Meta's text, minus anything that could carry the token.
    const text = String(error?.error_user_msg || error?.message || `HTTP ${res.status}`).split(token).join('***').slice(0, 500)
    throw new MetaError(error?.code === undefined ? text : `${text} (code ${error.code})`)
  }

  /** The only way this module creates anything in Meta: status is set last, so it is always PAUSED. */
  const createPaused = (edge: 'campaigns' | 'adsets' | 'ads', params: Record<string, string>) =>
    call('POST', `${account}/${edge}`, { ...params, status: 'PAUSED' })

  /** Spend this month in cents (account time zone, as Meta counts it). */
  async function monthSpentCents(): Promise<number> {
    const r = await call('GET', `${account}/insights?fields=spend&date_preset=this_month`)
    const spent = Math.round(Number(r.data?.[0]?.spend ?? 0) * 100)
    if (!Number.isFinite(spent)) throw new MetaError('Meta вернул нечитаемую сумму расходов.')
    return spent
  }

  return { call, createPaused, monthSpentCents, account }
}

async function readCap(env: AdsEnv) {
  return capCents((await getIgSetting(env.DB, 'ads_monthly_cap_usd'))?.value)
}

// ─── POST /api/admin/instagram/ads ───────────────────────────────────────────

export async function createIgAd(env: AdsEnv, input: Record<string, unknown>, adminId: number, overrides: Partial<AdsDeps> = {}): Promise<AdsResult> {
  if (!adsConfigured(env)) return NOT_CONFIGURED()
  // AC-4: kill switch first, before any read from Meta. A missing row reads as paused.
  if ((await getIgSetting(env.DB, 'publish_paused'))?.value !== '0') {
    return fail(423, 'ig_ads_paused', 'Публикация на паузе: реклама не создаётся, пока её не включат в админке.')
  }
  const postId = Number(input.post_id)
  const budgetCents = Math.round(Number(input.budget_usd) * 100)
  const days = Number(input.days)
  if (!Number.isSafeInteger(postId) || postId <= 0) return fail(400, 'ig_ads_input', 'post_id — id опубликованного поста.')
  if (!Number.isSafeInteger(budgetCents) || budgetCents < 100) return fail(400, 'ig_ads_input', 'budget_usd — сумма в долларах, от 1.')
  if (!Number.isInteger(days) || days < 1 || days > ADS_MAX_DAYS) return fail(400, 'ig_ads_input', `days — целое число от 1 до ${ADS_MAX_DAYS}.`)

  const post = await getIgPost(env.DB, postId)
  if (!post) return fail(404, 'not_found', 'Пост не найден.')
  if (post.status !== 'published' || !post.ig_media_id) return fail(409, 'ig_ads_post_not_published', 'Рекламировать можно только опубликованный пост.')
  const targeting = parseTargeting((await getIgSetting(env.DB, 'ads_targeting'))?.value)
  if (!targeting) return fail(422, 'ig_ads_targeting', 'Настройки таргетинга не заданы или неверны.')

  const deps = defaults(env, overrides)
  const meta = client(env, deps)
  const now = deps.now()
  const iso = (ms: number) => new Date(ms).toISOString()

  // AC-3: the cap check reads Meta and refuses before any create.
  let spent: number
  try {
    const account = await meta.call('GET', `${meta.account}?fields=currency`)
    if (account.currency !== 'USD') {
      return fail(422, 'ig_ads_currency', `Валюта рекламного кабинета ${String(account.currency ?? '?')}, а лимит считается в USD. Создание отменено.`)
    }
    spent = await meta.monthSpentCents()
  } catch (err) {
    return fail(502, 'ig_ads_meta', err instanceof Error ? err.message : 'Meta error')
  }
  const cap = await readCap(env)
  const committed = await committedIgAdCents(env.DB, iso(now))
  if (overCap(spent, committed, budgetCents, cap)) {
    return fail(422, 'ig_ads_over_cap', `Бюджет превысит месячный лимит ${cap / 100} USD.`, {
      cap_usd: cap / 100, spent_usd: spent / 100, committed_usd: committed / 100, budget_usd: budgetCents / 100,
    })
  }

  // ponytail: two admins submitting in the same second can both pass the check;
  // Meta's account spending limit (LOOM-275) still holds. Add a D1 lock if more people get this capability.
  const endMs = now + days * DAY_MS
  const id = await insertIgAd(env.DB, { ig_post_id: postId, budget_usd_cents: budgetCents, start_at: iso(now), end_at: iso(endMs) }, adminId, iso(now))
  const name = `LOOM post #${postId} · ad #${id}`
  let step = 'campaign'
  try {
    const campaign = String((await meta.createPaused('campaigns', {
      name,
      objective: 'OUTCOME_AWARENESS',
      special_ad_categories: '[]',
      is_adset_budget_sharing_enabled: 'false',
    })).id)
    await updateIgAd(env.DB, id, { campaign_id: campaign })
    step = 'ad set'
    const adset = String((await meta.createPaused('adsets', {
      name,
      campaign_id: campaign,
      lifetime_budget: String(budgetCents),
      start_time: String(Math.floor(now / 1000)),
      end_time: String(Math.floor(endMs / 1000)),
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'REACH',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      targeting: JSON.stringify(targetingSpec(targeting)),
    })).id)
    await updateIgAd(env.DB, id, { adset_id: adset })
    step = 'ad'
    const ad = String((await meta.createPaused('ads', {
      name,
      adset_id: adset,
      // The existing Instagram post as the creative, inline so no extra object is created.
      creative: JSON.stringify({ object_id: env.META_PAGE_ID, instagram_user_id: env.IG_USER_ID, source_instagram_media_id: post.ig_media_id }),
    })).id)
    await updateIgAd(env.DB, id, { ad_id: ad, status_seen: 'PAUSED' })
  } catch (err) {
    const message = `${step}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 600)
    await updateIgAd(env.DB, id, { error: message })
    // AC-5: what was made stays paused; one message to the admin chat.
    await deps.notify(`⚠️ Instagram-реклама #${id} (пост #${postId}) создана не полностью. Всё созданное остаётся на паузе.\n${escapeHtml(message)}`).catch(() => {})
    return fail(502, 'ig_ads_meta', message, { ad: await getIgAd(env.DB, id) })
  }
  return { status: 201, body: { ad: await getIgAd(env.DB, id) } }
}

// ─── GET /api/admin/instagram/ads ────────────────────────────────────────────

export async function listIgAdsWithSpend(env: AdsEnv, overrides: Partial<AdsDeps> = {}): Promise<AdsResult> {
  if (!adsConfigured(env)) return NOT_CONFIGURED()
  const deps = defaults(env, overrides)
  const meta = client(env, deps)
  const rows = await listIgAds(env.DB)
  const cap = await readCap(env)
  const committed = await committedIgAdCents(env.DB, new Date(deps.now()).toISOString())
  const targeting = parseTargeting((await getIgSetting(env.DB, 'ads_targeting'))?.value)
  const spend = new Map<string, number>()
  let spent: number | null = null
  let metaError: string | null = null
  try {
    const ids = rows.map((r) => r.ad_id).filter(Boolean) as string[]
    if (ids.length) {
      const read = await meta.call('GET', `?ids=${ids.join(',')}&fields=effective_status,insights.date_preset(maximum){spend}`)
      for (const row of rows) {
        const seen = row.ad_id ? read[row.ad_id] : null
        if (!seen) continue
        spend.set(row.ad_id!, Math.round(Number(seen.insights?.data?.[0]?.spend ?? 0) * 100))
        if (seen.effective_status && seen.effective_status !== row.status_seen) {
          row.status_seen = String(seen.effective_status)
          await updateIgAd(env.DB, row.id, { status_seen: row.status_seen })
        }
      }
    }
    spent = await meta.monthSpentCents()
  } catch (err) {
    // Rows still show, with the last status seen; the page says Meta could not be read.
    metaError = err instanceof Error ? err.message : 'Meta error'
  }
  return {
    status: 200,
    body: {
      items: rows.map((r: IgAd) => ({ ...r, budget_usd: r.budget_usd_cents / 100, spend_usd: r.ad_id && spend.has(r.ad_id) ? spend.get(r.ad_id)! / 100 : null })),
      month: { spent_usd: spent === null ? null : spent / 100, committed_usd: committed / 100, cap_usd: cap / 100, cap_max_usd: ADS_CAP_MAX_USD },
      targeting,
      meta_error: metaError,
    },
  }
}
