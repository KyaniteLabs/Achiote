// Desktop pane regressions (Kai #9 profile-scoped cache, #10 real sources/DOI). Pure view-model,
// no Electron: the SDK/react imports are stubbed and a keyed fake query cache stands in for React Query.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'desktop', 'plugin.js'), 'utf8')
  .replace(/^import .*$/gm, '')
const stub = `const host={state:{}};const useQuery=()=>({});const useValue=()=>null;const useState=(v)=>[v,()=>{}];const jsx=(t,p)=>({t,p});const jsxs=jsx;\n`
const dir = mkdtempSync(join(tmpdir(), 'achiote-pane-'))
const file = join(dir, 'plugin.mjs')
writeFileSync(file, stub + src)
const mod = await import(pathToFileURL(file).href)
const { paneScope, queryKeys, selectPaneView, sourceRow } = mod

/** Fake React Query cache: state is per serialized key; a failing fetch keeps the key's old data
 *  (exactly the retained-data behaviour Kai reproduced) but never leaks into another key. */
function cache() {
  const m = new Map()
  return {
    ok(key, data) { m.set(JSON.stringify(key), { status: 'success', isError: false, data }) },
    fail(key) {
      const prev = m.get(JSON.stringify(key)) || {}
      m.set(JSON.stringify(key), { ...prev, status: 'error', isError: true })
    },
    get(key) { return m.get(JSON.stringify(key)) || { status: 'pending', isError: false, data: undefined } }
  }
}

const A_LAST = {
  ok: true,
  memory: 'A private memory',
  result: { answer: 'A answer' },
  cite: { ok: true },
  provenance: {
    sources: [{ type: 'doi', doi: '10.1016/j.foodchem.2020.127001', text: 'Smith 2020', origin: 'receipt.shareCard' }],
    local_subs: [{ type: 'sourcing', text: 'Sourcing guide: banana leaves near Des Moines' }],
    context: { userSaid: ['A private memory'] },
    nodes: [], edges: []
  }
}

function render(c, scope) {
  const k = queryKeys(scope)
  return selectPaneView({ scope, lastQ: { ...c.get(k.last), scope }, dishesQ: { ...c.get(k.dishes), scope } })
}

test('A success -> B disabled -> C success never shows A data under B or C', () => {
  const c = cache()
  const A = paneScope('local', 'alice')
  const B = paneScope('local', 'bob')
  const C = paneScope('remote-1', 'alice')
  c.ok(queryKeys(A).last, A_LAST)
  c.ok(queryKeys(A).dishes, { ok: true, dishes: [{ id: '1', title: 'A dish' }] })
  let v = render(c, A)
  assert.equal(v.answer, 'A answer')
  assert.equal(v.dishes.length, 1)

  c.fail(queryKeys(B).last)
  c.fail(queryKeys(B).dishes)
  v = render(c, B)
  assert.equal(v.offline, true)
  assert.equal(v.answer, '')
  assert.equal(v.memory, '')
  assert.equal(v.citeOk, false)
  assert.equal(v.sources.length, 0)
  assert.equal(v.dishes.length, 0)

  c.ok(queryKeys(C).last, { ok: true, memory: 'C memory', result: { answer: 'C answer' }, cite: { ok: false }, provenance: {} })
  c.ok(queryKeys(C).dishes, { ok: true, dishes: [] })
  v = render(c, C)
  assert.equal(v.answer, 'C answer')
  assert.equal(v.memory, 'C memory')
  assert.equal(v.dishes.length, 0)
})

test('error wins over retained data in the same scope (offline message not hidden)', () => {
  const c = cache()
  const A = paneScope('local', 'alice')
  c.ok(queryKeys(A).last, A_LAST)
  c.fail(queryKeys(A).last)
  const v = render(c, A)
  assert.equal(v.offline, true)
  assert.equal(v.answer, '')
})

test('data tagged with a foreign scope is ignored', () => {
  const v = selectPaneView({ scope: 'local::bob', lastQ: { status: 'success', data: A_LAST, scope: 'local::alice' }, dishesQ: null })
  assert.equal(v.answer, '')
})

test('keys differ per profile and per connection', () => {
  assert.notDeepEqual(queryKeys(paneScope('local', 'a')).last, queryKeys(paneScope('local', 'b')).last)
  assert.notDeepEqual(queryKeys(paneScope('local', 'a')).last, queryKeys(paneScope('r1', 'a')).last)
})

test('citations: DOI link + full text, separate from userSaid; long memory does not crowd sources', () => {
  const c = cache()
  const A = paneScope('local', 'alice')
  const long = 'my grandma '.repeat(60)
  c.ok(queryKeys(A).last, { ...A_LAST, provenance: { ...A_LAST.provenance, context: { userSaid: [long] } } })
  const v = render(c, A)
  assert.equal(v.sources.length, 1)
  const row = sourceRow(v.sources[0])
  assert.equal(row.href, 'https://doi.org/10.1016/j.foodchem.2020.127001')
  assert.equal(row.label, 'doi:10.1016/j.foodchem.2020.127001')
  assert.equal(row.text, 'Smith 2020')
  assert.equal(v.context.userSaid[0], long)
  const full = sourceRow({ type: 'researched', text: 'x'.repeat(1000) })
  assert.equal(full.text.length, 1000)
})
