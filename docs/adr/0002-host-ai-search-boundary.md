# ADR 0002: Host-AI Search Boundary

## Status

Accepted.

## Context

The host AI can use web/search tools, but the Achiote MCP server must stay small, private, and auditable. Adding browsing, scraping, grocery lookup, geocoding, or live food-provider calls inside the server would expand privacy, legal, and operational risk.

## Decision

Achiote does not browse the web itself. It may structure search plans, validate host-supplied source facts, and use approved reference pantry records. Optional future provider integrations require explicit privacy/security design, legal source policy, and recorded fixtures before runtime use.

The database/reference pantry should reduce emergency search dependency, but it must not turn source-free generated text into fixture data.

## Consequences

- Reference population must cite allowed sources and preserve provenance.
- Knowledge-gap canaries should distinguish missing data from provider/control-flow failures.
- Public browser output should not claim live browsing unless the host actually performed it.
