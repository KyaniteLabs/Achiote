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

function sesameCandyDossier() {
  const memory = collectFoodMemory({
    memoryText: 'I remember a tan candy that tasted like sesame and crumbled into powder. I had it as a kid outside the US.',
  });
  const researchPlan = planDishResearch(memory);
  return buildReconstructionDossier({
    memory,
    researchPlan,
    researchedFacts: [
      'Dulce de ajonjolí is a sesame candy that can be brittle, crumbly, and sugar-forward.',
      'The likely memory is driven by toasted sesame aroma and sugar crystallization texture.',
    ],
    inferredFacts: [
      'The first test should be built from cheap local pantry ingredients, not buying the exact suspected candy.',
    ],
  });
}


function cueRecommendationText(cue: ReturnType<typeof generateMinimumViableNostalgiaCue>) {
  return [
    ...cue.ingredients.map((ingredient) => `${ingredient.item} ${ingredient.purpose}`),
    ...cue.components.flatMap((component) => [
      component.criticalElement,
      component.flavorProfile,
      component.localTestWith,
      component.substitutionReason,
    ]),
  ].join(' ').toLowerCase();
}

function fullCueText(cue: ReturnType<typeof generateMinimumViableNostalgiaCue>) {
  return [
    cueRecommendationText(cue),
    ...cue.steps,
    ...cue.accessibilityPrinciples,
    ...cue.substituteLogic,
    cue.whyThisIsMinimum,
  ].join(' ').toLowerCase();
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

  it('builds confectionery tests from local pantry proxies instead of buying the suspected candy', () => {
    const cue = generateMinimumViableNostalgiaCue({
      dossier: sesameCandyDossier(),
      researchFindings: {
        researchedFacts: [
          'Dulce de ajonjolí is made around sesame aroma and sugar texture.',
          'Sesame candies can be brittle, crumbly, or crystalline depending on syrup and seed ratio.',
        ],
        inferredFacts: ['The first cue should recreate toasted seed aroma plus sugar crystallization from local ingredients.'],
        unknowns: ['exact country and family brand'],
        sourceCount: 2,
        confidence: 'Medium',
      },
      userLocation: 'Cleveland, Ohio',
      maxEffortMinutes: 10,
    });
    const recommendationText = fullCueText(cue);

    expect(cue.title).toContain('sweet-texture');
    expect(cue.effortMinutes).toBeLessThanOrEqual(10);
    expect(recommendationText).toMatch(/granulated sugar|plain sugar/);
    expect(recommendationText).toMatch(/sesame|seed|coconut|oat|cracker/);
    expect(recommendationText).toContain('do not buy the exact');
    expect(recommendationText).not.toMatch(/buy .*dulce de ajonjol[ií]|latin grocery|international aisle|grocery-store sweet matching/);
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

  it('rewrites composed-bite ingredients and components for vegan and halal constraints', () => {
    const cue = generateMinimumViableNostalgiaCue({
      dossier: spicedSausageMashDossier(),
      constraints: ['vegan', 'halal'],
      maxEffortMinutes: 20,
    });
    const ingredients = cue.ingredients.map((ingredient) => ingredient.item).join(' ').toLowerCase();
    const recommendationText = cueRecommendationText(cue);

    expect(recommendationText).not.toMatch(/meat|pork|chicken|lamb|dairy|butter|\bmilk\b|rendered fat|certified compliant (?:protein|meat)/);
    expect(ingredients).toMatch(/bean|mushroom|tofu|plant-based|olive oil/);
    expect(cue.safetyNotes.join(' ').toLowerCase()).toContain('halal');
  });

  it('qualifies animal proteins instead of naming pork or chicken for halal constraints', () => {
    const cue = generateMinimumViableNostalgiaCue({
      dossier: spicedSausageMashDossier(),
      constraints: ['halal'],
      maxEffortMinutes: 20,
    });
    const recommendationText = cueRecommendationText(cue);

    expect(recommendationText).not.toMatch(/ground pork|pork|chicken thigh|rendered fat/);
    expect(recommendationText).toMatch(/certified compliant (?:protein|meat|fat)/);
  });

  it('rewrites carriers for common gluten-free constraint phrasing', () => {
    const cue = generateMinimumViableNostalgiaCue({
      dossier: carimanolaDossier(),
      constraints: ['no gluten'],
      maxEffortMinutes: 20,
    });
    const ingredients = cue.ingredients.map((ingredient) => ingredient.item).join(' ').toLowerCase();
    const recommendationText = cueRecommendationText(cue);

    expect(recommendationText).not.toMatch(/bread|flour|tortilla/);
    expect(ingredients).toMatch(/rice|potato|corn|certified gluten-free/);
  });

  it('rewrites liquid cues for dairy-free and peanut allergy constraints', () => {
    const memory = collectFoodMemory({ memoryText: 'warm sour soup with dill and creamy body' });
    const dossier = buildReconstructionDossier({ memory, researchPlan: planDishResearch(memory) });
    const cue = generateMinimumViableNostalgiaCue({
      dossier,
      constraints: ['dairy-free', 'peanut allergy'],
      maxEffortMinutes: 12,
    });
    const recommendationText = cueRecommendationText(cue);
    const safety = cue.safetyNotes.join(' ').toLowerCase();

    expect(recommendationText).not.toMatch(/\bdairy\b|\bbutter\b|cow's milk|peanut/);
    expect(`${recommendationText} ${safety}`).toMatch(/water|broth|olive oil|clean utensils|cross-contact/);
    expect(safety).toContain('peanut allergy');
  });

  it('removes coconut and dairy cues when plural tree nut allergy phrasing overlaps dairy-free', () => {
    const memory = collectFoodMemory({ memoryText: 'warm sour soup with dill and creamy body' });
    const dossier = buildReconstructionDossier({ memory, researchPlan: planDishResearch(memory) });
    const cue = generateMinimumViableNostalgiaCue({
      dossier,
      constraints: ['allergic to tree nuts', 'no dairy'],
      maxEffortMinutes: 12,
    });
    const recommendationText = cueRecommendationText(cue);

    expect(recommendationText).not.toMatch(/coconut|peanut|tree nut|\bnut\b|\bdairy\b|\bbutter\b|\bmilk\b|yogurt/);
    expect(recommendationText).toMatch(/water|broth|olive oil|plant-based|oil-herb/);
  });

  it('clamps max effort to a positive number', () => {
    const cue = generateMinimumViableNostalgiaCue({ dossier: puertoRicanDossier(), maxEffortMinutes: -5 });

    expect(cue.effortMinutes).toBeGreaterThan(0);
  });
});
