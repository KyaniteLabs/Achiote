# Example: Puerto Rican food-memory fragment

This is a runnable conversation example for the skill/MCP flow. It is not a hardcoded source of culinary truth; it demonstrates how the agent should behave when the user has a fragment.

## User starts

> My mom said my Puerto Rican grandma made something that sounded like pass-teh-lay. I don't speak Spanish. Maybe plantains or pork?

## Expected agent behavior

1. Reassure the user that spelling/language gaps are okay.
2. Call `collect_food_memory`.
3. Call `plan_dish_research`.
4. Explain likely hypotheses without certainty:
   - pasteles
   - pastelón
   - piononos
5. Ask no more than three clarifying questions:
   - Was it wrapped in leaves, layered like a casserole, fried, or served another way?
   - Was the texture more like soft masa, sweet plantain, or crispy fried edges?
   - Was it tied to Christmas/holidays or a particular relative?
6. If the user answers, continue research/adaptation. If not, build a best-effort `build_reconstruction_dossier` and label unknowns.

## What the example proves

- The MCP/skill flow can start from a misspelled or sound-alike family memory.
- It does not shame the user for not speaking the language.
- It does not pretend certainty.
- It generates research paths and family questions before recipe generation.
