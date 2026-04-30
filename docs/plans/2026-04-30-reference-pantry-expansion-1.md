# Reference Pantry Expansion 1 Implementation Plan

**Goal:** Expand the bundled pantry from a first skeleton into a balanced 120-record global substrate across every current culture-area bucket and six high-frequency food-memory bands.

**Architecture:** Add expansion seeds, cache-warming tasks, and matching typed pantry fixtures together so validation remains deterministic. Use only source-gated structured public data, with Wikidata labels/descriptions as the fixture source and no recipe prose, raw memories, provider details, or family-specific certainty claims.

**Tech Stack:** TypeScript, JSON bundled data files, Vitest, the existing reference seed operator and SQLite cache writer.

---

### Task 1: Add Coverage Gates

**Files:**
- Modify: `tests/reference-seed-operator.test.ts`

**Steps:**
1. Add failing assertions that the committed pantry has at least 138 total fixtures.
2. Add failing assertions that expansion fixture records form a 20 culture areas x 6 bands matrix.
3. Add failing assertions that every expansion fixture validates against approved source ids and has no forbidden text.
4. Run `npm test -- tests/reference-seed-operator.test.ts` and confirm the new expansion expectations fail.

### Task 2: Add Expansion Seeds And Tasks

**Files:**
- Modify: `src/data/reference-seed-queue.json`
- Modify: `src/data/cache-warming-manifest.json`

**Steps:**
1. Generate 120 deterministic seed entries: one per culture-area and expansion band.
2. Generate 120 matching cache-warming tasks.
3. Keep coverage tags restricted to existing matrix axes.
4. Run `npm test -- tests/data-validation.test.ts tests/reference-seed-planner.test.ts`.

### Task 3: Add Source-Gated Fixtures

**Files:**
- Modify: `src/data/reference-pantry-fixtures.json`

**Steps:**
1. Generate 120 typed `ResearchRecord` fixtures whose `seedId` and `cacheTarget` match the new manifest tasks.
2. Use `wikidata-structured-food-data` as the fixture source id.
3. Record Wikidata item URLs and structured label/description facts in each source entry.
4. Mark every expansion fixture as `evidenceLevels.seed_hypothesis` and `evidenceLevels.researched_record`, not family-confirmed.
5. Run the focused pantry tests and confirm the full matrix passes.

### Task 4: Update Operator And Package Proofs

**Files:**
- Modify: `tests/reference-seed-operator.test.ts`
- Modify: `scripts/package-smoke.mjs` only if the minimum fixture count assertion needs to change.

**Steps:**
1. Update bundled-write assertions from the 18-record skeleton to the expanded total.
2. Prove packaged installs can still write the bundled cache.
3. Run `npm run package:smoke`.

### Task 5: Verify, Commit, PR, Monitor, Merge

**Commands:**
```bash
npm run check
npm run package:smoke
npm audit --audit-level=moderate
git diff --check
npm pack --dry-run
```

Then commit with the Lore protocol, push, open a PR, monitor CI and Codex review, address actionable comments, merge, sync `master`, and clean the temporary worktree.
