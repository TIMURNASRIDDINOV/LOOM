// Instagram posts (PRD-213, migration 0024): caption rules and status moves.
//
// Pure functions only, so the admin routes (LOOM-269) and the publishing cron
// (LOOM-271) apply exactly the same rules. Nothing here talks to Meta.

export const IG_LANGS = ['uz', 'ru', 'en'] as const
export type IgLang = (typeof IG_LANGS)[number]

export const IG_STATUSES = ['draft', 'approved', 'publishing', 'published', 'failed', 'rejected'] as const
export type IgStatus = (typeof IG_STATUSES)[number]

// Instagram's own caption limits.
export const IG_MAX_CAPTION = 2200
export const IG_MAX_HASHTAGS = 30
export const IG_MAX_MENTIONS = 20

export interface IgCaptions {
  caption_uz: string
  caption_ru: string
  caption_en: string
  langs: string // comma list, see parseLangs
}

/** Comma list or array → known languages, deduplicated, in uz,ru,en order. */
export function parseLangs(value: unknown): IgLang[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  const wanted = new Set(list.map((v) => String(v).trim()))
  return IG_LANGS.filter((l) => wanted.has(l))
}

/**
 * The one caption Instagram gets: uz, then ru, then en, separated by a blank
 * line. Languages switched off for the post, or left empty, are skipped.
 */
export function composeCaption(post: IgCaptions): string {
  return parseLangs(post.langs)
    .map((l) => post[`caption_${l}`].trim())
    .filter(Boolean)
    .join('\n\n')
}

// A tag or mention starts at the beginning or after a character that cannot
// be part of a word, so "a@b.uz" is not a mention and "&#39;" is not a tag.
const HASHTAG = /(?:^|[^\p{L}\p{N}_&])#[\p{L}\p{N}_]+/gu
const MENTION = /(?:^|[^\p{L}\p{N}_.])@[A-Za-z0-9._]+/gu

export function countHashtags(text: string): number {
  return text.match(HASHTAG)?.length ?? 0
}

export function countMentions(text: string): number {
  return text.match(MENTION)?.length ?? 0
}

/**
 * Why this composed caption cannot go to Instagram, or null when it can.
 * Length is counted in UTF-16 units, which is never less than what Instagram
 * counts, so a caption that passes here is never refused for length there.
 */
export function captionError(caption: string): string | null {
  if (!caption) return 'ig_no_language'
  if (caption.length > IG_MAX_CAPTION) return 'ig_caption_too_long'
  if (countHashtags(caption) > IG_MAX_HASHTAGS) return 'ig_too_many_hashtags'
  if (countMentions(caption) > IG_MAX_MENTIONS) return 'ig_too_many_mentions'
  return null
}

/**
 * Admin actions on a post: the statuses each may start from and where it
 * goes. publishing / published belong to the cron and are never left by hand.
 * The capability column is enforced by the routes (lib/permissions.ts).
 */
export const IG_ACTIONS = {
  approve: { from: ['draft'], to: 'approved', cap: 'instagram.approve' },
  retry: { from: ['failed'], to: 'draft', cap: 'instagram.approve' },
  reject: { from: ['draft', 'approved', 'failed'], to: 'rejected', cap: 'instagram.edit' },
  draft: { from: ['approved', 'rejected'], to: 'draft', cap: 'instagram.edit' },
} as const satisfies Record<string, { from: readonly IgStatus[]; to: IgStatus; cap: string }>

export type IgAction = keyof typeof IG_ACTIONS

/** Statuses whose content may still be edited. */
export const IG_EDITABLE: readonly IgStatus[] = ['draft', 'approved', 'failed', 'rejected']

/** Everything approval needs besides the caption; null when the post may be approved. */
export function approvalError(
  post: IgCaptions & { media_url: string | null; publish_at: string | null },
  now = Date.now(),
): string | null {
  if (!post.media_url) return 'ig_no_media'
  const at = post.publish_at ? Date.parse(post.publish_at) : NaN
  if (!(at > now)) return 'ig_publish_at_past'
  return captionError(composeCaption(post))
}

export const IG_ERRORS: Record<string, string> = {
  ig_no_media: 'Добавьте изображение JPEG.',
  ig_publish_at_past: 'Время публикации должно быть в будущем.',
  ig_no_language: 'Включите хотя бы один язык с непустой подписью.',
  ig_caption_too_long: `Подпись длиннее ${IG_MAX_CAPTION} символов.`,
  ig_too_many_hashtags: `Больше ${IG_MAX_HASHTAGS} хэштегов.`,
  ig_too_many_mentions: `Больше ${IG_MAX_MENTIONS} упоминаний.`,
}

/** Public file name of an uploaded Instagram image: instagram/<uuid>.jpg. */
export const IG_MEDIA_KEY = /^instagram\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/
