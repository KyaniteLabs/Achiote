# Project Hardening Implementation Plan

**Goal:** Turn the current MCP scaffolding into a reliable, distributable, CI-ready TypeScript project with honest documentation and modern MCP contracts.

**Architecture:** Keep the project small and dependency-light: preserve the stdio MCP server, pure domain libraries, JSON-backed knowledge data, and SQLite cache. Harden the seams that make the project real: clean-checkout tests, package publishing boundaries, structured MCP outputs, cache path behavior, and documentation that matches implemented behavior.

**Tech Stack:** Node.js, TypeScript `NodeNext`, `@modelcontextprotocol/sdk`, Zod, `better-sqlite3`, Vitest, npm lockfile, GitHub Actions.

---

## Design summary

The initial MCP direction remains: a stdio MCP server that helps a host model reverse-engineer nostalgic dishes. This pass intentionally does not add external research providers or new dependencies. Instead, it upgrades the project from prototype scaffolding to a trustworthy base:

- MCP tools expose typed structured results; most retain JSON text for compatibility, while intake tools may show concise display text.
- Tool descriptions and server instructions clearly separate deterministic bundled analysis from host-model follow-up prompts.
- Runtime cache creation is safe in clean clones and configurable through environment variables.
- Tests run in clean checkouts and cover the actual MCP server registration path.
- Package metadata prevents accidental publication of runtime state.
- Remote best-practice files establish CI, Dependabot, security policy, and contribution paths.
- README and skill docs stop overclaiming live web/search behavior until provider adapters exist.

## Task 1: Baseline isolation and failing cache test

**Files:**
- Modify: `src/lib/research-cache.ts`
- Modify: `tests/research-cache.test.ts`
- Modify: `tests/mcp-tools.test.ts`

**Steps:**
1. Run `npm test` in a fresh worktree and capture the expected failure: cache tests fail when `data/` does not exist.
2. Add a focused ResearchCache test proving constructor creates parent directories.
3. Implement minimal parent-directory creation before `new Database(dbPath)`.
4. Move MCP cache integration tests to temp directories so they no longer depend on untracked `data/`.
5. Run `npm test`.

## Task 2: Modern MCP structured output contracts

**Files:**
- Modify: `src/index.ts`
- Create: `tests/mcp-server.test.ts`

**Steps:**
1. Write a failing in-memory MCP test expecting six tools and `structuredContent` on representative calls.
2. Export `createMemberBerriesServer()` from `src/index.ts` and only run stdio in CLI mode.
3. Replace deprecated `server.tool(...)` registrations with `server.registerTool(...)`.
4. Add `inputSchema`, `outputSchema`, `annotations`, and structured result helpers.
5. Keep text JSON output for backward compatibility.
6. Add safe startup shutdown/error behavior.
7. Run `npm test` and `npm run build`.

## Task 3: Package and repository hygiene

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `.github/workflows/ci.yml`
- Create: `.github/dependabot.yml`
- Create: `SECURITY.md`
- Create: `CONTRIBUTING.md`
- Create: `.github/pull_request_template.md`
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`

**Steps:**
1. Add a failing package metadata test for `files`, `bin`, `types`, `exports`, `repository`, `license`, `engines`, and quality scripts.
2. Add metadata and scripts without adding dependencies.
3. Add ignore rules for `.omx/`, `.omc/`, `.worktrees/`, runtime DB sidecars, coverage, and temp logs.
4. Add CI with `npm ci`, build, tests, audit, and pack dry-run.
5. Add Dependabot and basic repo governance docs.
6. Run `npm pack --dry-run --json` and verify runtime state is excluded.

## Task 4: Documentation truth and technical roadmap

**Files:**
- Modify: `README.md`
- Modify: `skill/SKILL.md`
- Create: `docs/ARCHITECTURE.md`
- Create: `docs/ROADMAP.md`

**Steps:**
1. Update README to describe current deterministic bundled capabilities honestly.
2. Document MCP setup, privacy/cache behavior, Node support, clean install, and limitations.
3. Update skill guidance so external web research providers are optional host capabilities, not bundled implementation.
4. Add architecture and roadmap docs with clear next steps for optional provider-data lookup support.
5. Run doc/package checks.

## Task 5: Final verification and commit

**Commands:**
- `npm ci --dry-run`
- `npm run typecheck`
- `npm run build`
- `npm test`
- `npm audit --audit-level=moderate`
- `npm pack --dry-run --json`
- MCP in-memory integration test via Vitest
- `git diff --check`

**Commit:**
Use the Lore protocol with a message explaining why this hardening pass was made, what constraints shaped the boundary, and exactly what was tested.
