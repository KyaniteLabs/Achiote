# GLM Endpoint Matrix And Local Inference Ops Implementation Plan

**Goal:** Make GLM Coding Plan endpoint compatibility and local inference server utilization explicit, testable, and observable.

**Architecture:** Treat GLM as a provider family with model/endpoint-style variants rather than a single route. Keep Achiote runtime routing in `src/lib/ask-provider.ts`, keep scheduled/live model experiments in scripts, and keep local inference load profiles honest about which knobs are actually applied by LM Studio REST versus only documented as SDK/CLI targets.

**Tech Stack:** TypeScript, Vitest, dependency-free Node scripts, Z.ai Coding Plan Anthropic/OpenAI-compatible APIs, LM Studio REST/SDK/CLI guidance.

---

### Task 1: GLM Coding Endpoint Style Routing

**Files:**
- Modify: `src/lib/ask-provider.ts`
- Modify: `tests/ask-provider.test.ts`
- Modify: `tests/local-inference-provider.test.ts`

**Step 1: Write failing tests**

Add tests asserting:

```ts
expect(resolveGlmEndpointStyle({ ACHIOTE_ASK_PROVIDER: 'glm', ACHIOTE_ASK_MODEL: 'GLM-5.1' })).toBe('anthropic-coding');
expect(resolveGlmEndpointStyle({ ACHIOTE_ASK_PROVIDER: 'glm', ACHIOTE_ASK_MODEL: 'GLM-4.5-Air' })).toBe('anthropic-coding');
expect(resolveGlmEndpointStyle({ ACHIOTE_ASK_PROVIDER: 'glm', ACHIOTE_ASK_MODEL: 'GLM-4.5-Air', GLM_ENDPOINT_STYLE: 'openai-coding' })).toBe('openai-coding');
expect(resolveAskProviderKind({ ACHIOTE_ASK_PROVIDER: 'glm', GLM_ENDPOINT_STYLE: 'openai-coding' })).toBe('openai');
expect(openAIBaseUrlFromEnv({ ACHIOTE_ASK_PROVIDER: 'glm', GLM_ENDPOINT_STYLE: 'openai-coding' })).toBe('https://api.z.ai/api/coding/paas/v4');
```

**Step 2: Run the targeted tests and verify RED**

```bash
npm test -- tests/ask-provider.test.ts tests/local-inference-provider.test.ts
```

Expected: fail because `resolveGlmEndpointStyle` does not exist and GLM always maps to Anthropic-compatible routing.

**Step 3: Implement routing**

Add:

- `type GlmEndpointStyle = 'anthropic-coding' | 'openai-coding'`
- `resolveGlmEndpointStyle(env?)`
- `isGlmProvider(env?)`
- `glmOpenAIBaseUrlFromEnv(env?)`

Default GLM Coding Plan models to `anthropic-coding`, but allow `GLM_ENDPOINT_STYLE=openai-coding` / `ZHIPU_ENDPOINT_STYLE=openai-coding` / `GLM_COMPATIBILITY=openai-coding`.

**Step 4: Verify GREEN**

Run:

```bash
npm test -- tests/ask-provider.test.ts tests/local-inference-provider.test.ts
```

### Task 2: GLM Endpoint Matrix Runner

**Files:**
- Modify: `scripts/weak-cloud-overnight.mjs`
- Modify: `tests/local-inference-telemetry.test.ts`
- Modify: `docs/LAUNCH_RUNBOOK.md`
- Modify: `.env.example`
- Modify: `deploy/hostinger-vps/README.md`

**Step 1: Write failing tests**

Assert the weak-cloud runner contains both `anthropic-coding` and `openai-coding` GLM endpoint styles, and that model rows can be normalized with endpoint style metadata.

**Step 2: Implement script matrix**

Make GLM tests generate rows for model/style pairs:

- `GLM-5.1` with `anthropic-coding`
- `GLM-5-Turbo` with `anthropic-coding`
- `GLM-4.7` with `anthropic-coding`
- `GLM-4.5-Air` with both `anthropic-coding` and `openai-coding`
- `GLM-4.5-Flash` with both styles

Record `endpointStyle`, `baseUrl`, and `compatibility` in every GLM telemetry row.

**Step 3: Verify**

Run:

```bash
npm test -- tests/local-inference-telemetry.test.ts tests/package-metadata.test.ts
node scripts/weak-cloud-overnight.mjs --help
```

### Task 3: Local Inference Server Utilization Audit

**Files:**
- Modify: `src/lib/local-inference-profiles.ts`
- Modify: `scripts/local-inference-profiler.mjs`
- Modify: `tests/local-inference-telemetry.test.ts`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/LAUNCH_RUNBOOK.md`

**Step 1: Write failing tests**

Assert profile metadata distinguishes:

- REST-applied knobs: context length, eval batch, parallel, Flash Attention, GPU KV offload, num experts
- SDK/CLI-target knobs: CPU threads, KV cache quantization, keep model warm, GPU offload policy

**Step 2: Implement honest profile metadata**

Add `appliedByRest` and `requiresSdkOrCli` arrays to summaries and profiler artifacts. Do not claim REST applies CPU threads or KV cache quantization unless it is sent and echoed.

**Step 3: Document the operator ask**

Document that to fully exploit the Tailscale inference server, we need either:

- LM Studio SDK/CLI access on the host that exposes KV quantization and CPU thread config, or
- the exact server runtime/CLI command if it is llama.cpp/vLLM/etc.

**Step 4: Verify**

Run:

```bash
npm test -- tests/local-inference-telemetry.test.ts
npm run local:profile -- --list-profiles
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
