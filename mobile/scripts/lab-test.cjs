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
function modules(scenario = '', dev = true, platform = 'web', clock = { setTimeout, clearTimeout }) {
  const cache = new Map()
  const calls = []
  const imageCalls = []
  const writes = []
  const deleted = []
  const files = new Map()
  const client = { API_BASE: 'https://api.loomdesign.uz', ApiError, getToken: async () => 'local-test-token', api: async (url, options) => { calls.push({ url, options }); return { enabled: false } } }
  const fileSystem = {
    documentDirectory: 'file:///local-documents/',
    makeDirectoryAsync: async () => {},
    writeAsStringAsync: async (uri, contents, options) => { writes.push({ uri, contents, options }); files.set(uri, contents) },
    deleteAsync: async (uri) => { deleted.push(uri); files.delete(uri) },
    readDirectoryAsync: async (folder) => [...files.keys()].filter(uri => uri.startsWith(folder)).map(uri => uri.slice(folder.length)),
  }
  class FileReader {
    readAsDataURL(blob) {
      blob.arrayBuffer().then(bytes => {
        this.result = 'data:image/png;base64,' + Buffer.from(bytes).toString('base64')
        this.onload?.()
        this.onloadend?.()
      })
    }
    abort() {}
  }
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports
    const module = { exports: {} }
    cache.set(file, module)
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    const context = { module, exports: module.exports, __DEV__: dev, process: { env: { EXPO_PUBLIC_LAB_FIXTURE: scenario } }, AbortController, ...clock, URL, Blob, FileReader,
      fetch: async (url, options) => {
        imageCalls.push({ url, options })
        return { ok: true, status: 200, blob: async () => new Blob([Buffer.alloc(3 * 1024 * 1024)], { type: 'image/png' }) }
      },
      require: (name) => name === 'react-native' ? { Platform: { OS: platform } }
        : name === 'expo-file-system/legacy' ? fileSystem
          : name.endsWith('/client') || name === './client' ? client : load(path.resolve(path.dirname(file), name + '.ts')) }
    vm.runInNewContext(code, context, { filename: file })
    return module.exports
  }
  return { lab: load(path.resolve(__dirname, '../src/api/lab.ts')), fixture: load(path.resolve(__dirname, '../src/components/lab/fixture.ts')),
    generation: load(path.resolve(__dirname, '../src/components/lab/generation.ts')), client, calls, imageCalls, writes, deleted, files, fileSystem }
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

  const images = modules()
  for (const [url, authorized] of [
    ['https://api.loomdesign.uz/api/uploads/lab/test.png', true],
    ['https://API.LOOMDESIGN.UZ:443/api/uploads/lab/../test.png', true],
    ['https://images.example.com/test.png', false],
    ['https://api.loomdesign.uz.example.com/test.png', false],
    ['http://api.loomdesign.uz/test.png', false],
    ['https://api.loomdesign.uz:8443/test.png', false],
  ]) {
    const uri = await images.lab.loadLabImage(url, new AbortController().signal)
    const { options } = images.imageCalls.at(-1)
    assert.equal(images.imageCalls.at(-1).url, new URL(url).href, 'fetch the exact parsed URL')
    assert.equal(options.headers.Authorization, authorized ? 'Bearer local-test-token' : undefined, 'send credentials only to the API origin')
    assert.equal(options.credentials, 'omit')
    await images.lab.releaseLabImage(uri)
  }
  const native = modules('', true, 'android')
  const localImage = await native.lab.loadLabImage('https://api.loomdesign.uz/api/uploads/lab/test.png', new AbortController().signal)
  assert.ok(localImage.startsWith('file:///local-documents/lab/'))
  assert.equal(native.writes.length, 1)
  assert.equal(native.writes[0].options.encoding, 'base64')
  assert.equal(native.writes[0].contents.length, 4 * 1024 * 1024)
  assert.ok(JSON.stringify({ uri: localImage, uploadKey: 'lab/test.png', price: 0 }).length < 200)
  const sample = await native.lab.loadLabImage('data:image/png;base64,c2FtcGxl', new AbortController().signal)
  assert.ok(sample.startsWith('file:///local-documents/lab/'))
  assert.equal(native.writes.at(-1).contents, 'c2FtcGxl')
  await native.lab.releaseLabImage(localImage)
  assert.equal(native.files.has(localImage), false, 'replace/release deletes an unused native result')
  native.lab.retainLabDraftImage(sample)
  await native.lab.syncLabDraftImages([sample])
  await native.lab.releaseLabImage(sample)
  assert.equal(native.files.has(sample), true, 'preview cleanup must preserve draft art')
  const backImage = await native.lab.loadLabImage('data:image/png;base64,YmFjaw==', new AbortController().signal)
  native.lab.retainLabDraftImage(backImage)
  await native.lab.syncLabDraftImages([sample, backImage])
  await native.lab.releaseLabImage(backImage)
  await native.lab.syncLabDraftImages([backImage])
  assert.equal(native.files.has(sample), false, 'changing draft art deletes its previous Lab file')
  assert.equal(native.files.has(backImage), true, 'the other face must remain intact')
  await native.lab.syncLabDraftImages([])
  assert.equal(native.files.has(backImage), false, 'clearing the draft removes its final Lab file')
  const orphan = 'file:///local-documents/lab/lab-previous-session.png'
  const other = 'file:///local-documents/other.png'
  native.files.set(orphan, 'orphan')
  native.files.set(other, 'other')
  await native.lab.syncLabDraftImages([])
  assert.equal(native.files.has(orphan), false, 'reconcile stale files on Lab entry')
  await native.lab.releaseLabImage(other)
  assert.equal(native.files.has(other), true, 'cleanup owns only the Lab folder')

  const aborted = modules('', true, 'android')
  let finishWriting
  let beganWriting
  const writing = new Promise(resolve => { beganWriting = resolve })
  aborted.fileSystem.writeAsStringAsync = (uri, contents) => new Promise(resolve => {
    aborted.files.set(uri, contents)
    finishWriting = resolve
    beganWriting(uri)
  })
  const imageAbort = new AbortController()
  const pendingImage = aborted.lab.loadLabImage('data:image/png;base64,b3JwaGFu', imageAbort.signal)
  const unfinishedUri = await writing
  imageAbort.abort()
  finishWriting()
  await assert.rejects(pendingImage, { name: 'AbortError' })
  assert.equal(aborted.files.has(unfinishedUri), false, 'delete a file whose write finished after abort')

  const running = modules()
  let resolveRun
  const generationSignals = []
  running.client.api = (_url, options) => new Promise(resolve => {
    generationSignals.push(options.signal)
    resolveRun = resolve
  })
  const guard = running.generation.createLabGeneration()
  const first = guard.start('one visible request', 'minimal')
  guard.cancel()
  assert.equal(first.ignored, true)
  assert.equal(generationSignals[0].aborted, false, 'Cancel must not abort the server request')
  assert.equal(guard.busy, true)
  assert.equal(guard.start('immediate Chizish', 'minimal'), null)
  assert.equal(generationSignals.length, 1, 'cancel then immediate Chizish must start only one run')
  resolveRun({ remaining: 9 })
  assert.equal((await first.result).remaining, 9)
  assert.equal(guard.busy, false)
  const next = guard.start('after settlement', 'minimal')
  assert.equal(generationSignals.length, 2)
  assert.equal(next.ignored, false)
  resolveRun({ remaining: 8 })
  await next.result
  assert.equal(guard.busy, false)

  let timeout
  const timed = modules('', true, 'web', { setTimeout: (callback, ms) => {
    assert.equal(ms, 90000)
    timeout = callback
    return 1
  }, clearTimeout: () => {} })
  timed.client.api = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })))
  })
  const timedGuard = timed.generation.createLabGeneration()
  const timedRun = timedGuard.start('slow server', 'minimal')
  timedGuard.cancel()
  assert.equal(timedGuard.busy, true)
  timeout()
  await assert.rejects(timedRun.result, { code: 'timeout' })
  assert.equal(timedGuard.busy, false, 'the 90 s API timeout also releases the guard')

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
  console.log('PASS Lab contracts: parsed API-origin requests, durable file ownership/cleanup, abort orphans, cancel then Chizish, errors, balance, history, report and production fixture guard')
})().catch(error => { console.error(error); process.exitCode = 1 })
