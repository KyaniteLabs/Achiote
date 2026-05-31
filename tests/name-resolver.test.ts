import { describe, it, expect } from 'vitest';
import { resolveDishName } from '../src/lib/name-resolver.js';
import type { CollectedFoodMemory } from '../src/lib/types.js';

function panamaFriedMemory(): CollectedFoodMemory {
  return {
    rawMemory: 'something like goyura in panama. savory, thick cut fried, not potatoes, sweet syrup on top.',
    normalizedMemory: 'something like goyura in panama. savory, thick cut fried, not potatoes, sweet syrup on top.',
    extractedClues: {
      possibleDishNames: ['goyura'],
      culturalOrRegionalHints: ['Panama', 'Panamanian'],
      rememberedIngredients: [],
      ruledOutIngredients: ['potatoes'],
      cookingMethods: ['fried', 'thick cut'],
      sensoryClues: ['savory', 'sweet syrup on top', 'crispy/fried texture'],
      occasions: [],
    },
    inferredContext: { culturalOrRegional: [], language: [] },
    missingInformation: [],
    nextQuestions: [],
    reassurance: 'Sound-alikes are enough to start.',
    extractionMetadata: {
      source: 'model',
      originRegion: 'Panama',
      ruledOutIngredients: ['potatoes'],
      cookingMethod: ['fried', 'thick cut'],
      timeoutMs: 8000,
    },
  };
}

describe('resolveDishName', () => {
  it('resolves exact alias match', () => {
    const result = resolveDishName('dolma');
    expect(result.canonicalName).toBe('stuffed-vegetables');
    expect(result.confidence).toBe('High');
  });

  it('resolves transliteration variants', () => {
    const result = resolveDishName('biryani');
    expect(result.canonicalName).toBe('rice-dish');
    expect(result.aliases).toContain('biryani');
  });

  it('handles fuzzy input with approximate spelling', () => {
    const result = resolveDishName('perogi');
    expect(result.canonicalName).toBe('dumpling');
    expect(result.confidence).toBe('Medium');
  });

  it('returns unmatched result for unknown dishes', () => {
    const result = resolveDishName('some-completely-unknown-dish-xyz');
    expect(result.confidence).toBe('Low');
    expect(result.canonicalName).toBe('some-completely-unknown-dish-xyz');
  });

  it('uses extracted region and mechanism context for unresolved sound-alikes', () => {
    const result = resolveDishName('goyura', { memory: panamaFriedMemory() });

    expect(result).toMatchObject({
      input: 'goyura',
      canonicalName: 'goyura',
      dishFamily: 'regional fried-starch clue',
      region: 'Panama',
      confidence: 'Low',
      matchType: 'unknown',
      needsClarification: true,
    });
    expect(result.clarificationPrompt).toContain('unresolved Panama food-memory clue');
  });

  it('finds family match for empanada', () => {
    const result = resolveDishName('empanada');
    expect(result.canonicalName).toBe('dumpling');
    expect(result.aliases).toContain('empanada');
  });

  it('resolves canonical name directly', () => {
    const result = resolveDishName('flatbread');
    expect(result.canonicalName).toBe('flatbread');
    expect(result.confidence).toBe('High');
  });

  it('handles spaces and hyphens in input', () => {
    const result = resolveDishName('cabbage roll');
    expect(result.canonicalName).toBe('stuffed-vegetables');
  });

  it('resolves canary-discovered family gaps through general aliases and fuzzy matching', () => {
    expect(resolveDishName('caribañola')).toMatchObject({
      canonicalName: 'cassava-fritter',
      confidence: 'High',
    });
    expect(resolveDishName('carimanolla')).toMatchObject({
      canonicalName: 'cassava-fritter',
      confidence: 'Medium',
      matchType: 'fuzzy',
    });
    expect(resolveDishName('agua de cebada')).toMatchObject({
      canonicalName: 'grain-beverage',
      confidence: 'High',
    });
    expect(resolveDishName('pickle soup')).toMatchObject({
      canonicalName: 'sour-herb-soup',
      confidence: 'High',
    });
    expect(resolveDishName('bukayo')).toMatchObject({
      canonicalName: 'coconut-sugar-confection',
      confidence: 'High',
    });
    expect(resolveDishName('butter chicken')).toMatchObject({
      canonicalName: 'cream-tomato-curry',
      confidence: 'High',
    });
  });
});

describe('resolveDishName ambiguity-aware candidates', () => {
  it('flags overloaded names and returns ranked candidates', () => {
    const result = resolveDishName('tortilla');

    expect(result.needsClarification).toBe(true);
    expect(result.matchType).toBe('ambiguous');
    expect(result.candidates?.length).toBeGreaterThanOrEqual(2);
    expect(result.candidates?.map(candidate => candidate.canonicalName)).toContain('flatbread');
    expect(result.candidates?.map(candidate => candidate.variantName)).toContain('tortilla-espanola');
  });


  it('flags fuzzy misspellings of overloaded names as ambiguous', () => {
    const result = resolveDishName('tortila');

    expect(result.needsClarification).toBe(true);
    expect(result.matchType).toBe('ambiguous');
    expect(result.candidates?.map(candidate => candidate.canonicalName)).toEqual(
      expect.arrayContaining(['flatbread', 'egg-dish']),
    );
  });

  it('resolves specific regional variants without clarification', () => {
    const result = resolveDishName('tortilla española');

    expect(result.needsClarification).toBe(false);
    expect(result.matchType).toBe('variant');
    expect(result.canonicalName).toBe('egg-dish');
    expect(result.candidates?.[0]).toMatchObject({
      canonicalName: 'egg-dish',
      variantName: 'tortilla-espanola',
      confidence: 'High',
    });
    expect(result.clarificationPrompt).toContain('Spanish egg-and-potato tortilla');
  });
});

describe('resolveDishName levenshtein edge cases', () => {
  it('handles empty string input', () => {
    const result = resolveDishName('');
    expect(result.canonicalName).toBe('');
    expect(result.confidence).toBe('Low');
  });

  it('handles single character input', () => {
    const result = resolveDishName('x');
    expect(result.confidence).toBe('Low');
  });

  it('returns identical result for the same input called twice', () => {
    const first = resolveDishName('pierogi');
    const second = resolveDishName('pierogi');
    expect(first).toEqual(second);
  });
});
