# Deep Local Canary Findings

Generated from `LOCAL_CANARY_PROFILE=deep LOCAL_CANARY_PACE_MS=20000 npm run canary:local` against `qwen3.5-0.8b` on the private Tailscale inference endpoint.

## Result

- 2/6 passed.
- 4 product findings.
- 0 provider/runtime failures.
- Artifact: `/var/folders/5n/3x16yjf57ld6mmz28h8wb0nc0000gn/T/achiote-local-canary/2026-04-29T22-13-53-985Z-qwen3.5-0.8b.json`

## Findings To Fix

1. Negated dietary constraints still triggered substitution tools.
   - Case: `deep_negated_dietary_constraints`
   - Symptom: `find_sensory_substitutes` ran even though the user explicitly said they did not need vegan, nut-free, gluten-free, halal, heart-healthier, or medical substitutions.
   - Likely fix: strengthen adaptation intent detection so negated restriction terms do not set `needsSubstitutions`.

2. Follow-up correction did not preserve the newest user turn strongly enough.
   - Case: `deep_followup_correction_preserves_latest_turn`
   - Symptom: final text retained forbidden earlier-history flavor such as milky/creamy after the user corrected it to watery, icy, and barely sweet.
   - Likely fix: mark the latest user message as authoritative in `/ask` context and deterministic cue fallback, and add contradiction-aware tests.

3. Broad-family ambiguity produced a deterministic cue where clarification may be safer.
   - Case: `deep_broad_family_inference_trap`
   - Symptom: no candidate-list leak, but the guard ended as `minimum_cue_deterministic_completion` instead of a clarification path.
   - Product decision needed: if sparse memory has no dish type, region, name, or stable ingredient, prefer clarification over generic cue.

4. Uncertain transliterated beverage drifted into a sweet-texture cue.
   - Case: `deep_transliteration_uncertain_beverage`
   - Symptom: the final cue lost beverage anchors for `agua de cebada`, barley/rice, cold drink, and lime.
   - Likely fix: add beverage/cereal-drink mechanisms and aliases to reference data so deterministic fallback preserves the beverage category.

## Guard Cost Analysis

Deterministic guards are not free, but their main cost is product complexity, not raw latency.

- Latency: string and state guards are cheap; extra deterministic tool execution can add time, but often reduces latency by stopping weak-model loops or skipping another provider turn.
- Quality: guards can improve weak models by preserving structured tool results, but broad guards can flatten richer model prose into safer generic output.
- Smarter-model interference: possible when the trigger is text-only and too broad. Lower risk when the trigger requires explicit tool state such as `generate_minimum_viable_nostalgia` already ran plus final text is empty or a known stalled fallback.
- Maintenance: the real cost is combinatorial behavior. Each guard needs a named reason, a regression test, and canary coverage so future agents know why it exists.
- Observability: guard count is useful telemetry. A high guard rate on smart models means prompts/data are weak or guards are too aggressive; a high guard rate on tiny models is expected if output quality is still good.

Rule of thumb: keep guards for safety, trust-boundary, and structured-workflow invariants; move domain quality from guards into better data, schemas, and deterministic tool outputs.

## Data-Engineering Cache Plan

Do not pre-populate by guessing global food popularity. Pre-populate from three tiers:

1. Query telemetry tier
   - Normalize incoming memories into family, region, language, beverage/food type, and missing-clue dimensions.
   - Count misses, search calls, guard reasons, and user feedback by normalized key.
   - Promote high-miss and high-cost keys into curated fixtures.

2. Reference taxonomy tier
   - Expand `dish-families.json` with beverage families, especially cereal drinks, spiced milks, aguas frescas, fermented drinks, teas, coffee/cacao drinks, broths, and street-cart drinks.
   - Add aliases/transliterations and mechanism fields: temperature, dilution/body, aroma extraction, sweetener/acid balance, starch suspension, foam, carbonation, serving ritual.

3. Research cache seed tier
   - Store validated `ResearchRecord` objects for stable dish-family/region pairs, not raw search pages.
   - Include source type, date fetched, evidence snippets, unknowns, and freshness policy.
   - Start with high-confidence internal families, then promote from real query telemetry.

Implementation sequence:

1. Add cache-key normalization for beverage/food type plus family/region.
2. Add an operator report for search misses, cache hit rate, guard reason, and feedback category.
3. Add seed data for beverage families and run deep canaries against it.
4. Add a prewarm script that inserts typed `ResearchRecord` rows into SQLite.
5. Keep TTL/freshness metadata so stale facts are visible rather than silently trusted.
