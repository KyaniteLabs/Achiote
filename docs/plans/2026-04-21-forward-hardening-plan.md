# Forward hardening plan

This plan tracks the remaining launch-hardening work by ROI and leverage after the P0/P1/P2 launch-readiness passes.

## Highest ROI next checks

1. Keep public deployment metadata honest until DNS and hosting are live.
2. Keep HTTP auth, rate limiting, and readiness behavior covered by tests before each release.
3. Keep recipe and research provenance validation fail-closed; do not let host-model prose bypass structured checks.
4. Keep static sourcing guidance clearly labeled as static sourcing guidance, not live inventory.
5. Keep self-hosted runbooks executable with key generation, package smoke, and Docker smoke helpers.

## unknown unknowns to keep probing

- Real reverse-proxy behavior under TLS termination and multiple client IPs.
- Long-running Streamable HTTP MCP session behavior under idle clients and abrupt disconnects.
- Culturally overloaded dish names that are not yet represented in bundled data.
- Accessibility constraints that interact with nostalgia-critical texture or aroma cues.
- Package-manager and native `better-sqlite3` install failures on less common platforms.

## Lower-risk backlog

- Add real line/branch coverage when the repo allows a coverage provider dependency.
- Expand bundled cultural and ingredient datasets with source metadata.
- Add recorded fixtures for any future provider integrations.
- Periodically review launch copy for overpromising beyond MCP/server boundaries.
