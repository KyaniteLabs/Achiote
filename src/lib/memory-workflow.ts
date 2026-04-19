import type {
  CollectedFoodMemory,
  Confidence,
  DishHypothesis,
  DishResearchPlan,
  FamilyFollowupQuestions,
  FoodMemoryInput,
  ReconstructionDossier,
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

export function collectFoodMemory(input: FoodMemoryInput): CollectedFoodMemory {
  const normalized = input.memoryText.trim();
  const lower = normalized.toLowerCase();
  const culturalOrRegionalHints = unique([
    input.knownRegion,
    lower.includes('puerto rican') || lower.includes('puerto rico') ? 'Puerto Rican' : '',
    lower.includes('caribbean') ? 'Caribbean' : '',
    lower.includes('central american') ? 'Central American' : '',
  ].filter((value): value is string => Boolean(value)));
  const rememberedIngredients = INGREDIENT_HINTS.filter((ingredient) => lower.includes(ingredient));
  const sensoryClues = unique([
    includesAny(lower, ['sour', 'tangy']) ? 'sour/tangy' : '',
    includesAny(lower, ['sweet']) ? 'sweet' : '',
    includesAny(lower, ['soft', 'mushy']) ? 'soft texture' : '',
    includesAny(lower, ['smell', 'aroma']) ? 'remembered aroma' : '',
  ]);
  const occasions = unique([
    includesAny(lower, ['christmas', 'holiday', 'navidad']) ? 'holiday/Christmas' : '',
    includesAny(lower, ['grandma', 'abuela', 'grandmother']) ? 'grandmother/family context' : '',
  ]);

  const nextQuestions = [
    'Was it wrapped in leaves, layered like a casserole, fried, or served in a bowl?',
    'Do you remember the main texture: soft masa, sweet plantain, crispy edges, broth, or something else?',
    'Was it tied to a holiday, a specific relative, or a place your family came from?',
  ];

  return {
    rawMemory: input.memoryText,
    normalizedMemory: normalized,
    userLocation: input.userLocation,
    extractedClues: {
      possibleDishNames: extractPossibleNames(normalized),
      culturalOrRegionalHints,
      rememberedIngredients,
      sensoryClues,
      occasions,
    },
    missingInformation: ['exact spelling', 'region or town', 'cooking method', 'core ingredients', 'serving occasion'],
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
