import { describe, expect, it } from 'vitest';
import { collectFoodMemory, generateMinimumViableNostalgiaCue, planDishResearch } from '../src/lib/memory-workflow.js';
import {
  buildAskQualitySignal,
  emptyQualitySignalReport,
  recordQualitySignal,
} from '../src/lib/quality-signals.js';

describe('ask quality signals', () => {
  it('normalizes beverage memories without storing raw memory text', () => {
    const memory = collectFoodMemory({
      memoryText: 'My aunt made a cold rice-cinnamon drink like horchata, watery over ice.',
      userLocation: 'Phoenix',
    });
    const plan = planDishResearch(memory);
    const cue = generateMinimumViableNostalgiaCue({
      dossier: {
        title: 'Cold drink memory',
        evidenceLedger: {
          userSaid: [memory.rawMemory],
          researched: [],
          inferred: ['The memory is beverage-like.'],
          unknown: [],
        },
        hypotheses: plan.hypotheses,
        nostalgiaCriticalElements: ['cold sip ritual'],
        recreationStrategy: [],
        whatToAskFamily: [],
        confidence: 'Low',
      },
    });

    const signal = buildAskQualitySignal({
      toolPayloads: {
        collect_food_memory: memory,
        plan_dish_research: plan,
        generate_minimum_viable_nostalgia: cue,
      },
      calledTools: ['collect_food_memory', 'plan_dish_research', 'generate_minimum_viable_nostalgia'],
      guarded: 'minimum_cue_deterministic_completion',
      cache: 'unavailable',
    });

    expect(signal).toMatchObject({
      memoryType: 'beverage',
      familyKey: 'beverage_like',
      search: 'skipped',
      cache: 'unavailable',
      guarded: 'minimum_cue_deterministic_completion',
    });
    expect(signal.familyKey).not.toContain('cold rice-cinnamon drink');
    expect(JSON.stringify(signal)).not.toContain('My aunt made');
    expect(JSON.stringify(signal)).not.toContain('Phoenix');
  });

  it('captures missing dimensions for broad unknown memories', () => {
    const memory = collectFoodMemory({
      memoryText: 'My abuela made something sour and herby, maybe green, but I do not know the country, dish name, ingredients, or whether it was soup, sauce, or stew.',
    });
    const plan = planDishResearch(memory);

    const signal = buildAskQualitySignal({
      toolPayloads: {
        collect_food_memory: memory,
        plan_dish_research: plan,
      },
      calledTools: ['collect_food_memory', 'plan_dish_research'],
      guarded: 'broad_memory_clarification',
    });

    expect(signal.memoryType).toBe('sauce_broth');
    expect(signal.familyKey).toBe('soup_sauce_stew');
    expect(signal.regionKey).toBe('unknown');
    expect(signal.missing).toEqual(expect.arrayContaining([
      'missing_name',
      'missing_region',
      'missing_ingredient',
      'missing_format',
    ]));
    expect(signal.search).toBe('skipped');
  });

  it('collapses model family names to bounded buckets and only flags ambiguous formats', () => {
    const clearSoupMemory = collectFoodMemory({
      memoryText: 'Warm sour dill soup with pale potato chunks from a family dinner.',
    });
    const clearSoupPlan = planDishResearch(clearSoupMemory);
    const clearSoupSignal = buildAskQualitySignal({
      toolPayloads: {
        collect_food_memory: clearSoupMemory,
        plan_dish_research: {
          ...clearSoupPlan,
          hypotheses: [{
            ...clearSoupPlan.hypotheses[0],
            name: 'Grandma Maria private porch soup in Phoenix',
          }],
        },
      },
      calledTools: ['collect_food_memory', 'plan_dish_research'],
    });

    expect(clearSoupSignal.familyKey).toBe('soup_sauce_stew');
    expect(clearSoupSignal.familyKey).not.toContain('grandma');
    expect(clearSoupSignal.familyKey).not.toContain('phoenix');
    expect(clearSoupSignal.missing).not.toContain('missing_format');

    const ambiguousMemory = collectFoodMemory({
      memoryText: 'Something sour and herby, but I do not know whether it was soup, sauce, or stew.',
    });
    const ambiguousSignal = buildAskQualitySignal({
      toolPayloads: { collect_food_memory: ambiguousMemory },
      calledTools: ['collect_food_memory'],
    });
    expect(ambiguousSignal.missing).toContain('missing_format');
  });

  it('bounds search, cache, guard, and aggregate report values', () => {
    const signal = buildAskQualitySignal({
      toolPayloads: {
        search_web: { capReached: true },
      },
      calledTools: ['search_web'],
      guarded: 'not a real guard with spaces and raw words',
      cache: 'impossible',
    });
    const report = emptyQualitySignalReport();
    recordQualitySignal(report, signal);

    expect(signal.search).toBe('capped');
    expect(signal.cache).toBe('unavailable');
    expect(signal.guarded).toBe('other');
    expect(report).toMatchObject({
      total: 1,
      byMemoryType: { unknown: 1 },
      byGuard: { other: 1 },
      bySearch: { capped: 1 },
      byCache: { unavailable: 1 },
    });
  });
});
