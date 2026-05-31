# Achiote Reference Database Expansion Report

**Date:** 2026-05-30
**Worker:** w-2b74-task

## Summary

Expanded the Achiote reference database (`src/data/`) to improve coverage for the five under-covered regions identified in `GLOBAL-COVERAGE-AUDIT.md`:
1. Western Europe
2. Nordic / Scandinavia
3. Southern Africa
4. Central Asia
5. Caribbean

## Files Modified

- `src/data/reference-seed-queue.json`
- `src/data/cache-warming-manifest.json`
- `src/data/reference-pantry-fixtures.json`
- `src/data/dish-families.json`
- `src/data/reference-family-taxonomy.json`

## Counts Added

### Per File
| File | Before | After | Added |
|------|--------|-------|-------|
| `reference-seed-queue.json` | 1,288 | 1,368 | **80** |
| `cache-warming-manifest.json` | 1,288 | 1,368 | **80** |
| `reference-pantry-fixtures.json` | 1,288 | 1,358 | **70** |
| `dish-families.json` | 45 | 55 | **10** |
| `reference-family-taxonomy.json` | 184 | 194 | **10** |

### Per Region (seeds added)
| Region | Seeds Added | Fixture Families Added | Notes |
|--------|-------------|------------------------|-------|
| Nordic / Scandinavia | 16 | 2 | `nordic-rye-bread`, `swedish-meatball` |
| Western Europe | 16 | 2 | `french-braise`, `iberian-custard-tart` |
| Southern Africa | 16 | 2 | `maize-porridge`, `biltong` |
| Central Asia | 16 | 2 | `plov`, `lagman` |
| Caribbean | 16 | 2 | `haitian-griot`, `trinidad-doubles` |

**Total new seeds:** 80 (14 per region from new family packs + 2 per region pointing to existing families).
**Total new fixtures:** 70 (7 fixtures × 10 new families).

## New Families Added

| # | Family | Primary Region | Food Form | Cluster |
|---|--------|----------------|-----------|---------|
| 1 | `nordic-rye-bread` | Scandinavia | `bread_flatbread` | staple-starches-grains-and-noodles |
| 2 | `swedish-meatball` | Scandinavia | `protein_centered` | stews-braises-and-sauced-mains |
| 3 | `french-braise` | France | `stew_braise` | stews-braises-and-sauced-mains |
| 4 | `iberian-custard-tart` | Portugal | `dessert` | sweets-desserts-and-ritual-foods |
| 5 | `maize-porridge` | Southern Africa | `grain_rice_noodle` | staple-starches-grains-and-noodles |
| 6 | `biltong` | Southern Africa | `pantry_single_ingredient` | pantry-aroma-preserved-and-single-ingredient-cues |
| 7 | `plov` | Central Asia | `grain_rice_noodle` | staple-starches-grains-and-noodles |
| 8 | `lagman` | Central Asia | `grain_rice_noodle` | staple-starches-grains-and-noodles |
| 9 | `haitian-griot` | Haiti | `protein_centered` | stews-braises-and-sauced-mains |
| 10 | `trinidad-doubles` | Trinidad and Tobago | `snack_street_food` | handheld-street-and-filled-foods |

Each new family includes:
- Entry in `dish-families.json` with aliases, transliterations, regions, shared/divergent elements, nostalgia triggers
- Taxonomy mapping in `reference-family-taxonomy.json` with `currentRecordCount: 7`
- 7 typed `ResearchRecord` fixtures in `reference-pantry-fixtures.json` (primary region + diaspora/migration/global/community/mechanism/naming contexts)
- 7 seeds in `reference-seed-queue.json`
- 7 tasks in `cache-warming-manifest.json`

## Validation & Build Results

### Commands Run

1. **`npm run build`** (TypeScript compilation)
   - **Result:** PASS ✅
   - `tsc` completes with zero errors.

2. **`npx vitest run tests/data-validation.test.ts`** (schema validation)
   - **Result:** PASS ✅
   - 25/25 tests passed.
   - `validateBundledData(bundledData)` returns `[]` — no structural or schema issues.

3. **`npx vitest run tests/reference-seed-planner.test.ts`** (seed planner)
   - **Result:** PASS ✅
   - 4/4 tests passed.

4. **`node scripts/reference-seed-operator.mjs --population-audit`** (population audit)
   - **Result:** PASS ✅ (no issues)
   - `familyCount`: 194
   - `depthBuckets`: `{"7": 194}` — every family has exactly 7 fixtures
   - `minRecordsPerFamily`: 7
   - `maxRecordsPerFamily`: 7
   - `duplicateCacheTargets`: []
   - `artificialTargets`: []
   - `taxonomyCountDrift`: []
   - `issues`: []

5. **`npx vitest run tests/reference-pantry-population.test.ts`** (population snapshot test)
   - **Result:** FAIL ❌ (2/6 tests failed)
   - Failures are due to **hardcoded snapshot expectations** in the test file:
     - `expect(audit.familyCount).toBe(184)` — actual is 194
     - `expect(audit.depthBuckets).toEqual({ '7': 184 })` — actual is `{"7":194}`
   - These assertions are population-count snapshots, not schema or structural validation errors. The data is internally consistent and passes the actual population audit with zero issues.
   - **Cannot fix without modifying test files**, which the task explicitly forbids (`Do NOT touch anything outside src/data/ and a report file`).

6. **`npx vitest run tests/reference-seed-operator.test.ts`**
   - **Result:** 1 pre-existing failure (SQLite binary `NODE_MODULE_VERSION` mismatch)
   - This failure is unrelated to the data changes.

## Provenance & Source Policy

- All new fixtures cite `wikidata-structured-food-data` under the existing CC0 source policy.
- No fake QIDs invented; URLs use Wikidata search endpoints (`Special:Search`) where specific item identifiers were not known.
- No existing entries removed or reordered; all changes are additive.

## Conclusion

The reference database expansion is **structurally valid, schema-compliant, and population-consistent**. The new families and fixtures directly address the five under-covered regions specified in the coverage audit, with balanced representation across food forms and sensory mechanisms.
