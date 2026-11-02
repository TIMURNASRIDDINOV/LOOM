'use strict'

/* Shared by the desktop-Chromium harnesses (rig-harness.cjs, hardening-harness.cjs):
 * a minimal Chrome DevTools client over --remote-debugging-pipe (no dependencies),
 * the launch flags, and the in-page image analysis. */

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const CHROME_DEFAULT = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const MIME = { '.js': 'application/javascript', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2' }

// The last page console lines and exceptions, printed when something times out.
const LOG = []

class CDP {
  constructor(child) {
    this.w = child.stdio[3]
    this.id = 0
    this.pending = new Map()
    this.handlers = [] // extra event listeners: (message) => void
    let buf = ''
    child.stdio[4].setEncoding('utf8')
    child.stdio[4].on('data', (d) => {
      buf += d
      let i
      while ((i = buf.indexOf('\0')) >= 0) {
        const m = JSON.parse(buf.slice(0, i))
        buf = buf.slice(i + 1)
        if (!m.id) this.onEvent(m)
        const p = m.id && this.pending.get(m.id)
        if (!p) continue
        this.pending.delete(m.id)
        if (m.error) p.rej(new Error(`${p.method}: ${m.error.message}`))
        else p.res(m.result)
      }
    })
  }
  onEvent(m) {
    const a = m.params || {}
    if (m.method === 'Runtime.consoleAPICalled') LOG.push(`[console.${a.type}] ` + a.args.map((x) => x.value ?? x.description ?? '').join(' '))
    else if (m.method === 'Runtime.exceptionThrown') LOG.push('[exception] ' + ((a.exceptionDetails.exception && a.exceptionDetails.exception.description) || a.exceptionDetails.text))
    else if (m.method === 'Log.entryAdded') LOG.push(`[log.${a.entry.level}] ${a.entry.text} ${a.entry.url || ''}`)
    if (LOG.length > 60) LOG.shift()
    this.handlers.forEach((h) => h(m))
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej, method })
      this.w.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
    })
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Start headless Chrome with software GL. Only `localhost` resolves; every other host fails fast. */
function launchChrome(chromePath, extraArgs = []) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-chrome-'))
  const chrome = spawn(
    chromePath,
    [
      '--headless=new', '--no-sandbox', '--remote-debugging-pipe', `--user-data-dir=${userData}`,
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
      '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost', ...extraArgs, 'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] },
  )
  let stderr = ''
  chrome.stderr.on('data', (d) => (stderr += d))
  const stop = () => {
    try { chrome.kill('SIGKILL') } catch (_) { /* gone */ }
    fs.rmSync(userData, { recursive: true, force: true })
  }
  return { chrome, cdp: new CDP(chrome), stop, stderr: () => stderr }
}

async function openPage(cdp, { width, height, dpr, onNewDocument, touch, domains = [] }) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  const call = (m, p) => cdp.send(m, p, sessionId)
  await call('Page.enable')
  await call('Runtime.enable')
  await call('Log.enable')
  for (const d of domains) await call(`${d}.enable`)
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: !!touch })
  if (touch) await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  if (onNewDocument) await call('Page.addScriptToEvaluateOnNewDocument', { source: onNewDocument })
  const page = {
    sessionId,
    call,
    goto: (url) => call('Page.navigate', { url }),
    eval: async (expression) => {
      const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text)
      return r.result.value
    },
    async waitFor(expression, what, ms = 90000) {
      const t0 = Date.now()
      for (;;) {
        try {
          if (await page.eval(expression)) return
        } catch (_) {
          /* context not ready yet */
        }
        if (Date.now() - t0 > ms) {
          const state = await page.eval("document.readyState + ' | ' + (window.__loom ? JSON.stringify(__loom.debug()) : 'no __loom') + ' | R=' + !!window.__R").catch((e) => String(e))
          throw new Error(`timeout waiting for ${what} (${state})`)
        }
        await sleep(250)
      }
    },
    close: () => cdp.send('Target.closeTarget', { targetId }),
  }
  return page
}

// In-page analysis: identical code measures every render.
const ANALYSIS_JS = `
window.__load = async (url) => { const i = new Image(); i.src = url; await i.decode(); return i };
window.__stats = async (url) => {
  const img = await __load(url), c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const Wd = c.width, Ht = c.height, d = g.getImageData(0, 0, Wd, Ht).data;
  const hist = new Uint32Array(256);
  let n = 0, sy = 0, sr = 0, sg = 0, sb = 0, clip = 0, crushed = 0;
  let cn = 0, cy = 0, cr = 0, cg = 0, cb = 0, cyy = 0;
  const x0 = Math.floor(Wd * 0.4), x1 = Math.floor(Wd * 0.6), y0 = Math.floor(Ht * 0.4), y1 = Math.floor(Ht * 0.6);
  for (let y = 0; y < Ht; y++) for (let x = 0; x < Wd; x++) {
    const i = (y * Wd + x) * 4;
    if (d[i + 3] < 250) continue;
    const r = d[i], gr = d[i + 1], b = d[i + 2], l = 0.299 * r + 0.587 * gr + 0.114 * b;
    n++; sy += l; sr += r; sg += gr; sb += b; hist[Math.round(l)]++;
    if (r === 255 && gr === 255 && b === 255) clip++;
    if (l < 8) crushed++;
    if (x >= x0 && x < x1 && y >= y0 && y < y1) { cn++; cy += l; cyy += l * l; cr += r; cg += gr; cb += b; }
  }
  const pct = (p) => { let a = 0; const t = n * p; for (let k = 0; k < 256; k++) { a += hist[k]; if (a >= t) return k; } return 255; };
  const f = (v) => Math.round(v * 100) / 100;
  return {
    size: [Wd, Ht], garmentPx: n,
    mean: f(sy / n), meanRGB: [f(sr / n), f(sg / n), f(sb / n)],
    clippedPct: f((100 * clip) / n), crushedPct: f((100 * crushed) / n),
    p05: pct(0.05), p50: pct(0.5), p95: pct(0.95),
    chestPx: cn, chestLuma: f(cy / cn), chestRGB: [f(cr / cn), f(cg / cn), f(cb / cn)],
    chestSd: f(Math.sqrt(Math.max(0, cyy / cn - (cy / cn) * (cy / cn)))),
  };
};
window.__flat = async (url, bg) => {
  const i = await __load(url), c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight;
  const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); g.drawImage(i, 0, 0);
  return c.toDataURL('image/png');
};
window.__sbs = async (a, b, la, lb, bg) => {
  const A = await __load(a), B = await __load(b), gap = 24, c = document.createElement('canvas');
  c.width = A.naturalWidth + B.naturalWidth + gap; c.height = Math.max(A.naturalHeight, B.naturalHeight);
  const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(A, 0, 0); g.drawImage(B, A.naturalWidth + gap, 0);
  g.fillStyle = '#000'; g.font = 'bold 22px sans-serif'; g.fillText(la, 12, 30); g.fillText(lb, A.naturalWidth + gap + 12, 30);
  return c.toDataURL('image/png');
};
true`

module.exports = { CDP, LOG, MIME, CHROME_DEFAULT, sleep, launchChrome, openPage, ANALYSIS_JS }
