// Kai re-review @ 46db6c8, P2: a profile-keyed query's queryFn must never fetch ANOTHER profile through
// ambient ctx.rest and cache it under the old key. Drives the real Pane + register() with stubbed SDK
// atoms (host changes REST profile first, then invalidates) and a keyed fake React Query cache.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'desktop', 'plugin.js'), 'utf8').replace(/^import .*$/gm, '')
const stub = `
function atom(v){const ls=new Set();return{get:()=>v,set(n){v=n;for(const l of ls)l(n)},listen(l){ls.add(l);return()=>ls.delete(l)},subscribe(l){ls.add(l);l(v);return()=>ls.delete(l)}}}
const host={state:{connectionId:atom('local'),profile:atom('alice')}}
const useValue=(a)=>a.get()
const useState=(v)=>[v,()=>{}]
const jsx=(t,p)=>({t,p});const jsxs=jsx
const useQuery=(opts)=>globalThis.__achioteQuery(opts)
export const __host=host
`

async function load() {
  const dir = mkdtempSync(join(tmpdir(), 'achiote-scope-'))
  const file = join(dir, 'plugin.mjs')
  writeFileSync(file, stub + src)
  return import(pathToFileURL(file).href)
}

/** Minimal React Query: per-key state; success stores data, error keeps previous data. Observers keep
 *  the queryFn from the render that created them (the stale-closure Kai exercised). */
function fakeQueryClient() {
  const cache = new Map()
  const observers = new Map()
  const k = (key) => JSON.stringify(key)
  return {
    cache,
    useQuery(opts) {
      observers.set(k(opts.queryKey), opts)
      return cache.get(k(opts.queryKey)) || { status: 'pending', isError: false, data: undefined }
    },
    async run(opts) {
      const key = k(opts.queryKey)
      const prev = cache.get(key) || {}
      try {
        const data = await opts.queryFn()
        cache.set(key, { status: 'success', isError: false, data })
      } catch (error) {
        cache.set(key, { ...prev, status: 'error', isError: true, error })
      }
    },
    /** Hermes invalidateProfileScopedQueries: refetch every ACTIVE observer with ITS captured queryFn. */
    async invalidateAll() {
      for (const opts of [...observers.values()]) await this.run(opts)
    },
    get: (key) => cache.get(k(key))
  }
}

function backend() {
  // ctx.rest is ambient: it targets whatever profile the host routed last (setApiRequestProfile).
  const db = {
    alice: { scope: 'aaaa1111', last: { ok: true, memory: 'A private memory', result: { answer: 'A answer' }, cite: { ok: true }, provenance: {} }, dishes: [{ id: 'a1', title: 'A dish' }] },
    bob: { scope: 'bbbb2222', last: { ok: true, memory: 'B private memory', result: { answer: 'B answer' }, cite: { ok: false }, provenance: {} }, dishes: [{ id: 'b1', title: 'B dish' }] }
  }
  let route = 'alice'
  return {
    setRoute: (p) => { route = p },
    rest: async (path) => {
      const p = db[route]
      if (path === '/last') return { ...p.last, scope: p.scope }
      if (path === '/dishes') return { ok: true, scope: p.scope, dishes: p.dishes, count: p.dishes.length }
      throw new Error(`unexpected ${path}`)
    }
  }
}

function mount(mod, be) {
  let pane
  mod.default.register({ rest: (path, opts) => be.rest(path, opts), register: (r) => { pane = r }, onDispose: () => {} })
  return () => pane.render().t()
}

function text(tree) {
  const out = []
  const walk = (n) => {
    if (n == null || n === false) return
    if (typeof n === 'string' || typeof n === 'number') return out.push(String(n))
    if (Array.isArray(n)) return n.forEach(walk)
    if (n.p) walk(n.p.children)
  }
  walk(tree)
  return out.join(' ')
}

test('A success -> switch+invalidate before re-render -> B success -> back to A shows only A', async () => {
  const mod = await load()
  const qc = fakeQueryClient()
  globalThis.__achioteQuery = (o) => qc.useQuery(o)
  const be = backend()
  const render = mount(mod, be)
  const host = mod.__host

  // 1. A renders, A's queries succeed.
  render()
  await qc.invalidateAll()
  let view = text(render())
  assert.match(view, /A answer/)
  const aKeys = mod.queryKeys(mod.paneScope('local', 'alice'))

  // 2. Host switches profile: REST route + atoms move to B, then it synchronously invalidates
  //    active queries BEFORE React re-renders — A's observers refetch with A's captured queryFn.
  be.setRoute('bob')
  host.state.profile.set('bob')
  await qc.invalidateAll()
  const aLast = qc.get(aKeys.last)
  assert.notEqual(aLast.data && aLast.data.memory, 'B private memory', 'B data cached under A key')
  assert.notEqual(aLast.data && aLast.data.result && aLast.data.result.answer, 'B answer')
  const aDishes = qc.get(aKeys.dishes)
  assert.ok(!(aDishes.data && aDishes.data.dishes && aDishes.data.dishes.some((d) => d.id === 'b1')), 'B dishes under A key')

  // 3. B renders and its own queries succeed.
  render()
  await qc.invalidateAll()
  view = text(render())
  assert.match(view, /B answer/)
  assert.doesNotMatch(view, /A answer|A private memory/)

  // 4. Back to A: never shows B data.
  be.setRoute('alice')
  host.state.profile.set('alice')
  await qc.invalidateAll()
  view = text(render())
  assert.doesNotMatch(view, /B answer|B private memory/)
  assert.match(view, /A answer/)
})

test('stale queryFn invoked after the ambient route moved is rejected, never resolved with foreign data', async () => {
  const mod = await load()
  const captured = []
  globalThis.__achioteQuery = (o) => { captured.push(o); return { status: 'pending' } }
  const be = backend()
  const render = mount(mod, be)
  mod.__host.state.profile.set('alice')
  render()
  const aLast = captured.find((o) => o.queryKey[2] === 'last')
  be.setRoute('bob')
  mod.__host.state.profile.set('bob')
  await assert.rejects(() => aLast.queryFn(), /scope|profile/i)
})

test('switch DURING an in-flight fetch (A -> B -> A) rejects the response', async () => {
  const mod = await load()
  const captured = []
  globalThis.__achioteQuery = (o) => { captured.push(o); return { status: 'pending' } }
  const be = backend()
  let release
  const gate = new Promise((r) => { release = r })
  const slow = { setRoute: be.setRoute, rest: async (p) => { const r = await be.rest(p); await gate; return r } }
  const render = mount(mod, slow)
  render()
  const aLast = captured.find((o) => o.queryKey[2] === 'last')
  be.setRoute('bob')
  const pending = aLast.queryFn() // starts while host atoms still say A but REST already routes to B
  mod.__host.state.profile.set('bob')
  mod.__host.state.profile.set('alice')
  be.setRoute('alice')
  release()
  await assert.rejects(() => pending, /scope|profile/i)
})

test('response ownership: a backend scope seen for one profile is never accepted for another', async () => {
  const mod = await load()
  const pins = new Map()
  let route = 'local::alice'
  const fetchScoped = mod.createScopedFetch(async () => ({ ok: true, scope: 'aaaa1111' }), () => ({ scope: route, epoch: 0 }), pins)
  const a = await fetchScoped('local::alice', '/last')
  assert.equal(a.paneScope, 'local::alice')
  route = 'local::bob'
  await assert.rejects(() => fetchScoped('local::bob', '/last'), /scope/i) // bob answered by alice's backend
  const missing = mod.createScopedFetch(async () => ({ ok: true }), () => ({ scope: 'local::carol', epoch: 0 }), new Map())
  await assert.rejects(() => missing('local::carol', '/last'), /scope/i)
})

test('two connections with the same plugin-data path hash both succeed', async () => {
  const mod = await load()
  const pins = new Map()
  let route = 'server-a::default'
  let epoch = 0
  const fetchScoped = mod.createScopedFetch(
    async () => ({ ok: true, scope: '8561204dd3cf0de9', memory: route }),
    () => ({ scope: route, epoch }),
    pins
  )
  const a = await fetchScoped('server-a::default', '/last')
  assert.equal(a.paneScope, 'server-a::default')
  route = 'server-b::default'
  epoch += 1
  const b = await fetchScoped('server-b::default', '/last')
  assert.equal(b.paneScope, 'server-b::default')
  assert.equal(b.memory, 'server-b::default')
})

test('view ignores data whose paneScope is not the current scope (query-state tags do not count)', async () => {
  const mod = await load()
  const v = mod.selectPaneView({
    scope: 'local::alice',
    lastQ: { status: 'success', scope: 'local::alice', data: { ok: true, result: { answer: 'B answer' }, paneScope: 'local::bob' } },
    dishesQ: { status: 'success', scope: 'local::alice', data: { ok: true, dishes: [{ id: 'b1' }], paneScope: 'local::bob' } }
  })
  assert.equal(v.answer, '')
  assert.equal(v.dishes.length, 0)
})
