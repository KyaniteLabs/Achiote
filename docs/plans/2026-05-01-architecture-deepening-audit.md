# Architecture Deepening Audit

Date: 2026-05-01

Trigger: fresh audit after reviewing mattpocock/skills guidance for `zoom-out` and `improve-codebase-architecture`.

## Remediation Status

Updated: 2026-05-08.

This audit has been largely remediated on `master`. Keep the original findings below as the audit record, but treat this status list as the current navigation point:

- Finding 1: `AskController` exists in `src/lib/ask-controller.ts`. Additionally, `http-server.ts` has been decomposed from ~2900 lines to ~2140 lines by extracting `src/lib/ask-guardrails.ts` (~409 lines), `src/lib/ask-response-builder.ts` (~302 lines), `src/lib/ask-memory-correction.ts` (~93 lines), and `src/lib/telemetry-collector.ts` (~155 lines). The memory workflow barrel `src/lib/memory-workflow.ts` has been decomposed into five focused modules: `food-memory-collector`, `dish-research-planner`, `reconstruction-dossier`, `family-followup-generator`, and `nostalgia-cue-generator`.
- Finding 2: `WorkflowPlanner` exists in `src/lib/workflow-planner.ts`.
- Finding 3: `CueProfileEngine` and `ConstraintAdapter` exist in `src/lib/cue-profile-engine.ts` and `src/lib/constraint-adapter.ts`.
- Finding 4: `ReferencePantryPopulation` exists in `src/lib/reference-pantry-population.ts`.
- Finding 5: bundled data validation split into `validateCoreFoodData`, `validateReferencePantryData`, `validateOperatorData`, and `validateInferenceBurdenData`; `validateCrossReferences` is tested; all family validators have regression coverage.
- Finding 6: `PackageSurface` exists in `scripts/lib/package-surface.mjs`.
- Additional boundaries landed after the audit: `ProviderRuntime`, `AccountAccess`, `LocalSpeechController`, `ProductApp`, `AskGuardrails`, `AskResponseBuilder`, `AskMemoryCorrection`, and `TelemetryCollector`.
- Domain docs and ADR setup now exist in `CONTEXT.md`, `docs/adr/`, and `docs/agents/`.
- Cross-file duplications resolved: `isBroadRegionalHint`, `escapeRegExp`, cache patterns (`ARTIFICIAL_CACHE_FAMILY_PATTERN`/`ARTIFICIAL_CACHE_REGION_PATTERN`) now have canonical single-definition locations.

Current extension rule: prefer these named boundaries before adding behavior back into `src/http-server.ts`, `src/lib/memory-workflow.ts`, `src/tools/tool-registry.ts`, or `docs/landing/app.js`.

## Scope

This is a read-only architecture audit of the current Achiote repo. The repo is clean and synced on `master` at audit start.

The Matt Pocock skills expect shared domain docs (`CONTEXT.md`) and ADRs. Achiote has strong product and architecture docs, but no root `CONTEXT.md`, `docs/adr/`, or `docs/agents/` setup yet. Domain vocabulary below is inferred from `AGENTS.md`, `docs/ARCHITECTURE.md`, and source/tests.

## System Map

Achiote has four main runtime surfaces:

- MCP stdio: `src/index.ts`, `src/cli.ts`, `src/server.ts`, `src/tools/tool-registry.ts`
- HTTP mode: `src/http-server.ts`
- Reference pantry and operator data: `src/data/*.json`, `src/lib/reference-*.ts`, `scripts/reference-seed-operator.mjs`
- Ask workflow and provider recovery: `src/http-server.ts`, `src/lib/ask-provider.ts`, `src/lib/memory-workflow.ts`, `src/lib/tool-loop.ts`, `src/lib/quality-signals.ts`

Main domain terms used in this audit:

- food memory
- memory receipt
- research plan
- research record
- reconstruction dossier
- minimum viable nostalgia cue
- reference pantry
- cache warming manifest
- reference seed queue
- source policy
- inference burden
- provider capability profile
- ask session
- quality signal

Architecture vocabulary follows the Matt Pocock skill:

- module
- interface
- implementation
- seam
- adapter
- depth
- leverage
- locality

## Findings

### 1. Ask Flow Is The Highest-Risk Shallow Module (PARTIALLY REMEDIATED)

Files:

- `src/http-server.ts` (~2140 lines, reduced from ~2900)
- `src/lib/ask-guardrails.ts` (extracted)
- `src/lib/ask-response-builder.ts` (extracted)
- `src/lib/ask-memory-correction.ts` (extracted)
- `src/lib/telemetry-collector.ts` (extracted)
- `src/lib/ask-provider.ts`
- `src/tools/tool-registry.ts`
- `src/lib/tool-loop.ts`
- `tests/ask-openai-provider.test.ts`
- `tests/ask-failure-surface-regressions.test.ts`

Problem:

`src/http-server.ts` was a 2,900-line module whose interface is nominally HTTP routing, but its implementation also owned ask-session orchestration, deterministic tool recovery, tool input normalization, search caps, substitution recovery, final-answer sanitization, provider failure classification, SSE event sequencing, and quality-signal recording.

The deletion test says the ask flow is earning its keep, but the module shape is shallow: deleting `http-server.ts` would scatter many ask-specific invariants rather than reveal a clean HTTP interface. Tests mostly exercise HTTP behavior or provider fixtures, so implementation-local changes are costly.

Remediation (2026-05-08):

Extracted four focused modules from `http-server.ts`:
- `src/lib/ask-guardrails.ts` — guardrail detection/sanitization, tool name normalization, clarification response builder
- `src/lib/ask-response-builder.ts` — response assembly, minimum-cue formatting, substitution basis, cue quality enforcement
- `src/lib/ask-memory-correction.ts` — safety constraint inference, search query building, memory correction pipeline
- `src/lib/telemetry-collector.ts` — privacy-preserving telemetry event sanitization and rate limiting

The remaining ask-session orchestration, tool-loop control, and SSE event sequencing still live in `http-server.ts`. A future `AskController` extraction could address these.

Solution (remaining):

Create a deep `AskController` module with one interface such as `runAskTurn(input, sinks)`. Keep HTTP parsing/auth/rate limit in `http-server.ts`, but move tool-loop orchestration, deterministic recovery, final synthesis fallback, and event emission decisions behind the controller seam.

Benefits:

- Locality: ask workflow bugs move out of the HTTP router and into one module.
- Leverage: provider recovery, deterministic cue fallback, substitution handling, and tool sequencing become testable through one interface.
- Tests: existing `/ask` tests can stay; new controller tests can target the workflow without opening an HTTP server.

### 2. Tool Workflow Planning Is Buried Inside The Tool Registry

Files:

- `src/tools/tool-registry.ts`
- `src/http-server.ts`
- `src/lib/memory-workflow.ts`
- `tests/tool-registry.test.ts`
- `tests/ask-openai-provider.test.ts`

Problem:

`plan_tool_workflow` is currently implemented inline in the registry. It performs intent detection, restriction detection, search suppression, bundled mechanism routing, substitution workflow construction, and search-call budgeting. The registry interface should expose tools; instead, it also contains a large policy implementation that callers must understand indirectly.

Solution:

Extract a `WorkflowPlanner` module with a small interface: `planAskWorkflow({ userMessage, searchDisabled })`. The registry tool becomes an adapter around the planner, and HTTP deterministic injection calls the same planner path.

Benefits:

- Locality: planning rules are not mixed into registration/schema glue.
- Leverage: tool registry, HTTP pre-plan injection, canary tests, and future CLI/quality reports can share the same planner.
- Tests: intent/restriction/search-budget cases become fast unit tests against planner output.

### 3. Minimum Viable Nostalgia Cue Has Too Much Policy In One Module (REMEDIATED)

Files:

- `src/lib/memory-workflow.ts` (now a 6-line re-export barrel)
- `src/lib/food-memory-collector.ts` (extracted)
- `src/lib/dish-research-planner.ts` (extracted)
- `src/lib/reconstruction-dossier.ts` (extracted)
- `src/lib/family-followup-generator.ts` (extracted)
- `src/lib/nostalgia-cue-generator.ts` (extracted)
- `src/lib/cue-profile-engine.ts` (pre-existing)
- `src/lib/constraint-adapter.ts` (pre-existing)
- `src/data/memory-hints.json`
- `tests/minimum-viable-nostalgia.test.ts`
- `tests/ask-failure-surface-regressions.test.ts`

Problem:

`memory-workflow.ts` owned memory collection, hypothesis planning, dossier building, family follow-up questions, cue profile selection, food-science mechanism matching, local test wording, dietary constraints, and constraint rewrites. The minimum-cue implementation alone contained many private seams, but callers only saw one large module.

Remediation (2026-05-08):

Decomposed the monolith into five domain-focused modules behind a thin re-export barrel:
- `food-memory-collector.ts` — clue extraction, missing-information questions, broad-regional detection
- `dish-research-planner.ts` — hypothesis building, evidence planning, search queries
- `reconstruction-dossier.ts` — evidence-separated dossier assembly
- `family-followup-generator.ts` — family follow-up question generation
- `nostalgia-cue-generator.ts` — minimum viable nostalgia cue generation with all component/signal helpers

Pre-existing `CueProfileEngine` and `ConstraintAdapter` remain separate as recommended.

Benefits:

- Locality: cue regressions stop sharing a file with intake and research planning.
- Leverage: the same cue profile engine can serve MCP, HTTP fallback, and future canary scoring.
- Tests: focused profile tests can cover food-science and constraint behavior without constructing full dossiers every time.

### 4. Reference Pantry Has Strong Data But Weak Operator Interfaces

Files:

- `src/data/reference-pantry-fixtures.json`
- `src/data/reference-family-taxonomy.json`
- `src/data/reference-seed-queue.json`
- `src/data/cache-warming-manifest.json`
- `src/lib/reference-seed-operator.ts`
- `src/lib/data-schemas.ts`
- `scripts/reference-seed-operator.mjs`
- `tests/reference-seed-operator.test.ts`
- `tests/data-validation.test.ts`

Problem:

The reference pantry has become central product infrastructure. Its invariants are spread across JSON files, schema validation, operator report generation, fixture write logic, and tests. Recent population work needed custom one-off scripts because there is no deep module for "population checkpoint" operations.

Solution:

Create a `ReferencePantryPopulation` module that owns:

- depth audits
- source-diversity audits
- duplicate cache-target audits
- taxonomy count reconciliation
- safe append operations for fixture + seed + manifest + taxonomy updates

Keep `data-schemas.ts` as the validation layer. The new module becomes the operator-facing interface for density loops.

Benefits:

- Locality: population invariants live in code instead of ad hoc scripts.
- Leverage: future database filling can be reproducible and less token-heavy.
- Tests: one fixture-builder test can prove the four data files stay synchronized.

Implementation status:

- Added `src/lib/reference-pantry-population.ts` as the first deep module for this finding.
- Added `auditReferencePantryPopulation(...)` to centralize family-depth, source-diversity, duplicate target, artificial target, and taxonomy count-drift checks.
- Added `scripts/reference-seed-operator.mjs --population-audit` so database-deepening loops can run the checkpoint directly before and after adding records.
- Added regression coverage for both the current bundled pantry and a deliberately thin/drifted synthetic batch.

### 5. Bundled Data Validation Is A Deep Module Trying To Hold Too Many Schemas

Files:

- `src/lib/data-schemas.ts`
- `tests/data-validation.test.ts`

Problem:

`data-schemas.ts` validates every bundled data asset: dish families, ingredients, memory hints, regional availability, sensory profiles, global coverage, seed queue, manifest, source registry, taxonomy, fixtures, and inference burdens. The module is valuable, but its interface is almost entirely `validateBundledData(data)`, while implementation knowledge is packed into many private validators.

Solution:

Split validation by data family while preserving a single public aggregate interface:

- `validateCoreFoodData`
- `validateReferencePantryData`
- `validateOperatorData`
- `validateInferenceBurdenData`

Export only the aggregate by default; expose narrower validators only where tests/operators need them.

Benefits:

- Locality: a taxonomy change does not require scanning ingredient and speech-adjacent validation logic.
- Leverage: each data family can gain sharper invariants without making the whole validator harder to navigate.
- Tests: existing aggregate tests remain, while targeted tests become easier to read.

### 6. Product Runtime And Static Landing Assets Share A Packaging Surface

Files:

- `src/http-server.ts`
- `docs/landing/*`
- `scripts/package-smoke.mjs`
- `package.json`
- `tests/package-metadata.test.ts`
- `tests/http-server.test.ts`

Problem:

The package ships MCP runtime code, HTTP product runtime, static website files, scripts, and product docs together. This is currently intentional, but the package interface is broad: runtime behavior, landing assets, pricing copy, and AI-search metadata are all release-blocking.

Solution:

Create a `PackageSurface` audit module or script that validates the intended public bundle as a named product contract. This is a smaller move than splitting packages, and it would make the current all-in-one package safer.

Benefits:

- Locality: package inclusion decisions live in one verified contract.
- Leverage: smoke tests can check package purpose, not only file presence.
- Tests: future landing/runtime changes fail with clearer product-surface messages.

## Recommended First Move

Start with `ReferencePantryPopulation`.

Reason:

- It directly supports the user's current database-density goal.
- It has high leverage and low product-runtime risk.
- It converts the most recent manual population loop into a durable interface.
- It reduces future token waste by making population checkpoints repeatable.

Second move:

Extract `WorkflowPlanner` from `src/tools/tool-registry.ts`.

Reason:

- It removes a large policy blob from registry glue.
- It improves `/ask` reliability without touching the full 2,900-line HTTP controller yet.

Third move:

Create `CONTEXT.md` and `docs/agents/*` setup so future architecture skills use Achiote's domain language rather than re-inferring it.

## Stop Condition

This audit stops at candidate identification. Do not implement these refactors until a candidate is selected, because the deeper interface shape should be grilled against Achiote's domain language first.
