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
} from './types.js';

const RESEARCH_STOPWORDS = new Set([
  'my',
  'mom',
  'grandma',
  'grandmother',
  'auntie',
  'friend',
  'said',
  'sounded',
  'mentioned',
  'called',
  'something',
  'like',
  'with',
  'from',
  'and',
  'the',
  'that',
  'a',
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
  return needles.some((needle) => text.includes(needle));
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
    /(?:mentioned|called|named)\s+([a-zA-Zñáéíóúü-]+(?:\s+[a-zA-Zñáéíóúü-]+){0,2})/gi,
    /(?:sounded like|something like)\s+([a-zA-Zñáéíóúü-]+(?:\s+[a-zA-Zñáéíóúü-]+){0,2})/gi,
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
  const phoneticFragments = [...text.matchAll(/\b[a-zA-Zñáéíóúü]+(?:-[a-zA-Zñáéíóúü]+){1,}\b/g)].map((match) => match[0]);
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

export function collectFoodMemory(input: FoodMemoryInput): CollectedFoodMemory {
  const normalized = input.memoryText.trim();
  const lower = normalized.toLowerCase();
  const possibleDishNames = extractPossibleNames(normalized);
  const culturalOrRegionalHints = unique([
    input.knownRegion,
    lower.includes('puerto rican') || lower.includes('puerto rico') ? 'Puerto Rican' : '',
    lower.includes('trinidad') || lower.includes('tobago') ? 'Trinidad and Tobago' : '',
    lower.includes('caribbean') ? 'Caribbean' : '',
    lower.includes('central american') ? 'Central American' : '',
  ].filter((value): value is string => Boolean(value)));
  const rememberedIngredients = INGREDIENT_HINTS.filter((ingredient) => matchesWordOrPhrase(lower, ingredient));
  const cookingMethodHints = extractCookingMethodHints(lower);
  const sensoryClues = unique([
    includesAny(lower, ['sour', 'tangy']) ? 'sour/tangy' : '',
    includesAny(lower, ['sweet']) ? 'sweet' : '',
    includesAny(lower, ['spicy', 'hot', 'pepper']) ? 'spicy/peppery' : '',
    includesAny(lower, ['crispy', 'crunchy', 'fried']) ? 'crispy/fried texture' : '',
    includesAny(lower, ['soft', 'mushy']) ? 'soft texture' : '',
    includesAny(lower, ['chewy']) ? 'chewy texture' : '',
    includesAny(lower, ['smell', 'aroma']) ? 'remembered aroma' : '',
    includesAny(lower, ['sauce', 'gravy']) ? 'sauce/gravy' : '',
  ]);
  const occasions = unique([
    includesAny(lower, ['christmas', 'holiday', 'navidad']) ? 'holiday/Christmas' : '',
    includesAny(lower, ['grandma', 'abuela', 'grandmother']) ? 'grandmother/family context' : '',
    includesAny(lower, ['mom', 'mother', 'mama']) ? 'mother/family context' : '',
    includesAny(lower, ['street', 'vendor', 'market', 'beach']) ? 'street/vendor/place context' : '',
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

function puertoRicanHypotheses(memory: CollectedFoodMemory): DishHypothesis[] {
  const text = memory.normalizedMemory.toLowerCase();
  const hasPuertoRicanContext = memory.extractedClues.culturalOrRegionalHints.includes('Puerto Rican');
  const likelyPastelSound = includesAny(text, ['pastelay', 'pass-teh-lay', 'pasteles', 'pastelón', 'pastelon']);
  if (!hasPuertoRicanContext) return [];

  return [
    {
      name: 'pasteles',
      whyPossible: ['phonetic overlap with the remembered fragment', 'Puerto Rican family context', 'often family/holiday associated'],
      whatWouldConfirm: ['wrapped in banana leaves', 'steamed packet', 'masa made from green banana/yautía', 'savory pork or sofrito filling'],
      confidence: likelyPastelSound ? 'Medium' : 'Low',
      researchRequired: true,
    },
    {
      name: 'pastelón',
      whyPossible: ['similar name family', 'Puerto Rican/Caribbean plantain association', 'may be remembered as a home casserole'],
      whatWouldConfirm: ['layered casserole', 'sweet plantains', 'ground meat', 'sliced from a baking dish'],
      confidence: memory.extractedClues.rememberedIngredients.includes('plantains') ? 'Medium' : 'Low',
      researchRequired: true,
    },
    {
      name: 'piononos',
      whyPossible: ['Puerto Rican plantain-and-meat overlap', 'could be confused if only ingredients are remembered'],
      whatWouldConfirm: ['fried sweet plantain', 'rolled or cup-shaped form', 'picadillo-like filling'],
      confidence: 'Low',
      researchRequired: true,
    },
  ];
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
  const hypotheses = puertoRicanHypotheses(memory);
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
  const confidence: Confidence = researched.length >= 2 ? 'Medium' : 'Low';

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
};

function hasAnySignal(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function wordSignal(words: string): RegExp {
  return new RegExp(`\\b(${words})\\b`);
}

function foodScienceCueProfile(signals: string): FoodScienceCueProfile {
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
      followUpIfItWorks: ['Ask what gave the liquid body.', 'Ask whether the brightness came from citrus, vinegar, dairy, fermentation, or tomato.', 'Ask what texture or garnish is missing.'],
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
      followUpIfItWorks: ['Ask which part hit first: smell, texture, sauce, fat, spice, or sweetness/acidity.', 'Ask what still feels missing.', 'Then decide whether specialty sourcing is worth it.'],
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
      followUpIfItWorks: ['Ask whether the sauce was smooth or chunky.', 'Ask whether it leaned fatty, acidic, sweet, spicy, or savory.', 'Ask what carrier it was served on.'],
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
      followUpIfItWorks: ['Ask what dish format carried that aroma or balance.', 'Ask what texture or sauce belonged with it.'],
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
    followUpIfItWorks: ['Use the new sensory clue to build a focused bite, sip, sauce, or aroma cue.'],
  };
}

export function generateMinimumViableNostalgiaCue(input: MinimumViableNostalgiaInput): MinimumViableNostalgiaCue {
  const signals = textSignals(input);
  const maxEffort = Math.max(1, input.maxEffortMinutes ?? 20);
  const confidence = input.researchFindings?.confidence ?? input.dossier.confidence;
  const profile = foodScienceCueProfile(signals);

  return {
    ...profile,
    effortMinutes: Math.min(maxEffort, profile.effortMinutes),
    confidence: profile.title === 'Minimum viable memory-probe cue' ? 'Low' : confidence,
  };
}
