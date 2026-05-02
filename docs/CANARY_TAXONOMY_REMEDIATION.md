# Canary Taxonomy Remediation

The knowledge-gap canary turns canary evidence into taxonomy work only after runtime failures have been separated out.

Use it for this loop:

1. Run the weak-model or live-provider canary.
2. Analyze the JSONL with `npm run knowledge:canary -- --results <artifact>/results.jsonl --out <report>.json --taxonomy-queue docs/taxonomy-remediation-queue.json`.
3. Triage `taxonomyRemediationQueue.items`.
4. Update generalized taxonomy/reference data, not prompt-specific branches.
5. Add planner, cue, and canary regression coverage for the remediated mechanism.
6. Re-run the canary and confirm the queue shrinks or changes for a product-relevant reason.

## Evidence Rules

- `knowledgeGaps` are allowed taxonomy inputs.
- `excludedEvidence` is not taxonomy input. It belongs in fake-provider or wrapper regression work.
- `regressionCandidates` block taxonomy interpretation until the runtime or wrapper defect has a regression.
- Queue examples keep provider/model/round metadata and safe prompt refs. Raw user memories do not belong in production taxonomy.

## Done Criteria

An item can close when a clean canary for that mechanism:

- avoids `search_web` unless the user asked for exact source-backed identity or research,
- produces a cheap minimum viable cue before specialty sourcing,
- uses specific reusable sensory mechanisms instead of generic placeholder language,
- keeps `userSaid`, researched facts, inferred facts, and unknowns separate,
- and has regression coverage that would catch the same gap returning.

The queue is an operator artifact. Production taxonomy remains under `src/data/` and must stay generalized, sourced, and validated by the bundled data tests.
