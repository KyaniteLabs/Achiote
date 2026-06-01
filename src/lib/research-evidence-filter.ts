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

export function isLowQualityMemoryResearchText(value: string): boolean {
  const text = value.toLowerCase();
  if (!text.trim()) return true;
  if (LOW_QUALITY_RESEARCH_DOMAINS.some((domain) => text.includes(domain))) return true;
  if (COMMERCIAL_RESEARCH_NOISE.test(text)) return true;
  if (SUPPLEMENT_RESEARCH_NOISE.test(text) && !FOOD_CULTURE_SIGNAL.test(text)) return true;
  return false;
}

export function isUsableMemoryResearchResult(result: SearchResultLike): boolean {
  const title = result.title?.trim() ?? '';
  const snippet = result.snippet?.trim() ?? '';
  const link = result.link?.trim() ?? '';
  if (!snippet) return false;
  const combined = [title, snippet, link].filter(Boolean).join(' ');
  if (isLowQualityMemoryResearchText(combined)) return false;
  return FOOD_CULTURE_SIGNAL.test(combined);
}

export function filterMemoryResearchSearchResults<T extends SearchResultLike>(results: T[]): T[] {
  return results.filter(isUsableMemoryResearchResult);
}

export function filterMemoryResearchFacts(values: string[]): string[] {
  return values.filter((value) => !isLowQualityMemoryResearchText(value));
}
