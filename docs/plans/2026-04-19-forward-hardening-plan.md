# Forward Hardening and Improvement Plan

**Goal:** Preserve the current architecture while giving future, less powerful agents a prioritized roadmap and guardrails that prevent regression.

**Architecture:** Keep Member Berries as a TypeScript stdio MCP server plus Codex/Claude skill. Improvements should favor data-driven mechanisms, typed provenance, regression fixtures, and small package-safe changes over broad rewrites.

**Tech Stack:** TypeScript, Zod schemas, MCP SDK, Vitest, static docs/HTML, package smoke tests.

---

## Highest leverage / ROI

### 1. Guard against hard-coded minimum-cue regressions

**Why:** The biggest observed failure mode is agents solving one example by baking the example into code.

**Acceptance criteria:**
- Tests fail if `generateMinimumViableNostalgiaCue` or its profile helper contains country/dish/restaurant-specific strings.
- Tests require `accessibilityPrinciples` and `substituteLogic` in MVC output.
- `AGENTS.md` explains the mechanism-first rule.

**Verification:** `npm test -- --run tests/agent-guardrails.test.ts` and full `npm run check`.

### 2. Protect product boundaries in docs

**Why:** Future agents may reintroduce confusing claims: MCP browses the web, README includes business plan, provider-backed wording, or exact-specialty-first language.

**Acceptance criteria:**
- README stays MCP/skill focused.
- Docs say host AI performs open-ended browsing/search.
- README/skill keep MVC before optional full recipe handoff.

**Verification:** static guardrail tests over README, skill, docs, and source.

### 3. Expand data-driven cue mechanism coverage

**Why:** Current food-science planner is generic, but richer behavior should come from reusable mechanism families, not examples.

**Next mechanisms to add:**
- fermentation/acid family
- dairy/cream emulsion family
- smoke/char family
- chile heat + fruit/sugar balance
- cold/room-temp serving ritual

**Acceptance criteria:** each mechanism has tests with multiple unrelated example inputs proving no dish-specific branching.

### 4. Add source-backed research fixture examples

**Why:** Host-researched facts are the handoff contract, but examples should demonstrate good source shape without live network dependence.

**Acceptance criteria:** recorded fixture JSON/Markdown examples for 3 workflows: name-fragment, sensory-only, place+ingredient.

**Verification:** tests validate fixture schema and extraction behavior.

### 5. Improve host prompt failure handling

**Why:** Host models can pass malformed dossiers or skip required arrays. Tool errors should be clear and recovery-oriented.

**Acceptance criteria:** validation errors include concise remediation hints and tests cover common malformed host handoffs.

---

## Medium leverage

### 6. Optional food-data provider lookup interface

Keep open-ended web research in the host AI. Add only narrow structured lookup adapters, such as ingredient-label or nutrition databases, with privacy docs and recorded fixtures.

### 7. Schema-validated host recipe handoff

If the host writes final recipe prose, add optional validation for a host-provided recipe object after the MVC works.

### 8. Dietary/allergen/religious constraints

Add constraints to substitution and MVC generation so cues do not suggest unsafe or culturally inappropriate proxies.

### 9. CLI/demo harness

Add a deterministic `npm run demo:*` script that runs in-memory MCP flows and prints concise outputs for smoke testing without Claude/Codex UI.

### 10. Landing-page visual QA

Add lightweight screenshot review guidance or fixtures for the static landing page so future copy/design edits do not quietly degrade it.

---

## Lower leverage / later

### 11. Broaden bundled cultural data

Only expand with provenance and tests. Avoid broad static encyclopedias.

### 12. Cache TTL and migration policy

Useful once provider lookups exist. Not urgent while host AI performs research.

### 13. Publish/release automation

Add release notes and package provenance once API stabilizes.

---

## Non-negotiables for future agents

- Do not hard-code a dish, country, restaurant, or user example into MVC logic.
- Do not make the MCP server browse the web by default.
- Do not put business-plan/SaaS/meal-kit material in README.
- Do not skip `npm run check`, `npm run package:smoke`, `npm audit --audit-level=moderate`, and `git diff --check` before claiming completion.
