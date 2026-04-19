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

function carimanolaDossier() {
  const memory = collectFoodMemory({
    memoryText: 'carimanola from Panama; my mom made them but said they were too much work',
  });
  const researchPlan = planDishResearch(memory);
  return buildReconstructionDossier({
    memory,
    researchPlan,
    researchedFacts: [
      'Carimañolas are Panamanian fried yuca rolls stuffed with seasoned beef picadillo.',
      'The yuca dough is boiled and mashed, then shaped around filling and fried until golden.',
      'Picadillo often uses garlic, onion, cumin, achiote, oregano, tomato paste, and culantro.',
      'The nostalgia-critical contrast is a crispy exterior with chewy yuca and savory filling.',
    ],
    inferredFacts: ['The fastest confirmation cue is picadillo aroma plus a separate crispy yuca bite.'],
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

  it('starts carimañola with a picadillo and yuca cue, not a generic soup cue', () => {
    const cue = generateMinimumViableNostalgiaCue({
      dossier: carimanolaDossier(),
      researchFindings: {
        researchedFacts: [
          'Carimañolas are fried yuca rolls with beef picadillo.',
          'Achiote, cumin, oregano, garlic, and tomato paste season the filling.',
          'The texture contrast is crispy fried yuca outside and chewy starch inside.',
        ],
        inferredFacts: ['The picadillo aroma is the fastest nostalgia trigger.'],
        unknowns: ['family-specific filling'],
        sourceCount: 3,
        confidence: 'High',
      },
      userLocation: 'Long Beach, California',
      constraints: ['Under 20 minutes'],
      maxEffortMinutes: 20,
    });

    expect(cue.title).toContain('carimañola');
    expect(cue.title).not.toContain('soup');
    expect(cue.format).toBe('bite');
    expect(cue.effortMinutes).toBeLessThanOrEqual(20);
    expect(cue.ingredients.map((ingredient) => ingredient.item).join(' ')).toMatch(/yuca|cassava/);
    expect(cue.steps.join(' ')).toContain('do not shape or stuff anything yet');
    expect(cue.whyThisIsMinimum).toContain('labor-intensive');
  });

  it('uses the soup cue for unresolved sour soup memories', () => {
    const memory = collectFoodMemory({ memoryText: 'I remember a warm sour smell with dill but not the dish name.' });
    const dossier = buildReconstructionDossier({ memory, researchPlan: planDishResearch(memory) });
    const cue = generateMinimumViableNostalgiaCue({ dossier, maxEffortMinutes: 8 });

    expect(cue.effortMinutes).toBeLessThanOrEqual(8);
    expect(cue.title).toContain('soup/stew');
    expect(cue.steps.join(' ')).toContain('one spoonful');
    expect(cue.confidence).toBe('Low');
  });

  it('does not route generic pork soup signals to the pasteles cue', () => {
    const memory = collectFoodMemory({ memoryText: 'My uncle remembered pork broth with dill and sour greens.' });
    const dossier = buildReconstructionDossier({
      memory,
      researchPlan: planDishResearch(memory),
      researchedFacts: ['The remembered dish involved pork broth, dill, and sour greens.'],
    });
    const cue = generateMinimumViableNostalgiaCue({ dossier });

    expect(cue.title).not.toContain('pasteles');
    expect(cue.format).toBe('sip');
  });

  it('clamps max effort to a positive number', () => {
    const cue = generateMinimumViableNostalgiaCue({ dossier: puertoRicanDossier(), maxEffortMinutes: -5 });

    expect(cue.effortMinutes).toBeGreaterThan(0);
  });
});
