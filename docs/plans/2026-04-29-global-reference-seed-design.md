# Global Reference Seed Design

## Goal

Design Achiote's next data-engineering hardening layer: a global, provenance-bounded reference and cache-seeding system that covers every food-memory domain, not just beverages or the categories that have appeared in recent tests.

This is slice B. It turns the new private quality signals into a disciplined seed plan for reference data, cache warming, weak-model support, and future local-model support.

## Non-Negotiable Scope

B is global by construction. The taxonomy must include:

- Foods and drinks: beverages, dishes, snacks, sweets, confections, breads, grains, noodles, porridges, dumplings, wraps, soups, broths, stews, sauces, condiments, pickles, ferments, smoked/preserved foods, street foods, holiday foods, breakfast foods, sick-day foods, child-memory foods, pantry mixtures, and single-ingredient nostalgia cues.
- Regions and cultures: macro-regions, nations, subregions, cities, diaspora communities, border cuisines, Indigenous foodways, religious/ritual food contexts, migration corridors, and multilingual family names.
- Name systems: aliases, transliterations, spelling variants, soundalikes, language/script forms, colonial/postcolonial names, restaurant-menu names, family nicknames, and weak-model typo patterns.
- Mechanisms: aroma compounds, Maillard/browning, fermentation/acidity, starch gelation, fat bloom, sugar crystallization, smoke, mineral/alkaline processing, sauce balance, temperature, texture contrast, utensil/serving ritual, and memory-triggering sensory cues.

"Every category" cannot mean a one-shot exhaustive dish encyclopedia. It means no category is out of bounds, every seed is mapped into an explicit coverage matrix, gaps are measurable, and additions follow the same schema and provenance rules.

## Current System Fit

Achiote already has the right foundation:

- `src/data/dish-families.json` for aliases, transliterations, variants, shared mechanisms, and nostalgia triggers.
- `src/data/ingredients.json` for sensory contribution and substitution groups.
- `src/data/memory-hints.json` for ingredient, method, region, and family-hint extraction.
- `src/data/regional-availability.json` for location-aware sourcing prompts.
- `src/data/sensory-profiles.json` for mechanism-driven cue generation.
- `src/lib/research-cache.ts` for typed research records keyed by dish family and region.
- `src/lib/quality-signals.ts` for private aggregate failure and opportunity signals.

B should add a coverage and seed layer beside these files, not stuff everything into one giant taxonomy file.

## Proposed Architecture

### 1. Coverage Matrix

Create a small, validated `src/data/global-coverage-matrix.json` that describes the axes Achiote must cover:

- `foodForms`: stable form buckets such as beverage, sauce, soup, bread, dumpling, confectionery, ferment, street_snack, ceremonial, and staple.
- `mechanisms`: reusable sensory/food-science mechanisms.
- `regionScopes`: macro-region, nation, subregion, city, diaspora, Indigenous, religious/ritual, migration corridor.
- `nameSystems`: alias, transliteration, script, phonetic, typo, family nickname, menu name.
- `evidenceLevels`: seed hypothesis, sourced reference record, family-confirmed clue, operator-observed quality signal.

This file is not a list of all dishes. It is the coverage contract used to prove we are not forgetting entire domains again.

### 2. Reference Seed Queue

Create `src/data/reference-seed-queue.json` as the curated backlog of cache/reference targets. Each target should be compact:

```json
{
  "id": "beverage-rice-cinnamon-latin-america",
  "forms": ["beverage"],
  "regions": ["Mexico", "Central America", "Caribbean", "diaspora:United States"],
  "nameSignals": ["horchata", "agua de arroz", "rice cinnamon drink"],
  "mechanisms": ["starch suspension", "cinnamon aroma", "cold serving ritual"],
  "querySeeds": [
    "horchata rice cinnamon regional variants",
    "agua de arroz cinnamon drink family recipe"
  ],
  "cacheTargets": [
    { "dishFamily": "rice-cinnamon-beverage", "region": "Mexico" }
  ],
  "coverageTags": ["foodForms.beverage", "nameSystems.alias", "mechanisms.starch-suspension"],
  "provenance": {
    "sourceType": "curated seed hypothesis",
    "notes": ["Requires host-led research before any factual answer."]
  }
}
```

The seed queue is an input to research and cache warming. It is not itself an authoritative fact source.

### 3. Cache Warming Manifest

Create a generated or curated `src/data/cache-warming-manifest.json` only after the seed queue is validated. This manifest should map high-priority seed targets to deterministic research tasks:

- what cache key to warm,
- which query seeds to use,
- which existing dish-family and ingredient records are related,
- which quality-signal counters triggered the need,
- and what "done" means for a typed `ResearchRecord`.

Achiote itself still does not browse. A separate operator script may prepare prompts or recorded fixtures for host-led research, then store typed `ResearchRecord` objects in the local cache.

### 4. Seed Source Tiers

Seed priorities should combine:

- Quality telemetry: frequent `unknown`, `missing_region`, `skipped`, `fallback`, or guard-heavy buckets.
- Product coverage: common memory surfaces such as drinks, candies, soups, breads, snacks, sauces, and holiday foods.
- Global coverage: regions and cultures absent from current data.
- Weak-model stress: names that are easily misspelled, transliterated, code-switched, or confused across regions.
- Local-model usefulness: mechanisms that let small models answer with a first cue even before exact dish identity is known.

### 5. Privacy And Legal Boundary

Do not seed from raw user memories. Only use aggregate signals, curated public references, and explicitly approved operator research notes. Do not store credentials, provider names, live URLs from private sessions, raw prompts, medical/legal claims, or copy implying Achiote browses by itself.

All seeded facts must remain evidence-bounded:

- `seed hypothesis` means "use this to research."
- `researched` means "source-backed but still not family-specific."
- `family-confirmed` means "user/family supplied, not globally authoritative."
- `unknown` remains explicit.

## Data Flow

1. `/ask` produces private aggregate quality signals.
2. Operator reads quality report from authenticated `/events`.
3. Seed planner maps recurring gaps into `reference-seed-queue.json` entries.
4. Validation enforces bounded tags, provenance, non-empty queries, no duplicates, and no raw-memory-like fields.
5. Optional operator script turns seed entries into host-research prompts or fixture tasks.
6. Researched outputs become typed `ResearchRecord` cache entries or curated data updates.
7. `/ask` and MCP tools benefit through existing name resolution, planning, sensory cue generation, and cache lookup surfaces.

## Testing Strategy

Add tests before implementation:

- Validation accepts the committed coverage matrix and seed queue.
- Validation rejects unknown coverage tags, duplicate seed IDs, empty query seeds, unprovenanced entries, and cache targets without both `dishFamily` and `region`.
- Guardrail tests assert seed data does not contain raw prompt markers, provider names, credentials, medical/legal claims, or "Achiote browses" copy.
- Package tests prove new source JSON ships only through `dist/` after build, with no extra root package files.
- A focused weak-model test proves a seed entry can be selected from a quality-signal report without exposing raw memories.

## Rollout Slices

### Slice B1: Contract Only

Add coverage matrix, seed queue schema, validation, and an intentionally tiny starter seed set that spans all top-level form categories. No live research, no cache writes.

### Slice B2: Seed Planner

Add a pure planner that maps private quality reports to seed queue priorities. It should output bounded reasons like `high_unknown_beverage`, `missing_region_soup`, or `fallback_confectionery`.

### Slice B3: Cache Warming Fixtures

Add recorded fixture support for turning approved research artifacts into typed cache records. No live browsing inside Achiote.

### Slice B4: Broad Global Expansion

Expand seed entries by coverage matrix, region family, diaspora corridor, mechanism, and language/script. This is where "every category, every region, every culture" becomes an auditable backlog with measurable gaps rather than a claim.

## Success Criteria

B is ready to implement when:

- The repo has a validated coverage contract that names all major food-memory surfaces.
- New seed entries require provenance, coverage tags, query seeds, and cache targets.
- Operators can see which global gaps to seed next from private aggregate telemetry.
- No public copy or package contents imply Achiote browses by itself.
- The plan supports small cloud models and local inference models by making missing context deterministic, structured, and mechanism-driven.

