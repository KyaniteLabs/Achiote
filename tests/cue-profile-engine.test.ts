import { describe, expect, it } from 'vitest';
import { runCueProfileEngine, type FoodScienceCueProfile } from '../src/lib/cue-profile-engine.js';
import type { CueComponent } from '../src/lib/types.js';

const component: CueComponent = {
  role: 'sauce',
  criticalElement: 'acid-fat-salt balance',
  flavorProfile: 'bright acid against browned fat',
  localTestWith: 'tomato paste with vinegar and oil',
  substitutionReason: 'Sauce memory follows balance before exact recipe identity',
  confidence: 'Medium',
};

const profile: FoodScienceCueProfile = {
  title: 'Minimum viable composed-bite cue',
  goal: 'Test one mechanism at a time.',
  effortMinutes: 8,
  format: 'bite',
  ingredients: [
    {
      item: 'pantry sauce base',
      amount: '1 teaspoon',
      purpose: 'tests acid, salt, fat, and aroma balance',
    },
  ],
  steps: ['Taste one small cue.'],
  preserves: ['sensory mechanism'],
  doesNotPreserve: ['exact dish'],
  accessibilityPrinciples: ['Use cheap grocery-store carriers first.'],
  substituteLogic: ['Match the mechanism, not the proper noun.'],
  whyThisIsMinimum: 'It isolates the cheapest mechanism first.',
  safetyNotes: ['Avoid allergens.'],
  followUpIfItWorks: ['Ask what changed.'],
  components: [component],
};

describe('CueProfileEngine', () => {
  it('turns the existing heuristic profile into explicit engine evidence surfaces', () => {
    const output = runCueProfileEngine({
      signals: 'sauce acid browned fat',
      confidence: 'Medium',
      buildProfile: () => profile,
      decomposeComponents: () => [component],
    });

    expect(output.profile).toEqual(profile);
    expect(output.components).toEqual([component]);
    expect(output.mechanismLanguage).toEqual(expect.arrayContaining([
      'acid-fat-salt balance',
      'bright acid against browned fat',
      'Sauce memory follows balance before exact recipe identity',
    ]));
    expect(output.accessibilityPrinciples).toEqual(['Use cheap grocery-store carriers first.']);
    expect(output.localTestText.join(' ')).toContain('tomato paste with vinegar and oil');
  });

  it('falls back to decomposed components when a profile omits component evidence', () => {
    const output = runCueProfileEngine({
      signals: 'starch texture',
      confidence: 'Low',
      buildProfile: () => ({ ...profile, components: [] }),
      decomposeComponents: () => [component],
    });

    expect(output.profile.components).toEqual([component]);
    expect(output.components).toEqual([component]);
  });
});
