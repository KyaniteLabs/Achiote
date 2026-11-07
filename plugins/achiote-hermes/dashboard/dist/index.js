/**
 * Achiote — Hermes web-dashboard tab.
 *
 * Plain IIFE (no build step). Uses window.__HERMES_PLUGIN_SDK__ for React and fetchJSON, and the
 * backend beside this file (dashboard/plugin_api.py) mounted at /api/plugins/achiote/.
 * Mirrors the Desktop pane: cue, cite-or-die verdict, provenance graph, saved dishes.
 */
(function () {
  "use strict";

  var SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK) return;

  var React = SDK.React;
  var h = React.createElement;
  var API = "/api/plugins/achiote";

  var CSS = [
    ".achiote-pane{display:flex;flex-direction:column;gap:10px;padding:16px;font-size:13px;max-width:1100px;font-family:var(--font-sans)}",
    ".achiote-title{font-size:16px;font-weight:600}",
    ".achiote-muted{color:var(--color-muted-foreground);font-size:12px}",
    ".achiote-card{border:1px solid var(--color-border);border-radius:var(--radius);padding:12px;background:var(--color-card);color:var(--color-card-foreground)}",
    ".achiote-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
    ".achiote-chip{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--color-border);color:var(--color-muted-foreground)}",
    ".achiote-chip[data-ok=true]{border-color:var(--color-success);color:var(--color-success)}",
    ".achiote-chip[data-ok=false]{border-color:var(--color-warning);color:var(--color-warning)}",
    ".achiote-graph{display:grid;gap:6px}",
    ".achiote-node{padding:6px 8px;border-left:3px solid var(--color-muted-foreground);background:var(--color-muted);border-radius:var(--radius);word-break:break-word}",
    ".achiote-node[data-kind=memory]{border-left-color:var(--color-warning)}",
    ".achiote-node[data-kind=local_sub]{border-left-color:var(--color-success)}",
    ".achiote-edge{font-size:11px;color:var(--color-muted-foreground);padding-left:10px}",
    ".achiote-list{display:flex;flex-direction:column;gap:6px;margin:6px 0 0;padding:0;list-style:none}",
    ".achiote-list li{padding:6px 8px;border-radius:var(--radius);background:var(--color-muted);word-break:break-word}",
    ".achiote-pre{white-space:pre-wrap;word-break:break-word;margin-top:6px}"
  ].join("\n");

  /** Pure view-model, exported for tests: tolerant of a missing/blank backend payload. */
  function selectView(last, dishes) {
    var l = last && typeof last === "object" ? last : {};
    var prov = l.provenance && typeof l.provenance === "object" ? l.provenance : {};
    var cite = l.cite && typeof l.cite === "object" ? l.cite : {};
    var result = l.result && typeof l.result === "object" ? l.result : {};
    var list = Array.isArray(dishes) ? dishes : (dishes && Array.isArray(dishes.dishes) ? dishes.dishes : []);
    return {
      offline: l.ok !== true,
      error: typeof l.error === "string" ? l.error : "",
      memory: typeof l.memory === "string" ? l.memory : "",
      answer: typeof result.answer === "string" ? result.answer : "",
      status: result.status || null,
      citeOk: cite.ok === true,
      reasons: Array.isArray(cite.reasons) ? cite.reasons.map(String) : [],
      sources: Array.isArray(prov.sources) ? prov.sources : [],
      localSubs: Array.isArray(prov.local_subs) ? prov.local_subs : [],
      nodes: Array.isArray(prov.nodes) ? prov.nodes : [],
      edges: Array.isArray(prov.edges) ? prov.edges : [],
      dishes: list
    };
  }

  function sourceHref(s) {
    if (!s || typeof s !== "object") return "";
    if (typeof s.doi === "string" && s.doi) return "https://doi.org/" + s.doi;
    if (typeof s.url === "string" && /^https?:\/\//.test(s.url)) return s.url;
    return "";
  }

  /** Truncate for display, never mid-word without a visible ellipsis. */
  function clip(text, n) {
    var s = String(text == null ? "" : text);
    return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…";
  }

  function sourceLabel(s, i) {
    var text = (s && (s.text || s.citation || s.doi || s.url)) || "source";
    return clip(text, 160) + " · " + String((s && s.type) || "record") + " #" + (i + 1);
  }

  function SourceList(props) {
    if (!props.items.length) return h("div", { className: "achiote-muted" }, props.empty);
    return h(
      "ul",
      { className: "achiote-list" },
      props.items.map(function (s, i) {
        var href = sourceHref(s);
        return h(
          "li",
          { key: String(i) },
          href
            ? h("a", { href: href, target: "_blank", rel: "noreferrer" }, sourceLabel(s, i))
            : h("span", null, sourceLabel(s, i)),
          s && s.origin ? h("div", { className: "achiote-muted" }, "from " + s.origin) : null
        );
      })
    );
  }

  function Graph(props) {
    if (!props.nodes.length) {
      return h("div", { className: "achiote-muted" }, props.empty);
    }
    return h(
      "div",
      { className: "achiote-graph" },
      props.nodes.map(function (n) {
        var href = sourceHref(n);
        return h(
          "div",
          { key: String(n.id) },
          h(
            "div",
            { className: "achiote-node", "data-kind": n.kind },
            h("strong", null, String(n.kind || n.id)),
            " · ",
            href
              ? h("a", { href: href, target: "_blank", rel: "noreferrer" }, String(n.label || href))
              : String(n.label || "")
          ),
          props.edges
            .filter(function (e) { return e && e.from === n.id; })
            .map(function (e, i) {
              return h("div", { className: "achiote-edge", key: String(i) },
                String(e.rel || "→") + " → " + String(e.to));
            })
        );
      })
    );
  }

  function Pane() {
    var stateHook = SDK.hooks.useState({ loading: true, last: null, dishes: [], fetchError: "" });
    var state = stateHook[0];
    var setState = stateHook[1];

    SDK.hooks.useEffect(function () {
      var alive = true;
      function read(path) {
        return Promise.resolve(SDK.fetchJSON(API + path)).catch(function (err) {
          return { ok: false, error: String((err && err.message) || err || "request failed") };
        });
      }
      function load() {
        Promise.all([read("/last"), read("/dishes")]).then(function (out) {
          if (!alive) return;
          setState({
            loading: false,
            last: out[0],
            dishes: out[1] && Array.isArray(out[1].dishes) ? out[1].dishes : [],
            fetchError: out[0] && out[0].ok === false ? String(out[0].error || "") : ""
          });
        });
      }
      load();
      var timer = setInterval(load, 8000);
      return function () { alive = false; clearInterval(timer); };
    }, []);

    var v = selectView(state.last, state.dishes);

    return h(
      "div",
      { className: "achiote-pane" },
      h("style", null, CSS),
      h("div", { className: "achiote-title" }, "Achiote · Nostalgia"),
      h("div", { className: "achiote-muted" }, "Cue + citations + local swaps · provenance graph · cite-or-die"),
      h(
        "div",
        { className: "achiote-row" },
        h("span", { className: "achiote-chip", "data-ok": String(v.citeOk) },
          v.offline ? "no reconstruction yet" : v.citeOk ? "cite-or-die ✓" : "cite-or-die ✗"),
        h("span", { className: "achiote-chip" },
          v.memory ? "memory: " + clip(v.memory, 60) : "run /achiote ask or achiote_reconstruct")
      ),
      h(
        "div",
        { className: "achiote-card" },
        h("div", { className: "achiote-muted" }, "Minimum viable nostalgia cue"),
        h("div", { className: "achiote-pre" }, state.loading ? "Loading…" : (v.answer || v.error || "No reconstruction yet.")),
        v.reasons.length
          ? h("div", { className: "achiote-muted" }, "cite-or-die: " + v.reasons.join("; "))
          : null
      ),
      h(
        "div",
        { className: "achiote-card" },
        h("div", { className: "achiote-muted" }, "Sources (DOI / URL / researched)"),
        h(SourceList, { items: v.sources, empty: "No concrete sources — cite-or-die fails." }),
        h("div", { className: "achiote-muted", style: { marginTop: 10 } }, "Local swaps / sourcing"),
        h(SourceList, { items: v.localSubs, empty: "No local-substitution evidence yet." })
      ),
      h(
        "div",
        { className: "achiote-card" },
        h("div", { className: "achiote-muted" }, "Provenance graph (source → claim)"),
        h(Graph, { nodes: v.nodes, edges: v.edges, empty: v.offline ? "No graph yet." : "No graph yet." })
      ),
      h(
        "div",
        { className: "achiote-card" },
        h("div", { className: "achiote-muted" }, "Saved family dishes"),
        v.dishes.length
          ? h("ul", { className: "achiote-list" }, v.dishes.map(function (d, i) {
              return h("li", { key: String(d.id || i) },
                h("strong", null, String(d.title || "untitled")),
                h("div", { className: "achiote-muted" }, clip(d.memory || "", 120)));
            }))
          : h("div", { className: "achiote-muted" }, "None saved — /achiote save <title> --id <id>")
      )
    );
  }

  // Test seam: the dashboard bundle's view-model, without needing a React renderer.
  window.__ACHIOTE_DASHBOARD__ = { selectView: selectView, api: API };
  window.__HERMES_PLUGINS__.register("achiote", Pane);
})();
