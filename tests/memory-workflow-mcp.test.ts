import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMemberBerriesServer } from '../src/index.js';

describe('memory workflow MCP tools', () => {
  async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
    const server = createMemberBerriesServer({ enableCache: false });
    const client = new Client({ name: 'memory-workflow-test', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      return await run(client);
    } finally {
      await client.close();
      await server.close();
    }
  }

  it('exposes the research-first memory workflow tools', async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        'collect_food_memory',
        'plan_dish_research',
        'build_reconstruction_dossier',
        'generate_family_followup_questions',
      ]));
    });
  });

  it('runs the Puerto Rican fragment flow through MCP structured content', async () => {
    await withClient(async (client) => {
      const collected = await client.callTool({
        name: 'collect_food_memory',
        arguments: {
          memoryText: "My mom said my Puerto Rican grandma made something that sounded like pass-teh-lay. I don't speak Spanish. Maybe plantains or pork?",
          userLocation: 'Orlando, FL',
        },
      });
      expect(collected.structuredContent).toMatchObject({
        extractedClues: {
          culturalOrRegionalHints: expect.arrayContaining(['Puerto Rican']),
          rememberedIngredients: expect.arrayContaining(['plantains', 'pork']),
        },
      });

      const plan = await client.callTool({
        name: 'plan_dish_research',
        arguments: { memory: collected.structuredContent },
      });
      expect(plan.structuredContent).toMatchObject({ researchRequired: true });
      expect((plan.structuredContent?.hypotheses as { name: string }[]).map((hypothesis) => hypothesis.name)).toEqual(
        expect.arrayContaining(['pasteles', 'pastelón']),
      );

      const dossier = await client.callTool({
        name: 'build_reconstruction_dossier',
        arguments: {
          memory: collected.structuredContent,
          researchPlan: plan.structuredContent,
          researchedFacts: ['Pasteles and pastelón are distinct Puerto Rican food hypotheses to verify.'],
          inferredFacts: ['The remembered sound alone is not enough to finalize a recipe.'],
        },
      });
      expect(dossier.structuredContent).toMatchObject({
        title: 'Food Memory Reconstruction Dossier',
        evidenceLedger: {
          userSaid: expect.any(Array),
          researched: expect.any(Array),
          inferred: expect.any(Array),
          unknown: expect.any(Array),
        },
      });
    });
  });

  it('rejects malformed dependent tool inputs instead of casting unknown objects', async () => {
    await withClient(async (client) => {
      const result = await client.callTool({
        name: 'plan_dish_research',
        arguments: { memory: { rawMemory: 'missing required collected-memory fields' } },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].type === 'text' ? result.content[0].text : '').toContain('Input validation error');
    });
  });

  it('displays a concise intake summary while preserving structured content', async () => {
    await withClient(async (client) => {
      const collected = await client.callTool({
        name: 'collect_food_memory',
        arguments: {
          memoryText: 'I ate a shark one time in Trinidad and Tobago',
          knownRegion: 'Trinidad and Tobago',
          userLocation: 'Long Beach, California',
        },
      });

      const displayText = collected.content[0].type === 'text' ? collected.content[0].text : '';
      expect(displayText).toContain('Food memory captured.');
      expect(displayText).toContain('Ingredient clue: shark');
      expect(displayText).toContain('How was the shark served');
      expect(() => JSON.parse(displayText)).toThrow();
      expect(collected.structuredContent).toMatchObject({
        extractedClues: {
          culturalOrRegionalHints: expect.arrayContaining(['Trinidad and Tobago']),
          rememberedIngredients: expect.arrayContaining(['shark']),
        },
      });
    });
  });

});
