#!/usr/bin/env node
'use strict'

/* LOOM-261 lighting-rig harness. Renders the app's 3D scene (built from
 * src/lib/scene-html.ts) and the website's 3D (configurator.html) in desktop
 * Chromium with software GL, then measures what a customer would see.
 *
 *   node mobile/scripts/rig-harness.cjs [--out DIR] [--port 8791] [--chrome PATH]
 *                                       [--scene-dir DIR] [--only app|web]
 *                                       [--fabric jersey|heavy|fleece|pique|twill] [--size 320x400]
 *
 * · Default garment: assets/models/t_shirt.meshopt.glb from the working copy
 *   (the product GLBs on the API are CORS-locked to loomdesign.uz).
 * · Canvas 320x400 CSS px (--size) at DPR 2 = 640x800 drawing buffer, front view, plain
 *   colour, no art. Mean = every garment pixel (alpha >= 250), sRGB 0-255,
 *   luma = 0.299R + 0.587G + 0.114B. Chest = central 20% x 20% of the canvas.
 * · No dependencies: Chrome is driven over --remote-debugging-pipe, TypeScript
 *   comes from mobile/node_modules (run `npm ci` there first), and the local
 *   server only serves this working copy.
 * · --scene-dir points at another copy of scene-html.ts + print.ts, e.g. the
 *   version on main, to reproduce a baseline.
 * Absolute numbers depend on the GL implementation (SwiftShader here, Adreno or
 * Mali on a phone); the ordering and the app-vs-web differences are the signal. */

const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { LOG, MIME, CHROME_DEFAULT, sleep, launchChrome, openPage, ANALYSIS_JS } = require('./lib/browser.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const MOBILE = path.join(ROOT, 'mobile')

const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf('--' + k)
  return i >= 0 ? argv[i + 1] : d
}
const PORT = parseInt(arg('port', '8791'), 10)
const OUT = path.resolve(arg('out', path.join(os.tmpdir(), 'rig-harness'))) // PNGs + results.json; pass --out to keep them
const CHROME = arg('chrome', CHROME_DEFAULT)
const SCENE_DIR = path.resolve(arg('scene-dir', path.join(MOBILE, 'src/lib')))
const ONLY = arg('only', '')
const FABRIC = arg('fabric', 'jersey') // the cloth preset, as fabricForProduct() would pick it
const ORIGIN = `http://localhost:${PORT}`
const [W, H] = arg('size', '320x400').split('x').map(Number) // canvas, CSS px; the studio's 3D box is square
const DPR = 2
const PAPER = '#f4f2ed' // C.paper, the app's stage colour

const COLOURS = { white: '#FFFFFF', black: '#000000', navy: '#2b3e5e' }

// ── App scene HTML from the TypeScript source ───────────────────────────────
function buildAppHtml() {
  const ts = require(require.resolve('typescript', { paths: [MOBILE] }))
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-scene-'))
  for (const f of ['scene-html.ts', 'print.ts']) {
    const src = fs.readFileSync(path.join(SCENE_DIR, f), 'utf8')
    const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
    fs.writeFileSync(path.join(tmp, f.replace('.ts', '.js')), js)
  }
  process.env.EXPO_PUBLIC_SITE_ORIGIN = ORIGIN
  const mod = require(path.join(tmp, 'scene-html.js'))
  const html = mod.buildSceneHtml({
    glbUrl: `${ORIGIN}/assets/models/t_shirt.meshopt.glb?v=1`,
    background: PAPER,
    view: 'front',
    autoRotate: false,
    fabric: FABRIC,
  })
  // Record the renderer/scene/camera of the first render so the harness can
  // print the settings the page actually uses (no change to the page itself).
  const hook =
    '<script>(function(){var Orig=THREE.WebGLRenderer;' +
    'THREE.WebGLRenderer=function(p){var r=new Orig(p),o=r.render;' +
    'r.render=function(s,c){window.__R=r;window.__S=s;window.__C=c;return o.apply(r,arguments)};return r};' +
    'THREE.WebGLRenderer.prototype=Orig.prototype})()</script>'
  const marker = '<script>window.__LOOM_CFG='
  if (!html.includes(marker)) throw new Error('scene HTML has no config marker')
  return html.replace(marker, hook + marker)
}

// ── Static server for the working copy (+ the generated scene page) ─────────
function serve(appHtml) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, ORIGIN)
    if (url.pathname === '/__rig/app.html') {
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' })
      return res.end(appHtml)
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

const save = (name, dataUrl) => fs.writeFileSync(path.join(OUT, name), Buffer.from(dataUrl.split(',')[1], 'base64'))
const BOTH = '(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));'

// ── The app scene ───────────────────────────────────────────────────────────
async function measureApp(cdp, analysis) {
  const out = { front: {}, back: {}, shots: {} }
  const page = await openPage(cdp, { width: W, height: H, dpr: DPR })
  await page.goto(`${ORIGIN}/__rig/app.html`)
  await page.waitFor('!!(window.__loom && __loom.debug().materials > 0 && __loom.debug().fabric && window.__R)', 'app scene ready')
  for (const [name, hex] of Object.entries(COLOURS)) {
    await page.eval(`__loom.update({shirtColor:'${hex}',front:[],back:[]}); true`)
    await sleep(500)
    const url = await page.eval(BOTH + `return __loom.snapshot(1, ${W}, ${H})})()`)
    out.shots[name] = url
    out.front[name] = await analysis.eval(`__stats(${JSON.stringify(url)})`)
  }
  // Back view of the white tee: the rig must follow the camera.
  await page.eval(`__loom.update({shirtColor:'${COLOURS.white}',front:[],back:[]}); __loom.setView('back'); true`)
  await sleep(1500)
  const back = await page.eval(BOTH + `return __loom.snapshot(1, ${W}, ${H})})()`)
  out.shots.whiteBack = back
  out.back.white = await analysis.eval(`__stats(${JSON.stringify(back)})`)

  // AC-4: what the page actually runs with.
  out.settings = await page.eval(`(function(){
    var R = __R, S = __S, meshes = [];
    S.traverse(function(o){ if (o.isMesh) meshes.push(o) });
    var mats = meshes.map(function(m){ return m.material });
    var has = function(k){ return mats.filter(function(m){ return m[k] }) };
    return {
      toneMappingIsCustom: R.toneMapping === THREE.CustomToneMapping,
      neutralPatched: THREE.ShaderChunk.tonemapping_pars_fragment.indexOf('StartCompression') !== -1,
      toneMappingExposure: R.toneMappingExposure,
      outputEncodingIsSRGB: R.outputEncoding === THREE.sRGBEncoding,
      pixelRatio: R.getPixelRatio(), devicePixelRatio: window.devicePixelRatio,
      pixelRatioIsMinDprAnd2: R.getPixelRatio() === Math.min(window.devicePixelRatio, 2),
      materialTypes: Array.from(new Set(mats.map(function(m){ return m.type }))),
      sheenColours: mats.map(function(m){ return m.sheen && m.sheen.isColor ? '#' + m.sheen.getHexString() : null }),
      colourMapsSRGB: has('map').every(function(m){ return m.map.encoding === THREE.sRGBEncoding }),
      normalMapsLinear: has('normalMap').length > 0 && has('normalMap').every(function(m){ return m.normalMap.encoding !== THREE.sRGBEncoding }),
      roughMapsLinear: has('roughnessMap').length > 0 && has('roughnessMap').every(function(m){ return m.roughnessMap.encoding !== THREE.sRGBEncoding }),
      environment: !!S.environment, roomEnvironmentClass: typeof THREE.RoomEnvironment,
      rigChildren: S.children.map(function(o){ return o.type }).join(','),
    }})()`)
  await page.close()

  // AC-4: the pixel-ratio cap on a 3x screen.
  const hi = await openPage(cdp, { width: W, height: H, dpr: 3 })
  await hi.goto(`${ORIGIN}/__rig/app.html`)
  await hi.waitFor('!!(window.__loom && __loom.debug().materials > 0 && window.__R)', 'app scene ready at dpr 3')
  out.settings.dpr3 = await hi.eval('({ dpr: window.devicePixelRatio, pixelRatio: __R.getPixelRatio() })')
  await hi.close()
  return out
}

// ── The website's 3D ────────────────────────────────────────────────────────
async function measureWeb(cdp, analysis) {
  const out = { front: {}, back: {}, shots: {} }
  const pin =
    "document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('style');" +
    `s.textContent='#three-container{position:fixed!important;left:0!important;top:0!important;right:auto!important;bottom:auto!important;width:${W}px!important;height:${H}px!important;z-index:99999!important}` +
    // The page's own chips shrink the fit band on a phone layout; the app has none.
    `.surface-toggle,.view-toggle{display:none!important}';` +
    'document.head.appendChild(s)})'
  const page = await openPage(cdp, { width: W, height: H, dpr: DPR, onNewDocument: pin })
  await page.goto(`${ORIGIN}/configurator.html`)
  await page.waitFor("typeof setFlatMode === 'function'", 'configurator script')
  await page.eval('setFlatMode(false); true')
  await page.waitFor('_preview3DReady === true && !!fabricNormalTexture', '3D preview ready')
  if (FABRIC !== 'jersey') await page.eval(`setFabricPreset(FABRIC_PRESETS.${FABRIC}); true`)
  await sleep(500)
  await page.eval('finishEntrance(); true') // the garment grows into place for 1.8 s on load
  await sleep(1000)
  const grab = (hex, view) =>
    page.eval(`(function(){ paintShirtColor('${hex}'); setCameraView('${view}'); updateStudioRig(); renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png') })()`)
  for (const [name, hex] of Object.entries(COLOURS)) {
    const url = await grab(hex, 'front')
    out.shots[name] = url
    out.front[name] = await analysis.eval(`__stats(${JSON.stringify(url)})`)
  }
  const back = await grab(COLOURS.white, 'back')
  out.shots.whiteBack = back
  out.back.white = await analysis.eval(`__stats(${JSON.stringify(back)})`)
  out.canvas = await page.eval('({ w: renderer.domElement.width, h: renderer.domElement.height, pixelRatio: renderer.getPixelRatio() })')
  await page.close()
  return out
}

// ── Main ────────────────────────────────────────────────────────────────────
;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const appHtml = buildAppHtml()
  const server = await serve(appHtml)
  const browser = launchChrome(CHROME)
  const stop = () => {
    browser.stop()
    server.close()
  }
  try {
    const cdp = browser.cdp
    const analysis = await openPage(cdp, { width: 800, height: 800, dpr: 1 })
    await analysis.eval(ANALYSIS_JS)

    const res = {}
    if (ONLY !== 'web') res.app = await measureApp(cdp, analysis)
    if (ONLY !== 'app') res.web = await measureWeb(cdp, analysis)

    // PNGs: flattened onto the stage colour, as a customer sees them.
    const flat = async (u) => analysis.eval(`__flat(${JSON.stringify(u)}, '${PAPER}')`)
    const pngs = []
    for (const side of ['app', 'web']) {
      if (!res[side]) continue
      for (const [k, u] of Object.entries(res[side].shots)) {
        const name = `${side}-${k === 'whiteBack' ? 'white-back' : k + '-front'}.png`
        save(name, await flat(u))
        pngs.push(name)
      }
    }
    if (res.app && res.web) {
      for (const k of [...Object.keys(COLOURS), 'whiteBack']) {
        const name = `side-by-side-${k === 'whiteBack' ? 'white-back' : k}.png`
        save(name, await analysis.eval(`__sbs(${JSON.stringify(res.app.shots[k])}, ${JSON.stringify(res.web.shots[k])}, 'APP (scene-html.ts)', 'WEBSITE (configurator.html)', '${PAPER}')`))
        pngs.push(name)
      }
    }
    for (const side of ['app', 'web']) if (res[side]) delete res[side].shots

    // ── Acceptance checks ───────────────────────────────────────────────────
    const checks = {}
    const grepSrc = fs.readFileSync(path.join(SCENE_DIR, 'scene-html.ts'), 'utf8')
    if (res.app) {
      const f = res.app.front, s = res.app.settings
      checks['AC-1 white mean >= 230'] = [f.white.mean, f.white.mean >= 230]
      checks['AC-1 white clipped < 1%'] = [f.white.clippedPct, f.white.clippedPct < 1]
      const [nr, , nb] = f.navy.chestRGB
      checks['AC-2 navy chest blue - red >= 30'] = [Math.round((nb - nr) * 100) / 100, nb - nr >= 30]
      checks['AC-4 CustomToneMapping + Neutral stub patched'] = [[s.toneMappingIsCustom, s.neutralPatched], s.toneMappingIsCustom && s.neutralPatched]
      checks['AC-4 exposure === 1.2'] = [s.toneMappingExposure, s.toneMappingExposure === 1.2]
      checks['AC-4 MeshPhysicalMaterial with sheen'] = [s.materialTypes, s.materialTypes.length === 1 && s.materialTypes[0] === 'MeshPhysicalMaterial' && s.sheenColours.every(Boolean)]
      checks['AC-4 colour maps sRGB, normal+roughness maps not'] = [[s.colourMapsSRGB, s.normalMapsLinear, s.roughMapsLinear], s.colourMapsSRGB && s.normalMapsLinear && s.roughMapsLinear]
      checks['AC-4 pixelRatio === min(dpr, 2) at dpr 2 and 3'] = [[s.pixelRatio, s.dpr3], s.pixelRatioIsMinDprAnd2 && s.dpr3.pixelRatio === Math.min(s.dpr3.dpr, 2)]
      checks['AC-4 no RoomEnvironment/LinearToneMapping in scene-html.ts'] = [grepSrc.match(/RoomEnvironment|LinearToneMapping/g) || 'none', !/RoomEnvironment|LinearToneMapping/.test(grepSrc)]
      const d = Math.abs(res.app.back.white.mean - f.white.mean)
      checks['AC-5 |back - front| <= 10 (white)'] = [Math.round(d * 100) / 100, d <= 10]
    }
    if (res.app && res.web) {
      for (const k of Object.keys(COLOURS)) {
        const d = Math.abs(res.app.front[k].mean - res.web.front[k].mean)
        checks[`AC-3 |app - web| <= 15 (${k})`] = [Math.round(d * 100) / 100, d <= 15]
      }
      // AC-2 as amended by the PM comment on LOOM-261: the website is the reference for black.
      const db = Math.abs(res.app.front.black.mean - res.web.front.black.mean)
      checks['AC-2 black garment mean within 15 of the website black tee'] = [Math.round(db * 100) / 100, db <= 15]
    }
    const result = { when: new Date().toISOString(), chrome: CHROME, viewport: `${W}x${H} @${DPR}x`, sceneDir: SCENE_DIR, fabric: FABRIC, pngs, ...res, checks }
    fs.writeFileSync(path.join(OUT, `results${ONLY ? '-' + ONLY : ''}${FABRIC === 'jersey' ? '' : '-' + FABRIC}.json`), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result, null, 2))
    const failed = Object.entries(checks).filter(([, v]) => !v[1])
    console.log(failed.length ? `\nFAILED: ${failed.map(([k]) => k).join('; ')}` : '\nAll automated checks passed.')
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
