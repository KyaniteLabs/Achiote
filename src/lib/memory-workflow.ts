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
    hint === 'curry/curried' ? /\bcurr(?:y|ied)\b/.test(text) : text.includes(hint)
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
  const rememberedIngredients = INGREDIENT_HINTS.filter((ingredient) => lower.includes(ingredient));
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

export function generateMinimumViableNostalgiaCue(input: MinimumViableNostalgiaInput): MinimumViableNostalgiaCue {
  const signals = textSignals(input);
  const maxEffort = Math.max(1, input.maxEffortMinutes ?? 20);
  const confidence = input.researchFindings?.confidence ?? input.dossier.confidence;

  const hasFriedStarchSignal = /\b(fried|fritter|golden|crispy|crisp)\b/.test(signals)
    && /\b(yuca|cassava|manioc|masa|dough|starch|root vegetable)\b/.test(signals);
  const hasStuffedOrFillingSignal = /\b(stuffed|filled|filling|picadillo|ground beef|seasoned beef|cheese)\b/.test(signals);
  if (hasFriedStarchSignal && hasStuffedOrFillingSignal) {
    return {
      title: 'Minimum viable fried-starch memory cue',
      goal: 'Test the strongest triggers of a fried stuffed starch: savory filling aroma plus a crispy-chewy starch bite, without shaping, stuffing, sealing, or frying a full batch.',
      effortMinutes: Math.min(maxEffort, 20),
      format: 'bite',
      ingredients: [
        { item: 'tiny amount of the likely filling protein, cheese, or vegetable substitute', amount: '2-4 tablespoons', purpose: 'filling aroma cue' },
        { item: 'garlic/onion or the researched aromatic base', amount: '1 teaspoon each', purpose: 'first kitchen-smell trigger' },
        { item: 'the researched signature spice or color seasoning', amount: 'small pinch', purpose: 'regional seasoning signal' },
        { item: 'tomato paste, sauce, or another researched binder', amount: '1 teaspoon', purpose: 'savory filling base', optional: true },
        { item: 'cooked yuca/cassava, masa, or the researched starch base', amount: '1-2 small pieces', purpose: 'crispy-chewy starch bite' },
        { item: 'the researched table sauce or condiment', amount: 'a few drops', purpose: 'serving ritual cue', optional: true },
      ],
      steps: [
        'Warm a little oil, then cook the aromatic base for about 30 seconds until fragrant.',
        'Add the tiny amount of filling with the signature seasoning; cook only until the aroma blooms.',
        'Separately pan-crisp the cooked starch pieces until the outside is golden and the inside stays tender or chewy.',
        'Taste one starch bite with a spoonful of filling on top; do not shape, stuff, or seal anything yet.',
        'Ask: did the fried-starch texture, filling aroma, or condiment finish feel like the memory? Only then decide whether the full labor-intensive version is worth making.',
      ],
      preserves: ['savory filling aroma', 'signature seasoning signal', 'crispy-chewy starch texture', 'small serving ritual'],
      doesNotPreserve: ['final shape', 'sealed stuffed structure', 'deep-fried batch texture', 'family-specific filling ratio'],
      whyThisIsMinimum: 'Fried stuffed starch dishes are labor-intensive because the full dish usually requires preparing the starch, making filling, shaping, sealing, and frying; this isolates the smell and bite that can confirm the memory before doing all that work.',
      confidence,
      safetyNotes: ['Use fully cooked root starches before crisping.', 'Keep the oil shallow and hot enough to crisp, not smoke.', 'Avoid condiments or fillings the user cannot safely eat.'],
      followUpIfItWorks: [
        'Ask whether the family filling was meat, cheese, beans, vegetables, or something else.',
        'Ask whether the starch texture was smooth, chunky, buttery, dense, or stretchy.',
        'If this cue hits, offer the user a fuller workflow for the researched dish as the next step.',
      ],
    };
  }

  if (/(banana leaves?|pasteles|sofrito|plantain|green banana|banana masa|plantain masa)/.test(signals)) {
    const effortMinutes = Math.min(maxEffort, 15);
    return {
      title: 'Minimum viable pasteles memory cue',
      goal: 'Create the fastest safe aroma/bite cue for the likely Puerto Rican pasteles memory without pretending to recreate the whole dish.',
      effortMinutes,
      format: 'aroma-cue',
      ingredients: [
        { item: 'banana leaf, fresh or frozen', amount: '1 small piece', purpose: 'steam aroma / family-holiday cue' },
        { item: 'olive oil or neutral oil', amount: '1 teaspoon', purpose: 'carry aromatics' },
        { item: 'sofrito or minced garlic, onion, cilantro/culantro if available', amount: '1 tablespoon', purpose: 'Puerto Rican seasoning signal' },
        { item: 'cooked pork, chicken, beans, or mushrooms', amount: '2 tablespoons', purpose: 'savory filling cue', optional: true },
        { item: 'ripe or green plantain chip / small boiled plantain piece', amount: '1-2 bites', purpose: 'plantain texture/flavor bridge', optional: true },
      ],
      steps: [
        'Warm the banana leaf in a dry pan for 20-30 seconds until fragrant; do not burn it.',
        'In the same pan, warm oil with sofrito or the closest aromatics for 1-2 minutes.',
        'Add the small savory bite if using one and warm it through.',
        'Smell the banana leaf and sofrito together before tasting the bite; that aroma cue is the point.',
        'Stop here and ask whether the smell/seasoning feels familiar before attempting a full dish.',
      ],
      preserves: ['banana-leaf aroma', 'sofrito/savory seasoning signal', 'small plantain or masa-adjacent bite', 'family/holiday cooking cue'],
      doesNotPreserve: ['full wrapped-packet technique', 'true masa texture', 'family-specific filling proportions', 'holiday batch-cooking ritual'],
      whyThisIsMinimum: 'The likely strongest trigger is aroma plus seasoning, so this avoids a multi-hour wrapped pasteles process and tests the memory cue first.',
      confidence,
      safetyNotes: ['Use a food-safe banana leaf and wash it before warming.', 'Avoid any ingredient the user cannot eat or safely identify.'],
      followUpIfItWorks: [
        'Ask family whether the original was wrapped in leaves or layered in a dish.',
        'Ask whether the filling was pork, chicken, beans, or something else.',
        'If the aroma feels right, then consider a fuller pasteles or pastelón reconstruction.',
      ],
    };
  }

  if (/\b(soup|stew|broth|dill|lamb|greens|egusi)\b|\bmelon seeds\b|\bsour\b/.test(signals)) {
    return {
      title: 'Minimum viable soup/stew memory cue',
      goal: 'Create a small aroma/sip test around the remembered sour-herbal or savory stew profile before attempting a full pot.',
      effortMinutes: Math.min(maxEffort, 12),
      format: 'sip',
      ingredients: [
        { item: 'small amount of broth or water', amount: '1 cup', purpose: 'carrier for aroma and taste' },
        { item: 'remembered herb or spice', amount: 'pinch to 1 teaspoon', purpose: 'primary memory cue' },
        { item: 'acid source such as lemon, vinegar, yogurt, or fermented ingredient', amount: 'a few drops to 1 teaspoon', purpose: 'sour/tangy cue', optional: true },
        { item: 'tiny portion of remembered protein/vegetable if available', amount: '1-2 tablespoons', purpose: 'body and context', optional: true },
      ],
      steps: [
        'Warm the broth gently with the remembered herb or spice for 3-5 minutes.',
        'Add the acid source a few drops at a time until the aroma/taste feels close, not necessarily delicious yet.',
        'Taste one spoonful and note what memory appears: place, person, texture, or missing ingredient.',
        'Use that reaction to decide what to research or ask family next.',
      ],
      preserves: ['warm aroma cue', 'sour/tangy direction if remembered', 'herb/spice signal', 'small tasting ritual'],
      doesNotPreserve: ['full stew body', 'long-cooked texture', 'regional ingredient specificity', 'complete recipe balance'],
      whyThisIsMinimum: 'A single cup can test whether the remembered aroma and sourness are the right path before committing to a full dish.',
      confidence,
      safetyNotes: ['Do not use unknown wild herbs or unidentified ingredients.', 'Keep tasting amounts small while testing acid/salt balance.'],
      followUpIfItWorks: ['Ask what the soup was served with.', 'Ask whether the sourness came from dairy, citrus, vinegar, or fermentation.'],
    };
  }

  return {
    title: 'Minimum viable food-memory cue',
    goal: 'Test the strongest available sensory clue with the least effort before attempting a full reconstruction.',
    effortMinutes: Math.min(maxEffort, 10),
    format: 'ritual',
    ingredients: [
      { item: 'one remembered ingredient or closest safe substitute', amount: 'small tasting amount', purpose: 'primary cue' },
      { item: 'one remembered aroma component', amount: 'pinch or small piece', purpose: 'smell cue', optional: true },
      { item: 'neutral carrier such as bread, rice, broth, or oil', amount: 'small amount', purpose: 'make the cue tasteable', optional: true },
    ],
    steps: [
      'Prepare only the remembered smell or bite, not the whole dish.',
      'Smell first, then taste a small amount.',
      'Write down what feels familiar and what feels wrong.',
      'Use the reaction to guide the next research or family question.',
    ],
    preserves: input.dossier.nostalgiaCriticalElements.slice(0, 3),
    doesNotPreserve: ['full recipe', 'full texture', 'family-specific method'],
    whyThisIsMinimum: 'The memory is still uncertain, so the lowest-risk move is a tiny sensory probe rather than a full dish.',
    confidence: 'Low',
    safetyNotes: ['Use only safe, known ingredients.', 'Avoid allergens and unknown substitutions.'],
    followUpIfItWorks: input.dossier.whatToAskFamily.slice(0, 3),
  };
}
