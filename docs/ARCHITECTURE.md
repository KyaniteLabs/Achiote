# Architecture

Member Berries is a local TypeScript MCP server for culinary nostalgia workflows. It provides deterministic structured context and bounded prompts that a host model can use to reconstruct recipes from food memories.

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
              +--> src/data/*.json
```

## Tool boundaries

The server currently performs a local, research-first workflow:

- structures food-memory fragments into clues and next questions
- plans dish research with hypotheses, source preferences, and facts to verify
- builds an evidence-separated reconstruction dossier
- generates family follow-up questions
- resolves names from bundled dish-family data and ambiguity candidates
- computes substitution candidates from bundled compound data
- returns static regional availability hints
- returns bounded prompts for host-model sensory analysis, sourcing, regional comparison, and recipe generation

It does **not** currently perform live web search, geocoding, inventory lookup, pricing lookup, source extraction, or deterministic final recipe synthesis. Those remain host-model/provider-backed steps.

## Data assets

- `src/data/dish-families.json` maps broad culinary families, aliases, transliterations, regions, divergent elements, and nostalgia triggers.
- `src/data/ingredients.json` maps ingredients to volatile/flavor compounds and substitution groups.
- `src/data/regional-availability.json` contains static US metro-area store/corridor hints.
- `src/data/sensory-profiles.json` defines sensory dimensions and nostalgia-critical criteria.

## Cache

`ResearchCache` stores optional research data in SQLite. By default the CLI uses:

```text
$MEMBER_BERRIES_CACHE_PATH
or $XDG_CACHE_HOME/member-berries/culture-cache.db
or ~/.cache/member-berries/culture-cache.db
```

Tests use temporary directories. Package installs should not write beside `dist/`.

## Trust boundaries

User memories, locations, ingredients, and generated analysis strings are untrusted text. Tool prompts quote those fields as data and instruct the host model not to treat them as instructions, but host clients should still display tool inputs and enforce their own safety controls.

Every reconstruction should distinguish:

- user-said facts
- researched facts
- host-model inferences
- unknowns that need family confirmation or source-backed research
