---
name: member-berries
description: Reverse engineer nostalgic dishes using locally available ingredients. Triggers on: food memory, nostalgic recipe, recreate dish, miss eating, home cooking, traditional food, heritage food.
---

# Member Berries

Culinary reverse engineering that recreates the **sensory triggers** of nostalgic dishes using locally available ingredients.

## When to Use

User describes a food they or their family miss from another place, time, or culture, and wants to recreate it with what's available now.

**Trigger patterns:**
- "My parents miss eating [dish] from [place]"
- "I want to recreate my grandmother's [dish]"
- "Can we reverse engineer [traditional food]"
- "I miss the taste of [childhood food]"
- "Help me find ingredients for [heritage recipe]"

## The Pipeline

```
1. COLLECT → Memory Interview
   Ask the user to describe the dish from memory:
   - What do they remember most vividly (smell, taste, texture)?
   - When/where did they eat it? Who made it?
   - What made it special? What happened when they ate it?
   - Can they describe the aroma? The texture? The aftertaste?

2. RESOLVE → Name Resolution
   Use the `resolve_dish_name` MCP tool to:
   - Map the name to its canonical dish family
   - Find all known aliases and transliterations
   - Identify the cultural region

3. RESEARCH → Web Research
   If the dish family is unfamiliar or regional details are sparse:
   - Use Exa to find authentic recipes from cultural sources
   - Use Brave to find technique videos and cultural context
   - Use Firecrawl to extract detailed recipes from trusted sites
   - Cache results using the research-cache for future users

4. DECOMPOSE → Sensory Analysis
   Use the `analyze_nostalgic_dish` MCP tool to:
   - Break the dish into 5 sensory dimensions
   - Score each dimension 1-10
   - Identify the 1-3 nostalgia-critical elements
   - These are the TARGET — everything else is secondary

5. SUBSTITUTE → Chemistry-Aware Substitution
   Use the `find_sensory_substitutes` MCP tool to:
   - Match ingredients by volatile compounds, not just names
   - Rank substitutes by compound overlap + sensory match
   - Prioritize substitutes that preserve nostalgia-critical elements

6. SOURCE → Ingredient Sourcing
   Use the `source_ingredients` MCP tool to:
   - Find local stores, ethnic markets near the user
   - Find online sources with pricing
   - Note seasonal availability

7. DISCOVER → Regional Connections
   Use the `discover_regional_similars` MCP tool to:
   - Find related dishes from neighboring cultures
   - Identify shared and divergent elements
   - Surface substitution opportunities from related cuisines

8. GENERATE → Final Recipe
   Use the `generate_recipe` MCP tool to:
   - Compose the complete adapted recipe
   - Include sensory analysis and confidence levels
   - Note what's different and why
   - Self-critique: does this actually recreate the target?

9. VALIDATE → Present to User
   Present the recipe with:
   - Full ingredients and steps
   - "The nostalgia trigger is [X]" — clear explanation
   - Confidence per element
   - Where to buy everything
   - Regional connections discovered
   - Ask: "Does this feel right? What would you adjust?"
```

## Key Principles

1. **Nostalgia-critical elements are sacred.** If a substitution kills a nostalgia trigger, it fails. Try harder.
2. **Start with the person, not the recipe.** The memory is the input. The recipe is the output.
3. **Chemistry over names.** "Cumin" and "caraway" are different. "Cumin" and "something with cuminaldehyde" is the right framing.
4. **Regional context matters.** A dish from Oaxaca is different from the same-named dish from Mexico City.
5. **Name resolution is critical.** The user will spell it wrong, use a colonial name, or describe it vaguely. Handle all of these gracefully.
6. **Self-critique before presenting.** Ask yourself: "If I served this to the person who remembers the original, would they recognize it?" If not, iterate.

## Output Format

```markdown
# [Dish Name] — Recreated

## The Nostalgia Trigger
[1-2 sentences identifying the key sensory element that carries the emotional connection]

## Ingredients
| Ingredient | Amount | Notes |
|-----------|--------|-------|
| [Item] | [Qty] | [Substitution note if applicable] |

## Instructions
1. [Step]

## Sensory Analysis
| Element | Target | Achieved | Confidence |
|---------|--------|----------|------------|
| [Aroma] | [Target description] | [How achieved] | High/Medium/Low |

## Where to Buy
- [Ingredient]: [Store name], [Address or URL]

## Regional Connections
- Similar to [dish] from [region]: [what's shared, what's different]

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
| Forgetting sourcing | A perfect recipe with unpurchasable ingredients is useless |
