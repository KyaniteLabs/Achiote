import { describe, expect, it } from 'vitest';
import {
  buildReconstructionDossier,
  collectFoodMemory,
  generateMinimumViableNostalgiaCue,
  planDishResearch,
} from '../src/lib/memory-workflow.js';

function puertoRicanDossier() {
  const memory = collectFoodMemory({
    memoryText: "My mom said my Puerto Rican grandma made something that sounded like pass-teh-lay. Maybe plantains or pork.",
  });
  const researchPlan = planDishResearch(memory);
  return buildReconstructionDossier({
    memory,
    researchPlan,
    researchedFacts: [
      'Pasteles are often wrapped in banana leaves.',
      'Pasteles may use green banana or root-vegetable masa.',
      'Pork or sofrito-seasoned filling is common in many family versions.',
    ],
    inferredFacts: ['The likely memory cue should be tested through aroma and seasoning before a full recipe.'],
  });
}

describe('minimum viable nostalgia cue', () => {
  it('creates a small sensory cue instead of a full recipe for the pasteles path', () => {
    const cue = generateMinimumViableNostalgiaCue({
      dossier: puertoRicanDossier(),
      researchFindings: {
        researchedFacts: ['Pasteles are often wrapped in banana leaves.'],
        inferredFacts: ['Ingredient signal: banana leaves', 'Ingredient signal: sofrito'],
        unknowns: ['family-specific version'],
        sourceCount: 1,
        confidence: 'Medium',
      },
      userLocation: 'Orlando, FL',
    });

    expect(cue.title).toContain('Minimum viable');
    expect(cue.effortMinutes).toBeLessThanOrEqual(20);
    expect(cue.format).toBe('aroma-cue');
    expect(cue.ingredients.map((ingredient) => ingredient.item)).toEqual(expect.arrayContaining(['banana leaf, fresh or frozen']));
    expect(cue.steps.join(' ')).toContain('Smell');
    expect(cue.doesNotPreserve.join(' ')).toContain('full wrapped-packet technique');
    expect(cue.whyThisIsMinimum).toContain('multi-hour');
  });

  it('falls back to a tiny sensory probe when the dish remains unknown', () => {
    const memory = collectFoodMemory({ memoryText: 'I remember a warm sour smell with dill but not the dish name.' });
    const dossier = buildReconstructionDossier({ memory, researchPlan: planDishResearch(memory) });
    const cue = generateMinimumViableNostalgiaCue({ dossier, maxEffortMinutes: 8 });

    expect(cue.effortMinutes).toBeLessThanOrEqual(8);
    expect(cue.title).toContain('Minimum viable');
    expect(cue.steps.join(' ')).toContain('one spoonful');
    expect(cue.confidence).toBe('Low');
  });
});
