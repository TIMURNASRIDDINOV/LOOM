// LOOM-272: weekly AI batch of Instagram drafts on a local D1, Workers AI and
// Telegram stubbed. Never calls a live API. Run: node backend/scripts/instagram-drafter-test.mjs
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const { build } = require('esbuild')
const { Miniflare } = require('miniflare')
const scratch = await mkdtemp(join(tmpdir(), 'loom-272-'))
const opts = { bundle: true, format: 'esm', platform: 'browser', target: 'es2022' }
await build({ ...opts, entryPoints: [join(root, 'src/index.ts')], outfile: join(scratch, 'worker.mjs') })
await build({ ...opts, entryPoints: [join(root, 'src/lib/instagram-drafter.ts')], outfile: join(scratch, 'drafter.mjs') })
const D = await import(pathToFileURL(join(scratch, 'drafter.mjs')).href)
await build({ ...opts, entryPoints: [join(root, 'src/lib/instagram-times.ts')], outfile: join(scratch, 'times.mjs') })
const T = await import(pathToFileURL(join(scratch, 'times.mjs')).href)

const secret = 'local-drafter-test-only-not-a-production-secret'
let outbound = 0
const mf = new Miniflare({ modules: true, modulesRoot: scratch, scriptPath: join(scratch, 'worker.mjs'), compatibilityDate: '2024-09-23', cf: false,
  d1Databases: ['DB'], r2Buckets: ['LOOM_UPLOADS', 'LOOM_MODELS'], kvNamespaces: ['RATE_LIMIT'],
  bindings: { JWT_SECRET: secret, ENVIRONMENT: 'test', TELEGRAM_BOT_TOKEN: '', BOT_USERNAME: '' },
  outboundService: () => { outbound++; return new Response('{}', { status: 500 }) } })
const token = () => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const raw = `${encode({ alg: 'HS256' })}.${encode({ sub: '1', role: 'admin', iat: now, exp: now + 3600 })}`
  return `${raw}.${createHmac('sha256', secret).update(raw).digest('base64url')}`
}

let checks = 0
const ok = (value, msg) => { assert.ok(value, msg); checks++ }
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++ }

// Workers AI stub: answers like the model, or with what `reply` returns.
function stubAi(reply = () => ({ uz: 'Sening dizayning, bizning mahoratimiz ✨', ru: 'Твой принт — твои правила.', en: 'Your print, your rules.' })) {
  const calls = []
  return { calls, run: async (model, input) => {
    calls.push({ model, input })
    const r = reply(calls.length, input)
    if (r instanceof Error) throw r
    return { response: typeof r === 'string' ? r : JSON.stringify(r) }
  } }
}

try {
  const db = await mf.getD1Database('DB')
  for (const file of (await readdir(join(root, 'migrations'))).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = (await readFile(join(root, 'migrations', file), 'utf8')).replace(/--[^\n]*/g, '')
    for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run()
  }
  await db.prepare('DELETE FROM admins').run()
  await db.prepare("INSERT INTO admins (id,email,password_hash,role,created_at) VALUES (1,'owner@test.invalid','x','owner',1)").run()
  await db.prepare('UPDATE products SET active = 0').run()
  await db.prepare(`INSERT INTO products (slug, name_ru, name_en, price, active, display_order, created_at, updated_at) VALUES
    ('t272-hoodie','Худи','Hoodie',249000,1,1,1,1), ('t272-tee','Футболка','T-shirt',129000,1,2,1,1), ('t272-old','Старое','Old',99000,0,3,1,1)`).run()
  const prices = { 't272-hoodie': '249 000', 't272-tee': '129 000' }

  // Pure helpers: Tashkent week and the default 19:00 Tashkent slots.
  const monday = Date.parse('2026-11-02T01:00:00.000Z') // the cron instant: Monday 06:00 Tashkent
  eq(D.weekKey(monday), '2026-11-02')
  eq(D.weekKey(Date.parse('2026-11-08T18:59:00.000Z')), '2026-11-02') // Sunday 23:59 Tashkent
  eq(D.weekKey(Date.parse('2026-11-08T19:00:00.000Z')), '2026-11-09') // Monday 00:00 Tashkent

  // AC-3: facts from D1 only; a made-up price or "вы" is refused.
  const hoodie = { slug: 't272-hoodie', name_ru: 'Худи', name_en: 'Hoodie', price: 249000 }
  ok(D.buildPrompt(hoodie)[1].content.includes('Hoodie'))
  const good = D.captionsFromOutput(JSON.stringify({ uz: 'a', ru: 'б', en: 'c' }), hoodie)
  ok(good.caption_uz.includes("Narxi: 249 000 so'm") && good.caption_ru.includes('Цена: 249 000 сум') && good.caption_en.includes('Price: 249 000 UZS'))
  ok(good.caption_ru.includes('https://loomdesign.uz/configurator?slug=t272-hoodie'))
  ok(D.IG_CAPTION_RULES.hashtags.every((tag) => good.caption_en.includes(tag)))
  ok(/not in the catalogue/.test(D.captionsFromOutput({ uz: 'Faqat 199 000', ru: 'б', en: 'c' }, hoodie)))
  eq(typeof D.captionsFromOutput({ uz: 'Narxi 249.000', ru: 'б', en: 'c' }, hoodie), 'object')
  ok(/ты/.test(D.captionsFromOutput({ uz: 'a', ru: 'Закажите у нас, мы ждём вас', en: 'c' }, hoodie)))
  ok(/JSON/.test(D.captionsFromOutput('no json here', hoodie)))
  ok(/JSON/.test(D.captionsFromOutput({ uz: 'a', ru: '', en: 'c' }, hoodie)))

  const env = { DB: db, TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' }
  const reset = async () => {
    for (const sql of ['DELETE FROM ig_posts', 'DELETE FROM ai_usage', "DELETE FROM ig_settings WHERE key LIKE 'ai_%'"]) await db.prepare(sql).run()
  }
  const posts = async () => (await db.prepare('SELECT * FROM ig_posts ORDER BY id').all()).results
  const batch = async () => JSON.parse((await db.prepare("SELECT value FROM ig_settings WHERE key = 'ai_batch'").first()).value)
  // The ledger is stamped with the real clock, so runs use it too.
  const now = Date.now()
  const run = (ai, notes = []) => D.draftWeeklyPosts(env, { ai, now: () => now, notify: async (html) => { notes.push(html) } })

  // AC-1 + AC-2 + AC-3: five drafts, all three captions, never approved.
  await reset()
  const ai = stubAi()
  await run(ai)
  const rows = await posts()
  eq(rows.length, 5)
  eq(rows.map((r) => r.publish_at), T.publishTimes([], now, 5)) // LOOM-274: no insights yet, so the default slots
  for (const r of rows) {
    eq([r.status, r.source, r.approved_by, r.approved_at, r.created_by, r.langs], ['draft', 'ai', null, null, null, 'uz,ru,en'])
    ok(r.caption_uz && r.caption_ru && r.caption_en, 'all three captions')
    const slug = r.caption_uz.match(/slug=([\w-]+)/)[1]
    ok(prices[slug], `active product ${slug}`)
    ok(r.caption_uz.includes(prices[slug]) && r.caption_en.includes(prices[slug]), 'price from D1')
  }
  ok(ai.calls.every((c) => c.model === D.IG_DRAFTER_MODEL && c.input.messages[0].content.includes('"ты"')))
  ok(!ai.calls.some((c) => c.input.messages[1].content.includes('Old')), 'inactive product never used')
  eq((await batch()).status, 'done')
  eq((await db.prepare('SELECT COUNT(*) AS n, SUM(est_neurons) AS s FROM ai_usage').first()), { n: 5, s: 5 * D.IG_DRAFTER_EST_NEURONS })
  // No code path in the drafter writes an approval or a cron-owned status.
  const source = (await readFile(join(root, 'src/lib/instagram-drafter.ts'), 'utf8')).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')
  ok(!/approved|publishing|published/.test(source), 'drafter code mentions approved/publishing')

  // AC-5: a second run in the same week creates nothing and calls no model.
  const again = stubAi()
  await run(again)
  eq([(await posts()).length, again.calls.length], [5, 0])

  // ai_batch_size setting.
  await reset()
  await db.prepare("INSERT INTO ig_settings (key, value, updated_at) VALUES ('ai_batch_size', '3', 'x')").run()
  await run(stubAi())
  eq((await posts()).length, 3)

  // AC-4: a low cap stops the batch early and keeps what was made; admin sees the message.
  await reset()
  await db.prepare(`INSERT INTO ig_settings (key, value, updated_at) VALUES ('ai_neuron_cap', '${2 * D.IG_DRAFTER_EST_NEURONS + 1}', 'x')`).run()
  await run(stubAi())
  eq((await posts()).length, 2)
  eq((await batch()).status, 'stopped_budget')
  const res = await mf.dispatchFetch('http://localhost/api/admin/instagram/settings', { headers: { Cookie: `admin_token=${token()}` } })
  const settings = await res.json()
  eq([res.status, settings.ai_batch.message, settings.ai_batch.created], [200, 'AI batch stopped: budget', 2])
  // The shared Workers AI cap counts other spend too.
  await reset()
  await db.prepare('INSERT INTO ai_usage (model, est_neurons, run_id, prompt, created_at) VALUES (?, ?, ?, ?, ?)').bind('x', 9000 - D.IG_DRAFTER_EST_NEURONS, 'other', 'p', now).run()
  await run(stubAi())
  eq([(await posts()).length, (await batch()).status], [1, 'stopped_budget'])

  // AC-6: failed calls leave no row and send exactly one Telegram message.
  await reset()
  let notes = []
  await run(stubAi((n) => (n === 2 ? new Error('5007: upstream timeout') : n === 4 ? { uz: 'Atigi 50 000!', ru: 'б', en: 'c' } : undefined) ?? { uz: 'a', ru: 'б', en: 'c' }), notes)
  const left = await posts()
  eq(left.length, 3)
  ok(left.every((r) => r.caption_uz && r.caption_ru && r.caption_en))
  eq(notes.length, 1)
  ok(notes[0].includes('5007: upstream timeout') && notes[0].includes('not in the catalogue'))
  eq((await batch()).status, 'done')
  await reset()
  notes = []
  await run(stubAi(() => new Error('down')), notes)
  eq([(await posts()).length, notes.length, (await batch()).status], [0, 1, 'failed'])

  // Cron wiring: the Worker's scheduled handler runs the drafter for its cron only.
  await reset()
  const worker = await mf.getWorker()
  await worker.scheduled({ cron: '*/5 * * * *' })
  eq(await db.prepare("SELECT value FROM ig_settings WHERE key = 'ai_batch'").first(), null)
  await worker.scheduled({ cron: D.IG_DRAFTER_CRON })
  // No AI binding in this local Worker: the batch fails cleanly with no rows.
  eq([(await posts()).length, (await batch()).status], [0, 'failed'])
  eq(outbound, 0)

  console.log(`instagram AI drafter: ${checks} checks passed`)
} finally {
  await mf.dispose()
  await rm(scratch, { recursive: true, force: true })
}
