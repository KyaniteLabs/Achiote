# Global Reference Seed Implementation Plan

**Goal:** Build the global reference/cache seed foundation for Achiote across all food and drink categories, regions, cultures, name systems, and sensory mechanisms.

**Architecture:** Add a validated coverage matrix and reference seed queue first, then use private aggregate quality signals to prioritize seed work. Keep all seed data provenance-bounded and keep live browsing/cache writes outside this first slice.

**Tech Stack:** TypeScript, JSON data under `src/data`, existing data validation patterns in `src/lib/data-schemas.ts`, Vitest, existing package/build pipeline, no new dependencies.

---

### Task 1: Add Coverage Matrix Schema Tests

**Files:**
- Modify: `tests/data-validation.test.ts`
- Modify: `src/lib/data-schemas.ts`

**Step 1: Write failing validation tests**

Add imports for future files:

```ts
import globalCoverageMatrixData from '../src/data/global-coverage-matrix.json' with { type: 'json' };
import referenceSeedQueueData from '../src/data/reference-seed-queue.json' with { type: 'json' };
```

Add tests that expect:

- committed matrix validates,
- duplicate axis values fail,
- empty axis values fail,
- seed queue references only known coverage tags,
- each seed has provenance.

**Step 2: Verify red**

Run:

```bash
npm test -- tests/data-validation.test.ts -t "global"
```

Expected: fail because files and validators do not exist.

**Step 3: Implement schema types and validators**

In `src/lib/data-schemas.ts`, add:

```ts
type CoverageAxis = {
  id?: unknown;
  label?: unknown;
  values?: unknown;
};

type GlobalCoverageMatrix = {
  meta: Meta;
  axes: Record<string, CoverageAxis>;
};

type ReferenceSeedQueue = {
  meta: Meta;
  seeds: unknown[];
};
```

Add `validateGlobalCoverageMatrix`, `validateReferenceSeedQueue`, and include them in `validateBundledData`.

**Step 4: Verify green after data files exist**

Run:

```bash
npm test -- tests/data-validation.test.ts
```

Expected: pass.

### Task 2: Add Global Coverage Matrix

**Files:**
- Create: `src/data/global-coverage-matrix.json`
- Modify: `src/lib/data-schemas.ts`
- Modify: `tests/data-validation.test.ts`

**Step 1: Create the matrix**

Add axes:

- `foodForms`: beverage, soup_broth, stew_braise, sauce_condiment, pickle_ferment, bread_flatbread, grain_rice_noodle, dumpling_pocket, protein_centered, vegetable_fungi, confectionery, dessert, snack_street_food, ceremonial_holiday, breakfast, sick_day_comfort, pantry_single_ingredient.
- `regionScopes`: macro_region, nation, subregion, city, diaspora, borderland, indigenous, religious_ritual, migration_corridor.
- `nameSystems`: alias, transliteration, script_form, phonetic, typo, family_nickname, menu_name, colonial_postcolonial_name.
- `mechanisms`: aroma, browning, fermentation_acid, starch_texture, fat_mouthfeel, sugar_crystal, smoke, alkaline_processing, sauce_balance, temperature, texture_contrast, serving_ritual.
- `evidenceLevels`: seed_hypothesis, researched_record, family_confirmed, operator_quality_signal.

**Step 2: Validate**

Run:

```bash
npm test -- tests/data-validation.test.ts -t "global coverage"
```

Expected: pass once validator exists.

### Task 3: Add Starter Reference Seed Queue

**Files:**
- Create: `src/data/reference-seed-queue.json`
- Modify: `tests/data-validation.test.ts`

**Step 1: Create a small but global starter queue**

Include one seed per top-level form family, not just beverages:

- rice/cinnamon beverage,
- sour herb soup,
- chile/vinegar condiment,
- fermented pickle,
- flatbread/staple bread,
- rice/grain/noodle staple,
- dumpling/pocket,
- protein-centered braise,
- vegetable/fungi dish,
- nut/sugar confection,
- milk/custard dessert,
- street snack,
- holiday/ceremonial wrapped food,
- breakfast porridge,
- sick-day comfort broth,
- single-ingredient pantry cue.

Each seed must have:

```json
{
  "id": "stable-slug",
  "forms": ["foodForms.beverage"],
  "regions": ["macro:Latin America", "diaspora:United States"],
  "nameSignals": ["horchata", "agua de arroz"],
  "mechanisms": ["mechanisms.starch_texture", "mechanisms.temperature"],
  "querySeeds": ["horchata rice cinnamon regional variants"],
  "cacheTargets": [{ "dishFamily": "rice-cinnamon-beverage", "region": "Mexico" }],
  "coverageTags": ["foodForms.beverage", "nameSystems.alias", "regionScopes.diaspora"],
  "provenance": {
    "sourceType": "curated seed hypothesis",
    "notes": ["Research target only; not an authoritative cultural claim."]
  }
}
```

**Step 2: Reject bad seeds**

Add mutation tests for:

- unknown tag,
- duplicate ID,
- empty `querySeeds`,
- missing `provenance`,
- cache target missing region.

**Step 3: Verify**

Run:

```bash
npm test -- tests/data-validation.test.ts -t "reference seed"
```

Expected: pass.

### Task 4: Add Seed Privacy Guardrails

**Files:**
- Modify: `tests/security-legal-surface.test.ts`
- Modify: `tests/package-metadata.test.ts`

**Step 1: Add forbidden-pattern tests**

Assert new seed files do not include:

- provider names as product claims,
- API key patterns,
- raw prompt markers,
- medical/legal claims,
- "Achiote browses" or "live web" claims.

**Step 2: Add package guard**

Assert `package.json.files` still ships seed files through `dist/` only.

**Step 3: Verify**

Run:

```bash
npm test -- tests/security-legal-surface.test.ts tests/package-metadata.test.ts
```

Expected: pass.

### Task 5: Add Quality-Signal Seed Prioritizer

**Files:**
- Create: `src/lib/reference-seed-planner.ts`
- Create: `tests/reference-seed-planner.test.ts`

**Step 1: Write failing pure tests**

Inputs:

- `QualitySignalReport` with `byMemoryType.beverage`, `missing.missing_region`, and `byGuard.explicit_minimum_cue_fallback`.
- committed seed queue.

Expected output:

- ranked seed IDs,
- bounded reason codes,
- no raw memory text.

**Step 2: Implement pure planner**

Export:

```ts
export type SeedPriorityReason =
  | 'frequent_memory_type'
  | 'missing_region'
  | 'fallback_guard'
  | 'unknown_family'
  | 'cache_unavailable';

export function prioritizeReferenceSeeds(report: QualitySignalReport, queue: ReferenceSeedQueue): SeedPriority[];
```

The planner should stay deterministic and low-cardinality.

**Step 3: Verify**

Run:

```bash
npm test -- tests/reference-seed-planner.test.ts
```

Expected: pass.

### Task 6: Full Verification And PR

Run:

```bash
npm run check
npm run package:smoke
npm audit --audit-level=moderate
git diff --check
npm pack --dry-run
```

Expected: all pass.

Commit with Lore protocol, push `codex/global-reference-seed-plan`, open a PR, monitor Node 22/Node 24/GitGuardian, and address actionable Codex review feedback. Do not deploy production and do not make live provider calls in this slice.

