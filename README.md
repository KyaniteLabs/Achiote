# Achiote

Achiote is a **Model Context Protocol (MCP)** server for research-first food-memory reconstruction. It helps a host AI turn incomplete family food memories into structured clues, research plans, cited/provenance-ready findings, sensory analysis, sourcing/substitution strategy, and a minimum viable nostalgia cue before any fuller recipe handoff.

> "The nostalgia lives in the maillard crust's interaction with the lactic tang — here's how to reproduce that."

## Super Quick Start

From this repo:

```bash
npm ci
npm run build
mkdir -p ~/.codex/skills/achiote
cp skill/SKILL.md ~/.codex/skills/achiote/SKILL.md
```

Claude Code can use the checked-in `.mcp.json` after the build step. For Codex, add the MCP server to `~/.codex/config.toml` with an absolute path to this repo's built `dist/index.js`:

```bash
pwd
# copy the printed path and append /dist/index.js
```

```toml
[mcp_servers.achiote]
command = "node"
args = ["/absolute/path/to/achiote/dist/index.js"]
enabled = true
startup_timeout_sec = 10
```

Restart the host AI session, then test with:

```text
Use the achiote skill.

My mom said my Puerto Rican grandma made something that sounded like pass-teh-lay. I don't speak Spanish. Maybe plantains or pork?
```

Expected behavior: the host AI should use the MCP tools to collect the memory, plan research, build a dossier, and present a minimum viable nostalgia cue first. Only after that should it ask whether the user wants something more complex, such as sourcing help or a full recipe handoff.

## Landing Page

A polished static landing page lives at [`docs/landing/index.html`](docs/landing/index.html). Open it directly in a browser; it has no build step or external assets.

## What It Does Today

Achiote is a research-first food-memory reconstruction server. It provides 14 MCP tools that let a host AI chat client run the workflow from a fragment to a minimum viable nostalgia cue, with optional sourcing/substitution and recipe handoff if the user wants more:

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
| Minimum viable nostalgia cue | `generate_minimum_viable_nostalgia` | Produces the smallest practical aroma, bite, sip, condiment, or ritual to test the likely memory trigger before attempting a full recipe. It prioritizes cheap, accessible, easy-to-find proxies and explains the substitute logic instead of defaulting to exact specialty ingredients. |
| Optional recipe handoff | `generate_recipe` | Returns an expected recipe schema and a bounded host-model prompt for recipe generation and self-critique. Use only after the minimum viable cue has been presented and the user wants something more complex. |

All tools return MCP `structuredContent`. Most tools also display JSON text; intake tools may display a short human-readable summary so Claude Code output stays readable while structured data remains available to the host.

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

This executes through the full MCP workflow and is covered by `tests/reconstruction-flow-e2e.test.ts`. The preferred stopping point is the **minimum viable nostalgia cue**: the smallest, most accessible, easiest-to-find aroma, bite, sip, condiment, or ritual that tests whether the memory is on the right track. If the user asks for more, the MCP server can then provide sourcing/substitution context and a recipe-generation **handoff**. The host AI writes final recipe prose because live research, family confirmation, and adaptation judgment should not be faked by bundled data.

## Requirements

- Node.js `>=22.0.0`
- npm

`better-sqlite3` is a native dependency, so unsupported Node/platform combinations may need a compiler toolchain or a supported prebuild.

## Installation

Achiote is not published to npm yet. Use a source checkout, a Git URL install, or the tarball produced by `npm pack` until the package is published.

```bash
npm ci
npm run build
```

## Using with Claude Code or another MCP client

After building, add the stdio server to your MCP settings:

```json
{
  "mcpServers": {
    "achiote": {
      "command": "node",
      "args": ["/path/to/achiote/dist/index.js"]
    }
  }
}
```

If installed as a package, the CLI binary is `achiote`.

## HTTP server

An optional HTTP server provides a web UI and AI agent endpoint:

```bash
node dist/http-server.js
# Listening on http://localhost:3000
```

| Endpoint | Description |
|----------|-------------|
| `GET /` | Web UI (`app.html`) |
| `GET /about` | Landing page (`index.html`) |
| `GET /health` | JSON status with memory/uptime metrics |
| `POST /ask` | SSE streaming AI agent (auth + rate limited) |
| `POST /mcp` | Streamable HTTP MCP transport |

Authentication is enabled by default for the HTTP server. Configure `ACHIOTE_API_KEYS` for `/ask` and `/mcp`, or set `ACHIOTE_AUTH_ENABLED=false` only for local demos. Port defaults to 3000, configurable via `PORT` env var.

## Cache and privacy

The SQLite research cache path is:

1. `$ACHIOTE_CACHE_PATH`, if set
2. `$XDG_CACHE_HOME/achiote/culture-cache.db`, if `XDG_CACHE_HOME` is set
3. `~/.cache/achiote/culture-cache.db`

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

The bundled food-science references in `src/data/food-science-references.json` organize peer-reviewed research by mechanism area. Each entry includes a DOI for verification. The 12 mechanism areas are:

| Mechanism | What it means for reconstruction | Key source |
|-----------|----------------------------------|------------|
| Fat-soluble aromatics | Cooking fat is the primary carrier of aroma compounds; changing the fat changes the flavor | Shahidi & Hossain (2022). doi:10.3390/molecules27155014 |
| Maillard browning | The specific browning profile is a chemical signature matching amino acids, sugars, temperature, and time | Liu et al. (2022). doi:10.3389/fnut.2022.973677 |
| Astringency-fat opponency | Fat and astringency are perceptual opponents; the balance between them is nostalgia-critical | Dubreuil & Breslin (2012). doi:10.1016/j.cub.2012.08.017 |
| Starch texture | Amylose/amylopectin ratio determines texture; different starch sources produce measurably different outcomes | Wang et al. (2020). doi:10.3390/foods9081073 |
| Sweet-sour balance | Sweet and sour suppress each other at certain ratios; the balance point is culturally conditioned | Mao et al. (2025). doi:10.1038/s41538-025-00507-7 |
| Crispiness and nostalgia | Crispy textures activate auditory and somatosensory regions simultaneously, making them particularly memorable | Yamamoto et al. (2025). doi:10.3389/fnut.2025.1681999 |
| Food-evoked nostalgia | Food memories engage hippocampus, amygdala, and olfactory cortex simultaneously, producing vivid involuntary recall | Reid et al. (2023). doi:10.1080/02699931.2022.2142525 |
| Umami synergy | IMP and GMP amplify glutamate sensitivity by up to 15x; traditional cuisines pair glutamate and nucleotide sources | Zhang et al. (2008). doi:10.1073/pnas.0810174106 |
| Salt taste complexity | Salt perception involves multiple receptor pathways; salt also functions as a flavor amplifier beyond its own taste | Taruno & Gordon (2023). doi:10.1146/annurev-physiol-031522-075853 |
| Temperature-taste interaction | TRPM5 (sweet/bitter/umami transduction) is heat-activated; warm foods taste sweeter and more flavorful | Talavera et al. (2007). doi:10.1007/s00018-006-6384-0 |
| Fermentation flavor | Lactic acid bacteria produce volatiles not present in raw ingredients; the fermentation profile is the nostalgia trigger | Liu et al. (2019). doi:10.3389/fmicb.2019.02183 |
| Cross-cultural texture | Texture preferences vary by dietary experience, not physiology; nostalgia-driven texture expectations are learned | Ahne et al. (2022). doi:10.1016/j.foodres.2020.109890 |

## License

MIT
