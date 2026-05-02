import { describe, expect, it } from 'vitest';
import {
  adaptCueProfileForConstraints,
  classifyConstraintClasses,
  rewriteCueComponentsForConstraints,
  rewriteCueIngredientForConstraints,
} from '../src/lib/constraint-adapter.js';
import type { FoodScienceCueProfile } from '../src/lib/cue-profile-engine.js';
import type { CueComponent } from '../src/lib/types.js';

const proteinComponent: CueComponent = {
  role: 'protein',
  criticalElement: 'fat-rendered Maillard crust and spice-carrying fat',
  flavorProfile: 'savory meat, cheese, and browned fat',
  localTestWith: 'any accessible protein: ground pork, chicken thigh, or firm tofu pan-seared in oil',
  substitutionReason: 'Proteins that render fat carry fat-soluble aromatics',
  confidence: 'Medium',
};

const profile: FoodScienceCueProfile = {
  title: 'Minimum viable composed-bite cue',
  goal: 'Test one compliant mechanism.',
  effortMinutes: 10,
  format: 'bite',
  ingredients: [
    {
      item: 'small amount of accessible protein, fat, dairy, mushroom, bean, or plant-based substitute if relevant',
      amount: '1 teaspoon',
      purpose: 'tests protein and fat carrier',
    },
    {
      item: 'neutral carrier such as bread, rice, potato, cracker, tortilla, or cooked starch',
      amount: '1 bite',
      purpose: 'tests starch texture',
    },
    {
      item: 'tiny fat source such as oil, butter, rendered fat, or coconut milk if relevant',
      amount: 'drop',
      purpose: 'tests fat-soluble aroma',
    },
  ],
  steps: ['Taste safely.'],
  preserves: ['mechanism'],
  doesNotPreserve: ['exact dish'],
  accessibilityPrinciples: ['Use pantry ingredients first.'],
  substituteLogic: ['Match mechanism.'],
  whyThisIsMinimum: 'One constrained cue is enough.',
  safetyNotes: ['Avoid allergens.'],
  followUpIfItWorks: ['Ask what worked.'],
  components: [proteinComponent],
};

describe('ConstraintAdapter', () => {
  it('classifies common dietary, religious, and allergy constraints', () => {
    const classes = classifyConstraintClasses([
      'vegan and gluten-free',
      'nut allergy',
      'halal',
      'dairy-free',
    ]);

    expect([...classes].sort()).toEqual(['dairy-free', 'gluten-free', 'halal', 'nut-allergy', 'vegan']);
  });

  it('rewrites cue ingredients instead of preserving restricted defaults', () => {
    const veganGlutenFree = classifyConstraintClasses(['vegan', 'gluten-free']);
    const rewritten = rewriteCueIngredientForConstraints(
      'neutral carrier such as bread, rice, potato, cracker, tortilla, or cooked starch with butter',
      veganGlutenFree,
    );

    expect(rewritten).toContain('certified gluten-free');
    expect(rewritten).toContain('olive oil');
    expect(rewritten).not.toMatch(/\bbread\b|\bcracker\b|\btortilla\b|\bbutter\b/i);
  });

  it('rewrites local component tests for vegan and kosher/halal constraints', () => {
    const veganComponents = rewriteCueComponentsForConstraints([proteinComponent], classifyConstraintClasses(['vegan']));
    const kosherComponents = rewriteCueComponentsForConstraints([proteinComponent], classifyConstraintClasses(['kosher']));

    expect(veganComponents[0].localTestWith).toContain('plant-based protein');
    expect(veganComponents[0].criticalElement).toContain('oil-carried');
    expect(kosherComponents[0].localTestWith).toContain('certified compliant protein');
    expect(kosherComponents[0].criticalElement).toContain('certified compliant');
  });

  it('returns adapted profile plus explicit safety guidance', () => {
    const adapted = adaptCueProfileForConstraints(profile, ['nut-free', 'vegan', 'halal', 'gluten-free']);
    const text = JSON.stringify(adapted.profile);

    expect(adapted.classes.has('nut-allergy')).toBe(true);
    expect(adapted.profile.ingredients[0].item).toContain('plant-based');
    expect(adapted.profile.ingredients[1].item).toContain('certified gluten-free');
    expect(adapted.guidance.safetyNotes.join(' ')).toContain('nut-free, vegan, halal, gluten-free');
    expect(text).not.toMatch(/\bground pork\b|\bchicken thigh\b|\bbread\b|\bcracker\b|\btortilla\b|\bbutter\b|\bcoconut milk\b/i);
  });
});
