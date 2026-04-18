import { describe, expect, it } from 'vitest';
import {
  buildReconstructionDossier,
  collectFoodMemory,
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

  it('plans research instead of pretending sparse fragments are resolved', () => {
    const memory = collectFoodMemory({
      memoryText: 'My grandma made something like pass-teh-lay for Christmas. Puerto Rican family.',
      userLocation: 'Orlando, FL',
    });
    const plan = planDishResearch(memory);

    expect(plan.researchRequired).toBe(true);
    expect(plan.hypotheses.map((hypothesis) => hypothesis.name)).toEqual(
      expect.arrayContaining(['pasteles', 'pastelón', 'piononos']),
    );
    expect(plan.searchQueries.length).toBeGreaterThanOrEqual(3);
    expect(plan.factsToVerify).toEqual(expect.arrayContaining(['base ingredient or starch', 'cooking method']));
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
});
