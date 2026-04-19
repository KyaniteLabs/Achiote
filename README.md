# Member Berries

Member Berries is a **Model Context Protocol (MCP)** server for research-first food-memory reconstruction. It helps a host AI turn incomplete family food memories into structured clues, research plans, cited/provenance-ready findings, sensory analysis, sourcing/substitution strategy, and a minimum viable nostalgia cue before any fuller recipe handoff.

> "The nostalgia lives in the maillard crust's interaction with the lactic tang — here's how to reproduce that."

## Super Quick Start

From this repo:

```bash
npm ci
npm run build
mkdir -p ~/.codex/skills/member-berries
cp skill/SKILL.md ~/.codex/skills/member-berries/SKILL.md
```

Add the MCP server to your host config. Use an absolute path to this repo's built `dist/index.js`:

```bash
pwd
# copy the printed path and append /dist/index.js
```

```toml
[mcp_servers.member_berries]
command = "node"
args = ["/absolute/path/to/member-berries/dist/index.js"]
enabled = true
startup_timeout_sec = 10
```

Restart the host AI session, then test with:

```text
Use the member-berries skill.

My mom said my Puerto Rican grandma made something that sounded like pass-teh-lay. I don't speak Spanish. Maybe plantains or pork?
```

Expected behavior: the host AI should use the MCP tools to collect the memory, plan research, build a dossier, and present a minimum viable nostalgia cue first. Only after that should it ask whether the user wants something more complex, such as sourcing help or a full recipe handoff.

## What It Does Today

Member Berries is a research-first food-memory reconstruction server. It provides 14 MCP tools that let a host AI chat client run the workflow from a fragment to a minimum viable nostalgia cue, with optional sourcing/substitution and recipe handoff if the user wants more:

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
| Minimum viable nostalgia cue | `generate_minimum_viable_nostalgia` | Produces the smallest practical aroma, bite, sip, condiment, or ritual to test the likely memory trigger before attempting a full recipe. |
| Optional recipe handoff | `generate_recipe` | Returns an expected recipe schema and a bounded host-model prompt for recipe generation and self-critique. Use only after the minimum viable cue has been presented and the user wants something more complex. |

All tools return MCP `structuredContent` plus backwards-compatible JSON text.

## End-to-end flow

```text
food memory fragment
  -> collect_food_memory
  -> plan_dish_research
  -> optional host research / family clarification
  -> build_research_record / validate_research_record / extract_research_findings
  -> build_reconstruction_dossier
  -> generate_family_followup_questions
  -> generate_minimum_viable_nostalgia   # first concrete food output
  -> optional analyze_nostalgic_dish / find_sensory_substitutes / source_ingredients
  -> optional generate_recipe            # only if the user wants more
```

This executes through the full MCP workflow and is covered by `tests/reconstruction-flow-e2e.test.ts`. The preferred stopping point is the **minimum viable nostalgia cue**: the smallest aroma, bite, sip, condiment, or ritual that tests whether the memory is on the right track. If the user asks for more, the MCP server can then provide sourcing/substitution context and a recipe-generation **handoff**. The host AI writes final recipe prose because live research, family confirmation, and adaptation judgment should not be faked by bundled data.

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

Member Berries is a stdio MCP server. It does not open an HTTP port. The SQLite research cache path is:

1. `$MEMBER_BERRIES_CACHE_PATH`, if set
2. `$XDG_CACHE_HOME/member-berries/culture-cache.db`, if `XDG_CACHE_HOME` is set
3. `~/.cache/member-berries/culture-cache.db`

User memories can be emotionally sensitive. Do not add optional food-data provider integrations without documenting what is sent, where it is sent, and how it is cached.

## Development

```bash
npm ci                         # Install locked dependencies
npm run typecheck              # TypeScript no-emit check
npm run build                  # Compile TypeScript
npm test                       # Run tests
npm run check                  # Typecheck + build + tests
npm audit --audit-level=moderate
npm run package:smoke          # Pack, install in temp project, and verify packaged MCP CLI
npm run pack:check             # Full release gate
npm pack --dry-run             # Inspect publish contents
npm start                      # Start the MCP server after build
```

For self-hosted GitHub Actions runner and queued-job troubleshooting, see [`docs/SELF_HOSTED_RUNNER.md`](docs/SELF_HOSTED_RUNNER.md).

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## The Science

Food-evoked nostalgia should be handled as a sensory-memory workflow, not as a medical claim. The server preserves evidence boundaries: user memory, host-researched facts, model inference, and unknowns stay separate so the host can cite real sources and avoid pretending bundled data is research.

## License

MIT
