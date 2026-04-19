# Technical Roadmap

This roadmap is scoped to the MCP server and skill behavior only.

## Completed foundation

- Structured MCP outputs and output schemas
- Clean-checkout tests
- Package hygiene and CI
- Self-hosted CI runner documentation and branch protection
- Configurable private cache path
- Research-first memory workflow tools (`collect_food_memory`, `plan_dish_research`, dossier/family-question tools)
- Typed research provenance records and cache helpers
- End-to-end MCP regression from memory fragment to recipe-generation handoff

## Next: provider-backed research mode

Provider-backed research should be opt-in and privacy-documented. A strong implementation would include:

- provider interface for web/search/extraction adapters
- source citations and fetched-at timestamps
- cache writes with TTL and source metadata
- explicit offline mode
- tests with recorded fixtures, not live network flakiness
- copyright-safe extraction rules: store facts and citations, not copied recipe prose

## Next: data quality and cultural specificity

- Expand provenance/source fields in bundled food chemistry and cultural datasets
- Expand the first canonical dish plus regional variant model beyond the initial tortilla/egg-dish ambiguity slice
- Broaden multiple-candidate name resolution with scores and ambiguity flags across more overloaded names
- Move broad ingredient/research hint vocabulary into configurable data rather than code constants
- Add dietary/allergen/religious constraints to substitutions

## Later: recipe generation quality loop

- Add schema-validated final recipe output after host-model synthesis, plus tests that a host-provided recipe object satisfies the schema
- Add self-critique rubric around nostalgia-critical elements
- Add user feedback loop to update target sensory profile
- Add confidence decomposition per sensory element
