# Technical Roadmap (v0.2.0)

This roadmap is scoped to the MCP server, HTTP server, and skill behavior.

## Completed

### Foundation
- Structured MCP outputs and output schemas
- Clean-checkout tests
- Package hygiene and CI
- Self-hosted CI runner documentation and branch protection
- Configurable private cache path
- Research-first memory workflow tools (`collect_food_memory`, `plan_dish_research`, dossier/family-question tools)
- Typed research provenance records and cache helpers
- End-to-end MCP regression from memory fragment to recipe-generation handoff

### HTTP server and production hardening
- Optional HTTP server with web UI, landing page, and `/ask` SSE streaming endpoint
- Streamable HTTP MCP transport at `/mcp`
- Tiered API key authentication (`ACHIOTE_AUTH_ENABLED`, `ACHIOTE_API_KEYS`)
- Monthly calendar-window rate limiting (free/personal/pro/family/enterprise, with business as a legacy alias)
- SQLite-backed persistent rate limits (`ACHIOTE_RATE_LIMIT_DB`) with SHA-256 hashed keys
- `sanitizeForPrompt()` security — strips `<user_input>` tags, control characters, and JSON-wraps user values as inert data literals
- Body size limits (1MB) with proper 413 handling across `/ask` and `/mcp`
- `/health` endpoint with memory and uptime metrics
- CORS configuration via `ACHIOTE_ALLOWED_ORIGINS`
- Reverse proxy support (`ACHIOTE_TRUST_PROXY`, `X-Forwarded-For`)
- Multi-stage Dockerfile for containerized deployment
- Docker healthcheck and non-root runtime
- TLS/reverse proxy documentation (Caddy, nginx examples)
- `.env.example` documenting all environment variables
- Landing page with dark mode, scroll reveals, try-it widget, structured data, CSP headers
- Web UI (`app.html`) with SSE streaming chat, dark mode, suggestion buttons, API key input

### Data quality and validation
- DOI-validated food science references (12 mechanism areas)
- Automated citation validation in CI
- Regional matcher with input normalization
- Per-component cue decomposition with location-aware sourcing
- Validated memory hint vocabulary data
- Broad provenance metadata for bundled food chemistry and cultural datasets
- Dietary/allergen/religious constraint-aware minimum cues

## Next: optional food-data provider lookups

Open-ended web research should remain a host AI responsibility. Optional provider integrations should be narrow, opt-in, and privacy-documented structured lookups, such as ingredient-label or nutrition databases. A strong implementation would include:

- provider interface for structured food-data adapters
- source citations and fetched-at timestamps
- cache writes with TTL and source metadata
- tests with recorded fixtures, not live network flakiness
- copyright-safe extraction rules: store facts and citations, not copied recipe prose

## Next: data quality and cultural specificity

- Add item-level citations where sources are verified, rather than broad launch provenance
- Expand the first canonical dish plus regional variant model beyond the initial tortilla/egg-dish ambiguity slice
- Broaden multiple-candidate name resolution with scores and ambiguity flags across more overloaded names
- Expand constraint-aware cue regressions for additional allergy, texture, and accessibility interactions

## Later: minimum-cue and recipe quality loop

- Expand dish/process-specific minimum viable nostalgia cue profiles beyond the initial regression set
- Add schema-validated final recipe output after host-model synthesis, plus tests that a host-provided recipe object satisfies the schema
- Add self-critique rubric around nostalgia-critical elements
- Add user feedback loop to update target sensory profile
- Add confidence decomposition per sensory element
