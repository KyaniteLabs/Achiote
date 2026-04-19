---
name: member-berries
description: Reverse engineer nostalgic dishes using ingredients available where the user is. Triggers on: food memory, nostalgic recipe, recreate dish, miss eating, home cooking, traditional food, heritage food.
---

# Member Berries

Culinary reverse engineering that recreates the **sensory triggers** of nostalgic dishes using ingredients available where the user is.

## When to Use

User describes a food they or their family miss from another place, time, or culture, and wants to recreate it with what's available now.

**Trigger patterns:**
- "My parents miss eating [dish] from [place]"
- "I want to recreate my grandmother's [dish]"
- "Can we reverse engineer [traditional food]"
- "I miss the taste of [childhood food]"
- "Help me find ingredients for [heritage recipe]"

## The Conversation Flow

Member Berries is a food-memory reconstruction skill. The recipe is not the starting point; the user's fragment is the starting point.

```text
1. WELCOME → Normalize uncertainty
   Tell the user they do not need the correct spelling, original language, or complete recipe.
   Good: "Write it the way it sounded. Tiny clues are enough to start."

2. COLLECT → Food memory intake
   Use `collect_food_memory` to structure:
   - possible names or sound-alikes
   - family/cultural/region clues
   - remembered ingredients
   - smell, taste, texture, visual, occasion clues
   - missing information and gentle next questions

3. HYPOTHESIZE → Research plan, not certainty
   Use `plan_dish_research` to produce:
   - likely dish hypotheses
   - why each might fit
   - what would confirm or reject each
   - search queries and source types
   - facts to verify

4. CLARIFY → Ask 1-3 high-yield questions
   Ask only the questions most likely to separate hypotheses.
   Do not interrogate the user. Offer to continue with uncertainty if they do not know.

5. RESEARCH → Host research when available
   Use available host web/search tools to investigate names, regional variants, ingredients, techniques, and sensory cues.
   Treat sources as evidence, not gospel. Prefer community, regional, bilingual, recipe-with-context, and technique sources.

6. PROVENANCE → Convert sources into typed records
   Use `build_research_record` for host-researched source facts.
   Use `validate_research_record` before trusting the record downstream.
   Use `extract_research_findings` to pass researched facts, inferred signals, and unknowns into the dossier.

7. LEDGER → Separate evidence types
   Track every claim as one of:
   - User said
   - Researched
   - Inferred
   - Unknown / needs family confirmation

8. DOSSIER → Reconstruction artifact
   Use `build_reconstruction_dossier` to produce a food memory dossier with hypotheses, evidence, sensory priorities, and adaptation strategy.

9. FAMILY LOOP → Connection questions
   Use `generate_family_followup_questions` to give the user gentle questions to ask relatives.

10. MINIMUM VIABLE NOSTALGIA → Smallest sensory unit first
   Before a full recipe, use `generate_minimum_viable_nostalgia` to offer the smallest aroma, bite, sip, condiment, or ritual that can test the likely memory trigger.
   This is the preferred user-facing end step when the user wants something easy and emotionally close, not a full recreation.

11. RECREATE → Recipe only after enough grounding
   If the user wants a fuller dish and the likely dish/critical sensory triggers are clear, use the existing sensory/substitution/sourcing/recipe tools to prepare the recipe-generation handoff.
   The host AI writes the final recipe text from the structured context; the MCP server itself returns schemas, prompts, evidence, and constraints.
   If not clear, present a best-effort path and say exactly what is uncertain.
```

## Key Principles

1. **Uncertainty is sacred.** Do not pretend a fragment is resolved when research or family clarification is needed.
2. **Nostalgia-critical elements are sacred.** If a substitution kills a nostalgia trigger, it fails. Try harder.
3. **Start with the person, not the recipe.** The memory is the input. The recipe is the output.
4. **Chemistry over names.** "Cumin" and "caraway" are different. "Cumin" and "something with cuminaldehyde" is the right framing.
5. **Regional context matters.** A dish from Oaxaca is different from the same-named dish from Mexico City.
6. **Name resolution is critical.** The user will spell it wrong, use a colonial name, or describe it vaguely. Handle all of these gracefully.
7. **Self-critique before presenting.** Ask yourself: "If I served this to the person who remembers the original, would they recognize it?" If not, iterate.

## Output Format

For early/uncertain conversations, produce a dossier before a recipe:

```markdown
# Food Memory Dossier: [fragment]

## What You Told Me
- [user-said facts]

## Possible Matches
| Hypothesis | Why it might fit | What would confirm it | Confidence |
|-----------|-------------------|-----------------------|------------|

## Questions to Ask Family
1. [gentle high-yield question]

## Research Plan
- Search queries: [...]
- Source types to prefer: [...]
- Facts to verify: [...]

## Sensory Clues to Protect
- [aroma/texture/flavor/occasion clue]

## What We Still Don't Know
- [unknowns]
```

When enough evidence exists, continue into a recipe handoff:

```markdown
# [Dish Name] — Best-Effort Recreation

## Confidence and Evidence
- User said: [...]
- Researched: [...]
- Inferred: [...]
- Unknown: [...]

## The Nostalgia Trigger
[1-2 sentences identifying the key sensory element that carries the emotional connection]

## Ingredients
| Ingredient | Amount | Notes |
|-----------|--------|-------|

## Instructions
1. [Step]

## Sensory Analysis
| Element | Target | Achieved | Confidence |
|---------|--------|----------|------------|

## Minimum Viable Nostalgia Cue
- Smallest aroma/bite/ritual to try first
- What it preserves
- What it does not preserve

## Sourcing / Substitutions
- [Ingredient]: [static hint, host-researched source, or clearly labeled uncertainty]

## What's Different
- [Honest assessment of what won't match and why]
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Treating all elements equally | Identify the 1-3 nostalgia-critical elements FIRST |
| Generic ingredient substitution | Use compound matching, not name matching |
| Skipping the memory interview | The person's memory IS the spec — don't skip it |
| Ignoring regional variation | "Indian food" is meaningless — which region? which state? |
| Presenting without self-critique | Always validate before showing to the user |
| Forgetting sourcing provenance | Static regional hints are not live inventory; label what was actually verified |
