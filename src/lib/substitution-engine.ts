import type { SubstitutionResult, Confidence } from './types.js';
import ingredientsData from '../data/ingredients.json' with { type: 'json' };

const ingredients = ingredientsData.ingredients;

export function findSubstitutes(ingredientKey: string): SubstitutionResult[] {
  const normalized = ingredientKey.toLowerCase().replace(/\s+/g, '-').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let target = ingredients[normalized as keyof typeof ingredients];
  let matchedKey: string | null = normalized;

  if (!target) {
    for (const [key, value] of Object.entries(ingredients)) {
      if (Array.isArray(value.aliases) && value.aliases.some(a =>
        a.toLowerCase().replace(/\s+/g, '-').normalize('NFD').replace(/[\u0300-\u036f]/g, '') === normalized
      )) {
        target = value;
        matchedKey = key;
        break;
      }
    }
  }

  if (!target) return [];

  const results: (SubstitutionResult & { compoundMatch: number })[] = [];

  for (const [key, candidate] of Object.entries(ingredients)) {
    if (key === matchedKey) continue;

    const targetCompounds = new Set(target.compounds);
    const candidateCompounds = new Set(candidate.compounds);
    if (targetCompounds.size === 0 && candidateCompounds.size === 0) continue;
    const overlap = [...targetCompounds].filter(c => candidateCompounds.has(c));
    const matchScore = overlap.length / Math.max(targetCompounds.size, candidateCompounds.size);

    const sameGroup = !!(target.substitutionGroup && candidate.substitutionGroup && target.substitutionGroup === candidate.substitutionGroup);
    const groupBonus = sameGroup ? 0.2 : 0;

    const finalScore = Math.min(matchScore + groupBonus, 1);

    if (finalScore > 0.1) {
      const confidence: Confidence = finalScore > 0.7 ? 'High' : finalScore > 0.4 ? 'Medium' : 'Low';
      const tAroma = target.sensoryContribution?.aroma ?? 'unknown';
      const cAroma = candidate.sensoryContribution?.aroma ?? 'unknown';

      results.push({
        original: target.name,
        substitute: candidate.name,
        compoundMatch: Math.round(finalScore * 100) / 100,
        confidence,
        reasoning: `Shared compounds: ${overlap.join(', ') || 'none directly'}. Both in ${sameGroup ? 'same' : 'different'} flavor group (${target.substitutionGroup ?? 'none'} vs ${candidate.substitutionGroup ?? 'none'}). Aroma comparison: "${tAroma}" vs "${cAroma}".`,
        availableAt: 'Use source_ingredients tool for availability where the user is',
      });
    }
  }

  return results.sort((a, b) => b.compoundMatch - a.compoundMatch);
}
