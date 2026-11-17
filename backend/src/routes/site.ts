import { Hono } from 'hono'
import { validateUpload } from '../lib/r2'
import { requireAdmin, requireCap } from '../middleware/requireAdmin'
import type { AdminEnv, BaseEnv } from '../types'

// Home-page hero picture the owner changes from the admin panel (migration
// 0032). The stored row is {"key": "<R2 key in LOOM_MODELS>", "alt": "<text>"};
// no row means the static default baked into index.html. Each upload gets a
// fresh random key, so /api/files/models/<key> can stay cached immutably.
// ponytail: replaced pictures stay in R2 (a few hundred KB each); add a cleanup
// if the bucket ever matters.

const HERO = 'home_hero'
const HERO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_HERO_BYTES = 3 * 1024 * 1024
const MAX_ALT = 200

type Hero = { key: string; alt: string }

async function readHero(db: D1Database): Promise<Hero | null> {
  const row = await db.prepare('SELECT value FROM site_settings WHERE key = ?').bind(HERO).first<{ value: string }>()
  if (!row) return null
  try {
    const v = JSON.parse(row.value)
    return typeof v?.key === 'string' ? { key: v.key, alt: typeof v.alt === 'string' ? v.alt : '' } : null
  } catch {
    return null
  }
}

function heroJson(requestUrl: string, hero: Hero | null) {
  if (!hero) return null
  const { protocol, host } = new URL(requestUrl)
  return { url: `${protocol}//${host}/api/files/models/${hero.key}`, alt: hero.alt }
}

// ─── GET /api/site/hero  (public) ─────────────────────────────────────────────
// {url, alt} or null. Short cache: a change shows up within a minute.

export const sitePublic = new Hono<BaseEnv>()

sitePublic.get('/hero', async (c) => {
  const hero = await readHero(c.env.DB).catch(() => null)
  c.header('Cache-Control', 'public, max-age=60')
  return c.json(heroJson(c.req.url, hero))
})

// ─── /api/admin/site/hero  (products.edit) ────────────────────────────────────

export const siteAdmin = new Hono<AdminEnv>()

siteAdmin.get('/site/hero', requireAdmin, requireCap('products.edit'), async (c) => {
  return c.json({ hero: heroJson(c.req.url, await readHero(c.env.DB)) })
})

// Multipart: `image` (PNG, JPEG or WebP, ≤ 3 MB, checked by content) and an
// optional `alt`.
siteAdmin.put('/site/hero', requireAdmin, requireCap('products.edit'), async (c) => {
  const form = await c.req.formData().catch(() => null)
  const file = form?.get('image') as File | string | null | undefined
  if (!file || typeof file === 'string') return c.json({ error: 'Выберите файл.', code: 'hero_file' }, 400)
  const alt = String(form?.get('alt') ?? '').trim()
  if (alt.length > MAX_ALT) return c.json({ error: `Описание — до ${MAX_ALT} символов.`, code: 'hero_alt' }, 400)
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.length > MAX_HERO_BYTES) return c.json({ error: 'Файл больше 3 МБ.', code: 'hero_size' }, 413)
  const checked = validateUpload(bytes, HERO_TYPES, MAX_HERO_BYTES)
  if (!checked.ok) return c.json({ error: 'Нужен файл PNG, JPEG или WebP.', code: 'hero_type' }, 415)

  const key = `site/hero/${crypto.randomUUID()}.${checked.type.ext}`
  await c.env.LOOM_MODELS.put(key, bytes, { httpMetadata: { contentType: checked.type.mime } })
  const hero = { key, alt }
  await c.env.DB.prepare(`INSERT INTO site_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .bind(HERO, JSON.stringify(hero), c.get('adminId'), new Date().toISOString()).run()
  return c.json({ hero: heroJson(c.req.url, hero) })
})

// Back to the static default picture.
siteAdmin.delete('/site/hero', requireAdmin, requireCap('products.edit'), async (c) => {
  await c.env.DB.prepare('DELETE FROM site_settings WHERE key = ?').bind(HERO).run()
  return c.json({ hero: null })
})
