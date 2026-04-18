import type { SubstitutionResult, Confidence } from './types.js';
import ingredientsData from '../data/ingredients.json' with { type: 'json' };

const ingredients = ingredientsData.ingredients;

export function findSubstitutes(ingredientKey: string): SubstitutionResult[] {
  const normalized = ingredientKey.toLowerCase().replace(/\s+/g, '-');
  const target = ingredients[normalized as keyof typeof ingredients];

  if (!target) return [];

  const results: (SubstitutionResult & { compoundMatch: number })[] = [];

  for (const [key, candidate] of Object.entries(ingredients)) {
    if (key === normalized) continue;

    const targetCompounds = new Set(target.compounds);
    const candidateCompounds = new Set(candidate.compounds);
    const overlap = [...targetCompounds].filter(c => candidateCompounds.has(c));
    const matchScore = overlap.length / Math.max(targetCompounds.size, candidateCompounds.size);

    const sameGroup = target.substitutionGroup === candidate.substitutionGroup;
    const groupBonus = sameGroup ? 0.2 : 0;

    const finalScore = Math.min(matchScore + groupBonus, 1);

    if (finalScore > 0.1) {
      const confidence: Confidence = finalScore > 0.7 ? 'High' : finalScore > 0.4 ? 'Medium' : 'Low';

      results.push({
        original: target.name,
        substitute: candidate.name,
        compoundMatch: Math.round(finalScore * 100) / 100,
        confidence,
        reasoning: `Shared compounds: ${overlap.join(', ') || 'none directly'}. Both in ${sameGroup ? 'same' : 'different'} flavor group (${target.substitutionGroup} vs ${candidate.substitutionGroup}). Aroma comparison: "${target.sensoryContribution.aroma}" vs "${candidate.sensoryContribution.aroma}".`,
        availableAt: 'Use source_ingredients tool for specific local availability',
      });
    }
  }

  return results.sort((a, b) => b.compoundMatch - a.compoundMatch);
}
