#!/usr/bin/env node
// ─── Smoke test — one command per environment (LOOM-152, PRD-201 R-5) ───────
//
//   npm run smoke:local                      the full flows on a fresh local D1
//   npm run smoke:staging -- --pages URL     anonymous GETs, staging Worker
//   npm run smoke:prod                       anonymous GETs, production
//
// Local runs `wrangler dev --local` against its own state directory under the
// temp folder, so nothing in .wrangler/state is touched and the database starts
// empty; it stops the Worker again on the way out, whatever happens. One line is
// printed per step with its HTTP status, and the first step that is not the
// expected status stops the run: the command names that step, tears down and
// exits 1.
//
// Remote runs send GET requests only, with no Cookie and no Authorization
// header — staging and production hold the founder's data (STD-15) — and they
// also check that every ?v= asset the pages reference matches the file in this
// checkout byte for byte, which is the one thing a local gate cannot see.
//
// No step calls an AI route: those always run remotely and are billed.
//
// No dependencies, Node 18+. Exit codes: 0 every step passed · 1 a step failed,
// timed out or a host did not answer · 2 the command line is wrong.

import { spawn, spawnSync } from 'node:child_process'
import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BACKEND = path.resolve(HERE, '..')
const REPO = path.resolve(BACKEND, '..')

const STAGING_API = 'https://loom-backend-staging.timurnasriddinov56.workers.dev'
const PROD_API = 'https://api.loomdesign.uz'
const PROD_PAGES = 'https://loomdesign.uz'

const PORT = 8787
const REQUEST_TIMEOUT_MS = 15_000
const START_BUDGET_MS = 30_000

const QA_USER = 'qa-user@loom.test'
const QA_ADMIN = 'qa-admin@loom.test'
const QA_SLUG = 'qa-smoke-tee'
const GLB_FILE = path.join(REPO, 'assets/models/t_shirt.meshopt.glb')

// ─── command line ───────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { target: null, pages: null, api: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = (name) => {
      const next = argv[i + 1]
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1)
      if (next !== undefined) i++
      return next ?? null
    }
    if (arg === '--pages') opts.pages = value('--pages')
    else if (arg.startsWith('--pages=')) opts.pages = value('--pages')
    else if (arg === '--api') opts.api = value('--api')
    else if (arg.startsWith('--api=')) opts.api = value('--api')
    else if (arg === '--help' || arg === '-h') opts.help = true
    else if (arg.startsWith('-')) {
      console.error(`FAIL  unknown argument: ${arg} (try --help)`)
      process.exit(2)
    } else if (!opts.target) opts.target = arg
    else {
      console.error(`FAIL  unexpected argument: ${arg} (try --help)`)
      process.exit(2)
    }
  }
  return opts
}

const opts = parseArgs(process.argv.slice(2))

if (opts.help) {
  console.log('Usage: node scripts/smoke.mjs <local|staging|prod> [--pages URL] [--api URL]')
  console.log('  local     start `wrangler dev --local` on a fresh temp state dir and run every flow')
  console.log('  staging   anonymous GETs against the staging Worker (--pages: the preview under test)')
  console.log('  prod      anonymous GETs against production')
  console.log('  --api     override the Worker host (staging and prod)')
  process.exit(0)
}

const mode = opts.target
if (!mode || !['local', 'staging', 'prod'].includes(mode)) {
  console.error(`FAIL  target must be one of: local, staging, prod (got ${mode ?? 'nothing'})`)
  process.exit(2)
}

if (mode === 'staging' && !opts.pages) {
  console.error('FAIL  smoke:staging needs --pages URL (the Pages preview of the PR)')
  process.exit(2)
}

const apiBase = (opts.api ?? (mode === 'staging' ? STAGING_API : mode === 'prod' ? PROD_API : `http://localhost:${PORT}`)).replace(/\/+$/, '')
const pagesBase = (opts.pages ?? (mode === 'prod' ? PROD_PAGES : null))?.replace(/\/+$/, '') ?? null

// ─── reporting ──────────────────────────────────────────────────────────────

const steps = []
let failed = false
class StepError extends Error {}

function pass(name, status, note) {
  steps.push({ name, status })
  console.log(`  ${String(status).padEnd(4)}  ${name}${note ? `  — ${note}` : ''}`)
}

function fail(name, status, note) {
  failed = true
  console.log(`  ${String(status).padEnd(4)}  ${name}${note ? `  — ${note}` : ''}`)
  console.error(`\nFAIL  ${name} — ${status}${note ? ` (${note})` : ''}`)
  throw new StepError(name)
}

// ─── HTTP ───────────────────────────────────────────────────────────────────

const log = [] // every request this run made: { method, url, credentials }

async function request(method, url, { json, form, body, headers = {}, token, cookie, step } = {}) {
  if (typeof url !== 'string' || !url) fail(step ?? `${method} ${url}`, 'no url', 'the previous response carried none')

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS)
  const init = { method, headers: { ...headers }, signal: ac.signal, redirect: 'manual' }

  if (token) init.headers.Authorization = `Bearer ${token}`
  if (cookie) init.headers.Cookie = cookie
  if (json !== undefined) {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(json)
  } else if (form !== undefined) {
    init.body = form
  } else if (body !== undefined) {
    init.body = body
  }

  log.push({ method, url, credentials: !!(token || cookie) })

  try {
    const res = await fetch(url, init)
    const bytes = Buffer.from(await res.arrayBuffer())
    return { status: res.status, headers: res.headers, bytes, text: bytes.toString('utf8') }
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'timeout' : 'no answer'
    // Named up front so a host that never answers still prints the step.
    fail(step ?? `${method} ${url}`, reason)
  } finally {
    clearTimeout(timer)
  }
}

const body = (res) => {
  try { return JSON.parse(res.text) } catch { return {} }
}

/** Every Set-Cookie header, with a fallback for Node versions without getSetCookie(). */
function setCookies(res) {
  const list = res.headers.getSetCookie?.()
  if (list?.length) return list
  const raw = res.headers.get('set-cookie')
  return raw ? raw.split(/,\s*(?=[^;=]+=)/) : []
}

const adminCookieOf = (res) => {
  const found = setCookies(res).map((c) => c.split(';')[0]).find((c) => c.startsWith('admin_token='))
  if (!found) throw new Error('no admin_token cookie in the login response')
  return found
}

// ─── fixtures (A-4: generated per run, never committed) ─────────────────────

const password = () => randomBytes(18).toString('base64url')

/** The backend's stored format: pbkdf2$<iterations>$<base64 salt>$<base64 hash>. */
function passwordHash(pw) {
  const salt = randomBytes(16)
  const hash = pbkdf2Sync(pw, salt, 100_000, 32, 'sha256')
  return `pbkdf2$100000$${salt.toString('base64')}$${hash.toString('base64')}`
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = ~0
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

/** A real PNG of the requested size — the upload route identifies files by magic bytes. */
function png(size) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const stride = size * 4 + 1
  const raw = Buffer.alloc(stride * size)
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0 // filter type 0
    for (let x = 0; x < size; x++) {
      const at = y * stride + 1 + x * 4
      raw[at] = (x * 255) / size
      raw[at + 1] = (y * 255) / size
      raw[at + 2] = 128
      raw[at + 3] = 255
    }
  }
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function blob(bytes, type) {
  return new Blob([bytes], { type })
}

// ─── the local Worker ───────────────────────────────────────────────────────

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-smoke-'))
let worker = null

function wrangler(args, { capture = true } = {}) {
  const bin = path.join(BACKEND, 'node_modules/wrangler/bin/wrangler.js')
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: BACKEND,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
  return { status: result.status ?? 1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

function startWorker() {
  const bin = path.join(BACKEND, 'node_modules/wrangler/bin/wrangler.js')
  worker = spawn(process.execPath, [bin, 'dev', '--local', '--port', String(PORT), '--persist-to', stateDir], {
    cwd: BACKEND,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logText = ''
  worker.stdout.on('data', (d) => { logText += d })
  worker.stderr.on('data', (d) => { logText += d })
  return () => logText
}

function stopWorker(workerLog) {
  if (!worker) return
  const pid = worker.pid
  try { worker.kill('SIGTERM') } catch { /* already gone */ }
  if (process.platform === 'win32' && pid) {
    // wrangler starts workerd as a child; take the tree down with it.
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
  }
  worker = null
  const tail = (workerLog?.() ?? '').trim().split('\n').slice(-3).join(' | ')
  // On a passing run the step lines are the whole output; the tail only helps when one failed.
  if (failed && tail) console.log(`  --    wrangler dev stopped (last output: ${tail.slice(0, 200)})`)
}

async function waitForWorker() {
  const deadline = Date.now() + START_BUDGET_MS
  while (Date.now() < deadline) {
    if (worker && worker.exitCode !== null) return false
    try {
      const res = await request('GET', `${apiBase}/`)
      if (res.status === 200) return true
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 750))
  }
  return false
}

// ─── local mode: the full flows (AC-1) ──────────────────────────────────────

async function runLocal() {
  if (!fs.existsSync(GLB_FILE)) {
    console.error(`FAIL  the fixture GLB is missing: ${GLB_FILE}`)
    process.exit(2)
  }
  if (!fs.existsSync(path.join(BACKEND, '.dev.vars'))) {
    // JWT_SECRET and friends live there; without it the first write step answers 500.
    console.log('  note: backend/.dev.vars is missing — run `cp .dev.vars.example .dev.vars` if a step fails.')
  }

  // 1 — the state directory is empty, so the schema comes from the migrations.
  // Strictly --local: prod and staging data belong to the founder (STD-15).
  const migrate = wrangler(['d1', 'migrations', 'apply', 'loom-db', '--local', '--persist-to', stateDir])
  if (migrate.status !== 0) { console.error(migrate.out.trim()); fail('d1 migrations apply --local', `exit ${migrate.status}`) }
  pass('d1 migrations apply --local', 'exit 0')

  // Started after the migration so the two never hold the same SQLite file.
  const workerLog = startWorker()
  try {
    if (!(await waitForWorker())) {
      fail(`wrangler dev on :${PORT}`, 'no answer', workerLog().trim().split('\n').slice(-2).join(' | ').slice(0, 200))
    }

    const userPw = password()
    const adminPw = password()

    // 2 — register the QA user
    const reg = await request('POST', `${apiBase}/api/auth/register`, { json: { email: QA_USER, password: userPw, name: 'QA User' } })
    if (reg.status !== 201) fail('POST /api/auth/register', reg.status, reg.text.slice(0, 160))
    pass('POST /api/auth/register -> token', 201)
    const userToken = body(reg).token

    // 3 — local SQL only: a Telegram-linked phone for the user, an owner admin
    const sql = [
      `UPDATE users SET telegram_user_id = 999000001 WHERE email = '${QA_USER}';`,
      `INSERT INTO admins (email, password_hash, role, created_at) VALUES ('${QA_ADMIN}', '${passwordHash(adminPw)}', 'owner', ${Date.now()});`,
    ]
    for (const statement of sql) {
      const fixture = wrangler(['d1', 'execute', 'loom-db', '--local', '--persist-to', stateDir, '--command', statement])
      if (fixture.status !== 0) { console.error(fixture.out.trim()); fail('d1 execute --local (QA fixtures)', `exit ${fixture.status}`) }
    }
    pass('d1 execute --local (telegram_user_id + owner admin)', 'exit 0')

    // 4 — the QA admin signs in and gets the cookie every admin step uses
    const login = await request('POST', `${apiBase}/api/admin/login`, { json: { email: QA_ADMIN, password: adminPw } })
    if (login.status !== 200) fail('POST /api/admin/login', login.status, login.text.slice(0, 160))
    pass('POST /api/admin/login -> admin_token cookie', 200)
    const adminCookie = adminCookieOf(login)

    // 5 — a product with a real GLB
    const form = new FormData()
    form.append('slug', QA_SLUG)
    form.append('name_ru', 'QA Smoke Tee')
    form.append('price', '250000')
    form.append('product_type', 'custom')
    // The cart re-checks the picked size and colour against this config
    // (LOOM-166), so the product has to carry one.
    form.append('sizes_json', JSON.stringify(['M', 'L']))
    form.append('colors_json', JSON.stringify([
      { hex: '#FFFFFF', name_uz: 'Oq', name_ru: 'Белый', name_en: 'White', available: true },
    ]))
    form.append('glb', blob(fs.readFileSync(GLB_FILE), 'model/gltf-binary'), 't_shirt.meshopt.glb')
    const created = await request('POST', `${apiBase}/api/admin/products`, { form, cookie: adminCookie })
    if (created.status !== 201) fail('POST /api/admin/products (multipart)', created.status, created.text.slice(0, 200))
    const productId = body(created).product?.id
    const readProduct = await request('GET', `${apiBase}/api/products/${QA_SLUG}`)
    if (readProduct.status !== 200 || !body(readProduct).glb_url) {
      fail(`GET /api/products/${QA_SLUG}`, readProduct.status, readProduct.text.slice(0, 160))
    }
    pass(`POST /api/admin/products -> id ${productId}, GET /api/products/${QA_SLUG}`, 200)

    // 6 — the configurator GLB, straight off the CDN path the browser uses
    const glbUrl = body(readProduct).glb_url
    const glb = await request('GET', glbUrl)
    const cors = glb.headers.get('access-control-allow-origin')
    const glbOk = glb.status === 200 && cors === '*' && glb.bytes.subarray(0, 4).toString('ascii') === 'glTF'
    if (!glbOk) fail('GET glb_url (configurator)', glb.status, `ACAO ${cors}, starts "${glb.bytes.subarray(0, 4).toString('ascii')}"`)
    pass('GET glb_url -> glTF, access-control-allow-origin *', 200)

    // 7 — uploads: logo, reserved model key, then the GLB into that key
    const logoForm = new FormData()
    logoForm.append('file', blob(png(64), 'image/png'), 'qa-logo.png')
    const logo = await request('POST', `${apiBase}/api/uploads`, { form: logoForm, token: userToken })
    if (logo.status !== 201) fail('POST /api/uploads (logo PNG)', logo.status, logo.text.slice(0, 160))
    const logoKey = body(logo).key

    const reserve = await request('POST', `${apiBase}/api/uploads/model`, { token: userToken })
    if (reserve.status !== 201) fail('POST /api/uploads/model', reserve.status, reserve.text.slice(0, 160))
    const modelKey = body(reserve).key

    const put = await request('PUT', `${apiBase}/api/uploads/${modelKey}`, {
      body: fs.readFileSync(GLB_FILE),
      headers: { 'Content-Type': 'model/gltf-binary' },
      token: userToken,
    })
    if (put.status !== 201) fail(`PUT /api/uploads/${modelKey}`, put.status, put.text.slice(0, 160))
    pass('POST /api/uploads + /model + PUT (glb bytes)', 201)

    // 8 — the cart takes the product and the uploaded keys
    const cart = await request('POST', `${apiBase}/api/cart`, {
      json: {
        designJson: JSON.stringify({ size: 'M', shirtColor: '#FFFFFF', front: { elements: [] }, back: { elements: [] } }),
        unitPrice: 250000,
        productId,
        logoKey,
        modelKey,
        quantity: 1,
      },
      token: userToken,
    })
    const cartBody = body(cart)
    if (cart.status !== 201 || cartBody.items?.length !== 1) {
      fail('POST /api/cart', cart.status, cart.text.slice(0, 200))
    }
    pass('POST /api/cart -> 1 item', 201)

    // 9 — cash on delivery checkout
    const checkout = await request('POST', `${apiBase}/api/cart/checkout`, {
      json: { customerName: 'QA Smoke', customerPhone: '+998900000000', paymentMethod: 'cod' },
      token: userToken,
    })
    const order = body(checkout)
    if (checkout.status !== 201 || order.status !== 'new' || order.paymentUrl !== null) {
      fail('POST /api/cart/checkout (cod)', checkout.status, checkout.text.slice(0, 200))
    }
    pass('POST /api/cart/checkout -> status new, paymentUrl null', 201)

    // 10 — the admin moves the order and reads it back
    const moved = await request('PATCH', `${apiBase}/api/admin/orders/${order.id}/status`, { json: { status: 'confirmed' }, cookie: adminCookie })
    if (moved.status !== 200) fail(`PATCH /api/admin/orders/${order.id}/status`, moved.status, moved.text.slice(0, 200))
    const reread = await request('GET', `${apiBase}/api/admin/orders/${order.id}`, { cookie: adminCookie })
    if (reread.status !== 200 || body(reread).status !== 'confirmed') {
      fail(`GET /api/admin/orders/${order.id}`, reread.status, `status ${body(reread).status ?? '?'}`)
    }
    pass('PATCH order -> confirmed, read back confirmed', 200)

    // 11 — designer: apply, upload a 1600² artwork, submit, approve, list
    const apply = await request('POST', `${apiBase}/api/designer/apply`, { json: { handle: 'qa_smoke' }, token: userToken })
    if (apply.status !== 200) fail('POST /api/designer/apply', apply.status, apply.text.slice(0, 160))

    const artForm = new FormData()
    artForm.append('file', blob(png(1600), 'image/png'), 'qa-artwork.png')
    const artUpload = await request('POST', `${apiBase}/api/uploads`, { form: artForm, token: userToken })
    if (artUpload.status !== 201) fail('POST /api/uploads (artwork PNG)', artUpload.status, artUpload.text.slice(0, 160))

    const submit = await request('POST', `${apiBase}/api/designer/artworks`, {
      json: { title: 'QA Smoke artwork', image_key: body(artUpload).key, width: 1600, height: 1600, markup: 0 },
      token: userToken,
    })
    const artwork = body(submit)
    if (submit.status !== 201 || artwork.status !== 'pending') fail('POST /api/designer/artworks', submit.status, submit.text.slice(0, 200))

    const review = await request('POST', `${apiBase}/api/admin/artworks/${artwork.id}/review`, { json: { decision: 'approve' }, cookie: adminCookie })
    if (review.status !== 200) fail(`POST /api/admin/artworks/${artwork.id}/review`, review.status, review.text.slice(0, 200))

    const list = await request('GET', `${apiBase}/api/artworks`)
    const listed = (body(list).items ?? []).some((a) => a.id === artwork.id)
    if (list.status !== 200 || !listed) fail('GET /api/artworks', list.status, `artwork ${artwork.id} not listed`)
    pass('designer apply + artwork approved + listed', 200)
  } finally {
    stopWorker(workerLog)
    fs.rmSync(stateDir, { recursive: true, force: true })
  }
}

// ─── remote modes: anonymous GETs only (AC-2) ───────────────────────────────

function assetsOf(html, pageUrl) {
  const refs = new Map()
  // Anything a page can load with a cache-busting query: attributes, CSS url()
  // and strings built inside inline scripts all start at a quote or a paren.
  for (const match of html.matchAll(/["'(]([^"'\s()<>]+\?v=\d+)/g)) {
    const raw = match[1].split('#')[0]
    const url = new URL(raw, pageUrl).toString()
    refs.set(url, new URL(url).pathname.replace(/^\/+/, ''))
  }
  return [...refs.entries()].map(([url, file]) => ({ url, file }))
}

async function checkAsset(url, file) {
  const remote = await request('GET', url)
  if (remote.status !== 200) return { status: remote.status, note: `${file} -> ${remote.status}` }
  const localPath = path.join(REPO, file)
  if (!fs.existsSync(localPath)) return { status: 'fail', note: `${file} is not in this checkout` }
  const disk = fs.readFileSync(localPath)
  // Windows checkouts carry CRLF (core.autocrlf) while the deployed object is
  // the LF blob, so a text file matches either way; binaries match as they are.
  const hashes = new Set([
    createHash('sha256').update(disk).digest('hex'),
    createHash('sha256').update(disk.toString('utf8').replace(/\r\n/g, '\n')).digest('hex'),
  ])
  const live = createHash('sha256').update(remote.bytes).digest('hex')
  if (!hashes.has(live)) {
    return { status: 'fail', note: `${file} differs from the checkout (live ${live.slice(0, 12)} vs file ${[...hashes][0].slice(0, 12)})` }
  }
  return { ok: true, status: 200, note: file }
}

async function runRemote() {
  const root = await request('GET', `${apiBase}/`)
  const rootBody = body(root)
  if (root.status !== 200 || rootBody.status !== 'ok') fail('GET / (Worker)', root.status, root.text.slice(0, 120))
  pass('GET / -> status ok', 200)

  const products = await request('GET', `${apiBase}/api/products`)
  const list = body(products).products ?? []
  if (products.status !== 200 || !list.length) fail('GET /api/products', products.status, 'no products returned')
  pass('GET /api/products', 200, `${list.length} product(s), first ${list[0].slug}`)

  const first = list[0]
  const one = await request('GET', `${apiBase}/api/products/${first.slug}`)
  if (one.status !== 200) fail(`GET /api/products/${first.slug}`, one.status, one.text.slice(0, 120))
  pass(`GET /api/products/${first.slug}`, 200)

  // A ready-made design is sold without a mesh, so when the first product has
  // no glb_url the next one that does answers for the configurator here.
  const mesh = body(one).glb_url
    ? { slug: first.slug, url: body(one).glb_url }
    : list.filter((p) => p.glb_url).map((p) => ({ slug: p.slug, url: p.glb_url }))[0]
  if (!mesh) fail('GET glb_url', 'fail', 'no product in the list carries a glb_url')
  const glb = await request('GET', mesh.url)
  const cors = glb.headers.get('access-control-allow-origin')
  if (glb.status !== 200 || cors !== '*') fail(`GET glb_url (${mesh.slug})`, glb.status, `access-control-allow-origin: ${cors}`)
  pass(`GET glb_url (${mesh.slug}) -> access-control-allow-origin *`, 200)

  const me = await request('GET', `${apiBase}/api/admin/me`)
  if (me.status !== 401) fail('GET /api/admin/me (anonymous)', me.status)
  pass('GET /api/admin/me -> 401', 401)

  if (!pagesBase) {
    console.error('FAIL  no Pages URL to check (pass --pages URL or use the prod target)')
    process.exit(2)
  }

  const pages = ['/', '/catalog', '/configurator']
  let assets = []
  for (const p of pages) {
    const res = await request('GET', `${pagesBase}${p}`)
    if (res.status !== 200) fail(`GET ${pagesBase}${p}`, res.status)
    let found = []
    try {
      found = assetsOf(res.text, `${pagesBase}${p}`)
    } catch (err) {
      fail(`GET ${pagesBase}${p} — reading its ?v= assets`, 'fail', err?.message ?? 'unreadable')
    }
    pass(`GET ${pagesBase}${p}`, 200, `${found.length} ?v= asset(s)`)
    assets = assets.concat(found)
  }

  const seen = new Map(assets.map((a) => [a.url, a]))
  let checked = 0
  for (const a of seen.values()) {
    const result = await checkAsset(a.url, a.file)
    if (result.ok) checked++
    else fail(`?v= asset ${a.file}`, result.status, result.note)
  }
  pass(`${checked} ?v= asset(s) match this checkout byte for byte`, 200)

  const nonGet = log.filter((r) => r.method !== 'GET')
  const withCreds = log.filter((r) => r.credentials)
  if (nonGet.length || withCreds.length) {
    fail('remote requests are anonymous GETs', 'fail', `${nonGet.length} non-GET, ${withCreds.length} with credentials`)
  }
  pass(`every request a GET with no Cookie or Authorization`, `${log.length} requests`)
}

// ─── run ────────────────────────────────────────────────────────────────────

console.log(`\nLOOM smoke — ${mode}${mode === 'local' ? '' : `  api ${apiBase}`}${pagesBase ? `  pages ${pagesBase}` : ''}`)
try {
  if (mode === 'local') await runLocal()
  else await runRemote()
} catch (err) {
  if (err instanceof StepError) process.exit(1)
  console.error(`\nFAIL  ${err?.message ?? err}`)
  process.exit(1)
}

console.log(`\nsmoke:${mode} passed — ${steps.length} steps`)
if (mode === 'prod') {
  console.log('Watch Workers Logs (Cloudflare dashboard -> Workers -> loom-backend -> Logs) for the next 10 minutes.')
}
