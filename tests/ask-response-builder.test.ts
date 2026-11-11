import { describe, expect, it } from 'vitest';
import {
  buildMinimumCueCompletedResponse,
  buildResearchGroundedForcedCueResponse,
  extractCorrectionSensoryAnchor,
  extractSubstitutionTargets,
  summarizeSourcingResults,
  summarizeSubstitutionResults,
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

  it('uses a specific chilhuacle fallback when the substitute dataset has no record', () => {
    const lines = summarizeSubstitutionResults({
      find_sensory_substitutes: {
        ingredient: 'chilhuacle chiles',
        mode: 'prompt-only',
        substitutes: [],
      },
    });

    expect(lines.join('\n')).toMatch(/ancho/i);
    expect(lines.join('\n')).toMatch(/pasilla negro/i);
    expect(lines.join('\n')).toMatch(/cascabel/i);
  });

  it('renders actual local search leads as candidate sourcing paths', () => {
    const lines = summarizeSourcingResults({
      source_ingredients: {
        ingredients: ['chilhuacle chiles'],
        location: 'Queens, New York',
        regionalData: {},
      },
      local_sourcing_search: {
        query: 'chilhuacle chiles Queens New York Mexican Oaxacan grocery dried chiles spice shop',
        results: [
          {
            title: 'Mi Tierra Supermarket Queens dried chiles',
            link: 'https://example.test/mi-tierra',
            snippet: 'Mexican grocery in Queens with dried chile and spice sections.',
          },
        ],
      },
    });

    expect(lines.join('\n')).toMatch(/Queens, New York/i);
    expect(lines.join('\n')).toMatch(/Mi Tierra Supermarket/i);
    expect(lines.join('\n')).toMatch(/not proof of current stock/i);
  });

  it('keeps forced researched fallback specific instead of generic starch boilerplate', () => {
    const response = buildResearchGroundedForcedCueResponse({
      collect_food_memory: {
        extractedClues: {
          possibleDishNames: ['goyura'],
          culturalOrRegionalHints: ['Panama'],
          rememberedIngredients: [],
          ruledOutIngredients: ['potatoes'],
          cookingMethods: ['fried', 'thick cut'],
          sensoryClues: ['savory', 'sweet syrup on top'],
          occasions: [],
        },
      },
      resolve_dish_name: {
        canonicalName: 'goyura',
        region: 'Panama',
        confidence: 'Low',
        matchType: 'unknown',
      },
      search_web: {
        results: [
          {
            title: 'Platanos Maduros - Ripe Plantains',
            snippet: 'These naturally sweet plantain slices, made from ripe plantains, are delicately fried to perfection.',
          },
        ],
      },
      generate_minimum_viable_nostalgia: {
        ...cue,
        ingredients: [
          {
            item: 'cheap grocery-store carrier matching the remembered base: starch, bread, potato, rice, bean, noodle, or cooked vegetable',
            amount: '1-2 bites',
            purpose: 'texture and sauce carrier',
          },
        ],
      },
    }, 'something like goyura in panama. savory, thick cut fried, not potatoes, sweet syrup on top.');

    expect(response).toMatch(/Panama/i);
    expect(response).toMatch(/ripe plantain/i);
    expect(response).toMatch(/fried and thick cut/i);
    expect(response).toMatch(/sweet syrup/i);
    expect(response).toMatch(/potatoes out/i);
    expect(response).not.toContain('What I heard:');
    expect(response).not.toMatch(/starch, bread, potato, rice, bean/i);
  });

  it('keeps researched arepa fallback on masarepa instead of generic starch', () => {
    const response = buildResearchGroundedForcedCueResponse({
      collect_food_memory: {
        extractedClues: {
          possibleDishNames: ['arepas con queso'],
          culturalOrRegionalHints: ['Venezuela'],
          rememberedIngredients: ['queso'],
          ruledOutIngredients: [],
          cookingMethods: ['griddled'],
          sensoryClues: [],
          occasions: ['mother/family context'],
        },
      },
      search_web: {
        results: [
          {
            title: 'Venezuelan arepas',
            snippet: 'Traditional fillings for arepas include queso blanco and other Venezuelan fillings.',
          },
        ],
      },
      generate_minimum_viable_nostalgia: {
        ...cue,
        ingredients: [
          {
            item: 'cheap grocery-store carrier matching the remembered base: starch, bread, potato, rice, bean, noodle, or cooked vegetable',
            amount: '1-2 bites',
            purpose: 'texture and sauce carrier',
          },
        ],
      },
    }, 'my mom made arepas con queso, my family is from Venezuela.');

    expect(response).toMatch(/Venezuela/i);
    expect(response).toMatch(/masarepa|P\.A\.N\./i);
    expect(response).toMatch(/griddled/i);
    expect(response).not.toMatch(/starch, bread, potato, rice, bean/i);
  });

  it('keeps the corrected sensory anchor when a cold-drink memory is corrected to pink fruit', () => {
    const correction = 'That sounds close, but I remember pink fruit chunks. Please correct the memory record and show the source links and a receipt I can share with my family.';
    const response = buildResearchGroundedForcedCueResponse({
      collect_food_memory: {
        extractedClues: {
          possibleDishNames: ['white'],
          culturalOrRegionalHints: ['Mexican'],
          rememberedIngredients: ['cinnamon'],
          ruledOutIngredients: [],
          cookingMethods: [],
          sensoryClues: [],
          occasions: [],
        },
      },
      search_web: {
        results: [
          {
            title: 'Atole de masa',
            snippet: 'Atole is a traditional Mexican drink made from corn masa and served warm.',
          },
        ],
      },
      generate_minimum_viable_nostalgia: {
        ...cue,
        title: 'Minimum viable beverage-memory cue',
        format: 'sip',
        ingredients: [
          {
            item: 'a tiny sip of an ordinary rice-based drink',
            amount: 'tiny sip',
            purpose: 'tests body and aroma before chasing the exact drink',
          },
        ],
        components: [
          {
            role: 'starch',
            criticalElement: 'rice starch body',
            flavorProfile: 'chalky-sweet',
            localTestWith: 'cooked rice',
            substitutionReason: 'carrier',
            confidence: 'Medium',
          },
          {
            role: 'protein',
            criticalElement: 'browned fat',
            flavorProfile: 'nutty',
            localTestWith: 'toasted seeds',
            substitutionReason: 'fat contrast',
            confidence: 'Low',
          },
        ],
      },
    }, correction);

    expect(response).toMatch(/pink fruit/i);
    expect(response).not.toMatch(/unresolved sound-alike/i);
    expect(response).not.toMatch(/corn or masa/i);
    expect(response).not.toMatch(/browned fat\/protein/i);
    expect(response).toMatch(/Keep it to one sip/i);
  });

  it.each([
    ['actually', 'Actually it was pink fruit, not white.', 'pink fruit'],
    ['wait-no', 'Wait, no \u2014 it had pink fruit chunks.', 'pink fruit chunks'],
    ['correction-colon', 'Correction: pink fruit chunks.', 'pink fruit chunks'],
    ['remembered-wrong', 'I remembered it wrong; it had pink fruit chunks.', 'pink fruit chunks'],
    ['remembered-clause', 'That sounds close, but I remember pink fruit chunks and it was cold.', 'pink fruit chunks and cold'],
    ['ruled-out-first', 'Correction: not white \u2014 pink fruit chunks.', 'pink fruit chunks'],
  ])('extracts the corrected sensory detail from the %s correction form', (_form, message, expected) => {
    expect(extractCorrectionSensoryAnchor(message)).toBe(expected);
  });

  it('returns a grammatical anchor for the self-correction form instead of the words after "remembered"', () => {
    const anchor = extractCorrectionSensoryAnchor('I remembered it wrong; it had pink fruit chunks.');

    expect(anchor).toBe('pink fruit chunks');
    expect(anchor).not.toMatch(/^(?:it|that|this|they|there|i|we|you|can|could|would|should|is|are|was|were|had|has|have)\b/i);
  });

  it('rejects correction cues that carry no sensory detail', () => {
    expect(extractCorrectionSensoryAnchor('It sounds close, but I remember nothing about it.')).toBeUndefined();
    expect(extractCorrectionSensoryAnchor('Actually, can you show the receipt again?')).toBeUndefined();
    expect(extractCorrectionSensoryAnchor('Can you show the source links?')).toBeUndefined();
  });

  it('keeps the remembered correction as the carrier on the follow-up turn', () => {
    const response = buildResearchGroundedForcedCueResponse({
      collect_food_memory: {
        userLocation: 'Des Moines',
        extractedClues: {
          possibleDishNames: ['white'],
          culturalOrRegionalHints: ['Mexican'],
          rememberedIngredients: ['pink fruit chunks'],
          ruledOutIngredients: [],
          cookingMethods: [],
          sensoryClues: ['cold'],
          occasions: [],
        },
      },
      search_web: {
        results: [
          {
            title: 'Atole de masa',
            snippet: 'Atole is a traditional Mexican drink made from corn masa and served warm.',
          },
        ],
      },
      generate_minimum_viable_nostalgia: {
        ...cue,
        title: 'Minimum viable beverage-memory cue',
        format: 'sip',
        ingredients: [
          {
            item: 'a tiny sip of an ordinary rice-based drink',
            amount: 'tiny sip',
            purpose: 'tests body and aroma before chasing the exact drink',
          },
        ],
        components: [],
      },
    }, 'Thanks. Can you show the source links and a receipt I can share?');

    expect(response).toMatch(/pink fruit chunks/i);
    expect(response).toMatch(/first-pass verification bite: test pink fruit chunks as the carrier/i);
    expect(response).not.toMatch(/corn or masa/i);
    expect(response).toMatch(/Keep it to one sip/i);
  });
});
