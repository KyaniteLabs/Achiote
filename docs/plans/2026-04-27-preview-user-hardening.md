# Preview User Hardening Implementation Plan

**Goal:** Make the hosted Achiote preview safer to demonstrate by improving visible progress, feedback capture, and repeatable live-quality checks.

**Architecture:** Keep the food-memory workflow and MCP/tool contracts unchanged. Harden the static web app around the existing SSE events, expand privacy-preserving telemetry categories, and add a script that can smoke-test a live or local `/ask` endpoint with preview-user scenarios.

**Tech Stack:** Static HTML/CSS/JS, Node.js HTTP server telemetry, Vitest guardrails, and a dependency-free Node preview smoke script.

---

### Task 1: Preview Trace And Feedback Guardrails

**Files:**
- Modify: `tests/launch-business-hardening.test.ts`
- Modify: `tests/http-server.test.ts`

**Steps:**
1. Add failing assertions that the app shows human-readable phases such as "Reading memory", "Correcting likely name", "Researching", and "Building first test".
2. Add failing assertions that feedback options are preview-user categories: "Feels close", "Wrong region", "Too hard to make", and "Did not correct my wording".
3. Add failing assertions that telemetry accepts the new feedback event names and still rejects unsupported events.
4. Run the focused tests and confirm they fail before implementation.

### Task 2: Implement Preview Trace And Feedback

**Files:**
- Modify: `docs/landing/app.html`
- Modify: `docs/landing/app.js`
- Modify: `src/http-server.ts`

**Steps:**
1. Increase trace readability with larger text and clear phase labels.
2. Map low-level tool names into user-friendly phase text while preserving runtime/model details in the trace.
3. Replace generic feedback buttons with preview-user learning signals.
4. Add the new telemetry event names to the server allowlist.
5. Run focused tests and commit.

### Task 3: Preview Smoke Script

**Files:**
- Create: `scripts/preview-ask-smoke.mjs`
- Modify: `package.json`
- Modify: `tests/package-metadata.test.ts` or `tests/launch-business-hardening.test.ts`

**Steps:**
1. Add failing tests for the script and `npm run preview:smoke` command.
2. Implement a dependency-free Node script that posts 5 preview scenarios to `ACHIOTE_PREVIEW_URL` or `http://127.0.0.1:3000`, parses SSE, fails on error events, missing text/done events, missing expected quality markers, or "buy the exact dish" regressions.
3. Run the focused tests and commit.

### Task 4: Verification And Delivery

**Files:**
- All changed files.

**Steps:**
1. Run `npm run check`.
2. Run `npm run package:smoke`.
3. Run `npm audit --audit-level=moderate`.
4. Run `git diff --check`.
5. Run `npm pack --dry-run`.
6. Push the branch, open a PR, wait for checks, merge, deploy, and run the live preview smoke against `https://achiote.kyanitelabs.tech`.
