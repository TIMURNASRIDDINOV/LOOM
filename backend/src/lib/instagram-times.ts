// Suggested Instagram posting times (PRD-213 R-10, LOOM-274).
//
// Pure: the admin route and the AI drafter (LOOM-272) take publish_at from
// here, so there is one ranking. Slots are (weekday, hour) in Tashkent time:
// Uzbekistan is UTC+5 all year with no DST, so a fixed offset is exact.

const TASHKENT_MS = 5 * 3_600_000
const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS

/** Below this many posts with reach data the ranking is noise: use the defaults. */
export const IG_MIN_POSTS = 8
/** Tue, Thu, Sat at 19:00 Tashkent (epic decision). weekday: 0 = Sunday, as Date#getUTCDay. */
export const IG_DEFAULT_SLOTS = [{ weekday: 2, hour: 19 }, { weekday: 4, hour: 19 }, { weekday: 6, hour: 19 }] as const

export interface IgSlot {
  weekday: number
  hour: number
  /** Mean reach per post in this slot; absent for a default slot. */
  mean_reach?: number
  posts?: number
  /** The next time this slot comes round after `now`, UTC ISO. */
  next_at: string
}

export interface IgSuggestion {
  basis: 'insights' | 'default'
  /** Posts with reach data in the last 90 days. */
  posts: number
  slots: IgSlot[]
}

/** Next instant after `now` (ms) that falls on weekday/hour:00 in Tashkent, as UTC ISO. */
export function nextSlotAt(weekday: number, hour: number, now: number): string {
  const local = now + TASHKENT_MS
  const midnight = local - (local % DAY_MS)
  const day = new Date(local).getUTCDay()
  let at = midnight + ((weekday - day + 7) % 7) * DAY_MS + hour * 3_600_000
  if (at <= local) at += WEEK_MS
  return new Date(at - TASHKENT_MS).toISOString()
}

/**
 * The 3 best slots by mean reach per post published in the last 90 days.
 * `posts` are published posts with their lifetime reach; older ones are ignored.
 */
export function suggestTimes(posts: { published_at: string; reach: number }[], now: number): IgSuggestion {
  const recent = posts.filter((p) => {
    const at = Date.parse(p.published_at)
    return at >= now - 90 * DAY_MS && at <= now && Number.isFinite(p.reach)
  })
  if (recent.length < IG_MIN_POSTS) {
    return { basis: 'default', posts: recent.length, slots: IG_DEFAULT_SLOTS.map((s) => ({ ...s, next_at: nextSlotAt(s.weekday, s.hour, now) })) }
  }
  const slots = new Map<string, { weekday: number; hour: number; sum: number; posts: number }>()
  for (const p of recent) {
    const local = new Date(Date.parse(p.published_at) + TASHKENT_MS)
    const weekday = local.getUTCDay()
    const hour = local.getUTCHours()
    const slot = slots.get(`${weekday}:${hour}`) ?? { weekday, hour, sum: 0, posts: 0 }
    slot.sum += p.reach
    slot.posts++
    slots.set(`${weekday}:${hour}`, slot)
  }
  // Ties go to the slot with more posts behind it, then to the earlier slot in the week.
  const ranked: Omit<IgSlot, 'next_at'>[] = [...slots.values()]
    .map((s) => ({ weekday: s.weekday, hour: s.hour, mean_reach: Math.round(s.sum / s.posts), posts: s.posts }))
    .sort((a, b) => b.mean_reach - a.mean_reach || b.posts - a.posts || a.weekday - b.weekday || a.hour - b.hour)
    .slice(0, 3)
  // Fewer than 3 distinct slots: top up with defaults not already taken.
  for (const d of IG_DEFAULT_SLOTS) {
    if (ranked.length < 3 && !ranked.some((s) => s.weekday === d.weekday && s.hour === d.hour)) ranked.push({ ...d })
  }
  return { basis: 'insights', posts: recent.length, slots: ranked.map((s) => ({ ...s, next_at: nextSlotAt(s.weekday, s.hour, now) })) }
}

/**
 * `n` publish times (UTC ISO, ascending) for the AI drafter (LOOM-272): the
 * suggested slots first, then the best slot's hour on the other days of the
 * coming week, so a batch of up to 7 gets one post per day at most.
 */
export function publishTimes(posts: { published_at: string; reach: number }[], now: number, n: number): string[] {
  const { slots } = suggestTimes(posts, now)
  const times = slots.map((s) => s.next_at)
  const day = (iso: string) => Math.floor((Date.parse(iso) + TASHKENT_MS) / DAY_MS)
  const today = new Date(now + TASHKENT_MS).getUTCDay()
  for (let d = 0; d < 7 && times.length < n; d++) {
    const at = nextSlotAt((today + d) % 7, slots[0].hour, now)
    if (!times.some((t) => day(t) === day(at))) times.push(at)
  }
  return times.slice(0, n).sort()
}

/** Reach per published post from listIgPostInsights rows (one row per post and metric). */
export function reachPosts(rows: { metric: string | null; value: number | null; published_at: string }[]): { published_at: string; reach: number }[] {
  return rows.filter((r) => r.metric === 'reach' && r.value !== null).map((r) => ({ published_at: r.published_at, reach: r.value as number }))
}
