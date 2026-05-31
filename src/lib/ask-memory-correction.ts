import type { AskHistoryItem } from './ask-provider.js';
import type { CollectedFoodMemory } from './types.js';
import { isBroadRegionalHint } from './food-memory-collector.js';
import { escapeRegExp } from './food-memory-text.js';

export function inferSafetyConstraints(userMessage: string): string[] {
  const constraints: string[] = [];
  const hasAllergyContext = /\ballerg(?:y|ic|ies)\b/i.test(userMessage);
  if (/\bvegan\b|\bplant[-\s]?based\b|\bno animal products?\b/i.test(userMessage)) constraints.push('vegan');
  if (/\bvegetarian\b|\bmeat[-\s]?free\b|\bno meat\b/i.test(userMessage)) constraints.push('vegetarian');
  if (/\bsoy allerg|\ballergic to soy\b|\bno soy\b|\bsoy[-\s]?free\b/i.test(userMessage)) constraints.push('soy allergy');
  if (/\b(?:peanut|peanuts|tree nuts?|nuts?)\s+allerg|\ballergic\s+to\s+(?:peanuts?|tree nuts?|nuts?)\b|\bno nuts?\b|\bnut[-\s]?free\b/i.test(userMessage)
    || (hasAllergyContext && /\b(?:peanuts?|tree nuts?|nuts?)\b/i.test(userMessage))) constraints.push('nut allergy');
  if (/\b(?:egg|eggs)\s+allerg|\ballergic\s+to\s+eggs?\b|\bno eggs?\b|\begg[-\s]?free\b/i.test(userMessage)
    || (hasAllergyContext && /\beggs?\b/i.test(userMessage))) constraints.push('egg allergy');
  if (/\b(?:shellfish|shrimp|prawns?|crab|lobster|oysters?|clams?|mussels?|scallops?)\s+allerg|\ballergic\s+to\s+(?:shellfish|shrimp|prawns?|crab|lobster|oysters?|clams?|mussels?|scallops?)\b|\bno shellfish\b|\bshellfish[-\s]?free\b/i.test(userMessage)
    || (hasAllergyContext && /\b(?:shellfish|shrimp|prawns?|crab|lobster|oysters?|clams?|mussels?|scallops?)\b/i.test(userMessage))) constraints.push('shellfish allergy');
  if (/\b(?:fish|seafood)\s+allerg|\ballergic\s+to\s+(?:fish|seafood)\b|\bno fish\b|\bfish[-\s]?free\b|\bseafood[-\s]?free\b/i.test(userMessage)
    || (hasAllergyContext && /\b(?:fish|seafood)\b/i.test(userMessage))) constraints.push('fish allergy');
  if (/\b(?:sesame|tahini)\s+allerg|\ballergic\s+to\s+(?:sesame|tahini)\b|\bno sesame\b|\bsesame[-\s]?free\b/i.test(userMessage)
    || (hasAllergyContext && /\b(?:sesame|tahini)\b/i.test(userMessage))) constraints.push('sesame allergy');
  if (/\bdairy[-\s]?free\b|\bno dairy\b|\bmilk allerg|\blactose\b/i.test(userMessage)) constraints.push('dairy-free');
  if (/\bgluten[-\s]?free\b|\bno gluten\b|\bceliac\b|\bcoeliac\b/i.test(userMessage)) constraints.push('gluten-free');
  if (/\bhalal\b/i.test(userMessage)) constraints.push('halal');
  if (/\bkosher\b/i.test(userMessage)) constraints.push('kosher');
  if (/\bno pork\b|\bpork[-\s]?free\b/i.test(userMessage)) constraints.push('pork-free');
  return [...new Set(constraints)];
}

export function buildGroundedSearchQuery(collectedMemory: unknown, resolvedDish: unknown): string {
  const memory = collectedMemory as CollectedFoodMemory;
  const clues = memory.extractedClues;
  const resolved = isRecord(resolvedDish) ? resolvedDish : {};
  const canonicalName = typeof resolved.canonicalName === 'string' && !/^unknown$/i.test(resolved.canonicalName)
    ? resolved.canonicalName
    : '';
  const parts = [
    canonicalName,
    ...clues.possibleDishNames,
    ...clues.rememberedIngredients,
    ...clues.sensoryClues,
    ...clues.culturalOrRegionalHints.filter((hint) => !isBroadRegionalHint(hint)),
    memory.normalizedMemory,
  ];
  return sanitizeGroundedSearchQuery([...new Set(parts.map((part) => part.trim()).filter(Boolean))].join(' '));
}

export function sanitizeGroundedSearchQuery(query: string): string {
  return query
    .replace(/\b(?:I\s+remember|I\s+do\s+not\s+know|give\s+me|smallest|first-pass|not\s+a\s+full\s+recipe|memory|memories)\b/gi, ' ')
    .replace(/[^\p{L}\p{M}\p{N}\s'-]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 180);
}

export function isLatestCorrectionMessage(userMessage: string): boolean {
  return /\b(?:correction|actually|wait\s+no|remembered\s+wrong)\b/i.test(userMessage);
}

export function buildCorrectedMemoryText(modelMemoryText: string, userMessage: string, history?: AskHistoryItem[]): string {
  const userHistory = (history ?? [])
    .filter((item) => item.role === 'user')
    .map((item) => item.content)
    .join('\n');
  return sanitizeStaleModelMemoryText([
    userHistory,
    modelMemoryText,
    `Latest correction: ${sanitizeLatestCorrectionMemoryText(userMessage)}`,
  ].filter((entry) => entry.trim().length > 0).join('\n'), userMessage);
}

export function sanitizeLatestCorrectionMemoryText(userMessage: string): string {
  return stripNegatedCorrectionTerms(userMessage)
    .replace(/\b(?:not|no|wasn['’]?t|weren['’]?t|isn['’]?t|aren['’]?t|was\s+not|were\s+not|is\s+not|are\s+not)\s+(?:milky|creamy|cream|thick|warm|hot|sweet)(?:\s+or\s+(?:milky|creamy|cream|thick|warm|hot|sweet))*[;,.]?\s*/gi, '')
    .replace(/\b(was|were|is|are)\s+(?:;|,)\s+/gi, '$1 ')
    .replace(/\b(was|were|is|are)\s+(it|this|that|they)\s+\1\b/gi, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function stripNegatedCorrectionTerms(text: string): string {
  return text
    .replace(/\b(?:not|no)\s+[\p{L}\p{M}\s'-]{1,80}?(?=(?:[;,.!?]|$))/giu, ' ')
    .replace(/\b(?:wasn['’]?t|weren['’]?t|isn['’]?t|aren['’]?t|was\s+not|were\s+not|is\s+not|are\s+not)\s+[\p{L}\p{M}\s'-]{1,80}?(?=(?:[;,.!?]|$))/giu, ' ');
}

export function sanitizeStaleModelMemoryText(modelMemoryText: string, userMessage: string): string {
  let sanitized = stripNegatedCorrectionTerms(modelMemoryText);
  const rejectsPreviousDescription = /\b(?:correction:\s*)?no,?\s+I\s+remembered\s+wrong\b/i.test(userMessage);
  for (const descriptor of ['milky', 'creamy', 'cream', 'milk-forward', 'thick', 'warm', 'hot', 'sweet']) {
    const isContradicted = rejectsPreviousDescription
      || new RegExp(`\\b(?:not|no|wasn['’]?t|was\\s+not|isn['’]?t|is\\s+not)\\s+(?:\\w+\\s+){0,3}${descriptor}\\b`, 'i').test(userMessage);
    if (isContradicted) {
      sanitized = sanitized.replace(new RegExp(`\\b${descriptor}\\b`, 'gi'), '');
    }
  }
  return sanitized.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
