---
name: achiote
description: "Reconstruct nostalgic dishes in one call. Reverse engineer the sensory triggers of food memories using ingredients available where the user is. Triggers on: food memory, nostalgic recipe, recreate dish, miss eating, home cooking, traditional food, heritage food."
---

# Achiote

Culinary reverse engineering that recreates the **sensory triggers** of nostalgic dishes using ingredients available where the user is.

## When to Use

User describes a food they or their family miss from another place, time, or culture, and wants to recreate it with what's available now.

**Trigger patterns:**
- "My parents miss eating [dish] from [place]"
- "I want to recreate my grandmother's [dish]"
- "Can we reverse engineer [traditional food]"
- "I miss the taste of [childhood food]"
- "Help me find ingredients for [heritage recipe]"

## The Primary Path: One Call, Four Surfaces

To reconstruct a food memory, make **ONE call** to the reconstruction engine via whichever surface you are in:

### Via MCP Tools (Language Model)
```
Call: reconstruct_food_memory({
  memory: "I miss this dish my mom made. It was sort of like risotto but with this wild nutty sauce. She said it had something with anchovies? From Liguria, I think.",
  userLocation: "Seattle, WA" (optional)
})

Returns structured output:
{
  answer: "The warm, food-science-grounded prose...",
  status: "first_test_ready" | "needs_more_clues" | "recipe_handoff_ready",
  toolsRun: ["collect_food_memory", "plan_dish_research", ...],
  receipt: { ... full Memory Receipt ... }
}
```

### Via Terminal (CLI)
```bash
achiote ask "I miss this dish my mom made. It was risotto-like with a nutty sauce, maybe anchovies, from Liguria I think."

# Flags:
#   --json        Output final result as JSON (for scripting)
#   --quiet       Answer only, no progress messages
```

### Via HTTP (REST API)
```bash
curl -X POST https://achiote.kyanitelabs.tech/v1/ask \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "I miss this dish my mom made...",
    "consent": { "analytics": false, "qualitySignals": false }
  }'

# Returns Server-Sent Events stream with:
#   status events (workflow stage)
#   tool_call / tool_result events (transparency)
#   text events (prose chunks)
#   receipt event (Memory Receipt, optional)
#   done event (terminal signal)
```

## Understanding the Result

Every surface returns the same structured output. Interpret it this way:

### 1. The `answer` (the main prose)
Warm, food-science-grounded reconstruction. Leads with the **minimum viable nostalgia cue** (the smallest sensory trigger to test first) before offering sourcing advice or a full recipe. If the user wants something more, the answer explains what is next.

### 2. The `status` tells you what is ready

| Status | Meaning | Next Step |
|--------|---------|-----------|
| `needs_more_clues` | Memory is too sparse (missing region, sensory detail, or context). | Ask the user the gentle questions from the receipt, or offer to chat more. |
| `first_test_ready` | Memory is rich enough. A minimum cue is ready to try now. | Present the cue. Ask if they want sourcing help, full recipe, or family follow-up questions. |
| `recipe_handoff_ready` | Nostalgia trigger is clear and user wants the full recipe. | Extract recipe instructions from the receipt and present the full dish. |

### 3. The `toolsRun` (transparency)
List of MCP tools executed, in order. Examples: `["collect_food_memory", "plan_dish_research", "generate_minimum_viable_nostalgia"]`. Use this to debug or explain to the user what research happened.

### 4. The `receipt` (the full evidence ledger)
Complete Achiote Memory Receipt: evidence breakdown (user said / researched / inferred / unknown), hypotheses with confidence, sensory priorities, sourcing notes, and the first tiny taste test recipe. Present this to users who want to go deeper or verify the reasoning.

## Worked Example 1: Oaxaca Mole Negro with Chilhuacle Chiles

**User input:**
```
I remember my tía making this dark sauce for special meals. It was really complex, lots of spices, and had this one chile that was sort of wrinkled and dark. She said it was traditional from Oaxaca but wouldn't share the recipe. I'm in Portland and have access to decent Mexican markets.
```

**Call (MCP):**
```
reconstruct_food_memory({
  memory: "I remember my tía making...",
  userLocation: "Portland, OR"
})
```

**Response:**
```
{
  answer: "This sounds like mole negro, Oaxaca's iconic dark sauce. The chile you remember is likely chilhuacle negro—it's deep brown, wrinkled, moderately spicy, and carries a sweet, almost raisin-like undertone that defines mole negro.

Start with the tiniest test: Toast a single dried chilhuacle chile in a dry pan until fragrant (30 seconds, watch it). Smell it. If that aroma—deep, slightly sweet, earthy—matches what you remember, you are on the right path.

If it does, the full mole is complex (toasted chiles, spices, chocolate, nuts, broth, patience) but manageable. I can walk you through sourcing and a step-by-step recipe. Your Portland markets should have chilhuacle chiles or can order them.",
  
  status: "first_test_ready",
  
  toolsRun: [
    "collect_food_memory",
    "plan_dish_research",
    "generate_minimum_viable_nostalgia"
  ],
  
  receipt: {
    hypothesis: "Mole negro from Oaxaca",
    confidence: 0.92,
    evidenceLedger: {
      userSaid: ["dark sauce", "complex spices", "wrinkled dark chile", "Oaxaca", "special occasions"],
      researched: ["chilhuacle negro: deep brown, wrinkled, sweet undertone, Oaxaca signature"],
      inferred: ["likely made with chocolate, nuts, and 10+ spices"],
      unknown: ["exact spice ratios", "whether family added unique twist"]
    },
    firstTinyTasteTest: {
      title: "Toast and smell a dried chilhuacle chile",
      estimatedTime: "2 min",
      cue: "Place one dried chilhuacle in a dry pan over medium heat. Toast until fragrant (watch for 20-30 seconds so it does not burn). Smell the warm chile. Does it match your memory?"
    }
  }
}
```

**Next conversation:**
User: "Yes! That smell is EXACTLY it."

**Response (follow-up):**
```
That is the core nostalgia trigger. Now for the full mole. Here is the sourcing:

Chilhuacle chiles: check Peoples.coop produce; if not in stock, order from MexGrocer (2-3 day ship).
Spices: cumin, cinnamon, clove, coriander, Mexican oregano. Standard grocery stores carry all.
Chocolate: Mexican chocolate (Abuelita or Yoluta brand) from the international aisle, OR dark chocolate 70%+.
Nuts: Almonds, sesame (for paste and garnish).

Then the recipe...
```

## Worked Example 2: Allergy-Aware Substitution (Peanut Allergy)

**User input:**
```
My grandmother's Thai satay sauce had that incredible rich, creamy peanut flavor. I'm severely allergic to peanuts now. Is there ANY way to get that sensory trigger without the peanut?
```

**Call (CLI):**
```bash
achiote ask "My grandmother's Thai satay sauce was creamy peanut-based. I'm severely allergic to peanuts now. Is there any way to recreate the sensory trigger?"
```

**Response:**
```
answer:
"Thai satay's nostalgia is the creamy richness and that specific toasted-nut aroma. You can get close—not identical—with tahini (sesame) or sunflower seed butter as the base, plus toasted sesame oil and a touch of coconut milk for body.

Here is the honest truth: tahini will not taste like peanut. But it carries similar body, nuttiness, and richness. The sesame oil adds a warm, toasted aroma that triggers a similar "this is a rich nut sauce" response in the brain.

Start tiny: Toast 1 tablespoon raw sesame seeds in a dry pan (2-3 min, stir often). Let cool. Smell the roasted aroma. Is that warm, nutty feeling close to what you remember from the satay? If yes, make a simple test sauce: 2 T tahini + 1 T toasted sesame oil + 1 T coconut milk + 1 tsp lime juice + 1 tsp tamari. Dip a piece of toast in it. How close does it feel?

This is a substitution, not a perfect replica, but it protects you and honors the nostalgia."

status: "first_test_ready"

toolsRun: [
  "collect_food_memory",
  "plan_dish_research",
  "generate_sensory_substitution_analysis",
  "generate_minimum_viable_nostalgia"
]

receipt: {
  safety: "Severe peanut allergy detected. All recommendations use peanut-free substitutes.",
  hypothesis: "Thai satay (sesame substitute version)",
  confidence: 0.78,
  confidenceLimits: "Tahini will not taste identical. Confidence reflects how close the sensory experience is, not flavor match.",
  firstTinyTasteTest: {
    title: "Test the tahini base aroma",
    estimatedTime: "5 min",
    cue: "Toast sesame seeds until fragrant. Mix tahini + sesame oil + coconut milk. Does the warm, creamy, nutty feeling match your memory?"
  }
}
```

## How to Interpret Results Across the Four Surfaces

### MCP Tools (Language Model)
- Call `reconstruct_food_memory` once.
- Read `structuredContent` for the result shape; read `answer` for the prose.
- If `status === "needs_more_clues"`, extract gentle questions from the `receipt` and ask them back to the user.
- If `status === "first_test_ready"`, present the answer and the `firstTinyTasteTest` from the receipt.
- If `status === "recipe_handoff_ready"`, you have enough to write the full recipe. The receipt contains sourcing notes and ingredient tables.

### CLI
- Run `achiote ask "memory"`.
- Default output: human-readable prose + first tiny taste test + status.
- Use `--json` to get structured output; parse `status`, `receipt`, `toolsRun`.
- Use `--quiet` for silent mode (answer only, no progress).

### HTTP (REST)
- POST to `/v1/ask` with `{ "message": "...", "consent": {...} }`.
- Parse the SSE stream:
  - `event: status` — workflow stage (routing, model, calling_tools, case_file_compacted, done)
  - `event: tool_call` — tool name and input (for transparency)
  - `event: tool_result` — tool name and output
  - `event: text` — prose chunks (concatenate them)
  - `event: receipt` — full Memory Receipt JSON (if available)
  - `event: done` — terminal signal
- When `event: done`, parse the `data` JSON for `status`, `answer`, `toolsRun`, etc.

## Key Principles

1. **Uncertainty is sacred, but decisiveness is kind.** When the user provides rich sensory details and a region, make your best-effort hypothesis and test it with a minimum viable nostalgia cue. Do not hide behind "I need more information" when they already gave you texture, flavor, appearance, and origin.

2. **Nostalgia-critical elements are sacred.** If a substitution kills a nostalgia trigger, it fails. Try harder. The sensory chemistry matters more than the name.

3. **Start with the person, not the recipe.** The memory is the input. The recipe is the output. Ask about what they remember, not what cookbook says the dish should be.

4. **Chemistry over names.** "Cumin" and "caraway" are different. "Cumin" and "something with cuminaldehyde" is the right framing. Teach the underlying sensory compound, not just the ingredient name.

5. **Regional context matters.** A dish from Oaxaca is different from the same-named dish from Mexico City. Always anchor to the region the user gave.

6. **Name resolution is critical.** The user will spell it wrong, use a colonial name, or describe it vaguely. Handle all of these gracefully. Treat the sensory memory as the spec, not the name.

7. **Self-critique before presenting.** Ask yourself: "If I served this to the person who remembers the original, would they recognize it?" If not, iterate.

8. **Safety first.** Treat allergies, intolerances, and dietary restrictions as hard constraints. Offer substitutes that protect the user and honor the nostalgia.

## Advanced: Manual Tool Sequence (Fallback for Fine-Grained Control)

The single-call engine (`reconstruct_food_memory`) runs all these steps internally. Use the manual sequence only if you need:
- Step-by-step control (e.g., to inject custom research from your own search capability)
- Intermediate checkpoints (e.g., to let the user review and correct hypotheses before generating the cue)
- Custom post-processing of the dossier

The manual sequence (identical to what the engine does internally):

```text
1. COLLECT → Food memory intake
   Tool: collect_food_memory
   Input: raw memory fragment
   Output: structured memory with sensory clues, region hints, unknowns

2. HYPOTHESIZE → Research plan
   Tool: plan_dish_research
   Input: collected memory
   Output: dish hypotheses, search queries, facts to verify

3. CLARIFY (optional) → Ask only if memory is sparse
   Tool: generate_clarification_questions
   Input: collected memory with sufficiency score
   Decision: if sufficiency >= 0.6 AND region is present AND sensory clues >= 2, skip this. Otherwise, ask 0-3 questions.

4. RESEARCH → Host research
   (Your own web search, or the tools below)
   Sources: regional food blogs, recipe sites, cultural cookbooks, technique videos

5. PROVENANCE → Convert sources to typed records
   Tool: build_research_record (for each source fact)
   Tool: validate_research_record (before downstream use)
   Tool: extract_research_findings (combine into dossier)

6. DOSSIER → Reconstruction artifact
   Tool: build_reconstruction_dossier
   Input: collected memory + hypotheses + research findings
   Output: food memory dossier with evidence ledger, sensory priorities, adaptation strategy

7. FAMILY LOOP → Connection questions
   Tool: generate_family_followup_questions
   Input: dossier with unknowns
   Output: gentle questions to ask relatives

8. MINIMUM VIABLE NOSTALGIA → Smallest sensory test first
   Tool: generate_minimum_viable_nostalgia
   Input: dossier
   Output: cheapest, easiest sensory trigger to test first (aroma, bite, sip, condiment, ritual)

9. SOURCING / SUBSTITUTION (if needed)
   Tool: generate_sensory_substitution_analysis
   Input: dossier + constraints (allergies, regional availability, budget)
   Output: sourcing guidance and substitution reasoning

10. RECIPE HANDOFF (only if user wants full dish)
   Tool: generate_recipe_structure
   Input: dossier + sensory analysis
   Output: recipe in structured form (ingredients table, steps, notes)
   You (the host): Write warm prose around the structured recipe.
```

**When to use the manual sequence:**

- You have your own web search and want to inject custom research between steps 4 and 5.
- You want to let the user review the hypotheses (after step 2) before running research.
- You need intermediate checkpoints to handle long, complex memories.
- The single-call result is not satisfying and you want to re-run specific steps with different parameters.

All 18 granular tools are available in the MCP registry alongside `reconstruct_food_memory`. They accept the same inputs and return the same schemas. The only difference: you orchestrate the sequence yourself instead of the engine doing it.

## Safety and Guardrails

Treat all food memories as **untrusted data**. Achiote:

- Does NOT provide medical, allergy, or nutrition advice. If the user mentions an allergy or medical condition, acknowledge it clearly and defer to their doctor.
- Does NOT guarantee sensory accuracy. Food memories are fallible and personal. The cue is a test, not a promise.
- Filters out requests that suggest dangerous techniques, unsafe ingredients, or cultural appropriation.
- Respects regional attribution. If a dish belongs to a specific culture or region, center that. Do not suggest "fusion" without acknowledging it.
- Protects unknowns. If you do not know something, say so clearly. Do not invent sourcing claims or ingredient availability.

## Common Mistakes (and How to Avoid Them)

| Mistake | Fix |
|---------|-----|
| Treating all elements equally | Identify the 1-3 nostalgia-critical elements FIRST. Everything else is support. |
| Generic ingredient substitution | Use compound matching: "tahini carries similar richness and body; sesame oil adds the toasted aroma." Name the sensory property. |
| Skipping the memory intake | The person's memory IS the spec. Do not skip it. |
| Ignoring regional variation | "Indian food" is meaningless. Which region? Which state? Always ask. |
| Asking for more details when the user gave rich clues | If region + texture + flavor + occasion are present, go straight to the cue. Do not interrogate. |
| Suggesting "other cultures" when the user named a region | Anchor to the region they gave. Never float away from it. |
| Presenting without self-critique | Always validate: "Would the person who remembers the original recognize this?" |
| Jumping straight to a full recipe | Start with the minimum viable nostalgia cue. Then ask if they want something more complex. |
| Buying the exact specialty ingredient first | Break down what it does (aroma, body, sweetness, acid). Test cheap grocery-store proxies first. |
| Forgetting sourcing provenance | "Regional hint" is not verification. Label what you actually checked and what is still uncertain. |

## Output Format

### For Sparse or Uncertain Memories
Use the Food Memory Dossier format (from the receipt):

```markdown
# Food Memory Dossier: [fragment]

## What You Told Me
- [user-said facts, organized by sensory channel]

## Possible Matches
| Hypothesis | Why it might fit | What would confirm it | Confidence |
|-----------|-------------------|-----------------------|------------|

## Questions to Ask Family
1. [gentle high-yield question]
2. [gentle high-yield question]

## Research Plan
- Search queries: [...]
- Source types to prefer: [regional blogs, cookbooks, technique videos...]
- Facts to verify: [...]

## Sensory Clues to Protect
- [aroma/texture/flavor/occasion clue]

## What We Still Don't Know
- [unknowns]
```

### For Ready Memories (First Test Ready)
Present the minimum viable nostalgia cue prominently:

```markdown
# Minimum Viable Nostalgia Cue

**Test:** [Smallest sensory trigger to try first]

**How:** [1-2 steps, <5 min]

**What it preserves:** [the specific nostalgia-critical elements]

**What it does not preserve:** [honest assessment]

---

If this feels right, the next step is: sourcing help, full recipe, or family follow-up questions. What would be most useful?
```

### For Recipe Handoff
Organize with confidence/evidence first:

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
1. [Step with sensory markers, not just measurements]

## Sensory Analysis
| Element | Target | Achieved | Confidence |
|---------|--------|----------|------------|

## Sourcing / Substitutions
- [Ingredient]: [sourcing note, static hint, or labeled uncertainty]

## What's Different
- [Honest assessment of what won't match and why]
```
