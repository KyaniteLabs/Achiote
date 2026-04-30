# Architecture

Achiote is a TypeScript MCP server for research-first food-memory reconstruction. It provides deterministic structured context, typed provenance contracts, cache helpers, and bounded prompts that a host model can use to reconstruct recipes from food memories.

## Runtime shape

```text
MCP client / host model
        |
        | stdio MCP
        v
src/index.ts
  - public package entrypoint
  - preserves direct `node dist/index.js` stdio startup
        |
        +--> src/cli.ts                  # stdio runner
        +--> src/server.ts               # MCP server and tool registration
              |
              +--> src/schemas/tool-schemas.ts
              +--> src/tools/results.ts
              +--> src/lib/cache-path.ts
              +--> src/lib/regional-matcher.ts
              +--> src/lib/memory-workflow.ts
              +--> src/lib/name-resolver.ts
              +--> src/lib/substitution-engine.ts
              +--> src/lib/research-cache.ts
              +--> src/lib/research-provenance.ts
              +--> src/lib/recipe-generator.ts
              +--> src/data/*.json

src/http-server.ts
  - optional HTTP mode for web UI and AI agent endpoint
  - started via: node dist/http-server.js
  - endpoints:
      GET  /           → docs/landing/app.html (web UI)
      GET  /about      → docs/landing/index.html (landing page)
      GET  /health     → JSON status with memory/uptime metrics
      GET  /voice/status → local OSS speech readiness
      POST /voice/transcribe → local speech-to-text through configured OSS binaries/models
      POST /voice/synthesize → local text-to-speech through configured OSS binaries/models
      POST /ask        → SSE streaming AI agent (auth + rate limited)
      POST /mcp        → Streamable HTTP MCP transport
      GET  /static/*   → JS/CSS assets
  - auth: x-api-key header or Authorization bearer token (configurable via ACHIOTE_AUTH_ENABLED)
  - rate limiting: tiered (free/personal/pro/family/enterprise, with business as a legacy alias) per calendar month
  - shares tool execution logic with src/server.ts
```

## Tool boundaries

The server currently performs a research-first workflow:

- structures food-memory fragments into clues and next questions
- plans dish research with hypotheses, source preferences, and facts to verify
- converts host-researched source facts into typed research provenance records
- validates and summarizes research records for dossier handoff
- builds an evidence-separated reconstruction dossier
- generates family follow-up questions
- resolves names from bundled dish-family data and ambiguity candidates
- computes substitution candidates from bundled compound data
- returns static regional availability hints
- generates the minimum viable nostalgia cue as the default first food output, prioritizing easy/cheap/findable proxy ingredients and explicit substitute logic
- returns bounded prompts for host-model sensory analysis, sourcing, regional comparison, and optional recipe generation

The server does not browse the web itself. It can structure and validate source facts that a host AI supplies after using its own search/browsing tools, and future optional food-data providers can add structured lookups. Final natural-language recipe writing remains a host-model step and should happen only after the minimum viable nostalgia cue unless the user explicitly asks otherwise.

## Local OSS speech boundary

Speech is an optional HTTP-mode input/output layer, not part of the MCP reasoning core. It is disabled by default and only runs when the operator configures local OSS speech engines. The intended production stack is `whisper.cpp` for multilingual speech-to-text and Kokoro-82M for read-aloud. STT defaults to `auto` language detection and accepts language hints so accented, code-switched, transliterated, or immigrant-family memories can be captured without forcing users to spell dish names correctly.

`GET /voice/status` exposes readiness and configured language/voice options. `POST /voice/transcribe` and `POST /voice/synthesize` follow the same auth and anonymous-demo policy as `/ask`; recorded voices and family memories are sensitive user data. The server passes audio/text to local subprocesses with argv arrays, not shell interpolation. No hosted speech API is called by this layer.

## Data assets

- `src/data/dish-families.json` maps broad culinary families, aliases, transliterations, regions, divergent elements, and nostalgia triggers.
- `src/data/ingredients.json` maps ingredients to volatile/flavor compounds and substitution groups.
- `src/data/regional-availability.json` contains static US metro-area store/corridor hints.
- `src/data/sensory-profiles.json` defines sensory dimensions and nostalgia-critical criteria.
- `src/data/global-coverage-matrix.json`, `src/data/reference-seed-queue.json`, and `src/data/cache-warming-manifest.json` define the private operator reference-seeding loop. They are seed hypotheses and task manifests, not authoritative culinary facts.
- `src/data/reference-source-registry.json` defines which public source classes are allowed for pantry fixtures, which require manual review, and which patterns are forbidden.
- `src/data/inference-burden-inventory.json` names repeatable prompt and inference burdens that should move into deterministic data, retrieval, controller, validator, formatter, observability, or consent layers while preserving model-owned reasoning latitude.

## Inference burden operating model

Achiote should make the model synthesize, not make it do bookkeeping. The inference burden inventory is the system map for reducing prompt load without making reconstruction rigid. It is permanent source data, compiled into `dist/data/`, and queried through `src/lib/inference-burden-inventory.ts`.

The inventory assigns ownership:

- data owns aliases, cultural patterns, sensory mechanisms, and source policy
- retrieval owns pantry records, cache records, regional availability, and substitution candidates
- controllers own workflow state, provider profiles, tool transitions, and retry budgets
- validators own trust boundaries, output sanitizers, schema conformance, and tool alias repair
- formatters own receipts, case files, output sections, and prompt templates
- observability owns aggregate quality signals and seed priorities
- consent gates own optional analytics and quality-signal recording

The model still owns interpretation: sensory reasoning, cultural synthesis, hypothesis ranking, ambiguity handling, humane explanation, creative cue construction, and deciding when retrieved context does not fit the user's memory. Every burden entry must state what latitude is preserved and what could go wrong if the deterministic layer becomes too rigid.

## Cross-model telemetry loop

Cloud and local torture tests feed the same telemetry model instead of staying as separate anecdotes. `src/lib/model-telemetry.ts` normalizes local canary summaries, weak-cloud JSONL rows, and local profiler artifacts into one event shape with provider, model, mode, prompt/case, status, findings, quality labels, guard reason, tool path, latency, errors, and trace previews. `scripts/model-telemetry-report.mjs` mines those events for recurring engineering patterns such as tool workflow fragility, fallback quality drift, provider/runtime instability, trust-boundary pressure, latency outliers, guard dependency, and reasoning trace exposure.

Local model runs also record the load configuration as first-class telemetry. `src/lib/local-inference-profiles.ts` defines `speed`, `quality`, and `memory` profiles with explicit LM Studio native REST load payloads plus advanced SDK-only knobs that should remain visible even when the REST endpoint cannot send them. `scripts/local-inference-profiler.mjs` uses LM Studio `/api/v1/models/load` for load telemetry and `/v1/chat/completions` for direct OpenAI-compatible probes, preserving intended load payloads, echoed load config, usage, latency, errors, text previews, and reasoning-trace previews when a model exposes them.

Reasoning traces are diagnostic telemetry, not facts and not user-facing content. They are useful for seeing whether a model is planning the wrong task, leaking scratchpad text, overfitting to guardrails, or drifting into recipes, but they must be treated as untrusted model output and sanitized before any product display.

## Reference seed operating loop

HTTP `/ask` records privacy-preserving quality counters for successful completions: memory type, bounded family bucket, region bucket, guard path, search outcome, reference/cache outcome, and missing-clue dimensions. Authenticated `GET /events` returns those counters plus deterministic reference seed priorities and reference bootstrap tasks from `buildReferenceSeedOperatorReport`.

The local operator script runs with:

```bash
npm run reference:seeds -- --quality-report quality.json --limit 10
npm run reference:seeds -- --fixture approved-fixture.json --cache-path ~/.cache/achiote/culture-cache.db
npm run reference:seeds -- --fixture bundled --cache-path ~/.cache/achiote/culture-cache.db
```

The script does not browse. Report mode prints host-research prompts for approved human or host-AI research. Fixture mode validates typed `ResearchRecord` artifacts against the reference manifest before writing them to SQLite. Raw memories, prompts, provider details, credentials, medical claims, and legal claims do not belong in seed data or fixtures.

Reference pantry growth is source-gated. CC0/public-domain structured data such as Wikidata labels/aliases and USDA FoodData Central commodity facts may be used for approved typed fixtures when cited. ODbL product data and FAO/INFOODS composition tables are manual-review sources because attribution, share-alike, or redistribution terms must be checked before fixture use. Copied recipe instructions, article prose, proprietary food guides, uncited model-generated facts, and user memories are never fixture material.

The coverage matrix includes broad world culture-area buckets so the operator can see whether the pantry is overfitting to a few regions. These buckets are planning coverage only; they do not assert that one seed represents an entire culture. The bundled fixture batch in `src/data/reference-pantry-fixtures.json` now contains 138 typed `ResearchRecord` entries across all current reference targets, using Wikidata structured labels/descriptions under the allowed CC0 source policy. Runtime tools check SQLite first, then fall back to this bundled baseline, so the pantry is available without a bootstrap step. Expansion 1 adds a balanced 20 culture-area by six food-memory-band matrix so every bucket has staple-starch, liquid/comfort, acid/condiment, protein/vegetable main, handheld/social, and sweet/ritual grounding. The batch can truthfully satisfy the seed-hypothesis and researched-record evidence levels, but it does not claim family confirmation or operator quality-signal evidence.

## Cache

`ResearchCache` stores optional overlay research data in SQLite and can store/retrieve typed `ResearchRecord` JSON. The bundled reference pantry is the immutable baseline; SQLite is for deployment-local overlays, operator-approved additions, and optional bootstrap copies. Runtime reference lookup order is:

1. SQLite overlay exact match.
2. Bundled pantry exact match.
3. Bundled pantry family-level global match when available.

By default the CLI uses:

```text
$ACHIOTE_CACHE_PATH
or $XDG_CACHE_HOME/achiote/culture-cache.db
or ~/.cache/achiote/culture-cache.db
```

Tests use temporary directories. Package installs should not write beside `dist/`.

## Trust boundaries

User memories, locations, ingredients, and generated analysis strings are untrusted text. Tool prompts quote those fields as data and instruct the host model not to treat them as instructions, but host clients should still display tool inputs and enforce their own safety controls.

Every reconstruction should distinguish:

- user-said facts
- researched facts
- host-model inferences
- unknowns that need family confirmation or source-backed research
