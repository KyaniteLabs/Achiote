import { describe, expect, it } from 'vitest';
import {
  buildClarificationOnlyResponse,
  buildEvidencePreamble,
  containsConcreteFoodCue,
  containsOverconfidentIdentityClaim,
  containsStalledFallbackText,
} from '../src/lib/ask-guardrails.js';
import { inferSafetyConstraints } from '../src/lib/ask-memory-correction.js';

const allergenMemory = {
  collect_food_memory: {
    extractedClues: {
      possibleDishNames: ['satay-like sauce'],
      culturalOrRegionalHints: [],
      rememberedIngredients: ['peanuts', 'shrimp', 'egg', 'sesame'],
      sensoryClues: ['sauce/gravy', 'nutty aroma'],
      occasions: [],
    },
    inferredContext: {
      culturalOrRegional: [],
    },
  },
};

describe('ask guardrails', () => {
  it('recognizes common allergy phrasing as safety constraints', () => {
    expect(inferSafetyConstraints('I am allergic to peanuts, shrimp, eggs, and sesame.')).toEqual(expect.arrayContaining([
      'nut allergy',
      'shellfish allergy',
      'egg allergy',
      'sesame allergy',
    ]));
  });

  it('recognizes idiomatic shellfish reaction phrasing as a safety constraint', () => {
    expect(inferSafetyConstraints('shrimp and crab make me swell up')).toEqual(expect.arrayContaining([
      'shellfish allergy',
    ]));
  });

  it('recognizes concrete cue instructions even when amounts are not numeric', () => {
    expect(containsConcreteFoodCue('Try this: toast a pinch of cumin and steep it in hot water.')).toBe(true);
    expect(containsConcreteFoodCue('A few broad possibilities come to mind, but I need more clues first.')).toBe(false);
  });

  it('recognizes overconfident identity claims with descriptive clauses', () => {
    expect(containsOverconfidentIdentityClaim('Your description — thick, sour, grayish — points strongly toward a cassava-based fermented dish.')).toBe(true);
  });

  it('recognizes process-leak prose as stalled fallback text', () => {
    expect(containsStalledFallbackText("Let me research this further to pin down the exact dish. I'll work through the pipeline now.")).toBe(true);
    expect(containsStalledFallbackText('Let me work through your memory to track this down.')).toBe(true);
    expect(containsStalledFallbackText('I can work with this memory, but I need one region detail first.')).toBe(false);
  });

  it('keeps restricted allergens out of evidence anchors while preserving the safety boundary', () => {
    const preamble = buildEvidencePreamble(
      allergenMemory,
      'I am allergic to peanuts, shrimp, eggs, and sesame. Help me recreate the sauce.',
    );
    const whatHeard = preamble.split('\n')[0];

    expect(whatHeard).toBe('What I heard: satay-like sauce, sauce/gravy.');
    expect(whatHeard).not.toMatch(/\b(?:peanuts?|shrimp|eggs?|sesame|nutty)\b/i);
    expect(preamble).toContain('Food boundaries: nut allergy, egg allergy, shellfish allergy, sesame allergy.');
  });

  it('does not present unresolved resolver output as a resolved dish', () => {
    const preamble = buildEvidencePreamble({
      resolve_dish_name: {
        canonicalName: 'something like goyura',
        confidence: 'Low',
        matchType: 'unknown',
        region: 'Panama',
      },
      collect_food_memory: {
        extractedClues: {
          culturalOrRegionalHints: ['Panama'],
          possibleDishNames: ['goyura'],
          rememberedIngredients: ['yuca'],
          sensoryClues: ['fried'],
        },
      },
    });

    expect(preamble).not.toContain('Dish resolved');
  });

  it('keeps restricted allergens out of clarification anchor copy', () => {
    const response = buildClarificationOnlyResponse(
      allergenMemory,
      'I am allergic to peanuts, shrimp, eggs, and sesame. Help me recreate the sauce.',
    );

    expect(response).not.toMatch(/(?:peanuts?|shrimp|eggs?|sesame|nutty).*you mentioned/i);
    expect(response).toContain('The sauce/gravy you mentioned is a real anchor.');
  });

  it('keeps restricted allergens out of follow-up questions and research-start text', () => {
    const response = buildClarificationOnlyResponse(
      {
        collect_food_memory: {
          extractedClues: {
            possibleDishNames: [],
            culturalOrRegionalHints: [],
            rememberedIngredients: ['peanuts'],
            sensoryClues: ['sauce/gravy'],
            occasions: [],
          },
          inferredContext: {
            culturalOrRegional: [],
          },
          nextQuestions: [
            'How were the peanuts served?',
            'Where did you eat this?',
          ],
        },
        plan_dish_research: {
          hypotheses: [{
            name: 'Peanut chikki',
            confidence: 'Low',
            whatWouldConfirm: ['peanuts set in jaggery', 'hard brittle texture'],
          }],
          questionsForUser: ['Was it peanuts set in jaggery?'],
        },
      },
      'I am allergic to peanuts. I remember a sauce.',
    );

    expect(response).toContain('Where did you eat this?');
    expect(response).not.toMatch(/\b(?:peanuts?|nutty|Peanut chikki|jaggery)\b/);
    expect(response).toContain('Food boundaries: nut allergy.');
  });

  it('asks region, texture, and name questions for rich unnamed memories', () => {
    const response = buildClarificationOnlyResponse(
      {
        collect_food_memory: {
          extractedClues: {
            possibleDishNames: [],
            culturalOrRegionalHints: [],
            rememberedIngredients: ['banana'],
            cookingMethods: ['steamed', 'wrapped in banana leaf', 'fermented porridge'],
            sensoryClues: ['thick', 'sour', 'grayish', 'savory'],
            occasions: ['funerals'],
          },
          inferredContext: { culturalOrRegional: [] },
          nextQuestions: ['Do you remember anything about the food or drink name, even a rough sound-alike?'],
        },
        plan_dish_research: {
          questionsForUser: ['Do you remember anything about the food or drink name, even a rough sound-alike?'],
        },
      },
      'thick sour fermented porridge, steamed in a banana leaf, grayish savory, served at funerals. I never knew the name.',
      { includeEvidencePreamble: false },
    );

    expect(response).toContain('country, region, language, or community');
    expect(response).toContain('spoonable like porridge');
    expect(response).toContain('local name or sound-alike');
    expect(response).not.toContain('What I heard:');
  });
});
