import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { buildReconstructionDossier, collectFoodMemory, generateMinimumViableNostalgiaCue, planDishResearch } from '../src/lib/memory-workflow.js';

function read(path: string): string {
  return fs.readFileSync(path, 'utf8');
}

function extractMinimumCueImplementation(): string {
  const source = read('src/lib/memory-workflow.ts');
  const start = source.indexOf('function textSignals');
  const generatorStart = source.indexOf('export function generateMinimumViableNostalgiaCue');
  const generatorEnd = generatorStart + source.slice(generatorStart).indexOf('\n}') + 2;

  expect(start).toBeGreaterThanOrEqual(0);
  expect(generatorStart).toBeGreaterThan(start);
  expect(generatorEnd).toBeGreaterThan(generatorStart);

  return source.slice(start, generatorEnd);
}

describe('agent guardrails', () => {
  it('keeps the minimum viable cue planner mechanism-driven, not dish/country-specific', () => {
    const implementation = extractMinimumCueImplementation().toLowerCase();
    const forbiddenSpecifics = [
      'boerewors',
      'chakalaka',
      'carima',
      'trinidad',
      'tobago',
      'panama',
      'puerto rican',
      'south african',
      'savannah',
      'bake and shark',
    ];

    for (const forbidden of forbiddenSpecifics) {
      expect(implementation, `minimum cue logic must not hard-code ${forbidden}`).not.toContain(forbidden);
    }

    expect(implementation).toContain('fat-soluble aromatics');
    expect(implementation).toContain('maillard');
    expect(implementation).toContain('starch texture');
    expect(implementation).toContain('acid, sugar, and salt');
  });

  it('requires minimum viable cue output to explain accessibility and substitute logic', () => {
    const types = read('src/lib/types.ts');
    const schemas = read('src/schemas/tool-schemas.ts');

    expect(types).toContain('accessibilityPrinciples: string[]');
    expect(types).toContain('substituteLogic: string[]');
    expect(schemas).toContain('accessibilityPrinciples: z.array(z.string())');
    expect(schemas).toContain('substituteLogic: z.array(z.string())');

    const memory = collectFoodMemory({ memoryText: 'A browned chewy starch bite with a creamy sauce and warm spice smell.' });
    const dossier = buildReconstructionDossier({
      memory,
      researchPlan: planDishResearch(memory),
      researchedFacts: [
        'The memory depends on browned starch texture, fat-soluble spice aroma, and sauce balance.',
      ],
      inferredFacts: [
        'A tiny composed bite can test the mechanism before sourcing exact ingredients.',
      ],
    });
    const cue = generateMinimumViableNostalgiaCue({ dossier, maxEffortMinutes: 10 });

    expect(cue.accessibilityPrinciples.length).toBeGreaterThanOrEqual(3);
    expect(cue.substituteLogic.length).toBeGreaterThanOrEqual(2);
    expect(cue.accessibilityPrinciples.join(' ')).toMatch(/grocery|pantry|cheap|accessible|specialty/i);
    expect(cue.substituteLogic.join(' ')).toMatch(/fat|aroma|starch|acid|salt|sugar|maillard|texture/i);
  });

  it('keeps README scoped to MCP and skill usage, not business planning', () => {
    const readme = read('README.md').toLowerCase();
    const forbidden = ['business plan', 'investor', 'meal kit', 'meal-kit', 'saas pricing', 'pitch deck'];

    for (const phrase of forbidden) {
      expect(readme, `README should not contain ${phrase}`).not.toContain(phrase);
    }

    expect(readme).toContain('model context protocol');
    expect(readme).toContain('minimum viable nostalgia cue');
  });

  it('preserves the host-AI-does-research boundary', () => {
    const architecture = read('docs/ARCHITECTURE.md');
    const roadmap = read('docs/ROADMAP.md');
    const server = read('src/server.ts');

    expect(architecture).toContain('The server does not browse the web itself.');
    expect(roadmap).toContain('Open-ended web research should remain a host AI responsibility.');
    expect(server).toContain('they do not perform live web search unless an external host capability does so separately');
  });

  it('keeps repository-level agent guidance available for weaker future agents', () => {
    const agents = read('AGENTS.md');

    expect(agents).toContain('Minimum viable cues must be');
    expect(agents).toContain('Food-science grounded');
    expect(agents).toContain('Not dish-specific');
    expect(agents).toContain('npm run package:smoke');
  });
});
