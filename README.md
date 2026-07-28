# Achiote

Achiote is a **Model Context Protocol (MCP) server for research-first food-and-drink memory reconstruction**. Give it a fragment of a remembered dish, drink, name, place, smell, texture, or family ritual. Achiote structures the clues, plans evidence-led research, separates researched facts from inference and unknowns, and produces the smallest practical nostalgia cue before a fuller recipe handoff.

The workflow uses a minimum viable nostalgia cue to test whether the reconstructed memory is on the right track.

## Audit and authority boundary

This is one byte-identical README for two historical pre-remediation audit snapshots used for cross-lineage analysis, not a source-of-truth declaration or a deployment/release instruction. It does not establish GitHub `master` or Forgejo `main` as operational authority. Forgejo `main` is the intended productized lineage, but operational authority cannot be proven: audited deploy/release metadata still selects GitHub `master`, and Forgejo deployment guidance targets `origin/master`, which is absent from audited Forgejo `main`. The source-of-truth markers govern the separate public mirror `simongonzalezdc/achiote-food-memory-researcher`; they do not name either historical audit snapshot as authoritative. Use the two historical pre-remediation audit snapshot commit IDs—GitHub `master` `e7f151992799ae011a0598e69fe8c6b8491ed690` and Forgejo `main` `49a234e708f592db2bc3540014bdfd26d7114682`—for cross-lineage analysis; they are not current branch heads. Do not infer deployment authority from this README.

## The common workflow

Both audited Achiote lineages share the same research-first core:

```text
memory fragment
  -> collect memory and clues
  -> plan dish research
  -> optional host research and family clarification
  -> record and validate provenance
  -> build a reconstruction dossier
  -> generate the minimum viable nostalgia cue
  -> optional sensory, substitution, sourcing, and recipe handoff
```

The preferred stopping point is the **minimum viable nostalgia cue**: a cheap, accessible aroma, bite, sip, condiment, or ritual that tests whether the memory is on the right track. The host AI performs open-ended web research and writes final recipe prose; bundled data and the server do not pretend sparse clues are a family-confirmed answer or live inventory result.

The core workflow is exposed as 18 granular MCP tools in both audited lineages. All MCP tools return structured content; some also return concise display text for host clients.

## Install and use the shared MCP surface

Achiote is not published to npm at the audited revisions. No dependency-backed installation path is verified across both audited lineages.

The following build and stdio server commands are documented for both lineages; dependency-backed build and test remain unverifiable:

```bash
npm run build
node dist/index.js
```

Register the built stdio server in an MCP host such as Claude Code or Codex:

```json
{
  "mcpServers": {
    "achiote": {
      "command": "node",
      "args": ["/absolute/path/to/achiote/dist/index.js"]
    }
  }
}
```

The documented shared teaching-skill copy path is:

```bash
mkdir -p ~/.codex/skills/achiote
cp skill/SKILL.md ~/.codex/skills/achiote/SKILL.md
```

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

The HTTP server is optional on both lineages and is started after a successful build:

```bash
node dist/http-server.js
```

The following routes are common to both audited heads:

- `POST /ask` — authenticated SSE agent request.
- `/mcp` — authenticated streamable HTTP MCP transport.
- `GET /health` — health and runtime metrics.
- The checked-in static product routes under `docs/landing/`, including the landing page and app.

Authentication is enabled by default for the HTTP server. Provider-backed requests require the appropriate local environment configuration and may incur provider/network effects; no provider call is implied by starting the server.

**Forgejo-only API versioning:** `POST /v1/ask` is the canonical versioned route on Forgejo `main`; `POST /ask` is its backward-compatible alias. Do not use `/v1/ask` as a GitHub `master` command.

**GitHub-only qualification:** on the audited GitHub `master` head, `POST /ask` is the documented agent route; its HTTP implementation does not include Forgejo’s `/v1/ask` versioned route.

## Development and release checks

The following shared development and release commands are documented at both audited heads. The audit verified `npm run lint`, `npm run coverage:guard`, `npm run reference:coverage`, and `npm run validate:citations`; dependency-backed and packaging entries remain unverified:

```bash
npm run lint                   # dependency-free static checks
npm run coverage:guard         # dependency-free test-surface guard
npm run reference:coverage    # local reference-data coverage audit
npm run typecheck              # TypeScript no-emit check
npm run build                  # compile TypeScript
npm test                       # run the test suite
npm run check                  # local typecheck, static checks, coverage guards, build, and tests
npm run package:smoke          # packaged MCP CLI plus selected HTTP/public-asset smoke checks
npm run pack:check             # full package/release gate
npm audit --audit-level=moderate
npm run validate:citations     # citation check; performs network reads
npm pack --dry-run
```

`npm run package:smoke` is deliberately narrower than full route coverage: it packs the package, installs the tarball in a temporary project, checks the packaged MCP CLI, and probes the selected packaged HTTP and public-asset smoke paths. It does not prove that every route or every provider-backed behavior works.

`npm run check`, citation validation, `npm audit`, package installation, package smoke, and provider-backed examples may require dependency or network access. Keep those effects explicit in operator environments.

## Forgejo-only productized CLI

The following commands exist on the audited Forgejo `main` lineage after building. They are not commands of the audited GitHub `master` lineage:

```bash
node dist/index.js --help
node dist/index.js ask "My grandmother made a dish I remember by smell and texture"
node dist/index.js ask "A steamed food wrapped in leaves" --json
node dist/index.js purge                 # dry run; deletes nothing
node dist/index.js purge --yes           # destructive local-store deletion
```

The `ask` command uses the same workflow engine as Forgejo’s HTTP and single-call MCP surfaces and requires a configured model provider. `purge` is destructive only with `--yes`; inspect its target list with the default dry run first.

## Safety and privacy boundaries

Treat family food memories as sensitive. Achiote’s host prompts and evidence structures distinguish user-said material, researched facts, inference, and unknowns. Do not add browsing, scraping, geocoding, grocery inventory, price lookup, or live provider integrations without an explicit privacy/security design, recorded fixtures, and documented data flow.

Food safety and allergies take priority over reconstruction convenience. Achiote is not a medical, allergy, or nutritional advice system; users should use qualified professional guidance for safety decisions.

## Roadmap intent

The shared technical roadmap keeps the research-first boundary intact. Forward-looking work includes:

- narrow, opt-in structured food-data adapters with source citations, fetched-at timestamps, cache policy, and recorded fixtures;
- more item-level citations, cultural specificity, candidate disambiguation, and constraint-aware cue regressions; and
- a stronger minimum-cue and recipe-quality feedback loop with process-specific cue profiles, schema validation, self-critique, user feedback, and confidence decomposition.

These are roadmap intentions, not claims that either audited head already provides those future integrations or quality loops.

## Shared documentation references (not deployment authority)

The following documentation paths exist on both audited heads:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/ROADMAP.md`](docs/ROADMAP.md)
- [`docs/LAUNCH_RUNBOOK.md`](docs/LAUNCH_RUNBOOK.md)
- [`docs/SELF_HOSTED_RUNNER.md`](docs/SELF_HOSTED_RUNNER.md)
- [`skill/SKILL.md`](skill/SKILL.md)

Both lineages are licensed under the Business Source License 1.1; see `LICENSE` in the checkout.
