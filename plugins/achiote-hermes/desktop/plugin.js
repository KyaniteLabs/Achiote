import { host, useQuery, useValue } from '@hermes/plugin-sdk'
import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'achiote'

const CSS = `
.achiote-pane{display:flex;flex-direction:column;gap:10px;height:100%;padding:12px;font-size:12px;color:var(--ui-text-primary);overflow:auto}
.achiote-title{font-size:14px;font-weight:600}
.achiote-muted{color:var(--ui-text-tertiary)}
.achiote-card{border:1px solid var(--ui-border,rgba(127,127,127,.25));border-radius:8px;padding:10px;background:var(--chrome-action-hover,transparent)}
.achiote-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.achiote-chip{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--ui-border,rgba(127,127,127,.3))}
.achiote-chip[data-ok=true]{color:var(--ui-accent)}
.achiote-chip[data-ok=false]{color:#d97706}
.achiote-graph{display:flex;flex-direction:column;gap:6px;margin-top:6px}
.achiote-node{padding:6px 8px;border-left:3px solid var(--ui-accent);background:rgba(127,127,127,.08);border-radius:4px}
.achiote-node[data-kind=local_sub]{border-left-color:#16a34a}
.achiote-node[data-kind=memory]{border-left-color:#a855f7}
.achiote-edge{font-size:11px;color:var(--ui-text-tertiary);padding-left:8px}
.achiote-list{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.achiote-list li{padding:6px 8px;border-radius:6px;background:rgba(127,127,127,.06)}
.achiote-tabs{display:flex;gap:6px}
.achiote-tab{cursor:pointer;padding:4px 8px;border-radius:6px;border:1px solid transparent;background:transparent;color:inherit;font:inherit}
.achiote-tab[data-on=true]{border-color:var(--ui-accent);color:var(--ui-accent)}
.achiote-pre{white-space:pre-wrap;word-break:break-word;font-family:var(--font-mono,monospace);font-size:11px;max-height:240px;overflow:auto}
.achiote-src{white-space:pre-wrap;word-break:break-word}
.achiote-src summary{cursor:pointer}
`

/** Query-key scope: the active connection + backend profile. A profile/connection switch yields a
 *  NEW key, so React Query never serves the previous profile's cached data for the new one. */
export function paneScope(connectionId, profile) {
  return `${String(connectionId || 'local').trim() || 'local'}::${String(profile || 'default').trim() || 'default'}`
}

export function queryKeys(scope) {
  return { last: [ID, scope, 'last'], dishes: [ID, scope, 'dishes'] }
}

/** Pure view-model. Data is shown ONLY when the query succeeded for the CURRENT scope; an error
 *  always wins over any retained data (no stale answer hiding the offline message). */
export function selectPaneView({ scope, lastQ, dishesQ }) {
  const usable = (q) =>
    !!q && !q.isError && q.status !== 'error' && q.data && q.scope === scope
  const offline = !!(lastQ && (lastQ.isError || lastQ.status === 'error'))
  const last = usable(lastQ) && lastQ.data.ok !== false ? lastQ.data : {}
  const prov = last.provenance || {}
  const cite = last.cite || {}
  const result = last.result || {}
  return {
    scope,
    offline,
    dishesOffline: !!(dishesQ && (dishesQ.isError || dishesQ.status === 'error')),
    memory: last.memory || '',
    answer: (result && (result.answer || result.humanReadable)) || '',
    citeOk: !!cite.ok,
    cite,
    sources: Array.isArray(prov.sources) ? prov.sources : [],
    localSubs: Array.isArray(prov.local_subs) ? prov.local_subs : [],
    context: prov.context && typeof prov.context === 'object' ? prov.context : {},
    nodes: Array.isArray(prov.nodes) ? prov.nodes : [],
    edges: Array.isArray(prov.edges) ? prov.edges : [],
    dishes: usable(dishesQ) && Array.isArray(dishesQ.data.dishes) ? dishesQ.data.dishes : []
  }
}

/** One citation row: DOI/URL link + full text behind an expander (never a 180-char JSON slice). */
export function sourceRow(s) {
  const text = String((s && (s.text || s.citation || s.doi || s.url)) || '')
  const href = s && (s.doi ? `https://doi.org/${s.doi}` : s.url) || ''
  const label = s && s.doi ? `doi:${s.doi}` : href || (s && s.type) || 'source'
  return { href, label, text, fact: (s && s.fact) || '', origin: (s && s.origin) || '' }
}

function SourceList({ items, empty }) {
  if (!items.length) return jsx('div', { className: 'achiote-muted', children: empty })
  return jsx('ul', {
    className: 'achiote-list',
    children: items.map((s, i) => {
      const r = sourceRow(s)
      return jsx(
        'li',
        {
          children: jsxs('details', {
            className: 'achiote-src',
            children: [
              jsxs('summary', {
                children: [
                  r.href
                    ? jsx('a', { href: r.href, target: '_blank', rel: 'noreferrer', children: r.label })
                    : jsx('strong', { children: r.label }),
                  ' · ',
                  r.text.length > 140 ? `${r.text.slice(0, 140)}…` : r.text
                ]
              }),
              jsx('div', { children: r.text }),
              r.fact ? jsx('div', { className: 'achiote-muted', children: r.fact }) : null,
              r.origin ? jsx('div', { className: 'achiote-muted', children: `from ${r.origin}` }) : null
            ]
          })
        },
        `${r.label}-${i}`
      )
    })
  })
}

function ContextList({ context }) {
  const buckets = [
    ['userSaid', 'You said'],
    ['inferred', 'Inferred'],
    ['unknown', 'Unknown'],
    ['ruledOut', 'Ruled out']
  ].filter(([k]) => Array.isArray(context[k]) && context[k].length)
  if (!buckets.length) return null
  return jsx('div', {
    children: buckets.map(([k, title]) =>
      jsxs(
        'details',
        {
          className: 'achiote-src',
          children: [
            jsx('summary', { className: 'achiote-muted', children: `${title} (${context[k].length}) — not a citation` }),
            jsx('ul', {
              className: 'achiote-list',
              children: context[k].map((t, i) => jsx('li', { children: String(t) }, i))
            })
          ]
        },
        k
      )
    )
  })
}

function createPane(rest) {
  return function Pane() {
    const [tab, setTab] = useState('cue')
    const scope = paneScope(useValue(host.state.connectionId), useValue(host.state.profile))
    const keys = queryKeys(scope)
    const lastQ = useQuery({
      queryKey: keys.last,
      queryFn: () => rest('/last'),
      refetchInterval: 8000,
      retry: false
    })
    const dishesQ = useQuery({
      queryKey: keys.dishes,
      queryFn: () => rest('/dishes'),
      refetchInterval: 15000,
      retry: false
    })
    // The key already carries the scope, so these query states belong to THIS profile/connection.
    // Tagging them keeps selectPaneView honest if a caller ever passes a retained/foreign state.
    const view = selectPaneView({
      scope,
      lastQ: { ...lastQ, scope },
      dishesQ: { ...dishesQ, scope }
    })

    return jsxs('div', {
      className: 'achiote-pane',
      children: [
        jsx('style', { children: CSS }),
        jsx('div', { className: 'achiote-title', children: 'Achiote · Nostalgia' }),
        jsx('div', {
          className: 'achiote-muted',
          children: 'Cue + citations + local swaps · provenance graph · cite-or-die'
        }),
        jsxs('div', {
          className: 'achiote-row',
          children: [
            jsx('span', {
              className: 'achiote-chip',
              'data-ok': String(view.citeOk),
              children: view.offline ? 'backend offline' : view.citeOk ? 'cite-or-die ✓' : 'cite-or-die ✗'
            }),
            jsx('span', {
              className: 'achiote-chip',
              children: view.memory ? `memory: ${String(view.memory).slice(0, 48)}` : 'no reconstruction yet'
            })
          ]
        }),
        jsxs('div', {
          className: 'achiote-tabs',
          children: ['cue', 'provenance', 'dishes'].map((id) =>
            jsx(
              'button',
              {
                type: 'button',
                className: 'achiote-tab',
                'data-on': String(tab === id),
                onClick: () => setTab(id),
                children: id
              },
              id
            )
          )
        }),
        tab === 'cue'
          ? jsxs('div', {
              className: 'achiote-card',
              children: [
                jsx('div', { className: 'achiote-muted', children: 'Minimum viable nostalgia cue' }),
                jsx('div', {
                  className: 'achiote-pre',
                  children: view.offline
                    ? 'Backend offline — enable achiote in plugins.enabled + Rescan Desktop plugins.'
                    : view.answer || 'Run /achiote ask "…" or achiote_reconstruct.'
                }),
                view.offline
                  ? null
                  : jsxs('div', {
                      children: [
                        jsx('div', { className: 'achiote-muted', style: { marginTop: 8 }, children: 'Sources (DOI / URL / researched)' }),
                        jsx(SourceList, { items: view.sources, empty: 'No concrete sources — cite-or-die fails.' }),
                        jsx('div', { className: 'achiote-muted', style: { marginTop: 8 }, children: 'Local swaps / sourcing' }),
                        jsx(SourceList, { items: view.localSubs, empty: 'No local-substitution evidence yet.' }),
                        jsx(ContextList, { context: view.context })
                      ]
                    }),
                !view.offline && !view.citeOk && view.cite.guidance
                  ? jsx('div', { className: 'achiote-muted', style: { marginTop: 8 }, children: view.cite.guidance })
                  : null
              ]
            })
          : null,
        tab === 'provenance'
          ? jsxs('div', {
              className: 'achiote-card',
              children: [
                jsx('div', { className: 'achiote-muted', children: 'Provenance graph (source → claim)' }),
                jsx('div', {
                  className: 'achiote-graph',
                  children: !view.offline && view.nodes.length
                    ? view.nodes.map((n) =>
                        jsxs(
                          'div',
                          {
                            children: [
                              jsxs('div', {
                                className: 'achiote-node',
                                'data-kind': n.kind,
                                children: [
                                  jsx('strong', { children: n.kind || n.id }),
                                  ' · ',
                                  n.url
                                    ? jsx('a', { href: n.url, target: '_blank', rel: 'noreferrer', children: String(n.label || n.url) })
                                    : String(n.label || '')
                                ]
                              }),
                              view.edges
                                .filter((e) => e.from === n.id)
                                .map((e, i) =>
                                  jsx('div', { className: 'achiote-edge', children: `${e.rel || '→'} → ${e.to}` }, `${n.id}-${i}`)
                                )
                            ]
                          },
                          n.id
                        )
                      )
                    : jsx('div', { className: 'achiote-muted', children: view.offline ? 'Backend offline.' : 'No graph yet.' })
                })
              ]
            })
          : null,
        tab === 'dishes'
          ? jsxs('div', {
              className: 'achiote-card',
              children: [
                jsx('div', { className: 'achiote-muted', children: 'Saved family dishes' }),
                jsx('ul', {
                  className: 'achiote-list',
                  children: view.dishesOffline
                    ? jsx('li', { children: 'Backend offline.' })
                    : view.dishes.length
                      ? view.dishes.map((d) =>
                          jsxs(
                            'li',
                            {
                              children: [
                                jsx('strong', { children: d.title || 'untitled' }),
                                jsx('div', { className: 'achiote-muted', children: String(d.memory || '').slice(0, 100) })
                              ]
                            },
                            d.id || d.title
                          )
                        )
                      : jsx('li', { children: 'None saved — /achiote save <title> --id <id>' })
                })
              ]
            })
          : null
      ]
    })
  }
}

export default {
  id: ID,
  name: 'Achiote',
  register(ctx) {
    const Pane = createPane((path, opts) => ctx.rest(path, opts))
    ctx.register({
      id: 'pane',
      area: 'panes',
      title: 'nostalgia',
      data: { placement: 'right', width: '320px' },
      render: () => jsx(Pane, {})
    })
  }
}
