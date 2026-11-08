# Achiote architecture

A TypeScript/Node application whose domain core turns incomplete food memories into evidence-separated reconstruction and a small testable nostalgia cue. Read [PRODUCT.md](PRODUCT.md) before changing the workflow. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) contains the longer module map; executable source wins where older prose differs (notably pantry counts and optional search).

## Parts and data flow

```text
MCP host -> index.ts / cli.ts -> server.ts -> tool registry -> domain modules
Browser / HTTP client -> http-server.ts -> access controls -> /ask engine
                                                        -> provider session
                                                        -> same tool registry
Tools -> structured elicitation -> research plan/provenance -> dossier
      -> minimum viable nostalgia cue -> Memory Receipt -> optional recipe handoff
Data JSON + optional SQLite overlay -> lookup/retrieval -> tool outputs
```

- [src/server.ts](src/server.ts) registers MCP tools. [src/tools/tool-registry.ts](src/tools/tool-registry.ts) defines schemas, bounded prompts, deterministic helpers, and execution shared by the runtime surfaces; [src/core/reconstruct-tool.ts](src/core/reconstruct-tool.ts) exposes whole-workflow reconstruction.
- [src/http-server.ts](src/http-server.ts) serves the static product pages, HTTP MCP, SSE `/ask`, health, speech, and additional operator/billing routes. [src/core/ask-engine.ts](src/core/ask-engine.ts) runs conversation/tool orchestration. [ask-controller](src/lib/ask-controller.ts) injects a deterministic workflow plan before model-directed tool work; guardrails, memory correction, and response builders constrain the result.
- [provider-runtime](src/lib/provider-runtime.ts) and [ask-provider](src/lib/ask-provider.ts) separate provider/model transport from domain work. Provider synthesis is not a database fact. The optional `search_web` adapter is configuration-dependent, not guaranteed research.
- [docs/landing/app.js](docs/landing/app.js) and [product-app.js](docs/landing/product-app.js) drive browser conversation/SSE handling. The receipt renderer reads data from a URL fragment rather than a server-side share record.
- [reference-pantry](src/lib/reference-pantry.ts) checks an exact SQLite overlay match, then an exact bundled fixture, then a bundled global family match. [research-cache](src/lib/research-cache.ts) owns SQLite research storage. Cache location follows `ACHIOTE_CACHE_PATH`, then `XDG_CACHE_HOME`, then the user's cache directory; do not write beside installed package files.
- [account-access](src/lib/account-access.ts), auth, rate-limit, and billing modules own the HTTP access boundary. [local-speech-controller](src/lib/local-speech-controller.ts) delegates optional speech to configured local engines; it is separate from the food-memory core.

## Risky paths and failure signatures

| Boundary | What can go wrong / what failure looks like |
| --- | --- |
| Elicitation and model synthesis | Premature named-dish certainty, ignored corrections, invented provenance, or a recipe before enough clues. Preserve user-said/researched/inferred/unknown distinctions; test intake, workflow planning, and reconstruction together. |
| Reference retrieval | Broad family context mistaken for a family-confirmed recipe, stale overlay masking bundled data, or seed targets mistaken for facts. Inspect provenance and match scope, not just a nonempty lookup. |
| Provider/tool loop | Missing credentials, timeouts, unsupported tools, repeated calls, or synthesis drift. Engine code has recovery/guarded paths; a fallback answer or HTTP 200 alone does not prove a useful reconstruction. |
| HTTP access and streaming | Anonymous processing accidentally exposed, quota/auth rejection, interrupted SSE, or unreadable partial output. Check real browser error paths as well as API status. Self-hosted anonymous ask is an explicit demo setting. |
| Memory privacy | Raw family text or voices leaking through logs, telemetry, external providers, or share links. Receipt fragments avoid HTTP route payload storage but are not encryption or authorization. |
| Substitution and speech | Dietary rewrite mistaken for medical safety, static store hints mistaken for inventory, or unavailable local speech engines. Surface constraints/readiness; do not promise safe food or language accuracy from code presence. |
| Packaging/native storage | Missing static assets or failed `better-sqlite3` native install makes a source build look healthier than an installed app. Check the packaged entrypoints and assets, not only TypeScript compilation. |

## Verification and safe change scope

`npm run build`, targeted reconstruction/planner/reference tests, and `npm run reference:coverage` exercise relevant source contracts. `npm run package:smoke` checks the installed package surface. None establishes production health or correct family identification. For operator changes, capture actual browser/MCP user-side evidence, including failures. Documentation changes here do not alter runtime configuration, databases, services, providers, or deployment; reverting the documentation commit is the rollback.
