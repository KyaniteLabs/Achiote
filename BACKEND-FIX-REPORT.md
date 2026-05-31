# Achiote Backend Fix Report

## Build Status
`npx tsc --noEmit` — **PASS** (no errors)  
`npm run build` — **PASS**

---

## Defect 1: `source_ingredients` never fires

### Root Cause
`source_ingredients` was **never added to `workflowSteps`** in `planAskWorkflow` (`src/lib/workflow-planner.ts`). Because `nextAskToolNames` (`src/http-server.ts:1277`) only exposes tools listed in the plan’s `workflowSteps`, the model never received `source_ingredients` in its available-tools list and therefore could not call it.

> Offending code (`src/lib/workflow-planner.ts`):
> ```typescript
>   if (needsSubstitutions) {
>     steps.push({ tool: 'resolve_dish_name', ... });
>     ...
>     steps.push({ tool: 'find_sensory_substitutes', ... });
>   } else if (...) {
>     ...
>   } else {
>     steps.push({ tool: 'resolve_dish_name', ... });
>     steps.push({ tool: 'build_reconstruction_dossier', ... });
>     steps.push({ tool: 'generate_minimum_viable_nostalgia', ... });
>   }
>   // source_ingredients is nowhere in any branch
> ```

### Edits Applied
1. **`src/lib/workflow-planner.ts`** — Added sourcing-intent detection (`hasSourcingKeywords` + `hasLocation`) and a `needsSourcing` flag. When true, appended `source_ingredients` to `workflowSteps` in every non-trivial branch. Also added `needsSourcing` to the return object.
2. **`src/schemas/tool-schemas.ts`** — Added `needsSourcing: z.boolean().optional()` to `planToolWorkflowOutputSchema` for type consistency.
3. **`src/http-server.ts`** — Added `maybeRunPlannedSourcing` deterministic fallback (mirrors the existing `maybeRunPlannedSubstitutions` pattern). It checks whether `source_ingredients` is in the planned steps but not yet called, then executes it with `ingredients` from `collect_food_memory` and `location` from memory or `inferUserLocation`. Called after the model loop in three recovery/continuation paths.

### Test Note
Query: *"my grandmother in Oaxaca made mole negro with chilhuacle chiles; I live in Des Moines, Iowa; what goes in it, where can I buy the chiles near me, and what can I substitute"*  
Look for SSE `tool_call` / `tool_result` events for `source_ingredients` after `generate_minimum_viable_nostalgia` (or during deterministic recovery).

---

## Defect 2: Researched facts are not surfaced in the user-facing prose

### Root Cause
The SYSTEM_PROMPT (`src/http-server.ts`) instructed the model to synthesize tool outputs but never explicitly told it to **reference specific researched facts** in its prose. Additionally, deterministic fallback text built by `buildEvidencePreamble` (`src/lib/ask-guardrails.ts`) only listed user anchors, inferred starts, and unknowns — it omitted researched facts entirely, so even fallback paths produced generic text.

> Offending code (`src/lib/ask-guardrails.ts:340`):
> ```typescript
>   return [
>     `User-said anchors: ...`,
>     ...
>     `Unknown: ${unknown}.`,
>   ].filter(Boolean).join('\n');
>   // No researched facts line
> ```

### Edits Applied
1. **`src/http-server.ts`** — Added an explicit instruction to the SYSTEM_PROMPT:

   > *"If researched facts were gathered (e.g., from search_web or resolve_dish_name), explicitly reference at least one specific finding in your prose. Do not summarize vaguely — name the exact fact."*

2. **`src/lib/ask-guardrails.ts`** — Extended `buildEvidencePreamble` to extract and prepend researched facts from `resolve_dish_name` and `search_web` payloads. When present, the preamble now includes a `Researched facts:` line, so deterministic fallback responses (e.g., `buildMinimumCueCompletedResponse`) weave those facts into the `text` event.

### Test Note
Query: *"my grandmother in Oaxaca made mole negro with chilhuacle chiles; I live in Des Moines, Iowa; what goes in it, where can I buy the chiles near me, and what can I substitute"*  
Look for the SSE `text` event to explicitly mention a specific researched fact (e.g., a mole-negro chile detail from `search_web` or the resolved dish name), not just a generic cue.

---

## Defect 3: Confidence stuck on "Low"

### Root Cause
Two places kept confidence at "Low" even after successful research:
1. **`src/lib/reconstruction-dossier.ts:13`** required **≥ 2** researched facts to reach "Medium", so a single high-quality search result left the dossier at "Low".
2. **`src/http-server.ts` `deriveResearchedFactsForReceipt`** blindly reported whatever `resolve_dish_name` returned (often "Low" for fuzzy matches) without considering that `search_web` had since produced real cited facts.

> Offending code (`src/lib/reconstruction-dossier.ts:13`):
> ```typescript
>   const confidence: Confidence = dedupedResearched.length >= 2 ? 'Medium' : 'Low';
> ```

> Offending code (`src/http-server.ts:927`):
> ```typescript
>   facts.push(`Dish resolved: "${resolved.canonicalName}" (confidence: ${resolved.confidence ?? 'unknown'}, region: ${resolved.region ?? 'unknown'})`);
>   // resolved.confidence is never boosted despite search_web results
> ```

### Edits Applied
1. **`src/lib/reconstruction-dossier.ts`** — Lowered threshold from `>= 2` to `>= 1`:
   ```typescript
   const confidence: Confidence = dedupedResearched.length >= 1 ? 'Medium' : 'Low';
   ```
2. **`src/http-server.ts`** — In `deriveResearchedFactsForReceipt`, when `resolved.confidence === 'Low'` but `search_web` results exist, override the reported confidence to `'Medium'`:
   ```typescript
   const hasResearchProduct = (searched?.results?.length ?? 0) > 0;
   const effectiveConfidence = (resolved.confidence === 'Low' && hasResearchProduct) ? 'Medium' : resolved.confidence;
   facts.push(`Dish resolved: "${resolved.canonicalName}" (confidence: ${effectiveConfidence ?? 'unknown'}, region: ${resolved.region ?? 'unknown'})`);
   ```

### Test Note
Query: *"my grandmother in Oaxaca made mole negro with chilhuacle chiles; I live in Des Moines, Iowa; what goes in it, where can I buy the chiles near me, and what can I substitute"*  
Look for the SSE `receipt` event: `evidence.researched` should contain a dish-resolution line with `confidence: Medium` (not `Low`) once `search_web` returns results, and the `build_reconstruction_dossier` tool output should show `confidence: Medium`.
