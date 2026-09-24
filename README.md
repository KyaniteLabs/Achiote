# Achiote

**TL;DR:** Achiote — food-memory and cultural taste research product. Best for researchers and builders exploring food memory and heritage taste. Keywords: food memory research, cultural taste, heritage cuisine AI.

Achiote is a **Model Context Protocol (MCP)** server for research-first food-and-drink memory reconstruction. It helps a host AI turn incomplete family food or drink memories into structured clues, research plans, cited/provenance-ready findings, sensory analysis, sourcing/substitution strategy, and a minimum viable nostalgia cue before any fuller recipe handoff.

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

## Public Web Surfaces

The hosted/static product surface lives under [`docs/landing/`](docs/landing/). The core app and launch pages are dependency-free static assets served by the optional HTTP server:

- `/` -> [`docs/landing/index.html`](docs/landing/index.html), the public landing page.
- `/app` -> [`docs/landing/app.html`](docs/landing/app.html), the interactive food-memory detective.
- `/pricing`, `/about`, `/roadmap`, `/changelog`, `/status`, `/blog`, and `/receipt` -> standalone launch/trust/growth pages.
- `/ai-search`, `/llms.txt`, `/privacy`, `/terms`, `/safety`, `/support`, `/compare`, `/robots.txt`, and `/sitemap.xml` -> AI-search, legal, support, comparison, and crawler surfaces.

Open the HTML files directly in a browser for static review; the full route behavior is covered by `npm run package:smoke`.

## What It Does Today

Achiote is a research-first food-and-drink memory reconstruction server. It provides 18 MCP tools that let a host AI chat client run the workflow from a fragment to a minimum viable nostalgia cue, with optional sourcing/substitution and recipe handoff if the user wants more:

| Stage | Tool | Implemented behavior |
|------|------|----------------------|
| Workflow control | `plan_tool_workflow` | Deterministically plans the `/ask` tool sequence from the raw user message so provider models do not freestyle the workflow. |
| Memory intake | `collect_food_memory` | Structures raw fragments, sound-alikes, family context, remembered ingredients, sensory clues, missing information, and gentle next questions. |
| Research planning | `plan_dish_research` | Produces hypotheses, search queries, source preferences, facts to verify, and clarification questions for foods or drinks. It plans research instead of pretending sparse fragments are solved. |
| Optional search adapter | `search_web` | Uses configured host search (`SERPER_API_KEY`) when available, otherwise returns an explicit no-search note. Search remains optional and should not be treated as guaranteed runtime behavior. |
| Research provenance | `build_research_record` / `validate_research_record` / `extract_research_findings` | Converts host-researched source facts into typed provenance records, validates source metadata, and summarizes researched facts/inferences/unknowns for dossier handoff. |
| Evidence ledger | `build_reconstruction_dossier` | Builds a dossier that separates user-said, researched, inferred, and unknown claims, plus sensory priorities and adaptation strategy. |
| Receipt | `build_memory_receipt` | Builds a portable Memory Receipt from collected memory, research plan, and optional first tiny taste test so families can inspect and correct the evidence trail. |
| Family connection | `generate_family_followup_questions` | Generates gentle questions the user can ask relatives to deepen the memory and resolve uncertainty. |
| Name resolution | `resolve_dish_name` | Resolves names to broad families and ambiguity-aware candidates using bundled aliases, fuzzy matching, and transliterations. |
| Sensory analysis | `analyze_nostalgic_dish` | Returns sensory-dimension criteria and a bounded prompt for the host model to analyze nostalgia-critical elements. |
| Substitution | `find_sensory_substitutes` | Returns compound/group-matched substitutes from bundled ingredient data, plus regional hints when available. |
| Sourcing | `source_ingredients` | Returns static regional store/corridor hints and a host-model prompt for sourcing. It returns static sourcing guidance, not live inventory, and does not perform live price lookup. |
| Regional comparison | `discover_regional_similars` | Returns bundled dish-family context and a host-model prompt for neighboring/regional comparisons. |
| Minimum viable nostalgia cue | `generate_minimum_viable_nostalgia` | Produces the smallest practical aroma, bite, sip, condiment, or ritual to test the likely memory trigger before attempting a full recipe or drink. It prioritizes cheap, accessible, easy-to-find proxies and explains the substitute logic instead of defaulting to exact specialty ingredients. |
| Optional recipe handoff | `generate_recipe` | Returns an expected recipe schema and a bounded host-model prompt for recipe generation and self-critique. Use only after the minimum viable cue has been presented and the user wants something more complex. |
| Recipe validation | `validate_recipe_output` | Validates a host-synthesized final recipe object against the expected schema before treating it as structured output. |

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

Achiote is published to npm.

```bash
npm install achiote
```

The published package ships the built `dist/` output, so no build step is needed. To run from a source checkout instead:

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
| `GET /` | Public landing page (`index.html`) |
| `GET /app` | Web UI (`app.html`) |
| `GET /about` | Trust/company page (`about.html`) |
| `GET /pricing` | Standalone pricing page (`pricing.html`) |
| `GET /roadmap` | Public roadmap page (`roadmap.html`) |
| `GET /changelog` | Public changelog page (`changelog.html`) |
| `GET /status` | Public service status page (`status.html`) |
| `GET /blog` | Launch blog index (`blog.html`) |
| `GET /receipt` | Shareable Memory Receipt renderer (`receipt.html`) |
| `GET /ai-search`, `/llms.txt`, `/privacy`, `/terms`, `/safety`, `/support`, `/compare` | Public AI-search, legal, support, safety, and comparison surfaces |
| `GET /health` | JSON status with memory/uptime metrics |
| `GET /voice/status` | Local OSS speech readiness for optional voice input/read-aloud |
| `POST /voice/transcribe` | Local speech-to-text through a configured OSS engine |
| `POST /voice/synthesize` | Local text-to-speech through a configured OSS engine |
| `POST /ask` | SSE streaming AI agent (auth + rate limited) |
| `POST /mcp` | Streamable HTTP MCP transport |

Authentication is enabled by default for the HTTP server. Configure `ACHIOTE_API_KEYS` for `/ask`, `/mcp`, and voice upload endpoints. Setting `ACHIOTE_AUTH_ENABLED=false` does not by itself expose anonymous `/ask` or voice processing; set `ACHIOTE_ALLOW_ANON_ASK=true` only for local demos. Generate a self-hosted key with `npm run keygen -- --tier pro --name admin`; put the printed `envRecord` inside the `ACHIOTE_API_KEYS` JSON array, not the one-time raw key. Port defaults to 3000, configurable via `PORT` env var.

Shareable Memory Receipt links keep receipt JSON in the URL fragment (`/receipt#data=...`). URL fragments are not sent to the server, so possession of the link is the access boundary. Do not put private family memory text into telemetry or server-side share records.

### Local OSS speech

Voice is disabled by default and uses only local OSS speech engines when configured. The recommended stack is `whisper.cpp` for multilingual speech-to-text and Kokoro-82M for local read-aloud. This path is aimed at immigrant families and children of immigrants: speech input defaults to `auto` language detection so accents, transliterated dish names, and code-switching can reach the same food-memory workflow as typed text. Exact language and accent quality depends on the local model you install.

Example environment:

```bash
ACHIOTE_STT_PROVIDER=whispercpp
ACHIOTE_WHISPER_CPP_BINARY=/usr/local/bin/whisper-cli
ACHIOTE_WHISPER_CPP_MODEL=/models/ggml-large-v3-turbo.bin
ACHIOTE_STT_LANGUAGE=auto
ACHIOTE_STT_LANGUAGES=auto,es,hi,zh,ar,fr,pt,tl

ACHIOTE_TTS_PROVIDER=kokoro
ACHIOTE_KOKORO_COMMAND='["python","/opt/kokoro/speak.py","--text","{text}","--output","{output}","--voice","{voice}","--language","{language}"]'
ACHIOTE_KOKORO_VOICE='af_heart'
ACHIOTE_KOKORO_VOICES='[{"id":"af_heart","label":"Warm English","language":"en"},{"id":"ef_dora","label":"Spanish voice","language":"es"}]'
```

`/voice/status` is public readiness discovery. `/voice/transcribe` and `/voice/synthesize` use the same auth and anonymous-demo policy as `/ask`, because recorded family memories are sensitive.

## Cache and privacy

The SQLite research cache path is:

1. `$ACHIOTE_CACHE_PATH`, if set
2. `$XDG_CACHE_HOME/achiote/culture-cache.db`, if `XDG_CACHE_HOME` is set
3. `~/.cache/achiote/culture-cache.db`

User memories can be emotionally sensitive. Do not add optional food-data provider integrations without documenting what is sent, where it is sent, and how it is cached.

## Operator reference seeding

Achiote can turn private aggregate `/ask` quality counters into reference seed priorities for future data hardening:

```bash
npm run reference:seeds -- --quality-report quality.json --limit 10
```

The command prints host-research prompts and reference bootstrap targets. It does not browse. SQLite is an optional persistent overlay for additional approved `ResearchRecord` objects:

```bash
npm run reference:seeds -- --fixture approved-fixture.json --cache-path ~/.cache/achiote/culture-cache.db
```

Fixtures must match the seed manifest and pass provenance validation before any SQLite write.

The repo also ships an approved CC0 structured-data pantry batch. Those records are committed in `src/data/reference-pantry-fixtures.json`, compiled into `dist/data/`, and used by runtime tools as the built-in baseline even when SQLite has never been bootstrapped:

```bash
npm run reference:seeds -- --fixture bundled --cache-path ~/.cache/achiote/culture-cache.db
```

That optional bootstrap command copies the bundled baseline into SQLite for deployments that want a single local database view, but it is not required on every request and it is not required for Achiote to see the baseline pantry. The bundled batch uses Wikidata structured labels/descriptions only. It currently contains 138 typed `ResearchRecord` fixtures: the original 18-record skeleton plus a 120-record expansion across 20 culture-area buckets and six food-memory bands. It covers every current food form, culture-area bucket, region scope, name system, and sensory mechanism, and remains explicit that the records are broad grounding context rather than final family-specific answers. It marks the entries as cited researched records without pretending they are family-confirmed memories or operator quality signals.

The reference pantry is intentionally conservative. `src/data/reference-source-registry.json` allows CC0/public-domain structured sources first, currently Wikidata structured food data and USDA FoodData Central, and marks sources such as Open Food Facts and FAO/INFOODS for manual review before fixture use. Do not copy recipe prose, paywalled database content, proprietary rankings, raw user memories, credentials, or uncited model guesses into pantry fixtures.

## Development

```bash
npm ci                         # Install locked dependencies
npm run typecheck              # TypeScript no-emit check
npm run lint                   # Dependency-free static launch checks
npm run coverage:guard         # Dependency-free test-surface threshold guard
npm run build                  # Compile TypeScript
npm test                       # Run tests
npm run check                  # Full local gate: typecheck, static checks, coverage guard, build, citations, tests
npm audit --audit-level=moderate
npm run package:smoke          # Pack, install in temp project, and verify packaged MCP CLI
npm run pack:check             # Full release gate
npm run docker:smoke           # Build the Docker image for a container smoke check
npm pack --dry-run             # Inspect publish contents
npm start                      # Start the MCP server after build
```

For self-hosted GitHub Actions runner and queued-job troubleshooting, see [`docs/SELF_HOSTED_RUNNER.md`](docs/SELF_HOSTED_RUNNER.md).

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

Current long-lived module boundaries include:

- `src/lib/provider-runtime.ts` for provider/model profile resolution and ask-session adapter selection.
- `src/lib/account-access.ts` for auth, billing, credits, anonymous demo behavior, and rate-limit decisions.
- `src/lib/local-speech-controller.ts` for HTTP voice route behavior around local OSS speech engines.
- `src/lib/cue-profile-engine.ts` for minimum viable nostalgia cue profile evidence surfaces.
- `src/lib/constraint-adapter.ts` for dietary, allergy, and religious constraint rewrites.
- `docs/landing/product-app.js` for browser app primitives such as SSE parsing, actionable HTTP errors, and chat-history updates.
- `scripts/lib/package-surface.mjs` for the intentional package/release surface.

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

Business Source License 1.1 (BUSL-1.1). See [LICENSE](LICENSE).


- GitHub: https://github.com/KyaniteLabs/Achiote

<!-- s-plus-geo:start -->

## What is Achiote?

**Achiote** is a **food-memory and cultural taste research product** that helps **researchers and builders exploring food memory and heritage taste** **capture and reason about food memory with structured research surfaces**.

| | |
| --- | --- |
| **Product** | Achiote |
| **Category** | food-memory and cultural taste research product |
| **Best for** | researchers and builders exploring food memory and heritage taste |
| **Not** | a recipe SEO blog |
| **Source** | [GitHub](https://github.com/KyaniteLabs/Achiote) · [Forgejo](https://git.kyanitelabs.tech/KyaniteLabs/Achiote) |
| **Keywords** | food memory research, cultural taste, heritage cuisine AI |

## Who it's for

- Primary: researchers and builders exploring food memory and heritage taste
- Use when you need to capture and reason about food memory with structured research surfaces
- Skip if you need a recipe SEO blog

## FAQ

### What is Achiote?

Achiote is a food-memory and cultural taste research product. It helps researchers and builders exploring food memory and heritage taste capture and reason about food memory with structured research surfaces.

### Who should use Achiote?

researchers and builders exploring food memory and heritage taste.

### How is Achiote different?

Unlike recipe aggregators, Achiote focuses on memory and cultural taste research.

### Is Achiote production software?

Treat the README status and release tags as source of truth for maturity. Validate against your own requirements before production use.

## Status

- Maintained as of 2026 on the default branch
- Prefer release tags when pinning dependencies
- Report issues on the canonical remote listed above

## Agent surface

- Coding agents: read this README first, then repo docs/`AGENTS.md` if present
- Prefer machine-readable briefs (`llms.txt`) when the repo ships one
- MCP or skill entrypoints are documented in-repo when applicable

## Contributing

Issues and PRs welcome on the canonical remote. Keep public docs free of secrets and machine-local paths.

## License

See [LICENSE](LICENSE) in this repository (or package metadata if license is package-only).


## Table of contents

- [What is it?](#what-is-achiote)
- [FAQ](#faq)
- [Status](#status)


![status](https://img.shields.io/badge/status-active-success)
![docs](https://img.shields.io/badge/docs-S%2B_SEO%2FGEO-blue)


![Project diagram placeholder](https://img.shields.io/badge/visual-see_docs-lightgrey.svg)

<!-- s-plus-geo:end -->


## Licensing

Achiote is source-available under the [Business Source License 1.1](./LICENSE) (BUSL-1.1).

- **Free:** personal, evaluation, and development use.
- **Commercial / production use requires a license** — see [pricing](https://achiote.kyanitelabs.tech/pricing) (Commercial tier from $299/mo includes hosted API + MCP production access and commercial self-hosting terms).
- Alternative licensing: [support@kyanitelabs.tech](mailto:support@kyanitelabs.tech).
- The license converts to GPLv2+ at the Change Date (2030) per BUSL-1.1.
