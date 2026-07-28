# Achiote

Achiote is a Model Context Protocol (MCP) server for research-first food-and-drink memory reconstruction. Give it a fragment of a remembered dish, drink, name, place, smell, texture, or family ritual. Achiote structures the clues, plans evidence-led research, separates researched facts from inference and unknowns, and 

## Try it

```bash
The preferred stopping point is the **minimum viable nostalgia cue**: a cheap, accessible aroma, bite, sip, condiment, or ritual that tests whether the memory is on the right track. The host AI performs open-ended web research and writes final recipe prose; bundled data and the server do not pretend sparse clues are a family-confirmed answer or live inventory result.
The core workflow is exposed as 18 granular MCP tools in both audited lineages. All MCP tools return structured content; some also return concise display text for host clients.
## Install and use the shared MCP surface
Achiote is not published to npm at the audited revisions. No dependency-backed installation path is verified across both audited lineages.
The following build and stdio server commands are documented for both lineages; dependency-backed build and test remain unverifiable:
```

```bash
### Dependency-install note
No dependency-backed installation path is verified across both audited lineages:
- **GitHub `master`** — `npm ci --dry-run --ignore-scripts --offline` passed (exit 0), so its lockfile resolves in the local offline cache at the historical pre-remediation audit snapshot.
- **Forgejo `main`** — the documented `npm ci` path is blocked before installation by `EUSAGE`: `package.json` requests `@anthropic-ai/sdk` `^0.111.0`, while `package-lock.json` records `^0.105.0` and version `0.105.0`. Do not replace this with a lockfile-mutating install.
The exact historical pre-remediation audit snapshot branch surfaces are below. Do not assume that a branch-specific command exists on the other lineage.
## The two audited lineages
| Lineage | Historical pre-remediation audit snapshot (not current branch head) | Support surface at that snapshot |
|---|---|---|
| **GitHub `master`** | `e7f151992799ae011a0598e69fe8c6b8491ed690` | The shared 18-tool granular MCP server; the HTTP server’s `/ask` SSE route, `/mcp` transport, `/health`, voice routes, and its checked-in static product assets. This historical snapshot does **not** expose Forgejo’s productized `reconstruct_food_memory` MCP tool or `ask`/`purge` terminal CLI. |
| **Forgejo `main`** | `49a234e708f592db2bc3540014bdfd26d7114682` | The shared 18-tool granular MCP server plus the productized `reconstruct_food_memory` single-call MCP tool; the `ask`, `serve`/`mcp`, and `purge` CLI commands; the versioned `/v1/ask` HTTP API; and the `/ask` compatibility alias. Forgejo-only API contracts are documented as `docs/openapi.yaml` and `docs/openapi.json` in the Forgejo checkout; its retention details are documented as `docs/PRIVACY-RETENTION.md` there. |
This canonical README must remain byte-identical when placed in both audited source lineages. The two histories and implementation scopes are not interchangeable; branch-specific surfaces below are not universal claims.
## HTTP server surfaces
```

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/ROADMAP.md`](docs/ROADMAP.md)
- [`docs/LAUNCH_RUNBOOK.md`](docs/LAUNCH_RUNBOOK.md)
- [`docs/SELF_HOSTED_RUNNER.md`](docs/SELF_HOSTED_RUNNER.md)
- [`skill/SKILL.md`](skill/SKILL.md)

## License

See [LICENSE](LICENSE).
