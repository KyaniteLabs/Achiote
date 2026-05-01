import { describe, expect, it } from 'vitest';
import {
  pingLocalInference,
  isLocalInferenceUrl,
  createOpenAICompatibleAskSession,
} from '../src/lib/ask-provider.js';

describe('pingLocalInference', () => {
  it('returns true when the endpoint responds 200', async () => {
    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      const body = JSON.parse(init?.body as string);
      expect(body.messages[0].content).toBe('ping');
      expect(body.max_tokens).toBe(1);
      return new Response(null, { status: 200 });
    };
    const result = await pingLocalInference('http://127.0.0.1:1234/v1', 'test-model', null, 5000, fakeFetch as typeof fetch);
    expect(result).toBe(true);
  });

  it('returns false when the endpoint responds non-200', async () => {
    const fakeFetch = async () => new Response(null, { status: 503 });
    const result = await pingLocalInference('http://127.0.0.1:1234/v1', 'test-model', null, 5000, fakeFetch as typeof fetch);
    expect(result).toBe(false);
  });

  it('returns false on network error', async () => {
    const fakeFetch = async () => { throw new Error('ECONNREFUSED'); };
    const result = await pingLocalInference('http://127.0.0.1:1234/v1', 'test-model', null, 5000, fakeFetch as typeof fetch);
    expect(result).toBe(false);
  });

  it('returns false when fetch is aborted by timeout', async () => {
    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        const timer = setTimeout(() => _resolve(new Response(null, { status: 200 })), 10000);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('The operation was aborted', 'AbortError'));
        });
      });
    };
    const result = await pingLocalInference('http://127.0.0.1:1234/v1', 'test-model', null, 1, fakeFetch as typeof fetch);
    expect(result).toBe(false);
  });

  it('includes Authorization header when apiKey is provided', async () => {
    let capturedInit: RequestInit | undefined;
    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return new Response(null, { status: 200 });
    };
    await pingLocalInference('http://127.0.0.1:1234/v1', 'test-model', 'my-secret-key', 5000, fakeFetch as typeof fetch);
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer my-secret-key');
  });

  it('omits Authorization header when apiKey is empty', async () => {
    let capturedInit: RequestInit | undefined;
    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return new Response(null, { status: 200 });
    };
    await pingLocalInference('http://127.0.0.1:1234/v1', 'test-model', '', 5000, fakeFetch as typeof fetch);
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('strips trailing slash from baseUrl', async () => {
    let capturedUrl = '';
    const fakeFetch = async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(null, { status: 200 });
    };
    await pingLocalInference('http://127.0.0.1:1234/v1/', 'test-model', null, 5000, fakeFetch as typeof fetch);
    expect(capturedUrl).toBe('http://127.0.0.1:1234/v1/chat/completions');
  });
});

describe('isLocalInferenceUrl', () => {
  it('recognizes 127.0.0.1', () => {
    expect(isLocalInferenceUrl('http://127.0.0.1:1234/v1')).toBe(true);
  });

  it('recognizes localhost', () => {
    expect(isLocalInferenceUrl('http://localhost:8080/v1')).toBe(true);
  });

  it('recognizes IPv6 loopback ::1 (bracketed in URL)', () => {
    expect(isLocalInferenceUrl('http://[::1]:8080/v1')).toBe(true);
  });

  it('recognizes host.docker.internal', () => {
    expect(isLocalInferenceUrl('http://host.docker.internal:1234/v1')).toBe(true);
  });

  it('recognizes Tailscale 100.x.x.x addresses', () => {
    expect(isLocalInferenceUrl('http://100.64.0.1:8080/v1')).toBe(true);
  });

  it('rejects public URLs', () => {
    expect(isLocalInferenceUrl('https://api.openai.com/v1')).toBe(false);
  });

  it('rejects invalid URLs', () => {
    expect(isLocalInferenceUrl('not-a-url')).toBe(false);
  });
});

describe('OpenAI-compatible provider edge cases', () => {
  it('throws on context-window overflow (finish_reason: length)', async () => {
    const session = createOpenAICompatibleAskSession({
      baseUrl: 'http://127.0.0.1:0/v1',
      apiKey: 'test',
      model: 'test-model',
      tools: [],
      maxTokens: 1024,
      systemPrompt: 'test',
      timeoutMs: 5000,
      fetchImpl: (async () =>
        new Response(JSON.stringify({
          choices: [{
            message: { role: 'assistant', content: 'partial' },
            finish_reason: 'length',
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      ) as typeof fetch,
    });

    await expect(session.create(1024)).rejects.toThrow(
      'Model hit context length limit',
    );
  });

  it('strips <think/> reasoning blocks from model content', async () => {
    const session = createOpenAICompatibleAskSession({
      baseUrl: 'http://127.0.0.1:0/v1',
      apiKey: 'test',
      model: 'test-model',
      tools: [],
      maxTokens: 1024,
      systemPrompt: 'test',
      timeoutMs: 5000,
      fetchImpl: (async () =>
        new Response(JSON.stringify({
          choices: [{
            message: {
              role: 'assistant',
              content: '<think>Let me analyze this carefully</think>The soup is sour dill with potato.',
            },
            finish_reason: 'stop',
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      ) as typeof fetch,
    });

    const result = await session.create(1024);
    expect(result.textBlocks).toEqual(['The soup is sour dill with potato.']);
    expect(result.textBlocks[0]).not.toContain('analyze');
  });

  it('strips multi-line <think/> blocks', async () => {
    const session = createOpenAICompatibleAskSession({
      baseUrl: 'http://127.0.0.1:0/v1',
      apiKey: 'test',
      model: 'test-model',
      tools: [],
      maxTokens: 1024,
      systemPrompt: 'test',
      timeoutMs: 5000,
      fetchImpl: (async () =>
        new Response(JSON.stringify({
          choices: [{
            message: {
              role: 'assistant',
              content: '<think>\nStep 1: consider region\nStep 2: match ingredients\n</think>\n\nTry coconut rice.',
            },
            finish_reason: 'stop',
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      ) as typeof fetch,
    });

    const result = await session.create(1024);
    expect(result.textBlocks).toEqual(['Try coconut rice.']);
  });

  it('strips unclosed <think> reasoning blocks from weak local model content', async () => {
    const session = createOpenAICompatibleAskSession({
      baseUrl: 'http://127.0.0.1:0/v1',
      apiKey: 'test',
      model: 'test-model',
      tools: [],
      maxTokens: 1024,
      systemPrompt: 'test',
      timeoutMs: 5000,
      fetchImpl: (async () =>
        new Response(JSON.stringify({
          choices: [{
            message: {
              role: 'assistant',
              content: '<think>Step 1: reason about horchata and local search. The user wants a sip test.\n\nMinimum viable beverage-memory cue: tiny rice-cinnamon sip.',
            },
            finish_reason: 'stop',
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      ) as typeof fetch,
    });

    const result = await session.create(1024);
    expect(result.textBlocks).toEqual(['Minimum viable beverage-memory cue: tiny rice-cinnamon sip.']);
    expect(result.textBlocks[0]).not.toContain('<think>');
    expect(result.textBlocks[0]).not.toContain('Step 1');
  });

  it('returns empty textBlocks when content is only <think/> blocks', async () => {
    const session = createOpenAICompatibleAskSession({
      baseUrl: 'http://127.0.0.1:0/v1',
      apiKey: 'test',
      model: 'test-model',
      tools: [],
      maxTokens: 1024,
      systemPrompt: 'test',
      timeoutMs: 5000,
      fetchImpl: (async () =>
        new Response(JSON.stringify({
          choices: [{
            message: {
              role: 'assistant',
              content: '<think>Internal reasoning only</think>',
            },
            finish_reason: 'stop',
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      ) as typeof fetch,
    });

    const result = await session.create(1024);
    expect(result.textBlocks).toEqual([]);
  });

  it('preserves normal content without <think/> blocks', async () => {
    const session = createOpenAICompatibleAskSession({
      baseUrl: 'http://127.0.0.1:0/v1',
      apiKey: 'test',
      model: 'test-model',
      tools: [],
      maxTokens: 1024,
      systemPrompt: 'test',
      timeoutMs: 5000,
      fetchImpl: (async () =>
        new Response(JSON.stringify({
          choices: [{
            message: { role: 'assistant', content: 'Clean response with no thinking.' },
            finish_reason: 'stop',
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      ) as typeof fetch,
    });

    const result = await session.create(1024);
    expect(result.textBlocks).toEqual(['Clean response with no thinking.']);
  });
});
