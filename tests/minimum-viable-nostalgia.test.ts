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

function spicedSausageMashDossier() {
  const memory = collectFoodMemory({
    memoryText: 'South African place in Savannah served mashed potatoes and a long coiled grey speckled sausage with creamy gravy and a second orange sauce.',
  });
  const researchPlan = planDishResearch(memory);
  return buildReconstructionDossier({
    memory,
    researchPlan,
    researchedFacts: [
      'Boerewors is a coiled South African sausage commonly seasoned with coriander, black pepper, clove, nutmeg, and vinegar.',
      'The remembered plate had mashed potatoes, creamy gravy, and an orange sauce or relish similar to chakalaka.',
      'Chakalaka is commonly tomato/pepper/onion-based with curry-like spice, sweetness, heat, and acidity.',
    ],
    inferredFacts: [
      'The minimum cue should not require buying boerewors; it should test the spice profile on a cheap protein carrier.',
      'The orange sauce can be tested with a grocery-store tomato relish or salsa adjusted with curry/paprika, acid, and sugar.',
    ],
  });
}

describe('minimum viable nostalgia cue', () => {
  it('creates a small food-science cue instead of a full recipe for a named path', () => {
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
    expect(['bite', 'aroma-cue']).toContain(cue.format);
    expect(cue.accessibilityPrinciples.join(' ')).toContain('grocery-store');
    expect(cue.substituteLogic.join(' ')).toContain('fat-soluble aromatics');
    expect(cue.doesNotPreserve.join(' ')).toContain('exact specialty ingredient');

    expect(cue.components.length).toBeGreaterThanOrEqual(1);
    expect(cue.components.every((c) => c.criticalElement.length > 0)).toBe(true);
    expect(cue.components.every((c) => c.substitutionReason.length > 0)).toBe(true);
    expect(cue.components.some((c) => c.role === 'starch')).toBe(true);
    expect(cue.components.some((c) => c.role === 'protein')).toBe(true);
  });

  it('starts a researched fried starch memory with a composed bite, not a dish-specific cue', () => {
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

    expect(cue.title).toContain('composed-bite');
    expect(cue.title).not.toContain('soup');
    expect(cue.title).not.toContain('carimañola');
    expect(cue.title).not.toContain('yuca');
    expect(cue.format).toBe('bite');
    expect(cue.effortMinutes).toBeLessThanOrEqual(20);
    expect(cue.ingredients.map((ingredient) => ingredient.item).join(' ')).toContain('remembered base');
    expect(cue.substituteLogic.join(' ')).toContain('Proteins and fats');
    expect(cue.whyThisIsMinimum).toContain('food-science mechanisms');

    expect(cue.components.length).toBeGreaterThanOrEqual(1);
    expect(cue.components.some((c) => c.role === 'starch')).toBe(true);
    expect(cue.components.some((c) => c.role === 'protein')).toBe(true);
    const starch = cue.components.find((c) => c.role === 'starch')!;
    expect(starch.criticalElement).toContain('gelatinized');
    expect(starch.localTestWith).toContain('Long Beach');
    expect(starch.confidence).toBe('High');
  });

  it('uses accessible food-science proxy logic for protein, starch, gravy, and sauce memories', () => {
    const cue = generateMinimumViableNostalgiaCue({
      dossier: spicedSausageMashDossier(),
      researchFindings: {
        researchedFacts: [
          'Boerewors is often seasoned with coriander, clove, nutmeg, black pepper, and vinegar.',
          'Chakalaka-like orange relish can include tomato, pepper, onion, curry spice, sweetness, acidity, and heat.',
        ],
        inferredFacts: ['The first test should use grocery-store protein and pantry spices rather than exact imported sausage.'],
        unknowns: ['exact restaurant sauce recipe'],
        sourceCount: 2,
        confidence: 'Medium',
      },
      maxEffortMinutes: 20,
    });

    expect(cue.title).toContain('composed-bite');
    expect(cue.effortMinutes).toBeLessThanOrEqual(15);
    expect(cue.ingredients.map((ingredient) => ingredient.item).join(' ')).toContain('accessible protein');
    expect(cue.whyThisIsMinimum).toContain('food-science mechanisms');
    expect(cue.accessibilityPrinciples.join(' ')).toContain('grocery-store carriers');
    expect(cue.substituteLogic.join(' ')).toContain('fat-soluble aromatics');
    expect(cue.title).not.toContain('boerewors');
    expect(cue.title).not.toContain('sausage');

    expect(cue.components.length).toBeGreaterThanOrEqual(2);
    expect(cue.components.some((c) => c.role === 'starch')).toBe(true);
    expect(cue.components.some((c) => c.role === 'protein')).toBe(true);
    expect(cue.components.some((c) => c.role === 'sauce')).toBe(true);
    for (const comp of cue.components) {
      expect(comp.criticalElement.length).toBeGreaterThan(0);
      expect(comp.flavorProfile.length).toBeGreaterThan(0);
      expect(comp.substitutionReason.length).toBeGreaterThan(0);
    }
  });

  it('uses the soup cue for unresolved sour soup memories', () => {
    const memory = collectFoodMemory({ memoryText: 'I remember a warm sour smell with dill but not the dish name.' });
    const dossier = buildReconstructionDossier({ memory, researchPlan: planDishResearch(memory) });
    const cue = generateMinimumViableNostalgiaCue({ dossier, maxEffortMinutes: 8 });

    expect(cue.effortMinutes).toBeLessThanOrEqual(8);
    expect(cue.title).toContain('aroma-balance');
    expect(cue.steps.join(' ')).toContain('single strongest sensory clue');
    expect(cue.confidence).toBe('Low');

    expect(cue.components.length).toBeGreaterThanOrEqual(1);
    expect(cue.components.every((c) => c.criticalElement.length > 0)).toBe(true);
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

    expect(cue.components.length).toBeGreaterThanOrEqual(1);
  });

  it('clamps max effort to a positive number', () => {
    const cue = generateMinimumViableNostalgiaCue({ dossier: puertoRicanDossier(), maxEffortMinutes: -5 });

    expect(cue.effortMinutes).toBeGreaterThan(0);
  });
});
