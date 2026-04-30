# Inference Burden Inventory

## Goal

Make Achiote cheaper, faster, and more reliable by identifying every repeatable burden that should move out of prompt/inference and into deterministic data, retrieval, controllers, validators, formatters, observability, or consent gates.

The goal is not to make the model dumb. The goal is to give small models enough structured help to succeed while still giving strong models room to reason, synthesize, rank hypotheses, explain ambiguity, and make culturally sensitive judgments.

## Implemented Artifact

The source-controlled contract lives at:

- `src/data/inference-burden-inventory.json`
- `src/lib/inference-burden-inventory.ts`

The JSON file is permanent repository data, not cache warming output. It names each burden, where that burden currently appears, what deterministic owner should absorb it, which prompt surfaces could shrink, which artifacts are candidates for future extraction, what proves success, and what model latitude must be preserved.

The TypeScript helper exposes:

- `listInferenceBurdens()`
- `buildInferenceBurdenSummary()`
- `findPromptOffloadCandidates()`

These are exported from `src/index.ts` so operators and future scripts can inspect the burden map without scraping docs.

## Ownership Model

Use this rule:

- `data`: names, aliases, cultural patterns, sensory mechanisms, source policy.
- `retrieval`: pantry records, cache records, regional availability, substitution candidates.
- `controller`: workflow state, provider profiles, tool transitions, retry budgets.
- `validator`: trust boundaries, output sanitizers, schema conformance, tool alias repair.
- `formatter`: receipts, case files, output sections, prompt templates.
- `observability`: aggregate quality signals and seed priorities.
- `consent_gate`: optional analytics and quality-signal recording.

The LLM keeps:

- sensory interpretation,
- cultural synthesis,
- hypothesis ranking,
- ambiguity handling,
- humane explanation,
- creative minimum-cue construction,
- deciding when retrieved context does not fit the user's actual memory.

## Current Highest-Leverage Burdens

The first inventory includes 17 burdens, including:

- food and drink name normalization,
- user intent routing,
- compact case-file packing,
- reference retrieval,
- tool workflow control,
- evidence ledger separation,
- provider-neutral trust boundaries,
- output contract rendering,
- quality evaluation,
- sensory mechanism scaffolding,
- availability and substitution resolution,
- optional learning consent gates,
- prompt-template externalization,
- tool-call alias repair,
- declarative final-answer sanitizers,
- provider capability profiles,
- soft family-memory patterns,
- beverage-first mechanisms.

## Anti-Rigidity Guard

Every inventory entry must include:

- `preserveLatitude`: at least two ways the model keeps room to reason.
- `modelKeeps`: what remains model-owned.
- `riskIfOverRigid`: what could go wrong if the deterministic layer becomes too controlling.

This prevents future data-engineering work from silently turning Achiote into a brittle form-filler.

## Verification

The contract is guarded by:

- `tests/inference-burden-inventory.test.ts`
- `tests/data-validation.test.ts`
- `tests/package-metadata.test.ts`

Those tests prove the inventory covers all major burden classes, remains source-controlled data, stays provider-neutral and non-browsing, preserves model latitude, validates bounded schema fields, and ships only through the compiled `dist/` package surface.

## Next Implementation Slices

1. Convert the top prompt-offload candidates into a compact `/ask` case-file builder.
2. Externalize `promptForAgent` strings into versioned prompt-template contracts.
3. Move tool typo repair and final-answer sanitizers into declarative policy data.
4. Add soft cultural memory pattern records for diaspora taste drift, formulation drift, brand/category substitution, package memory, and family-name variants.
5. Add provider capability profiles so tiny local models receive smaller case files while stronger models can receive richer optional context.
