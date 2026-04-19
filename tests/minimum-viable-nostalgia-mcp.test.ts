import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMemberBerriesServer } from '../src/index.js';

describe('minimum viable nostalgia MCP tool', () => {
  async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
    const server = createMemberBerriesServer({ enableCache: false });
    const client = new Client({ name: 'minimum-nostalgia-test', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try { return await run(client); } finally { await client.close(); await server.close(); }
  }

  it('returns a smallest-memory-cue object through MCP', async () => {
    await withClient(async (client) => {
      const memory = await client.callTool({
        name: 'collect_food_memory',
        arguments: { memoryText: 'Puerto Rican grandma made something like pass-teh-lay with plantains and pork.' },
      });
      const researchPlan = await client.callTool({ name: 'plan_dish_research', arguments: { memory: memory.structuredContent } });
      const dossier = await client.callTool({
        name: 'build_reconstruction_dossier',
        arguments: {
          memory: memory.structuredContent,
          researchPlan: researchPlan.structuredContent,
          researchedFacts: ['Pasteles are often wrapped in banana leaves and seasoned with sofrito.'],
        },
      });
      const cue = await client.callTool({
        name: 'generate_minimum_viable_nostalgia',
        arguments: { dossier: dossier.structuredContent, maxEffortMinutes: 15 },
      });

      expect(cue.isError).not.toBe(true);
      expect(cue.structuredContent).toMatchObject({
        format: 'aroma-cue',
        effortMinutes: expect.any(Number),
        ingredients: expect.any(Array),
        whyThisIsMinimum: expect.stringContaining('multi-hour'),
      });
    });
  });
});
