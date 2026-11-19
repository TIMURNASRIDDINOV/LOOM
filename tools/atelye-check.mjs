#!/usr/bin/env node
// ─── Atelye page gate (PRD-216, LOOM-323) ───────────────────────────────────
//
// Loads Atelye pages in headless Chrome at every phone and desktop size, in
// light and dark, in uz / ru / en, and reports per run:
//   - sideways scroll (page wider than the viewport, or an element past the
//     right edge outside a scroller),
//   - clipped text (an element that hides or ellipsises its own text),
//   - tap targets under 44 × 44 px (inline text links are exempt),
//   - phone bottom nav covering a control when scrolled to the end,
//   - positive tabindex,
//   - console errors, uncaught exceptions and failed requests (failed calls to
//     the API are listed separately and do not fail the run: start the local
//     Worker to exercise them).
// After all runs it reports, as a union over every page, size and state:
//   - unused selectors in assets/atelye.css and in inline <style> rules that
//     name an atl-* class (dynamic pseudo-classes such as :hover are stripped
//     before matching, so they count when their element exists),
//   - atl-* class tokens found in the DOM that no rule names.
// Plus a text gate on every Atelye page, atelye.css and the local scripts the
// pages load: no `border-radius: 0`, `--hard`, `--rule`, `Inter Tight`,
// `Plex Mono` (the old maximalist skin).
//
// Ported from the mockup's headless-check.js. No npm dependencies: it starts
// its own static server on the repo root and drives Chrome over the DevTools
// protocol. Node 22+ (global WebSocket).
//
// Usage:
//   node tools/atelye-check.mjs                     # every page linking atelye.css
//   node tools/atelye-check.mjs catalog.html 'order.html?id=7'
//   options: --sizes=320,375,390,430,1280,1440  --themes=light,dark
//            --langs=uz,ru,en  --tma (also run phone sizes as a Telegram
//            Mini App)  --shots=<dir> (PNG per run)  --no-selectors
//            --no-grep  --chrome=<path> (or env CHROME)  --verbose
//            --port=3000 (serve on localhost:3000, an origin the local
//            Worker's CORS allows; start `npx wrangler dev` in backend/)
//            --token=<jwt> (or env LOOM_TOKEN: signed-in runs; prefix a
//            page with `anon:` to run it signed out anyway)
//            --as=<name>=<jwt> (repeatable: a page prefixed `<name>:` runs
//            as that user, e.g. --as=noaddr=<jwt> 'noaddr:checkout.html')
//            --inject=<file> (script evaluated before every page, e.g. a
//            fetch stub that answers only for URLs with ?stub=...)
//            --targets=<file> (one page per line; # starts a comment)
//   A page may end with `@@<js>`: run in the page after load, before the
//   probe, to reach a state that needs a click (a toast, an error, a sheet):
//            'product.html?slug=tee@@document.querySelector("[data-add]").click()'
//
// Exit: 0 clean · 1 findings · 2 setup problem.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PHONE_H = { 320: 568, 375: 667, 390: 844, 430: 932 }
const DESK_H = { 1280: 800, 1440: 900 }

// ─── arguments ──────────────────────────────────────────────────────────────
const opt = { sizes: [320, 375, 390, 430, 1280, 1440], themes: ['light', 'dark'], langs: ['uz', 'ru', 'en'],
  tma: false, shots: '', selectors: true, grep: true, chrome: process.env.CHROME || '', verbose: false,
  port: 0, token: process.env.LOOM_TOKEN || '', inject: '', as: {} }
const targets = []
for (const a of process.argv.slice(2)) {
  const [k, v] = a.split('=')
  if (k === '--sizes') opt.sizes = v.split(',').map(Number)
  else if (k === '--themes') opt.themes = v.split(',')
  else if (k === '--langs') opt.langs = v.split(',')
  else if (k === '--tma') opt.tma = true
  else if (k === '--shots') opt.shots = path.resolve(v)
  else if (k === '--no-selectors') opt.selectors = false
  else if (k === '--no-grep') opt.grep = false
  else if (k === '--chrome') opt.chrome = v
  else if (k === '--verbose') opt.verbose = true
  else if (k === '--port') opt.port = Number(v)
  else if (k === '--token') opt.token = v
  else if (k === '--as') { const i = a.indexOf('=', 5); opt.as[a.slice(5, i)] = a.slice(i + 1) }
  else if (k === '--inject') opt.inject = fs.readFileSync(path.resolve(v), 'utf8')
  else if (k === '--targets') targets.push(...fs.readFileSync(path.resolve(v), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')))
  else if (k.startsWith('--')) { console.error('unknown option ' + k); process.exit(2) }
  else targets.push(a.replace(/^\.?\//, ''))
}

function atelyePages() {
  const out = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || ['node_modules', 'admin', 'backend', 'mobile', 'docs'].includes(e.name)) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.html') && /assets\/atelye\.css/.test(fs.readFileSync(p, 'utf8'))) out.push(path.relative(ROOT, p))
    }
  }
  walk(ROOT)
  return out.sort()
}
if (!targets.length) targets.push(...atelyePages())
if (!targets.length) { console.error('no page links assets/atelye.css'); process.exit(2) }
const ANON = /^[a-z0-9]+:(?!\/\/)/
const who = (t) => { const m = t.match(ANON); return m ? m[0].slice(0, -1) : '' }
const pageOf = (t) => t.replace(ANON, '').split('@@')[0].split(/[?#]/)[0]
for (const t of targets) {
  if (!fs.existsSync(path.join(ROOT, pageOf(t)))) { console.error('missing page ' + t); process.exit(2) }
}

// ─── grep gate ──────────────────────────────────────────────────────────────
const BANNED = [[/border-radius\s*:\s*0(?![.\d])/, 'border-radius: 0'], [/--hard\b/, '--hard'], [/--rule\b/, '--rule'],
  [/Inter Tight/, 'Inter Tight'], [/Plex Mono/, 'Plex Mono']]
function grepGate() {
  const files = new Set(['assets/atelye.css', 'assets/shell.js'])
  for (const t of targets) {
    const f = pageOf(t)
    if (files.has(f)) continue
    files.add(f)
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8')
    for (const m of html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"?#]+\.(?:js|css))/g)) {
      if (!/^(https?:)?\/\//.test(m[1])) files.add(path.normalize(path.join(path.dirname(f), m[1])))
    }
  }
  const hits = []
  for (const f of files) {
    const p = path.join(ROOT, f)
    if (!fs.existsSync(p)) continue
    fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      for (const [re, name] of BANNED) if (re.test(line)) hits.push(`${f}:${i + 1} ${name}`)
    })
  }
  return hits
}

// ─── static server ──────────────────────────────────────────────────────────
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.json': 'application/json', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.ico': 'image/x-icon', '.xml': 'application/xml' }
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (p.endsWith('/')) p += 'index.html'
  let f = path.join(ROOT, p)
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end() }
  if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html'
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found') }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
  fs.createReadStream(f).pipe(res)
})

// ─── Chrome over CDP ────────────────────────────────────────────────────────
function chromePath() {
  const c = [opt.chrome, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean)
  return c.find((p) => fs.existsSync(p))
}
async function launch() {
  const bin = chromePath()
  if (!bin) { console.error('Chrome not found; pass --chrome=<path>'); process.exit(2) }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atelye-check-'))
  const proc = spawn(bin, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + dir, '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars', '--mute-audio', '--disable-extensions', 'about:blank'], { stdio: 'ignore' })
  const file = path.join(dir, 'DevToolsActivePort')
  for (let i = 0; i < 100 && !fs.existsSync(file); i++) await new Promise((r) => setTimeout(r, 100))
  if (!fs.existsSync(file)) { proc.kill(); console.error('Chrome did not start'); process.exit(2) }
  const port = fs.readFileSync(file, 'utf8').split('\n')[0]
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(tab.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const pending = new Map()
  const listeners = []
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && pending.has(msg.id)) {
      const { r, j } = pending.get(msg.id); pending.delete(msg.id)
      msg.error ? j(new Error(msg.error.message)) : r(msg.result)
    } else if (msg.method) listeners.forEach((l) => l(msg))
  }
  const send = (method, params = {}) => new Promise((r, j) => { pending.set(++id, { r, j }); ws.send(JSON.stringify({ id, method, params })) })
  const close = async () => {
    try { ws.close() } catch {}
    const gone = new Promise((r) => proc.once('exit', r))
    proc.kill()
    await Promise.race([gone, new Promise((r) => setTimeout(r, 3000))])
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* temp dir: the OS cleans it */ }
  }
  // Resolves on the next `method` event (or after ms); the listener is removed either way.
  const once = (method, ms) => new Promise((r) => {
    const f = (m) => { if (m.method === method) done() }
    const t = setTimeout(() => done(), ms)
    function done() { clearTimeout(t); const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); r() }
    listeners.push(f)
  })
  return { send, on: (f) => listeners.push(f), once, close }
}

// ─── the in-page probe (runs in the page; returns plain data) ───────────────
const PROBE = String(function probe(doSelectors) {
  const out = { overflow: [], clip: [], small: [], covered: [], tabindex: [], sel: {}, dom: [], named: [] }
  const W = innerWidth
  const de = document.documentElement
  const desc = (el) => {
    const c = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : ''
    const txt = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30)
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + c + (txt ? ' "' + txt + '"' : '')
  }
  const shown = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return null
    const r = el.getBoundingClientRect()
    return r.width && r.height ? [cs, r] : null
  }
  const inScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX
      if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true
    }
    return false
  }
  const FOCUSABLE = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=switch],[role=radio],[role=tab],[tabindex]'
  if (de.scrollWidth > W + 1) out.overflow.push('page ' + de.scrollWidth + '>' + W)
  for (const el of document.body.querySelectorAll('*')) {
    if (el.closest('svg') || el.closest('[aria-hidden="true"]')) continue
    const v = shown(el); if (!v) continue
    const [cs, r] = v
    if (r.right > W + 1 && cs.position !== 'fixed' && !inScroller(el)) out.overflow.push(desc(el) + ' right+' + Math.round(r.right - W))
    const srOnly = r.width <= 1 && r.height <= 1
    const ownText = !srOnly && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (ownText && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll' && !el.matches('textarea,input,select')) {
      const hides = cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis'
      if (hides && el.scrollWidth > el.clientWidth + 1) out.clip.push(desc(el))
      if (cs.overflowY === 'hidden' && el.scrollHeight > el.clientHeight + 1) out.clip.push(desc(el) + ' (vertical)')
    }
    if (el.matches(FOCUSABLE) && !el.disabled && !el.closest('[inert]') && el.getAttribute('tabindex') !== '-1') {
      if (el.matches('a') && cs.display === 'inline') { /* inline text link: exempt */ }
      else if (r.width < 43.5 || r.height < 43.5) out.small.push(desc(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height))
      if (+el.getAttribute('tabindex') > 0) out.tabindex.push(desc(el))
    }
  }
  const nav = document.querySelector('.atl-bnav')
  if (nav && shown(nav)) {
    const y = scrollY
    scrollTo(0, de.scrollHeight)
    const top = nav.getBoundingClientRect().top
    for (const el of document.body.querySelectorAll(FOCUSABLE)) {
      if (nav.contains(el) || el.closest('[aria-hidden="true"]')) continue
      const v = shown(el); if (!v) continue
      const [cs, r] = v
      if (cs.position === 'fixed' || el.closest('.atl-sheet,.atl-toast,.atl-dim')) continue
      if (r.bottom > top + 1 && r.top < innerHeight) out.covered.push(desc(el))
    }
    scrollTo(0, y)
  }
  if (doSelectors) {
    const DYN = /::?(?:hover|active|focus-visible|focus-within|focus|visited|link|target|placeholder-shown|-webkit-[a-z-]+|-moz-[a-z-]+|before|after|selection|placeholder|marker|backdrop|file-selector-button)(?![a-z-])/gi
    const split = (s) => { const o = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { o.push(cur); cur = '' } else cur += ch } o.push(cur); return o.map((x) => x.trim()) }
    const named = new Set()
    const walk = (rules, label, onlyAtl) => {
      for (const rule of rules) {
        if (rule.cssRules && !rule.selectorText) { walk(rule.cssRules, label, onlyAtl); continue }
        if (!rule.selectorText) continue
        for (const m of rule.selectorText.matchAll(/\.(atl-[\w-]+)/g)) named.add(m[1])
        if (onlyAtl && !/\.atl-/.test(rule.selectorText)) continue
        for (const s of split(rule.selectorText)) {
          const q = s.replace(DYN, '').trim() || '*'
          let used = true
          try { used = !!document.querySelector(q) } catch (e) { used = true }
          const key = label + ' ' + s
          out.sel[key] = out.sel[key] || used
        }
      }
    }
    for (const sh of document.styleSheets) {
      const node = sh.ownerNode
      let rules
      try { rules = sh.cssRules } catch (e) { continue }
      if (node && node.tagName === 'LINK' && /assets\/atelye\.css/.test(node.href)) walk(rules, 'atelye.css', false)
      // a <style id> injected by a shared script counts once for the site
      else if (node && node.tagName === 'STYLE') walk(rules, node.id ? 'style#' + node.id : 'inline ' + location.pathname, true)
      else walk(rules, '', true)
    }
    for (const k of Object.keys(out.sel)) if (k.startsWith(' ')) delete out.sel[k]
    out.named = [...named]
    const dom = new Set()
    for (const el of document.querySelectorAll('[class]')) for (const c of el.classList) if (c.startsWith('atl-')) dom.add(c)
    out.dom = [...dom]
  }
  return out
})

// ─── run ────────────────────────────────────────────────────────────────────
const TG_STUB = `(() => {
  try { sessionStorage.setItem('__telegram__initParams', '1') } catch (e) {}
  const btn = () => ({ _cb: [], setParams(p) { Object.assign(this, p); return this }, show() { this.is_visible = true; return this },
    hide() { this.is_visible = false; return this }, onClick(f) { this._cb.push(f); return this } })
  window.Telegram = { WebApp: { MainButton: btn(), BackButton: btn(), ready() {}, expand() {}, onEvent() {},
    colorScheme: 'light', isVersionAtLeast: () => true } }
})()`

async function main() {
  await new Promise((r) => server.listen(opt.port, '127.0.0.1', r))
  const base = `http://${opt.port ? 'localhost' : '127.0.0.1'}:${server.address().port}/`
  const cdp = await launch()
  let errs = []
  cdp.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') errs.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0])
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('console: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 160))
    else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push('log: ' + m.params.entry.text.slice(0, 120) + (m.params.entry.url ? ' ' + m.params.entry.url : ''))
  })
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable'); await cdp.send('Network.enable')
  await cdp.send('Network.setBlockedURLs', { urls: ['*telegram.org/js/*'] })
  if (opt.shots) fs.mkdirSync(opt.shots, { recursive: true })

  const findings = []
  const apiNotes = new Set()
  const selUsed = {}
  const domCls = new Set(), namedCls = new Set()
  let runs = 0
  let scriptId = null
  const modes = [false, ...(opt.tma ? [true] : [])]
  for (const target of targets) {
    for (const tma of modes) {
      for (const w of opt.sizes) {
        const phone = w < 900
        if (tma && !phone) continue
        const h = PHONE_H[w] || DESK_H[w] || (phone ? 800 : 900)
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: phone })
        for (const theme of opt.themes) {
          await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] })
          for (const lang of opt.langs) {
            if (scriptId) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId })
            const w_ = who(target)
            const tok = w_ ? (opt.as[w_] || '') : opt.token
            if (w_ && w_ !== 'anon' && !opt.as[w_]) { console.error('no --as=' + w_ + '=<jwt> for ' + target); process.exit(2) }
            const src = `try{localStorage.setItem('loom_theme_v2',${JSON.stringify(theme)});localStorage.setItem('loom_lang',${JSON.stringify(lang)});` +
              (tok ? `localStorage.setItem('loom_auth_token',${JSON.stringify(tok)})` : `localStorage.removeItem('loom_auth_token')`) + `;sessionStorage.removeItem('loom_user')}catch(e){};` +
              (tma ? TG_STUB : `try{sessionStorage.removeItem('__telegram__initParams')}catch(e){}`) + ';\n' + opt.inject
            scriptId = (await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: src })).identifier
            errs = []
            // A hash-only change is a same-document navigation with no load
            // event: leave the page first so every run is a fresh load.
            // Wait for about:blank to finish too: otherwise its late load
            // event resolves the wait below and the probe runs mid-navigation
            // (the old first-run "probe failed: Uncaught").
            const blank = cdp.once('Page.loadEventFired', 5000)
            await cdp.send('Page.navigate', { url: 'about:blank' })
            await blank
            const [path_, act] = target.replace(ANON, '').split('@@')
            const url = base + path_ + (tma && !path_.includes('#') ? '#tgWebAppData=check' : '')
            const loaded = cdp.once('Page.loadEventFired', 15000)
            errs = []
            await cdp.send('Page.navigate', { url })
            await loaded
            await new Promise((r) => setTimeout(r, 350))
            if (act) {
              const ar = await cdp.send('Runtime.evaluate', { expression: act, awaitPromise: true })
              if (ar.exceptionDetails) findings.push(`${target} action failed: ${ar.exceptionDetails.exception?.description?.split('\n')[0] || ar.exceptionDetails.text}`)
              await new Promise((r) => setTimeout(r, 450))
            }
            let res = await cdp.send('Runtime.evaluate', { expression: `(${PROBE})(${opt.selectors})`, returnByValue: true })
            if (res.exceptionDetails) {
              // a page that redirects itself (login → next) can still be moving
              await new Promise((r) => setTimeout(r, 800))
              res = await cdp.send('Runtime.evaluate', { expression: `(${PROBE})(${opt.selectors})`, returnByValue: true })
            }
            if (res.exceptionDetails) { findings.push(`${target} probe failed: ${res.exceptionDetails.exception?.description?.split('\n')[0] || res.exceptionDetails.text}`); continue }
            const o = res.result.value
            const tag = `${target}${tma ? ' [tma]' : ''} ${w}px ${theme} ${lang}`
            runs++
            for (const k of ['overflow', 'clip', 'small', 'covered', 'tabindex']) for (const x of o[k]) findings.push(`${tag} ${k}: ${x}`)
            for (const e of errs) {
              if (/^log: .*https?:\/\/(localhost:8787|127\.0\.0\.1:8787|api\.loomdesign\.uz)\//.test(e)) apiNotes.add(e.replace(/^log: /, ''))
              else findings.push(`${tag} error: ${e}`)
            }
            for (const [k, v] of Object.entries(o.sel)) selUsed[k] = selUsed[k] || v
            o.dom.forEach((c) => domCls.add(c)); o.named.forEach((c) => namedCls.add(c))
            if (opt.shots) {
              const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
              const name = `${target.replace(/[^\w.-]+/g, '_').slice(0, 80)}${tma ? '-tma' : ''}-${w}-${theme}-${lang}.png`
              fs.writeFileSync(path.join(opt.shots, name), Buffer.from(shot.data, 'base64'))
            }
            if (opt.verbose) console.log('ok ' + tag)
          }
        }
      }
    }
  }
  await cdp.close(); server.close()

  // Collapse identical findings across languages/themes so the report stays readable.
  const seen = new Map()
  for (const f of findings) seen.set(f, (seen.get(f) || 0) + 1)
  const unused = opt.selectors ? Object.entries(selUsed).filter(([, v]) => !v).map(([k]) => k) : []
  const noRule = opt.selectors ? [...domCls].filter((c) => !namedCls.has(c)).sort() : []
  const banned = opt.grep ? grepGate() : []

  console.log(`atelye-check: ${targets.length} page(s), ${runs} run(s)`)
  if (seen.size) { console.log(`\nFINDINGS (${seen.size})`); for (const f of seen.keys()) console.log('  ' + f) }
  if (unused.length) { console.log(`\nUNUSED SELECTORS (${unused.length})`); for (const u of unused) console.log('  ' + u) }
  if (noRule.length) { console.log(`\nCLASSES WITHOUT A RULE (${noRule.length})`); for (const c of noRule) console.log('  ' + c) }
  if (banned.length) { console.log(`\nOLD-SKIN TOKENS (${banned.length})`); for (const b of banned) console.log('  ' + b) }
  if (apiNotes.size) {
    console.log(`\nAPI REQUESTS THAT FAILED (${apiNotes.size}; not counted — run \`npx wrangler dev\` in backend/ to exercise them)`)
    for (const n of apiNotes) console.log('  ' + n)
  }
  const bad = seen.size + unused.length + noRule.length + banned.length
  console.log(bad ? '\nFAIL' : '\nPASS')
  process.exit(bad ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(2) })
