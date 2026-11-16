import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createAchioteServer } from '../src/server.js';
import { defaultToolExecutionContext, executeToolDefinition } from '../src/tools/tool-registry.js';

describe('search_web controls (AC-1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('makes no network call when ACHIOTE_DISABLE_SEARCH_WEB=true, even with a key set', async () => {
    vi.stubEnv('SERPER_API_KEY', 'test-key');
    vi.stubEnv('ACHIOTE_DISABLE_SEARCH_WEB', 'true');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await executeToolDefinition('search_web', { query: 'mole negro' }, defaultToolExecutionContext);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((result.payload as { results: unknown[] }).results).toEqual([]);
  });

  it('passes a timeout signal to the search request', async () => {
    vi.stubEnv('SERPER_API_KEY', 'test-key');
    vi.stubEnv('ACHIOTE_DISABLE_SEARCH_WEB', 'false');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ organic: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await executeToolDefinition('search_web', { query: 'mole negro' }, defaultToolExecutionContext);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('advertises search_web as open-world, not closed-world read-only', async () => {
    const server = createAchioteServer({ enableCache: false });
    const client = new Client({ name: 'achiote-test', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const { tools } = await client.listTools();
      const search = tools.find((t) => t.name === 'search_web');
      expect(search?.annotations?.openWorldHint).toBe(true);
      // every other granular tool stays closed-world
      for (const t of tools.filter((x) => !['search_web', 'reconstruct_food_memory'].includes(x.name))) {
        expect(t.annotations?.openWorldHint).toBe(false);
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
});
