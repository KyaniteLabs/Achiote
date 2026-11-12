// Dashboard bundle: manifest ↔ bundle contract + the pure view-model behind the Nostalgia tab.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const dash = join(here, '..', 'dashboard')

function loadBundle() {
  const registered = []
  const window = {
    __HERMES_PLUGIN_SDK__: {
      React: { createElement: (type, props, ...children) => ({ type, props, children }) },
      hooks: {
        useState: (initial) => [initial, () => {}],
        useEffect: () => {}
      },
      fetchJSON: async () => ({ ok: false, error: 'no reconstruction yet' })
    },
    __HERMES_PLUGINS__: { register: (name, component) => registered.push({ name, component }) }
  }
  const code = readFileSync(join(dash, 'dist', 'index.js'), 'utf8')
  vm.runInNewContext(code, { window, setInterval: () => 0, clearInterval: () => {}, Promise, String, Array })
  return { window, registered }
}

test('manifest declares an entry that exists and the bundle registers that name', () => {
  const manifest = JSON.parse(readFileSync(join(dash, 'manifest.json'), 'utf8'))
  assert.equal(manifest.name, 'achiote')
  assert.ok(manifest.tab && manifest.tab.path.startsWith('/'))
  assert.doesNotThrow(() => readFileSync(join(dash, manifest.entry), 'utf8'))
  const { registered } = loadBundle()
  assert.deepEqual(registered.map((r) => r.name), ['achiote'])
  assert.equal(typeof registered[0].component, 'function')
})

test('view-model: missing backend payload is offline and never invents evidence', () => {
  const { window } = loadBundle()
  const view = window.__ACHIOTE_DASHBOARD__.selectView({ ok: false, error: 'no reconstruction yet' }, { dishes: [] })
  assert.equal(view.offline, true)
  assert.equal(view.error, 'no reconstruction yet')
  assert.equal(JSON.stringify(view.sources), '[]')
  assert.equal(JSON.stringify(view.localSubs), '[]')
  assert.equal(view.citeOk, false)
})

test('view-model: cue, cite verdict, sources, provenance nodes and saved dishes survive', () => {
  const { window } = loadBundle()
  const last = {
    ok: true,
    memory: 'abuela pasteles',
    result: { answer: 'Steam masa in banana leaves.', status: 'first_test_ready' },
    cite: { ok: true, reasons: [] },
    provenance: {
      sources: [{ type: 'doi', doi: '10.1016/j.foodchem.2020.127001', text: 'Smith 2020' }],
      local_subs: [{ type: 'sourcing', text: 'Sourcing guide: banana leaves near Des Moines' }],
      nodes: [{ id: 'memory', kind: 'memory', label: 'abuela pasteles' }, { id: 'src0', kind: 'source', label: 'Smith 2020' }],
      edges: [{ from: 'src0', to: 'cue', rel: 'supports' }]
    }
  }
  const view = window.__ACHIOTE_DASHBOARD__.selectView(last, [{ id: 'd1', title: 'Pasteles', memory: 'm' }])
  assert.equal(view.offline, false)
  assert.equal(view.citeOk, true)
  assert.equal(view.answer, 'Steam masa in banana leaves.')
  assert.equal(view.sources[0].doi, '10.1016/j.foodchem.2020.127001')
  assert.equal(view.localSubs.length, 1)
  assert.deepEqual(view.nodes.map((n) => n.kind), ['memory', 'source'])
  assert.equal(view.edges[0].rel, 'supports')
  assert.equal(view.dishes[0].title, 'Pasteles')
})

test('view-model tolerates wrong types instead of throwing', () => {
  const { window } = loadBundle()
  const view = window.__ACHIOTE_DASHBOARD__.selectView('junk', 'also junk')
  assert.equal(view.offline, true)
  assert.equal(JSON.stringify(view.nodes), '[]')
  assert.equal(JSON.stringify(view.dishes), '[]')
})
