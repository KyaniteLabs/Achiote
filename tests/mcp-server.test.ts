import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMemberBerriesServer } from '../src/index.js';

describe('Member Berries MCP server', () => {
  it('registers six annotated tools with structured output schemas', async () => {
    const server = createMemberBerriesServer({ enableCache: false });
    const client = new Client({ name: 'member-berries-test', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        'analyze_nostalgic_dish',
        'discover_regional_similars',
        'find_sensory_substitutes',
        'generate_recipe',
        'resolve_dish_name',
        'source_ingredients',
      ]);
      for (const tool of tools) {
        expect(tool.outputSchema).toBeTruthy();
        expect(Object.keys(tool.outputSchema?.properties ?? {})).not.toHaveLength(0);
        expect(tool.annotations?.readOnlyHint).toBe(true);
        expect(tool.annotations?.destructiveHint).toBe(false);
        expect(tool.annotations?.idempotentHint).toBe(true);
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('returns structuredContent and backwards-compatible JSON text', async () => {
    const server = createMemberBerriesServer({ enableCache: false });
    const client = new Client({ name: 'member-berries-test', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.callTool({
        name: 'resolve_dish_name',
        arguments: { input: 'perogi' },
      });

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        input: 'perogi',
        canonicalName: 'dumpling',
        confidence: 'Medium',
      });
      expect(JSON.parse(result.content[0].type === 'text' ? result.content[0].text : '{}')).toMatchObject(
        result.structuredContent,
      );
    } finally {
      await client.close();
      await server.close();
    }
  });
});
