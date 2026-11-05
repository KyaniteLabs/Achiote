import { useQuery } from '@hermes/plugin-sdk'
import { useMemo, useState } from 'react'
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
.achiote-edge{font-size:11px;color:var(--ui-text-tertiary);padding-left:8px}
.achiote-list{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.achiote-list li{padding:6px 8px;border-radius:6px;background:rgba(127,127,127,.06)}
.achiote-tabs{display:flex;gap:6px}
.achiote-tab{cursor:pointer;padding:4px 8px;border-radius:6px;border:1px solid transparent;background:transparent;color:inherit;font:inherit}
.achiote-tab[data-on=true]{border-color:var(--ui-accent);color:var(--ui-accent)}
.achiote-pre{white-space:pre-wrap;word-break:break-word;font-family:var(--font-mono,monospace);font-size:11px;max-height:180px;overflow:auto}
`

function createPane(rest) {
  return function Pane() {
    const [tab, setTab] = useState('cue')
    const lastQ = useQuery({
      queryKey: [ID, 'last'],
      queryFn: () => rest('/last'),
      refetchInterval: 8000,
      retry: false
    })
    const dishesQ = useQuery({
      queryKey: [ID, 'dishes'],
      queryFn: () => rest('/dishes'),
      refetchInterval: 15000,
      retry: false
    })
    const last = lastQ.data || {}
    const cite = last.cite || {}
    const prov = last.provenance || {}
    const result = last.result || {}
    const answer = (result && (result.answer || result.humanReadable)) || ''
    const nodes = Array.isArray(prov.nodes) ? prov.nodes : []
    const edges = Array.isArray(prov.edges) ? prov.edges : []
    const dishes = (dishesQ.data && dishesQ.data.dishes) || []
    const citeOk = !!cite.ok
    const citations = useMemo(() => {
      const c = prov.citations
      return Array.isArray(c) ? c.slice(0, 8) : []
    }, [prov])

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
              'data-ok': String(citeOk),
              children: citeOk ? 'cite-or-die ✓' : 'cite-or-die ✗'
            }),
            jsx('span', {
              className: 'achiote-chip',
              children: last.memory
                ? `memory: ${String(last.memory).slice(0, 48)}`
                : 'no reconstruction yet'
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
                  children:
                    answer ||
                    (lastQ.isError
                      ? 'Backend offline — enable achiote in plugins.enabled + Rescan Desktop plugins.'
                      : 'Run /achiote ask "…" or achiote_reconstruct.')
                }),
                citations.length
                  ? jsxs('div', {
                      children: [
                        jsx('div', {
                          className: 'achiote-muted',
                          style: { marginTop: 8 },
                          children: 'Citations / evidence'
                        }),
                        jsx('ul', {
                          className: 'achiote-list',
                          children: citations.map((c, i) =>
                            jsx(
                              'li',
                              {
                                children:
                                  typeof c === 'string' ? c : JSON.stringify(c).slice(0, 180)
                              },
                              i
                            )
                          )
                        })
                      ]
                    })
                  : null,
                !citeOk && cite.guidance
                  ? jsx('div', {
                      className: 'achiote-muted',
                      style: { marginTop: 8 },
                      children: cite.guidance
                    })
                  : null
              ]
            })
          : null,
        tab === 'provenance'
          ? jsxs('div', {
              className: 'achiote-card',
              children: [
                jsx('div', { className: 'achiote-muted', children: 'Provenance graph' }),
                jsx('div', {
                  className: 'achiote-graph',
                  children: nodes.length
                    ? nodes.map((n) =>
                        jsxs(
                          'div',
                          {
                            children: [
                              jsxs('div', {
                                className: 'achiote-node',
                                children: [
                                  jsx('strong', { children: n.kind || n.id }),
                                  ' · ',
                                  String(n.label || '').slice(0, 120)
                                ]
                              }),
                              edges
                                .filter((e) => e.from === n.id)
                                .map((e, i) =>
                                  jsx(
                                    'div',
                                    { className: 'achiote-edge', children: `→ ${e.to}` },
                                    `${n.id}-${i}`
                                  )
                                )
                            ]
                          },
                          n.id
                        )
                      )
                    : jsx('div', { className: 'achiote-muted', children: 'No graph yet.' })
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
                  children: dishes.length
                    ? dishes.map((d) =>
                        jsxs(
                          'li',
                          {
                            children: [
                              jsx('strong', { children: d.title || 'untitled' }),
                              jsx('div', {
                                className: 'achiote-muted',
                                children: String(d.memory || '').slice(0, 100)
                              })
                            ]
                          },
                          d.id || d.title
                        )
                      )
                    : jsx('li', { children: 'None saved — /achiote save <title>' })
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
