// KV-backed counters shared by every throttled route. KV is eventually
// consistent, so limits are approximate across colos; that is enough to turn
// unlimited attempts into a handful per window.
//
// KV writes cost quota, so credential checks use failure-only counters: one
// read per attempt, a write only when the attempt fails.

import type { Context } from 'hono'

export function clientIp(c: Context): string {
  return c.req.header('CF-Connecting-IP') ?? 'unknown'
}

/** Counts every call. True once `limit` calls happened inside the window. */
export async function isRateLimited(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const current = await kv.get(key)
  const count = current ? parseInt(current, 10) : 0
  if (count >= limit) return true
  await kv.put(key, String(count + 1), { expirationTtl: windowSec })
  return false
}

/** True when any of the keys already has `limit` recorded failures. */
export async function tooManyFailures(kv: KVNamespace, keys: string[], limit: number): Promise<boolean> {
  const counts = await Promise.all(keys.map((k) => kv.get(`fail:${k}`)))
  return counts.some((v) => v != null && parseInt(v, 10) >= limit)
}

/** Record one failure against each key. Each failure restarts that key's window. */
export async function recordFailure(kv: KVNamespace, keys: string[], windowSec: number): Promise<void> {
  await Promise.all(
    keys.map(async (k) => {
      const v = await kv.get(`fail:${k}`)
      await kv.put(`fail:${k}`, String((v ? parseInt(v, 10) : 0) + 1), { expirationTtl: windowSec })
    }),
  )
}

export const TOO_MANY = {
  error: 'Слишком много попыток. Подождите несколько минут и попробуйте снова.',
  code: 'rate_limited',
}
