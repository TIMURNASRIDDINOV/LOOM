// LOOM-250: contract/error and fixture regression checks. No network or new dependencies.
// Run after mobile/npm ci: node mobile/scripts/lab-test.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { setTimeout: wait } = require('node:timers/promises')
class ApiError extends Error {
  constructor(message, status, code, details) { super(message); Object.assign(this, { status, code, details }) }
}
function modules(scenario = '', dev = true) {
  const cache = new Map()
  const calls = []
  const client = { ApiError, getToken: async () => 'local-test-token', api: async (url, options) => { calls.push({ url, options }); return { enabled: false } } }
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports
    const module = { exports: {} }
    cache.set(file, module)
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    const context = { module, exports: module.exports, __DEV__: dev, process: { env: { EXPO_PUBLIC_LAB_FIXTURE: scenario } }, AbortController, setTimeout, clearTimeout,
      require: (name) => name.endsWith('/client') || name === './client' ? client : load(path.resolve(path.dirname(file), name + '.ts')) }
    vm.runInNewContext(code, context, { filename: file })
    return module.exports
  }
  return { lab: load(path.resolve(__dirname, '../src/api/lab.ts')), fixture: load(path.resolve(__dirname, '../src/components/lab/fixture.ts')), calls }
}
;(async () => {
  const { lab, calls } = modules()
  const matrix = [
    [401, undefined, 'login'], [401, 'session_revoked', 'login'], [401, 'account_banned', 'login'],
    [503, 'lab_disabled', 'disabled'], [429, 'lab_limit_reached', 'limit'], [422, 'prompt_refused', 'refused'],
    [429, 'lab_global_cap', 'later'], [502, 'generation_failed', 'failed'], [502, 'cutout_failed', 'failed'],
    [504, 'timeout', 'failed'], [502, undefined, 'failed'], [0, undefined, 'offline'], [400, 'invalid_request', 'invalid'],
  ]
  for (const [status, code, problem] of matrix) assert.equal(lab.labProblem(new ApiError('server copy must not be shown', status, code)), problem)
  assert.equal(lab.labMessage(new ApiError('raw', 404, 'not_found')), 'lab.reportFailed')
  await lab.getLabStatus(false)
  await lab.generateLab('  pattern  ', 'uzbek', new AbortController().signal)
  await lab.getLabHistory(2)
  await lab.reportLab('run-one')
  assert.deepEqual(calls.map(c => c.url), ['/api/lab/status', '/api/lab/generate', '/api/lab/history?page=2', '/api/lab/report'])
  assert.ok(calls.every(c => c.options.auth === true))
  assert.equal(calls[1].options.body.prompt, 'pattern')
  assert.equal(calls[1].options.body.style, 'uzbek')
  assert.equal(calls[3].options.body.variant, 0)
  assert.equal(calls[3].options.body.runId, 'run-one')

  const { fixture } = modules()
  const good = fixture.createLabFixture('success')
  assert.equal((await good.status(false)).remaining, null)
  assert.equal((await good.status(true)).remaining, 3)
  const run = await good.generate('  so‘zana uslubidagi anor naqshi  ', 'uzbek', new AbortController().signal)
  assert.equal(run.variants.length, 1)
  assert.ok(run.variants[0].url.startsWith('data:image/png;base64,'))
  assert.equal(run.remaining, 2)
  await good.report(run.runId)
  assert.equal((await good.status(true)).remaining, 2)
  await good.generate('second', 'retro', new AbortController().signal)
  await good.generate('third', 'street', new AbortController().signal)
  await assert.rejects(good.generate('fourth', 'minimal', new AbortController().signal), { code: 'lab_limit_reached' })
  assert.equal((await good.status(true)).remaining, 0)
  const history = await good.history(1)
  assert.equal(history.runs.length, 3)
  assert.equal(history.runs[0].prompt, 'third')

  for (const code of ['prompt_refused', 'lab_global_cap', 'generation_failed', 'cutout_failed', 'timeout', '502']) {
    const failed = fixture.createLabFixture(code)
    await assert.rejects(failed.generate('pattern', 'minimal', new AbortController().signal))
    assert.equal((await failed.status(true)).remaining, 3, code + ' must not spend balance')
    assert.equal((await failed.history(1)).runs.length, 0)
  }
  const cancel = fixture.createLabFixture('success')
  const ctrl = new AbortController()
  const job = cancel.generate('cancelled wait', 'minimal', ctrl.signal)
  ctrl.abort()
  await assert.rejects(job, { name: 'AbortError' })
  await wait(1500)
  assert.equal((await cancel.status(true)).remaining, 2, 'server success after cancel still spends one')
  assert.equal((await cancel.history(1)).runs.length, 1)
  const reports = fixture.createLabFixture('report_failed')
  await assert.rejects(reports.report('run-one'))
  const offline = fixture.createLabFixture('offline')
  await assert.rejects(offline.history(1), { status: 0 })
  assert.equal((await fixture.createLabFixture('empty').history(1)).runs.length, 0)
  const production = modules('success', false)
  await production.lab.getLabStatus(true)
  assert.equal(production.calls.length, 1, 'production must ignore the fixture override')
  console.log('PASS Lab contracts: 13 error cases, API payloads, balance, single image, history, cancel, offline, report failure and production fixture guard')
})().catch(error => { console.error(error); process.exitCode = 1 })
