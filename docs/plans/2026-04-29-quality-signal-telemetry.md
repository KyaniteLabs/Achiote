# Quality Signal Telemetry Implementation Plan

**Goal:** Add privacy-preserving `/ask` quality signals that show normalized failure and cache-prewarm opportunities without storing raw memories.

**Architecture:** Create a pure signal-normalization module, wire successful `/ask` completions through one recorder, and expose aggregate counts only through the existing operator-only `/events` route. Keep public telemetry submission unchanged and bounded.

**Tech Stack:** TypeScript, Vitest, existing HTTP server, existing in-memory telemetry maps, no new dependencies.

---

### Task 1: Pure Signal Normalization

**Files:**
- Create: `src/lib/quality-signals.ts`
- Create: `tests/quality-signals.test.ts`

**Step 1: Write the failing tests**

Cover:
- beverage memory from collected clues becomes `memoryType: "beverage"`.
- broad unknown memories include `missing_name`, `missing_region`, `missing_ingredient`, and `missing_format`.
- guarded, search, and cache values are bounded.
- no raw memory text appears in the serialized signal.

**Step 2: Verify red**

Run:

```bash
npm test -- tests/quality-signals.test.ts
```

Expected: fail because `src/lib/quality-signals.ts` does not exist.

**Step 3: Implement minimal module**

Export:
- `type AskQualitySignal`
- `type AskQualitySignalInput`
- `buildAskQualitySignal(input): AskQualitySignal`
- `emptyQualitySignalReport()`
- `recordQualitySignal(report, signal)`

**Step 4: Verify green**

Run:

```bash
npm test -- tests/quality-signals.test.ts
```

Expected: pass.

### Task 2: Wire `/ask` Successful Endings

**Files:**
- Modify: `src/http-server.ts`
- Modify: `tests/ask-failure-surface-regressions.test.ts`

**Step 1: Write failing HTTP/SSE regression**

Add a fake-provider `/ask` test that reaches a guarded success path, then reads private `GET /events` with `ACHIOTE_EVENTS_ADMIN_TOKEN` and expects a `quality` report with:
- `total: 1`
- the expected guard count
- the expected memory type count
- no raw memory text in the JSON body

**Step 2: Verify red**

Run:

```bash
npm test -- tests/ask-failure-surface-regressions.test.ts -t "quality signal"
```

Expected: fail because `/events` has no `quality` report.

**Step 3: Implement recorder**

In `src/http-server.ts`:
- import the quality-signal helpers.
- add an in-memory quality report.
- create `sendDoneWithQuality(...)` or a small local helper to record once before each successful `send('done', ...)`.
- include `quality` in private `GET /events`.

**Step 4: Verify green**

Run:

```bash
npm test -- tests/ask-failure-surface-regressions.test.ts -t "quality signal"
```

Expected: pass.

### Task 3: Keep Existing Telemetry Contract Stable

**Files:**
- Modify: `tests/http-server.test.ts`
- Modify: `tests/launch-business-hardening.test.ts`

**Step 1: Update existing private `/events` expectations**

Add the empty `quality` report to the operator-only `/events` test. Keep public `GET /events` returning 404.

**Step 2: Verify**

Run:

```bash
npm test -- tests/http-server.test.ts -t "telemetry counters"
npm test -- tests/launch-business-hardening.test.ts -t "telemetry"
```

Expected: pass.

### Task 4: Package Metadata Guard

**Files:**
- Modify: `tests/package-metadata.test.ts`

**Step 1: Add package guard**

Assert the packaged build includes `dist/lib/quality-signals.js` through normal `dist/` packaging and that no new package files are added.

**Step 2: Verify**

Run:

```bash
npm test -- tests/package-metadata.test.ts
```

Expected: pass.

### Task 5: Full Verification and PR

Run:

```bash
npm run check
npm run package:smoke
npm audit --audit-level=moderate
git diff --check
npm pack --dry-run
```

Expected: all pass.

Commit with Lore protocol, push `codex/quality-signal-telemetry`, open a PR, monitor non-Kilo CI, and address actionable Codex review feedback.

