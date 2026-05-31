import type { CollectedFoodMemory, Confidence, DishNameCandidate, DishNameMatchType, DishNameResolution } from './types.js';
import dishFamiliesData from '../data/dish-families.json' with { type: 'json' };

const families = dishFamiliesData.families;

type Family = (typeof families)[number];
type Variant = {
  name: string;
  aliases: string[];
  regions: string[];
  distinguishingElements?: string[];
  clarificationPrompt?: string;
};

export type DishNameResolutionContext = {
  memory?: CollectedFoodMemory;
  researchedFacts?: string[];
};

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > Math.max(m, n) * 0.3) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = new Array<number>(n + 1);
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = curr;
  }
  return prev[n];
}

function normalize(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[-_\s]+/g, '-')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function confidenceForScore(score: number): Confidence {
  if (score >= 0.95) return 'High';
  if (score >= 0.7) return 'Medium';
  return 'Low';
}

function transliterationsFor(family: Family): string[] {
  return Object.values(family.transliterations).flat();
}

function candidateFromFamily(
  family: Family,
  matchedName: string,
  score: number,
  matchType: DishNameMatchType,
  variant?: Variant,
): DishNameCandidate {
  const candidate: DishNameCandidate = {
    canonicalName: family.canonicalName,
    dishFamily: family.canonicalName,
    region: (variant?.regions ?? family.regions).join(', '),
    confidence: confidenceForScore(score),
    score: Math.round(score * 100) / 100,
    matchType,
    matchedName,
  };

  if (variant?.name) candidate.variantName = variant.name;
  if (variant?.distinguishingElements) candidate.distinguishingElements = variant.distinguishingElements;
  if (variant?.clarificationPrompt) candidate.clarificationPrompt = variant.clarificationPrompt;

  return candidate;
}

function allCandidatesFor(input: string): DishNameCandidate[] {
  const normalized = normalize(input);
  const candidates: DishNameCandidate[] = [];

  for (const family of families) {
    for (const name of [family.canonicalName, ...family.aliases]) {
      const normalizedName = normalize(name);
      if (normalized === normalizedName) {
        candidates.push(candidateFromFamily(family, name, 1, 'exact'));
      } else {
        const distance = levenshtein(normalized, normalizedName);
        const maxLen = Math.max(normalized.length, normalizedName.length);
        const similarity = maxLen > 0 ? 1 - distance / maxLen : 0;
        if (similarity > 0.7) {
          candidates.push(candidateFromFamily(family, name, similarity, 'fuzzy'));
        }
      }
    }

    for (const forms of Object.values(family.transliterations)) {
      for (const form of forms) {
        if (normalized === normalize(form)) {
          candidates.push(candidateFromFamily(family, form, 1, 'transliteration'));
        }
      }
    }

    for (const variant of ((family as { variants?: Variant[] }).variants ?? [])) {
      for (const name of [variant.name, ...variant.aliases]) {
        const normalizedName = normalize(name);
        if (normalized === normalizedName) {
          candidates.push(candidateFromFamily(family, name, 1, 'variant', variant));
        } else {
          const distance = levenshtein(normalized, normalizedName);
          const maxLen = Math.max(normalized.length, normalizedName.length);
          const similarity = maxLen > 0 ? 1 - distance / maxLen : 0;
          if (similarity > 0.78) {
            candidates.push(candidateFromFamily(family, name, similarity, 'variant', variant));
          }
        }
      }
    }
  }

  return dedupeCandidates(candidates).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.matchType === 'variant' && b.matchType !== 'variant') return -1;
    if (b.matchType === 'variant' && a.matchType !== 'variant') return 1;
    return 0;
  });
}

function dedupeCandidates(candidates: DishNameCandidate[]): DishNameCandidate[] {
  const seen = new Map<string, DishNameCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.canonicalName}:${candidate.variantName ?? ''}:${candidate.matchedName}`;
    const existing = seen.get(key);
    if (!existing || candidate.score > existing.score) {
      seen.set(key, candidate);
    }
  }
  return [...seen.values()];
}

function buildResolution(input: string, candidate: DishNameCandidate, candidates: DishNameCandidate[], needsClarification: boolean): DishNameResolution {
  const family = families.find((item) => item.canonicalName === candidate.canonicalName);
  const resolution: DishNameResolution = {
    input,
    canonicalName: candidate.canonicalName,
    aliases: family?.aliases ?? [],
    transliterations: family ? transliterationsFor(family) : [],
    dishFamily: candidate.dishFamily,
    region: candidate.region,
    confidence: needsClarification ? 'Medium' : candidate.confidence,
    matchType: needsClarification ? 'ambiguous' : candidate.matchType,
    score: candidate.score,
    needsClarification,
    candidates: candidates.slice(0, 5),
  };

  const clarificationPrompt = needsClarification
    ? `I found multiple plausible meanings for "${input}". Which regional dish or technique do you mean?`
    : candidate.clarificationPrompt;
  if (clarificationPrompt) resolution.clarificationPrompt = clarificationPrompt;

  return resolution;
}

function isAmbiguous(candidates: DishNameCandidate[]): boolean {
  if (candidates.length < 2) return false;

  const topScore = candidates[0].score;
  const plausibleNearTies = candidates.filter((candidate) => topScore - candidate.score <= 0.12 && candidate.score >= 0.7);
  const distinctTargets = new Set(plausibleNearTies.map((candidate) => candidate.canonicalName));
  return distinctTargets.size > 1;
}

function chooseBestCandidate(candidates: DishNameCandidate[]): DishNameCandidate {
  return [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.matchType === 'variant' && b.matchType !== 'variant') return -1;
    if (b.matchType === 'variant' && a.matchType !== 'variant') return 1;
    return 0;
  })[0];
}

function cleanLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed || /^unknown$/i.test(trimmed)) return undefined;
  return trimmed;
}

function extractedRegionFrom(context?: DishNameResolutionContext): string | undefined {
  const memory = context?.memory;
  const metadataRegion = cleanLabel(memory?.extractionMetadata?.originRegion);
  if (metadataRegion) return metadataRegion;

  const explicitHint = memory?.extractedClues.culturalOrRegionalHints
    .map(cleanLabel)
    .find(Boolean);
  if (explicitHint) return explicitHint;

  return memory?.inferredContext.culturalOrRegional
    .map((clue) => cleanLabel(clue.label))
    .find(Boolean);
}

function contextTextFor(memory: CollectedFoodMemory | undefined): string {
  if (!memory) return '';
  return [
    memory.rawMemory,
    ...memory.extractedClues.rememberedIngredients,
    ...(memory.extractedClues.cookingMethods ?? []),
    ...memory.extractedClues.sensoryClues,
    ...memory.extractedClues.occasions,
  ].join(' ').toLowerCase();
}

function unresolvedFamilyFrom(context?: DishNameResolutionContext): string | undefined {
  const memory = context?.memory;
  const text = contextTextFor(memory);
  const researched = (context?.researchedFacts ?? []).join(' ').toLowerCase();
  const combined = `${text} ${researched}`;

  if (/\b(?:rice|arroz)\b/.test(combined)) return 'regional rice-dish clue';
  if (/\b(?:porridge|ferment|fermented|sour|banana leaf|steamed)\b/.test(combined)) {
    return 'regional steamed-fermented starch clue';
  }
  if (/\b(?:fried|frit|crispy|crisp|thick cut|syrup|sweet|plantain|yuca|cassava|maiz|corn)\b/.test(combined)) {
    return 'regional fried-starch clue';
  }
  if (/\b(?:drink|beverage|agua|juice|tea|coffee)\b/.test(combined)) return 'regional drink clue';
  if (extractedRegionFrom(context)) return 'regional food-memory clue';
  return undefined;
}

export function resolveDishName(input: string, context?: DishNameResolutionContext): DishNameResolution {
  const candidates = allCandidatesFor(input);

  if (candidates.length > 0) {
    const ambiguous = isAmbiguous(candidates);
    const exactCandidates = candidates.filter((candidate) => candidate.score >= 0.99);
    const best = ambiguous ? candidates[0] : chooseBestCandidate(exactCandidates.length > 0 ? exactCandidates : candidates);
    return buildResolution(input, best, candidates, ambiguous);
  }

  const normalized = normalize(input);
  const safeName = normalized.length > 80 ? normalized.slice(0, 80) : input;
  const contextRegion = extractedRegionFrom(context);
  const contextFamily = unresolvedFamilyFrom(context);
  return {
    input,
    canonicalName: safeName,
    aliases: [],
    transliterations: [],
    dishFamily: contextFamily ?? 'unknown',
    region: contextRegion ?? 'unknown',
    confidence: 'Low',
    matchType: 'unknown',
    score: 0,
    needsClarification: true,
    candidates: [],
    clarificationPrompt: contextRegion || contextFamily
      ? `I could not confidently match "${input}" in the reference database. Treat it as an unresolved ${contextRegion ?? 'regional'} food-memory clue and ask for local spelling, base ingredient, language, or cooking method before adapting it.`
      : `I could not confidently match "${input}". Ask for region, ingredients, language, or cooking method before adapting it.`,
  };
}
