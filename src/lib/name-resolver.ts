import type { DishNameResolution, Confidence } from './types.js';
import dishFamiliesData from '../data/dish-families.json' with { type: 'json' };

const families = dishFamiliesData.families;

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}

function normalize(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[-_\s]+/g, '-')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function resolveDishName(input: string): DishNameResolution {
  const normalized = normalize(input);

  // Phase 1: Exact match against canonical names, aliases, and transliterations
  for (const family of families) {
    const allNames = [family.canonicalName, ...family.aliases];

    for (const name of allNames) {
      const normalizedAlias = normalize(name);

      if (normalized === normalizedAlias) {
        return {
          input,
          canonicalName: family.canonicalName,
          aliases: family.aliases,
          transliterations: Object.values(family.transliterations).flat(),
          dishFamily: family.canonicalName,
          region: family.regions.join(', '),
          confidence: 'High',
        };
      }
    }

    for (const forms of Object.values(family.transliterations)) {
      for (const form of forms) {
        if (normalized === normalize(form)) {
          return {
            input,
            canonicalName: family.canonicalName,
            aliases: family.aliases,
            transliterations: Object.values(family.transliterations).flat(),
            dishFamily: family.canonicalName,
            region: family.regions.join(', '),
            confidence: 'High',
          };
        }
      }
    }
  }

  // Phase 2: Fuzzy matching fallback via Levenshtein distance
  let bestMatch: { family: (typeof families)[0]; confidence: Confidence } | null = null;
  let bestScore = Infinity;

  for (const family of families) {
    const allNames = [family.canonicalName, ...family.aliases];
    for (const name of allNames) {
      const normalizedAlias = normalize(name);
      const distance = levenshtein(normalized, normalizedAlias);
      const maxLen = Math.max(normalized.length, normalizedAlias.length);
      const similarity = maxLen > 0 ? 1 - distance / maxLen : 0;

      if (similarity > 0.7 && distance < bestScore) {
        bestScore = distance;
        bestMatch = { family, confidence: 'Medium' };
      }
    }
  }

  if (bestMatch) {
    return {
      input,
      canonicalName: bestMatch.family.canonicalName,
      aliases: bestMatch.family.aliases,
      transliterations: Object.values(bestMatch.family.transliterations).flat(),
      dishFamily: bestMatch.family.canonicalName,
      region: bestMatch.family.regions.join(', '),
      confidence: bestMatch.confidence,
    };
  }

  // Phase 3: No match found
  return {
    input,
    canonicalName: input,
    aliases: [],
    transliterations: [],
    dishFamily: 'unknown',
    region: 'unknown',
    confidence: 'Low',
  };
}
