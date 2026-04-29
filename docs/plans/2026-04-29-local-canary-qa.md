# Local Canary QA Implementation Plan

**Goal:** Build a gentle, repeatable QA harness that uses `qwen3.5-0.8b` as Achiote's smallest viable local-inference canary.

**Architecture:** Add a standalone Node script that health-checks the OpenAI-compatible Tailscale endpoint, starts Achiote locally with the canary model, runs paced `/ask` cases, classifies product findings separately from provider/runtime instability, and writes JSON plus Markdown artifacts. Keep it outside `npm run check` so regular CI never depends on the private inference server.

**Tech Stack:** Node.js ESM script, existing `dist/http-server.js`, Server-Sent Events parsing, existing package scripts and Vitest metadata checks.

---

### Task 1: Add The Canary Harness

**Files:**
- Create: `scripts/local-canary-qa.mjs`
- Modify: `package.json`

**Steps:**
1. Add `scripts/local-canary-qa.mjs`.
2. Implement endpoint health gates for `/models` and a tiny direct chat ping.
3. Start `dist/http-server.js` with `ACHIOTE_ASK_PROVIDER=local`, `LOCAL_INFERENCE_MODEL=qwen3.5-0.8b`, and temporary cache/rate-limit DBs.
4. Run paced cases for baseline, beverage, substitution, incidental dietary context, sparse memory, multilingual/code-switching, follow-up, boundary claims, and recipe pressure.
5. Stop early when provider/runtime failures exceed the configured threshold.
6. Write JSON and Markdown summaries to an artifact directory.
7. Add `canary:local` script as `npm run build && node scripts/local-canary-qa.mjs`.

### Task 2: Add Metadata Coverage

**Files:**
- Modify: `tests/package-metadata.test.ts`

**Steps:**
1. Assert the `canary:local` script is declared.
2. Assert `scripts/local-canary-qa.mjs` exists.
3. Assert the script contains the default `qwen3.5-0.8b` model and explicit provider-health stop language.

### Task 3: Verify Gently

**Commands:**
- `npm run build`
- `npx vitest run tests/package-metadata.test.ts`
- `npm run canary:local -- --list-json`
- A targeted live run only if the endpoint health gate passes, for example:
  `LOCAL_CANARY_CASES=baseline_food_memory,recipe_pressure LOCAL_CANARY_PACE_MS=20000 npm run canary:local`

### Task 4: Package And PR Verification

**Commands:**
- `npm run torture:fake`
- `npm run check`
- `npm run package:smoke`
- `npm audit --audit-level=moderate`
- `git diff --check`
- `npm pack --dry-run`

