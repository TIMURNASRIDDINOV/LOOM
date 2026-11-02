// LOOM-242: regression check for the studio markup total. No network, no new dependencies.
// Run after mobile/npm ci: node mobile/scripts/markup-test.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const file = path.resolve(__dirname, '../src/lib/markup.ts')
const module_ = { exports: {} }
new Function('module', 'exports', ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(module_, module_.exports)
const { artworkMarkupTotal } = module_.exports

const art = (artworkId, price) => ({ artworkId, price })
const BASE = 150000

// same artwork on both faces: markup counted once (the bug charged it twice)
assert.equal(artworkMarkupTotal([art(7, 25000), art(7, 25000)]), 25000)
assert.equal(BASE + artworkMarkupTotal([art(7, 25000), art(7, 25000)]), 175000)
// two different artworks: both counted
assert.equal(artworkMarkupTotal([art(7, 25000), art(9, 10000)]), 35000)
// one face only, either face
assert.equal(artworkMarkupTotal([art(7, 25000), null]), 25000)
assert.equal(artworkMarkupTotal([undefined, art(9, 10000)]), 10000)
// no artwork
assert.equal(artworkMarkupTotal([null, undefined]), 0)
assert.equal(artworkMarkupTotal([]), 0)
// a free artwork (markup 0) and an upload with no artworkId add nothing
assert.equal(artworkMarkupTotal([art(7, 0), { price: 0 }]), 0)
// first-seen price per id wins, like the web helper
assert.equal(artworkMarkupTotal([art(7, 25000), art(7, 30000)]), 25000)

console.log('markup-test: ok')
