# Roadmap

## Now: trustworthy local MCP base

- Structured MCP outputs and output schemas
- Clean checkout tests
- Package hygiene and CI
- Honest docs about current local/static behavior
- Configurable private local cache path

## Next: data quality and cultural specificity

- Add JSON schemas for data files and validate them in tests
- Add source/provenance fields to food chemistry and cultural datasets
- Split broad families into canonical dish plus regional variants
- Return multiple name-resolution candidates with scores and ambiguity flags
- Add dietary/allergen/religious constraints to substitutions

## Later: provider-backed research mode

Provider-backed research should be opt-in and privacy-documented. A strong implementation would include:

- provider interface for web/search/extraction adapters
- source citations and fetched-at timestamps
- cache writes with TTL and source metadata
- explicit offline mode
- tests with recorded fixtures, not live network flakiness

## Later: recipe generation quality loop

- Add schema-validated final recipe output
- Add self-critique rubric around nostalgia-critical elements
- Add user feedback loop to update target sensory profile
- Add confidence decomposition per sensory element
