import memoryHintsData from '../data/memory-hints.json' with { type: 'json' };
import type {
  CollectedFoodMemory,
  FoodMemoryInput,
  FoodMemoryModelExtractor,
  InferredContextClue,
  InferredMemoryContext,
  ModelFoodMemoryExtraction,
} from './types.js';
import { foodMemoryModelExtractionSchema } from '../schemas/food-memory-extraction.js';
import { unique, includesAny, escapeRegExp, matchesWordOrPhrase } from './food-memory-text.js';

const RESEARCH_STOPWORDS = new Set([
  // English
  'my', 'mom', 'grandma', 'grandmother', 'auntie', 'friend',
  'said', 'sounded', 'mentioned', 'called', 'something', 'like',
  'thing', 'with', 'from', 'and', 'or', 'the', 'that', 'a', 'of', 'in', 'it',
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
  'chilled', 'cold', 'hot', 'warm',
  // Spanish
  'de', 'la', 'el', 'en', 'con', 'del', 'por', 'para', 'que', 'un', 'una',
  // French
  'du', 'le', 'les', 'des', 'au', 'aux', 'et', 'une',
  // Portuguese
  'da', 'do', 'das', 'dos', 'na', 'no', 'em',
  // Common across languages
  'di', 'il', 'al', 'der', 'die', 'das', 'den', 'dem',
]);

type CookingMethodHint = { label: string; regexSource?: string; flags?: string };
type MemoryHintsData = {
  ingredients: string[];
  cookingMethods: CookingMethodHint[];
  conceptAliases?: Record<string, string[]>;
};

const MEMORY_HINTS = memoryHintsData as MemoryHintsData;
const INGREDIENT_HINTS = MEMORY_HINTS.ingredients;
const COOKING_METHOD_HINTS: CookingMethodHint[] = MEMORY_HINTS.cookingMethods;
export const CONCEPT_ALIASES = MEMORY_HINTS.conceptAliases ?? {};
export const DEFAULT_MODEL_EXTRACTION_TIMEOUT_MS = 8_000;

export function isBroadRegionalHint(hint: string): boolean {
  return /\b(?:latin\s+america|latin\s+american|hispanic|spanish-speaking|asia|asian|europe|european|africa|african|west\s+africa|west\s+african|east\s+africa|east\s+african|north\s+africa|north\s+african|southern\s+africa|southern\s+african|central\s+africa|central\s+african|southeast\s+asia|southeast\s+asian|south\s+asia|south\s+asian|east\s+asia|east\s+asian|central\s+asia|central\s+asian|western\s+europe|western\s+european|eastern\s+europe|eastern\s+european|northern\s+europe|northern\s+european|southern\s+europe|southern\s+european|middle\s+east|middle\s+eastern|mediterranean|caribbean|south\s+america|central\s+america|oceania|pacific\s+islands?)\b/i.test(hint);
}

function isNegatedMention(text: string, phrase: string): boolean {
  const pattern = escapeRegExp(phrase).replace(/\s+/g, '\\s+');
  return new RegExp(
    `\\b(?:not|no|without|wasn['’]?t|was\\s+not|isn['’]?t|is\\s+not|aren['’]?t|are\\s+not)\\b[^.:?!;]{0,48}\\b${pattern}\\b`,
    'i',
  ).test(text);
}

function isAllergyConstraintMention(text: string, phrase: string): boolean {
  const pattern = escapeRegExp(phrase).replace(/\s+/g, '\\s+');
  return new RegExp(
    `\\ballerg(?:y|ic|ies)\\b[^.:?!;]{0,96}\\b${pattern}\\b|\\b${pattern}\\b[^.:?!;]{0,48}\\ballerg(?:y|ic|ies)\\b`,
    'i',
  ).test(text);
}

function isAdverseReactionConstraintMention(text: string, phrase: string): boolean {
  const pattern = escapeRegExp(phrase).replace(/\s+/g, '\\s+');
  return new RegExp(
    `\\b${pattern}\\b[^.:?!;]{0,96}\\b(?:make|makes|made|causes?|trigger(?:s|ed)?|gives?|gave)\\s+me\\s+[^.:?!;]{0,80}\\b(?:swell(?:ing)?|swollen|hives?|rash|itch(?:y|ing)?|wheez(?:e|ing)|throat|anaphylaxis)\\b|\\b(?:swell(?:ing)?|swollen|hives?|rash|itch(?:y|ing)?|wheez(?:e|ing)|throat|anaphylaxis)\\b[^.:?!;]{0,96}\\b(?:after|from|when\\s+I\\s+eat)\\b[^.:?!;]{0,48}\\b${pattern}\\b`,
    'i',
  ).test(text);
}

function isExcludedIngredientMention(text: string, phrase: string): boolean {
  return isNegatedMention(text, phrase)
    || isAllergyConstraintMention(text, phrase)
    || isAdverseReactionConstraintMention(text, phrase)
    || (phrase === 'seafood' && /\b(?:shrimp|prawns?|crab|lobster|oysters?|clams?|mussels?|scallops?)\b[^.:?!;]{0,96}\b(?:make|makes|made|causes?|trigger(?:s|ed)?|gives?|gave)\s+me\s+[^.:?!;]{0,80}\b(?:swell(?:ing)?|swollen|hives?|rash|itch(?:y|ing)?|wheez(?:e|ing)|throat|anaphylaxis)\b/i.test(text));
}

function likelyDishPhrases(text: string): string[] {
  const lower = text.toLowerCase();
  const patterns = [
    /(?:mentioned|called|named)\s+([\p{L}\p{M}-]+(?:\s+[\p{L}\p{M}-]+){0,2})/giu,
    /(?:sounded like|something like)\s+([\p{L}\p{M}-]+(?:\s+[\p{L}\p{M}-]+){0,2})/giu,
    /(?:made|ate|had|miss|remember)\s+(?:(?:a|an|some|the)\s+)?([\p{L}\p{M}-]+(?:\s+con\s+[\p{L}\p{M}-]+){1,2})(?=[\s,.;!?]|$)/giu,
    /(?:made|ate|had|miss|remember)\s+(?:(?:a|an|some|the)\s+)?([\p{L}\p{M}-]+)(?=[\s,.;!?]|$)/giu,
  ];
  const phrases = patterns.flatMap((pattern) => [...lower.matchAll(pattern)].map((match) => match[1].trim()));

  return phrases
    .map((phrase) =>
      phrase
        .split(/\s+/)
        .filter((word) => word === 'con' || !RESEARCH_STOPWORDS.has(word))
        .join(' ')
        .trim(),
    )
    .filter((phrase) => phrase.length > 2);
}

function extractPossibleNames(text: string): string[] {
  const quoted = [...text.matchAll(/["“]([^"”]+)["”]/g)].map((match) => match[1]);
  const phoneticFragments = [...text.matchAll(/\b[\p{L}\p{M}]+(?:-[\p{L}\p{M}]+){1,}\b/gu)].map((match) => match[0]);
  return unique([...quoted, ...likelyDishPhrases(text), ...phoneticFragments])
    .filter((name) => !RESEARCH_STOPWORDS.has(name.toLowerCase()))
    .filter((name) => !isNegatedMention(text.toLowerCase(), name));
}

function extractCookingMethodHints(text: string): string[] {
  return COOKING_METHOD_HINTS.filter((hint) => (
    hint.regexSource ? new RegExp(hint.regexSource, hint.flags).test(text) : matchesWordOrPhrase(text, hint.label)
  )).map((hint) => hint.label);
}

function extractWithPhraseIngredients(text: string): string[] {
  return [...text.matchAll(/\bcon\s+([\p{L}\p{M}-]+(?:\s+[\p{L}\p{M}-]+){0,2})/gu)]
    .map((match) => match[1].trim())
    .map((phrase) => phrase.split(/\s+/).filter((word) => !RESEARCH_STOPWORDS.has(word)).join(' ').trim())
    .filter((phrase) => phrase.length > 2 && !isExcludedIngredientMention(text, phrase));
}

function memorySufficiencyScore(input: {
  possibleNames: string[];
  culturalOrRegionalHints: string[];
  rememberedIngredients: string[];
  cookingMethodHints: string[];
  sensoryClues: string[];
  occasions: string[];
}): { sufficient: boolean; score: number; reason: string } {
  let score = 0;
  const specificRegions = input.culturalOrRegionalHints.filter((hint) => !isBroadRegionalHint(hint));
  if (specificRegions.length > 0) score += 2;
  else if (input.culturalOrRegionalHints.length > 0) score += 1;
  if (input.sensoryClues.length >= 3) score += 3;
  else if (input.sensoryClues.length >= 1) score += 1;
  if (input.rememberedIngredients.length > 0) score += 1;
  if (input.cookingMethodHints.length > 0) score += 1;
  if (input.occasions.length > 0) score += 1;
  if (input.possibleNames.length > 0) score += 1;

  // Sufficient if we have region + rich sensory, or region + ingredient + sensory + method/occasion
  const sufficient =
    (specificRegions.length > 0 && input.sensoryClues.length >= 2 && (input.rememberedIngredients.length > 0 || input.cookingMethodHints.length > 0 || input.occasions.length > 0))
    || (specificRegions.length > 0 && input.sensoryClues.length >= 3)
    || score >= 5;

  return {
    sufficient,
    score,
    reason: sufficient
      ? 'User provided enough region, sensory, and contextual detail to form a testable hypothesis.'
      : 'Need more clues to narrow down safely.',
  };
}

function buildMissingInformation(input: {
  possibleNames: string[];
  culturalOrRegionalHints: string[];
  rememberedIngredients: string[];
  cookingMethodHints: string[];
  sensoryClues: string[];
  occasions: string[];
}): string[] {
  const sufficiency = memorySufficiencyScore(input);
  const hasSpecificRegion = input.culturalOrRegionalHints.some((hint) => !isBroadRegionalHint(hint));
  if (sufficiency.sufficient) {
    // Only report missing items that would help confirm, not gather from scratch
    return unique([
      input.possibleNames.length === 0 ? 'food or drink name or local nickname (helpful but not required)' : '',
    ]);
  }
  return unique([
    input.possibleNames.length === 0 ? 'food or drink name or local nickname' : '',
    !hasSpecificRegion ? 'country, island, region, town, or community' : '',
    input.cookingMethodHints.length === 0 ? 'cooking method or serving format' : '',
    input.rememberedIngredients.length === 0 ? 'core ingredients' : '',
    input.sensoryClues.length === 0 ? 'taste, texture, aroma, sauce, or heat level' : '',
    input.occasions.length === 0 ? 'where/when they ate it or who made it' : '',
  ]);
}

function buildNextQuestions(input: {
  possibleNames: string[];
  culturalOrRegionalHints: string[];
  rememberedIngredients: string[];
  cookingMethodHints: string[];
  sensoryClues: string[];
  occasions: string[];
  inferredContext?: InferredMemoryContext;
}): string[] {
  const sufficiency = memorySufficiencyScore(input);
  if (sufficiency.sufficient) {
    // When we have enough detail, only ask high-value confirmation questions
    const questions: string[] = [];
    if (input.possibleNames.length === 0) {
      questions.push('Do you remember anything about the food or drink name, even a rough sound-alike?');
    }
    if (input.occasions.length === 0) {
      questions.push('Was this street food, home cooking, a restaurant dish, or tied to a holiday or person?');
    }
    return unique(questions).slice(0, 2);
  }

  const ingredient = input.rememberedIngredients[0];
  const region = input.culturalOrRegionalHints[0];
  const hasSpecificRegion = input.culturalOrRegionalHints.some((hint) => !isBroadRegionalHint(hint));
  const questions: string[] = [];

  if (!hasSpecificRegion) {
    const inferredFamilyContext = input.inferredContext?.culturalOrRegional.find((clue) =>
      clue.canSeedQuestions && clue.label === 'Spanish-speaking family context',
    );
    questions.push(
      region && isBroadRegionalHint(region)
        ? `Do you know a more specific country, region, town, language, or community inside ${region}?`
        : inferredFamilyContext
          ? 'Where was your abuela from? Even a country, region, island, city, or "I had it in ___" is enough.'
          : 'Where did you eat this, or where was it from? Even a country, region, island, city, or "I had it in ___" is enough.',
    );
  }

  if (input.possibleNames.length === 0) {
    questions.push(region
      ? `Do you remember what people in ${region} called this food or drink, even roughly or phonetically?`
      : 'Do you remember anything about the food or drink name, even a rough sound-alike?');
  }

  if (ingredient && input.cookingMethodHints.length === 0) {
    questions.push(`How was the ${ingredient} served: fried/crispy, in bread, in broth or curry, grilled, or with a sauce?`);
  } else if (input.cookingMethodHints.length === 0) {
    questions.push('Was it fried/crispy, wrapped, layered, served in broth, mixed as a drink, eaten with bread/rice, or served with a sauce?');
  }

  if (input.sensoryClues.length === 0) {
    questions.push('What do you remember first: texture, smell, spice/heat, sourness, sweetness, sauce, or the way it was served?');
  }

  if (input.occasions.length === 0) {
    questions.push('Was this street food, restaurant food, home cooking, a holiday food, or tied to a specific person/place?');
  }

  return unique(questions).slice(0, 3);
}

export function formatCollectedFoodMemory(memory: CollectedFoodMemory): string {
  const names = memory.extractedClues.possibleDishNames.length > 0
    ? memory.extractedClues.possibleDishNames.join(', ')
    : 'still figuring this out';
  const regions = memory.extractedClues.culturalOrRegionalHints.length > 0
    ? memory.extractedClues.culturalOrRegionalHints.join(', ')
    : 'not sure yet, every clue helps';
  const ingredients = memory.extractedClues.rememberedIngredients.length > 0
    ? memory.extractedClues.rememberedIngredients.join(', ')
    : 'nothing specific yet';
  const sensory = memory.extractedClues.sensoryClues.length > 0
    ? memory.extractedClues.sensoryClues.join(', ')
    : 'open to whatever comes to mind';

  return [
    "Here's what I'm picking up from your memory:",
    '',
    `- Dish name: ${names}`,
    `- Region or culture: ${regions}`,
    `- Ingredients you mentioned: ${ingredients}`,
    `- Textures, smells, or flavors: ${sensory}`,
    '',
    memory.nextQuestions.length > 0 ? 'A few questions that might jog something:' : '',
    ...memory.nextQuestions.map((question, index) => `${index + 1}. ${question}`),
    '',
    memory.reassurance,
  ].join('\n');
}

const REGION_PATTERNS: Array<{ pattern: RegExp; label: string }> = memoryHintsData.regionPatterns.map((entry) => ({
  pattern: new RegExp(entry.regexSource, entry.flags),
  label: entry.label,
}));

const GEOGRAPHIC_CONTEXT_PATTERN_SOURCES = [
  { source: '(?:from|grew\\s+up\\s+in|born\\s+in|family\\s+(?:is\\s+)?from|lived\\s+in|visited|traveled\\s+to|my\\s+(?:mom|dad|grandma|grandpa|grandmother|grandfather|abuela|abuelo|oma|opa|nonna|nonno|baba|yaya|tata|nana|papa)\\s+(?:is|was)\\s+from)\\s+([a-zA-Z\\s]{2,30})', flags: 'gi' },
  { source: '(?<![.!?]\\s)(?:in|at)\\s+([A-Z][a-zA-Z\\s]{1,28})\\s+(?:and|where|when|that|which|who|every|during|after|before)', flags: 'g' },
];

function trimGeographicContext(place: string): string {
  return place
    .replace(/\s+(?:made|ate|had|with|called|named|mentioned|sounded|served|cooked|fried|baked|for|during|when|where|that|which|who|every|after|before)\b.*$/i, '')
    .trim();
}

function extractRegionHints(lowerText: string, originalText: string): string[] {
  const hints: string[] = [];

  for (const { pattern, label } of REGION_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(lowerText) && !isNegatedMention(lowerText, label)) {
      hints.push(label);
    }
  }

  if (/\bponce\b/i.test(originalText) && !isNegatedMention(lowerText, 'puerto rico')) {
    hints.push('Puerto Rican');
  }

  for (const { source, flags } of GEOGRAPHIC_CONTEXT_PATTERN_SOURCES) {
    const pattern = new RegExp(source, flags);
    const matches = [...originalText.matchAll(pattern)];
    for (const match of matches) {
      const place = match[1] ? trimGeographicContext(match[1]) : '';
      if (place && place.length > 1 && !/^(the|a|an|my|his|her|our|their|this|that|it|we|they|she|he)\s/i.test(place) && !isNegatedMention(lowerText, place)) {
        hints.push(place);
      }
    }
  }

  return unique(hints);
}

function inferContextFromFamilyWords(lowerText: string): InferredMemoryContext {
  const culturalOrRegional: InferredContextClue[] = [];
  const language: InferredContextClue[] = [];

  if (includesAny(lowerText, ['abuela', 'abuelo'])) {
    culturalOrRegional.push({
      label: 'Spanish-speaking family context',
      basis: 'User used the family word "abuela" or "abuelo".',
      confidence: 'Low',
      evidenceKind: 'model_inferred',
      canSeedQuestions: true,
      canSeedCandidateDishes: false,
    });
    language.push({
      label: 'Spanish language clue',
      basis: 'The family word is Spanish, but it does not identify a country or dish.',
      confidence: 'Low',
      evidenceKind: 'model_inferred',
      canSeedQuestions: true,
      canSeedCandidateDishes: false,
    });
  }

  if (includesAny(lowerText, ['nonna', 'nonno'])) {
    culturalOrRegional.push({
      label: 'Italian-speaking family context',
      basis: 'User used the family word "nonna" or "nonno".',
      confidence: 'Low',
      evidenceKind: 'model_inferred',
      canSeedQuestions: true,
      canSeedCandidateDishes: false,
    });
  }

  return { culturalOrRegional, language };
}

function isLikelyColorUseOfOrange(lowerText: string): boolean {
  return /\b(?:deep|bright|dark|reddish|red|golden|pale)?\s*orange\s+(?:color|colour|soup|stew|sauce|drink|liquid|broth)\b/i.test(lowerText)
    || /\b(?:deep|bright|dark|reddish|red|golden|pale)\s+orange\b/i.test(lowerText);
}

function cleanString(value: string | undefined): string {
  return (value ?? '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/^(?:not|no|without|avoid|ruled\s+out|cannot\s+eat|can't\s+eat)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanArray(values: string[] | undefined): string[] {
  return unique((values ?? []).map(cleanString).filter(Boolean)).slice(0, 12);
}

function normalizedTerm(value: string): string {
  return value.toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, ' ')
    .replace(/\bpotatoes\b/g, 'potato')
    .replace(/\bprawns\b/g, 'prawn')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b(\p{L}{4,})s\b/gu, '$1');
}

function hasSameNormalizedValue(values: string[], candidate: string): boolean {
  const normalizedCandidate = normalizedTerm(candidate);
  return values.some((value) => normalizedTerm(value) === normalizedCandidate);
}

function containsNormalizedTerm(value: string, terms: string[]): boolean {
  const normalizedValue = ` ${normalizedTerm(value)} `;
  return terms.some((term) => {
    const normalized = normalizedTerm(term);
    return normalized.length > 1 && normalizedValue.includes(` ${normalized} `);
  });
}

function isAdviceLikeExtractionValue(value: string): boolean {
  return /\b(?:substitut(?:e|es|ion|ing)|replacement|safe|safely|allergen[-\s]?free|free\s+of|avoid|doctor|professional|medical)\b/i.test(value);
}

function isSafetyBoundedModelValue(lowerText: string, value: string, ruledOut: string[]): boolean {
  if (hasSameNormalizedValue(ruledOut, value) || containsNormalizedTerm(value, ruledOut)) return true;
  const hasReaction = /\b(?:make|makes|made|causes?|trigger(?:s|ed)?|gives?|gave)\s+me\s+[^.!?;]{0,80}\b(?:swell(?:ing)?|swollen|hives?|rash|itch(?:y|ing)?|wheez(?:e|ing)|throat|anaphylaxis)\b|\b(?:swell(?:ing)?|swollen|hives?|rash|itch(?:y|ing)?|wheez(?:e|ing)|throat|anaphylaxis)\b[^.!?;]{0,80}\b(?:after|from|when\s+I\s+eat)\b/i.test(lowerText);
  const mentionsShellfishConcern = /\b(?:shellfish|shrimp|prawns?|crab|lobster|oysters?|clams?|mussels?|scallops?)\b/i.test(lowerText);
  const mentionsFishConcern = /\b(?:fish|seafood)\b/i.test(lowerText);
  if (hasReaction && mentionsShellfishConcern && /\b(?:seafood|shellfish|shrimp|prawns?|crab|lobster|oysters?|clams?|mussels?|scallops?)\b/i.test(value)) return true;
  if (hasReaction && mentionsFishConcern && /\b(?:seafood|fish|anchov(?:y|ies)|sardines?|bonito|tuna|salmon|mackerel|fish\s+sauce)\b/i.test(value)) return true;
  return false;
}

function isDirectAdverseReactionMention(lowerText: string, phrase: string): boolean {
  const pattern = escapeRegExp(phrase).replace(/\s+/g, '\\s+');
  return new RegExp(
    `\\b${pattern}\\b(?:\\s+(?:and|or)\\s+[\\p{L}\\p{M}\\s-]{1,32})?\\s+(?:make|makes|made|causes?|trigger(?:s|ed)?|gives?|gave)\\s+me\\s+[^.:?!;]{0,80}\\b(?:swell(?:ing)?|swollen|hives?|rash|itch(?:y|ing)?|wheez(?:e|ing)|throat|anaphylaxis)\\b`,
    'iu',
  ).test(lowerText);
}

function isModelIngredientExcluded(lowerText: string, ingredient: string, ruledOut: string[]): boolean {
  if (isSafetyBoundedModelValue(lowerText, ingredient, ruledOut)) return true;
  if (isNegatedMention(lowerText, ingredient) || isAllergyConstraintMention(lowerText, ingredient)) return true;
  return isDirectAdverseReactionMention(lowerText, ingredient);
}

function safeModelValues(values: string[], lowerText: string, ruledOut: string[]): string[] {
  return cleanArray(values)
    .filter((value) => !isAdviceLikeExtractionValue(value))
    .filter((value) => !isSafetyBoundedModelValue(lowerText, value, ruledOut));
}

function removeRuledOutValues(values: string[], ruledOut: string[]): string[] {
  return values.filter((value) => !hasSameNormalizedValue(ruledOut, value) && !containsNormalizedTerm(value, ruledOut));
}

function extractionLanguageClue(language: string): InferredContextClue | undefined {
  const label = cleanString(language);
  if (!label) return undefined;
  return {
    label: `${label} language clue`,
    basis: 'Model extraction identified this language or dialect clue in the user memory.',
    confidence: 'Low',
    evidenceKind: 'model_inferred',
    canSeedQuestions: true,
    canSeedCandidateDishes: false,
  };
}

function attachExtractionMetadata(
  memory: CollectedFoodMemory,
  metadata: NonNullable<CollectedFoodMemory['extractionMetadata']>,
): CollectedFoodMemory {
  return {
    ...memory,
    extractedClues: {
      ...memory.extractedClues,
      ruledOutIngredients: metadata.ruledOutIngredients,
      cookingMethods: metadata.cookingMethod,
    },
    extractionMetadata: metadata,
  };
}

function mergeModelExtractionWithRegex(
  input: FoodMemoryInput,
  regexMemory: CollectedFoodMemory,
  model: ModelFoodMemoryExtraction,
  timeoutMs: number,
): CollectedFoodMemory {
  const lower = regexMemory.normalizedMemory.toLowerCase();
  const modelRegion = cleanString(model.originRegion);
  const residenceLocation = cleanString(model.residenceLocation);
  const language = cleanString(model.language || input.knownLanguage);
  const ruledOutIngredients = cleanArray([
    ...(regexMemory.extractedClues.ruledOutIngredients ?? []),
    ...model.ruledOutIngredients,
  ]);
  const modelIngredients = removeRuledOutValues(
    cleanArray(model.ingredients).filter((ingredient) =>
      !isAdviceLikeExtractionValue(ingredient)
      && !isModelIngredientExcluded(lower, ingredient, ruledOutIngredients),
    ),
    ruledOutIngredients,
  );
  const modelDishNames = safeModelValues(model.possibleDishNames, lower, ruledOutIngredients)
    .filter((name) => !RESEARCH_STOPWORDS.has(name.toLowerCase()) && !isNegatedMention(lower, name));
  const cookingMethodHints = cleanArray([
    ...(regexMemory.extractedClues.cookingMethods ?? []),
    ...safeModelValues(model.cookingMethod, lower, ruledOutIngredients),
  ]);
  const languageClue = extractionLanguageClue(language);
  const languageClues = unique([
    ...regexMemory.inferredContext.language.map((clue) => clue.label),
    ...(languageClue ? [languageClue.label] : []),
  ]).map((label) =>
    regexMemory.inferredContext.language.find((clue) => clue.label === label)
    ?? (languageClue?.label === label ? languageClue : undefined)
    ?? {
      label,
      basis: 'Language clue inferred from the user memory.',
      confidence: 'Low' as const,
      evidenceKind: 'model_inferred' as const,
      canSeedQuestions: true,
      canSeedCandidateDishes: false,
    },
  );

  const possibleDishNames = cleanArray([
    ...modelDishNames,
    ...regexMemory.extractedClues.possibleDishNames,
  ]);
  const culturalOrRegionalHints = cleanArray([
    input.knownRegion,
    modelRegion && !isNegatedMention(lower, modelRegion) ? modelRegion : '',
    ...regexMemory.extractedClues.culturalOrRegionalHints,
  ].filter((value): value is string => Boolean(value)));
  const rememberedIngredients = cleanArray([
    ...modelIngredients,
    ...regexMemory.extractedClues.rememberedIngredients,
  ]);
  const sensoryClues = cleanArray([
    ...safeModelValues(model.sensoryCues, lower, ruledOutIngredients),
    ...regexMemory.extractedClues.sensoryClues,
  ]);
  const occasions = cleanArray([
    ...safeModelValues(model.occasion, lower, ruledOutIngredients),
    ...regexMemory.extractedClues.occasions,
  ]);
  const inferredContext: InferredMemoryContext = {
    culturalOrRegional: regexMemory.inferredContext.culturalOrRegional,
    language: languageClues,
  };

  const nextQuestions = buildNextQuestions({
    possibleNames: possibleDishNames,
    culturalOrRegionalHints,
    rememberedIngredients,
    cookingMethodHints,
    sensoryClues,
    occasions,
    inferredContext,
  });

  return {
    ...regexMemory,
    userLocation: input.userLocation ?? (residenceLocation || regexMemory.userLocation),
    extractedClues: {
      possibleDishNames,
      culturalOrRegionalHints,
      rememberedIngredients,
      ruledOutIngredients,
      cookingMethods: cookingMethodHints,
      sensoryClues,
      occasions,
    },
    inferredContext,
    missingInformation: buildMissingInformation({
      possibleNames: possibleDishNames,
      culturalOrRegionalHints,
      rememberedIngredients,
      cookingMethodHints,
      sensoryClues,
      occasions,
    }),
    nextQuestions,
    extractionMetadata: {
      source: 'model',
      ...(modelRegion ? { originRegion: modelRegion } : {}),
      ...(residenceLocation ? { residenceLocation } : {}),
      ruledOutIngredients,
      cookingMethod: cookingMethodHints,
      ...(language ? { language } : {}),
      timeoutMs,
    },
  };
}

async function withModelExtractionTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`model extraction timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function collectFoodMemory(input: FoodMemoryInput): CollectedFoodMemory {
  const normalized = input.memoryText.trim();
  const lower = normalized.toLowerCase();
  const possibleDishNames = extractPossibleNames(normalized);
  const inferredContext = inferContextFromFamilyWords(lower);
  const culturalOrRegionalHints = unique([
    input.knownRegion,
    ...extractRegionHints(lower, normalized),
  ].filter((value): value is string => Boolean(value)));
  const rememberedIngredients = unique([
    ...extractWithPhraseIngredients(lower),
    ...INGREDIENT_HINTS.filter((ingredient) => matchesWordOrPhrase(lower, ingredient) && !isExcludedIngredientMention(lower, ingredient)),
    includesAny(lower, ['acorn jelly', 'acorn']) && !isExcludedIngredientMention(lower, 'acorn') ? 'acorn jelly' : '',
  ]).filter((ingredient) => !(ingredient === 'orange' && isLikelyColorUseOfOrange(lower)));
  const cookingMethodHints = extractCookingMethodHints(lower);
  const sensoryClues = unique([
    includesAny(lower, ['sour', 'tangy', 'tart']) ? 'sour/tangy' : '',
    includesAny(lower, ['sweet', 'sugary', 'syrupy']) ? 'sweet' : '',
    includesAny(lower, ['spicy', 'hot', 'pepper', 'chile', 'chili', 'piquant']) ? 'spicy/peppery' : '',
    includesAny(lower, ['crispy', 'crunchy', 'fried', 'crackling', 'crust']) ? 'crispy/fried texture' : '',
    includesAny(lower, ['soft', 'mushy', 'melt', 'melting', 'tender']) ? 'soft texture' : '',
    includesAny(lower, ['slippery', 'slick', 'gelatinous', 'jelly']) ? 'slippery/gelled texture' : '',
    includesAny(lower, ['chewy', 'stretchy', 'elastic', 'bouncy']) ? 'chewy texture' : '',
    includesAny(lower, ['nutty', 'toasty nut', 'roasted nut']) && !isAllergyConstraintMention(lower, 'nut') ? 'nutty aroma' : '',
    includesAny(lower, ['smell', 'aroma', 'fragrant', 'scent', 'stink']) ? 'remembered aroma' : '',
    includesAny(lower, ['herb', 'herby', 'green', 'grassy', 'dill', 'parsley', 'cilantro', 'sorrel']) ? 'herby/green aroma' : '',
    includesAny(lower, ['sauce', 'gravy', 'broth', 'juice', 'wet']) ? 'sauce/gravy' : '',
    includesAny(lower, ['orange color', 'orange colour', 'deep orange', 'bright orange', 'dark orange', 'reddish orange']) ? 'orange color' : '',
    includesAny(lower, ['bitter', 'burnt', 'toasted', 'charred', 'roasted']) ? 'bitter/roasted' : '',
    includesAny(lower, ['rich', 'creamy', 'buttery', 'heavy', 'fatty', 'greasy', 'oily', 'oil slick', 'red oil']) ? 'rich/oily' : '',
    includesAny(lower, ['smoky', 'smoke', 'wood-fired']) ? 'smoky' : '',
    includesAny(lower, ['fermented', 'funk', 'pungent', 'stinky', 'aged']) ? 'fermented/pungent' : '',
    includesAny(lower, ['umami', 'savory', 'meaty', 'mushroom']) ? 'umami/savory' : '',
    includesAny(lower, ['numb', 'numbing', 'tingling', 'buzzing', 'má', 'ma la', 'mala']) ? 'numbing/tingling (Sichuan peppercorn)' : '',
    includesAny(lower, ['caramel', 'cajeta', 'dulce de leche', 'manjar']) ? 'caramel/dulce de leche' : '',
    includesAny(lower, ['sandy', 'grainy', 'fudge', 'crystalline']) ? 'grainy/crystalline texture' : '',
    includesAny(lower, ['custard', 'pudding', 'flan', 'creme caramel']) ? 'custard/pudding' : '',
    includesAny(lower, ['nougat', 'turrón', 'taffy', 'chewy candy', 'melcocha']) ? 'chewy/nougat candy' : '',
    includesAny(lower, ['cookie', 'biscuit', 'cracker', 'shortbread']) ? 'cookie/biscuit' : '',
    includesAny(lower, ['coconut', 'cocada']) ? 'coconut' : '',
    includesAny(lower, ['chocolate', 'cocoa']) ? 'chocolate' : '',
  ]);
  const occasions = unique([
    includesAny(lower, ['christmas', 'holiday', 'navidad', 'eid', 'diwali', 'ramadan', 'passover', 'thanksgiving', 'lunar new year', 'tet', 'new year']) ? 'holiday/festival' : '',
    includesAny(lower, ['grandma', 'abuela', 'grandmother', 'oma', 'nonna', 'baba', 'yaya', 'tata', 'nana', 'sitti', 'tita', 'amma', 'dadi', 'memo']) ? 'grandmother/family context' : '',
    includesAny(lower, ['mom', 'mother', 'mama', 'mum', 'mami', 'amma', 'mommy', 'mamá', 'mère', 'madre']) ? 'mother/family context' : '',
    includesAny(lower, ['dad', 'father', 'papa', 'baba', 'abuelo', 'grandpa', 'grandfather', 'opa', 'nonno', 'tata', 'baba']) ? 'father/grandfather context' : '',
    includesAny(lower, ['aunt', 'tía', 'tante', 'zia', 'khala', 'chachi', 'mausi', 'antie']) ? 'aunt/family context' : '',
    includesAny(lower, ['street', 'vendor', 'market', 'beach', 'hawker', 'stall', 'cart']) ? 'street/vendor/place context' : '',
    includesAny(lower, ['restaurant', 'cafe', 'diner', 'cafeteria', 'trattoria', 'bistro']) ? 'restaurant context' : '',
    includesAny(lower, ['wedding', 'funeral', 'birthday', 'baptism', 'bar mitzvah', 'celebration', 'party', 'feast']) ? 'celebration/gathering' : '',
    includesAny(lower, ['breakfast', 'morning', 'brunch']) ? 'breakfast context' : '',
    includesAny(lower, ['school', 'lunchbox', 'lunch', 'cafeteria']) ? 'school/lunch context' : '',
    includesAny(lower, ['sunday', 'weekend', 'weeknight', 'weekday']) ? 'weekly routine' : '',
    includesAny(lower, ['summer', 'winter', 'monsoon', 'harvest', 'rainy']) ? 'seasonal context' : '',
  ]);

  const nextQuestions = buildNextQuestions({
    possibleNames: possibleDishNames,
    culturalOrRegionalHints,
    rememberedIngredients,
    cookingMethodHints,
    sensoryClues,
    occasions,
    inferredContext,
  });

  return {
    rawMemory: input.memoryText,
    normalizedMemory: normalized,
    userLocation: input.userLocation,
    extractedClues: {
      possibleDishNames,
      culturalOrRegionalHints,
      rememberedIngredients,
      ruledOutIngredients: [],
      cookingMethods: cookingMethodHints,
      sensoryClues,
      occasions,
    },
    inferredContext,
    missingInformation: buildMissingInformation({
      possibleNames: possibleDishNames,
      culturalOrRegionalHints,
      rememberedIngredients,
      cookingMethodHints,
      sensoryClues,
      occasions,
    }),
    nextQuestions,
    reassurance: "You don't need to spell it correctly or know the original language; sound-alikes and tiny clues are enough to start.",
    extractionMetadata: {
      source: 'regex',
      ruledOutIngredients: [],
      cookingMethod: cookingMethodHints,
    },
  };
}

export async function collectFoodMemoryWithModel(
  input: FoodMemoryInput,
  options: {
    extractor?: FoodMemoryModelExtractor;
    timeoutMs?: number;
  } = {},
): Promise<CollectedFoodMemory> {
  const regexMemory = collectFoodMemory(input);
  if (!options.extractor) return regexMemory;

  const timeoutMs = Math.min(
    Math.max(1, Math.trunc(options.timeoutMs ?? DEFAULT_MODEL_EXTRACTION_TIMEOUT_MS)),
    DEFAULT_MODEL_EXTRACTION_TIMEOUT_MS,
  );

  try {
    const rawExtraction = await withModelExtractionTimeout(options.extractor(input), timeoutMs);
    const parsed = foodMemoryModelExtractionSchema.safeParse(rawExtraction);
    if (!parsed.success) {
      const issueSummary = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`).join('; ');
      throw new Error(`model extraction schema invalid: ${issueSummary}`);
    }
    return mergeModelExtractionWithRegex(input, regexMemory, parsed.data, timeoutMs);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return attachExtractionMetadata(regexMemory, {
      source: 'regex_fallback',
      ruledOutIngredients: regexMemory.extractedClues.ruledOutIngredients ?? [],
      cookingMethod: regexMemory.extractedClues.cookingMethods ?? [],
      timeoutMs,
      fallbackReason: detail.slice(0, 240),
    });
  }
}
