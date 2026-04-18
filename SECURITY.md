# Security Policy

## Supported versions

Member Berries is pre-1.0. Security fixes target the current `master` branch until release branches exist.

## Reporting a vulnerability

Please do not open public issues for vulnerabilities. Report privately to the repository owner with:

- affected commit/version
- reproduction steps or MCP inputs
- expected impact
- whether credentials, local paths, or private user food-memory data are exposed

## Security model

Member Berries is a local stdio MCP server. It does not expose an HTTP listener and does not perform live web requests in the current implementation. Primary risks are:

- prompt-injection through user-provided memories or ingredient/location fields passed to host-model prompts
- local cache privacy and filesystem permissions
- accidental publication of local runtime state
- supply-chain risk from npm dependencies and native `better-sqlite3`

## Maintainer checklist

- Keep GitHub secret scanning/push protection and code scanning enabled when available.
- Require CI before merging to the default branch.
- Run `npm audit --audit-level=moderate` before releases.
- Run `npm pack --dry-run` and inspect package contents before publishing.
