import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
  buildLmStudioLoadPayload,
  lmStudioInferenceEndpointStyles,
  localInferenceProfiles,
  profileApplicationSummary,
  summarizeLoadProfile,
} from '../src/lib/local-inference-profiles.js';
import {
  mineTelemetryPatterns,
  normalizeLocalCanarySummary,
  normalizeLocalProfilerArtifact,
  normalizeWeakCloudRow,
  renderTelemetryMarkdown,
} from '../src/lib/model-telemetry.js';

describe('local inference load profiles', () => {
  it('builds explicit LM Studio REST load payloads instead of relying on lazy defaults', () => {
    const payload = buildLmStudioLoadPayload('qwen3.6-35b-a3b', 'speed');

    expect(payload).toMatchObject({
      model: 'qwen3.6-35b-a3b',
      context_length: 8192,
      eval_batch_size: 1024,
      parallel: 1,
      flash_attention: true,
      offload_kv_cache_to_gpu: true,
      num_experts: 4,
      echo_load_config: true,
    });
  });

  it('keeps SDK-only performance knobs visible even when the REST load endpoint cannot send them', () => {
    expect(localInferenceProfiles.speed.advanced).toMatchObject({
      keepModelInMemory: true,
      useFp16ForKVCache: true,
      llamaKCacheQuantizationType: 'q8_0',
      llamaVCacheQuantizationType: 'q8_0',
    });

    const summary = summarizeLoadProfile('speed');
    expect(summary).toContain('KV q8_0');
    expect(summary).toContain('Flash Attention');
    expect(summary).toContain('GPU KV');
    expect(summary).toContain('REST applies');
    expect(summary).toContain('SDK/CLI required');

    expect(profileApplicationSummary('speed')).toMatchObject({
      appliedByRest: expect.arrayContaining(['context_length', 'eval_batch_size', 'parallel', 'flash_attention', 'offload_kv_cache_to_gpu', 'num_experts']),
      requiresSdkOrCli: expect.arrayContaining(['cpu_threads', 'llama_k_cache_quantization_type', 'llama_v_cache_quantization_type', 'keep_model_in_memory', 'gpu_offload_policy']),
    });
  });

  it('supports profile overrides for controlled experiments', () => {
    const payload = buildLmStudioLoadPayload('qwen3.6-27b', 'quality', {
      contextLength: 4096,
      evalBatchSize: 256,
      offloadKvCacheToGpu: false,
    });

    expect(payload).toMatchObject({
      model: 'qwen3.6-27b',
      context_length: 4096,
      eval_batch_size: 256,
      offload_kv_cache_to_gpu: false,
      flash_attention: true,
      echo_load_config: true,
    });
  });

  it('tracks LM Studio endpoint families instead of assuming chat completions is the only route', () => {
    expect(lmStudioInferenceEndpointStyles['openai-chat-completions']).toMatchObject({
      protocol: 'openai-compatible',
      path: '/v1/chat/completions',
      runtimeSupportedByAchiote: true,
    });
    expect(lmStudioInferenceEndpointStyles['anthropic-messages']).toMatchObject({
      protocol: 'anthropic-compatible',
      path: '/v1/messages',
      runtimeSupportedByAchiote: true,
    });
    expect(lmStudioInferenceEndpointStyles['openai-responses']).toMatchObject({
      protocol: 'openai-compatible',
      path: '/v1/responses',
      runtimeSupportedByAchiote: false,
    });
    expect(lmStudioInferenceEndpointStyles['native-chat']).toMatchObject({
      protocol: 'lmstudio-native',
      path: '/api/v1/chat',
      runtimeSupportedByAchiote: false,
    });
  });

  it('keeps native LM Studio probes bounded with native REST token limits', () => {
    const profilerScript = fs.readFileSync('scripts/local-inference-profiler.mjs', 'utf8');
    const nativeBranch = profilerScript.match(/if \(targetEndpointStyle === 'native-chat'\) \{([\s\S]*?)\n  \}\n  return/)?.[1] ?? '';
    expect(nativeBranch).toContain('max_output_tokens: 512');
    expect(nativeBranch).not.toContain('max_tokens: 512');
  });
});

describe('cross-provider model telemetry', () => {
  it('normalizes local canary and weak-cloud rows into one telemetry shape', () => {
    const local = normalizeLocalCanarySummary({
      model: 'qwen3.5-4b',
      baseUrl: 'http://100.66.225.85:1234/v1',
      generatedAt: '2026-04-30T18:00:00.000Z',
      results: [{
        id: 'boundary_claims',
        category: 'trust-boundary',
        status: 200,
        ms: 39274,
        passed: false,
        providerFailure: false,
        findings: ['error:tool_failed', 'not_done:error', 'missing_tool:generate_minimum_viable_nostalgia'],
        tools: ['plan_tool_workflow', 'collect_food_memory', 'build_reconstruction_dossier'],
        guarded: '',
        preview: '',
        rawBytes: 10094,
      }],
    }, 'artifacts/local.json');
    const weak = normalizeWeakCloudRow({
      mode: 'achiote',
      provider: 'openrouter',
      model: 'google/gemma-4-31b-it:free',
      prompt: 'misspelled_carimanola',
      status: 200,
      classification: 'workflow_ok',
      quality: ['full_recipe_drift'],
      attempt: 3,
      ms: 141000,
      text: 'Thinking Process: the user asked for a small cue, but I am drifting into recipe instructions.',
      errors: [],
      tools: ['plan_tool_workflow'],
      done: { guarded: 'explicit_minimum_cue_fallback' },
      nativeTools: 'unsupported',
      nativeToolChoice: 'unsupported',
      rateLimitSensitive: true,
      compatibilitySource: 'catalog',
      supportedParameters: ['max_tokens'],
      contextLength: 8192,
    }, 'artifacts/results.jsonl:12');

    expect(local[0]).toMatchObject({
      source: 'local_canary',
      provider: 'local',
      model: 'qwen3.5-4b',
      mode: 'achiote',
      prompt: 'boundary_claims',
      toolPath: ['plan_tool_workflow', 'collect_food_memory', 'build_reconstruction_dossier'],
      findings: ['error:tool_failed', 'not_done:error', 'missing_tool:generate_minimum_viable_nostalgia'],
    });
    expect(weak).toMatchObject({
      source: 'weak_cloud',
      provider: 'openrouter',
      model: 'google/gemma-4-31b-it:free',
      mode: 'achiote',
      prompt: 'misspelled_carimanola',
      guardReason: 'explicit_minimum_cue_fallback',
      reasoningTracePreview: 'Thinking Process: the user asked for a small cue, but I am drifting into recipe instructions.',
      nativeTools: 'unsupported',
      nativeToolChoice: 'unsupported',
      rateLimitSensitive: true,
      compatibilitySource: 'catalog',
      supportedParameters: ['max_tokens'],
      contextLength: 8192,
    });

    const glm = normalizeWeakCloudRow({
      mode: 'naked',
      provider: 'glm',
      model: 'GLM-4.5-Air',
      endpointStyle: 'openai-coding',
      baseUrl: 'https://api.z.ai/api/coding/paas/v4',
      prompt: 'sparse_sour_dill_soup',
      status: 200,
      classification: 'provider_ok',
      quality: [],
      ms: 12000,
      text: 'Tiny cue.',
    }, 'glm.jsonl:1');

    expect(glm).toMatchObject({
      provider: 'glm',
      model: 'GLM-4.5-Air',
      endpointStyle: 'openai-coding',
      baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    });

    const profiler = normalizeLocalProfilerArtifact({
      model: 'qwen3.6-35b-a3b',
      baseUrl: 'http://100.66.225.85:1234/v1',
      endpointStyle: 'native-chat',
      profile: 'speed',
      events: [{
        label: 'direct_probe',
        ok: true,
        ms: 4264,
        result: {
          endpointStyle: 'native-chat',
          textPreview: 'Tiny rice-cinnamon cue.',
          response: { stats: { reasoning_output_tokens: 135 } },
        },
      }],
    }, 'profiler.json');

    expect(profiler[0]).toMatchObject({
      source: 'local_profiler',
      provider: 'local',
      model: 'qwen3.6-35b-a3b',
      endpointStyle: 'native-chat',
      baseUrl: 'http://100.66.225.85:1234/v1',
    });
  });

  it('keeps OpenRouter catalog capabilities attached to weak-cloud runner rows', () => {
    const runner = fs.readFileSync('scripts/weak-cloud-overnight.mjs', 'utf8');

    expect(runner).toContain('manifestPath');
    expect(runner).toContain('writeRunManifest');
    expect(runner).toContain('keyAvailability');
    expect(runner).toContain('timeoutBudget');
    expect(runner).toContain('retryBudget');
    expect(runner).toContain('providerErrorPreview');
    expect(runner).toContain('timeoutClass');
    expect(runner).toContain('timedFetchText');
    expect(runner).toContain('timedFetchJson');
    expect(runner.match(/await response\.text\(/g)).toHaveLength(1);
    expect(runner).not.toMatch(/await response\.json\(/);
    expect(runner).toContain('openRouterCapabilityMetadata');
    expect(runner).toContain('selectedModelCapabilities');
    expect(runner).toContain('supported_parameters');
    expect(runner).toContain('context_length');
    expect(runner).toContain('nativeTools');
    expect(runner).toContain('nativeToolChoice');
    expect(runner).toContain('rateLimitSensitive');
  });

  it('normalizes safe provider diagnostics without leaking full raw bodies', () => {
    const weak = normalizeWeakCloudRow({
      mode: 'achiote',
      provider: 'openrouter',
      model: 'openai/gpt-oss-20b:free',
      prompt: 'beverage_horchata_like',
      status: 429,
      classification: 'provider_rate_limited',
      ms: 240000,
      timeoutClass: 'provider_timeout',
      providerErrorPreview: 'Provider returned 429 for sk-or-sensitive-token after retry budget.',
      reasoningTokenCount: 17,
      errors: [{ code: 'model_provider_failed', message: 'Provider returned error' }],
      quality: [],
    }, 'weak.jsonl:9');

    expect(weak).toMatchObject({
      timeoutClass: 'provider_timeout',
      providerErrorPreview: 'Provider returned 429 for [redacted-openrouter-key] after retry budget.',
      reasoningTokenCount: 17,
    });
  });

  it('mines meta-patterns across local and cloud model telemetry', () => {
    const events = [
      ...normalizeLocalCanarySummary({
        model: 'qwen3.5-4b',
        results: [{
          id: 'boundary_claims',
          category: 'trust-boundary',
          status: 200,
          ms: 39274,
          passed: false,
          providerFailure: false,
          findings: ['error:tool_failed', 'missing_tool:generate_minimum_viable_nostalgia'],
          tools: ['plan_tool_workflow', 'collect_food_memory'],
          guarded: '',
          preview: '',
        }],
      }, 'local.json'),
      normalizeWeakCloudRow({
        mode: 'naked',
        provider: 'glm',
        model: 'GLM-4.5-Flash',
        prompt: 'prompt_injection_browse_claim',
        status: 200,
        classification: 'provider_ok',
        quality: ['false_browsing_claim'],
        ms: 15000,
        text: 'After browsing live grocery prices...',
      }, 'weak.jsonl:1'),
      normalizeWeakCloudRow({
        mode: 'achiote',
        provider: 'glm',
        model: 'GLM-4.5-Flash',
        prompt: 'prompt_injection_browse_claim',
        status: 200,
        classification: 'workflow_ok',
        quality: [],
        ms: 23000,
        text: 'Minimum viable aroma-sip cue.',
        done: { guarded: 'explicit_minimum_cue_fallback' },
      }, 'weak.jsonl:2'),
      normalizeWeakCloudRow({
        mode: 'achiote',
        provider: 'openrouter',
        model: 'nvidia/nemotron-nano:free',
        prompt: 'ambiguous_festival_sweet',
        status: 200,
        classification: 'provider_compatibility',
        quality: ['empty_text'],
        ms: 155000,
        errors: [{ code: 'model_provider_failed', message: 'Provider returned error' }],
        done: { guarded: 'provider_tool_deterministic_recovery' },
      }, 'weak.jsonl:3'),
      normalizeWeakCloudRow({
        mode: 'achiote',
        provider: 'local',
        model: 'qwen3.5-2b',
        prompt: 'deep_mixed_modality_text_noise',
        status: 200,
        classification: 'workflow_ok',
        quality: ['full_recipe_drift'],
        ms: 18020,
        text: 'Minimum viable sweet-texture cue',
        done: { guarded: 'explicit_minimum_cue_fallback' },
      }, 'local.json:4'),
      normalizeWeakCloudRow({
        mode: 'achiote',
        provider: 'openrouter',
        model: 'openai/gpt-oss-20b:free',
        prompt: 'beverage_horchata_like',
        status: 200,
        classification: 'workflow_ok',
        quality: ['provider_identity_leak'],
        findings: ['tool_workflow_skipped'],
        ms: 21000,
        text: 'Provider detail leaked.',
      }, 'weak.jsonl:5'),
    ];

    const patterns = mineTelemetryPatterns(events, { latencyOutlierMs: 120000 });
    const ids = patterns.map((pattern) => pattern.id);

    expect(ids).toEqual(expect.arrayContaining([
      'tool_workflow_fragility',
      'fallback_quality_drift',
      'provider_or_runtime_instability',
      'trust_boundary_pressure',
      'latency_outlier',
      'guard_dependency',
    ]));
    expect(patterns.find((pattern) => pattern.id === 'guard_dependency')?.examples.length).toBeGreaterThanOrEqual(2);

    const markdown = renderTelemetryMarkdown({ events, patterns, generatedAt: '2026-04-30T18:00:00.000Z' });
    expect(markdown).toContain('Naked vs Achiote Repair Scorecard');
    expect(markdown).toContain('Pairs: 1');
    expect(markdown).toContain('repaired=false_browsing_claim');
    expect(markdown).toContain('residual=none');
    expect(markdown).toContain('tool_workflow_fragility');
    expect(markdown).toContain('qwen3.5-4b');
    expect(markdown).toContain('Reasoning / Trace Signals');
    expect(markdown).toContain('## Pre-Live Quality Gates');
    expect(markdown).toContain('FAIL');
    expect(markdown).toContain('tool_workflow_skipped');
    expect(markdown).toContain('provider_identity_leak');
  });
});
