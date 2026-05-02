# Achiote Context

Achiote is a research-first food-memory reconstruction system. The MCP server and optional HTTP app do not pretend to know a user's lost dish from a fragment. They structure the memory, separate evidence from inference, retrieve approved reference context, and help the host AI produce a cheap, local, food-science-grounded minimum cue before any recipe-like output.

## Domain Glossary

**food memory**: A user's fragmentary recollection of a dish, drink, smell, texture, occasion, place, person, or name. It is sensitive user data and must be treated as untrusted input.

**memory receipt**: A user-facing artifact that records what the user said, what was inferred, what remains unknown, what was researched, and what small cue was suggested. It is the shareable evidence trail, not a recipe card.

**research plan**: A bounded plan for what facts would clarify the memory: possible families, likely source types, disambiguators, and what not to assume.

**research record**: A typed, provenance-bearing fact bundle from approved sources. It must keep source facts separate from model interpretation and user memory.

**reconstruction dossier**: The structured handoff from memory intake plus research records into synthesis: evidence, hypotheses, contradictions, unknowns, and sensory mechanisms.

**minimum viable nostalgia cue**: The first food output. It is a tiny, cheap, accessible test that checks aroma, fat, acid, starch, temperature, texture, Maillard/browning, or contrast before asking the user to buy specialty ingredients or follow a recipe.

**reference pantry**: Bundled and optional SQLite-backed reference records used to reduce live search. It stores approved structured reference context, not raw memories, copied recipes, or model prose.

**cache warming manifest**: Operator task list naming reference targets that should be populated or checked. It is a work queue, not an ontology.

**reference seed queue**: Seed hypotheses for future reference pantry coverage. Seeds describe useful research targets and cache targets; they are not claims that coverage is complete.

**source policy**: The legal and provenance contract for fixture material. CC0/public-domain structured labels and facts can be acceptable; copied article or recipe prose, proprietary guides, uncited model facts, and user memories are not fixture material.

**inference burden**: A repeatable thing the model should not keep re-deriving when data, retrieval, controller, validator, formatter, observability, or consent layers can own it without making synthesis rigid.

**provider capability profile**: The resolved truth about the configured provider/model: provider family, endpoint style, base URL, native tool posture, native `tool_choice` posture, rate-limit sensitivity, timeout posture, and compatibility source.

**ask session**: The provider adapter that turns Achiote messages and tool definitions into Anthropic-compatible or OpenAI-compatible model calls and appends tool results.

**quality signal**: Privacy-preserving aggregate telemetry about outcomes, guard paths, missing clue dimensions, cache/search usage, and broad family/region buckets. It must not store raw memories.

**account access**: The product boundary for auth, tiers, credits, rate limits, anonymous demo behavior, billing checkout, and one-time billing-key disclosure.

**product app**: The browser-facing usable app under `docs/landing/app.html` and `docs/landing/app.js`, plus public metadata/assets that make the HTTP surface work.

**QA artifact pipeline**: Shared manifest and normalization contract for local canaries, weak-cloud runs, profiler artifacts, telemetry reports, and knowledge-gap canary analysis. It exists so database population decisions cite sample counts, prompt bank, provider/model truth, stop condition, and excluded evidence reasons.

## Operating Distinctions

- The host AI may browse or search; the MCP server structures, validates, and records evidence.
- The reference pantry should reduce search pressure, but it must not overclaim complete global culinary coverage.
- Population density matters more than family count. Add records, regions, names, sensory variants, and source-backed facts under existing families before creating new family buckets.
- Minimum cues are mechanism-driven. Do not add country, dish, restaurant, or recipe branches to the cue path.
- Public traces and browser copy must stay provider-neutral. Provider/runtime truth belongs in private telemetry and operator reports.
