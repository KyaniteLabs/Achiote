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
    /* Type roles. The theme owns the family (var(--font-sans)); Achiote owns only the
       hierarchy inside it, so the voice survives every theme swap. */
    ".achiote-pane{display:flex;flex-direction:column;gap:14px;padding:18px;font-size:13px;line-height:1.55;max-width:1100px;font-family:var(--font-sans)}",
    ".achiote-eyebrow{font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--color-muted-foreground)}",
    ".achiote-title{font-size:21px;font-weight:700;letter-spacing:-.02em;line-height:1.2;color:var(--color-card-foreground)}",
    ".achiote-lede{font-size:13px;color:var(--color-muted-foreground);margin-top:2px}",
    ".achiote-muted{color:var(--color-muted-foreground);font-size:12px}",
    ".achiote-value{font-size:15px;font-weight:500;line-height:1.5;color:var(--color-card-foreground);margin-top:6px}",
    ".achiote-sec{margin-top:14px}",

    /* Geometry echoes the mark: a faceted stone, not a flat rounded rect. The chamfer is
       shape only, so it reads identically in every theme. */
    ".achiote-card{border:1px solid var(--color-border);border-radius:var(--radius);padding:14px;background:var(--color-card);color:var(--color-card-foreground);clip-path:polygon(14px 0,100% 0,100% 100%,0 100%,0 14px)}",
    /* The provenance graph is the product, so it is the only hero: bigger, and chamfered on
       two corners like a cut facet. Everything else is supporting evidence. */
    ".achiote-hero{border:1px solid var(--color-border);border-radius:var(--radius);padding:18px;background:var(--color-card);color:var(--color-card-foreground);clip-path:polygon(18px 0,100% 0,100% calc(100% - 18px),calc(100% - 18px) 100%,0 100%,0 18px)}",

    ".achiote-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
    ".achiote-chip{font-size:11px;font-weight:600;letter-spacing:.03em;padding:3px 9px;border-radius:999px;border:1px solid var(--color-border);color:var(--color-muted-foreground)}",
    ".achiote-chip[data-ok=true]{border-color:var(--color-success);color:var(--color-success)}",
    ".achiote-chip[data-ok=false]{border-color:var(--color-warning);color:var(--color-warning)}",
    /* A failure is not an empty queue. It gets its own unmistakable treatment rather than
       reusing the same dim text as "nothing here yet". */
    ".achiote-state{border:1px solid var(--color-border);border-left-width:3px;border-radius:var(--radius);padding:11px 13px;margin-top:8px;font-size:13px}",
    ".achiote-state[data-phase=failed]{border-left-color:var(--color-warning);color:var(--color-card-foreground)}",
    ".achiote-state[data-phase=empty]{border-left-color:var(--color-border);color:var(--color-muted-foreground)}",
    ".achiote-state b{font-weight:600}",

    ".achiote-graph{display:grid;gap:7px;margin-top:10px}",
    ".achiote-node{padding:8px 10px;border-left:3px solid var(--color-muted-foreground);background:var(--color-muted);border-radius:var(--radius);word-break:break-word;font-size:13px}",
    ".achiote-node[data-kind=memory]{border-left-color:var(--color-warning)}",
    ".achiote-node[data-kind=local_sub]{border-left-color:var(--color-success)}",
    ".achiote-edge{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--color-muted-foreground);padding-left:11px}",
    ".achiote-list{display:flex;flex-direction:column;gap:6px;margin:8px 0 0;padding:0;list-style:none}",
    ".achiote-list li{padding:8px 10px;border-radius:var(--radius);background:var(--color-muted);word-break:break-word}",
    ".achiote-pre{white-space:pre-wrap;word-break:break-word;margin-top:8px;font-size:15px;line-height:1.55}",

    /* Access. Links were byte-identical to body ink and had no focus affordance at all
       (measured 1.03-1.17:1 on the dark card), so they were invisible as links. */
    ".achiote-pane a{color:var(--color-card-foreground);text-decoration:underline;text-underline-offset:2px}",
    ".achiote-pane a:focus-visible{outline:2px solid var(--color-warning);outline-offset:2px;border-radius:2px}"
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
      /* Three distinct phases, never conflated. "failed" means the pane could not learn
         anything; "empty" means it asked and there is genuinely nothing yet. Rendering a
         failure in empty-state language tells the user to go look for work that does not
         exist, which is the exact bug this field exists to prevent. */
      phase: l.ok !== true ? "failed"
        : (result.answer || prov.sources && prov.sources.length || prov.nodes && prov.nodes.length) ? "ok"
        : "empty",
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

  /** Crossref registered DOI prefix: 10.<4-9 digits>/<no whitespace>. */
  var DOI_RE = /^10\.\d{4,9}\/\S+$/;

  /** Normalise a DOI to one that actually resolves, or "" when it cannot be trusted.
   *
   * Citation prose leaves artefacts on identifiers: a "doi:" prefix, a wrapped
   * https://dx.doi.org/ URL, and trailing punctuation from the sentence around it.
   * A cite-or-die pane must never emit a link that 404s, so a candidate that fails the
   * registered DOI shape returns "" and the caller shows text instead of a dead href.
   * Parentheses are legal inside DOIs, so ")" is stripped only when it is unbalanced. */
  function normaliseDoi(raw) {
    if (typeof raw !== "string") return "";
    var d = raw.trim()
      .replace(/^(https?:\/\/(dx\.)?doi\.org\/)/i, "")
      .replace(/^doi:\s*/i, "")
      .replace(/^[<"'\s]+/, "")
      .replace(/[\s>"']+$/, "");
    // Strip sentence and wrapping punctuation BEFORE validating, since \S+ would happily
    // accept a trailing ")" or "." as part of the identifier.
    for (;;) {
      var tail = d.slice(-1);
      if (tail === ")") {
        if ((d.match(/\)/g) || []).length > (d.match(/\(/g) || []).length) { d = d.slice(0, -1); continue; }
        break;
      }
      if (tail === "." || tail === "," || tail === ";") { d = d.slice(0, -1); continue; }
      break;
    }
    return DOI_RE.test(d) ? d : "";
  }

  function sourceHref(s) {
    if (!s || typeof s !== "object") return "";
    var doi = normaliseDoi(s.doi);
    if (doi) return "https://doi.org/" + doi;
    if (typeof s.url === "string" && /^https?:\/\//.test(s.url)) return s.url;
    return "";
  }

  /** Truncate for display, never mid-word without a visible ellipsis. */
  function clip(text, n) {
    var s = String(text == null ? "" : text);
    if (s.length <= n) return s; var cut = s.slice(0, n - 1); var c = s.charAt(n - 1); if (/\s/.test(c)) return cut + "…"; var i = cut.lastIndexOf(" "); return (i > 0 ? cut.slice(0, i) : cut) + "…";
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

    var StateNotice = null;
    if (v.phase === "failed") {
      StateNotice = h(
        "div", { className: "achiote-state", "data-phase": "failed" },
        h("b", null, "Achiote could not be reached. "),
        "This is a failure, not an empty result. Nothing was reconstructed and nothing was checked. ",
        v.error ? h("span", { className: "achiote-muted" }, String(v.error)) : null
      );
    } else if (v.phase === "empty") {
      StateNotice = h(
        "div", { className: "achiote-state", "data-phase": "empty" },
        h("b", null, "Nothing reconstructed yet. "),
        "Achiote answered, there is simply no memory to work from. Run ",
        h("code", null, "/achiote ask"), " or ", h("code", null, "achiote_reconstruct"), "."
      );
    }

    return h(
      "div",
      { className: "achiote-pane" },
      h("style", null, CSS),

      h("div", { className: "achiote-eyebrow" }, "Hermes plugin · cite-or-die"),
      h("div", { className: "achiote-title" }, "Achiote"),
      h("div", { className: "achiote-lede" }, "Food-memory reconstruction. Every claim carries its source or it does not ship."),

      h(
        "div",
        { className: "achiote-row" },
        h("span", { className: "achiote-chip", "data-ok": String(v.phase !== "failed" && v.citeOk) },
          v.phase === "failed" ? "cite-or-die: unverified" : v.citeOk ? "cite-or-die ✓" : "cite-or-die ✗"),
        h("span", { className: "achiote-chip" },
          v.memory ? "memory: " + clip(v.memory, 60) : "no memory loaded")
      ),

      StateNotice,

      /* HERO. The cue and its provenance are one object, because "the answer and why you
         can trust it" is a single thing. The graph is what makes this pane Achiote and
         nothing else, so it carries the cut-facet treatment. */
      h(
        "div",
        { className: "achiote-hero" },
        h("div", { className: "achiote-eyebrow" }, "Minimum viable nostalgia cue"),
        h("div", { className: "achiote-pre" },
          state.loading ? "Loading…" : (v.answer || v.error || (v.phase === "failed" ? "Unavailable." : "Nothing reconstructed yet."))),
        v.reasons.length
          ? h("div", { className: "achiote-muted achiote-sec" }, "cite-or-die: " + v.reasons.join("; "))
          : null,
        h("div", { className: "achiote-eyebrow achiote-sec" }, "Provenance · source → claim"),
        h(Graph, {
          nodes: v.nodes,
          edges: v.edges,
          empty: v.phase === "failed"
            ? "No graph. The pane could not reach Achiote, so there is nothing to show."
            : "No graph yet. Once a memory is reconstructed, every step of the reasoning appears here."
        })
      ),

      h(
        "div",
        { className: "achiote-card" },
        h("div", { className: "achiote-eyebrow" }, "Sources · DOI / URL / researched"),
        h(SourceList, {
          items: v.sources,
          empty: v.phase === "failed"
            ? "Cannot list sources while Achiote is unreachable."
            : "No concrete sources. Cite-or-die fails on this reconstruction."
        }),
        h("div", { className: "achiote-eyebrow achiote-sec" }, "Local swaps / sourcing"),
        h(SourceList, { items: v.localSubs, empty: "No local-substitution evidence yet." })
      ),

      h(
        "div",
        { className: "achiote-card" },
        h("div", { className: "achiote-eyebrow" }, "Saved family dishes"),
        v.dishes.length
          ? h("ul", { className: "achiote-list" }, v.dishes.map(function (d, i) {
              return h("li", { key: String(d.id || i) },
                h("strong", null, String(d.title || "untitled")),
                h("div", { className: "achiote-muted" }, clip(d.memory || "", 120)));
            }))
          : h("div", { className: "achiote-state", "data-phase": "empty" },
              "None saved. ", h("code", null, "/achiote save <title> --id <id>"))
      )
    );
  }

  // Test seam: the dashboard bundle's view-model, without needing a React renderer.
  window.__ACHIOTE_DASHBOARD__ = { selectView: selectView, api: API };
  window.__HERMES_PLUGINS__.register("achiote", Pane);
})();
