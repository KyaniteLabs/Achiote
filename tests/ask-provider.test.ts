import { describe, expect, it } from 'vitest';
import { anthropicTools } from '../src/tools/tool-registry.js';
import Anthropic from '@anthropic-ai/sdk';
import { createAnthropicAskSession, createOpenAICompatibleAskSession, defaultGlmEndpointStyleForModel, isOpenRouterFreeModel, isOpenRouterUrl, openAICompatibleProviderReady, openAIBaseUrlFromEnv, openAiToolsFromAnthropic, openRouterCatalogModelSupportsParameter, resolveAskModel, resolveAskProviderKind, anthropicBaseUrlFromEnv, resolveGlmEndpointStyle, resolveLocalInferenceEndpointStyle, resolveProviderCapabilityProfile } from '../src/lib/ask-provider.js';

describe('ask provider compatibility', () => {
  it('maps Anthropic tool definitions into OpenAI-compatible function tools', () => {
    const tools = openAiToolsFromAnthropic(anthropicTools);

    expect(tools[0]).toMatchObject({
      type: 'function',
      function: {
        name: 'plan_tool_workflow',
        parameters: expect.objectContaining({ type: 'object' }),
      },
    });
    expect(tools.map((tool) => tool.function.name)).toEqual(anthropicTools.map((tool) => tool.name));
  });

  it('requires explicit provider selection before switching away from Anthropic', () => {
    expect(resolveAskProviderKind({ ACHIOTE_ASK_PROVIDER: 'openai' })).toBe('openai');
    expect(resolveAskProviderKind({ ACHIOTE_ASK_PROVIDER: 'lmstudio' })).toBe('openai');
    expect(resolveAskProviderKind({ ACHIOTE_ASK_PROVIDER: 'lmstudio', LMSTUDIO_ENDPOINT_STYLE: 'anthropic-messages' })).toBe('anthropic');
    expect(resolveAskProviderKind({ ACHIOTE_ASK_PROVIDER: 'glm' })).toBe('anthropic');
    expect(resolveAskProviderKind({ ACHIOTE_ASK_PROVIDER: 'glm', ACHIOTE_ASK_MODEL: 'GLM-4.5-Air' })).toBe('openai');
    expect(resolveAskProviderKind({ ACHIOTE_ASK_PROVIDER: 'glm', GLM_ENDPOINT_STYLE: 'openai-coding' })).toBe('openai');
    expect(resolveAskProviderKind({ ACHIOTE_ASK_PROVIDER: 'zhipu' })).toBe('anthropic');
    expect(resolveAskProviderKind({ OPENAI_API_KEY: 'ambient-openai-key' })).toBe('anthropic');
    expect(resolveAskProviderKind({ OPENAI_BASE_URL: 'http://127.0.0.1:1234/v1' })).toBe('anthropic');
    expect(resolveAskProviderKind({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com' })).toBe('anthropic');
  });

  it('resolves OpenAI-compatible base URLs and readiness without pretending localhost is OpenAI', () => {
    expect(openAIBaseUrlFromEnv({ ACHIOTE_ASK_PROVIDER: 'openai' })).toBe('https://api.openai.com/v1');
    expect(openAIBaseUrlFromEnv({ ACHIOTE_ASK_PROVIDER: 'lmstudio' })).toBe('http://127.0.0.1:1234/v1');
    expect(openAIBaseUrlFromEnv({ ACHIOTE_ASK_PROVIDER: 'lmstudio', LMSTUDIO_BASE_URL: 'http://100.66.225.85:1234' })).toBe('http://100.66.225.85:1234/v1');
    expect(openAIBaseUrlFromEnv({ ACHIOTE_ASK_PROVIDER: 'glm', GLM_ENDPOINT_STYLE: 'openai-coding' })).toBe('https://api.z.ai/api/coding/paas/v4');
    expect(openAIBaseUrlFromEnv({ ACHIOTE_ASK_PROVIDER: 'glm', GLM_ENDPOINT_STYLE: 'openai-coding', GLM_OPENAI_BASE_URL: 'https://custom.z.ai/v4' })).toBe('https://custom.z.ai/v4');
    expect(openAICompatibleProviderReady('https://api.openai.com/v1', undefined)).toBe(false);
    expect(openAICompatibleProviderReady('https://api.openai.com/v1', 'sk-test')).toBe(true);
    expect(openAICompatibleProviderReady('http://127.0.0.1:1234/v1', undefined)).toBe(true);
  });

  it('detects OpenRouter URLs and per-model supported parameters from catalog metadata', () => {
    expect(isOpenRouterUrl('https://openrouter.ai/api/v1')).toBe(true);
    expect(isOpenRouterUrl('https://api.openai.com/v1')).toBe(false);
    expect(openRouterCatalogModelSupportsParameter({
      data: [
        { id: 'baidu/qianfan-ocr-fast:free', supported_parameters: ['max_tokens'] },
        { id: 'openai/gpt-oss-20b:free', supported_parameters: ['tools', 'tool_choice'] },
      ],
    }, 'baidu/qianfan-ocr-fast:free', 'tools')).toBe(false);
    expect(openRouterCatalogModelSupportsParameter({
      data: [
        { id: 'openai/gpt-oss-20b:free', supported_parameters: ['tools', 'tool_choice'] },
      ],
    }, 'openai/gpt-oss-20b:free', 'tools')).toBe(true);
    expect(openRouterCatalogModelSupportsParameter({ data: [] }, 'missing/model', 'tools')).toBe(false);
  });

  it('resolves Anthropic-compatible base URLs for GLM/Zhipu', () => {
    expect(anthropicBaseUrlFromEnv({ ACHIOTE_ASK_PROVIDER: 'glm' })).toBe('https://api.z.ai/api/anthropic');
    expect(anthropicBaseUrlFromEnv({ ACHIOTE_ASK_PROVIDER: 'glm', GLM_ENDPOINT_STYLE: 'openai-coding' })).toBeUndefined();
    expect(anthropicBaseUrlFromEnv({ ACHIOTE_ASK_PROVIDER: 'zhipu' })).toBe('https://api.z.ai/api/anthropic');
    expect(anthropicBaseUrlFromEnv({ GLM_BASE_URL: 'https://custom.z.ai/api/anthropic' })).toBe('https://custom.z.ai/api/anthropic');
    expect(anthropicBaseUrlFromEnv({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com' })).toBe('https://api.anthropic.com');
    expect(anthropicBaseUrlFromEnv({})).toBeUndefined();
  });

  it('treats GLM Coding Plan endpoint style as a per-model experiment dimension', () => {
    expect(resolveGlmEndpointStyle({ ACHIOTE_ASK_PROVIDER: 'glm', ACHIOTE_ASK_MODEL: 'GLM-5.1' })).toBe('anthropic-coding');
    expect(resolveGlmEndpointStyle({ ACHIOTE_ASK_PROVIDER: 'glm', ACHIOTE_ASK_MODEL: 'GLM-5-Turbo' })).toBe('anthropic-coding');
    expect(resolveGlmEndpointStyle({ ACHIOTE_ASK_PROVIDER: 'glm', ACHIOTE_ASK_MODEL: 'GLM-4.7' })).toBe('anthropic-coding');
    expect(defaultGlmEndpointStyleForModel('GLM-4.5-Air')).toBe('openai-coding');
    expect(defaultGlmEndpointStyleForModel('GLM-4.5-Flash')).toBe('openai-coding');
    expect(resolveGlmEndpointStyle({ ACHIOTE_ASK_PROVIDER: 'glm', ACHIOTE_ASK_MODEL: 'GLM-4.5-Air' })).toBe('openai-coding');
    expect(resolveGlmEndpointStyle({ ACHIOTE_ASK_PROVIDER: 'glm', ACHIOTE_ASK_MODEL: 'GLM-4.5-Air', GLM_ENDPOINT_STYLE: 'openai-coding' })).toBe('openai-coding');
    expect(resolveGlmEndpointStyle({ ACHIOTE_ASK_PROVIDER: 'glm', ACHIOTE_ASK_MODEL: 'GLM-4.5-Air', GLM_ENDPOINT_STYLE: 'anthropic-coding' })).toBe('anthropic-coding');
    expect(resolveGlmEndpointStyle({ ACHIOTE_ASK_PROVIDER: 'glm', ACHIOTE_ASK_MODEL: 'GLM-4.5-Flash', GLM_COMPATIBILITY: 'openai' })).toBe('openai-coding');
    expect(resolveGlmEndpointStyle({ ACHIOTE_ASK_PROVIDER: 'openai' })).toBeUndefined();
  });

  it('uses GLM model variables even when old GLM families route through OpenAI-compatible coding endpoints', () => {
    expect(resolveAskModel({
      ACHIOTE_ASK_PROVIDER: 'glm',
      GLM_MODEL: 'GLM-4.5-Flash',
      OPENAI_MODEL: 'wrong-openai-model',
    })).toBe('GLM-4.5-Flash');
    expect(openAIBaseUrlFromEnv({
      ACHIOTE_ASK_PROVIDER: 'glm',
      GLM_MODEL: 'GLM-4.5-Flash',
    })).toBe('https://api.z.ai/api/coding/paas/v4');
  });

  it('builds provider capability profiles for GLM model families and OpenRouter free models', () => {
    expect(resolveProviderCapabilityProfile({
      ACHIOTE_ASK_PROVIDER: 'glm',
      ACHIOTE_ASK_MODEL: 'GLM-5.1',
    })).toMatchObject({
      provider: 'glm',
      providerKind: 'anthropic',
      model: 'GLM-5.1',
      endpointStyle: 'anthropic-coding',
      compatibilitySource: 'model-family',
    });

    expect(resolveProviderCapabilityProfile({
      ACHIOTE_ASK_PROVIDER: 'glm',
      GLM_MODEL: 'GLM-4.5-Flash',
    })).toMatchObject({
      provider: 'glm',
      providerKind: 'openai',
      model: 'GLM-4.5-Flash',
      endpointStyle: 'openai-coding',
      baseUrl: 'https://api.z.ai/api/coding/paas/v4',
      compatibilitySource: 'model-family',
    });

    const openRouterProfile = resolveProviderCapabilityProfile({
      ACHIOTE_ASK_PROVIDER: 'openai',
      OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
      OPENAI_MODEL: 'baidu/qianfan-ocr-fast:free',
    }, {
      data: [{ id: 'baidu/qianfan-ocr-fast:free', supported_parameters: ['max_tokens'] }],
    });
    expect(isOpenRouterFreeModel(openRouterProfile.model)).toBe(true);
    expect(openRouterProfile).toMatchObject({
      provider: 'openrouter',
      providerKind: 'openai',
      endpointStyle: 'openai-chat-completions',
      nativeTools: 'unsupported',
      rateLimitSensitive: true,
      recommendedTimeoutMs: 240_000,
      compatibilitySource: 'catalog',
    });

    expect(resolveProviderCapabilityProfile({
      ACHIOTE_ASK_PROVIDER: 'openai',
      OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
      OPENAI_MODEL: 'openai/gpt-oss-20b:free',
    }, {
      data: [{ id: 'openai/gpt-oss-20b:free', supported_parameters: ['tools', 'tool_choice'] }],
    })).toMatchObject({
      nativeTools: 'supported',
      nativeToolChoice: 'supported',
      rateLimitSensitive: true,
    });
  });

  it('treats LM Studio endpoint style as a local inference routing and telemetry dimension', () => {
    expect(resolveLocalInferenceEndpointStyle({ ACHIOTE_ASK_PROVIDER: 'lmstudio' })).toBe('openai-chat-completions');
    expect(resolveLocalInferenceEndpointStyle({ ACHIOTE_ASK_PROVIDER: 'lmstudio', LMSTUDIO_ENDPOINT_STYLE: 'anthropic' })).toBe('anthropic-messages');
    expect(resolveLocalInferenceEndpointStyle({ ACHIOTE_ASK_PROVIDER: 'lmstudio', LMSTUDIO_ENDPOINT_STYLE: 'responses' })).toBe('openai-responses');
    expect(resolveLocalInferenceEndpointStyle({ ACHIOTE_ASK_PROVIDER: 'lmstudio', LMSTUDIO_ENDPOINT_STYLE: 'native-chat' })).toBe('native-chat');
  });

  it('does not default normal Anthropic sessions to a GLM model', () => {
    expect(resolveAskModel({ ANTHROPIC_API_KEY: 'test-key' })).not.toBe('glm-5v-turbo');
    expect(resolveAskModel({ ACHIOTE_ASK_PROVIDER: 'anthropic', ANTHROPIC_MODEL: 'claude-test' })).toBe('claude-test');
    expect(resolveAskModel({ ACHIOTE_ASK_PROVIDER: 'glm' })).toBe('glm-5v-turbo');
  });


  it('throws on malformed OpenAI-compatible tool arguments instead of swallowing them', async () => {
    const session = createOpenAICompatibleAskSession({
      model: 'local-model',
      systemPrompt: 'Use tools first.',
      userMessage: 'memory',
      tools: anthropicTools.slice(0, 1),
      baseUrl: 'http://local.test/v1',
      timeoutMs: 30_000,
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: 'call_bad', type: 'function', function: { name: 'collect_food_memory', arguments: '{bad' } }],
          },
          finish_reason: 'tool_calls',
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    });

    await expect(session.create(128)).rejects.toThrow('Failed to parse tool arguments');
  });

  it('runs an OpenAI-compatible tool-call cycle', async () => {
    const requests: unknown[] = [];
    const session = createOpenAICompatibleAskSession({
      model: 'local-model',
      systemPrompt: 'Use tools first.',
      userMessage: 'memory',
      tools: anthropicTools.slice(0, 1),
      baseUrl: 'http://local.test/v1',
      timeoutMs: 30_000,
      fetchImpl: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({
          choices: [requests.length === 1
            ? {
                message: {
                  role: 'assistant',
                  content: '',
                  tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'collect_food_memory', arguments: '{"memoryText":"soup"}' } }],
                },
                finish_reason: 'tool_calls',
              }
            : { message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    const first = await session.create(128);
    expect(first.toolCalls).toEqual([{ id: 'call_1', name: 'collect_food_memory', input: { memoryText: 'soup' } }]);
    session.appendToolResults(first, [{ id: 'call_1', content: '{"ok":true}' }]);
    const second = await session.create(128);

    expect(second.textBlocks).toEqual(['done']);
    expect(requests[1]).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' }),
      ]),
    });
  });

  it('can replace OpenAI-compatible tool transcript history with a compact synthesis case file', async () => {
    const requests: Array<{ messages: Array<{ role?: string; content?: unknown; tool_call_id?: string }>; tools?: unknown[] }> = [];
    const session = createOpenAICompatibleAskSession({
      model: 'local-model',
      systemPrompt: 'Use tools first.',
      userMessage: 'memory',
      tools: anthropicTools.slice(0, 1),
      baseUrl: 'http://local.test/v1',
      timeoutMs: 30_000,
      fetchImpl: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    session.injectDeterministicToolResult('deterministic_plan', 'plan_tool_workflow', { userMessage: 'memory' }, { workflowSteps: [] });
    session.compactForSynthesis('Achiote compact case file:\n- User-said evidence: memory');
    await session.create(128);

    expect(requests[0].messages).toEqual([
      { role: 'system', content: 'Use tools first.' },
      expect.objectContaining({ role: 'user' }),
      { role: 'user', content: 'Achiote compact case file:\n- User-said evidence: memory' },
    ]);
    expect(requests[0].messages.some((message) => message.role === 'tool' || message.tool_call_id)).toBe(false);
    expect(requests[0].tools).toBeUndefined();
  });

  it('injects deterministic tool results into OpenAI-compatible message history before create', async () => {
    const requests: Array<{ messages: unknown[] }> = [];
    const session = createOpenAICompatibleAskSession({
      model: 'local-model',
      systemPrompt: 'Use tools first.',
      userMessage: 'memory',
      tools: anthropicTools.slice(0, 1),
      baseUrl: 'http://local.test/v1',
      timeoutMs: 30_000,
      fetchImpl: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    session.injectDeterministicToolResult(
      'deterministic_plan',
      'plan_tool_workflow',
      { userMessage: 'memory' },
      { detectedIntent: 'nostalgic_memory', workflowSteps: [{ tool: 'collect_food_memory' }] },
    );
    await session.create(128);

    expect(requests[0].messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        content: null,
        tool_calls: [expect.objectContaining({
          id: 'deterministic_plan',
          type: 'function',
          function: {
            name: 'plan_tool_workflow',
            arguments: JSON.stringify({ userMessage: 'memory' }),
          },
        })],
      }),
      expect.objectContaining({
        role: 'tool',
        tool_call_id: 'deterministic_plan',
        content: JSON.stringify({ detectedIntent: 'nostalgic_memory', workflowSteps: [{ tool: 'collect_food_memory' }] }),
      }),
    ]));
  });

  it('injects deterministic tool results into Anthropic message history before create', async () => {
    const captured: { messages?: unknown[]; tools?: unknown[] }[] = [];
    const fakeClient = {
      messages: {
        create: async (params: { messages?: unknown[]; tools?: unknown[] }) => {
          captured.push(params);
          return {
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
          } as unknown as Anthropic.Messages.Message;
        },
      },
    } as unknown as Anthropic;

    const session = createAnthropicAskSession({
      client: fakeClient,
      model: 'test-model',
      systemPrompt: 'sys',
      userMessage: 'memory',
      tools: anthropicTools.slice(0, 1),
    });

    session.injectDeterministicToolResult(
      'deterministic_plan',
      'plan_tool_workflow',
      { userMessage: 'memory' },
      { detectedIntent: 'nostalgic_memory' },
    );
    await session.create(128);

    expect(captured[0].messages).toEqual(expect.arrayContaining([
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'deterministic_plan',
          name: 'plan_tool_workflow',
          input: { userMessage: 'memory' },
        }],
      },
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'deterministic_plan',
          content: JSON.stringify({ detectedIntent: 'nostalgic_memory' }),
        }],
      },
    ]));
  });

  it('can replace Anthropic tool transcript history with a compact synthesis case file', async () => {
    const captured: { messages?: unknown[]; tools?: unknown[] }[] = [];
    const fakeClient = {
      messages: {
        create: async (params: { messages?: unknown[]; tools?: unknown[] }) => {
          captured.push(params);
          return {
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
          } as unknown as Anthropic.Messages.Message;
        },
      },
    } as unknown as Anthropic;

    const session = createAnthropicAskSession({
      client: fakeClient,
      model: 'test-model',
      systemPrompt: 'sys',
      userMessage: 'memory',
      tools: [],
    });

    session.injectDeterministicToolResult('deterministic_plan', 'plan_tool_workflow', { userMessage: 'memory' }, { workflowSteps: [] });
    session.compactForSynthesis('Achiote compact case file:\n- User-said evidence: memory');
    await session.create(128);

    expect(captured[0].messages).toEqual([
      expect.objectContaining({ role: 'user' }),
      { role: 'user', content: 'Achiote compact case file:\n- User-said evidence: memory' },
    ]);
    expect(captured[0].tools).toEqual([]);
  });

  it('embeds images as Anthropic content blocks', async () => {
    const captured: { messages?: unknown[] }[] = [];
    const fakeClient = {
      messages: {
        create: async (params: { messages?: unknown[] }) => {
          captured.push(params);
          return {
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
          } as unknown as Anthropic.Messages.Message;
        },
      },
    } as unknown as Anthropic;

    const session = createAnthropicAskSession({
      client: fakeClient,
      model: 'test-model',
      systemPrompt: 'sys',
      userMessage: 'What is this dish?',
      tools: [],
      images: [{ base64: 'abc123', mediaType: 'image/jpeg' }],
    });

    await session.create(128);
    const lastMessage = (captured[0].messages as Array<{ role: string; content: unknown }>).at(-1);
    expect(lastMessage).toMatchObject({
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'abc123' } },
        { type: 'text', text: 'What is this dish?' },
      ],
    });
  });

  it('embeds images as OpenAI-compatible vision content', async () => {
    const requests: unknown[] = [];
    const session = createOpenAICompatibleAskSession({
      model: 'local-model',
      systemPrompt: 'sys',
      userMessage: 'What is this dish?',
      tools: [],
      baseUrl: 'http://local.test/v1',
      timeoutMs: 30_000,
      images: [{ base64: 'abc123', mediaType: 'image/png' }],
      fetchImpl: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    await session.create(128);
    const payload = requests[0] as { messages: Array<{ role: string; content: unknown }> };
    const userMessage = payload.messages.find((m) => m.role === 'user');
    expect(userMessage).toMatchObject({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
        { type: 'text', text: 'What is this dish?' },
      ],
    });
  });
});
