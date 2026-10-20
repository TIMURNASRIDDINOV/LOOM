// LOOM-148: client routing and real Worker CORS, with local resources only.
// Run: node backend/scripts/preview-api-test.mjs (after npm ci in backend/).
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(backend, '..')
const require = createRequire(join(backend, 'package.json'))
const { build } = require('esbuild')
const { Miniflare } = require('miniflare')
const prod = 'https://api.loomdesign.uz'
const staging = 'https://loom-backend-staging.timurnasriddinov56.workers.dev'
const preview = 'https://3f2a1b9c.loom-site-d94.pages.dev'
const config = await readFile(join(repo, 'assets/config.js'), 'utf8')
const admin = await readFile(join(repo, 'admin/assets/app.js'), 'utf8')
const index = (await readFile(join(repo, 'admin/index.html'), 'utf8')).match(/<script>([\s\S]*?)<\/script>/)[1]
const hosts = [
  ['3f2a1b9c.loom-site-d94.pages.dev', staging],
  ['lane-148.loom-site-d94.pages.dev', staging],
  ['loomdesign.uz', prod], ['www.loomdesign.uz', prod],
  ['localhost', 'http://localhost:8787'], ['127.0.0.1', 'http://localhost:8787'],
  ['loom-site-d94.pages.dev', prod], ['evilloom-site-d94.pages.dev', prod],
  ['x.y.loom-site-d94.pages.dev', prod], ['x.loom-site-d94.pages.dev.evil.example', prod],
]

for (const [hostname, expected] of hosts) {
  const location = { hostname }
  const calls = []
  let fail = false
  const context = vm.createContext({
    location,
    window: { location, addEventListener() {} },
    document: { addEventListener() {} },
    fetch: async (url, options) => {
      calls.push([url, options])
      if (fail) throw new Error('staging unavailable')
      return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) }
    },
  })
  vm.runInContext(config, context)
  assert.equal(context.window.LOOM_CONFIG.API_BASE, expected, `customer: ${hostname}`)
  vm.runInContext(admin, context)
  assert.equal(context.window.LOOM.API_BASE, expected, `admin: ${hostname}`)
  await vm.runInContext(index, context)
  assert.equal(calls[0][0], expected + '/api/admin/me')
  assert.equal(location.href, 'login.html')
  await assert.rejects(context.window.LOOM.apiJSON('/api/admin/login', { method: 'POST' }), { status: 401 })
  assert.equal(calls[1][0], expected + '/api/admin/login')
  assert.equal(calls[1][1].credentials, 'include')
  fail = true
  await vm.runInContext(index, context)
  assert.equal(location.href, 'login.html')
  await assert.rejects(context.window.LOOM.apiJSON('/api/admin/me'), /unavailable/)
  assert.equal(calls.length, 4, 'failures must not trigger retries to another API')
  assert.ok(calls.every(([url]) => url.startsWith(expected + '/')), hostname)
}
console.log(`PASS client host matrix: ${hosts.length} hosts, admin 401 and network failure`)

const scratch = await mkdtemp(join(tmpdir(), 'loom-148-'))
try {
  await build({ entryPoints: [join(backend, 'src/index.ts')], outfile: join(scratch, 'worker.mjs'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022' })
  for (const environment of ['staging', 'production', 'development']) {
    const mf = new Miniflare({ modules: true, modulesRoot: scratch, scriptPath: join(scratch, 'worker.mjs'), compatibilityDate: '2024-09-23', cf: false,
      bindings: { ENVIRONMENT: environment } })
    try {
      const origins = [
        preview, 'https://lane-148.loom-site-d94.pages.dev',
        'https://evilloom-site-d94.pages.dev', 'https://loom-site-d94.pages.dev',
        'https://x.y.loom-site-d94.pages.dev', preview + '.evil.example',
        preview.replace('https:', 'http:'), preview + ':8443',
        'https://loomdesign.uz', 'https://www.loomdesign.uz', 'https://admin.loomdesign.uz',
        'http://localhost:3000', 'http://localhost:8787',
      ]
      for (const origin of origins) {
        const allowed = ['https://loomdesign.uz', 'https://www.loomdesign.uz', 'https://admin.loomdesign.uz']
        if (environment !== 'production') allowed.push('http://localhost:3000', 'http://localhost:8787')
        if (environment === 'staging') allowed.push(preview, 'https://lane-148.loom-site-d94.pages.dev')
        const expected = allowed.includes(origin) ? origin : 'https://loomdesign.uz'
        for (const method of ['OPTIONS', 'GET']) {
          const res = await mf.dispatchFetch('http://localhost/api/admin/me', { method,
            headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' } })
          assert.equal(res.status, method === 'OPTIONS' ? 204 : 401)
          assert.equal(res.headers.get('access-control-allow-origin'), expected, `${environment}: ${origin}`)
          assert.equal(res.headers.get('access-control-allow-credentials'), 'true')
        }
      }
      console.log(`PASS ${environment} CORS: ${origins.length} origins, OPTIONS and anonymous GET`)
    } finally {
      await mf.dispose()
    }
  }
} finally {
  await rm(scratch, { recursive: true, force: true })
}
