import { describe, expect, it } from 'vitest';
import { withClient } from './helpers/mcp-client.js';

describe('minimum viable nostalgia MCP tool', () => {
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
        format: 'bite',
        effortMinutes: expect.any(Number),
        ingredients: expect.any(Array),
        whyThisIsMinimum: expect.stringContaining('food-science mechanisms'),
      });
    });
  });

  it('returns a generic composed bite for researched fried starch dossiers', async () => {
    await withClient(async (client) => {
      const memory = await client.callTool({
        name: 'collect_food_memory',
        arguments: { memoryText: 'carimanola from Panama; my mom made them but said they were too much work' },
      });
      const researchPlan = await client.callTool({ name: 'plan_dish_research', arguments: { memory: memory.structuredContent } });
      const dossier = await client.callTool({
        name: 'build_reconstruction_dossier',
        arguments: {
          memory: memory.structuredContent,
          researchPlan: researchPlan.structuredContent,
          researchedFacts: [
            'Carimañolas are Panamanian fried yuca rolls stuffed with seasoned beef picadillo.',
            'Picadillo often uses garlic, onion, cumin, achiote, oregano, tomato paste, and culantro.',
            'The key texture contrast is crispy fried yuca outside and chewy starch inside.',
          ],
          inferredFacts: ['The fastest confirmation cue is picadillo aroma plus a separate crispy yuca bite.'],
        },
      });
      const cue = await client.callTool({
        name: 'generate_minimum_viable_nostalgia',
        arguments: {
          dossier: dossier.structuredContent,
          researchFindings: {
            researchedFacts: ['Carimañolas are fried yuca rolls with beef picadillo.'],
            inferredFacts: ['Picadillo aroma is the fastest nostalgia trigger.'],
            unknowns: ['family-specific filling'],
            sourceCount: 2,
            confidence: 'High',
          },
          userLocation: 'Long Beach, California',
          maxEffortMinutes: 20,
        },
      });

      expect(cue.isError).not.toBe(true);
      expect(cue.structuredContent).toMatchObject({
        title: expect.stringMatching(/composed-bite|cassava-family/),
        format: 'bite',
        whyThisIsMinimum: expect.stringMatching(/food-science mechanisms|memory mechanisms|crispy\/chewy starch/),
      });
      expect(JSON.stringify(cue.structuredContent)).not.toContain('soup/stew');
      expect(JSON.stringify(cue.structuredContent)).not.toContain('carimañola');
    });
  });


  it('returns accessibility and substitute logic for protein, starch, gravy, and sauce memories', async () => {
    await withClient(async (client) => {
      const memory = await client.callTool({
        name: 'collect_food_memory',
        arguments: {
          memoryText: 'Long coiled grey speckled sausage with mashed potatoes, creamy gravy, and a second orange sauce at a South African place.',
        },
      });
      const researchPlan = await client.callTool({ name: 'plan_dish_research', arguments: { memory: memory.structuredContent } });
      const dossier = await client.callTool({
        name: 'build_reconstruction_dossier',
        arguments: {
          memory: memory.structuredContent,
          researchPlan: researchPlan.structuredContent,
          researchedFacts: [
            'Boerewors is a coiled South African sausage seasoned with coriander, pepper, clove, nutmeg, and vinegar.',
            'The plate included mashed potatoes, creamy gravy, and orange chakalaka-like tomato relish.',
          ],
          inferredFacts: ['Use grocery-store protein and pantry spices before sourcing exact sausage.'],
        },
      });
      const cue = await client.callTool({
        name: 'generate_minimum_viable_nostalgia',
        arguments: { dossier: dossier.structuredContent, maxEffortMinutes: 20 },
      });

      expect(cue.isError).not.toBe(true);
      expect(cue.structuredContent).toMatchObject({
        title: expect.stringContaining('composed-bite'),
        accessibilityPrinciples: expect.arrayContaining([expect.stringContaining('grocery-store carriers')]),
        substituteLogic: expect.arrayContaining([expect.stringContaining('fat-soluble aromatics')]),
      });
      expect(String(cue.structuredContent?.title ?? '')).not.toMatch(/boerewors|sausage|South African/i);
    });
  });

});
