import dishFamiliesData from '../data/dish-families.json' with { type: 'json' };
import memoryHintsData from '../data/memory-hints.json' with { type: 'json' };
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

type CookingMethodHint = { label: string; regexSource?: string; flags?: string };

const INGREDIENT_HINTS = memoryHintsData.ingredients;
const COOKING_METHOD_HINTS: CookingMethodHint[] = memoryHintsData.cookingMethods;

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
    hint.regexSource ? new RegExp(hint.regexSource, hint.flags).test(text) : matchesWordOrPhrase(text, hint.label)
  )).map((hint) => hint.label);
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
  if (input.culturalOrRegionalHints.length > 0) score += 2;
  if (input.sensoryClues.length >= 3) score += 3;
  else if (input.sensoryClues.length >= 1) score += 1;
  if (input.rememberedIngredients.length > 0) score += 1;
  if (input.cookingMethodHints.length > 0) score += 1;
  if (input.occasions.length > 0) score += 1;
  if (input.possibleNames.length > 0) score += 1;

  // Sufficient if we have region + rich sensory, or region + ingredient + sensory + method/occasion
  const sufficient =
    (input.culturalOrRegionalHints.length > 0 && input.sensoryClues.length >= 2 && (input.rememberedIngredients.length > 0 || input.cookingMethodHints.length > 0 || input.occasions.length > 0))
    || (input.culturalOrRegionalHints.length > 0 && input.sensoryClues.length >= 3)
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
  if (sufficiency.sufficient) {
    // Only report missing items that would help confirm, not gather from scratch
    return unique([
      input.possibleNames.length === 0 ? 'dish name or local nickname (helpful but not required)' : '',
    ]);
  }
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
  const sufficiency = memorySufficiencyScore(input);
  if (sufficiency.sufficient) {
    // When we have enough detail, only ask high-value confirmation questions
    const questions: string[] = [];
    if (input.possibleNames.length === 0) {
      questions.push('Do you remember anything about the name, even a rough sound-alike?');
    }
    if (input.occasions.length === 0) {
      questions.push('Was this street food, home cooking, a restaurant dish, or tied to a holiday or person?');
    }
    return unique(questions).slice(0, 2);
  }

  const ingredient = input.rememberedIngredients[0];
  const region = input.culturalOrRegionalHints[0];
  const questions: string[] = [];

  if (input.culturalOrRegionalHints.length === 0) {
    questions.push('Where did you eat this, or where was it from? Even a country, island, city, or "I had it in ___" is enough.');
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

const REGION_PATTERNS: Array<{ pattern: RegExp; label: string }> = memoryHintsData.regionPatterns.map((entry) => ({
  pattern: new RegExp(entry.regexSource, entry.flags),
  label: entry.label,
}));

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

const REGION_TO_FAMILY_MAP: Record<string, string[]> = memoryHintsData.regionFamilyMap;

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

// Ingredient + region + sensory → specific dish inference for when no name was given
const INFERRED_DISH_PATTERNS: Array<{
  regions: string[];
  ingredients: string[];
  sensory: string[];
  dish: string;
  why: string;
  confidence: Confidence;
}> = [
  { regions: ['poland', 'eastern europe', 'europe'], ingredients: ['dill', 'potato'], sensory: ['sour', 'soup'], dish: 'Zupa Ogórkowa', why: 'Polish dill pickle soup with potatoes and fermented brine sourness', confidence: 'Medium' },
  { regions: ['ukraine', 'russia', 'eastern europe', 'europe'], ingredients: ['dill', 'egg'], sensory: ['sour', 'soup'], dish: 'Sorrel Soup (Shchavelya Sup)', why: 'Ukrainian/Russian sour soup with sorrel leaves, egg, and dill', confidence: 'Medium' },
  { regions: ['czech', 'slovakia', 'eastern europe', 'europe'], ingredients: ['dill', 'potato'], sensory: ['sour', 'soup'], dish: 'Kulajda', why: 'Czech sour mushroom-dill soup with potatoes and sour cream', confidence: 'Medium' },
  { regions: ['poland', 'eastern europe', 'europe'], ingredients: ['rye', 'sausage'], sensory: ['sour', 'soup'], dish: 'Żurek', why: 'Polish rye sour soup with sausage and potatoes', confidence: 'Medium' },
  { regions: ['russia', 'ukraine', 'eastern europe', 'europe'], ingredients: ['cabbage'], sensory: ['sour', 'soup'], dish: 'Shchi', why: 'Russian sour cabbage soup', confidence: 'Medium' },
  { regions: ['mexico', 'latin america'], ingredients: ['pork', 'tomatillo'], sensory: ['sour', 'soup'], dish: 'Pozole Verde', why: 'Mexican hominy stew with tomatillo and pork', confidence: 'Medium' },
  { regions: ['mexico', 'latin america'], ingredients: ['tortilla', 'chicken'], sensory: ['soup'], dish: 'Sopa de Tortilla', why: 'Mexican tortilla soup with chile and chicken', confidence: 'Medium' },
  { regions: ['thailand', 'southeast asia'], ingredients: ['lemongrass', 'lime', 'chile'], sensory: ['sour', 'spicy', 'soup'], dish: 'Tom Yum', why: 'Thai hot and sour soup with lemongrass, lime, and chile', confidence: 'High' },
  { regions: ['philippines', 'southeast asia'], ingredients: ['tamarind', 'pork', 'fish'], sensory: ['sour', 'soup'], dish: 'Sinigang', why: 'Filipino sour soup with tamarind and meat or fish', confidence: 'High' },
  { regions: ['vietnam', 'southeast asia'], ingredients: ['tamarind', 'pineapple', 'tomato'], sensory: ['sour', 'soup', 'fish'], dish: 'Canh Chua', why: 'Vietnamese sour fish soup with tamarind and pineapple', confidence: 'High' },
  { regions: ['china', 'east asia'], ingredients: ['vinegar', 'pepper', 'tofu'], sensory: ['sour', 'spicy', 'soup'], dish: 'Hot and Sour Soup (Suan La Tang)', why: 'Chinese soup with vinegar, pepper, and tofu', confidence: 'High' },
  { regions: ['india', 'south asia'], ingredients: ['lentil', 'tamarind'], sensory: ['sour', 'soup'], dish: 'Rasam', why: 'South Indian sour lentil soup with tamarind and spices', confidence: 'Medium' },
  { regions: ['germany', 'central europe', 'europe'], ingredients: ['cabbage', 'sausage'], sensory: ['sour', 'soup'], dish: 'Sauerkrautsuppe', why: 'German sour cabbage soup with sausage', confidence: 'Medium' },
  { regions: ['greece', 'mediterranean', 'europe'], ingredients: ['egg', 'lemon'], sensory: ['sour', 'soup'], dish: 'Avgolemono', why: 'Greek egg-lemon soup with rice or orzo', confidence: 'High' },
  { regions: ['turkey', 'middle east'], ingredients: ['yogurt', 'mint'], sensory: ['sour', 'soup'], dish: 'Yayla Çorbası', why: 'Turkish yogurt soup with mint and rice', confidence: 'Medium' },
  { regions: ['iran', 'middle east'], ingredients: ['pomegranate', 'herb'], sensory: ['sour', 'soup'], dish: 'Ash-e Anar', why: 'Iranian pomegranate soup with herbs and meatballs', confidence: 'Medium' },
  { regions: ['japan', 'east asia'], ingredients: ['miso', 'tofu', 'seaweed'], sensory: ['soup'], dish: 'Miso Soup', why: 'Japanese fermented soybean paste soup', confidence: 'High' },
  { regions: ['korea', 'east asia'], ingredients: ['soybean paste', 'tofu'], sensory: ['soup'], dish: 'Doenjang Guk', why: 'Korean fermented soybean paste soup', confidence: 'High' },
  // Central American / Panamanian confectionery
  { regions: ['panama', 'central america', 'latin america', 'colombia'], ingredients: ['milk', 'sugar', 'caramel'], sensory: ['sweet', 'soft texture', 'grainy/crystalline texture'], dish: 'Dulce de Leche en Tabla (Manjar Blanco)', why: 'Slow-cooked milk candy cut into rectangles, grainy from lactose crystallization, wrapped in paper', confidence: 'High' },
  { regions: ['panama', 'central america', 'latin america', 'mexico'], ingredients: ['milk', 'sugar'], sensory: ['sweet', 'soft texture'], dish: 'Leche Quemada', why: 'Burnt milk fudge with grainy texture, common in Central America', confidence: 'Medium' },
  { regions: ['panama', 'central america', 'latin america', 'caribbean'], ingredients: ['coconut', 'sugar'], sensory: ['sweet'], dish: 'Cocada', why: 'Coconut candy made with sugar, common throughout Latin America and the Caribbean', confidence: 'Medium' },
  { regions: ['latin america', 'caribbean', 'puerto rican', 'cuban', 'dominican'], ingredients: ['rice', 'coconut', 'milk', 'cinnamon'], sensory: ['sweet'], dish: 'Arroz con Dulce', why: 'Caribbean/Latin American rice pudding with coconut milk and cinnamon', confidence: 'High' },
  { regions: ['latin america', 'mexico', 'central america', 'spain'], ingredients: ['egg', 'milk', 'caramel'], sensory: ['sweet', 'custard/pudding'], dish: 'Flan (Crème Caramel)', why: 'Caramel custard ubiquitous in Latin America', confidence: 'High' },
  { regions: ['argentina', 'uruguay', 'latin america'], ingredients: ['caramel', 'cookie'], sensory: ['sweet'], dish: 'Alfajor', why: 'Dulce de leche sandwich cookie, very popular in Argentina and Uruguay', confidence: 'High' },
  { regions: ['mexico', 'latin america'], ingredients: ['masa', 'cinnamon', 'sugar'], sensory: ['sweet'], dish: 'Champurrado / Atole', why: 'Thick Mexican hot drink/porridge made with masa, chocolate or cinnamon, and sugar', confidence: 'Medium' },
  { regions: ['mexico', 'latin america'], ingredients: ['masa', 'cinnamon', 'sugar'], sensory: ['sweet'], dish: 'Tamales Dulces', why: 'Sweet tamales made with masa, sugar, cinnamon, raisins, or pineapple', confidence: 'Medium' },
  { regions: ['colombia', 'venezuela', 'latin america'], ingredients: ['corn', 'cheese'], sensory: ['sweet'], dish: 'Arepa de Maíz Dulce / Arepa de Anís', why: 'Sweet corn arepa, sometimes with anise or cheese', confidence: 'Medium' },
  { regions: ['latin america', 'caribbean'], ingredients: ['plantains', 'sugar'], sensory: ['sweet', 'soft texture'], dish: 'Plátano en Tentación / Plátano Maduro', why: 'Sweet caramelized ripe plantains, common throughout Latin America', confidence: 'High' },
  { regions: ['peru', 'bolivia', 'latin america'], ingredients: ['honey', 'nuts'], sensory: ['sweet'], dish: 'King Kong (Dulce de Leche and Honey Cookie)', why: 'Peruvian layered cookie with dulce de leche, honey, and nuts', confidence: 'Medium' },
  // Indian subcontinent confectionery
  { regions: ['india', 'south asia'], ingredients: ['milk', 'sugar'], sensory: ['sweet'], dish: 'Barfi / Pedha', why: 'Indian milk fudge made by reducing milk with sugar, often grainy', confidence: 'High' },
  { regions: ['india', 'south asia'], ingredients: ['coconut', 'sugar'], sensory: ['sweet'], dish: 'Nariyal Barfi / Coconut Ladoo', why: 'Indian coconut sweet made with condensed milk or sugar', confidence: 'High' },
  // Middle Eastern / Mediterranean confectionery
  { regions: ['middle east', 'turkey', 'greece', 'mediterranean'], ingredients: ['nuts', 'honey'], sensory: ['sweet'], dish: 'Baklava', why: 'Layered phyllo pastry with nuts and honey syrup', confidence: 'High' },
  { regions: ['middle east', 'turkey', 'mediterranean'], ingredients: ['sesame', 'honey'], sensory: ['sweet'], dish: 'Halva / Halwa', why: 'Sesame and honey confection with crumbly/grainy texture', confidence: 'High' },
  { regions: ['turkey', 'middle east'], ingredients: ['milk', 'sugar', 'flour'], sensory: ['sweet'], dish: 'Tavuk Göğsü / Kazandibi', why: 'Turkish milk pudding with caramelized bottom, sometimes chicken breast for texture', confidence: 'Medium' },
  // European confectionery
  { regions: ['france', 'europe'], ingredients: ['caramel', 'butter', 'sugar'], sensory: ['sweet', 'soft texture'], dish: 'Caramel au Beurre Salé / Salted Butter Caramel', why: 'French soft caramel candy, often wrapped individually', confidence: 'High' },
  { regions: ['scotland', 'uk', 'europe'], ingredients: ['sugar', 'butter'], sensory: ['sweet', 'grainy/crystalline texture'], dish: 'Tablet / Scottish Tablet', why: 'Scottish confection made from sugar, butter, and condensed milk with a grainy, melt-in-mouth texture', confidence: 'High' },
  { regions: ['england', 'uk', 'europe'], ingredients: ['sugar', 'butter'], sensory: ['sweet', 'soft texture'], dish: 'Fudge', why: 'British soft candy made from sugar, butter, and milk', confidence: 'High' },
  { regions: ['ireland', 'uk', 'europe'], ingredients: ['potato', 'sugar'], sensory: ['sweet'], dish: 'Potato Candy / Irish Potato Candy', why: 'Coconut cream candy rolled in cinnamon to look like potatoes', confidence: 'Medium' },
  { regions: ['usa', 'america', 'southern us'], ingredients: ['peanut', 'sugar'], sensory: ['sweet'], dish: 'Peanut Brittle / Peanut Butter Fudge', why: 'American confection with peanuts and caramelized sugar', confidence: 'Medium' },
  { regions: ['usa', 'america'], ingredients: ['marshmallow', 'chocolate'], sensory: ['sweet'], dish: "S'mores / Rocky Road Fudge", why: 'American marshmallow and chocolate confection', confidence: 'Medium' },
  // East Asian confectionery
  { regions: ['japan', 'east asia'], ingredients: ['rice', 'sugar'], sensory: ['sweet'], dish: 'Mochi / Daifuku', why: 'Japanese rice cake with sweet filling', confidence: 'High' },
  { regions: ['japan', 'east asia'], ingredients: ['bean', 'sugar'], sensory: ['sweet'], dish: 'Yokan / Anko (Red Bean Paste)', why: 'Japanese sweet bean jelly or paste', confidence: 'High' },
  { regions: ['china', 'east asia'], ingredients: ['rice', 'sugar'], sensory: ['sweet'], dish: 'Nian Gao (Rice Cake)', why: 'Chinese New Year sticky rice cake', confidence: 'High' },
  { regions: ['china', 'east asia'], ingredients: ['nuts', 'sugar'], sensory: ['sweet'], dish: 'Hùntáo Gāo (Walnut Cookie)', why: 'Chinese walnut shortbread cookie that crumbles in the mouth', confidence: 'Medium' },
  // Southeast Asian confectionery
  { regions: ['thailand', 'southeast asia'], ingredients: ['coconut', 'sugar', 'milk'], sensory: ['sweet'], dish: 'Khanom Krok / Coconut Pancake', why: 'Thai coconut griddle cake with sweet creamy center', confidence: 'Medium' },
  { regions: ['philippines', 'southeast asia'], ingredients: ['milk', 'sugar'], sensory: ['sweet'], dish: 'Pastillas de Leche', why: 'Filipino milk candy made from carabao milk and sugar, often wrapped in paper', confidence: 'High' },
  { regions: ['philippines', 'southeast asia'], ingredients: ['coconut', 'sugar'], sensory: ['sweet'], dish: 'Bukayo / Cocada Filipina', why: 'Filipino coconut candy made with caramelized sugar', confidence: 'Medium' },
  { regions: ['indonesia', 'malaysia', 'southeast asia'], ingredients: ['coconut', 'sugar', 'rice'], sensory: ['sweet'], dish: 'Klepon / Onde-Onde', why: 'Indonesian/Malaysian glutinous rice balls with palm sugar and coconut', confidence: 'High' },
  // African confectionery
  { regions: ['south africa'], ingredients: ['milk', 'sugar'], sensory: ['sweet'], dish: 'Fudge / Cape Malay Fudge', why: 'South African milk fudge with grainy texture', confidence: 'Medium' },
  { regions: ['nigeria', 'ghana', 'west africa'], ingredients: ['coconut', 'sugar'], sensory: ['sweet'], dish: 'Coconut Candy / Chin Chin', why: 'West African coconut toffee or fried sweet dough', confidence: 'Medium' },
];

function inferredHypotheses(memory: CollectedFoodMemory): DishHypothesis[] {
  const regions = memory.extractedClues.culturalOrRegionalHints.map((r) => r.toLowerCase());
  const ingredients = memory.extractedClues.rememberedIngredients.map((i) => i.toLowerCase());
  const sensory = memory.extractedClues.sensoryClues.map((s) => s.toLowerCase());
  const text = memory.normalizedMemory.toLowerCase();

  const matches = INFERRED_DISH_PATTERNS.filter((pattern) => {
    const regionMatch = pattern.regions.some((r) => regions.some((region) => region.includes(r) || r.includes(region)));
    const ingredientMatch = pattern.ingredients.some((i) => ingredients.some((ing) => ing.includes(i) || i.includes(ing)) || text.includes(i));
    const sensoryMatch = pattern.sensory.some((s) => sensory.some((sen) => sen.includes(s) || s.includes(sen)) || text.includes(s));
    return regionMatch && (ingredientMatch || sensoryMatch);
  });

  return matches.map((match) => ({
    name: match.dish,
    whyPossible: [match.why, 'inferred from ingredient, region, and sensory clues'],
    whatWouldConfirm: ['original language spelling', 'region/town', 'ingredients', 'cooking method', 'occasion'],
    confidence: match.confidence,
    researchRequired: true,
  }));
}

function buildDescriptiveHypothesis(memory: CollectedFoodMemory): DishHypothesis | null {
  const region = memory.extractedClues.culturalOrRegionalHints[0];
  const sensory = memory.extractedClues.sensoryClues;
  const ingredients = memory.extractedClues.rememberedIngredients;
  const text = memory.normalizedMemory.toLowerCase();

  if (!region && sensory.length === 0 && ingredients.length === 0) return null;

  // Detect food format from text and sensory clues
  const isSweet = sensory.some((s) => s.includes('sweet')) || text.includes('sweet') || text.includes('sugar') || text.includes('caramel');
  const isSoup = sensory.some((s) => s.includes('soup') || s.includes('broth')) || text.includes('soup') || text.includes('broth');
  const isFried = sensory.some((s) => s.includes('fried') || s.includes('crispy')) || text.includes('fried') || text.includes('crispy');
  const isBread = text.includes('bread') || text.includes('loaf') || text.includes('roll') || text.includes('bun');
  const isCandy = isSweet && (text.includes('candy') || text.includes('wrapped') || text.includes('paper') || text.includes('rectangle') || sensory.some((s) => s.includes('grainy') || s.includes('crystalline') || s.includes('chewy')));
  const isCookie = text.includes('cookie') || text.includes('biscuit') || sensory.some((s) => s.includes('cookie'));
  const isCake = text.includes('cake') || text.includes('pastry');
  const isDrink = text.includes('drink') || text.includes('beverage') || text.includes('juice');

  const regionPhrase = region || 'the region';

  let descriptor = '';
  if (isCandy) descriptor = 'candy or confection';
  else if (isCookie) descriptor = 'cookie or biscuit';
  else if (isCake) descriptor = 'cake or pastry';
  else if (isBread) descriptor = 'bread or baked good';
  else if (isSoup) descriptor = 'soup or stew';
  else if (isDrink) descriptor = 'drink or beverage';
  else if (isFried) descriptor = 'fried dish';
  else if (isSweet) descriptor = 'sweet dish or dessert';
  else descriptor = 'traditional dish';

  const textureWords = sensory.filter((s) => s.includes('texture') || s.includes('soft') || s.includes('crispy') || s.includes('chewy') || s.includes('grainy') || s.includes('creamy'));
  const flavorWords = sensory.filter((s) => s.includes('sweet') || s.includes('sour') || s.includes('spicy') || s.includes('bitter') || s.includes('rich') || s.includes('smoky') || s.includes('umami'));

  const texturePhrase = textureWords.length > 0 ? ` with ${textureWords.slice(0, 2).join(', ').replace(/,([^,]*)$/, ' and$1')}` : '';
  const flavorPhrase = flavorWords.length > 0 ? `, ${flavorWords.slice(0, 2).join('/')} in flavor` : '';
  const ingredientPhrase = ingredients.length > 0 ? ` made with ${ingredients.slice(0, 2).join(' and ')}` : '';

  const name = `A${texturePhrase} ${descriptor}${ingredientPhrase}${flavorPhrase} from ${regionPhrase}`;

  return {
    name,
    whyPossible: [
      `User described: ${sensory.slice(0, 3).join(', ')}${ingredients.length > 0 ? '; ingredients: ' + ingredients.slice(0, 2).join(', ') : ''}`,
      'No exact dish name was given, but the sensory and regional clues are specific enough to form a testable hypothesis.',
    ],
    whatWouldConfirm: ['exact dish name or local nickname', 'how it was made or served', 'who made it or on what occasion'],
    confidence: sensory.length >= 2 && region ? 'Medium' : 'Low',
    researchRequired: true,
  };
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

  // Try inferred hypotheses first
  const inferred = inferredHypotheses(memory);
  if (inferred.length > 0) {
    return inferred.slice(0, 3);
  }

  // Build a descriptive hypothesis from the user's actual clues instead of saying "unknown"
  const descriptive = buildDescriptiveHypothesis(memory);
  if (descriptive) {
    return [descriptive];
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
  confectionery: {
    keywords: 'caramel|dulce de leche|manjar|fudge|barfi|halva|baklava|mochi|candy|sweet|dessert|confection|cookie|biscuit|nougat|turrón|taffy|melcocha|cocada|flan|custard|pudding|chocolate|pastillas',
    criticalElement: 'sugar crystallization structure and fat-soluble aroma delivery in a solid or semi-solid matrix',
    flavorProfile: 'sweetness balanced by dairy fat, caramelization bitterness, or aromatic spice; texture from crystalline, chewy, or crumbly structure',
    localTestWith: 'any grocery-store sweet with a similar texture: soft caramel, fudge, coconut candy, milk toffee, or shortbread cookie',
    substitutionReason: 'Confectionery nostalgia is driven by sugar crystallization texture, dairy fat mouthfeel, and caramelization depth; these are reproducible with common sweets before sourcing exact regional ingredients',
  },
} as const;

type ComponentRole = keyof typeof COMPONENT_ROLES;

const ROLE_ORDER: ComponentRole[] = ['starch', 'protein', 'sauce', 'vegetable', 'broth', 'confectionery'];

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

function foodScienceCueProfile(signals: string, userLocation?: string, overallConfidence?: Confidence, forceProbe?: boolean): FoodScienceCueProfile {
  if (forceProbe) {
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
  const hasProteinOrFat = hasAnySignal(signals, [wordSignal('meat|sausage|fish|shark|beef|pork|chicken|lamb|cheese|fat|butter|oil|fried')]);
  const hasStarchOrBase = hasAnySignal(signals, [wordSignal('starch|rice|potato|potatoes|mash|masa|dough|bread|yuca|cassava|plantain|dumpling|noodle|bean|beans')]);
  const hasSauceOrCondiment = hasAnySignal(signals, [wordSignal('sauce|gravy|relish|chutney|salsa|condiment|dip|orange|creamy')]);
  const hasLiquid = hasAnySignal(signals, [wordSignal('soup|stew|broth|sip|drink|porridge')]);
  const hasAroma = hasAnySignal(signals, [wordSignal('aroma|smell|spice|spiced|seasoned|garlic|onion|herb|pepper|cumin|coriander|clove|nutmeg|cinnamon')]);
  const hasTextureContrast = hasAnySignal(signals, [wordSignal('crispy|crunchy|chewy|creamy|soft|tender|stretchy|crisp|fried|grilled|charred|brown|golden')]);
  const hasAcidOrSweet = hasAnySignal(signals, [wordSignal('sour|tangy|acid|vinegar|citrus|lime|lemon|fermented|sweet|syrup|molasses|sugar')]);
  const hasConfectionery = hasAnySignal(signals, [wordSignal('caramel|dulce de leche|manjar|fudge|barfi|halva|baklava|mochi|candy|sweet|dessert|confection|cookie|biscuit|nougat|turrón|taffy|melcocha|cocada|flan|custard|pudding|chocolate|pastillas|milk candy|grainy/crystalline texture')]);

  if (hasConfectionery) {
    return {
      title: 'Minimum viable sweet-texture cue',
      goal: 'Test the memory through a tiny piece of a grocery-store sweet with a matching texture and flavor direction before making a full batch.',
      effortMinutes: 8,
      format: 'bite',
      ingredients: [
        { item: 'grocery-store sweet matching the texture direction: soft caramel, fudge, coconut candy, shortbread, or milk toffee', amount: '1 small piece', purpose: 'tests sugar crystallization texture and dairy fat mouthfeel' },
        { item: 'pantry adjustment for flavor direction: cinnamon, vanilla extract, pinch of salt, or coconut flakes', amount: 'pinch or drop', purpose: 'aroma and flavor tuning', optional: true },
        { item: 'warm water or black coffee as a palate cleanser', amount: 'sip', purpose: 'resets sweetness perception between tests', optional: true },
      ],
      steps: [
        'Take one small piece of the grocery-store sweet and let it sit on the tongue without chewing immediately.',
        'Note whether the memory trigger is texture (grainy, creamy, crumbly, chewy), flavor (caramel, dairy, coconut, spice), or both.',
        'If a specific spice or aroma is missing, add a tiny pinch to the next piece and compare.',
        'Test at room temperature first, then briefly chilled if the memory might have been cooled.',
      ],
      preserves: ['sugar crystallization texture', 'caramelization depth', 'dairy fat mouthfeel', 'spice aroma direction'],
      doesNotPreserve: ['exact regional recipe', 'specific cooking time', 'original wrapper or presentation'],
      accessibilityPrinciples: ['use any grocery-store sweet with the right texture first', 'test one small piece', 'adjust with pantry spices before buying specialty ingredients', 'avoid making a full batch until the texture direction is confirmed'],
      substituteLogic: [
        'Confectionery nostalgia is usually about sugar crystallization structure and dairy fat mouthfeel, not the exact recipe.',
        'Soft caramel or fudge tests creamy/grainy textures; shortbread tests crumbly textures; coconut candy tests fibrous-chewy textures.',
        'A tiny pinch of cinnamon, vanilla, or salt can reveal whether the memory is about the base sweet or the aromatic accent.',
      ],
      whyThisIsMinimum: 'One piece of a texture-matched grocery-store sweet tests the core sugar-crystallization and fat-delivery mechanisms before any cooking.',
      safetyNotes: ['Check for dairy or nut allergies before testing.', 'Keep pieces small; high-sugar foods can be intense.'],
      followUpIfItWorks: ['Ask whether the original was darker/caramelly or lighter/milky.', 'Ask whether it was grainy, creamy, or crumbly.', 'Ask what aroma comes to mind: vanilla, cinnamon, coconut, or something else.', 'Use source_ingredients to help find regional sweet ingredients near the user.'],
      components: decomposeIntoComponents(signals, userLocation, overallConfidence),
    };
  }

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

type ConstraintClass = 'vegan' | 'vegetarian' | 'gluten-free' | 'nut-allergy' | 'halal' | 'kosher' | 'dairy-free' | 'pork-free';

const CONSTRAINT_PATTERNS: Array<[ConstraintClass, RegExp]> = [
  ['vegan', /\bvegan\b|\bno animal products?\b|\bplant[-\s]?based\b/i],
  ['vegetarian', /\bvegetarian\b|\bmeat[-\s]?free\b|\bno meat\b/i],
  ['gluten-free', /\bgluten[-\s]?free\b|\bceliac\b|\bcoeliac\b|\bno gluten\b|\bwheat[-\s]?free\b/i],
  ['nut-allergy', /\bnut allerg|\bpeanut allerg|\btree nuts?\b|\bpeanut[-\s]?free\b|\bnut[-\s]?free\b|\bno peanuts?\b|\bno nuts?\b|\ballergic to (?:peanuts?|tree nuts?|nuts?)\b/i],
  ['halal', /\bhalal\b/i],
  ['kosher', /\bkosher\b/i],
  ['dairy-free', /\bdairy[-\s]?free\b|\blactose[-\s]?free\b|\bno dairy\b|\blactose intolerant\b|\bmilk allerg|\bno milk\b/i],
  ['pork-free', /\bpork[-\s]?free\b|\bno pork\b/i],
];

function classifyConstraints(constraints?: string[]): Set<ConstraintClass> {
  const classes = new Set<ConstraintClass>();
  const text = (constraints ?? []).join(' ');
  for (const [constraintClass, pattern] of CONSTRAINT_PATTERNS) {
    if (pattern.test(text)) classes.add(constraintClass);
  }
  return classes;
}

function hasAnyConstraint(classes: Set<ConstraintClass>, values: ConstraintClass[]): boolean {
  return values.some((value) => classes.has(value));
}

function replaceConstraintText(text: string, replacements: Array<[RegExp | string, string]>): string {
  return replacements.reduce((current, [from, to]) => current.replace(from, to), text);
}

function enforceKnownConstraintTerms(text: string, classes: Set<ConstraintClass>): string {
  let rewritten = text;

  if (classes.has('gluten-free')) {
    rewritten = replaceConstraintText(rewritten, [
      [/\bflour tortilla\b/gi, 'certified gluten-free corn carrier'],
      [/\bbread\b/gi, 'rice cake'],
      [/\bcracker\b/gi, 'certified gluten-free crisp rice carrier'],
      [/\btortilla\b/gi, 'certified gluten-free corn carrier'],
      [/\bnoodle\b/gi, 'rice starch carrier'],
      [/\bwheat\b/gi, 'certified gluten-free grain'],
    ]);
  }

  if (hasAnyConstraint(classes, ['vegan', 'vegetarian'])) {
    rewritten = replaceConstraintText(rewritten, [
      [/\bfat-rendered\b/gi, 'oil-carried'],
      [/\brendered fat\b/gi, 'oil-carried aromatics'],
      [/\bground pork\b|\bpork\b|\bchicken thigh\b|\bchicken\b|\blamb\b|\bbeef\b|\bmeat\b|\bsausage\b|\bfish\b|\bshark\b/gi, 'plant-based protein'],
      [/\bcheese\b|\bdairy\b|\byogurt\b|\bmilk\b/gi, 'plant-based creamy carrier'],
      [/\bbutter\b/gi, 'olive oil'],
      [/\bcertified compliant protein\b|\bcertified compliant meat\b/gi, 'plant-based protein'],
      [/\bproteins that render fat\b/gi, 'Plant proteins and oils'],
      [/\brender fat\b/gi, 'carry oil-soluble browning notes'],
    ]);
  } else if (hasAnyConstraint(classes, ['halal', 'kosher', 'pork-free'])) {
    const compliantProteinReplacements: Array<[RegExp, string]> = hasAnyConstraint(classes, ['halal', 'kosher'])
      ? [
          [/\bfat-rendered\b/gi, 'certified compliant fat-driven'],
          [/\bground pork\b|\bpork\b|\bchicken thigh\b|\bchicken\b|\bbeef\b|\blamb\b|\bmeat\b/gi, 'certified compliant protein'],
          [/\brendered fat\b/gi, 'certified compliant fat or oil'],
          [/\brender fat\b/gi, 'carry certified compliant fat-soluble browning notes'],
        ]
      : [
          [/\bground pork\b|\bpork\b/gi, 'pork-free protein'],
          [/\brendered fat\b/gi, 'pork-free fat or oil'],
        ];
    rewritten = replaceConstraintText(rewritten, compliantProteinReplacements);
  }

  if (classes.has('dairy-free')) {
    rewritten = replaceConstraintText(rewritten, [
      [/\bdairy-based\b/gi, 'oil-herb or tomato-based'],
      [/\bcheese\b|\bdairy\b|\byogurt\b|\bmilk\b/gi, 'plant-based creamy carrier'],
      [/\bbutter\b/gi, 'olive oil'],
    ]);
  }

  if (classes.has('nut-allergy')) {
    rewritten = replaceConstraintText(rewritten, [
      [/\bcoconut milk\b/gi, 'olive-oil-enriched broth'],
      [/\bpeanuts?\b|\btree nuts?\b|\bnuts?\b/gi, 'allergy-safe ingredient'],
    ]);
  }

  return rewritten;
}

function rewriteIngredientForConstraints(item: string, classes: Set<ConstraintClass>): string {
  let rewritten = item;

  if (classes.has('gluten-free')) {
    rewritten = replaceConstraintText(rewritten, [
      [
        'starch, bread, potato, rice, bean, noodle, or cooked vegetable',
        'certified gluten-free carrier: rice, potato, corn, bean, or cooked vegetable',
      ],
      [
        'neutral carrier such as bread, rice, potato, cracker, tortilla, or cooked starch',
        'certified gluten-free neutral carrier such as rice, potato, corn cake, or cooked starch',
      ],
      [
        'neutral carrier such as oil, water, bread, rice, or potato',
        'neutral carrier such as oil, water, rice, corn cake, or potato',
      ],
    ]);
  }

  if (hasAnyConstraint(classes, ['vegan', 'vegetarian'])) {
    rewritten = replaceConstraintText(rewritten, [
      [
        'small amount of accessible protein, fat, dairy, mushroom, bean, or plant-based substitute if relevant',
        'small amount of plant-based umami/fat carrier such as beans, mushrooms, tofu, or olive oil',
      ],
      [
        'water, broth, milk, or another cheap neutral liquid carrier',
        'water, vegetable broth, or olive-oil-enriched plant liquid carrier',
      ],
      [
        'tiny fat source such as oil, butter, rendered fat, or coconut milk if relevant',
        'tiny plant-based fat source such as olive oil if relevant',
      ],
      [
        'pantry sauce base matching the researched direction: tomato, dairy, oil, vinegar, fruit, chile, or stock',
        'pantry sauce base matching the researched direction: tomato, oil, vinegar, fruit, chile, herb, or vegetable stock',
      ],
    ]);
  }

  if (!hasAnyConstraint(classes, ['vegan', 'vegetarian']) && hasAnyConstraint(classes, ['halal', 'kosher', 'pork-free'])) {
    rewritten = replaceConstraintText(rewritten, [
      [
        'small amount of accessible protein, fat, dairy, mushroom, bean, or plant-based substitute if relevant',
        'small amount of compliant protein/fat carrier such as beans, mushrooms, tofu, olive oil, or certified compliant meat',
      ],
      [
        'tiny fat source such as oil, butter, rendered fat, or coconut milk if relevant',
        'tiny compliant fat source such as olive oil or coconut milk if relevant',
      ],
    ]);
  }

  if (classes.has('dairy-free')) {
    rewritten = replaceConstraintText(rewritten, [
      [
        'water, broth, milk, or another cheap neutral liquid carrier',
        'water, broth, or olive-oil-enriched plant liquid carrier',
      ],
      [
        'tiny fat source such as oil, butter, rendered fat, or coconut milk if relevant',
        'tiny plant-based fat source such as olive oil if relevant',
      ],
      [
        'small amount of accessible protein, fat, dairy, mushroom, bean, or plant-based substitute if relevant',
        'small amount of accessible plant-based protein/fat carrier such as mushroom, bean, tofu, or olive oil',
      ],
      [
        'pantry sauce base matching the researched direction: tomato, dairy, oil, vinegar, fruit, chile, or stock',
        'pantry sauce base matching the researched direction: tomato, oil, vinegar, fruit, chile, or stock',
      ],
    ]);
  }

  return enforceKnownConstraintTerms(rewritten, classes);
}

function rewriteComponentsForConstraints(components: CueComponent[], classes: Set<ConstraintClass>): CueComponent[] {
  return components.map((component) => {
    let localTestWith = component.localTestWith;

    if (classes.has('gluten-free')) {
      localTestWith = replaceConstraintText(localTestWith, [
        [
          'any grocery-store starch: potato, rice, bread, or flour tortilla',
          'any grocery-store certified gluten-free starch: potato, rice, corn cake, or cooked bean',
        ],
      ]);
    }

    if (hasAnyConstraint(classes, ['vegan', 'vegetarian'])) {
      localTestWith = replaceConstraintText(localTestWith, [
        [
          'any accessible protein: ground pork, chicken thigh, or firm tofu pan-seared in oil',
          'any accessible plant-based protein: firm tofu, mushrooms, or beans pan-seared in oil',
        ],
        ['grocery-store salsa, tomato paste with vinegar and sugar, or yogurt with herbs', 'grocery-store salsa, tomato paste with vinegar and sugar, or oil-herb sauce'],
        ['any warm broth or stock with a pinch of the remembered spice', 'any warm vegetable broth with a pinch of the remembered spice'],
      ]);
    } else if (hasAnyConstraint(classes, ['halal', 'kosher', 'pork-free'])) {
      localTestWith = replaceConstraintText(localTestWith, [
        [
          'any accessible protein: ground pork, chicken thigh, or firm tofu pan-seared in oil',
          'any accessible certified compliant protein or firm tofu pan-seared in oil',
        ],
      ]);
    }

    if (classes.has('dairy-free')) {
      localTestWith = replaceConstraintText(localTestWith, [
        ['grocery-store salsa, tomato paste with vinegar and sugar, or yogurt with herbs', 'grocery-store salsa, tomato paste with vinegar and sugar, or oil-herb sauce'],
      ]);
    }

    return {
      ...component,
      criticalElement: enforceKnownConstraintTerms(component.criticalElement, classes),
      flavorProfile: enforceKnownConstraintTerms(component.flavorProfile, classes),
      localTestWith: enforceKnownConstraintTerms(localTestWith, classes),
      substitutionReason: enforceKnownConstraintTerms(component.substitutionReason, classes),
    };
  });
}

function applyConstraintsToProfile(profile: FoodScienceCueProfile, constraints?: string[]): FoodScienceCueProfile {
  const classes = classifyConstraints(constraints);
  if (classes.size === 0) return profile;

  return {
    ...profile,
    ingredients: profile.ingredients.map((ingredient) => ({
      ...ingredient,
      item: rewriteIngredientForConstraints(ingredient.item, classes),
    })),
    components: rewriteComponentsForConstraints(profile.components, classes),
  };
}

function buildConstraintGuidance(constraints?: string[]): Pick<FoodScienceCueProfile, 'accessibilityPrinciples' | 'substituteLogic' | 'safetyNotes'> {
  const normalized = unique((constraints ?? []).map((constraint) => constraint.trim()).filter(Boolean));
  if (normalized.length === 0) return { accessibilityPrinciples: [], substituteLogic: [], safetyNotes: [] };

  const joined = normalized.join(', ');
  return {
    accessibilityPrinciples: [
      `Honor user constraints before nostalgia matching: ${joined}.`,
      'Choose the cheapest accessible proxy that satisfies the constraint instead of treating the exact ingredient as mandatory.',
    ],
    substituteLogic: [
      `For constraints (${joined}), match the sensory mechanism with compliant carriers; do not use restricted ingredients just because they are traditional.`,
    ],
    safetyNotes: [
      `Do not use ingredients that conflict with these user constraints: ${joined}.`,
      'For allergies, use clean utensils and avoid cross-contact; if uncertain, do not taste the cue.',
    ],
  };
}

export function generateMinimumViableNostalgiaCue(input: MinimumViableNostalgiaInput): MinimumViableNostalgiaCue {
  const signals = textSignals(input);
  const effort = input.maxEffortMinutes;
  const maxEffort = Number.isFinite(effort) ? Math.max(1, effort!) : 20;
  const confidence = input.researchFindings?.confidence ?? input.dossier.confidence;

  // Be conservative: if we have almost no information, ask questions instead of prescribing a test.
  const wordCount = (arr: string[]) => arr.join(' ').trim().split(/\s+/).filter(Boolean).length;
  const totalWords = wordCount(input.dossier.evidenceLedger.userSaid)
    + wordCount(input.dossier.evidenceLedger.researched)
    + wordCount(input.dossier.evidenceLedger.inferred);
  const hasDishName = input.dossier.hypotheses.some((h) => h.confidence !== 'Low' && !h.researchRequired);

  // Force the memory-probe cue when information is too sparse to justify a specific test.
  const forceProbe = confidence === 'Low' && totalWords < 10 && !hasDishName;

  const profile = applyConstraintsToProfile(
    foodScienceCueProfile(signals, input.userLocation, confidence, forceProbe),
    input.constraints,
  );
  const constraintGuidance = buildConstraintGuidance(input.constraints);

  return {
    ...profile,
    accessibilityPrinciples: unique([...profile.accessibilityPrinciples, ...constraintGuidance.accessibilityPrinciples]),
    substituteLogic: unique([...profile.substituteLogic, ...constraintGuidance.substituteLogic]),
    safetyNotes: unique([...profile.safetyNotes, ...constraintGuidance.safetyNotes]),
    effortMinutes: Math.min(maxEffort, profile.effortMinutes),
    confidence: profile.title === 'Minimum viable memory-probe cue' ? 'Low' : confidence,
  };
}
