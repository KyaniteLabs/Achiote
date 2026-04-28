import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createAchioteServer } from '../src/index.js';
import {
  buildReconstructionDossier,
  collectFoodMemory,
  generateMinimumViableNostalgiaCue,
  planDishResearch,
} from '../src/lib/memory-workflow.js';
import { extractResearchFindings } from '../src/lib/research-provenance.js';
import type { ResearchRecord } from '../src/lib/types.js';

describe('P2 product trust improvements', () => {
  it('threads dietary/allergen/religious constraints into minimum viable cue safety and substitution logic', () => {
    const memory = collectFoodMemory({ memoryText: 'A browned chewy starch bite with warm spice smell and creamy sauce.' });
    const dossier = buildReconstructionDossier({ memory, researchPlan: planDishResearch(memory) });
    const cue = generateMinimumViableNostalgiaCue({
      dossier,
      constraints: ['vegan', 'peanut allergy', 'halal', 'gluten-free'],
    });

    const combined = [
      ...cue.safetyNotes,
      ...cue.accessibilityPrinciples,
      ...cue.substituteLogic,
    ].join(' ');

    expect(combined).toMatch(/vegan/i);
    expect(combined).toMatch(/peanut allergy/i);
    expect(combined).toMatch(/halal/i);
    expect(combined).toMatch(/gluten-free/i);
    expect(combined).toMatch(/do not use/i);
  });

  it('rejects unvalidated research records before extracting downstream findings', () => {
    const invalid = {
      dishName: 'unknown',
      query: 'unknown',
      sources: [
        { title: '', url: 'not-a-url', sourceType: 'article', accessedAt: '', reliability: 'High', quotedFacts: [] },
      ],
      extractedFacts: {
        namesAndAliases: [],
        regions: [],
        ingredients: [],
        techniques: [],
        sensoryDescriptors: [],
        culturalOccasions: [],
        regionalVariants: [],
      },
      uncertainty: [],
      confidence: 'Low',
      createdAt: '2026-04-21T00:00:00.000Z',
    } as ResearchRecord;

    expect(() => extractResearchFindings(invalid)).toThrow(/Research record validation failed/);
  });

  it('adds an MCP validator for host-synthesized final recipe objects', async () => {
    const server = createAchioteServer({ enableCache: false });
    const client = new Client({ name: 'p2-test', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const valid = await client.callTool({
        name: 'validate_recipe_output',
        arguments: {
          recipe: {
            title: 'Recreated Soup',
            yield: '2 servings',
            prepTime: '10 minutes',
            cookTime: '20 minutes',
            ingredients: [{ item: 'broth', amount: '2 cups' }],
            steps: ['Warm broth.'],
            sensoryAnalysis: 'Warm sour aroma is the target.',
            confidencePerElement: { aroma: 'Medium' },
            whatsDifferent: 'Family-specific seasoning remains unknown.',
          },
        },
      });
      expect(valid.structuredContent).toMatchObject({ valid: true, issues: [] });

      const invalid = await client.callTool({ name: 'validate_recipe_output', arguments: { recipe: { title: '' } } });
      expect(invalid.structuredContent).toMatchObject({ valid: false });
      expect((invalid.structuredContent?.issues as unknown[]).length).toBeGreaterThan(0);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('labels static sourcing and sample memories clearly in product surfaces', () => {
    const landing = fs.readFileSync('docs/landing/index.html', 'utf8');
    const app = fs.readFileSync('docs/landing/app.html', 'utf8');
    const readme = fs.readFileSync('README.md', 'utf8');
    const success = fs.readFileSync('docs/landing/billing-success.html', 'utf8');
    const privacy = fs.readFileSync('docs/landing/privacy.html', 'utf8');
    const terms = fs.readFileSync('docs/landing/terms.html', 'utf8');
    const copyProposal = fs.readFileSync('docs/landing/copy-proposal.md', 'utf8');

    expect(`${landing}\n${app}\n${readme}`).toContain('static sourcing guidance, not live inventory');
    expect(landing).toContain('Sample memories');
    expect(`${landing}\n${success}\n${privacy}\n${terms}`).not.toContain('Illustrative demo');
    expect(`${landing}\n${success}\n${privacy}\n${terms}`).not.toContain('Try the live demo');
    expect(`${landing}\n${success}\n${privacy}\n${terms}`).not.toContain('Use the web demo');
    expect(privacy).toContain('Stripe billing records');
    expect(privacy).not.toContain('billing records after Stripe is configured');
    expect(terms).toContain('payment failure');
    expect(terms).not.toContain('payment failure after billing is enabled');
    expect(copyProposal).toContain('Archived pre-launch copy proposal');
    expect(copyProposal).toContain('not the current production source of truth');
  });

  it('describes local OSS voice as multilingual and immigrant-family friendly without hosted speech claims', () => {
    const app = fs.readFileSync('docs/landing/app.html', 'utf8');
    const script = fs.readFileSync('docs/landing/app.js', 'utf8');
    const architecture = fs.readFileSync('docs/ARCHITECTURE.md', 'utf8');
    const readme = fs.readFileSync('README.md', 'utf8');
    const combined = `${app}\n${script}\n${architecture}\n${readme}`.toLowerCase();

    expect(combined).toContain('local oss speech');
    expect(combined).toContain('auto-detect');
    expect(combined).toContain('accents');
    expect(combined).toContain('immigrant');
    expect(combined).not.toContain('elevenlabs');
    expect(combined).not.toContain('openai speech');
  });

  it('requires the /ask prompt to gate concrete food cues behind the cue tool', () => {
    const server = fs.readFileSync('src/http-server.ts', 'utf8');

    expect(server).toContain('Do not give a concrete food cue');
    expect(server).toContain('generate_minimum_viable_nostalgia');
    expect(server).toContain('clarification-only response');
  });

  it('requires /ask cue prose to use local proxy ingredients instead of buying the suspected food', () => {
    const server = fs.readFileSync('src/http-server.ts', 'utf8');

    expect(server).toContain('Do not tell the user to buy the exact suspected dish, candy, snack, brand, or imported specialty item as the minimum test');
    expect(server).toContain('Build the cue from cheap local pantry or ordinary grocery ingredients first');
  });

  it('preserves current user location for local proxy cue generation', () => {
    const server = fs.readFileSync('src/http-server.ts', 'utf8');

    expect(server).toContain('inferUserLocation');
    expect(server).toContain("toolName === 'collect_food_memory'");
    expect(server).toContain("toolName === 'generate_minimum_viable_nostalgia'");
    expect(server).toContain('ensureLocalCueLanguage');
  });

  it('documents the anonymous preview demo rate-limit override without changing free tier', () => {
    const envExample = fs.readFileSync('.env.example', 'utf8');
    const auth = fs.readFileSync('src/lib/auth.ts', 'utf8');
    const server = fs.readFileSync('src/http-server.ts', 'utf8');

    expect(auth).toContain('free: { mcpCallsPerMonth: 0, webReconstructions: 3 }');
    expect(envExample).toContain('ACHIOTE_ANON_WEB_RECONSTRUCTIONS');
    expect(server).toContain('ACHIOTE_ANON_WEB_RECONSTRUCTIONS');
  });

  it('requires /ask to honor explicit minimum-test requests with sensory clues', () => {
    const server = fs.readFileSync('src/http-server.ts', 'utf8');

    expect(server).toContain('If the user explicitly asks for a minimum test');
    expect(server).toContain('generate_minimum_viable_nostalgia even when dish identity is Low or Unknown');
  });

  it('adds self-hosted key generation and Docker smoke runbooks', () => {
    const pkg = fs.readFileSync('package.json', 'utf8');
    const keygen = fs.readFileSync('scripts/generate-api-key.mjs', 'utf8');
    const dockerSmoke = fs.readFileSync('scripts/docker-smoke.mjs', 'utf8');
    const readme = fs.readFileSync('README.md', 'utf8');

    expect(pkg).toContain('"keygen"');
    expect(pkg).toContain('"docker:smoke"');
    expect(keygen).toContain('ach_');
    expect(dockerSmoke).toContain('docker build');
    expect(readme).toContain('npm run keygen');
    expect(readme).toContain('npm run docker:smoke');
    const dockerignore = fs.readFileSync('.dockerignore', 'utf8');
    expect(dockerignore).toContain('node_modules');
    expect(dockerignore).toContain('.git');
    expect(dockerignore).toContain('dist');
  });
});
