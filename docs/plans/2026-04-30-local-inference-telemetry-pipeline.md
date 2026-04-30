# Local Inference Telemetry Pipeline Implementation Plan

**Goal:** Build a repeatable local-inference profiler and cross-provider telemetry analyzer that turn cloud and local torture results into engineering patterns.

**Architecture:** Keep provider control and telemetry analysis in small pure TypeScript modules, with Node scripts as thin orchestration shells. The LM Studio profiler owns load/unload/profile metadata and raw response capture; the telemetry analyzer normalizes artifacts from local canaries, weak-cloud JSONL, and future runners into one event shape, then groups common failure and guard patterns across model/provider boundaries.

**Tech Stack:** TypeScript, dependency-free Node scripts, Vitest, LM Studio REST/OpenAI-compatible APIs.

---

### Task 1: LM Studio Load Profiles

**Files:**
- Create: `src/lib/local-inference-profiles.ts`
- Create: `tests/local-inference-telemetry.test.ts`
- Create: `scripts/local-inference-profiler.mjs`
- Modify: `package.json`
- Modify: `tests/package-metadata.test.ts`

**Step 1: Write the failing profile tests**

Test that named profiles exist for `speed`, `quality`, and `memory`, and that each profile emits explicit LM Studio REST load payload fields:

```ts
expect(buildLmStudioLoadPayload('qwen3.6-35b-a3b', 'speed')).toMatchObject({
  model: 'qwen3.6-35b-a3b',
  context_length: 8192,
  eval_batch_size: expect.any(Number),
  parallel: 1,
  flash_attention: true,
  offload_kv_cache_to_gpu: true,
  num_experts: 4,
  echo_load_config: true,
});
```

Also test that SDK-only/advanced fields are preserved in profile metadata even when the REST payload cannot safely send them.

**Step 2: Run test to verify RED**

Run:

```bash
npm test -- tests/local-inference-telemetry.test.ts
```

Expected: fail because `src/lib/local-inference-profiles.ts` does not exist.

**Step 3: Implement profile module**

Implement:

- `localInferenceProfiles`
- `buildLmStudioLoadPayload(model, profileName, overrides?)`
- `summarizeLoadProfile(profileName)`

Do not call network APIs in the module.

**Step 4: Add profiler script**

Create `scripts/local-inference-profiler.mjs` that:

- supports `--list-profiles`
- unloads all loaded LM Studio instances when requested
- loads exactly one model with a named profile
- records echoed load config
- probes direct OpenAI-compatible chat completions
- optionally runs `scripts/local-canary-qa.mjs` with selected cases
- stores raw prompt/response/error/usage/stats events in an artifact directory

**Step 5: Verify**

Run:

```bash
npm test -- tests/local-inference-telemetry.test.ts tests/package-metadata.test.ts
node scripts/local-inference-profiler.mjs --list-profiles
```

### Task 2: Cross-Provider Telemetry Pattern Mining

**Files:**
- Create: `src/lib/model-telemetry.ts`
- Create/extend: `tests/local-inference-telemetry.test.ts`
- Create: `scripts/model-telemetry-report.mjs`
- Modify: `package.json`
- Modify: `tests/package-metadata.test.ts`

**Step 1: Write failing normalization tests**

Add fixture rows for:

- local canary JSON summaries
- weak-cloud JSONL rows
- naked model rows
- Achiote `/ask` rows

Assert normalization preserves:

- provider, model, mode, prompt/case id
- status/classification
- findings, quality labels, guard reason
- tool path
- latency
- trace/reasoning preview when available
- raw error detail when available

**Step 2: Write failing pattern tests**

Assert pattern mining groups cross-provider themes:

- `tool_workflow_fragility`
- `fallback_quality_drift`
- `provider_or_runtime_instability`
- `trust_boundary_pressure`
- `latency_outlier`
- `guard_dependency`

**Step 3: Implement pure telemetry module**

Implement:

- `normalizeTelemetryRecord`
- `normalizeLocalCanarySummary`
- `normalizeWeakCloudRow`
- `mineTelemetryPatterns`
- `renderTelemetryMarkdown`

**Step 4: Add telemetry report script**

Create `scripts/model-telemetry-report.mjs` that accepts artifact paths or directories, emits JSON/Markdown, and keeps raw traces in links rather than hiding them.

**Step 5: Verify**

Run:

```bash
npm test -- tests/local-inference-telemetry.test.ts
node scripts/model-telemetry-report.mjs artifacts/local-canary-post-fixes artifacts/weak-cloud-patience-2026-04-30 --out artifacts/model-telemetry-report
```

### Task 3: Documentation and Guardrails

**Files:**
- Modify: `docs/LAUNCH_RUNBOOK.md`
- Modify: `docs/ARCHITECTURE.md`

**Step 1: Document pipeline use**

Add a concise section explaining:

- cloud and local model testing feed the same telemetry pattern miner
- reasoning traces are useful telemetry but must be treated as model output, not fact
- raw provider errors and secrets must stay sanitized before user-facing output
- local load profiles must record actual echoed config, not just intended config

**Step 2: Verify**

Run:

```bash
npm run build
npm test -- tests/local-inference-telemetry.test.ts tests/package-metadata.test.ts tests/docs-consistency.test.ts
git diff --check
```

### Task 4: Full Verification

Run:

```bash
npm run check
npm run package:smoke
npm audit --audit-level=moderate
git diff --check
npm pack --dry-run
```

If live LM Studio is available, run one tiny non-destructive profiler dry pass:

```bash
node scripts/local-inference-profiler.mjs --list-profiles
```
