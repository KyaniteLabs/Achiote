# Achiote for Hermes

Disclosure first: no plugin network calls, credentials, subprocesses, bundled binaries, paid services or new runtime dependencies. The host's approved search/extract tools do research (their own provider policies/costs apply). Dish fragments, quotations and proposed recipes are stored locally per profile in `plugin-data/achiote/data.db`, keyed by runtime session. The read-only dashboard API exposes that profile's cases to authenticated Hermes clients; it is not a per-session authorization boundary. Do not use a shared profile for private family memories. Disable/uninstall does not delete stored memories. Back up or remove this plugin's data separately if needed.

Adapted from shared scaffold `b0ff57e17ffd2403647e8bdc87c928b0805bb6f3`; not a wrapper around the TypeScript MCP server. Registration only declares tools, slash/CLI, bundled skill and hook. `pre_llm_call` adds an ephemeral dish-fragment research brief; it does not rewrite system/history or call research services. `achiote_collect` structures intake; `achiote_publish` requires excerpt-backed claims and linked cue/recipe/swaps before persistence. Sources are host-supplied: citation coverage is NOT fact checking, entailment verification or authenticity assurance.

## Install in an isolated test profile

From this repository checkout:

```sh
hermes plugins install ./hermes-plugin
hermes plugins enable achiote
```

Use the profile you intend to test (Hermes `-p` profile option). Enable the unified desktop half separately under Capabilities → Plugins. Do not install into a production profile for a demo. `/achiote <fragment>` starts intake. Then use host research and the schema in `skills/food-memory/SKILL.md`. The pane follows the focused runtime session; cross-profile reads are disabled. No latest-case fallback. Desktop/backend must connect to the same profile.

## Validate

```sh
python3 -m unittest discover -s hermes-plugin/tests -v
node --check hermes-plugin/desktop/plugin.js
hermes plugins validate ./hermes-plugin --json
```

Verified against Hermes source `e76fbd80be65ea5c1b89831f8d7aaedb713f5cac` (0.23.0 development build). Minimum manifest spec is 0.23.0; older builds lacking unified desktop or plugin storage APIs are not tested. CI pins this exact runtime and immutable action SHAs. No runtime Python dependencies introduced. Existing repository dependencies are unchanged; no new package-age exception requested.

Unit fixtures are synthetic contract data with example.org, never research, demo evidence or authentic citations. Tests cover malformed citations, graph integrity, session isolation, refusal preserving the accepted case, hook behavior and inert registration. A validator receipt does not establish live desktop integration. Live UI/screenshot capture, hosted CI and Security review/merge remain explicit release gates.

## Demo: 80 seconds, nostalgia + refusal first

- 0–12s: Lead with the nostalgia pane: tiny cue, recipe, local swaps and the citation-covered/not-fact-verified notice. Use an actually researched dossier, never the test fixture.
- 12–27s: Remove one claim's citations and call `achiote_publish`. Show `gate: refused`; pane retains its previous accepted case.
- 27–42s: Show an ordinary dish fragment triggering the pre-LLM brief; `/achiote` and bundled research skill explain the host-research boundary.
- 42–60s: Restore the genuine quote, publish and expand citations. Follow proposal → claim → source edges in the provenance adjacency view. Keep inferred adaptations visibly distinct from researched facts.
- 60–73s: Change focused session; show empty state rather than another conversation's family dish. Return and show local swap tradeoffs, not stock promises.
- 73–80s: Close: a cheap experiment to recover a sensory cue, not a claim of family-recipe authenticity.

Capture needs: native Hermes desktop with both plugin halves enabled in a disposable same-profile session; genuine host-extracted source URLs/excerpts; dietary/allergy discussion; readable pane, refusal tool receipt, provenance edges, empty second session; 2:1 banner and screenshots; scrub personal memories/session identifiers. No photo input, cooking-session command or locale pack. Do not use synthetic tests as a filmed research result. Drawtext labels should use textfiles, not inline colon-containing strings.

## Submission and rollback

Catalog YAML and disclosure-first PR packet are handed off on the card pinned to the candidate's full SHA. Simon opens the catalog PR Nov 11; this worker does not. Do not describe the branch as reviewed or merged. Re-pin only after Security-approved changes and capture. Go/no-go is Mon Nov 9 evening; second cut after DialectOS. Optional photo/cooking work requires entries 1–5 green and is absent here.

Rollback: disable achiote and the desktop half, then revert the implementation commit. No core/runtime changes. This preserves stored cases; deliberate deletion is a separate user action.
