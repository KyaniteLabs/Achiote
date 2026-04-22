import { describe, expect, it } from 'vitest';
import { anthropicTools } from '../src/tools/tool-registry.js';
import { createOpenAICompatibleAskSession, openAICompatibleProviderReady, openAIBaseUrlFromEnv, openAiToolsFromAnthropic, resolveAskProviderKind } from '../src/lib/ask-provider.js';

describe('ask provider compatibility', () => {
  it('maps Anthropic tool definitions into OpenAI-compatible function tools', () => {
    const tools = openAiToolsFromAnthropic(anthropicTools);

    expect(tools[0]).toMatchObject({
      type: 'function',
      function: {
        name: 'collect_food_memory',
        parameters: expect.objectContaining({ type: 'object' }),
      },
    });
    expect(tools.map((tool) => tool.function.name)).toEqual(anthropicTools.map((tool) => tool.name));
  });

  it('requires explicit provider selection before switching away from Anthropic', () => {
    expect(resolveAskProviderKind({ ACHIOTE_ASK_PROVIDER: 'openai' })).toBe('openai');
    expect(resolveAskProviderKind({ ACHIOTE_ASK_PROVIDER: 'lmstudio' })).toBe('openai');
    expect(resolveAskProviderKind({ OPENAI_API_KEY: 'ambient-openai-key' })).toBe('anthropic');
    expect(resolveAskProviderKind({ OPENAI_BASE_URL: 'http://127.0.0.1:1234/v1' })).toBe('anthropic');
    expect(resolveAskProviderKind({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com' })).toBe('anthropic');
  });

  it('resolves OpenAI-compatible base URLs and readiness without pretending localhost is OpenAI', () => {
    expect(openAIBaseUrlFromEnv({ ACHIOTE_ASK_PROVIDER: 'openai' })).toBe('https://api.openai.com/v1');
    expect(openAIBaseUrlFromEnv({ ACHIOTE_ASK_PROVIDER: 'lmstudio' })).toBe('http://127.0.0.1:1234/v1');
    expect(openAICompatibleProviderReady('https://api.openai.com/v1', undefined)).toBe(false);
    expect(openAICompatibleProviderReady('https://api.openai.com/v1', 'sk-test')).toBe(true);
    expect(openAICompatibleProviderReady('http://127.0.0.1:1234/v1', undefined)).toBe(true);
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
});
