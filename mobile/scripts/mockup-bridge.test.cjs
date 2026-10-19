const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

// Exercise the shared native/Expo-web TypeScript without a browser or bundler.
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, file)
const { mockupBridge } = require('../src/lib/mockup-html.ts')

const request = { design: { shirtColor: '#FFFFFF', front: [], back: [] }, rect: { x: 0, y: 0, w: 300, h: 400 }, size: 720 }
const mockups = { front: 'data:image/jpeg;base64,ZnJvbnQ=', back: 'data:image/jpeg;base64,YmFjaw==' }
const reply = (bridge, msg, result = mockups) => bridge.receive({ type: 'mockups', id: JSON.parse(msg).id, ...result })

test('an early add-to-cart waits for ready, sends once, and receives both sides', async () => {
  const bridge = mockupBridge(), sent = []
  const result = bridge.request(request, (msg) => sent.push(msg))
  assert.equal(sent.length, 0)
  let settled = false
  result.finally(() => { settled = true })
  await Promise.resolve()
  assert.equal(settled, false)
  bridge.receive('{invalid')
  bridge.receive({ type: 'ready' })
  bridge.receive({ type: 'ready' })
  assert.equal(sent.length, 1)
  assert.deepEqual(JSON.parse(sent[0]).design, request.design)
  reply(bridge, sent[0])
  assert.deepEqual(await result, mockups)
})

test('ready requests correlate out-of-order replies and ignore unrelated messages', async () => {
  const bridge = mockupBridge(), sent = []
  bridge.receive({ type: 'ready' })
  const first = bridge.request(request, (msg) => sent.push(msg))
  const second = bridge.request(request, (msg) => sent.push(msg))
  bridge.receive({ type: 'mockups', id: 999, ...mockups })
  reply(bridge, sent[1])
  reply(bridge, sent[0])
  assert.deepEqual(await first, mockups)
  assert.deepEqual(await second, mockups)
})

test('readiness and drawing share one six-second deadline; expired requests do not dispatch', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const bridge = mockupBridge(), sent = []
  const result = bridge.request(request, (msg) => sent.push(msg))
  const rejected = assert.rejects(result, /mockup_timeout/)
  t.mock.timers.tick(6000)
  await rejected
  bridge.receive({ type: 'ready' })
  assert.equal(sent.length, 0)
  const next = bridge.request(request, (msg) => sent.push(msg))
  const nextRejected = assert.rejects(next, /mockup_timeout/)
  t.mock.timers.tick(6000)
  await nextRejected
  reply(bridge, sent[0]) // late reply is harmless
})

test('time waiting for ready is included in the render deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const bridge = mockupBridge()
  const result = bridge.request(request, () => {})
  const rejected = assert.rejects(result, /mockup_timeout/)
  t.mock.timers.tick(5000)
  bridge.receive({ type: 'ready' })
  t.mock.timers.tick(1000)
  await rejected
})

test('missing or invalid sides reject, then a fresh attempt can succeed', async () => {
  const bridge = mockupBridge(), sent = []
  bridge.receive({ type: 'ready' })
  for (const invalid of [{ front: null, back: null }, { front: mockups.front, back: null }, { front: 42, back: mockups.back }]) {
    const result = bridge.request(request, (msg) => sent.push(msg))
    const rejected = assert.rejects(result, /mockup_render_failed/)
    reply(bridge, sent.at(-1), invalid)
    await rejected
  }
  const retry = bridge.request(request, (msg) => sent.push(msg))
  reply(bridge, sent.at(-1))
  assert.deepEqual(await retry, mockups)
})

test('send failure rejects and unmount cancels outstanding work without dispatching it later', async () => {
  const bridge = mockupBridge(), sent = []
  const waiting = bridge.request(request, (msg) => sent.push(msg))
  const rejected = assert.rejects(waiting, /mockup_unavailable/)
  bridge.dispose()
  await rejected
  bridge.receive({ type: 'ready' })
  assert.equal(sent.length, 0)
  await assert.rejects(bridge.request(request, () => { throw new Error('detached') }), /mockup_send_failed/)
  bridge.dispose()
})
