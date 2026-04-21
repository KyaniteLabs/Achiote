# Launch Remediation Implementation Plan

**Goal:** Make Achiote launch-ready for public npm/package use, hosted HTTP/API use, and future feature work without reintroducing integration drift.

**Architecture:** Keep the MCP stdio server as the primary trusted core, and make HTTP, package, Docker, and deployment surfaces thin consumers of shared contracts. Reduce duplicated tool definitions, harden production boundaries, and promote live deployment checks from ad hoc scripts into repeatable release gates.

**Tech Stack:** TypeScript, Node.js 22+, MCP SDK, Anthropic SDK, better-sqlite3, Zod, Vitest, Docker, GitHub Actions, npm.

---

## Launch definition

Achiote is launch-ready only when all of these are true:

1. `npm install` from the intended package name works in a clean project.
2. The stdio MCP server lists and executes all tools from the installed package.
3. The HTTP server runs behind a real HTTPS reverse proxy with correct auth, rate limits, readiness, and CORS.
4. A real `/ask` request with a real `ANTHROPIC_API_KEY` completes the tool loop and returns a minimum viable nostalgia cue before any recipe handoff.
5. DNS and canonical metadata point at the real live domain.
6. CI, package smoke, Docker smoke, and release docs all prove the same artifact shape.
7. Future agents cannot accidentally diverge the MCP and HTTP tool surfaces.

---

## Phase 0: freeze the current launch baseline

### Task 0.1: Record current verified baseline

**Files:**
- Create: `docs/plans/2026-04-21-launch-readiness-baseline.md`

**Step 1: Write the baseline document**

Record:
- current commit: `git rev-parse HEAD`
- latest master CI URL
- current package status: npm unpublished
- current DNS status: `achiote.app` unresolved
- commands already known to pass: `npm run check`, `npm run package:smoke`, `npm audit --audit-level=moderate`, `npm pack --dry-run`, `npm run docker:smoke`
- remaining unverified external dependencies: real Anthropic `/ask`, DNS/HTTPS, npm publish

**Step 2: Verify no hidden local changes**

Run:

```bash
git status -sb
git rev-parse HEAD
DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name')
gh run list --branch "$DEFAULT_BRANCH" --limit 3 --json databaseId,headSha,status,conclusion,url
```

Expected:
- local branch is clean against `origin/$DEFAULT_BRANCH`
- HEAD equals the latest green CI head SHA for the repository default branch

**Step 3: Commit**

```bash
git add docs/plans/2026-04-21-launch-readiness-baseline.md
git commit -m "Document verified launch readiness baseline"
```

---

## Phase 1: remove MCP/HTTP tool drift risk

### Task 1.1: Add failing registry parity tests

**Files:**
- Create: `tests/tool-registry.test.ts`
- Modify later: `src/tools/tool-registry.ts`

**Step 1: Write failing tests**

Test that one registry is the source of truth for:
- all tool names
- MCP output schemas
- HTTP Anthropic tool definitions
- executor dispatch

Sketch:

```ts
import { describe, expect, it } from 'vitest';
import { toolRegistry } from '../src/tools/tool-registry.js';

describe('tool registry', () => {
  it('contains the complete launch tool set in sorted order', () => {
    expect(toolRegistry.map((tool) => tool.name).sort()).toEqual([
      'analyze_nostalgic_dish',
      'build_reconstruction_dossier',
      'build_research_record',
      'collect_food_memory',
      'discover_regional_similars',
      'extract_research_findings',
      'find_sensory_substitutes',
      'generate_family_followup_questions',
      'generate_minimum_viable_nostalgia',
      'generate_recipe',
      'plan_dish_research',
      'resolve_dish_name',
      'source_ingredients',
      'validate_recipe_output',
      'validate_research_record',
    ]);
  });

  it('requires every tool to define MCP metadata, HTTP metadata, output schema, and executor', () => {
    for (const tool of toolRegistry) {
      expect(tool.name).toBeTruthy();
      expect(tool.mcp).toBeTruthy();
      expect(tool.anthropic).toBeTruthy();
      expect(tool.outputSchema).toBeTruthy();
      expect(typeof tool.execute).toBe('function');
    }
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- tests/tool-registry.test.ts
```

Expected: fail because `src/tools/tool-registry.ts` does not exist.

### Task 1.2: Extract shared tool registry

**Files:**
- Create: `src/tools/tool-registry.ts`
- Modify: `src/server.ts`
- Modify: `src/http-server.ts`
- Modify: `scripts/package-smoke.mjs`
- Modify: `tests/mcp-server.test.ts`

**Step 1: Implement minimal registry**

Registry type should include:

```ts
export type AchioteToolExecutionContext = {
  cache: ResearchCache | null;
  sensoryProfilesData: typeof sensoryProfilesData;
  dishFamiliesData: typeof dishFamiliesData;
};

export type AchioteToolDefinition = {
  name: string;
  mcp: {
    title: string;
    description: string;
    inputSchema: Record<string, unknown>;
    outputSchema: ZodTypeAny;
  };
  anthropic: Anthropic.Tool;
  outputSchema: ZodTypeAny;
  execute(input: unknown, context: AchioteToolExecutionContext): unknown | Promise<unknown>;
};
```

**Step 2: Move current tool definitions**

Move the duplicated logic from:
- `src/server.ts` tool registration bodies
- `src/http-server.ts` `TOOLS`
- `src/http-server.ts` `executeTool()`

into the registry.

**Step 3: Keep protocol wrappers thin**

`src/server.ts` should only:
- create context
- iterate `toolRegistry`
- call `server.registerTool(...)`
- wrap success/error with `structuredJsonResult` / `toolError`

`src/http-server.ts` should only:
- expose `const TOOLS = toolRegistry.map(tool => tool.anthropic)`
- call registry executor by name
- validate output schema

**Step 4: Run focused tests**

```bash
npm test -- tests/tool-registry.test.ts tests/mcp-server.test.ts tests/reconstruction-flow-e2e.test.ts tests/http-server.test.ts
```

Expected: all pass.

**Step 5: Run full gate**

```bash
npm run check
npm run package:smoke
npm audit --audit-level=moderate
npm pack --dry-run
git diff --check
```

**Step 6: Commit**

```bash
git add src/tools/tool-registry.ts src/server.ts src/http-server.ts scripts/package-smoke.mjs tests/tool-registry.test.ts tests/mcp-server.test.ts
git commit -m "Consolidate tool definitions behind a shared registry"
```

---

## Phase 2: prove real hosted `/ask` behavior

### Task 2.1: Add an opt-in live Anthropic smoke script

**Files:**
- Create: `scripts/live-ask-smoke.mjs`
- Modify: `package.json`
- Test: `tests/package-metadata.test.ts`

**Step 1: Write package metadata test first**

Add expectations:

```ts
expect(pkg.scripts['live:ask']).toBe('node scripts/live-ask-smoke.mjs');
expect(fs.existsSync('scripts/live-ask-smoke.mjs')).toBe(true);
```

Run:

```bash
npm test -- tests/package-metadata.test.ts
```

Expected: fail.

**Step 2: Implement script**

Script behavior:
- fail clearly if `ANTHROPIC_API_KEY` is missing
- start `dist/http-server.js` on a random local port
- set `ACHIOTE_AUTH_ENABLED=false`
- set temp `ACHIOTE_CACHE_PATH` and `ACHIOTE_RATE_LIMIT_DB`
- call `/ready`
- call `/ask` with one memory fragment
- require `event: text` and `event: done`
- fail if `event: error` appears
- print first 500 chars of returned text for inspection
- terminate with SIGTERM and ensure clean exit

**Step 3: Add script**

```json
"live:ask": "node scripts/live-ask-smoke.mjs"
```

**Step 4: Run without key to verify safe failure**

```bash
npm run live:ask
```

Expected: nonzero exit with clear `ANTHROPIC_API_KEY is required` message.

**Step 5: Run with real key in secrets environment**

```bash
ANTHROPIC_API_KEY=... npm run live:ask
```

Expected:
- `/ready` 200
- `/ask` emits text
- `/ask` emits done
- no error event

**Step 6: Commit**

```bash
git add scripts/live-ask-smoke.mjs package.json tests/package-metadata.test.ts
git commit -m "Add opt-in live ask smoke test"
```

---

## Phase 3: make HTTP production security explicit

### Task 3.1: Make anonymous `/ask` a separate opt-in

**Files:**
- Modify: `src/http-server.ts`
- Modify: `src/lib/http-runtime.ts`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `SECURITY.md`
- Test: `tests/ask-endpoint.test.ts`
- Test: `tests/http-edge-cases.test.ts`

**Step 1: Add failing tests**

Add tests proving:
- `AUTH_ENABLED=false` alone does not allow `/ask`
- `AUTH_ENABLED=false` plus `ACHIOTE_ALLOW_ANON_ASK=true` allows pre-model request validation paths
- `/mcp` local demo can still work if desired

Expected test names:

```ts
it('requires explicit ACHIOTE_ALLOW_ANON_ASK for anonymous /ask')
it('allows anonymous /ask only when ACHIOTE_ALLOW_ANON_ASK=true')
```

**Step 2: Run tests to verify fail**

```bash
npm test -- tests/ask-endpoint.test.ts tests/http-edge-cases.test.ts
```

**Step 3: Implement env flag**

Add:

```ts
const ALLOW_ANON_ASK = process.env.ACHIOTE_ALLOW_ANON_ASK === 'true';
```

In `/ask`, reject anonymous if auth disabled but anon ask not explicitly enabled.

**Step 4: Update docs**

Document:
- `ACHIOTE_AUTH_ENABLED=false` is local protocol/demo only
- public `/ask` should require keys
- `ACHIOTE_ALLOW_ANON_ASK=true` is dangerous and only for local demos

**Step 5: Verify**

```bash
npm run check
```

**Step 6: Commit**

```bash
git add src/http-server.ts src/lib/http-runtime.ts .env.example README.md SECURITY.md tests/ask-endpoint.test.ts tests/http-edge-cases.test.ts
git commit -m "Require explicit opt-in for anonymous ask access"
```

### Task 3.2: Add trusted proxy enforcement

**Files:**
- Modify: `src/lib/http-runtime.ts`
- Modify: `src/http-server.ts`
- Modify: `.env.example`
- Modify: `SECURITY.md`
- Test: `tests/rate-limit.test.ts` or new `tests/http-runtime.test.ts`

**Step 1: Write tests**

Cases:
- `trustProxy=false`: ignore `x-forwarded-for`
- `trustProxy=true` but remote address not trusted: ignore `x-forwarded-for`
- `trustProxy=true` and remote address trusted: use first forwarded IP

**Step 2: Implement `ACHIOTE_TRUSTED_PROXY_CIDRS` or trusted IP allowlist**

Minimum safe implementation:
- `ACHIOTE_TRUSTED_PROXY_IPS=127.0.0.1,::1,10.0.0.1`
- only honor forwarded headers when remote address matches list

**Step 3: Verify**

```bash
npm test -- tests/http-runtime.test.ts tests/rate-limit.test.ts
npm run check
```

**Step 4: Commit**

```bash
git add src/lib/http-runtime.ts src/http-server.ts .env.example SECURITY.md tests/http-runtime.test.ts
git commit -m "Honor forwarded client identity only from trusted proxies"
```

---

## Phase 4: make rate limits production-safe

### Task 4.1: Replace in-memory authoritative quota increments with SQLite atomic increments

**Files:**
- Modify: `src/lib/rate-limit.ts`
- Test: `tests/rate-limit.test.ts`

**Step 1: Add failing concurrency-ish tests**

Test direct SQLite persistence authority:

```ts
it('enforces limits across separate limiter instances sharing one database')
```

Pseudo:
- create db path
- create limiter A and limiter B
- alternate 50 free MCP calls between instances
- 51st call from either instance should be blocked

Expected currently: may fail because each limiter holds its own in-memory count after startup.

**Step 2: Implement atomic SQLite path**

For `dbPath` mode:
- use SQLite as source of truth
- perform insert/update in transaction
- read final count
- return allowed based on persisted count

Keep map mode for no-db local use.

**Step 3: Verify**

```bash
npm test -- tests/rate-limit.test.ts
npm run check
```

**Step 4: Commit**

```bash
git add src/lib/rate-limit.ts tests/rate-limit.test.ts
git commit -m "Make persistent rate limits authoritative across instances"
```

---

## Phase 5: harden API key storage

### Task 5.1: Support hashed API keys while preserving current env compatibility

**Files:**
- Modify: `src/lib/auth.ts`
- Modify: `scripts/generate-api-key.mjs`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `SECURITY.md`
- Test: `tests/auth.test.ts`

**Step 1: Add failing tests**

Cases:
- generated key record prints `key` once and stores `keyHash`
- authenticator accepts raw submitted key against hash
- plaintext legacy keys still work temporarily with deprecation warning
- `listKeys()` never exposes secret or hash

**Step 2: Implement hash support**

Use SHA-256 or stronger keyed hash if you add a server secret later.

Record shape:

```ts
{
  keyId: 'ak_...',
  keyHash: 'sha256:...',
  tier: 'pro',
  name: 'admin',
  createdAt: '...'
}
```

**Step 3: Update keygen output**

Output:
- raw key to copy once
- env record with only hash

**Step 4: Verify**

```bash
npm test -- tests/auth.test.ts tests/ask-endpoint.test.ts
npm run check
```

**Step 5: Commit**

```bash
git add src/lib/auth.ts scripts/generate-api-key.mjs .env.example README.md SECURITY.md tests/auth.test.ts
git commit -m "Support hashed API keys for hosted HTTP auth"
```

---

## Phase 6: make constraint handling actually alter recommendations

### Task 6.1: Add failing tests for constraint-aware ingredients

**Files:**
- Modify: `tests/minimum-viable-nostalgia.test.ts`
- Modify: `src/lib/memory-workflow.ts`

**Step 1: Add tests**

Cases:
- vegan cue does not recommend meat, dairy, butter, milk, rendered fat
- gluten-free cue does not recommend bread/flour/tortilla
- peanut allergy cue includes cross-contact safety and no peanut examples
- halal cue avoids pork example when protein cue is generated

**Step 2: Run to verify failure**

```bash
npm test -- tests/minimum-viable-nostalgia.test.ts
```

Expected: fail because current constraints append guidance but do not rewrite ingredient examples.

**Step 3: Implement mechanism-preserving substitutions**

Add constraint classification:

```ts
type ConstraintClass = 'vegan' | 'vegetarian' | 'gluten-free' | 'nut-allergy' | 'halal' | 'kosher' | 'dairy-free';
```

Rewrite ingredients by mechanism:
- protein/fat cue -> beans, mushrooms, tofu, olive oil where appropriate
- starch carrier -> rice, potato, corn tortilla if gluten-free
- dairy liquid -> broth/water/coconut milk depending constraint

**Step 4: Verify**

```bash
npm test -- tests/minimum-viable-nostalgia.test.ts tests/p2-product-trust.test.ts
npm run check
```

**Step 5: Commit**

```bash
git add src/lib/memory-workflow.ts tests/minimum-viable-nostalgia.test.ts tests/p2-product-trust.test.ts
git commit -m "Make minimum cue ingredients obey user constraints"
```

---

## Phase 7: improve data quality without adding live providers

### Task 7.1: Move hint vocabularies from code to data

**Files:**
- Create: `src/data/memory-hints.json`
- Modify: `src/lib/memory-workflow.ts`
- Modify: `src/lib/data-schemas.ts`
- Test: `tests/data-validation.test.ts`
- Test: `tests/memory-workflow.test.ts`

**Step 1: Write failing data-validation tests**

Require:
- non-empty `ingredients`
- non-empty `cookingMethods`
- non-empty `regionPatterns`
- no duplicate labels
- each regex compiles

**Step 2: Move constants**

Move these from code:
- `INGREDIENT_HINTS`
- `COOKING_METHOD_HINTS`
- `REGION_PATTERNS`
- `REGION_TO_FAMILY_MAP`

**Step 3: Verify behavior unchanged**

```bash
npm test -- tests/memory-workflow.test.ts tests/data-validation.test.ts
```

**Step 4: Commit**

```bash
git add src/data/memory-hints.json src/lib/memory-workflow.ts src/lib/data-schemas.ts tests/data-validation.test.ts tests/memory-workflow.test.ts
git commit -m "Move memory hint vocabulary into validated data"
```

### Task 7.2: Add provenance metadata to bundled cultural datasets

**Files:**
- Modify: `src/data/dish-families.json`
- Modify: `src/data/ingredients.json`
- Modify: `src/lib/data-schemas.ts`
- Test: `tests/data-validation.test.ts`

**Step 1: Add failing tests**

Require every family/ingredient group to have at least one source note or provenance field.

**Step 2: Add initial provenance metadata**

Do not overclaim. Use broad `sourceType` and `notes` if source granularity is incomplete.

**Step 3: Verify**

```bash
npm test -- tests/data-validation.test.ts
npm run check
```

**Step 4: Commit**

```bash
git add src/data/dish-families.json src/data/ingredients.json src/lib/data-schemas.ts tests/data-validation.test.ts
git commit -m "Add provenance metadata to bundled food data"
```

---

## Phase 8: production Docker/runtime hardening

### Task 8.1: Add Docker healthcheck and non-root runtime

**Files:**
- Modify: `Dockerfile`
- Modify: `scripts/docker-smoke.mjs`
- Test: `tests/package-metadata.test.ts` or new `tests/dockerfile.test.ts`

**Step 1: Add Dockerfile text tests**

Require:
- `USER node` or equivalent non-root user
- `HEALTHCHECK`
- no unnecessary `src/data` copy if not used at runtime

**Step 2: Implement Dockerfile hardening**

Example:

```dockerfile
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

**Step 3: Extend Docker smoke**

After build:
- run container
- wait for health
- inspect container health status
- curl `/ready`
- stop container

**Step 4: Verify**

```bash
npm run docker:smoke
npm run check
```

**Step 5: Commit**

```bash
git add Dockerfile scripts/docker-smoke.mjs tests/dockerfile.test.ts
git commit -m "Harden Docker runtime with healthcheck and non-root user"
```

---

## Phase 9: docs and release-process alignment

### Task 9.1: Update stale PR template and security docs

**Files:**
- Modify: `.github/pull_request_template.md`
- Modify: `SECURITY.md`
- Modify: `docs/ROADMAP.md`
- Test: `tests/p3-release-hygiene.test.ts` or new `tests/docs-consistency.test.ts`

**Step 1: Add failing doc consistency tests**

Require:
- PR template includes `npm run check`
- PR template includes conditional `npm run docker:smoke`
- SECURITY does not claim CORS is `*`
- ROADMAP does not list already completed `validate_recipe_output` as future work

**Step 2: Update docs**

PR template checklist:

```md
- [ ] `npm run check`
- [ ] `npm run package:smoke`
- [ ] `npm audit --audit-level=moderate`
- [ ] `npm pack --dry-run`
- [ ] `npm run docker:smoke` when Docker/runtime changes
- [ ] Browser/screenshot review when landing UI changes
```

**Step 3: Verify**

```bash
npm test -- tests/docs-consistency.test.ts
npm run check
```

**Step 4: Commit**

```bash
git add .github/pull_request_template.md SECURITY.md docs/ROADMAP.md tests/docs-consistency.test.ts
git commit -m "Align release docs with hardened launch gates"
```

---

## Phase 10: actual launch execution checklist

These are not code-only tasks. Do them only when ready to expose the project publicly.

### Task 10.1: npm launch dry run and publish

**Steps:**

1. Create clean temp clone.
2. Run:

```bash
npm ci
npm run pack:check
npm pack --dry-run
```

3. Confirm package name:

```bash
npm view achiote version
```

Expected today: 404 until published.

4. If name is final, publish:

```bash
npm publish --access public
```

5. Verify from clean project:

```bash
mkdir /tmp/achiote-install-test
cd /tmp/achiote-install-test
npm init -y
npm install achiote
npx achiote
```

### Task 10.2: DNS and HTTPS launch

**Steps:**

1. Configure DNS for final domain.
2. Deploy container behind Caddy/nginx.
3. Set env:

```bash
ACHIOTE_AUTH_ENABLED=true
ACHIOTE_API_KEYS='[...]'
ACHIOTE_RATE_LIMIT_DB=/data/achiote-rate.db
ACHIOTE_CACHE_PATH=/data/achiote-cache.db
ACHIOTE_ALLOWED_ORIGINS=https://your-domain.example
ACHIOTE_TRUST_PROXY=true
ACHIOTE_TRUSTED_PROXY_IPS=127.0.0.1
ANTHROPIC_API_KEY=...
```

4. Verify:

```bash
curl -I https://your-domain.example/
curl https://your-domain.example/ready
curl -N -X POST https://your-domain.example/ask \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: ...' \
  --data '{"message":"My grandma made a warm sour dill soup with pale chunks."}'
```

5. Only after success, update:
- `docs/landing/index.html` canonical URL
- `docs/landing/robots.txt`
- `docs/landing/sitemap.xml`
- static-check expected domain

### Task 10.3: production monitoring

Minimum launch monitoring:
- process restart alert
- `/ready` alert
- 401/429/error rate logs
- Anthropic API failure count
- SQLite rate-limit DB write failures
- cache fallback/degraded readiness alert
- disk usage alert for DB paths

---

## Recommended PR sequence

1. `tool-registry` PR
2. `live-ask-smoke` PR
3. `http-security-boundaries` PR
4. `persistent-rate-limit-authority` PR
5. `hashed-api-keys` PR
6. `constraint-aware-cue-rewrite` PR
7. `data-vocabulary-extraction` PR
8. `docker-runtime-hardening` PR
9. `docs-release-alignment` PR
10. external launch PR for domain/npm metadata after deployment is real

---

## Stop conditions

Do not call this launch-ready if any of these are true:

- `npm view achiote` still returns 404 after deciding npm is part of launch.
- public domain DNS does not resolve.
- `/ready` is degraded in production.
- real `/ask` returns `event: error` or no `event: done`.
- package smoke or Docker smoke fails in a clean environment.
- MCP and HTTP tool counts differ.
- any Kilo/GitHub review thread remains unresolved.
