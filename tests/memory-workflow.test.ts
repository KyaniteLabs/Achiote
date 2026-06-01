import { describe, expect, it } from 'vitest';
import {
  buildReconstructionDossier,
  collectFoodMemory,
  collectFoodMemoryWithModel,
  generateFamilyFollowupQuestions,
  planDishResearch,
} from '../src/lib/memory-workflow.js';

describe('research-first food memory workflow', () => {
  it('structures a sparse second-generation Puerto Rican food memory without requiring correct spelling', () => {
    const memory = collectFoodMemory({
      memoryText: "My mom said my Puerto Rican grandma made something that sounded like pass-teh-lay. I don't speak Spanish. Maybe plantains or pork?",
      userLocation: 'Orlando, FL',
    });

    expect(memory.normalizedMemory).toContain('pass-teh-lay');
    expect(memory.extractedClues.possibleDishNames).toContain('pass-teh-lay');
    expect(memory.extractedClues.culturalOrRegionalHints).toContain('Puerto Rican');
    expect(memory.extractedClues.rememberedIngredients).toEqual(expect.arrayContaining(['plantains', 'pork']));
    expect(memory.nextQuestions.length).toBeLessThanOrEqual(3);
    expect(memory.reassurance).toContain("don't need to spell");
  });

  it('does not treat allergy terms as remembered ingredients or follow-up targets', () => {
    const memory = collectFoodMemory({
      memoryText: 'I am severely allergic to peanuts and tree nuts. Help me recreate a satay-like sauce I remember.',
    });

    expect(memory.extractedClues.rememberedIngredients).not.toEqual(expect.arrayContaining(['nuts', 'peanuts']));
    expect(memory.extractedClues.sensoryClues).not.toContain('nutty aroma');
    expect(memory.nextQuestions.join(' ')).not.toMatch(/\b(?:nuts?|peanuts?)\b/i);
  });

  it('matches plural allergy terms against singular ingredient hints', () => {
    const memory = collectFoodMemory({
      memoryText: 'I am allergic to eggs and sesame. I remember a sweet sauce.',
    });

    expect(memory.extractedClues.rememberedIngredients).not.toEqual(expect.arrayContaining(['egg', 'sesame']));
    expect(memory.nextQuestions.join(' ')).not.toMatch(/\b(?:eggs?|sesame)\b/i);
  });

  it('keeps idiomatic shellfish reaction terms out of remembered ingredients and follow-up targets', () => {
    const memory = collectFoodMemory({
      memoryText: 'my dad made a seafood rice dish, but shrimp and crab make me swell up. help me recreate it.',
    });

    expect(memory.extractedClues.rememberedIngredients).not.toContain('shrimp');
    expect(memory.extractedClues.rememberedIngredients).not.toContain('crab');
    expect(memory.extractedClues.rememberedIngredients).not.toContain('shellfish');
    expect(memory.nextQuestions.join(' ')).not.toMatch(/\b(?:shrimp|crab|shellfish)\b/i);
  });

  it('extracts lowercase Panama as a stated regional clue', () => {
    const memory = collectFoodMemory({
      memoryText: 'something like goyura in panama. savory, thick cut fried, not potatoes, sweet syrup on top.',
    });

    expect(memory.extractedClues.culturalOrRegionalHints).toContain('Panamanian');
  });

  it('plans research instead of pretending sparse fragments are resolved', () => {
    const memory = collectFoodMemory({
      memoryText: 'My grandma made something like pass-teh-lay for Christmas. Puerto Rican family.',
      userLocation: 'Orlando, FL',
    });
    const plan = planDishResearch(memory);

    expect(plan.researchRequired).toBe(true);
    expect(plan.hypotheses.map((hypothesis) => hypothesis.name)).toEqual(
      expect.arrayContaining(['pasteles-puertorriquenos', 'pastelon', 'piononos']),
    );
    expect(plan.searchQueries.length).toBeGreaterThanOrEqual(3);
    expect(plan.factsToVerify).toEqual(expect.arrayContaining([
      'base ingredient, beverage base, or starch',
      'cooking, extraction, mixing, or serving method',
    ]));
    expect(plan.questionsForUser.length).toBeLessThanOrEqual(3);
  });

  it('builds a reconstruction dossier with explicit evidence boundaries', () => {
    const memory = collectFoodMemory({ memoryText: 'Older parent misses a sour soup from home but only remembers dill and lamb.' });
    const plan = planDishResearch(memory);
    const dossier = buildReconstructionDossier({
      memory,
      researchPlan: plan,
      researchedFacts: ['Dill and lamb point to several regional soup/stew families, not one confirmed dish.'],
      inferredFacts: ['Sourness may come from yogurt, citrus, vinegar, or fermented ingredients.'],
    });

    expect(dossier.evidenceLedger.userSaid).toContain('Older parent misses a sour soup from home but only remembers dill and lamb.');
    expect(dossier.evidenceLedger.researched).toHaveLength(1);
    expect(dossier.evidenceLedger.inferred).toHaveLength(1);
    expect(dossier.evidenceLedger.unknown).toContain('exact dish identity');
    expect(dossier.recreationStrategy[0]).toContain('Do not finalize a recipe');
  });

  it('generates gentle family follow-up questions', () => {
    const memory = collectFoodMemory({ memoryText: 'Abuela made something like pastelay, Puerto Rican, maybe plantains.' });
    const plan = planDishResearch(memory);
    const questions = generateFamilyFollowupQuestions({ memory, researchPlan: plan });

    expect(questions.questions.length).toBeLessThanOrEqual(5);
    expect(questions.questions.join(' ')).toContain('wrapped');
    expect(questions.toneGuidance).toContain('No one needs to know the perfect spelling');
  });


  it('asks clue-aware questions for sparse regional ingredient memories', () => {
    const memory = collectFoodMemory({
      memoryText: 'I ate a shark one time in Trinidad and Tobago',
      knownRegion: 'Trinidad and Tobago',
      userLocation: 'Long Beach, California',
    });

    expect(memory.extractedClues.culturalOrRegionalHints).toContain('Trinidad and Tobago');
    expect(memory.extractedClues.rememberedIngredients).toContain('shark');
    expect(memory.missingInformation).not.toContain('core ingredients');
    expect(memory.missingInformation).not.toContain('country, island, region, town, or community');
    expect(memory.nextQuestions.join(' ')).toContain('How was the shark served');
    expect(memory.nextQuestions.join(' ')).not.toContain('wrapped in leaves');
  });

  it('normalizes curry and curried cooking-method clues without duplicate hints', () => {
    const curryMemory = collectFoodMemory({ memoryText: 'I remember fish curry from Trinidad.' });
    const curriedMemory = collectFoodMemory({ memoryText: 'I remember curried fish from Trinidad.' });

    expect(curryMemory.missingInformation).not.toContain('cooking method or serving format');
    expect(curriedMemory.missingInformation).not.toContain('cooking method or serving format');
  });

  it('does not extract generic hints from unrelated substrings', () => {
    const selfishMemory = collectFoodMemory({ memoryText: 'This is a selfish memory about a beach trip.' });
    const breadfruitMemory = collectFoodMemory({ memoryText: 'I remember breadfruit from the islands.' });

    expect(selfishMemory.extractedClues.rememberedIngredients).not.toContain('fish');
    expect(selfishMemory.missingInformation).toContain('core ingredients');
    expect(breadfruitMemory.missingInformation).toContain('cooking method or serving format');
  });
});

describe('model-assisted food memory extraction', () => {
  it('merges structured model extraction into the collected memory payload', async () => {
    const memory = await collectFoodMemoryWithModel({
      memoryText: 'something like goyura in panama. savory, thick cut fried, not potatoes, sweet syrup on top.',
    }, {
      extractor: async () => ({
        possibleDishNames: ['goyura'],
        originRegion: 'Panama',
        residenceLocation: '',
        ingredients: ['yuca'],
        ruledOutIngredients: ['potatoes'],
        cookingMethod: ['fried'],
        sensoryCues: ['savory', 'thick cut', 'sweet syrup'],
        occasion: [],
        language: 'Spanish',
      }),
      timeoutMs: 100,
    });

    expect(memory.extractedClues.possibleDishNames).toContain('goyura');
    expect(memory.extractedClues.culturalOrRegionalHints).toEqual(expect.arrayContaining(['Panama', 'Panamanian']));
    expect(memory.extractedClues.rememberedIngredients).toContain('yuca');
    expect(memory.extractedClues.rememberedIngredients).not.toContain('potatoes');
    expect(memory.extractedClues.ruledOutIngredients).toContain('potatoes');
    expect(memory.extractedClues.cookingMethods).toContain('fried');
    expect(memory.extractedClues.sensoryClues).toEqual(expect.arrayContaining(['savory', 'thick cut', 'sweet']));
    expect(memory.missingInformation).not.toContain('cooking method or serving format');
    expect(memory.extractionMetadata).toMatchObject({
      source: 'model',
      originRegion: 'Panama',
      ruledOutIngredients: ['potatoes'],
      cookingMethod: ['fried'],
      language: 'Spanish',
    });
  });

  it('does not let model-only shellfish reaction terms become ingredients or cue anchors', async () => {
    const memory = await collectFoodMemoryWithModel({
      memoryText: 'my dad made a seafood rice dish, but shrimp and crab make me swell up. help me recreate it.',
    }, {
      extractor: async () => ({
        possibleDishNames: ['seafood rice dish', 'shrimp rice'],
        originRegion: '',
        residenceLocation: '',
        ingredients: ['rice', 'seafood', 'shrimp', 'crab'],
        ruledOutIngredients: ['shrimp', 'crab'],
        cookingMethod: ['rice dish'],
        sensoryCues: ['seafood aroma', 'savory'],
        occasion: ['father/grandfather context'],
        language: '',
      }),
      timeoutMs: 100,
    });

    expect(memory.extractedClues.rememberedIngredients).toContain('rice');
    expect(memory.extractedClues.rememberedIngredients).not.toEqual(expect.arrayContaining(['seafood', 'shrimp', 'crab']));
    expect(memory.extractedClues.possibleDishNames).not.toContain('shrimp rice');
    expect(memory.extractedClues.sensoryClues).not.toContain('seafood aroma');
    expect(memory.extractedClues.ruledOutIngredients).toEqual(expect.arrayContaining(['shrimp', 'crab']));
    expect(memory.extractedClues.cookingMethods).toContain('rice dish');
    expect(memory.nextQuestions.join(' ')).not.toMatch(/\b(?:shrimp|crab|shellfish)\b/i);
  });

  it('does not let ruled-out stale correction compounds survive as positive clues', async () => {
    const memory = await collectFoodMemoryWithModel({
      memoryText: 'Correction: I remembered wrong. It was a sour soup from my Polish neighbor. Cold rice-cinnamon drink was a mistaken memory.',
    }, {
      extractor: async () => ({
        possibleDishNames: ['sour soup', 'rice-cinnamon'],
        originRegion: 'Polish',
        residenceLocation: '',
        ingredients: ['rice', 'cinnamon'],
        ruledOutIngredients: ['rice', 'cinnamon'],
        cookingMethod: ['soup'],
        sensoryCues: ['sour'],
        occasion: ['neighbor'],
        language: 'Polish',
      }),
      timeoutMs: 100,
    });

    expect(memory.extractedClues.possibleDishNames).toContain('sour soup');
    expect(memory.extractedClues.possibleDishNames).not.toContain('rice-cinnamon');
    expect(memory.extractedClues.rememberedIngredients).not.toEqual(expect.arrayContaining(['rice', 'cinnamon']));
    expect(memory.extractedClues.ruledOutIngredients).toEqual(expect.arrayContaining(['rice', 'cinnamon']));
  });

  it('falls back to regex extraction when the model response is malformed', async () => {
    const memory = await collectFoodMemoryWithModel({
      memoryText: 'My mom made arepas con queso, my family is from Venezuela.',
    }, {
      extractor: async () => ({ possibleDishNames: 'arepas con queso' }),
      timeoutMs: 100,
    });

    expect(memory.extractedClues.possibleDishNames).toContain('arepas con queso');
    expect(memory.extractedClues.rememberedIngredients).toContain('queso');
    expect(memory.extractedClues.culturalOrRegionalHints).toContain('Venezuela');
    expect(memory.missingInformation).not.toContain('core ingredients');
    expect(memory.extractionMetadata?.source).toBe('regex_fallback');
    expect(memory.extractionMetadata?.fallbackReason).toMatch(/schema/i);
  });

  it('falls back to regex extraction when model extraction times out', async () => {
    const memory = await collectFoodMemoryWithModel({
      memoryText: 'my dad made a seafood rice dish, but shrimp and crab make me swell up. help me recreate it.',
    }, {
      extractor: async () => new Promise(() => {}),
      timeoutMs: 5,
    });

    expect(memory.extractedClues.rememberedIngredients).not.toContain('shrimp');
    expect(memory.extractedClues.rememberedIngredients).not.toContain('crab');
    expect(memory.extractionMetadata?.source).toBe('regex_fallback');
    expect(memory.extractionMetadata?.fallbackReason).toMatch(/timed out/i);
  });
});

describe('general research planning', () => {

  it('does not force Portuguese or Brazilian pastel fragments into Puerto Rican hypotheses without context', () => {
    const memory = collectFoodMemory({ memoryText: 'My Brazilian friend mentioned pastel from a street market.' });
    const plan = planDishResearch(memory);

    expect(plan.hypotheses.map((hypothesis) => hypothesis.name)).not.toContain('pasteles');
    expect(plan.hypotheses[0]).toMatchObject({
      name: 'pastel',
      researchRequired: true,
    });
  });


  it('does not turn connector words into dish names', () => {
    const memory = collectFoodMemory({
      memoryText: "My mom said my Puerto Rican grandma made something that sounded like pass-teh-lay.",
    });

    expect(memory.extractedClues.possibleDishNames).toContain('pass-teh-lay');
    expect(memory.extractedClues.possibleDishNames).not.toContain('sounded');
    expect(memory.extractedClues.possibleDishNames).not.toContain('something sounded');
  });

  it('does not split something into a fake dish called thing', () => {
    const memory = collectFoodMemory({
      memoryText: 'My abuela made something sour and herby.',
    });
    const plan = planDishResearch(memory);
    const joinedQueries = plan.searchQueries.join(' ').toLowerCase();

    expect(memory.extractedClues.possibleDishNames).not.toContain('thing');
    expect(plan.hypotheses.map((hypothesis) => hypothesis.name)).not.toContain('thing');
    expect(joinedQueries).not.toContain('"thing"');
    expect(plan.hypotheses[0].name).toContain('Unidentified');
  });

  it('does not infer a named dish from broad region and one sensory clue alone', () => {
    const memory = collectFoodMemory({
      memoryText: 'My abuela made something sour and herby.',
      knownRegion: 'Latin America / Hispanic',
    });
    const plan = planDishResearch(memory);
    const hypothesisNames = plan.hypotheses.map((hypothesis) => hypothesis.name);

    expect(hypothesisNames).not.toContain('Pozole Verde');
    expect(plan.hypotheses[0]).toMatchObject({
      name: 'Unidentified traditional dish',
      confidence: 'Low',
    });
  });

  it('keeps abuela as inferred context rather than user-said region evidence', () => {
    const memory = collectFoodMemory({
      memoryText: 'My abuela made something sour and herby.',
    });
    const plan = planDishResearch(memory);

    expect(memory.extractedClues.culturalOrRegionalHints).toEqual([]);
    expect(memory.inferredContext.culturalOrRegional).toEqual([
      expect.objectContaining({
        label: 'Spanish-speaking family context',
        confidence: 'Low',
        evidenceKind: 'model_inferred',
        canSeedQuestions: true,
        canSeedCandidateDishes: false,
      }),
    ]);
    expect(plan.hypotheses.map((hypothesis) => hypothesis.name)).not.toContain('Pozole Verde');
    expect(plan.questionsForUser.join(' ')).toMatch(/abuela|where/i);
  });

  it('plans useful research for non-Puerto-Rican named fragments', () => {
    const memory = collectFoodMemory({
      memoryText: 'My Nigerian auntie mentioned egusi soup with melon seeds and bitter greens.',
      knownRegion: 'Nigeria',
    });
    const plan = planDishResearch(memory);

    expect(plan.hypotheses[0]).toMatchObject({
      name: 'egusi soup',
      confidence: 'Medium',
      researchRequired: true,
    });
    expect(plan.hypotheses[0].whyPossible.join(' ')).toContain('user supplied a possible dish name');
    expect(plan.searchQueries.join(' ')).toContain('egusi soup');
    expect(plan.searchQueries.join(' ')).toContain('Nigeria');
  });

  it('corrects likely typo fragments before planning research', () => {
    const memory = collectFoodMemory({
      memoryText: 'My aunt from Panama made carimanola, fried yuca with meat inside.',
      knownRegion: 'Panama',
      userLocation: 'Long Beach, CA',
    });
    const plan = planDishResearch(memory);
    const topHypothesis = plan.hypotheses[0];
    const joinedQueries = plan.searchQueries.join(' ').toLowerCase();

    expect(memory.extractedClues.possibleDishNames).toContain('carimanola');
    expect(memory.extractedClues.culturalOrRegionalHints).not.toContain('Panama made carimanola');
    expect(topHypothesis.name).toBe('Carimañola');
    expect(topHypothesis.whyPossible.join(' ').toLowerCase()).toContain('corrected likely spelling');
    expect(joinedQueries.indexOf('carimañola')).toBeGreaterThanOrEqual(0);
    expect(joinedQueries.indexOf('carimanola')).toBeGreaterThan(joinedQueries.indexOf('carimañola'));
    expect(joinedQueries).toContain('yuca');
  });

  it('treats sound-alike names as research clues instead of literal answers', () => {
    const memory = collectFoodMemory({
      memoryText: 'It sounded like chicky or cheeky, a brown peanut candy from India with sandy caramel texture.',
      knownRegion: 'India',
      userLocation: 'Denver, CO',
    });
    const plan = planDishResearch(memory);
    const names = plan.hypotheses.map((hypothesis) => hypothesis.name);
    const joinedQueries = plan.searchQueries.join(' ').toLowerCase();

    expect(memory.extractedClues.culturalOrRegionalHints).not.toContain('India with sandy caramel textu');
    expect(names[0]).toBe('Peanut Chikki');
    expect(plan.hypotheses[0].whyPossible.join(' ').toLowerCase()).toContain('sound-alike');
    expect(joinedQueries.indexOf('peanut chikki')).toBeGreaterThanOrEqual(0);
    expect(joinedQueries.indexOf('chicky')).toBeGreaterThan(joinedQueries.indexOf('peanut chikki'));
    expect(joinedQueries).toContain('india');
  });

  it('extracts quoted multi-word dish fragments without a closed demo list', () => {
    const memory = collectFoodMemory({ memoryText: 'She called it "momo achar" and said it was from Nepal.' });
    const plan = planDishResearch(memory);

    expect(memory.extractedClues.possibleDishNames).toContain('momo achar');
    expect(plan.hypotheses[0].name).toBe('momo achar');
    expect(plan.searchQueries.join(' ')).toContain('momo achar');
  });
});

describe('extractRegionHints idempotency', () => {
  it('returns the same region hints when called twice on the same input', () => {
    const text = 'My grandma from Puerto Rico made something with plantains.';
    const first = collectFoodMemory({ memoryText: text });
    const second = collectFoodMemory({ memoryText: text });
    expect(first.extractedClues.culturalOrRegionalHints).toEqual(
      second.extractedClues.culturalOrRegionalHints,
    );
    expect(first.extractedClues.culturalOrRegionalHints).toContain('Puerto Rican');
  });
});
