#!/usr/bin/env node
// Vet a garment GLB the way the configurator will see it.
//
//   cd tools/glb-inspect && npm install
//   node inspect.mjs ../../assets/models/t_shirt.glb
//
// Prints the node tree with mesh/material names and vertex counts, the UV
// range of every mesh, and — the part that matters — how configurator.js /
// mobile/src/lib/scene-html.ts would classify each mesh (front print, back
// print, plain), using the same name rules. A candidate model passes when:
//
//   · at least one mesh classifies FRONT and one BACK,
//   · the FRONT meshes' UVs form ONE contiguous island (one bbox, no gaps),
//   · total triangles stay under ~300k (the t-shirt is 244k; meshopt shrinks it),
//   · TEXCOORD_0 is present on every body mesh.
//
// Anything else means a Blender pass first: rename the panel nodes to
// Body_Front / Body_Back / Sleeves / Ribbing and re-unwrap the front and back
// panels as single islands.

import { readFileSync } from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'

const file = process.argv[2]
if (!file) {
  console.error('usage: node inspect.mjs <model.glb>')
  process.exit(2)
}

// The WASM decoder initialises asynchronously; reading a meshopt file before
// `ready` resolves throws deep inside the extension.
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const doc = await io.readBinary(new Uint8Array(readFileSync(file)))
const root = doc.getRoot()

// ── The classifier, verbatim from configurator.js ─────────────────────────
function hasAnyNameInHierarchy(node, tokens) {
  let cur = node
  while (cur) {
    const name = (cur.getName() || '').toLowerCase()
    if (tokens.some((t) => name.includes(t))) return true
    cur = cur.getParentNode ? cur.getParentNode() : null
  }
  return false
}
function classify(node, prim) {
  const matName = (prim.getMaterial()?.getName() || '').toLowerCase()
  const isRib = ['rib', 'neck', 'collar'].some((t) => matName.includes(t)) || hasAnyNameInHierarchy(node, ['rib', 'neck', 'collar'])
  const isSleeve = matName.includes('sleeve') || hasAnyNameInHierarchy(node, ['sleeve'])
  const isBack = hasAnyNameInHierarchy(node, ['body_back'])
  const isFront = hasAnyNameInHierarchy(node, ['body_front']) || (matName.includes('body') && !isBack && !isSleeve && !isRib)
  return isFront ? 'FRONT' : isBack ? 'BACK' : 'plain'
}

// ── Walk ──────────────────────────────────────────────────────────────────
let totalVerts = 0
let totalTris = 0
const byClass = { FRONT: [], BACK: [], plain: [] }
const uvGlobal = { minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity }

function uvBounds(prim) {
  const uv = prim.getAttribute('TEXCOORD_0')
  if (!uv) return null
  const b = { minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity }
  const el = [0, 0]
  for (let i = 0; i < uv.getCount(); i++) {
    uv.getElement(i, el)
    if (el[0] < b.minU) b.minU = el[0]
    if (el[0] > b.maxU) b.maxU = el[0]
    if (el[1] < b.minV) b.minV = el[1]
    if (el[1] > b.maxV) b.maxV = el[1]
  }
  uvGlobal.minU = Math.min(uvGlobal.minU, b.minU)
  uvGlobal.maxU = Math.max(uvGlobal.maxU, b.maxU)
  uvGlobal.minV = Math.min(uvGlobal.minV, b.minV)
  uvGlobal.maxV = Math.max(uvGlobal.maxV, b.maxV)
  return b
}

function walk(node, depth) {
  const pad = '  '.repeat(depth)
  const mesh = node.getMesh()
  console.log(`${pad}• ${node.getName() || '(unnamed node)'}${mesh ? `  [mesh: ${mesh.getName() || '(unnamed)'}]` : ''}`)
  if (mesh) {
    mesh.listPrimitives().forEach((prim, i) => {
      const pos = prim.getAttribute('POSITION')
      const idx = prim.getIndices()
      const verts = pos ? pos.getCount() : 0
      const tris = idx ? idx.getCount() / 3 : verts / 3
      totalVerts += verts
      totalTris += tris
      const cls = classify(node, prim)
      const b = uvBounds(prim)
      byClass[cls].push({ node: node.getName(), prim: i, tris, b })
      const mat = prim.getMaterial()?.getName() || '(no material)'
      const uvTxt = b ? `uv u[${b.minU.toFixed(3)}..${b.maxU.toFixed(3)}] v[${b.minV.toFixed(3)}..${b.maxV.toFixed(3)}]` : 'NO TEXCOORD_0'
      console.log(`${pad}    prim ${i}: ${verts.toLocaleString()} verts, ${Math.round(tris).toLocaleString()} tris, material "${mat}", ${uvTxt}  → ${cls}`)
    })
  }
  node.listChildren().forEach((c) => walk(c, depth + 1))
}

console.log(`\n${file}`)
console.log(`generator: ${root.getAsset().generator || '?'}  extensions: ${root.listExtensionsUsed().map((e) => e.extensionName).join(', ') || 'none'}\n`)
root.listScenes().forEach((scene) => {
  console.log(`scene "${scene.getName() || ''}"`)
  scene.listChildren().forEach((n) => walk(n, 1))
})

console.log(`\nmaterials: ${root.listMaterials().map((m) => `"${m.getName()}"`).join(', ') || 'none'}`)
console.log(`textures:  ${root.listTextures().length}`)
console.log(`total:     ${totalVerts.toLocaleString()} vertices, ${Math.round(totalTris).toLocaleString()} triangles`)
if (uvGlobal.minU !== Infinity) {
  console.log(`uv span:   u ${uvGlobal.minU.toFixed(2)}..${uvGlobal.maxU.toFixed(2)}  v ${uvGlobal.minV.toFixed(2)}..${uvGlobal.maxV.toFixed(2)}  (normalised at load; islands outside 0..1 are fine)`)
}

// ── Verdict ───────────────────────────────────────────────────────────────
console.log('\nclassification (same rules as configurator.js):')
for (const cls of ['FRONT', 'BACK', 'plain']) {
  const list = byClass[cls]
  const tris = list.reduce((s, p) => s + p.tris, 0)
  console.log(`  ${cls.padEnd(6)} ${list.length} primitive(s), ${Math.round(tris).toLocaleString()} tris`)
}

const problems = []
if (!byClass.FRONT.length) problems.push('no mesh classifies as FRONT — rename the front panel node to Body_Front (or its material to include "body")')
if (!byClass.BACK.length) problems.push('no mesh classifies as BACK — rename the back panel node to Body_Back')
if (totalTris > 300_000) problems.push(`heavy: ${Math.round(totalTris).toLocaleString()} tris — decimate to ≤ 250k before shipping`)
for (const cls of ['FRONT', 'BACK']) {
  const list = byClass[cls].filter((p) => p.b)
  if (list.length > 1) {
    // Several primitives claim the same face: their UV boxes must overlap into one region,
    // otherwise the print rect can only land on one of them.
    const u0 = Math.max(...list.map((p) => p.b.minU)), u1 = Math.min(...list.map((p) => p.b.maxU))
    if (u1 < u0) problems.push(`${cls} panel is split across disjoint UV regions — re-unwrap it as one island`)
  }
  if (byClass[cls].some((p) => !p.b)) problems.push(`${cls} mesh without TEXCOORD_0 — no UVs, cannot receive a print`)
}

console.log('')
if (problems.length) {
  console.log('VERDICT: needs work')
  problems.forEach((p) => console.log(`  ✗ ${p}`))
  process.exitCode = 1
} else {
  console.log('VERDICT: usable as-is (still check the UV island shape visually in Blender).')
}
