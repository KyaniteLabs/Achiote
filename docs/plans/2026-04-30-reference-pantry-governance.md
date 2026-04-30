# Reference Pantry Governance Implementation Plan

**Goal:** Make Achiote's curated reference pantry grow through source-approved, globally representative, provenance-bounded data instead of ad hoc food facts.

**Architecture:** Keep Achiote itself non-browsing. Add a bundled source registry, broaden the coverage matrix with world culture-area buckets, and expose source policy through the operator report so cache-warming fixtures are gated before they touch SQLite.

**Tech Stack:** TypeScript, bundled JSON data, Vitest, SQLite-backed `ResearchCache`, and the existing `scripts/reference-seed-operator.mjs`.

---

### Task 1: Source Registry

**Files:**
- Create: `src/data/reference-source-registry.json`
- Modify: `src/lib/data-schemas.ts`
- Test: `tests/data-validation.test.ts`

**Steps:**
1. Add a failing validation test requiring source ids, license metadata, fixture policy, allowed uses, and forbidden uses.
2. Add the source registry with CC0/public-domain sources allowed first, ODbL and FAO/INFOODS as manual-review sources, and copied/proprietary/uncited data forbidden.
3. Extend bundled data validation to reject missing license metadata, unknown fixture policies, duplicate sources, and empty allowed/disallowed use lists.

### Task 2: Operator Source Policy

**Files:**
- Modify: `src/lib/reference-seed-planner.ts`
- Modify: `src/lib/reference-seed-operator.ts`
- Test: `tests/reference-seed-operator.test.ts`
- Test: `tests/package-metadata.test.ts`

**Steps:**
1. Add a failing operator test expecting allowed, manual-review, and rejected source policy summaries.
2. Bundle the source registry with the existing global reference seed data.
3. Expose source policy in `buildReferenceSeedOperatorReport` without raw memories, provider details, credentials, or browsing claims.

### Task 3: Global Coverage Breadth

**Files:**
- Modify: `src/data/global-coverage-matrix.json`
- Modify: `src/data/reference-seed-queue.json`
- Modify: `src/data/cache-warming-manifest.json`
- Test: `tests/reference-seed-operator.test.ts`

**Steps:**
1. Add a failing test for 20/20 broad culture-area coverage and known blind spots: Indigenous foodways, borderlands, script forms, phonetic memories, and smoke.
2. Add a world culture-area coverage axis and update seed tags to cover the breadth map.
3. Add starter seed targets for Oceania/Pacific earth-oven foodways and Arctic/subarctic preserved foodways, both still marked as seed hypotheses until sourced records exist.

### Verification

Run:

```bash
npm test -- tests/data-validation.test.ts tests/reference-seed-operator.test.ts tests/package-metadata.test.ts tests/security-legal-surface.test.ts
npm run check
npm run package:smoke
npm audit --audit-level=moderate
git diff --check
npm pack --dry-run
```

### Follow-up Fixture Batch

The first implementation pass after this governance layer added `src/data/reference-pantry-fixtures.json`: 18 approved typed `ResearchRecord` fixtures, one for every initial cache-warming target. Expansion 1 then grew that bundle to 138 fixtures total by adding 120 balanced records across 20 culture-area buckets and six food-memory bands. The bundled batch uses Wikidata structured labels/descriptions under the CC0 source policy and can be written with:

```bash
npm run reference:seeds -- --fixture bundled --cache-path ~/.cache/achiote/culture-cache.db
```

The batch is meant to reduce inference burden by giving smaller models stable vocabulary, aliases, broad regional/culture-area tags, food-form tags, and sensory mechanism context before the host model reasons from scratch. It is cited researched context, not family-confirmed evidence and not an operator quality signal.
