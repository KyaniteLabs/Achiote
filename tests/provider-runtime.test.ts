import { describe, expect, it } from 'vitest';
import { createProviderRuntime } from '../src/lib/provider-runtime.js';

const tool = {
  name: 'collect_food_memory',
  description: 'collect memory',
  input_schema: { type: 'object', properties: {} },
} as const;

describe('ProviderRuntime', () => {
  it('keeps GLM Anthropic-compatible endpoint style and session selection together', () => {
    const runtime = createProviderRuntime({
      env: {
        ACHIOTE_ASK_PROVIDER: 'glm',
        GLM_MODEL: 'glm-5v-turbo',
        GLM_API_KEY: 'glm-key',
      },
      anthropicClient: {} as never,
      systemPrompt: 'system',
      tools: [tool],
      openAITimeoutMs: 1234,
    });

    expect(runtime.providerKind).toBe('anthropic');
    expect(runtime.profile).toMatchObject({
      provider: 'glm',
      providerKind: 'anthropic',
      endpointStyle: 'anthropic-coding',
      nativeTools: 'unknown',
    });
    expect(runtime.readinessCredentials()).toMatchObject({
      anthropicApiKey: 'glm-key',
      openaiProviderReady: false,
    });
  });

  it('marks OpenRouter free models as rate-limit sensitive and honors explicit native-tool posture', async () => {
    const runtime = createProviderRuntime({
      env: {
        ACHIOTE_ASK_PROVIDER: 'openai',
        OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
        OPENAI_MODEL: 'google/gemma-3-27b-it:free',
        OPENAI_API_KEY: 'sk-router',
        ACHIOTE_ASK_MODEL_SUPPORTS_TOOLS: 'false',
      },
      anthropicClient: {} as never,
      systemPrompt: 'system',
      tools: [tool],
      openAITimeoutMs: 5678,
    });

    expect(runtime.providerKind).toBe('openai');
    expect(runtime.profile).toMatchObject({
      provider: 'openrouter',
      providerKind: 'openai',
      rateLimitSensitive: true,
    });
    expect(await runtime.selectedProviderSupportsNativeTools()).toBe(false);
    expect(runtime.readinessCredentials()).toMatchObject({
      anthropicApiKey: 'openai-compatible-provider',
      anthropicAuthToken: undefined,
      openaiProviderReady: true,
    });
  });

  it('creates OpenAI-compatible sessions for local inference URLs without requiring cloud keys', async () => {
    const runtime = createProviderRuntime({
      env: {
        ACHIOTE_ASK_PROVIDER: 'local',
        LOCAL_INFERENCE_BASE_URL: 'http://127.0.0.1:1234/v1',
        LOCAL_INFERENCE_MODEL: 'qwen3.5-0.8b',
      },
      anthropicClient: {} as never,
      systemPrompt: 'system',
      tools: [tool],
      openAITimeoutMs: 9000,
    });

    const session = runtime.createAskSession({ userMessage: 'memory' });

    expect(runtime.providerKind).toBe('openai');
    expect(runtime.profile).toMatchObject({
      provider: 'local',
      endpointStyle: 'openai-chat-completions',
      recommendedTimeoutMs: expect.any(Number),
    });
    expect(await runtime.selectedProviderSupportsNativeTools()).toBeUndefined();
    expect(session).toMatchObject({
      create: expect.any(Function),
      appendToolResults: expect.any(Function),
      injectDeterministicToolResult: expect.any(Function),
    });
  });
});
