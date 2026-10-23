import { Hono, type Context } from 'hono'
import { getIgPost, getIgSetting, insertIgPost, listIgPostInsights, listIgPosts, moveIgPost, setIgSetting, updateIgPostContent } from '../db/queries'
import type { IgPost, IgPostContent } from '../db/queries'
import {
  IG_ACTIONS,
  IG_EDITABLE,
  IG_ERRORS,
  IG_MEDIA_KEY,
  IG_STATUSES,
  approvalError,
  composeCaption,
  parseLangs,
} from '../lib/instagram'
import { IG_MEDIA_METRICS } from '../lib/instagram-insights'
import { suggestTimes } from '../lib/instagram-times'
import { sniffType } from '../lib/r2'
import { requireAdmin, requireCap } from '../middleware/requireAdmin'
import type { AdminEnv } from '../types'

// Instagram posts (PRD-213, LOOM-269): drafts, approval and the kill switch.
//
// Nothing here calls Meta. The publishing cron (LOOM-271) only takes posts in
// `approved` with approved_by set, and only while publish_paused is '0'.
// instagram.edit prepares posts; instagram.approve (owner-only by default)
// decides what goes out. The access token is never read here beyond "is it set".

const router = new Hono<AdminEnv>()

const MAX_MEDIA_BYTES = 8 * 1024 * 1024
// A single caption field above this can never be approved; refuse it early.
const MAX_CAPTION_INPUT = 5000

const nowIso = () => new Date().toISOString()

function serialize(post: IgPost) {
  return { ...post, langs: parseLangs(post.langs), caption: composeCaption(post) }
}

function parseId(raw: string): number | null {
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

async function readBody(c: Context<AdminEnv>): Promise<Record<string, unknown> | null> {
  const body = await c.req.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
}

type Checked = { value: IgPostContent } | { code: string; error: string }

// Body fields over `base` (the stored post, or an empty one). Fields left out keep their value.
async function readContent(c: Context<AdminEnv>, body: Record<string, unknown>, base: IgPostContent): Promise<Checked> {
  const value = { ...base }
  for (const field of ['caption_uz', 'caption_ru', 'caption_en'] as const) {
    if (!(field in body)) continue
    const text = body[field] ?? ''
    if (typeof text !== 'string' || text.length > MAX_CAPTION_INPUT) {
      return { code: 'ig_caption_input', error: `Подпись — строка до ${MAX_CAPTION_INPUT} символов.` }
    }
    value[field] = text
  }
  if ('langs' in body) {
    if (!Array.isArray(body.langs)) return { code: 'ig_langs', error: 'langs — массив из uz, ru, en.' }
    value.langs = parseLangs(body.langs).join(',')
  }
  if ('media_key' in body) {
    const key = body.media_key
    if (key === null) {
      value.media_key = null
      value.media_url = null
    } else if (typeof key !== 'string' || !IG_MEDIA_KEY.test(key) || !(await c.env.LOOM_UPLOADS.head(key))) {
      return { code: 'ig_media_key', error: 'Изображение не найдено. Загрузите его заново.' }
    } else {
      const { protocol, host } = new URL(c.req.url)
      value.media_key = key
      value.media_url = `${protocol}//${host}/api/files/${key}`
    }
  }
  if ('publish_at' in body) {
    const at = body.publish_at
    const ms = typeof at === 'string' ? Date.parse(at) : NaN
    if (at !== null && Number.isNaN(ms)) return { code: 'ig_publish_at', error: 'publish_at — дата ISO 8601 с часовым поясом.' }
    value.publish_at = at === null ? null : new Date(ms).toISOString()
  }
  return { value }
}

const EMPTY: IgPostContent = {
  caption_uz: '', caption_ru: '', caption_en: '', langs: 'uz,ru,en', media_key: null, media_url: null, publish_at: null,
}

// ─── GET /api/admin/instagram/posts?status= ──────────────────────────────────

router.get('/instagram/posts', requireAdmin, requireCap('instagram.edit'), async (c) => {
  const q = c.req.query('status')
  const status = q && (IG_STATUSES as readonly string[]).includes(q) ? q : null
  return c.json({ items: (await listIgPosts(c.env.DB, status)).map(serialize) })
})

// ─── POST /api/admin/instagram/posts  (always a draft) ───────────────────────

router.post('/instagram/posts', requireAdmin, requireCap('instagram.edit'), async (c) => {
  const body = await readBody(c)
  if (!body) return c.json({ error: 'Invalid JSON', code: 'invalid_json' }, 400)
  const checked = await readContent(c, body, EMPTY)
  if ('code' in checked) return c.json(checked, 400)
  const id = await insertIgPost(c.env.DB, checked.value, c.get('adminId'), nowIso())
  return c.json({ post: serialize((await getIgPost(c.env.DB, id))!) }, 201)
})

// ─── PATCH /api/admin/instagram/posts/:id ────────────────────────────────────
// Changing an approved post's content sends it back to draft (R-1).

router.patch('/instagram/posts/:id', requireAdmin, requireCap('instagram.edit'), async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.json({ error: 'Invalid id', code: 'invalid_id' }, 400)
  const body = await readBody(c)
  if (!body) return c.json({ error: 'Invalid JSON', code: 'invalid_json' }, 400)
  const post = await getIgPost(c.env.DB, id)
  if (!post) return c.json({ error: 'Not found', code: 'not_found' }, 404)
  const locked = { error: 'Пост уже публикуется или опубликован.', code: 'ig_locked' }
  if (!(IG_EDITABLE as readonly string[]).includes(post.status)) return c.json(locked, 409)
  const checked = await readContent(c, body, post)
  if ('code' in checked) return c.json(checked, 400)
  const changed = (Object.keys(EMPTY) as (keyof IgPostContent)[]).some((k) => checked.value[k] !== post[k])
  if (!(await updateIgPostContent(c.env.DB, id, checked.value, changed, IG_EDITABLE, nowIso()))) return c.json(locked, 409)
  return c.json({ post: serialize((await getIgPost(c.env.DB, id))!) })
})

// ─── POST /api/admin/instagram/posts/:id/{approve,retry,reject,draft} ────────

for (const [action, rule] of Object.entries(IG_ACTIONS)) {
  router.post(`/instagram/posts/:id/${action}`, requireAdmin, requireCap(rule.cap), async (c) => {
    const id = parseId(c.req.param('id'))
    if (!id) return c.json({ error: 'Invalid id', code: 'invalid_id' }, 400)
    const post = await getIgPost(c.env.DB, id)
    if (!post) return c.json({ error: 'Not found', code: 'not_found' }, 404)
    const wrong = { error: `Действие недоступно в статусе «${post.status}».`, code: 'ig_bad_status', status: post.status }
    if (!(rule.from as readonly string[]).includes(post.status)) return c.json(wrong, 409)
    if (action === 'approve') {
      const code = approvalError(post)
      if (code) return c.json({ error: IG_ERRORS[code], code }, 422)
    }
    // Approval is bound to the content that was just checked (updated_at).
    const moved = await moveIgPost(c.env.DB, id, rule.from, rule.to, c.get('adminId'), nowIso(), action === 'approve' ? post.updated_at : undefined)
    if (!moved) return c.json({ ...wrong, error: 'Пост изменился. Обновите страницу.' }, 409)
    return c.json({ post: serialize((await getIgPost(c.env.DB, id))!) })
  })
}

// ─── POST /api/admin/instagram/media  (multipart, field "file") ──────────────
// JPEG only: Instagram's content API takes nothing else for a single image.

router.post('/instagram/media', requireAdmin, requireCap('instagram.edit'), async (c) => {
  const form = await c.req.formData().catch(() => null)
  // File is a runtime global in Workers; the bundled types leave it out.
  const file = form?.get('file') as unknown as { size: number; arrayBuffer(): Promise<ArrayBuffer> } | string | null | undefined
  if (!file || typeof file === 'string') return c.json({ error: 'file field is required', code: 'ig_media_file' }, 400)
  if (file.size > MAX_MEDIA_BYTES) return c.json({ error: 'Файл больше 8 МБ.', code: 'ig_media_too_large' }, 413)
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (sniffType(bytes)?.mime !== 'image/jpeg') return c.json({ error: 'Нужен файл JPEG.', code: 'ig_media_type' }, 415)
  const key = `instagram/${crypto.randomUUID()}.jpg`
  await c.env.LOOM_UPLOADS.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } })
  const { protocol, host } = new URL(c.req.url)
  return c.json({ key, url: `${protocol}//${host}/api/files/${key}` }, 201)
})

// ─── GET / PUT /api/admin/instagram/settings  (kill switch) ──────────────────

router.get('/instagram/settings', requireAdmin, requireCap('instagram.edit'), async (c) => {
  const paused = await getIgSetting(c.env.DB, 'publish_paused')
  return c.json({
    // Missing row reads as paused: publishing is opt-in (R-2).
    publish_paused: paused?.value !== '0',
    updated_by: paused?.updated_by ?? null,
    updated_at: paused?.updated_at ?? null,
    token_configured: Boolean(c.env.IG_ACCESS_TOKEN && c.env.IG_USER_ID),
  })
})

router.put('/instagram/settings', requireAdmin, requireCap('instagram.approve'), async (c) => {
  const body = await readBody(c)
  if (!body || typeof body.publish_paused !== 'boolean') {
    return c.json({ error: 'publish_paused — true или false.', code: 'ig_settings' }, 400)
  }
  await setIgSetting(c.env.DB, 'publish_paused', body.publish_paused ? '1' : '0', c.get('adminId'), nowIso())
  return c.json({ ok: true, publish_paused: body.publish_paused })
})

// ─── GET /api/admin/instagram/insights  (LOOM-273) ───────────────────────────
// Totals per post published in the last `days` days (1–90, default 30), from
// the weekly pull. A metric Meta returned no data for is absent, not 0.

router.get('/instagram/insights', requireAdmin, requireCap('instagram.edit'), async (c) => {
  const raw = c.req.query('days')
  const days = raw === undefined ? 30 : Number(raw)
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    return c.json({ error: 'days — целое число от 1 до 90.', code: 'ig_days' }, 400)
  }
  const rows = await listIgPostInsights(c.env.DB, new Date(Date.now() - days * 86_400_000).toISOString())
  const posts = new Map<number, { id: number; ig_media_id: string; permalink: string | null; published_at: string; fetched_at: string | null; metrics: Record<string, number> }>()
  for (const r of rows) {
    const post = posts.get(r.id) ?? { id: r.id, ig_media_id: r.ig_media_id, permalink: r.permalink, published_at: r.published_at, fetched_at: null, metrics: {} }
    if (r.metric !== null && r.value !== null) post.metrics[r.metric] = r.value
    if (r.fetched_at && (!post.fetched_at || r.fetched_at > post.fetched_at)) post.fetched_at = r.fetched_at
    posts.set(r.id, post)
  }
  return c.json({ days, metrics: IG_MEDIA_METRICS, posts: [...posts.values()] })
})

// ─── GET /api/admin/instagram/suggested-times  (LOOM-274) ────────────────────
// The 3 best (weekday, hour) Tashkent slots by mean reach per post over the
// last 90 days; Tue/Thu/Sat 19:00 with basis 'default' below 8 posts with data.

router.get('/instagram/suggested-times', requireAdmin, requireCap('instagram.edit'), async (c) => {
  const now = Date.now()
  const rows = await listIgPostInsights(c.env.DB, new Date(now - 90 * 86_400_000).toISOString())
  const posts = rows.filter((r) => r.metric === 'reach' && r.value !== null).map((r) => ({ published_at: r.published_at, reach: r.value! }))
  return c.json(suggestTimes(posts, now))
})

export default router
