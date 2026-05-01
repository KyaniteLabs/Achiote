import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('knowledge-gap canary', () => {
  it('turns canary outputs into structured reference-data gaps without treating tiny cues as recipe failures', async () => {
    const { analyzeKnowledgeGaps } = await import('../scripts/lib/knowledge-gap-canary.mjs');

    const gaps = analyzeKnowledgeGaps([
      {
        mode: 'achiote',
        provider: 'local',
        model: 'tiny-qwen',
        prompt: 'I had something in Panama that sounded like carimanolla.',
        text: 'Minimum viable composed-bite cue First-pass verification bite: a tiny amount of cassava-family carrier, plantain crisped in oil, or tapioca-starch paste.',
        tools: ['plan_tool_workflow', 'collect_food_memory', 'plan_dish_research', 'generate_minimum_viable_nostalgia'],
        quality: [],
      },
      {
        mode: 'achiote',
        provider: 'glm',
        model: 'glm-test',
        prompt: 'Warm sour dill soup with pale chunks.',
        text: 'Minimum viable aroma-sip cue: a tiny amount of water plus the dominant aromatic or spice family. If it works, next ask: Ask what gave the liquid body.',
        tools: ['plan_tool_workflow', 'collect_food_memory', 'plan_dish_research', 'generate_minimum_viable_nostalgia'],
        quality: [],
      },
      {
        mode: 'achiote',
        provider: 'glm',
        model: 'glm-test',
        prompt: 'White coconut sweet with grainy sugar crystals.',
        text: 'Here is a first-pass verification bite: Mix shredded coconut with white sugar and a few drops of water. Microwave 15 seconds, stir, press into a small ball, and let it cool.',
        tools: ['plan_tool_workflow', 'collect_food_memory', 'plan_dish_research', 'generate_minimum_viable_nostalgia'],
        quality: [],
      },
    ]);

    expect(gaps.map((gap: { type: string }) => gap.type)).toEqual(expect.arrayContaining([
      'missing_dish_alias',
      'missing_regional_family',
      'overbroad_family',
    ]));
    expect(gaps.map((gap: { type: string }) => gap.type)).not.toContain('full_recipe_drift');
  });

  it('groups gaps by mechanism signature instead of exact prompt wording', async () => {
    const { analyzeKnowledgeGaps } = await import('../scripts/lib/knowledge-gap-canary.mjs');

    const gaps = analyzeKnowledgeGaps([
      {
        mode: 'achiote',
        provider: 'glm',
        model: 'glm-test',
        prompt: 'A tart green herb broth with pale potato pieces stayed vague.',
        text: 'Minimum viable aroma-sip cue: a tiny amount of water plus the dominant aromatic or spice family. If it works, next ask: Ask what gave the liquid body.',
        tools: ['collect_food_memory', 'generate_minimum_viable_nostalgia'],
        quality: [],
      },
      {
        mode: 'achiote',
        provider: 'local',
        model: 'tiny-test',
        prompt: 'Nobody knows the name, only warm pickle-brine soup with egg bits.',
        text: 'Minimum viable aroma-sip cue: a tiny amount of water plus the dominant aromatic or spice family. If it works, next ask: Ask what gave the liquid body.',
        tools: ['collect_food_memory', 'generate_minimum_viable_nostalgia'],
        quality: [],
      },
    ]);

    const overbroad = gaps.find((gap: { type: string }) => gap.type === 'overbroad_family');

    expect(overbroad).toMatchObject({
      type: 'overbroad_family',
      cueClass: 'sour_herb_soup',
      count: 2,
    });
    expect(overbroad).not.toHaveProperty('prompt');
    expect(overbroad.examples.map((example: { prompt: string }) => example.prompt)).toEqual(expect.arrayContaining([
      'A tart green herb broth with pale potato pieces stayed vague.',
      'Nobody knows the name, only warm pickle-brine soup with egg bits.',
    ]));
  });

  it('exposes a no-provider CLI over existing JSONL artifacts', () => {
    const script = fs.readFileSync('scripts/knowledge-gap-canary.mjs', 'utf8');

    expect(script).toContain('--results');
    expect(script).toContain('analyzeKnowledgeGaps');
    expect(script).not.toMatch(/fetch\(|https?:\/\//);
  });
});
