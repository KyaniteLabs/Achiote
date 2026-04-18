import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMemberBerriesServer } from '../src/index.js';

describe('food memory reconstruction e2e flow', () => {
  async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
    const server = createMemberBerriesServer({ enableCache: false });
    const client = new Client({ name: 'reconstruction-e2e-test', version: '0.0.0' });
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

  it('executes memory fragment to research dossier to recipe-generation handoff', async () => {
    await withClient(async (client) => {
      const collected = await client.callTool({
        name: 'collect_food_memory',
        arguments: {
          memoryText:
            "My mom said my Puerto Rican grandma made something that sounded like pass-teh-lay. I don't speak Spanish. Maybe plantains or pork?",
          userLocation: 'Orlando, FL',
        },
      });
      expect(collected.isError).not.toBe(true);
      expect(collected.structuredContent).toMatchObject({
        extractedClues: {
          culturalOrRegionalHints: expect.arrayContaining(['Puerto Rican']),
          rememberedIngredients: expect.arrayContaining(['plantains', 'pork']),
        },
      });

      const researchPlan = await client.callTool({
        name: 'plan_dish_research',
        arguments: { memory: collected.structuredContent },
      });
      expect(researchPlan.isError).not.toBe(true);
      expect(researchPlan.structuredContent).toMatchObject({ researchRequired: true });
      const hypothesisNames = (researchPlan.structuredContent?.hypotheses as { name: string }[]).map(
        (hypothesis) => hypothesis.name,
      );
      expect(hypothesisNames).toEqual(expect.arrayContaining(['pasteles', 'pastelón', 'piononos']));

      const familyQuestions = await client.callTool({
        name: 'generate_family_followup_questions',
        arguments: { memory: collected.structuredContent, researchPlan: researchPlan.structuredContent },
      });
      expect(familyQuestions.isError).not.toBe(true);
      expect((familyQuestions.structuredContent?.questions as string[]).join(' ')).toContain('wrapped');

      const dossier = await client.callTool({
        name: 'build_reconstruction_dossier',
        arguments: {
          memory: collected.structuredContent,
          researchPlan: researchPlan.structuredContent,
          researchedFacts: [
            'Pasteles are a Puerto Rican holiday-associated hypothesis often connected with wrapped, steamed masa packets.',
            'Pastelón is a separate Puerto Rican/Caribbean plantain casserole hypothesis to verify.',
          ],
          inferredFacts: ['The sound-alike fragment alone is not enough to finalize one dish without clarification.'],
        },
      });
      expect(dossier.isError).not.toBe(true);
      expect(dossier.structuredContent).toMatchObject({
        title: 'Food Memory Reconstruction Dossier',
        evidenceLedger: {
          userSaid: expect.any(Array),
          researched: expect.any(Array),
          inferred: expect.any(Array),
          unknown: expect.arrayContaining(['exact dish identity']),
        },
        recreationStrategy: expect.arrayContaining([
          expect.stringContaining('Do not finalize a recipe until the top hypothesis is confirmed'),
        ]),
      });

      const sensory = await client.callTool({
        name: 'analyze_nostalgic_dish',
        arguments: {
          description:
            'Puerto Rican family memory around pass-teh-lay; likely holiday food with plantain or pork clues; exact dish still uncertain.',
          region: 'Puerto Rican / Caribbean',
        },
      });
      expect(sensory.isError).not.toBe(true);
      expect(sensory.structuredContent).toHaveProperty('sensoryDimensions');
      expect(String(sensory.structuredContent?.promptForAgent)).toContain('nostalgia-critical');

      const substitutes = await client.callTool({
        name: 'find_sensory_substitutes',
        arguments: { ingredient: 'banana leaves', location: 'Orlando, FL' },
      });
      expect(substitutes.isError).not.toBe(true);
      expect(substitutes.structuredContent).toHaveProperty('promptForAgent');

      const sourcing = await client.callTool({
        name: 'source_ingredients',
        arguments: { ingredients: ['plantains', 'pork', 'banana leaves'], location: 'Orlando, FL' },
      });
      expect(sourcing.isError).not.toBe(true);
      expect(sourcing.structuredContent).toHaveProperty('promptForAgent');

      const recipe = await client.callTool({
        name: 'generate_recipe',
        arguments: {
          dishDescription: 'Best-effort Puerto Rican food-memory reconstruction for pass-teh-lay fragment',
          location: 'Orlando, FL',
          sensoryAnalysis: JSON.stringify(sensory.structuredContent),
          substitutions: JSON.stringify(substitutes.structuredContent),
          sourcing: JSON.stringify(sourcing.structuredContent),
        },
      });
      expect(recipe.isError).not.toBe(true);
      expect(recipe.structuredContent).toMatchObject({
        expectedOutputSchema: {
          title: expect.stringContaining('Recipe name'),
          ingredients: expect.stringContaining('Array'),
          confidencePerElement: expect.stringContaining('High'),
        },
      });
      expect(String(recipe.structuredContent?.promptForAgent)).toContain('Generate the complete reverse-engineered recipe');
      expect(String(recipe.structuredContent?.promptForAgent)).toContain('self-critique');
    });
  }, 20_000);
});
