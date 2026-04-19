# Member Berries

Member Berries is a local **Model Context Protocol (MCP)** server for culinary nostalgia workflows. It helps a host model reverse-engineer the sensory triggers of remembered dishes using bundled cultural dish-family data, ingredient compound data, and regional sourcing hints.

> "The nostalgia lives in the maillard crust's interaction with the lactic tang — here's how to reproduce that."

## What It Does Today

Member Berries is a research-first food-memory reconstruction server. It provides 13 MCP tools that let a host AI chat client run the whole workflow from a fragment to a recipe-generation handoff:

| Stage | Tool | Implemented behavior |
|------|------|----------------------|
| Memory intake | `collect_food_memory` | Structures raw fragments, sound-alikes, family context, remembered ingredients, sensory clues, missing information, and gentle next questions. |
| Research planning | `plan_dish_research` | Produces hypotheses, search queries, source preferences, facts to verify, and clarification questions. It plans research instead of pretending sparse fragments are solved. |
| Research provenance | `build_research_record` / `validate_research_record` / `extract_research_findings` | Converts host-researched source facts into typed provenance records, validates source metadata, and summarizes researched facts/inferences/unknowns for dossier handoff. |
| Evidence ledger | `build_reconstruction_dossier` | Builds a dossier that separates user-said, researched, inferred, and unknown claims, plus sensory priorities and adaptation strategy. |
| Family connection | `generate_family_followup_questions` | Generates gentle questions the user can ask relatives to deepen the memory and resolve uncertainty. |
| Name resolution | `resolve_dish_name` | Resolves names to broad families and ambiguity-aware candidates using bundled aliases, fuzzy matching, and transliterations. |
| Sensory analysis | `analyze_nostalgic_dish` | Returns sensory-dimension criteria and a bounded prompt for the host model to analyze nostalgia-critical elements. |
| Substitution | `find_sensory_substitutes` | Returns compound/group-matched substitutes from bundled ingredient data, plus regional hints when available. |
| Sourcing | `source_ingredients` | Returns static regional store/corridor hints and a host-model prompt for sourcing. It does not perform live inventory or price lookup. |
| Regional comparison | `discover_regional_similars` | Returns bundled dish-family context and a host-model prompt for neighboring/regional comparisons. |
| Recipe handoff | `generate_recipe` | Returns an expected recipe schema and a bounded host-model prompt for recipe generation and self-critique. It does not deterministically generate final recipe steps by itself. |

All tools return MCP `structuredContent` plus backwards-compatible JSON text.

## End-to-end flow

```text
food memory fragment
  -> collect_food_memory
  -> plan_dish_research
  -> optional host research / family clarification
  -> build_research_record / validate_research_record / extract_research_findings
  -> generate_family_followup_questions
  -> build_reconstruction_dossier
  -> analyze_nostalgic_dish
  -> find_sensory_substitutes
  -> source_ingredients
  -> generate_recipe
```

This executes through the full local workflow. The final recipe remains a host-model synthesis step because live research, family confirmation, and adaptation judgment should not be faked by static local data.

## What It Does Not Do Yet

The current implementation is intentionally local and offline. It does **not** perform live web search, geocoding, grocery inventory lookup, price lookup, or external recipe scraping. Host AI clients can use the research plan with their own browsing/search tools, then pass source-backed facts into the dossier and recipe handoff tools. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the provider-backed research plan.

## Requirements

- Node.js `>=22.0.0`
- npm

`better-sqlite3` is a native dependency, so unsupported Node/platform combinations may need a compiler toolchain or a supported prebuild.

## Installation

```bash
npm ci
npm run build
```

## Using with Claude Code or another MCP client

After building, add the stdio server to your MCP settings:

```json
{
  "mcpServers": {
    "member-berries": {
      "command": "node",
      "args": ["/path/to/member-berries/dist/index.js"]
    }
  }
}
```

If installed as a package, the CLI binary is `member-berries`.

## Cache and privacy

Member Berries is a local stdio MCP server. It does not open an HTTP port. The SQLite research cache path is:

1. `$MEMBER_BERRIES_CACHE_PATH`, if set
2. `$XDG_CACHE_HOME/member-berries/culture-cache.db`, if `XDG_CACHE_HOME` is set
3. `~/.cache/member-berries/culture-cache.db`

User memories can be emotionally sensitive. Do not add network-backed providers without documenting what is sent, where it is sent, and how it is cached.

## Development

```bash
npm ci                         # Install locked dependencies
npm run typecheck              # TypeScript no-emit check
npm run build                  # Compile TypeScript
npm test                       # Run tests
npm run check                  # Typecheck + build + tests
npm audit --audit-level=moderate
npm run package:smoke          # Pack, install in temp project, and verify packaged MCP CLI
npm run pack:check             # Full local release gate
npm pack --dry-run             # Inspect publish contents
npm start                      # Start the MCP server after build
```

For a local self-hosted GitHub Actions runner and queued-job troubleshooting, see [`docs/SELF_HOSTED_RUNNER.md`](docs/SELF_HOSTED_RUNNER.md).

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## The Science

Food-evoked nostalgia is well documented in psychology and neuroscience, especially through smell/taste memory pathways. This repository should treat science and cultural claims as data that require provenance. The roadmap includes adding citations and source metadata to bundled datasets.

## License

MIT
