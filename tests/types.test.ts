import { describe, it, expect } from 'vitest';
import type {
  DishDescription,
  SensoryProfile,
  SensoryDimension,
  IngredientCompound,
  SubstitutionResult,
  RecipeOutput,
  SourcingResult,
  RegionalSimilar,
  DishNameResolution,
  ResearchCacheEntry,
} from '../src/lib/types.js';

describe('type definitions exist and are valid', () => {
  it('DishDescription accepts expected shape', () => {
    const dish: DishDescription = {
      name: 'empanada',
      description: 'My grandmother made beef empanadas with a flaky crust',
      region: 'South America',
      location: 'Los Angeles, CA',
      culturalContext: 'Family recipe from Argentina',
      dietaryConstraints: ['low-sodium'],
    };
    expect(dish.name).toBe('empanada');
  });

  it('SensoryProfile has all five dimensions', () => {
    const profile: SensoryProfile = {
      aroma: { score: 8, notes: 'cumin and garlic', isNostalgiaCritical: true },
      texture: { score: 7, notes: 'flaky crust', isNostalgiaCritical: true },
      flavor: { score: 9, notes: 'umami-rich beef', isNostalgiaCritical: false },
      visual: { score: 5, notes: 'golden brown', isNostalgiaCritical: false },
      temperature: { score: 6, notes: 'served hot', isNostalgiaCritical: false },
    };
    const dimensions: SensoryDimension[] = ['aroma', 'texture', 'flavor', 'visual', 'temperature'];
    expect(dimensions.every(d => d in profile)).toBe(true);
  });

  it('IngredientCompound maps to volatile compounds', () => {
    const compound: IngredientCompound = {
      ingredient: 'cumin seeds',
      compounds: ['cuminaldehyde', 'p-cymene', 'beta-pinene'],
      sensoryContribution: { aroma: 'warm, earthy, nutty', flavor: 'savory, slightly bitter' },
      substitutionGroup: 'warm-spice',
    };
    expect(compound.compounds.length).toBeGreaterThan(0);
  });

  it('SubstitutionResult has confidence and reasoning', () => {
    const sub: SubstitutionResult = {
      original: 'ají amarillo paste',
      substitute: 'scotch bonnet + mango puree',
      compoundMatch: 0.72,
      confidence: 'Medium',
      reasoning: 'Both provide capsaicin heat and fruity sweetness.',
      availableAt: 'Whole Foods, Bristol Farms',
    };
    expect(sub.confidence).toBe('Medium');
  });

  it('RecipeOutput has all required sections', () => {
    const recipe: RecipeOutput = {
      title: 'Recreated Beef Empanadas',
      yield: '12 empanadas',
      prepTime: '45 min',
      cookTime: '25 min',
      ingredients: [{ item: 'ground beef', amount: '1 lb', notes: '80/20 lean' }],
      steps: ['Mix dough', 'Prepare filling', 'Fill and crimp', 'Bake at 400F'],
      sensoryAnalysis: 'Nostalgia trigger: cumin-garlic aroma with flaky crust',
      confidencePerElement: { 'cumin-garlic aroma': 'High', 'flaky crust': 'High', 'beef filling texture': 'Medium' },
      whatsDifferent: 'Using butter-based pie dough instead of manteca',
    };
    expect(recipe.steps.length).toBeGreaterThan(0);
  });
});
