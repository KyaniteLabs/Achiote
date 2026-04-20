import dishFamiliesData from '../data/dish-families.json' with { type: 'json' };
import type {
  CollectedFoodMemory,
  Confidence,
  DishHypothesis,
  DishResearchPlan,
  FamilyFollowupQuestions,
  FoodMemoryInput,
  ReconstructionDossier,
  MinimumViableNostalgiaInput,
  MinimumViableNostalgiaCue,
  CueComponent,
} from './types.js';

const RESEARCH_STOPWORDS = new Set([
  // English
  'my', 'mom', 'grandma', 'grandmother', 'auntie', 'friend',
  'said', 'sounded', 'mentioned', 'called', 'something', 'like',
  'with', 'from', 'and', 'the', 'that', 'a', 'of', 'in', 'it',
  // Spanish
  'de', 'la', 'el', 'en', 'con', 'del', 'por', 'para', 'que', 'un', 'una',
  // French
  'du', 'le', 'les', 'des', 'au', 'aux', 'et', 'une',
  // Portuguese
  'da', 'do', 'das', 'dos', 'na', 'no', 'em',
  // Common across languages
  'di', 'il', 'al', 'der', 'die', 'das', 'den', 'dem',
]);

const INGREDIENT_HINTS = [
  'plantains',
  'pork',
  'dill',
  'lamb',
  'shark',
  'fish',
  'seafood',
  'melon seeds',
  'bitter greens',
  'greens',
  'banana leaves',
  'masa',
  'sofrito',
  'rice',
  'beans',
  'yuca',
  'cassava',
  'cheese',
  'coconut',
];

const COOKING_METHOD_HINTS = [
  'fried',
  'grilled',
  'roasted',
  'baked',
  'boiled',
  'steamed',
  'stewed',
  'curry/curried',
  'sandwich',
  'bread',
  'broth',
  'soup',
  'wrapped',
  'layered',
];

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function includesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => {
    const escaped = escapeRegExp(needle).replace(/\s+/g, '\\s+');
    return new RegExp(`(?:^|\\b)${escaped}(?:$|\\b)`, 'i').test(text);
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesWordOrPhrase(text: string, hint: string): boolean {
  const pattern = escapeRegExp(hint).replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|\\b)${pattern}(?:$|\\b)`, 'i').test(text);
}

function likelyDishPhrases(text: string): string[] {
  const lower = text.toLowerCase();
  const patterns = [
    /(?:mentioned|called|named)\s+([\p{L}\p{M}-]+(?:\s+[\p{L}\p{M}-]+){0,2})/giu,
    /(?:sounded like|something like)\s+([\p{L}\p{M}-]+(?:\s+[\p{L}\p{M}-]+){0,2})/giu,
  ];
  const phrases = patterns.flatMap((pattern) => [...lower.matchAll(pattern)].map((match) => match[1].trim()));

  return phrases
    .map((phrase) =>
      phrase
        .split(/\s+/)
        .filter((word) => !RESEARCH_STOPWORDS.has(word))
        .join(' ')
        .trim(),
    )
    .filter((phrase) => phrase.length > 2);
}

function extractPossibleNames(text: string): string[] {
  const quoted = [...text.matchAll(/[“\"]([^”\"]+)[”\"]/g)].map((match) => match[1]);
  const phoneticFragments = [...text.matchAll(/\b[\p{L}\p{M}]+(?:-[\p{L}\p{M}]+){1,}\b/gu)].map((match) => match[0]);
  return unique([...quoted, ...likelyDishPhrases(text), ...phoneticFragments]);
}

function extractCookingMethodHints(text: string): string[] {
  return COOKING_METHOD_HINTS.filter((hint) => (
    hint === 'curry/curried' ? /\bcurr(?:y|ied)\b/.test(text) : matchesWordOrPhrase(text, hint)
  ));
}

function buildMissingInformation(input: {
  possibleNames: string[];
  culturalOrRegionalHints: string[];
  rememberedIngredients: string[];
  cookingMethodHints: string[];
  sensoryClues: string[];
  occasions: string[];
}): string[] {
  return unique([
    input.possibleNames.length === 0 ? 'dish name or local nickname' : '',
    input.culturalOrRegionalHints.length === 0 ? 'country, island, region, town, or community' : '',
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
}): string[] {
  const ingredient = input.rememberedIngredients[0];
  const region = input.culturalOrRegionalHints[0];
  const questions: string[] = [];

  if (input.culturalOrRegionalHints.length === 0) {
    questions.push('Where is your family from, or where did you eat this? Even a country, island, city, or "my grandma was from ___" is enough.');
  }

  if (input.possibleNames.length === 0) {
    questions.push(region
      ? `Do you remember what people in ${region} called it, even roughly or phonetically?`
      : 'Do you remember anything about the name, even a rough sound-alike?');
  }

  if (ingredient && input.cookingMethodHints.length === 0) {
    questions.push(`How was the ${ingredient} served: fried/crispy, in bread, in broth or curry, grilled, or with a sauce?`);
  } else if (input.cookingMethodHints.length === 0) {
    questions.push('Was it fried/crispy, wrapped, layered, served in broth, eaten with bread/rice, or served with a sauce?');
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
    : 'not yet known';
  const regions = memory.extractedClues.culturalOrRegionalHints.length > 0
    ? memory.extractedClues.culturalOrRegionalHints.join(', ')
    : 'not yet known';
  const ingredients = memory.extractedClues.rememberedIngredients.length > 0
    ? memory.extractedClues.rememberedIngredients.join(', ')
    : 'not yet known';
  const sensory = memory.extractedClues.sensoryClues.length > 0
    ? memory.extractedClues.sensoryClues.join(', ')
    : 'not yet known';

  return [
    'Food memory captured.',
    '',
    `- Possible name: ${names}`,
    `- Region/culture clue: ${regions}`,
    `- Ingredient clue: ${ingredients}`,
    `- Sensory clue: ${sensory}`,
    '',
    'Ask next:',
    ...memory.nextQuestions.map((question, index) => `${index + 1}. ${question}`),
    '',
    memory.reassurance,
  ].join('\n');
}

const REGION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bpuerto\s+ric(?:an|o)\b/i, label: 'Puerto Rican' },
  { pattern: /\bpuerto\s+rico\b/i, label: 'Puerto Rican' },
  { pattern: /\btrinidad(?:\s+(?:and|&)\s+tobago)?\b/i, label: 'Trinidad and Tobago' },
  { pattern: /\bcaribbean\b/i, label: 'Caribbean' },
  { pattern: /\bcentral\s+american?\b/i, label: 'Central American' },
  { pattern: /\bsouth\s+american?\b/i, label: 'South American' },
  { pattern: /\blatin\s+american?\b/i, label: 'Latin American' },
  { pattern: /\bmexican?\b/i, label: 'Mexican' },
  { pattern: /\bm[eé]xico\b/i, label: 'Mexican' },
  { pattern: /\boaxac(?:a|an|e[ñn]o)\b/i, label: 'Oaxacan' },
  { pattern: /\byucat[eé]c?[ao]\b/i, label: 'Yucatecan' },
  { pattern: /\bjalisc(?:o|ense)\b/i, label: 'Jaliscan' },
  { pattern: /\bcolombian?\b/i, label: 'Colombian' },
  { pattern: /\bperuvian?\b/i, label: 'Peruvian' },
  { pattern: /\bbrazil(?:ian)?\b/i, label: 'Brazilian' },
  { pattern: /\bargent(?:in[ae]|o)\b/i, label: 'Argentine' },
  { pattern: /\bcuban?\b/i, label: 'Cuban' },
  { pattern: /\bdominican?\b/i, label: 'Dominican' },
  { pattern: /\bhaitian?\b/i, label: 'Haitian' },
  { pattern: /\bjamaican?\b/i, label: 'Jamaican' },
  { pattern: /\bfilipin?[oa]\b/i, label: 'Filipino' },
  { pattern: /\bvietnam(?:ese)?\b/i, label: 'Vietnamese' },
  { pattern: /\bthai(?:land)?\b/i, label: 'Thai' },
  { pattern: /\bkorean?\b/i, label: 'Korean' },
  { pattern: /\bjapan(?:ese)?\b/i, label: 'Japanese' },
  { pattern: /\bchinese?\b/i, label: 'Chinese' },
  { pattern: /\bszechuan\b|\bsichuan\b/i, label: 'Sichuan' },
  { pattern: /\bcantonese\b/i, label: 'Cantonese' },
  { pattern: /\btaiwan(?:ese)?\b/i, label: 'Taiwanese' },
  { pattern: /\bindian?\b/i, label: 'Indian' },
  { pattern: /\bsouth\s+(?:asian|indian)\b/i, label: 'South Asian' },
  { pattern: /\bpunjabi\b/i, label: 'Punjabi' },
  { pattern: /\bgujarati\b/i, label: 'Gujarati' },
  { pattern: /\bbengali\b/i, label: 'Bengali' },
  { pattern: /\bmalayali\b|\bkeral(?:a|ite)\b/i, label: 'Keralite' },
  { pattern: /\btamil\b/i, label: 'Tamil' },
  { pattern: /\bsri\s+lank(?:an?)?\b/i, label: 'Sri Lankan' },
  { pattern: /\bbengal(?:i)?\b/i, label: 'Bengali' },
  { pattern: /\bpakistan?i?\b/i, label: 'Pakistani' },
  { pattern: /\bbangladeshi?\b/i, label: 'Bangladeshi' },
  { pattern: /\bnepal(?:ese|i)?\b/i, label: 'Nepali' },
  { pattern: /\bsoutheast\s+asian?\b/i, label: 'Southeast Asian' },
  { pattern: /\bindonesian?\b/i, label: 'Indonesian' },
  { pattern: /\bmalaysian?\b/i, label: 'Malaysian' },
  { pattern: /\bsingapor(?:ean|e)\b/i, label: 'Singaporean' },
  { pattern: /\bburmese\b|\bmyanmar\b/i, label: 'Burmese' },
  { pattern: /\bcambodian?\b|\bkhmer\b/i, label: 'Cambodian' },
  { pattern: /\blao(?:tian)?\b/i, label: 'Lao' },
  { pattern: /\blebanese?\b/i, label: 'Lebanese' },
  { pattern: /\bsyrian?\b/i, label: 'Syrian' },
  { pattern: /\bpalestinian?\b/i, label: 'Palestinian' },
  { pattern: /\bjordanian?\b/i, label: 'Jordanian' },
  { pattern: /\biraqi?\b/i, label: 'Iraqi' },
  { pattern: /\biranian?\b|\bpersian\b/i, label: 'Iranian' },
  { pattern: /\bafghan?\b/i, label: 'Afghan' },
  { pattern: /\bturkish?\b/i, label: 'Turkish' },
  { pattern: /\bgreek?\b/i, label: 'Greek' },
  { pattern: /\bitalian?\b/i, label: 'Italian' },
  { pattern: /\bsicilian?\b/i, label: 'Sicilian' },
  { pattern: /\bspanish?\b/i, label: 'Spanish' },
  { pattern: /\bcatalan?\b/i, label: 'Catalan' },
  { pattern: /\bportuguese?\b/i, label: 'Portuguese' },
  { pattern: /\bfrench?\b/i, label: 'French' },
  { pattern: /\bgerman?\b/i, label: 'German' },
  { pattern: /\bpolish?\b/i, label: 'Polish' },
  { pattern: /\brussian?\b/i, label: 'Russian' },
  { pattern: /\bukrainian?\b/i, label: 'Ukrainian' },
  { pattern: /\bromanian?\b/i, label: 'Romanian' },
  { pattern: /\bhungarian?\b/i, label: 'Hungarian' },
  { pattern: /\bgeorgian?\b/i, label: 'Georgian' },
  { pattern: /\barmenian?\b/i, label: 'Armenian' },
  { pattern: /\bazerbaijani?\b/i, label: 'Azerbaijani' },
  { pattern: /\buzbek?\b/i, label: 'Uzbek' },
  { pattern: /\bmoroccan?\b/i, label: 'Moroccan' },
  { pattern: /\btunisian?\b/i, label: 'Tunisian' },
  { pattern: /\bAlgerian?\b/i, label: 'Algerian' },
  { pattern: /\bEgypt(?:ian)?\b/i, label: 'Egyptian' },
  { pattern: /\bethiopian?\b/i, label: 'Ethiopian' },
  { pattern: /\beritrean?\b/i, label: 'Eritrean' },
  { pattern: /\bsomali\b/i, label: 'Somali' },
  { pattern: /\bkenyan?\b/i, label: 'Kenyan' },
  { pattern: /\bnigerian?\b/i, label: 'Nigerian' },
  { pattern: /\bghan(?:aian|a)?\b/i, label: 'Ghanaian' },
  { pattern: /\bsenegalese?\b/i, label: 'Senegalese' },
  { pattern: /\bwest\s+african?\b/i, label: 'West African' },
  { pattern: /\beast\s+african?\b/i, label: 'East African' },
  { pattern: /\bnorth\s+african?\b/i, label: 'North African' },
  { pattern: /\bsouth\s+african?\b/i, label: 'South African' },
  { pattern: /\bmiddle\s+east(?:ern)?\b/i, label: 'Middle Eastern' },
  { pattern: /\bmediterranean\b/i, label: 'Mediterranean' },
  { pattern: /\bbalkan\b/i, label: 'Balkan' },
  { pattern: /\bcaucasus\b/i, label: 'Caucasus' },
  { pattern: /\bcentral\s+asia(?:n)?\b/i, label: 'Central Asian' },
  { pattern: /\bappalachian\b/i, label: 'Appalachian' },
  { pattern: /\bsouthern\b.*\b(?:u\.?s\.?|united\s+states|american)\b/i, label: 'Southern US' },
  { pattern: /\bsoul\s+food\b/i, label: 'Southern US' },
];

const GEOGRAPHIC_CONTEXT_PATTERN_SOURCES = [
  { source: '(?:from|grew\\s+up\\s+in|born\\s+in|family\\s+(?:is\\s+)?from|lived\\s+in|visited|traveled\\s+to|my\\s+(?:mom|dad|grandma|grandpa|grandmother|grandfather|abuela|abuelo|oma|opa|nonna|nonno|baba|yaya|tata|nana|papa)\\s+(?:is|was)\\s+from)\\s+([a-zA-Z\\s]{2,30})', flags: 'gi' },
  { source: '(?<![.!?]\\s)(?:in|at)\\s+([A-Z][a-zA-Z\\s]{1,28})\\s+(?:and|where|when|that|which|who|every|during|after|before)', flags: 'g' },
];

function extractRegionHints(lowerText: string, originalText: string): string[] {
  const hints: string[] = [];

  for (const { pattern, label } of REGION_PATTERNS) {
    if (pattern.test(lowerText)) {
      hints.push(label);
    }
  }

  for (const { source, flags } of GEOGRAPHIC_CONTEXT_PATTERN_SOURCES) {
    const pattern = new RegExp(source, flags);
    const matches = [...originalText.matchAll(pattern)];
    for (const match of matches) {
      const place = match[1]?.trim();
      if (place && place.length > 1 && !/^(the|a|an|my|his|her|our|their|this|that|it|we|they|she|he)\s/i.test(place)) {
        hints.push(place);
      }
    }
  }

  return unique(hints);
}

export function collectFoodMemory(input: FoodMemoryInput): CollectedFoodMemory {
  const normalized = input.memoryText.trim();
  const lower = normalized.toLowerCase();
  const possibleDishNames = extractPossibleNames(normalized);
  const culturalOrRegionalHints = unique([
    input.knownRegion,
    ...extractRegionHints(lower, normalized),
  ].filter((value): value is string => Boolean(value)));
  const rememberedIngredients = INGREDIENT_HINTS.filter((ingredient) => matchesWordOrPhrase(lower, ingredient));
  const cookingMethodHints = extractCookingMethodHints(lower);
  const sensoryClues = unique([
    includesAny(lower, ['sour', 'tangy', 'tart']) ? 'sour/tangy' : '',
    includesAny(lower, ['sweet', 'sugary', 'syrupy']) ? 'sweet' : '',
    includesAny(lower, ['spicy', 'hot', 'pepper', 'chile', 'chili', 'piquant']) ? 'spicy/peppery' : '',
    includesAny(lower, ['crispy', 'crunchy', 'fried', 'crackling', 'crust']) ? 'crispy/fried texture' : '',
    includesAny(lower, ['soft', 'mushy', 'melt', 'melting', 'tender']) ? 'soft texture' : '',
    includesAny(lower, ['chewy', 'stretchy', 'elastic', 'bouncy']) ? 'chewy texture' : '',
    includesAny(lower, ['smell', 'aroma', 'fragrant', 'scent', 'stink']) ? 'remembered aroma' : '',
    includesAny(lower, ['sauce', 'gravy', 'broth', 'juice', 'wet']) ? 'sauce/gravy' : '',
    includesAny(lower, ['bitter', 'burnt', 'toasted', 'charred', 'roasted']) ? 'bitter/roasted' : '',
    includesAny(lower, ['rich', 'creamy', 'buttery', 'heavy', 'fatty', 'greasy']) ? 'rich/creamy' : '',
    includesAny(lower, ['smoky', 'smoke', 'wood-fired']) ? 'smoky' : '',
    includesAny(lower, ['fermented', 'funk', 'pungent', 'stinky', 'aged']) ? 'fermented/pungent' : '',
    includesAny(lower, ['umami', 'savory', 'meaty', 'mushroom']) ? 'umami/savory' : '',
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
  });

  return {
    rawMemory: input.memoryText,
    normalizedMemory: normalized,
    userLocation: input.userLocation,
    extractedClues: {
      possibleDishNames,
      culturalOrRegionalHints,
      rememberedIngredients,
      sensoryClues,
      occasions,
    },
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
  };
}

const REGION_TO_FAMILY_MAP: Record<string, string[]> = {
  'Puerto Rican': ['Caribbean', 'Latin America'],
  'Trinidad and Tobago': ['Caribbean'],
  'Caribbean': ['Caribbean'],
  'Cuban': ['Caribbean', 'Latin America'],
  'Dominican': ['Caribbean', 'Latin America'],
  'Haitian': ['Caribbean'],
  'Jamaican': ['Caribbean'],
  'Mexican': ['Latin America'],
  'Colombian': ['Latin America'],
  'Peruvian': ['Latin America'],
  'Brazilian': ['Latin America'],
  'Argentine': ['Latin America'],
  'Central American': ['Latin America'],
  'South American': ['Latin America'],
  'Latin American': ['Latin America'],
  'Indian': ['South Asia'],
  'Pakistani': ['South Asia'],
  'Bangladeshi': ['South Asia'],
  'Sri Lankan': ['South Asia'],
  'Nepali': ['South Asia'],
  'Punjabi': ['South Asia'],
  'Gujarati': ['South Asia'],
  'Bengali': ['South Asia'],
  'Tamil': ['South Asia'],
  'Keralite': ['South Asia'],
  'Chinese': ['East Asia'],
  'Japanese': ['East Asia'],
  'Korean': ['East Asia'],
  'Taiwanese': ['East Asia'],
  'Cantonese': ['East Asia'],
  'Sichuan': ['East Asia'],
  'Thai': ['Southeast Asia'],
  'Vietnamese': ['Southeast Asia'],
  'Filipino': ['Southeast Asia'],
  'Indonesian': ['Southeast Asia'],
  'Malaysian': ['Southeast Asia'],
  'Singaporean': ['Southeast Asia'],
  'Burmese': ['Southeast Asia'],
  'Cambodian': ['Southeast Asia'],
  'Lao': ['Southeast Asia'],
  'Lebanese': ['Middle East'],
  'Syrian': ['Middle East'],
  'Palestinian': ['Middle East'],
  'Jordanian': ['Middle East'],
  'Iraqi': ['Middle East'],
  'Iranian': ['Middle East'],
  'Afghan': ['Middle East'],
  'Turkish': ['Mediterranean', 'Middle East'],
  'Greek': ['Mediterranean'],
  'Italian': ['Mediterranean'],
  'Spanish': ['Mediterranean'],
  'Portuguese': ['Mediterranean'],
  'French': ['Mediterranean'],
  'Moroccan': ['North Africa', 'Mediterranean'],
  'Tunisian': ['North Africa'],
  'Algerian': ['North Africa'],
  'Egyptian': ['North Africa'],
  'Ethiopian': ['East Africa'],
  'Eritrean': ['East Africa'],
  'Nigerian': ['West Africa'],
  'Ghanaian': ['West Africa'],
  'Senegalese': ['West Africa'],
  'Polish': ['Eastern Europe'],
  'Russian': ['Eastern Europe'],
  'Ukrainian': ['Eastern Europe'],
  'Hungarian': ['Eastern Europe'],
  'Romanian': ['Eastern Europe'],
  'Southern US': ['Southern US'],
  'Appalachian': ['Southern US'],
  'Mediterranean': ['Mediterranean'],
  'Middle Eastern': ['Middle East'],
  'Balkan': ['Balkans'],
  'West African': ['West Africa'],
  'East African': ['East Africa'],
  'North African': ['North Africa'],
  'South African': ['South Africa'],
  'Oaxacan': ['Latin America'],
  'Yucatecan': ['Latin America'],
  'Jaliscan': ['Latin America'],
  'Sicilian': ['Mediterranean'],
  'Catalan': ['Mediterranean'],
  'German': ['Central Europe'],
  'Georgian': ['Caucasus'],
  'Armenian': ['Caucasus'],
  'Azerbaijani': ['Caucasus'],
  'Uzbek': ['Central Asia'],
  'Somali': ['East Africa'],
  'Kenyan': ['East Africa'],
  'Southeast Asian': ['Southeast Asia'],
  'South Asian': ['South Asia'],
  'Caucasus': ['Caucasus'],
  'Central Asian': ['Central Asia'],
};

function familyRegionsForDetected(detectedRegions: string[]): string[] {
  return unique(detectedRegions.flatMap((r) => REGION_TO_FAMILY_MAP[r] ?? []));
}

function dataDrivenHypotheses(memory: CollectedFoodMemory): DishHypothesis[] {
  const { possibleDishNames, culturalOrRegionalHints } = memory.extractedClues;
  if (possibleDishNames.length === 0) return [];

  const allHypotheses: DishHypothesis[] = [];

  for (const family of dishFamiliesData.families) {
    const matchedVariants = (family.variants ?? []).filter((variant) => {
      const nameMatch = possibleDishNames.some((name) =>
        variant.aliases.some((alias) => alias.toLowerCase() === name.toLowerCase()),
      ) || variant.aliases.some((alias) =>
        memory.normalizedMemory.toLowerCase().includes(alias.toLowerCase()),
      );
      if (!nameMatch) return false;
      return variant.regions.some((r) => culturalOrRegionalHints.some((hint) => {
        const mapped = REGION_TO_FAMILY_MAP[hint] ?? [];
        return mapped.some((mr) => r === mr) || r === hint;
      }));
    });

    if (matchedVariants.length === 0) continue;

    const allVariants = family.variants ?? [];

    for (const variant of allVariants) {
      const isDirectMatch = matchedVariants.includes(variant);
      const whyPossible: string[] = [];
      if (isDirectMatch) {
        whyPossible.push('phonetic overlap with the remembered fragment');
      } else {
        whyPossible.push('similar dish from the same family');
      }
      if (culturalOrRegionalHints.length > 0) whyPossible.push(`${culturalOrRegionalHints[0]} family context`);
      if (memory.extractedClues.occasions.length > 0) whyPossible.push('often family/holiday associated');

      allHypotheses.push({
        name: variant.name,
        whyPossible,
        whatWouldConfirm: variant.distinguishingElements,
        confidence: isDirectMatch ? 'Medium' : 'Low',
        researchRequired: true,
      });
    }
  }

  return allHypotheses.slice(0, 5);
}

function genericHypotheses(memory: CollectedFoodMemory): DishHypothesis[] {
  const names = memory.extractedClues.possibleDishNames;
  if (names.length > 0) {
    return names.slice(0, 3).map((name) => ({
      name,
      whyPossible: ['user supplied a possible dish name or sound-alike fragment that should be researched before recipe generation'],
      whatWouldConfirm: ['original language spelling', 'region/town', 'ingredients', 'cooking method', 'occasion'],
      confidence: memory.extractedClues.culturalOrRegionalHints.length > 0 ? 'Medium' : 'Low',
      researchRequired: true,
    }));
  }

  if (memory.extractedClues.culturalOrRegionalHints.length > 0 || memory.extractedClues.rememberedIngredients.length > 0) {
    return [
      {
        name: 'unknown regional dish',
        whyPossible: ['user supplied cultural, regional, ingredient, or sensory clues but not enough evidence to resolve safely'],
        whatWouldConfirm: ['original language spelling', 'region/town', 'ingredients', 'cooking method', 'occasion'],
        confidence: 'Low',
        researchRequired: true,
      },
    ];
  }

  return [
    {
      name: 'unknown food memory',
      whyPossible: ['the memory contains sensory or ingredient fragments but no stable dish name yet'],
      whatWouldConfirm: ['region', 'language', 'main ingredient', 'texture', 'serving context'],
      confidence: 'Low',
      researchRequired: true,
    },
  ];
}

export function planDishResearch(memory: CollectedFoodMemory): DishResearchPlan {
  const hypotheses = dataDrivenHypotheses(memory);
  const finalHypotheses = hypotheses.length > 0 ? hypotheses : genericHypotheses(memory);
  const nameQueries = finalHypotheses.flatMap((hypothesis) => [
    `"${hypothesis.name}" traditional dish ingredients technique`,
    `"${hypothesis.name}" regional variations family recipe`,
  ]);
  const fragmentQueries = memory.extractedClues.possibleDishNames.map(
    (fragment) => `"${fragment}" food ${memory.extractedClues.culturalOrRegionalHints.join(' ')}`.trim(),
  );

  return {
    researchRequired: true,
    hypotheses: finalHypotheses,
    searchQueries: unique([...fragmentQueries, ...nameQueries]).slice(0, 8),
    preferredSourceTypes: [
      'family/community recipe sources',
      'bilingual or regional food writing',
      'technique videos showing texture and process',
      'ingredient/source references',
    ],
    factsToVerify: [
      'base ingredient or starch',
      'cooking method',
      'regional names and spelling variants',
      'holiday or family occasion context',
      'sensory cues: aroma, texture, flavor, appearance',
    ],
    questionsForUser: memory.nextQuestions,
  };
}

export function buildReconstructionDossier(input: {
  memory: CollectedFoodMemory;
  researchPlan: DishResearchPlan;
  researchedFacts?: string[];
  inferredFacts?: string[];
}): ReconstructionDossier {
  const researched = input.researchedFacts ?? [];
  const inferred = input.inferredFacts ?? [];
  const dedupedResearched = [...new Set(researched)];
  const confidence: Confidence = dedupedResearched.length >= 2 ? 'Medium' : 'Low';

  return {
    title: 'Food Memory Reconstruction Dossier',
    evidenceLedger: {
      userSaid: [input.memory.rawMemory],
      researched,
      inferred,
      unknown: ['exact dish identity', 'family-specific version', 'must-preserve sensory trigger ranking'],
    },
    hypotheses: input.researchPlan.hypotheses,
    nostalgiaCriticalElements: [
      'aroma tied to cooking method',
      'texture of the base starch/protein',
      'seasoning profile connected to family memory',
    ],
    recreationStrategy: [
      'Do not finalize a recipe until the top hypothesis is confirmed or explicitly marked as a best-effort reconstruction.',
      'Preserve the strongest sensory cues before optimizing for exact ingredient names.',
      'Offer substitutions only with a clear note about what changes and what is preserved.',
      'After the minimum viable nostalgia cue, help the user find ingredients near where they live now using the source_ingredients and find_sensory_substitutes tools.',
    ],
    whatToAskFamily: generateFamilyFollowupQuestions({ memory: input.memory, researchPlan: input.researchPlan }).questions,
    confidence,
  };
}

export function generateFamilyFollowupQuestions(input: {
  memory: CollectedFoodMemory;
  researchPlan: DishResearchPlan;
}): FamilyFollowupQuestions {
  const hypothesisQuestions = input.researchPlan.hypotheses.flatMap((hypothesis) => hypothesis.whatWouldConfirm);
  const questions = unique([
    'Was it wrapped in leaves, baked in layers, fried, or served in broth?',
    'What smell do you remember first when it was cooking?',
    'Was this connected to a holiday, a weekday meal, or a specific person?',
    ...hypothesisQuestions.map((question) => `Do you remember anything like: ${question}?`),
  ]).slice(0, 5);

  return {
    questions,
    toneGuidance: 'Ask gently. No one needs to know the perfect spelling, and family versions may differ from researched versions.',
  };
}


function textSignals(input: MinimumViableNostalgiaInput): string {
  return [
    input.dossier.evidenceLedger.userSaid.join(' '),
    input.dossier.evidenceLedger.researched.join(' '),
    input.dossier.evidenceLedger.inferred.join(' '),
    input.researchFindings?.researchedFacts.join(' ') ?? '',
    input.researchFindings?.inferredFacts.join(' ') ?? '',
    input.dossier.hypotheses.map((hypothesis) => hypothesis.name).join(' '),
  ].join(' ').toLowerCase();
}

type FoodScienceCueProfile = {
  format: MinimumViableNostalgiaCue['format'];
  title: string;
  goal: string;
  effortMinutes: number;
  ingredients: MinimumViableNostalgiaCue['ingredients'];
  steps: string[];
  preserves: string[];
  doesNotPreserve: string[];
  accessibilityPrinciples: string[];
  substituteLogic: string[];
  whyThisIsMinimum: string;
  safetyNotes: string[];
  followUpIfItWorks: string[];
  components: CueComponent[];
};

const COMPONENT_ROLES = {
  starch: {
    keywords: 'rice|potato|potatoes|mash|masa|dough|bread|yuca|cassava|plantain|dumpling|noodle|bean|beans|starch|tortilla|cake',
    criticalElement: 'gelatinized texture and sauce absorption',
    flavorProfile: 'neutral to slightly sweet, soft or chewy mouthfeel',
    localTestWith: 'any grocery-store starch: potato, rice, bread, or flour tortilla',
    substitutionReason: 'Starch gelatinization produces similar texture and sauce-carrying capacity regardless of the specific source',
  },
  protein: {
    keywords: 'meat|sausage|fish|shark|beef|pork|chicken|lamb|cheese|protein|filling|ground',
    criticalElement: 'fat-rendered Maillard crust and spice-carrying fat',
    flavorProfile: 'savory umami, browned fat, salt, and any spice bloom carried in rendered fat',
    localTestWith: 'any accessible protein: ground pork, chicken thigh, or firm tofu pan-seared in oil',
    substitutionReason: 'Proteins that render fat carry Maillard compounds and fat-soluble aromatics the same way regardless of cut or species',
  },
  sauce: {
    keywords: 'sauce|gravy|relish|chutney|salsa|condiment|dip|orange|creamy',
    criticalElement: 'acid-fat-salt balance and aromatic contrast against richness',
    flavorProfile: 'variable — may be tomato-based, dairy-based, oil-herb, or vinegar-forward',
    localTestWith: 'grocery-store salsa, tomato paste with vinegar and sugar, or yogurt with herbs',
    substitutionReason: 'Sauces are balance systems of fat, acid, sugar, salt, and aromatics; matching the balance preserves the contrast even with different base ingredients',
  },
  vegetable: {
    keywords: 'vegetable|pepper|onion|greens|cabbage|lettuce|tomato|carrot|corn',
    criticalElement: 'crunch, sweetness, or char that breaks up richness',
    flavorProfile: 'fresh or cooked sweetness, slight bitterness, or charred smokiness',
    localTestWith: 'any grocery-store vegetable that can be charred, sauteed, or served raw',
    substitutionReason: 'Vegetable nostalgia is usually about texture contrast and char sweetness, not the specific variety',
  },
  broth: {
    keywords: 'soup|stew|broth|stock|porridge|consomme',
    criticalElement: 'volatile aroma release in a warm liquid carrier',
    flavorProfile: 'layered body from dissolved proteins, salt, fat, and long-cooked aromatics',
    localTestWith: 'any warm broth or stock with a pinch of the remembered spice',
    substitutionReason: 'Warm liquid releases volatile aromatics the same way regardless of the stock base; the nostalgia is in the aroma chemistry',
  },
} as const;

type ComponentRole = keyof typeof COMPONENT_ROLES;

const ROLE_ORDER: ComponentRole[] = ['starch', 'protein', 'sauce', 'vegetable', 'broth'];

function sanitizeLocation(raw?: string): string {
  if (!raw) return 'at any grocery store';
  const trimmed = raw.trim();
  if (trimmed.length <= 80) return `near ${trimmed}`;
  const truncated = trimmed.slice(0, 80);
  const lastSep = Math.max(truncated.lastIndexOf(','), truncated.lastIndexOf(' '));
  return `near ${truncated.slice(0, lastSep > 0 ? lastSep : 80)}`;
}

function decomposeIntoComponents(signals: string, userLocation?: string, overallConfidence?: Confidence): CueComponent[] {
  const locationPhrase = sanitizeLocation(userLocation);
  const components: CueComponent[] = [];

  for (const role of ROLE_ORDER) {
    const def = COMPONENT_ROLES[role];
    if (!hasAnySignal(signals, [wordSignal(def.keywords)])) continue;

    components.push({
      role,
      criticalElement: def.criticalElement,
      flavorProfile: def.flavorProfile,
      localTestWith: `${def.localTestWith} ${locationPhrase}`,
      substitutionReason: def.substitutionReason,
      confidence: overallConfidence ?? 'Low',
    });
  }

  if (components.length === 0) {
    components.push({
      role: 'overall',
      criticalElement: 'the dominant sensory mechanism — aroma, texture, sauce, fat, acid, or contrast',
      flavorProfile: 'unknown until one variable is isolated and tested',
      localTestWith: `one safe pantry ingredient ${locationPhrase}`,
      substitutionReason: 'Without a known mechanism, any substitution is guesswork; isolate one sensory variable first',
      confidence: 'Low',
    });
  }

  return components;
}

function hasAnySignal(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function wordSignal(words: string): RegExp {
  const escaped = words.split('|').map(w => escapeRegExp(w)).join('|');
  return new RegExp(`\\b(${escaped})\\b`, 'i');
}

function foodScienceCueProfile(signals: string, userLocation?: string, overallConfidence?: Confidence): FoodScienceCueProfile {
  const hasProteinOrFat = hasAnySignal(signals, [wordSignal('meat|sausage|fish|shark|beef|pork|chicken|lamb|cheese|fat|butter|oil|fried')]);
  const hasStarchOrBase = hasAnySignal(signals, [wordSignal('starch|rice|potato|potatoes|mash|masa|dough|bread|yuca|cassava|plantain|dumpling|noodle|bean|beans')]);
  const hasSauceOrCondiment = hasAnySignal(signals, [wordSignal('sauce|gravy|relish|chutney|salsa|condiment|dip|orange|creamy')]);
  const hasLiquid = hasAnySignal(signals, [wordSignal('soup|stew|broth|sip|drink|porridge')]);
  const hasAroma = hasAnySignal(signals, [wordSignal('aroma|smell|spice|spiced|seasoned|garlic|onion|herb|pepper|cumin|coriander|clove|nutmeg|cinnamon')]);
  const hasTextureContrast = hasAnySignal(signals, [wordSignal('crispy|crunchy|chewy|creamy|soft|tender|stretchy|crisp|fried|grilled|charred|brown|golden')]);
  const hasAcidOrSweet = hasAnySignal(signals, [wordSignal('sour|tangy|acid|vinegar|citrus|lime|lemon|fermented|sweet|syrup|molasses|sugar')]);

  if (hasLiquid) {
    return {
      title: 'Minimum viable aroma-sip cue',
      goal: 'Test the memory through a one-cup liquid carrier that can isolate aroma, salt, fat, acid, and body before making a full pot.',
      effortMinutes: 12,
      format: 'sip',
      ingredients: [
        { item: 'water, broth, milk, or another cheap neutral liquid carrier', amount: '1 cup', purpose: 'volatile aroma and taste carrier' },
        { item: 'small amount of the researched dominant aromatic or spice family', amount: 'pinch to 1 teaspoon', purpose: 'primary smell/taste trigger' },
        { item: 'tiny fat source such as oil, butter, rendered fat, or coconut milk if relevant', amount: '1/4 to 1 teaspoon', purpose: 'carries fat-soluble aroma compounds', optional: true },
        { item: 'acid/sweet/salt adjustment from pantry ingredients', amount: 'drops or pinches', purpose: 'balance sourness, sweetness, salinity, and brightness', optional: true },
      ],
      steps: [
        'Warm the liquid carrier gently; do not build a full dish.',
        'Bloom the aromatic or spice cue briefly so volatile compounds reach the nose.',
        'Add fat only if the memory needs richness or lingering aroma; fat carries many aroma compounds.',
        'Adjust acid, sweetness, and salt one drop or pinch at a time, then sip once and stop.',
        'Record whether aroma, body, acidity, or seasoning carried the memory before escalating.',
      ],
      preserves: ['volatile aroma release', 'salt/acid/fat balance', 'warm sip ritual', 'body direction'],
      doesNotPreserve: ['long-cooked body', 'complete ingredient list', 'full texture', 'regional specificity'],
      accessibilityPrinciples: ['test in one cup', 'use pantry acid/salt/fat first', 'use the cheapest safe liquid carrier', 'avoid buying rare ingredients until the balance is directionally right'],
      substituteLogic: [
        'A liquid cue can test whether aroma, fat, acid, salt, and body are the real memory carriers.',
        'Fat-soluble aromas need a little fat; water alone may taste flat even if the spice is correct.',
        'Acid and salt change perception quickly, so they should be adjusted in drops/pinches rather than full-recipe amounts.',
      ],
      whyThisIsMinimum: 'A one-cup sip tests the chemistry of aroma release, body, acid, salt, and fat before wasting ingredients on a full pot.',
      safetyNotes: ['Use only known edible ingredients.', 'Keep tasting amounts small while adjusting salt, acid, or heat.'],
      followUpIfItWorks: ['Ask what gave the liquid body.', 'Ask whether the brightness came from citrus, vinegar, dairy, fermentation, or tomato.', 'Ask what texture or garnish is missing.', 'Use source_ingredients to help find key items near the user.'],
      components: decomposeIntoComponents(signals, userLocation, overallConfidence),
    };
  }

  if (hasProteinOrFat || hasStarchOrBase || hasTextureContrast) {
    return {
      title: 'Minimum viable composed-bite cue',
      goal: 'Test a tiny composed bite that isolates carrier, aroma/fat, texture, and balance without requiring exact specialty ingredients.',
      effortMinutes: 15,
      format: 'bite',
      ingredients: [
        { item: 'cheap grocery-store carrier matching the remembered base: starch, bread, potato, rice, bean, noodle, or cooked vegetable', amount: '1-2 bites', purpose: 'texture and sauce carrier' },
        { item: 'small amount of accessible protein, fat, dairy, mushroom, bean, or plant-based substitute if relevant', amount: '1-2 tablespoons', purpose: 'fat/protein/umami carrier' },
        { item: 'researched aromatic or spice direction using pantry spices/aromatics', amount: 'pinch to 1 teaspoon', purpose: 'volatile memory trigger', optional: true },
        { item: 'acid/sweet/salt/fat adjustment', amount: 'drops or pinches', purpose: 'balance and mouthfeel control', optional: true },
      ],
      steps: [
        'Prepare only the carrier and one small aroma/fat/protein element.',
        'Use browning, toasting, frying, warming, or chilling only if that process is part of the remembered texture/aroma.',
        'Add the researched spice/aromatic direction to the fat or protein so aroma compounds bloom.',
        'Taste one composed bite and ask which mechanism hits: aroma, Maillard browning, fat richness, starch texture, acid/sweet balance, or contrast.',
      ],
      preserves: ['carrier texture', 'fat/aroma delivery', 'one-bite ritual', 'core balance signal'],
      doesNotPreserve: ['exact specialty ingredient', 'full plating', 'full recipe process', 'family-specific proportions'],
      accessibilityPrinciples: ['use grocery-store carriers and proteins first', 'test in one or two bites', 'use pantry aromatics before specialty sourcing', 'buy exact items only after the mechanism works'],
      substituteLogic: [
        'Proteins and fats are carriers for Maillard notes and fat-soluble aromatics; a cheap carrier can test the same chemistry before sourcing the exact item.',
        'Starches and breads mainly control texture and sauce absorption, so a common starch can test whether the mouthfeel is central.',
        'Acid, sugar, and salt can move a bite toward the remembered balance without changing the whole dish.',
      ],
      whyThisIsMinimum: 'A composed bite tests the reusable food-science mechanisms—aroma, fat, browning, starch texture, and balance—before committing to specialty shopping or a full recipe.',
      safetyNotes: ['Cook proteins safely.', 'Avoid allergens and unknown ingredients.', 'Use high heat carefully if crisping or browning.'],
      followUpIfItWorks: ['Ask which part hit first: smell, texture, sauce, fat, spice, or sweetness/acidity.', 'Ask what still feels missing.', 'Use find_sensory_substitutes and source_ingredients to help the user find items near where they live now.'],
      components: decomposeIntoComponents(signals, userLocation, overallConfidence),
    };
  }

  if (hasSauceOrCondiment) {
    return {
      title: 'Minimum viable sauce-and-carrier cue',
      goal: 'Test whether the sauce/condiment contrast is carrying the memory using a tiny pantry sauce and a neutral carrier.',
      effortMinutes: 10,
      format: 'condiment',
      ingredients: [
        { item: 'neutral carrier such as bread, rice, potato, cracker, tortilla, or cooked starch', amount: '1-2 bites', purpose: 'bland base for judging sauce and texture' },
        { item: 'pantry sauce base matching the researched direction: tomato, dairy, oil, vinegar, fruit, chile, or stock', amount: '1 tablespoon', purpose: 'cheap proxy for the sauce family' },
        { item: 'aromatic/spice cue from researched facts', amount: 'pinch', purpose: 'volatile aroma trigger', optional: true },
        { item: 'acid, sugar, salt, or fat adjustment', amount: 'drops or pinches', purpose: 'balance and mouthfeel tuning', optional: true },
      ],
      steps: [
        'Make only one tablespoon of sauce proxy, not a batch.',
        'Tune it by food-science dimensions: fat for body, acid for brightness, sugar for roundness, salt for intensity, spice/aromatics for memory.',
        'Taste it on the neutral carrier so texture and sauce can be judged together.',
        'Change one variable at a time and note what suddenly feels familiar or wrong.',
      ],
      preserves: ['sauce contrast', 'carrier-plus-condiment ritual', 'fat/acid/sweet/salt balance', 'aroma impact'],
      doesNotPreserve: ['exact brand or restaurant sauce', 'complete dish structure', 'full garnish set'],
      accessibilityPrinciples: ['start from pantry sauce bases', 'test one tablespoon', 'use a neutral grocery-store carrier', 'adjust balance before sourcing specialty condiments'],
      substituteLogic: [
        'Sauces are often families of fat, water, acid, sugar, salt, heat, and aromatics; matching that balance can matter more than matching the name.',
        'A bland carrier exposes whether the sauce is the memory trigger or merely background.',
        'One-variable adjustments prevent a generic sauce from becoming a confused full recipe.',
      ],
      whyThisIsMinimum: 'A tablespoon of sauce on a neutral carrier tests the contrast and balance that often carries the nostalgic bite.',
      safetyNotes: ['Check condiment allergens and chile heat.', 'Do not mix unknown fermented or wild ingredients.'],
      followUpIfItWorks: ['Ask whether the sauce was smooth or chunky.', 'Ask whether it leaned fatty, acidic, sweet, spicy, or savory.', 'Ask what carrier it was served on.', 'Use source_ingredients to help the user find sauce components near where they live.'],
      components: decomposeIntoComponents(signals, userLocation, overallConfidence),
    };
  }

  if (hasAroma || hasAcidOrSweet) {
    return {
      title: 'Minimum viable aroma-balance cue',
      goal: 'Test the likely memory through smell and taste balance before picking a full dish format.',
      effortMinutes: 8,
      format: 'aroma-cue',
      ingredients: [
        { item: 'safe pantry aromatic, spice, herb, fat, acid, or sweetener matching the researched clue', amount: 'pinch, drop, or tiny piece', purpose: 'single sensory variable' },
        { item: 'neutral carrier such as oil, water, bread, rice, or potato', amount: 'small amount', purpose: 'makes the cue smellable or tasteable', optional: true },
      ],
      steps: [
        'Warm, dilute, or taste only the single strongest sensory clue.',
        'Smell first, then taste a tiny amount on a neutral carrier if safe.',
        'Do not add a second variable until the first one is judged familiar or wrong.',
      ],
      preserves: ['single aroma or balance cue', 'low-cost sensory testing', 'user reaction as evidence'],
      doesNotPreserve: ['dish identity', 'full texture', 'complete recipe'],
      accessibilityPrinciples: ['test one pantry variable', 'spend almost nothing', 'avoid specialty shopping until a cue works'],
      substituteLogic: [
        'When identity is uncertain, isolating one aroma or balance dimension gives cleaner evidence than cooking a full dish.',
        'Neutral carriers prevent strong ingredients from being mistaken for complete recipes.',
      ],
      whyThisIsMinimum: 'One sensory variable is the cheapest way to learn whether the reconstruction is moving toward or away from the memory.',
      safetyNotes: ['Use only safe edible ingredients.', 'Do not taste unidentified wild plants or unknown powders.'],
      followUpIfItWorks: ['Ask what dish format carried that aroma or balance.', 'Ask what texture or sauce belonged with it.', 'Use find_sensory_substitutes to find accessible alternatives near the user.'],
      components: decomposeIntoComponents(signals, userLocation, overallConfidence),
    };
  }

  return {
    title: 'Minimum viable memory-probe cue',
    goal: 'Gather one more sensory datapoint before pretending to reconstruct a dish.',
    effortMinutes: 5,
    format: 'ritual',
    ingredients: [
      { item: 'no specialty ingredient yet', amount: 'none', purpose: 'avoid false certainty and wasted shopping' },
      { item: 'one safe remembered ingredient only if the user already has it', amount: 'tiny amount', purpose: 'optional sensory probe', optional: true },
    ],
    steps: [
      'Ask the user for one concrete sensory detail: smell, texture, sauce, temperature, spice/heat, acid/sweetness, or serving format.',
      'If they have a safe remembered ingredient already, smell or taste a tiny amount on a neutral carrier.',
      'Use that reaction to choose a bite, sip, sauce, or aroma cue next.',
    ],
    preserves: ['uncertainty', 'user memory as evidence', 'low-cost next step'],
    doesNotPreserve: ['dish identity', 'recipe structure', 'source specificity'],
    accessibilityPrinciples: ['buy nothing yet', 'ask for the highest-value missing sensory detail', 'only test safe ingredients already available'],
    substituteLogic: [
      'Without a sensory mechanism, any ingredient purchase is guesswork.',
      'The next useful proxy depends on whether the memory is carried by aroma, texture, sauce, fat, acid, sweetness, or ritual.',
    ],
    whyThisIsMinimum: 'The cheapest correct move is not a recipe; it is one more sensory clue that determines what kind of cue to test.',
    safetyNotes: ['Do not taste unknown ingredients.', 'Avoid allergens.'],
    followUpIfItWorks: ['Use the new sensory clue to build a focused bite, sip, sauce, or aroma cue.', 'Once a cue works, use source_ingredients to help the user find items near where they live.'],
    components: decomposeIntoComponents(signals, userLocation, overallConfidence),
  };
}

export function generateMinimumViableNostalgiaCue(input: MinimumViableNostalgiaInput): MinimumViableNostalgiaCue {
  const signals = textSignals(input);
  const effort = input.maxEffortMinutes;
  const maxEffort = Number.isFinite(effort) ? Math.max(1, effort!) : 20;
  const confidence = input.researchFindings?.confidence ?? input.dossier.confidence;
  const profile = foodScienceCueProfile(signals, input.userLocation, confidence);

  return {
    ...profile,
    effortMinutes: Math.min(maxEffort, profile.effortMinutes),
    confidence: profile.title === 'Minimum viable memory-probe cue' ? 'Low' : confidence,
  };
}
