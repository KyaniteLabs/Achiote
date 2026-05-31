import { describe, expect, it } from 'vitest';
import { buildClarificationOnlyResponse, buildEvidencePreamble, containsConcreteFoodCue } from '../src/lib/ask-guardrails.js';
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

  it('recognizes concrete cue instructions even when amounts are not numeric', () => {
    expect(containsConcreteFoodCue('Try this: toast a pinch of cumin and steep it in hot water.')).toBe(true);
    expect(containsConcreteFoodCue('A few broad possibilities come to mind, but I need more clues first.')).toBe(false);
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
});
