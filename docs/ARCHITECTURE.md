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

## Cache

`ResearchCache` stores optional research data in SQLite and can store/retrieve typed `ResearchRecord` JSON. By default the CLI uses:

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
