#!/usr/bin/env node
'use strict'

/* LOOM-262 hardening harness. Drives the app's 3D scene page (built from
 * src/lib/scene-html.ts) in desktop Chromium with software GL and injects the
 * failures a phone can produce: no WebGL, an environment map that throws or
 * fails to link, a shader that does not link, a lost context, a refused or
 * missing model, a script that returns 404/500, touch gestures, pause/resume.
 *
 *   node mobile/scripts/hardening-harness.cjs [--out DIR] [--port 8794] [--chrome PATH]
 *                                             [--baseline-dir DIR] [--scene-dir DIR] [--only a,b,c]
 *
 * · The page's host messages (ReactNativeWebView.postMessage) are captured with a shim;
 *   network requests come from the DevTools Network domain, so "first font request after
 *   the ready message" is checked on one clock (epoch ms).
 * · Only localhost resolves; fonts.googleapis.com fails fast but its request is still seen.
 * · --scene-dir runs another copy of scene-html.ts + print.ts instead of the working copy.
 * · --baseline-dir points at a copy of scene-html.ts + print.ts (e.g. origin/main) to
 *   compare the estimated texture memory with. Without it the 190 MB baseline of the
 *   ticket is computed from five 2048² canvases.
 * · Texture memory estimate = every distinct map of the scene's materials,
 *   w*h*4 bytes of canvas bitmap + w*h*4*4/3 bytes of GPU texture with mipmaps.
 * · Cases that need a touch screen run with touch emulation; real touch scrolling,
 *   the Android WebView and the phone's GPU are not covered (PENDING-OWNER). */

const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { MIME, CHROME_DEFAULT, sleep, launchChrome, openPage, LOG, ANALYSIS_JS } = require('./lib/browser.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const MOBILE = path.join(ROOT, 'mobile')
const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf('--' + k)
  return i >= 0 ? argv[i + 1] : d
}
const PORT = parseInt(arg('port', '8794'), 10)
const OUT = path.resolve(arg('out', path.join(os.tmpdir(), 'hardening-harness')))
const CHROME = arg('chrome', CHROME_DEFAULT)
const BASELINE = arg('baseline-dir', '')
const ONLY = arg('only', '')
const ORIGIN = `http://localhost:${PORT}`
const SIZE = [360, 360] // the studio's square stage, CSS px
const PAPER = '#f4f2ed'

// ── Scene HTML from the TypeScript source ───────────────────────────────────
const TMP_DIRS = [] // hard-scene-* dirs, removed on every exit path (pass, fail, crash, Ctrl-C)
process.on('exit', () => TMP_DIRS.forEach((d) => fs.rmSync(d, { recursive: true, force: true })))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130))

function loadScene(dir) {
  const ts = require(require.resolve('typescript', { paths: [MOBILE] }))
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hard-scene-'))
  TMP_DIRS.push(tmp)
  for (const f of ['scene-html.ts', 'print.ts']) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
    fs.writeFileSync(path.join(tmp, f.replace('.ts', '.js')), js)
  }
  process.env.EXPO_PUBLIC_SITE_ORIGIN = ORIGIN
  return require(path.join(tmp, 'scene-html.js'))
}

// Recorded by every case: the renderer/scene of the first render, and a render counter.
const RENDER_HOOK =
  '(function(){var Orig=THREE.WebGLRenderer;window.__frames=0;' +
  'THREE.WebGLRenderer=function(p){var r=new Orig(p),o=r.render;' +
  'r.render=function(s,c){window.__R=r;window.__S=s;window.__C=c;window.__frames++;return o.apply(r,arguments)};return r};' +
  'THREE.WebGLRenderer.prototype=Orig.prototype})();'

function sceneHtml(mod, { inScroll = false, hook = '' } = {}) {
  const html = mod.buildSceneHtml({ glbUrl: `${ORIGIN}/assets/models/t_shirt.meshopt.glb?v=1`, background: PAPER, view: 'front', autoRotate: false, inScroll })
  const marker = '<script>window.__LOOM_CFG='
  if (!html.includes(marker)) throw new Error('scene HTML has no config marker')
  return html.replace(marker, `<script>${RENDER_HOOK}${hook}</script>` + marker)
}

// ── Server: the working copy, the generated pages, and switches for failures ─
const state = { pages: {}, glb: 'ok', script: null } // glb: ok | 503 | 404 | reset | hang ; script: {file, status}
const hits = []
function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, ORIGIN)
    hits.push(url.pathname)
    const page = url.pathname.startsWith('/__h/') && state.pages[url.pathname.slice(5).replace(/\.html$/, '')]
    if (page) {
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' })
      return res.end(page)
    }
    if (url.pathname.endsWith('.glb') && state.glb !== 'ok') {
      if (state.glb === 'hang') return // never answered
      if (state.glb === 'reset') return req.socket.destroy()
      res.writeHead(Number(state.glb), { 'content-type': 'text/plain' })
      return res.end('refused')
    }
    if (state.script && url.pathname.endsWith('/' + state.script.file)) {
      res.writeHead(state.script.status, { 'content-type': 'text/plain' })
      return res.end('refused')
    }
    let rel = decodeURIComponent(url.pathname)
    if (rel === '/') rel = '/index.html'
    const file = path.normalize(path.join(ROOT, rel))
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404)
      return res.end('not found')
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(PORT, '127.0.0.1', () => resolve(server))
  })
}

// ── One page with message + network capture ─────────────────────────────────
const SHIM =
  "window.ReactNativeWebView={postMessage:function(s){console.debug('__msg',s)}};" +
  'window.__errors=[];window.addEventListener("error",function(e){window.__errors.push(e.message)});'

async function openScene(cdp, { name, html, touch = false, shim = '', size = SIZE, dpr = 2 }) {
  state.pages[name] = html
  const rec = { msgs: [], reqs: [], exceptions: 0 }
  const handler = (m) => {
    const a = m.params || {}
    if (m.method === 'Runtime.consoleAPICalled' && a.type === 'debug' && a.args[0] && a.args[0].value === '__msg') {
      try { rec.msgs.push({ at: a.timestamp, ...JSON.parse(a.args[1].value) }) } catch (_) { /* not ours */ }
    }
    if (m.method === 'Network.requestWillBeSent') rec.reqs.push({ at: a.wallTime * 1000, url: a.request.url })
    if (m.method === 'Runtime.exceptionThrown') rec.exceptions++
  }
  const page = await openPage(cdp, { width: size[0], height: size[1], dpr, touch, onNewDocument: SHIM + shim, domains: ['Network'] })
  const h2 = (m) => m.sessionId === page.sessionId && handler(m)
  cdp.handlers.push(h2)
  await page.goto(`${ORIGIN}/__h/${name}.html`)
  rec.last = (type) => [...rec.msgs].reverse().find((x) => x.type === type)
  rec.has = (type) => rec.msgs.some((x) => x.type === type)
  rec.diag = () => (rec.last('diag') || {}).diag || {}
  rec.waitMsg = async (type, ms = 30000) => {
    const t0 = Date.now()
    while (!rec.has(type)) {
      if (Date.now() - t0 > ms) throw new Error(`no ${type} message within ${ms} ms (got ${rec.msgs.map((x) => x.type).join(',') || 'none'})`)
      await sleep(100)
    }
  }
  rec.close = async () => {
    cdp.handlers.splice(cdp.handlers.indexOf(h2), 1)
    await page.close()
  }
  return { page, rec }
}

const snap = (page, w = SIZE[0], h = SIZE[1]) =>
  page.eval('(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return __loom.snapshot(1,' + w + ',' + h + ')})()')

// Distinct maps of the scene's materials → MB (see the header for the formula).
const TEXMEM_JS = `(function(){
  var seen = new Set(), bytes = 0, list = [];
  __S.traverse(function(o){ if (!o.isMesh) return; var m = o.material;
    ['map','normalMap','roughnessMap'].forEach(function(k){ var t = m[k]; if (!t || seen.has(t.uuid)) return; seen.add(t.uuid);
      var w = t.image.width, h = t.image.height; bytes += w*h*4*(1+4/3); list.push(k+' '+w+'x'+h); }); });
  return { mb: Math.round(bytes/1048576*10)/10, maps: list };
})()`

// ── Cases ───────────────────────────────────────────────────────────────────
const results = []
const record = (name, checks, extra = {}) => {
  const failed = checks.filter((c) => !c[1])
  results.push({ name, pass: failed.length === 0, checks: checks.map(([k, ok, v]) => ({ check: k, ok, value: v })), ...extra })
  console.log(`${failed.length ? 'FAIL' : 'PASS'}  ${name}`)
  for (const [k, ok, v] of checks) console.log(`        ${ok ? 'ok  ' : 'FAIL'} ${k}${v === undefined ? '' : ' = ' + JSON.stringify(v)}`)
}

function cases(ctx) {
  const { cdp, analysis, mod, baseMod } = ctx
  const open = (o) => openScene(cdp, { size: SIZE, ...o })
  const luma = async (page) => (await analysis.eval(`__stats(${JSON.stringify(await snap(page))})`))
  const white = (page) => page.eval("__loom.update({shirtColor:'#FFFFFF',front:[],back:[]}); true").then(() => sleep(400))

  return {
    // AC-1, AC-5 numbers, AC-7 fields
    async happy() {
      state.glb = 'ok'; state.script = null
      const { page, rec } = await open({ name: 'happy', html: sceneHtml(mod) })
      await rec.waitMsg('ready')
      await sleep(2500) // let the post-frame font request go out
      const ready = rec.last('ready').at
      const fontReq = rec.reqs.filter((r) => r.url.includes('fonts.googleapis.com')).map((r) => r.at)
      const scriptReq = rec.reqs.filter((r) => r.url.includes('/assets/vendor/')).map((r) => r.at)
      const glbReq = rec.reqs.filter((r) => r.url.endsWith('.glb?v=1')).map((r) => r.at)
      const d = rec.diag()
      const mem = await page.eval(TEXMEM_JS)
      record('AC-1/AC-7 happy path: load order and diag fields', [
        ['font stylesheet requested', fontReq.length >= 1, fontReq.length],
        ['first font request is AFTER the ready message (ms)', fontReq.length > 0 && Math.min(...fontReq) > ready, fontReq.length ? Math.round(Math.min(...fontReq) - ready) : null],
        ['all vendor scripts and the model were requested BEFORE ready', Math.max(...scriptReq, ...glbReq) < ready, { scripts: scriptReq.length, glb: glbReq.length }],
        ['diag.webgl2 boolean', typeof d.webgl2 === 'boolean', d.webgl2],
        ['diag.gpu non-empty string', typeof d.gpu === 'string' && d.gpu.length > 0, d.gpu],
        ['diag.maxTex number', Number.isFinite(d.maxTex), d.maxTex],
        ['diag.dpr, w, h numbers', [d.dpr, d.w, d.h].every(Number.isFinite), [d.dpr, d.w, d.h]],
        ['diag.canvas = drawing buffer (w*dpr, h*dpr)', Array.isArray(d.canvas) && d.canvas[0] === d.w * 2 && d.canvas[1] === d.h * 2, d.canvas],
        ['diag.env true', d.env === true, d.env],
        ['diag timings scripts / glb / first frame are numbers, first frame after scripts', [d.tScripts, d.tGlb, d.tFirst].every(Number.isFinite) && d.tFirst >= d.tScripts, [d.tScripts, d.tGlb, d.tFirst]],
        ['diag.lastError null', d.lastError === null, d.lastError],
        ['no page exceptions', rec.exceptions === 0, rec.exceptions],
        ['fabric maps arrived', await page.eval('__loom.debug().fabric'), undefined],
      ], { timings: d, mem })
      await rec.close()
    },

    // AC-5: memory
    async memory() {
      state.glb = 'ok'; state.script = null
      const live = await open({ name: 'mem', html: sceneHtml(mod) })
      await live.rec.waitMsg('ready')
      await live.page.waitFor('__loom.debug().fabric', 'fabric maps')
      const now = await live.page.eval(TEXMEM_JS)
      await live.rec.close()
      let base = { mb: 5 * 2048 * 2048 * 4 * (7 / 3) / 1048576, maps: ['(computed) 5 x 2048x2048'] }
      if (baseMod) {
        const b = await open({ name: 'mem-base', html: sceneHtml(baseMod) })
        await b.rec.waitMsg('ready')
        await b.page.waitFor('__loom.debug().fabric', 'baseline fabric maps')
        base = await b.page.eval(TEXMEM_JS)
        await b.rec.close()
      }
      record('AC-5 estimated texture memory', [
        [`estimate <= 95 MB (baseline ${Math.round(base.mb * 10) / 10} MB)`, now.mb <= 95, now.mb],
        ['estimate <= 50% of the baseline', now.mb <= base.mb * 0.5, Math.round((now.mb / base.mb) * 100) + '%'],
        ['every map <= 1024x1024', now.maps.every((m) => /(\d+)x\1$/.test(m) && Number(m.split(' ')[1].split('x')[0]) <= 1024), now.maps],
      ], { now, base })
    },

    // AC-5: the 20 pt sample text is still legible (screenshots for the eye, plus the text position)
    async legibility() {
      const out = {}
      for (const [label, m] of [['live', mod], ['baseline', baseMod || mod]]) {
        const { page, rec } = await open({ name: 'leg-' + label, html: sceneHtml(m), size: [360, 360] })
        await rec.waitMsg('ready')
        await page.waitFor('__loom.debug().fabric', 'fabric')
        // 20 pt on the 30 x 40 cm platen = 7.06 mm = 21.8 px of the 928 x 1120 reference rect.
        const design = { shirtColor: '#FFFFFF', back: [], front: [{ type: 'text', content: 'Hello LOOM 20pt', font: 'Inter', bold: true, color: '#131311', size: 22, nx: 0.5, ny: 0.4, rotation: 0 }, { type: 'text', content: 'Size 40', font: 'Inter Tight', bold: true, color: '#131311', size: 44, nx: 0.5, ny: 0.62, rotation: 0 }] }
        await page.eval(`__loom.update(${JSON.stringify(design)}); true`)
        await sleep(3500) // fonts request fails offline: the fallback face is used on both sides
        const full = await page.eval(`(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return __loom.snapshot(1, 720, 720)})()`)
        const zoom = await page.eval(`(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return __loom.snapshot(2, 720, 720)})()`)
        out[label] = { full, zoom }
        await rec.close()
      }
      fs.mkdirSync(OUT, { recursive: true })
      for (const [label, v] of Object.entries(out)) for (const [k, u] of Object.entries(v)) {
        const flat = await analysis.eval(`__flat(${JSON.stringify(u)}, '${PAPER}')`)
        fs.writeFileSync(path.join(OUT, `text20pt-${label}-${k}.png`), Buffer.from(flat.split(',')[1], 'base64'))
      }
      record('AC-5 20 pt sample text screenshots written (judge by eye)', [['PNGs written', true, ['text20pt-live-full.png', 'text20pt-live-zoom.png', 'text20pt-baseline-full.png', 'text20pt-baseline-zoom.png']]])
    },

    // AC-2: the renderer cannot be created
    async rendererNull() {
      state.glb = 'ok'; state.script = null
      const shim = "var _gc=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t){if(/webgl/.test(String(t)))return null;return _gc.apply(this,arguments)};"
      const { rec } = await open({ name: 'rnull', html: sceneHtml(mod), shim })
      await rec.waitMsg('error')
      await sleep(500)
      const d = rec.diag(), e = rec.last('error')
      record('AC-2 renderer null (getContext returns null)', [
        ['diag posted with the error', /renderer/.test(d.lastError || ''), d.lastError],
        ['diag.webgl2 false', d.webgl2 === false, d.webgl2],
        ['error message kind unavailable', e.kind === 'unavailable', e.kind],
        ['no ready message', !rec.has('ready'), undefined],
        ['no uncaught exception', rec.exceptions === 0, rec.exceptions],
      ])
      await rec.close()
    },

    // AC-2: the environment map throws / fails to link; the white tee stays >= 180
    async envThrows() {
      state.glb = 'ok'; state.script = null
      const hooks = {
        throws: "THREE.PMREMGenerator=function(){throw new Error('forced env failure')};",
        missing: 'THREE.PMREMGenerator=undefined;',
        // A link failure only while the generator runs: leaves a black map, not an exception.
        link: "(function(){var gp=WebGL2RenderingContext.prototype.getProgramParameter,fs=THREE.PMREMGenerator.prototype.fromScene;window.__fail=false;" +
          "WebGL2RenderingContext.prototype.getProgramParameter=function(p,n){if(window.__fail&&n===this.LINK_STATUS)return false;return gp.apply(this,arguments)};" +
          "THREE.PMREMGenerator.prototype.fromScene=function(){window.__fail=true;try{return fs.apply(this,arguments)}finally{window.__fail=false}}})();",
      }
      for (const [how, hook] of Object.entries(hooks)) {
        const { page, rec } = await open({ name: 'env-' + how, html: sceneHtml(mod, { hook }) })
        await rec.waitMsg('ready')
        await white(page)
        const w = await luma(page)
        const d = rec.diag()
        record(`AC-2 environment map fails (${how})`, [
          ['scene still renders: ready posted', rec.has('ready'), undefined],
          ['diag.env false', d.env === false, d.env],
          ['diag.lastError names the environment', /^environment:/.test(d.lastError || ''), d.lastError],
          ['white tee chest luminance >= 180', w.chestLuma >= 180, w.chestLuma],
          ['white tee mean (info)', true, w.mean],
          ['no error message (it still renders)', !rec.has('error'), undefined],
        ], { white: w })
        if (how === 'throws') {
          const out = {}
          for (const [n, hex] of Object.entries({ black: '#000000', navy: '#2b3e5e' })) {
            await page.eval(`__loom.update({shirtColor:'${hex}',front:[],back:[]}); true`); await sleep(400)
            out[n] = await luma(page)
          }
          results[results.length - 1].noEnvOtherColours = { black: out.black.mean, navy: out.navy.chestRGB }
        }
        await rec.close()
      }
    },

    // AC-2 (PM note): a shader that does not link must not give a black mesh with ready posted
    async shaderFails() {
      state.glb = 'ok'; state.script = null
      const hook = "(function(){var gp=WebGL2RenderingContext.prototype.getProgramParameter,fs=THREE.PMREMGenerator.prototype.fromScene;window.__fail=false;" +
        "WebGL2RenderingContext.prototype.getProgramParameter=function(p,n){if(window.__fail&&n===this.LINK_STATUS)return false;return gp.apply(this,arguments)};" +
        'THREE.PMREMGenerator.prototype.fromScene=function(){var r=fs.apply(this,arguments);window.__fail=true;return r}})();'
      const { page, rec } = await open({ name: 'shader', html: sceneHtml(mod, { hook }) })
      await rec.waitMsg('error')
      await sleep(800)
      const d = rec.diag(), e = rec.last('error')
      const frames0 = await page.eval('window.__frames'); await sleep(500); const frames1 = await page.eval('window.__frames')
      record('PM note: a program that does not link', [
        ['error posted, kind unavailable', e.kind === 'unavailable', e.kind],
        ['diag.lastError names the shader', /^shader \w+:/.test(d.lastError || ''), d.lastError],
        ['ready is NOT posted', !rec.has('ready'), undefined],
        ['render loop stopped after the failure', frames1 === frames0, [frames0, frames1]],
      ])
      await rec.close()
    },

    // R-11: a context lost after ready
    async contextLost() {
      state.glb = 'ok'; state.script = null
      const { page, rec } = await open({ name: 'lost', html: sceneHtml(mod) })
      await rec.waitMsg('ready')
      await page.eval("__R.getContext().getExtension('WEBGL_lose_context').loseContext(); true")
      await rec.waitMsg('error')
      const d = rec.diag(), e = rec.last('error')
      record('R-11 WebGL context lost after ready', [
        ['error kind unavailable', e.kind === 'unavailable', e.kind],
        ['diag.lastError', d.lastError === 'WebGL context lost', d.lastError],
      ])
      await rec.close()
    },

    // AC-3 (page side) and AC-4: model and scripts refused
    async httpErrors() {
      const probes = [
        ['GLB 503', () => { state.glb = '503'; state.script = null }, /^GLB HTTP 503$/],
        ['GLB 404', () => { state.glb = '404'; state.script = null }, /^GLB HTTP 404$/],
        ['GLB connection reset', () => { state.glb = 'reset'; state.script = null }, /^GLB failed to load/],
        ['script 404', () => { state.glb = 'ok'; state.script = { file: 'OrbitControls.js', status: 404 } }, /^scripts: OrbitControls\.js HTTP 404$/],
        ['script 500', () => { state.glb = 'ok'; state.script = { file: 'GLTFLoader.js', status: 500 } }, /^scripts: GLTFLoader\.js HTTP 500$/],
      ]
      for (const [label, set, re] of probes) {
        set()
        const { rec } = await open({ name: 'http-' + label.replace(/\W+/g, '-'), html: sceneHtml(mod) })
        await rec.waitMsg('error', 20000)
        await sleep(300)
        const d = rec.diag(), e = rec.last('error')
        record(`AC-4 ${label}`, [
          ['error posted, kind load', e.kind === 'load', e.kind],
          ['diag.lastError records the status or reason', re.test(d.lastError || ''), d.lastError],
          ['no ready message', !rec.has('ready'), undefined],
        ])
        await rec.close()
      }
      state.glb = 'ok'; state.script = null
    },

    // PM note 2: pause/resume
    async pauseResume() {
      state.glb = 'ok'; state.script = null
      const { page, rec } = await open({ name: 'pause', html: sceneHtml(mod) })
      await rec.waitMsg('ready')
      const frames = async (ms) => { const a = await page.eval('window.__frames'); await sleep(ms); return (await page.eval('window.__frames')) - a }
      // Count render-loop callbacks against distinct animation frames: two loops would run two
      // callbacks per frame. The ratio does not depend on how slow software GL is under load.
      await page.eval('(function(){var o=window.requestAnimationFrame;window.__cb=0;window.__ticks=new Set();window.requestAnimationFrame=function(f){return o.call(window,function(t){__cb++;__ticks.add(t);f(t)})}})(); true')
      const running = await frames(1500)
      await page.eval('__loom.pause(); true'); await sleep(100)
      const paused = await frames(800)
      await page.eval("window.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'resume'})})); true")
      const resumed = await frames(1500)
      await page.eval("window.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'pause'})})); true"); await sleep(100)
      const pausedByMsg = await frames(800)
      await page.eval('window.__cb = 0; window.__ticks.clear(); __loom.resume(); __loom.resume(); true')
      const again = await frames(1500)
      const { cb, ticks } = await page.eval('({ cb: __cb, ticks: __ticks.size })')
      record('PM note: pause/resume of the render loop', [
        ['renders while running (frames in 1.5 s, software GL)', running > 0, running],
        ['no frames while paused (800 ms)', paused === 0, paused],
        ["'resume' message restarts it", resumed > 0, resumed],
        ["'pause' message stops it", pausedByMsg === 0, pausedByMsg],
        ['a second resume() does not start a second loop (one callback per animation frame)', again > 0 && cb <= ticks * 1.1 + 1, `frames ${again}, callbacks ${cb}, animation frames ${ticks}`],
      ])
      await rec.close()
    },

    // AC-6: scroll versus rotate
    async touch() {
      state.glb = 'ok'; state.script = null
      const out = {}
      for (const inScroll of [true, false]) {
        const { page, rec } = await open({ name: 'touch-' + inScroll, html: sceneHtml(mod, { inScroll }), touch: true, shim: "window.__ts=[];addEventListener('touchstart',function(e){__ts.push(e.defaultPrevented)});" })
        await rec.waitMsg('ready')
        await page.eval('document.getElementById("c").getBoundingClientRect().width') // layout settled
        const cam = () => page.eval('__loom.debug().camera')
        const tc = (type, pts) => page.call('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) })
        const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
        const drag = async (from, to, steps = 8) => {
          await tc('touchStart', [from])
          for (let i = 1; i <= steps; i++) { await tc('touchMove', [[from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps]]); await sleep(20) }
          await tc('touchEnd', [])
          await sleep(500) // damping settles
        }
        const r = { css: await page.eval('getComputedStyle(document.getElementById("c")).touchAction') }
        let c0 = await cam(); await drag([180, 120], [180, 260]); let c1 = await cam()
        r.vertical = dist(c0, c1)
        c0 = await cam(); await drag([100, 180], [260, 180]); c1 = await cam()
        r.horizontal = dist(c0, c1)
        // pinch out: two fingers moving apart; the camera moves along the view axis
        r.startPrevented = await page.eval('window.__ts') // single-finger starts so far; the pinch's own start is the controls' business
        const t0 = await page.eval('__loom.debug().target'); c0 = await cam()
        await tc('touchStart', [[150, 180], [210, 180]])
        for (let i = 1; i <= 8; i++) { await tc('touchMove', [[150 - i * 8, 180], [210 + i * 8, 180]]); await sleep(20) }
        await tc('touchEnd', []); await sleep(600); c1 = await cam()
        r.pinch = Math.abs(dist(c1, t0) - dist(c0, t0))
        out[inScroll ? 'scroller' : 'plain'] = r
        await rec.close()
      }
      const s = out.scroller, p = out.plain
      record('AC-6 scroll versus rotate (page side, touch emulation)', [
        ['scroller: touch-action pan-y', s.css === 'pan-y', s.css],
        ['scroller: vertical swipe does not rotate (camera moved)', s.vertical < 0.01, s.vertical],
        ['scroller: no touchstart was cancelled (the page may scroll)', s.startPrevented.length > 0 && s.startPrevented.every((x) => x === false), s.startPrevented],
        ['scroller: horizontal drag rotates', s.horizontal > 0.15, s.horizontal],
        ['scroller: pinch zoom still works (distance change)', s.pinch > 0.05, s.pinch],
        ['plain stage: touch-action none (unchanged)', p.css === 'none', p.css],
        ['plain stage: vertical swipe still tilts the model (unchanged)', p.vertical > 0.02, p.vertical],
        ['plain stage: touchstart cancelled as before', p.startPrevented.some((x) => x === true), p.startPrevented],
        ['plain stage: horizontal drag rotates', p.horizontal > 0.15, p.horizontal],
        ['plain stage: pinch zoom works', p.pinch > 0.05, p.pinch],
      ], { out })
    },
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const mod = loadScene(path.resolve(arg('scene-dir', path.join(MOBILE, 'src/lib'))))
  const baseMod = BASELINE ? loadScene(path.resolve(BASELINE)) : null
  const server = await serve()
  const browser = launchChrome(CHROME)
  const stop = () => {
    browser.stop()
    server.close()
  }
  try {
    const cdp = browser.cdp
    const analysis = await openPage(cdp, { width: 800, height: 800, dpr: 1 })
    await analysis.eval(ANALYSIS_JS)
    const all = cases({ cdp, analysis, mod, baseMod })
    const names = (ONLY ? ONLY.split(',') : Object.keys(all)).filter((n) => all[n])
    for (const n of names) {
      try {
        await all[n]()
      } catch (e) {
        record(`case ${n} did not run to the end`, [[String(e && e.message ? e.message : e), false]])
        if (LOG.length) console.log('        page log (tail):\n          ' + LOG.slice(-8).join('\n          '))
      }
    }
    fs.writeFileSync(path.join(OUT, 'hardening-results.json'), JSON.stringify({ when: new Date().toISOString(), baseline: BASELINE || null, results }, null, 2))
    const failed = results.filter((r) => !r.pass)
    console.log(failed.length ? `\nFAILED: ${failed.map((r) => r.name).join('; ')}` : '\nAll hardening checks passed.')
    stop()
    process.exit(failed.length ? 1 : 0)
  } catch (e) {
    console.error('harness error:', e && e.stack ? e.stack : e)
    if (LOG.length) console.error('page log (tail):\n' + LOG.slice(-25).join('\n'))
    if (browser.stderr()) console.error('chrome stderr (tail):', browser.stderr().slice(-800))
    stop()
    process.exit(2)
  }
})()
