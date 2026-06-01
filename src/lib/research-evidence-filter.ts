export type SearchResultLike = {
  title?: string;
  link?: string;
  snippet?: string;
};

const LOW_QUALITY_RESEARCH_DOMAINS = [
  'amazon.',
  'doordash.',
  'ebay.',
  'etsy.',
  'grubhub.',
  'instacart.',
  'ubereats.',
  'walmart.',
];

const COMMERCIAL_RESEARCH_NOISE =
  /\b(?:add to cart|buy online|delivery|delivered to you|in stock|near me|order online|pickup|price|same[-\s]?day|shop(?:ping)?|start shopping|store pickup)\b/i;

const SUPPLEMENT_RESEARCH_NOISE =
  /\b(?:capsules?|cleansing|detox|dietary supplement|extract|herb pharm|liquid extract|supplement)\b/i;

const FOOD_CULTURE_SIGNAL =
  /\b(?:cook(?:ed|ing)?|cuisine|dish|family recipe|festival|food|fried|ingredient|meal|preparation|recipe|regional|simmer(?:ed)?|stew|street food|traditional|wrapped)\b/i;

// ── Flavor-polarity relevance gate ───────────────────────────────────────────
// Drops research results whose flavor family clearly contradicts the remembered
// dish (e.g. a savory "oven-baked ground beef" result for a remembered dessert).
// Deliberately conservative: a result is only rejected when BOTH the memory and
// the result resolve to an unambiguous — and opposite — polarity. Anything mixed
// or uncertain resolves to null and is always kept, minimizing false drops.
export type FlavorPolarity = 'sweet' | 'savory' | null;
export type MemoryRelevanceContext = { polarity: FlavorPolarity };

// Only genuinely unambiguous dessert cues. Acidity/pastry words that also occur
// in savory dishes (e.g. "tart" tamarind, meat "pie") are deliberately excluded
// so the gate never misclassifies a sour/savory memory as sweet and drops valid
// savory evidence.
const SWEET_FLAVOR_SIGNAL =
  /\b(?:dessert|sweets?|cakes?|bizcocho|cookies?|brownies?|custard|flan|pudding|mousse|candy|caramel|dulce de leche|chocolate|frosting|icing|meringue|sponge cake|tres leches|cheesecake|honey|syrup)\b/gi;

const SAVORY_FLAVOR_SIGNAL =
  /\b(?:beef|pork|chicken|lamb|fish|seafood|shrimp|prawns?|meat|meatballs?|sausage|bacon|ham|stew|soup|broth|gravy|casserole|roast(?:ed)?|savou?ry|sofrito|gumbo|chili)\b/gi;

function countMatches(text: string, signal: RegExp): number {
  const matches = text.toLowerCase().match(signal);
  return matches ? matches.length : 0;
}

export function classifyFlavorPolarity(text: string): FlavorPolarity {
  if (!text || !text.trim()) return null;
  const sweet = countMatches(text, SWEET_FLAVOR_SIGNAL);
  const savory = countMatches(text, SAVORY_FLAVOR_SIGNAL);
  if (sweet > 0 && savory === 0) return 'sweet';
  if (savory > 0 && sweet === 0) return 'savory';
  return null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function collectMemoryAnchorText(memory: unknown): string {
  if (!memory || typeof memory !== 'object') return '';
  const record = memory as Record<string, unknown>;
  const clues = record.extractedClues && typeof record.extractedClues === 'object'
    ? (record.extractedClues as Record<string, unknown>)
    : {};
  const parts = [
    ...asStringArray(clues.possibleDishNames),
    ...asStringArray(clues.rememberedIngredients),
    ...asStringArray(clues.sensoryClues),
    typeof record.dishFamily === 'string' ? record.dishFamily : '',
    typeof record.rawMemory === 'string' ? record.rawMemory : '',
    typeof record.normalizedMemory === 'string' ? record.normalizedMemory : '',
  ];
  return parts.filter(Boolean).join(' ');
}

export function buildMemoryRelevanceContext(memory: unknown): MemoryRelevanceContext {
  return { polarity: classifyFlavorPolarity(collectMemoryAnchorText(memory)) };
}

export function contradictsMemoryRelevance(text: string, context?: MemoryRelevanceContext): boolean {
  if (!context || !context.polarity) return false;
  const resultPolarity = classifyFlavorPolarity(text);
  if (!resultPolarity) return false;
  return resultPolarity !== context.polarity;
}

export function isLowQualityMemoryResearchText(value: string): boolean {
  const text = value.toLowerCase();
  if (!text.trim()) return true;
  if (LOW_QUALITY_RESEARCH_DOMAINS.some((domain) => text.includes(domain))) return true;
  if (COMMERCIAL_RESEARCH_NOISE.test(text)) return true;
  if (SUPPLEMENT_RESEARCH_NOISE.test(text) && !FOOD_CULTURE_SIGNAL.test(text)) return true;
  return false;
}

export function isUsableMemoryResearchResult(result: SearchResultLike, context?: MemoryRelevanceContext): boolean {
  const title = result.title?.trim() ?? '';
  const snippet = result.snippet?.trim() ?? '';
  const link = result.link?.trim() ?? '';
  if (!snippet) return false;
  const combined = [title, snippet, link].filter(Boolean).join(' ');
  if (isLowQualityMemoryResearchText(combined)) return false;
  if (!FOOD_CULTURE_SIGNAL.test(combined)) return false;
  if (contradictsMemoryRelevance(combined, context)) return false;
  return true;
}

export function filterMemoryResearchSearchResults<T extends SearchResultLike>(
  results: T[],
  context?: MemoryRelevanceContext,
): T[] {
  return results.filter((result) => isUsableMemoryResearchResult(result, context));
}

export function filterMemoryResearchFacts(values: string[], context?: MemoryRelevanceContext): string[] {
  return values.filter(
    (value) => !isLowQualityMemoryResearchText(value) && !contradictsMemoryRelevance(value, context),
  );
}
