// Weekly AI batch of Instagram draft posts (LOOM-272, PRD-213 R-8).
//
// Once a week (cron IG_DRAFTER_CRON) the Worker writes a few draft posts for
// the next 7 days from the real catalogue. Drafts only: this file never writes
// approved, approved_by or publishing — every post still needs a human
// approval in admin (R-1). Prices and links come from D1, never from the model.

import { insertAiUsage, listIgPostInsights } from '../db/queries'
import { DAILY_NEURON_CAP, utcDayStart } from './ai-models'
import { captionError, composeCaption } from './instagram'
import { publishTimes, reachPosts } from './instagram-times'
import { escapeHtml, sendTelegramMessage } from './telegram'
import type { AiBinding, Bindings } from '../types'

/** Monday 06:00 Asia/Tashkent = Monday 01:00 UTC. Also listed in wrangler.toml [triggers]. */
export const IG_DRAFTER_CRON = '0 1 * * 1'

/** Workers AI instruct model on the existing AI binding (PRD-213 Q-4: no new vendor). */
export const IG_DRAFTER_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
// ponytail: fixed upper-bound estimate per call (≈2k input + 900 output tokens),
// not a measurement; replace with the usage the response reports if it drifts.
export const IG_DRAFTER_EST_NEURONS = 300
/** Drafter's own daily neuron cap; ig_settings.ai_neuron_cap overrides it. */
export const IG_DRAFTER_DAILY_NEURONS = 2_000
/** Drafts per batch; ig_settings.ai_batch_size overrides it (1..7, one per day at most). */
export const IG_DRAFTER_BATCH_SIZE = 5

/**
 * Brand and caption rules — the one place to edit them.
 * Provisional defaults from PRD-213 and the LOOM-266 decisions (comment 10519);
 * replace with the rules recorded on LOOM-267 once Phase 0 ends.
 */
export const IG_CAPTION_RULES = {
  brand: 'LOOM (loomdesign.uz) — a Tashkent print-on-demand studio: you design your own print and LOOM prints it on clothing.',
  tone: [
    'Short, warm, confident; 2 to 4 sentences per language; at most 2 emoji.',
    'Uzbek in Latin script. Russian always addresses the reader informally with "ты", never "вы".',
    'Never write a price, a number, a discount, a date, a link or a hashtag: the price line, link and hashtags are added after your text.',
    'Never invent product features, materials, sizes, colours or delivery promises.',
  ],
  price: { uz: "Narxi: {price} so'm", ru: 'Цена: {price} сум', en: 'Price: {price} UZS' },
  cta: { uz: "O'z dizayningni yarat: {link}", ru: 'Создай свой дизайн: {link}', en: 'Design yours: {link}' },
  // At most 30 per post (Instagram); appended once, to the English caption.
  hashtags: ['#loom', '#loomdesign', '#loomuz', '#tashkent', '#uzbekistan', '#streetwear', '#customprint'],
}

const SITE = 'https://loomdesign.uz'
const TASHKENT_MS = 5 * 3_600_000
const DAY_MS = 86_400_000
const RUN_PREFIX = 'ig-drafter-'

type Env = Pick<Bindings, 'DB' | 'AI' | 'TELEGRAM_BOT_TOKEN' | 'TELEGRAM_CHAT_ID'>

export interface DrafterDeps {
  ai: AiBinding | undefined
  now: () => number
  /** One HTML message to the admin Telegram chat. */
  notify: (html: string) => Promise<unknown>
}

export interface CatalogueProduct {
  slug: string
  name_ru: string
  name_en: string | null
  price: number
}

export type AiBatchStatus = 'running' | 'done' | 'stopped_budget' | 'failed'

/** Shown by the admin screen (GET /api/admin/instagram/settings → ai_batch.message). */
export const AI_BATCH_MESSAGES: Record<AiBatchStatus, string> = {
  running: 'AI batch running',
  done: 'AI batch done',
  stopped_budget: 'AI batch stopped: budget',
  failed: 'AI batch failed',
}

/** Monday (Tashkent calendar) of the week `now` falls in, as YYYY-MM-DD: one batch per key. */
export function weekKey(now: number): string {
  const local = new Date(now + TASHKENT_MS)
  const back = (local.getUTCDay() + 6) % 7
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - back)).toISOString().slice(0, 10)
}

const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '')
const formatUzs = (price: number) => String(Math.round(price)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

export function productLink(p: CatalogueProduct): string {
  return `${SITE}/configurator?slug=${encodeURIComponent(p.slug)}`
}

export function buildPrompt(p: CatalogueProduct): { role: string; content: string }[] {
  const rules = IG_CAPTION_RULES
  return [
    {
      role: 'system',
      content: [
        `You write Instagram captions for ${rules.brand}`,
        ...rules.tone.map((r) => `- ${r}`),
        'Reply with JSON only: {"uz": "...", "ru": "...", "en": "..."} — the same message in Uzbek, Russian and English.',
      ].join('\n'),
    },
    { role: 'user', content: `Product: ${p.name_en || p.name_ru} (Russian name: ${p.name_ru}). Write one post that invites people to design their own print for it.` },
  ]
}

// A number written like a price: 4+ digits, optionally grouped by space, dot or comma.
const PRICE_LIKE = /\d[\d  .,]{2,}\d/g
const RU_FORMAL = /(?:^|[^\p{L}])(?:вы|вас|вам|вами|ваш\p{L}*)(?![\p{L}])/iu

/**
 * Model output → the three captions, or why it is unusable. The facts (price,
 * link) and hashtags are appended here from D1 and IG_CAPTION_RULES.
 */
export function captionsFromOutput(output: unknown, p: CatalogueProduct): { caption_uz: string; caption_ru: string; caption_en: string } | string {
  let data: unknown = output
  if (typeof output === 'string') {
    const json = output.match(/\{[\s\S]*\}/)?.[0]
    try {
      data = json ? JSON.parse(json) : null
    } catch {
      data = null
    }
  }
  const text = data as Record<string, unknown> | null
  const pick = (k: string) => (typeof text?.[k] === 'string' ? (text[k] as string).trim() : '')
  const body = { uz: pick('uz'), ru: pick('ru'), en: pick('en') }
  if (!body.uz || !body.ru || !body.en) return 'model reply is not {uz, ru, en} JSON'
  for (const t of Object.values(body)) {
    for (const n of t.match(PRICE_LIKE) ?? []) {
      if (Number(n.replace(/\D/g, '')) !== p.price) return `model wrote a number not in the catalogue: ${n}`
    }
  }
  if (RU_FORMAL.test(body.ru)) return 'Russian text uses "вы" instead of "ты"'
  const rules = IG_CAPTION_RULES
  const facts = { price: formatUzs(p.price), link: productLink(p) }
  const caption = (l: 'uz' | 'ru' | 'en') => `${body[l]}\n\n${fill(rules.price[l], facts)}\n${fill(rules.cta[l], facts)}`
  const captions = { caption_uz: caption('uz'), caption_ru: caption('ru'), caption_en: `${caption('en')}\n\n${rules.hashtags.join(' ')}` }
  return captionError(composeCaption({ ...captions, langs: 'uz,ru,en' })) ?? captions
}

const setting = async (db: D1Database, key: string) =>
  (await db.prepare('SELECT value FROM ig_settings WHERE key = ?').bind(key).first<{ value: string }>())?.value

function intSetting(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(value)
  return value !== undefined && Number.isInteger(n) && n >= min && n <= max ? n : fallback
}

async function writeBatch(db: D1Database, value: Record<string, unknown>, now: string, claim = false): Promise<boolean> {
  // Claim: only the first run of a week gets the row (AC-5); a parallel or later run sees 0 changes.
  const result = await db.prepare(`INSERT INTO ig_settings (key, value, updated_by, updated_at) VALUES ('ai_batch', ?, NULL, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = NULL, updated_at = excluded.updated_at
    ${claim ? "WHERE json_extract(ig_settings.value, '$.week') IS NOT json_extract(excluded.value, '$.week')" : ''}`)
    .bind(JSON.stringify(value), now).run()
  return result.meta.changes > 0
}

/** The cron entry point. Never throws; failures end up in ig_settings.ai_batch and Telegram. */
export async function draftWeeklyPosts(env: Env, overrides: Partial<DrafterDeps> = {}): Promise<void> {
  const deps: DrafterDeps = {
    ai: env.AI,
    now: Date.now,
    notify: async (html) => {
      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, html)
    },
    ...overrides,
  }
  const db = env.DB
  const start = deps.now()
  const week = weekKey(start)
  const iso = () => new Date(deps.now()).toISOString()
  const batch = { week, status: 'running' as AiBatchStatus, message: AI_BATCH_MESSAGES.running, created: 0, failed: 0 }

  try {
    if (!(await writeBatch(db, batch, iso(), true))) return

    const size = intSetting(await setting(db, 'ai_batch_size'), IG_DRAFTER_BATCH_SIZE, 1, 7)
    const cap = intSetting(await setting(db, 'ai_neuron_cap'), IG_DRAFTER_DAILY_NEURONS, 0, DAILY_NEURON_CAP)
    const products = (await db.prepare('SELECT slug, name_ru, name_en, price FROM products WHERE active = 1 ORDER BY display_order, id')
      .all<CatalogueProduct>()).results
    // LOOM-274: the same slots the admin screen suggests (defaults until insights exist).
    const times = publishTimes(reachPosts(await listIgPostInsights(db, new Date(start - 90 * DAY_MS).toISOString())), start, size)
    const offset = Math.floor(Date.parse(week) / (7 * DAY_MS)) * size // a different product mix each week
    const errors: string[] = []
    const dayStart = utcDayStart(start)
    const spent = async (own: boolean) => Number((await db.prepare(
      `SELECT COALESCE(SUM(est_neurons), 0) AS total FROM ai_usage WHERE created_at >= ?${own ? ' AND run_id LIKE ?' : ''}`)
      .bind(...(own ? [dayStart, `${RUN_PREFIX}%`] : [dayStart])).first<{ total: number }>())?.total ?? 0)

    if (!products.length) errors.push('no active products in the catalogue')
    for (let i = 0; products.length && i < size; i++) {
      if ((await spent(true)) + IG_DRAFTER_EST_NEURONS > cap || (await spent(false)) + IG_DRAFTER_EST_NEURONS > DAILY_NEURON_CAP) {
        batch.status = 'stopped_budget'
        break
      }
      const product = products[(offset + i) % products.length]
      const messages = buildPrompt(product)
      // Ledger first: a call that fails upstream can still have been billed.
      await insertAiUsage(db, { model: IG_DRAFTER_MODEL, est_neurons: IG_DRAFTER_EST_NEURONS, run_id: `${RUN_PREFIX}${week}-${i}`, prompt: messages[1].content })
      let result: ReturnType<typeof captionsFromOutput>
      try {
        if (!deps.ai) throw new Error('Workers AI binding is not configured')
        const reply = (await deps.ai.run(IG_DRAFTER_MODEL, { messages, max_tokens: 900, temperature: 0.7 })) as { response?: unknown }
        result = captionsFromOutput(reply?.response, product)
      } catch (err) {
        result = err instanceof Error ? err.message : String(err)
      }
      if (typeof result === 'string') {
        errors.push(`${product.slug}: ${result}`)
        batch.failed++
        continue
      }
      // One INSERT with all three captions: a failed post leaves no row (AC-6). Always a draft (R-1).
      const now = iso()
      await db.prepare(`INSERT INTO ig_posts (caption_uz, caption_ru, caption_en, langs, publish_at, status, source, created_at, updated_at)
        VALUES (?, ?, ?, 'uz,ru,en', ?, 'draft', 'ai', ?, ?)`)
        .bind(result.caption_uz, result.caption_ru, result.caption_en, times[i], now, now).run()
      batch.created++
    }
    if (batch.status === 'running') batch.status = batch.created || !errors.length ? 'done' : 'failed'
    batch.message = AI_BATCH_MESSAGES[batch.status]
    await writeBatch(db, batch, iso())
    if (errors.length) {
      await deps.notify(`⚠️ <b>Instagram AI batch ${week}</b>: ${batch.created} drafts, ${errors.length} failed.\n${escapeHtml(errors.slice(0, 5).join('\n').slice(0, 1500))}`)
    }
  } catch (err) {
    console.error('ig drafter:', err)
    await writeBatch(db, { ...batch, status: 'failed', message: AI_BATCH_MESSAGES.failed }, iso()).catch(() => {})
    await deps.notify(`⚠️ <b>Instagram AI batch ${week}</b> failed: ${escapeHtml(err instanceof Error ? err.message : String(err))}`).catch(() => {})
  }
}
