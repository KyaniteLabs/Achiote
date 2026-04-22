import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { anthropicTools, toolRegistry, toolNames, outputSchemas, findToolDefinition, executeToolDefinition, defaultToolExecutionContext } from '../src/tools/tool-registry.js';

const expectedToolNames = [
  'analyze_nostalgic_dish',
  'build_reconstruction_dossier',
  'build_research_record',
  'collect_food_memory',
  'discover_regional_similars',
  'extract_research_findings',
  'find_sensory_substitutes',
  'generate_family_followup_questions',
  'generate_minimum_viable_nostalgia',
  'generate_recipe',
  'plan_dish_research',
  'resolve_dish_name',
  'source_ingredients',
  'validate_recipe_output',
  'validate_research_record',
];

describe('shared tool registry', () => {
  it('contains the complete launch tool set in sorted order', () => {
    expect(toolNames).toEqual(expectedToolNames);
    expect(toolRegistry.map((tool) => tool.name).sort()).toEqual(expectedToolNames);
  });

  it('requires every tool to define MCP metadata, HTTP metadata, output schema, and executor', () => {
    for (const tool of toolRegistry) {
      expect(tool.name).toBeTruthy();
      expect(tool.mcp.title).toBeTruthy();
      expect(tool.mcp.description).toBeTruthy();
      expect(tool.mcp.inputSchema).toBeTruthy();
      expect(tool.mcp.outputSchema).toBe(tool.outputSchema);
      expect(tool.anthropic.name).toBe(tool.name);
      expect(tool.anthropic.description).toBeTruthy();
      expect(tool.anthropic.input_schema).toBeTruthy();
      expect(tool.outputSchema).toBeTruthy();
      expect(typeof tool.execute).toBe('function');
    }
  });



  it('recovers research planning when a model passes only normalized memory text', async () => {
    const plan = await executeToolDefinition('plan_dish_research', {
      memory: { normalizedMemory: "Grandma's sour dill soup with pale chunks" },
    }, defaultToolExecutionContext);

    expect(outputSchemas.plan_dish_research.safeParse(plan.payload).success).toBe(true);
    expect(plan.payload.researchRequired).toBe(true);
    expect(plan.payload.factsToVerify).toEqual(expect.arrayContaining(['base ingredient or starch', 'cooking method']));
  });


  it('recovers minimum nostalgia cues when a model passes an incomplete dossier', async () => {
    const cue = await executeToolDefinition('generate_minimum_viable_nostalgia', {
      dossier: {
        evidenceLedger: {
          userSaid: ["Grandma's warm sour dill soup with pale chunks"],
          researched: ['dill', 'sour/tangy'],
          inferred: ['unknown regional dish'],
          unknown: ['exact dish identity'],
        },
      },
      researchFindings: { researched: ['dill'] },
      maxEffortMinutes: 12,
    }, defaultToolExecutionContext);

    expect(outputSchemas.generate_minimum_viable_nostalgia.safeParse(cue.payload).success).toBe(true);
    expect(cue.payload.effortMinutes).toBeLessThanOrEqual(12);
    expect(cue.payload.title).toContain('Minimum viable');
  });


  it('preserves research confidence metadata even when model fact arrays are empty', async () => {
    const memory = (await executeToolDefinition('collect_food_memory', {
      memoryText: 'Warm sour dill soup with pale chunks.',
    }, defaultToolExecutionContext)).payload;
    const researchPlan = (await executeToolDefinition('plan_dish_research', { memory }, defaultToolExecutionContext)).payload;
    const dossier = (await executeToolDefinition('build_reconstruction_dossier', { memory, researchPlan }, defaultToolExecutionContext)).payload;

    const cue = await executeToolDefinition('generate_minimum_viable_nostalgia', {
      dossier,
      researchFindings: { researchedFacts: [], inferredFacts: [], unknowns: [], sourceCount: 2, confidence: 'High' },
    }, defaultToolExecutionContext);

    expect(outputSchemas.generate_minimum_viable_nostalgia.safeParse(cue.payload).success).toBe(true);
    expect(cue.payload.confidence).toBe('High');
  });

  it('recovers reconstruction dossiers when a model passes an incomplete research plan', async () => {
    const memory = (await executeToolDefinition('collect_food_memory', {
      memoryText: 'Warm sour dill soup with pale chunks, dairy-free and allergic to tree nuts.',
    }, defaultToolExecutionContext)).payload;

    const dossier = await executeToolDefinition('build_reconstruction_dossier', {
      memory,
      researchPlan: {
        researchRequired: true,
        hypotheses: [{ name: 'sour dill soup' }],
        searchQueries: ['sour dill soup'],
        preferredSourceTypes: ['family memory'],
        factsToVerify: ['exact dish identity'],
        questionsForUser: ['What gave the soup body?'],
      },
    }, defaultToolExecutionContext);

    expect(outputSchemas.build_reconstruction_dossier.safeParse(dossier.payload).success).toBe(true);
    expect(dossier.payload.hypotheses.length).toBeGreaterThan(0);
    expect(dossier.payload.hypotheses.every((hypothesis: { researchRequired?: unknown }) => typeof hypothesis.researchRequired === 'boolean')).toBe(true);
  });

  it('keeps protocol wrappers and package smoke wired to the registry', () => {
    const serverSource = fs.readFileSync('src/server.ts', 'utf8');
    const httpSource = fs.readFileSync('src/http-server.ts', 'utf8');
    const smokeSource = fs.readFileSync('scripts/package-smoke.mjs', 'utf8');

    expect(serverSource).toContain('toolRegistry');
    expect(serverSource).not.toContain("'collect_food_memory'");
    expect(httpSource).toContain('anthropicTools as TOOLS');
    expect(httpSource).toContain('executeToolDefinition');
    expect(httpSource).not.toContain('function executeTool(');
    expect(smokeSource).toContain('dist');
    expect(smokeSource).toContain('tool-registry.js');
  });

  it('keeps Anthropic tools in workflow-first order for /ask model behavior', () => {
    expect(anthropicTools.map((tool) => tool.name).slice(0, 5)).toEqual([
      'collect_food_memory',
      'plan_dish_research',
      'build_reconstruction_dossier',
      'generate_family_followup_questions',
      'resolve_dish_name',
    ]);
    expect(anthropicTools.map((tool) => tool.name).sort()).toEqual(expectedToolNames);
  });

  it('exports output schema and lookup maps from the same registry', () => {
    expect(Object.keys(outputSchemas).sort()).toEqual(expectedToolNames);
    for (const name of expectedToolNames) {
      const tool = findToolDefinition(name);
      expect(tool?.name).toBe(name);
      expect(outputSchemas[name]).toBe(tool?.outputSchema);
    }
    expect(findToolDefinition('missing_tool')).toBeUndefined();
  });
});
