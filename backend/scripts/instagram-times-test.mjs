// LOOM-274: suggested Instagram posting times from stored insights. Pure, no D1, no network.
// Run: node backend/scripts/instagram-times-test.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { build } = createRequire(join(root, 'package.json'))('esbuild')
const scratch = await mkdtemp(join(tmpdir(), 'loom-274-'))
await build({ bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', entryPoints: [join(root, 'src/lib/instagram-times.ts')], outfile: join(scratch, 'times.mjs') })
const { suggestTimes, nextSlotAt, publishTimes } = await import(pathToFileURL(join(scratch, 'times.mjs')).href)

// Now: Wednesday 2026-10-21 12:00 Tashkent (07:00 UTC).
const now = Date.parse('2026-10-21T07:00:00Z')
// A post at Tashkent `local` ("YYYY-MM-DDTHH:MM") with `reach`.
const post = (local, reach) => ({ published_at: new Date(local + ':00+05:00').toISOString(), reach })
const slot = (s) => [s.weekday, s.hour]

// 10 posts: Mon 20:00 mean 300 (2 posts), Fri 18:00 mean 250, Tue 19:00 mean 100 (3), Sun 12:00 mean 50 (2), Sat 19:00 80.
const ten = [
  post('2026-10-19T20:05', 200), post('2026-10-12T20:40', 400),
  post('2026-10-16T18:00', 250),
  post('2026-10-20T19:00', 90), post('2026-10-13T19:10', 110), post('2026-10-06T19:00', 100),
  post('2026-10-18T12:00', 40), post('2026-10-11T12:30', 60),
  post('2026-10-17T19:00', 80),
  post('2026-10-03T19:00', 70),
]
const s = suggestTimes(ten, now)
assert.equal(s.basis, 'insights')
assert.equal(s.posts, 10)
assert.deepEqual(s.slots.map(slot), [[1, 20], [5, 18], [2, 19]])
assert.deepEqual(s.slots.map((x) => x.mean_reach), [300, 250, 100])
assert.deepEqual(s.slots.map((x) => x.posts), [2, 1, 3])
// Next Monday 20:00 Tashkent after Wed 2026-10-21.
assert.equal(s.slots[0].next_at, '2026-10-26T15:00:00.000Z')

// Posts older than 90 days do not count: the same 10 posts pushed back 100 days fall to the default.
const old = ten.map((p) => ({ ...p, published_at: new Date(Date.parse(p.published_at) - 100 * 86_400_000).toISOString() }))
assert.equal(suggestTimes(old, now).basis, 'default')

// 7 posts with data: default Tue, Thu, Sat 19:00.
const d = suggestTimes(ten.slice(0, 7), now)
assert.equal(d.basis, 'default')
assert.equal(d.posts, 7)
assert.deepEqual(d.slots.map(slot), [[2, 19], [4, 19], [6, 19]])
assert.deepEqual(d.slots.map((x) => x.next_at), ['2026-10-27T14:00:00.000Z', '2026-10-22T14:00:00.000Z', '2026-10-24T14:00:00.000Z'])

// 8 posts in only 2 slots: topped up with a default slot.
const two = Array.from({ length: 8 }, (_, i) => post(i % 2 ? '2026-10-19T20:00' : '2026-10-16T18:00', 100 + i))
assert.deepEqual(suggestTimes(two, now).slots.map(slot), [[1, 20], [5, 18], [2, 19]])

// nextSlotAt: same day later, same slot now (next week), and strictly after now.
assert.equal(nextSlotAt(3, 19, now), '2026-10-21T14:00:00.000Z')
assert.equal(nextSlotAt(3, 12, now), '2026-10-28T07:00:00.000Z')
assert.equal(nextSlotAt(3, 11, now), '2026-10-28T06:00:00.000Z')

console.log('instagram-times-test: ok')

// LOOM-272/274: the drafter's publish times come from the same slots.
const monday = Date.parse('2026-11-02T01:00:00.000Z') // drafter cron: Monday 06:00 Tashkent
assert.deepEqual(publishTimes([], monday, 3), ['03', '05', '07'].map((d) => `2026-11-${d}T14:00:00.000Z`)) // Tue, Thu, Sat 19:00
const five = publishTimes([], monday, 5)
assert.deepEqual(five, ['02', '03', '04', '05', '07'].map((d) => `2026-11-${d}T14:00:00.000Z`)) // + other days at 19:00
assert.equal(publishTimes([], monday, 7).length, 7)
assert.equal(new Set(publishTimes([], monday, 7).map((t) => t.slice(0, 10))).size, 7, 'one post per day')
assert.deepEqual(publishTimes(ten, now, 3), suggestTimes(ten, now).slots.map((s) => s.next_at).sort())
console.log('publishTimes ok')
