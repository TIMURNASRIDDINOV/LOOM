#!/usr/bin/env node
'use strict'

/* Local CORS proxy for the web preview (`npm run web`).
 *
 * The production API only allows https://loomdesign.uz as a browser origin, so
 * a page served from localhost cannot call it directly. This proxy forwards:
 *
 *   /assets/*  → https://loomdesign.uz  (vendored three.js, the default garment)
 *   everything else → https://api.loomdesign.uz
 *
 * …and rewrites CORS headers to whatever origin asked. It also rewrites
 * absolute api.loomdesign.uz URLs inside JSON responses so model/thumbnail/
 * artwork links stay behind the proxy too.
 *
 * Read-only convenience for development. Never deploy this. */

const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')

const PORT = parseInt(process.env.PORT || '8787', 10)
const API = 'api.loomdesign.uz'
const SITE = 'loomdesign.uz'
// Site assets that exist in the working copy are served from disk first, so
// an un-deployed texture or vendored script can be tested before it is pushed.
const SITE_DIR = path.resolve(__dirname, '..', '..')
const MIME = { '.js': 'application/javascript', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webp': 'image/webp' }

const server = http.createServer((req, res) => {
  const origin = req.headers.origin || '*'
  const cors = {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'Content-Type, Authorization',
    'access-control-max-age': '86400',
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    return res.end()
  }

  // Anything that is not the API is the website: serve the working copy when
  // the file exists (so un-deployed pages, textures and scripts can be tested
  // at http://localhost:8787/configurator.html), else fall back to the live site.
  if (!req.url.startsWith('/api/')) {
    let rel = req.url.split('?')[0]
    if (rel === '/') rel = '/index.html'
    const local = path.normalize(path.join(SITE_DIR, rel))
    if (local.startsWith(SITE_DIR + path.sep) && fs.existsSync(local) && fs.statSync(local).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(local)] || 'application/octet-stream', ...cors })
      return fs.createReadStream(local).pipe(res)
    }
  }

  const host = req.url.startsWith('/api/') ? API : SITE
  const headers = { ...req.headers, host }
  delete headers.origin
  delete headers.referer
  // The upstream must not compress: JSON bodies get rewritten below.
  headers['accept-encoding'] = 'identity'

  const up = https.request({ host, method: req.method, path: req.url, headers }, (ur) => {
    const h = { ...ur.headers, ...cors }
    delete h['content-length']
    const type = String(ur.headers['content-type'] || '')
    if (type.includes('application/json')) {
      const chunks = []
      ur.on('data', (c) => chunks.push(c))
      ur.on('end', () => {
        const body = Buffer.concat(chunks)
          .toString('utf8')
          .split(`https://${API}`)
          .join(`http://localhost:${PORT}`)
        res.writeHead(ur.statusCode || 502, h)
        res.end(body)
      })
    } else {
      res.writeHead(ur.statusCode || 502, h)
      ur.pipe(res)
    }
  })
  up.on('error', (e) => {
    res.writeHead(502, { 'content-type': 'application/json', ...cors })
    res.end(JSON.stringify({ error: `proxy: ${e.message}` }))
  })
  req.pipe(up)
})

server.listen(PORT, () => {
  console.log(`LOOM dev proxy → https://${API} (and /assets → ${SITE}) on http://localhost:${PORT}`)
})
