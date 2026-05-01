# Knowledge-Gap Canary Plan

## Decision

Use the canary pattern for two different jobs:

1. Runtime canaries prove Achiote survives weak models, provider quirks, missing tools, rate limits, and disabled search.
2. Knowledge-gap canaries mine the same evidence for missing internal reference data.

Search must remain optional enrichment. If a model or provider can search on its own, Achiote may ingest the resulting text as untrusted model-provided evidence, but search output must not become workflow truth or break the Achiote flow.

## Recipe Policy

Tiny sensory tests are allowed, including useful measurements or short procedures, when they are cheap, bounded, and clearly framed as first-pass verification.

Block only when output crosses into:

- full recipes,
- substitution/adaptation matrices,
- shopping missions,
- overconfident dish identity,
- fake browsing/current-price claims,
- medical/legal/safety claims,
- or multi-step cooking plans that replace the minimum-cue contract.

## Knowledge Gap Types

The initial analyzer emits:

- `missing_dish_alias`: misspellings, transliterations, soundalikes, or aliases are handled generically.
- `missing_regional_family`: a broad family is known, but regional distinctions are missing.
- `weak_sensory_signature`: no useful sensory cue emerges.
- `missing_substitution_role`: substitutions lack original sensory-role mapping.
- `missing_local_accessibility`: local sourcing lacks pantry-first accessible proxies.
- `overbroad_family`: output stays at generic mechanism language.
- `insufficient_disambiguators`: the system cannot ask the next best narrowing question.
- `search_dependency`: `search_web` was used where internal reference data should eventually be enough.

## Data Loop

1. Run weak-model/local/cloud canaries with search disabled or optional.
2. Run `npm run knowledge:canary -- --results <artifact>/results.jsonl --out <report>.json`.
3. Rank gaps by prompt bucket and count.
4. Promote high-count gaps into reference seed tasks.
5. Add or expand structured data: aliases, regional families, sensory signatures, substitution roles, and accessibility proxies.
6. Add fixtures/regressions.
7. Re-run knowledge canary and compare coverage.

## First Signals From Final Canary

The first report from `artifacts/final-canary-20260501-021841/results.jsonl` surfaced:

- generic `aroma-sip` outputs for history correction and sour-dill soup,
- `search_web` dependency around misspelled carimañola/carimañola-like memories,
- substitution prompts falling back to generic carrier/protein cues,
- and repeated need for stronger sour-soup and cereal/rice-cinnamon beverage family data.

These are reference-data backlog items, not provider failures.
