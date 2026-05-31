import { describe, expect, it } from 'vitest';
import {
  buildMinimumCueCompletedResponse,
  extractSubstitutionTargets,
} from '../src/lib/ask-response-builder.js';
import type { MinimumViableNostalgiaCue } from '../src/lib/types.js';

const cue: MinimumViableNostalgiaCue = {
  title: 'Minimum viable mole-negro cue',
  goal: 'Test dark chile aroma, toasted spice, and sauce body before chasing the exact mole.',
  effortMinutes: 10,
  format: 'bite',
  ingredients: [
    {
      item: 'a tiny spoon of dark mild chile paste or toasted ancho-chile oil',
      amount: 'tiny spoon',
      purpose: 'tests dark chile aroma and color',
    },
    {
      item: 'a tiny piece of tortilla or rice',
      amount: 'tiny piece',
      purpose: 'tests sauce carrier and starch texture',
    },
  ],
  steps: ['Smell the chile aroma first, then taste one tiny bite with the starch carrier.'],
  preserves: ['dark chile aroma', 'toasted sauce body'],
  doesNotPreserve: ['family-specific mole recipe'],
  accessibilityPrinciples: ['use an ordinary grocery chile first'],
  substituteLogic: ['Match dark chile aroma before exact chile identity.'],
  whyThisIsMinimum: 'This tests the chile aroma and sauce body before specialty sourcing.',
  safetyNotes: ['Use only ingredients you already know you can eat.'],
  followUpIfItWorks: ['Ask whether the remembered sauce was more smoky, fruity, bitter, or sweet.'],
  components: [],
  confidence: 'Medium',
};

describe('ask response builder', () => {
  it('targets the user-named chilhuacle chiles for substitution', () => {
    const targets = extractSubstitutionTargets(
      'My grandmother in Oaxaca made mole negro with chilhuacle chiles; I live in Des Moines, Iowa; where can I buy the chiles near me, and what can I substitute?',
      { extractedClues: { rememberedIngredients: [] } },
    );

    expect(targets).toContain('chilhuacle chiles');
    expect(targets).not.toContain('chocolate');
  });

  it('renders substitutes and sourcing in the last-resort minimum cue response', () => {
    const response = buildMinimumCueCompletedResponse({
      collect_food_memory: {
        userLocation: 'Des Moines',
        extractedClues: {
          possibleDishNames: ['mole negro'],
          culturalOrRegionalHints: ['Oaxacan'],
          rememberedIngredients: ['chilhuacle chiles'],
          sensoryClues: ['dark chile aroma'],
        },
      },
      generate_minimum_viable_nostalgia: cue,
      find_sensory_substitutes: {
        ingredient: 'chilhuacle chiles',
        substitutes: [
          {
            original: 'chilhuacle chiles',
            substitute: 'ancho plus pasilla chiles',
            reasoning: 'keeps dark fruit, mild heat, and color while marking the match uncertain',
          },
        ],
      },
      source_ingredients: {
        ingredients: ['chilhuacle chiles'],
        location: 'Des Moines',
        regionalData: {
          majorStores: {
            specialty: ['Mexican markets and spice shops'],
          },
          ethnicCorridors: [{ name: 'Latino grocery corridors', city: 'local area', cuisines: ['Mexican'] }],
        },
        promptForAgent: 'Create a sourcing guide for chilhuacle chiles near Des Moines.',
      },
    }, 'Where can I buy chilhuacle chiles near Des Moines, and what can I substitute?');

    expect(response).not.toMatch(/User-said anchors|Basis before substitutions/i);
    expect(response).toMatch(/Substitutes/i);
    expect(response).toMatch(/chilhuacle chiles/i);
    expect(response).toMatch(/ancho plus pasilla/i);
    expect(response).toMatch(/Where to buy|Sourcing/i);
    expect(response).toMatch(/Des Moines/i);
    expect(response).toMatch(/Mexican markets/i);
  });
});
