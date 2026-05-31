import { z } from 'zod';

export const confidenceSchema = z.enum(['High', 'Medium', 'Low']);

const dishNameMatchTypeSchema = z.enum(['exact', 'variant', 'transliteration', 'fuzzy', 'ambiguous', 'unknown']);

const dishNameCandidateSchema = z.object({
  canonicalName: z.string(),
  dishFamily: z.string(),
  region: z.string(),
  confidence: confidenceSchema,
  score: z.number(),
  matchType: dishNameMatchTypeSchema,
  matchedName: z.string(),
  variantName: z.string().optional(),
  distinguishingElements: z.array(z.string()).optional(),
  clarificationPrompt: z.string().optional(),
});

export const dishNameResolutionSchema = z.object({
  input: z.string(),
  canonicalName: z.string(),
  aliases: z.array(z.string()),
  transliterations: z.array(z.string()),
  dishFamily: z.string(),
  region: z.string(),
  confidence: confidenceSchema,
  matchType: dishNameMatchTypeSchema.optional(),
  score: z.number().optional(),
  needsClarification: z.boolean().optional(),
  candidates: z.array(dishNameCandidateSchema).optional(),
  clarificationPrompt: z.string().optional(),
});

const cachedResearchSchema = z.object({
  researchData: z.string(),
  createdAt: z.string(),
  hitCount: z.number(),
});

const referenceResearchSchema = cachedResearchSchema.extend({
  source: z.enum(['cache', 'bundled']),
  dishFamily: z.string(),
  region: z.string(),
});

const regionalContextSchema = z.object({
  region: z.string(),
  ethnicCorridors: z.array(
    z.object({
      name: z.string(),
      city: z.string(),
      cuisines: z.array(z.string()),
    }),
  ),
  majorStores: z.record(z.string(), z.array(z.string())),
});

const substitutionResultSchema = z.object({
  original: z.string(),
  substitute: z.string(),
  compoundMatch: z.number(),
  confidence: confidenceSchema,
  reasoning: z.string(),
  availableAt: z.string(),
});

export const analyzeNostalgicDishOutputSchema = z.object({
  description: z.string(),
  region: z.string(),
  sensoryDimensions: z.record(z.string(), z.unknown()),
  nostalgiaCriticalCriteria: z.string(),
  cachedResearch: cachedResearchSchema.optional(),
  referenceResearch: referenceResearchSchema.optional(),
  promptForAgent: z.string(),
});

export const findSensorySubstitutesOutputSchema = z.object({
  ingredient: z.string(),
  location: z.string(),
  substitutes: z.array(substitutionResultSchema).optional(),
  mode: z.enum(['compound-matched', 'prompt-only']),
  note: z.string().optional(),
  regionalAvailability: regionalContextSchema.optional(),
  promptForAgent: z.string(),
});

export const sourceIngredientsOutputSchema = z.object({
  ingredients: z.array(z.string()),
  location: z.string(),
  regionalData: regionalContextSchema.optional(),
  promptForAgent: z.string(),
});

const familyDataSchema = z.object({
  sharedElements: z.array(z.string()),
  divergentElements: z.array(z.string()),
  nostalgiaTriggers: z.array(z.string()),
  regions: z.array(z.string()),
});

export const discoverRegionalSimilarsOutputSchema = z.object({
  dishName: z.string(),
  region: z.string(),
  resolvedFamily: z.string(),
  knownAliases: z.array(z.string()),
  familyData: familyDataSchema.optional(),
  cachedResearch: cachedResearchSchema.optional(),
  referenceResearch: referenceResearchSchema.optional(),
  promptForAgent: z.string(),
});

export const RECIPE_OUTPUT_FIELDS: Record<string, string> = {
  title: 'string - Recipe name (e.g., "Recreated [Dish Name]")',
  yield: 'string - Number of servings',
  prepTime: 'string - Preparation time',
  cookTime: 'string - Cooking time',
  ingredients: 'Array of { item: string, amount: string, notes?: string }',
  steps: 'Array of step-by-step instruction strings',
  sensoryAnalysis: 'string - Summary of sensory recreation strategy',
  confidencePerElement: 'Record<string, "High" | "Medium" | "Low"> - Confidence per key sensory element',
  whatsDifferent: 'string - Honest assessment of what will differ and why',
};

const recipeIngredientOutputSchema = z.object({
  item: z.string().min(1),
  amount: z.string().min(1),
  notes: z.string().optional(),
});

export const recipeOutputSchema = z.object({
  title: z.string().min(1),
  yield: z.string().min(1),
  prepTime: z.string().min(1),
  cookTime: z.string().min(1),
  ingredients: z.array(recipeIngredientOutputSchema).min(1),
  steps: z.array(z.string().min(1)).min(1),
  sensoryAnalysis: z.string().min(1),
  confidencePerElement: z.record(z.string(), confidenceSchema),
  whatsDifferent: z.string().min(1),
});

export const recipeValidationOutputSchema = z.object({
  valid: z.boolean(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })),
});

export const generateRecipeOutputSchema = z.object({
  dishDescription: z.string(),
  location: z.string(),
  expectedOutputSchema: z.record(z.string(), z.string()),
  promptForAgent: z.string(),
});

const inferredContextClueSchema = z.object({
  label: z.string(),
  basis: z.string(),
  confidence: confidenceSchema,
  evidenceKind: z.literal('model_inferred'),
  canSeedQuestions: z.boolean(),
  canSeedCandidateDishes: z.boolean(),
});

const inferredMemoryContextSchema = z.object({
  culturalOrRegional: z.array(inferredContextClueSchema),
  language: z.array(inferredContextClueSchema),
});

export const collectedFoodMemorySchema = z.object({
  rawMemory: z.string(),
  normalizedMemory: z.string(),
  userLocation: z.string().optional(),
  extractedClues: z.object({
    possibleDishNames: z.array(z.string()),
    culturalOrRegionalHints: z.array(z.string()),
    rememberedIngredients: z.array(z.string()),
    sensoryClues: z.array(z.string()),
    occasions: z.array(z.string()),
  }),
  inferredContext: inferredMemoryContextSchema,
  missingInformation: z.array(z.string()),
  nextQuestions: z.array(z.string()),
  reassurance: z.string(),
});

const dishHypothesisSchema = z.object({
  name: z.string(),
  whyPossible: z.array(z.string()),
  whatWouldConfirm: z.array(z.string()),
  confidence: confidenceSchema,
  researchRequired: z.boolean(),
});

export const dishResearchPlanSchema = z.object({
  researchRequired: z.boolean(),
  hypotheses: z.array(dishHypothesisSchema),
  searchQueries: z.array(z.string()),
  preferredSourceTypes: z.array(z.string()),
  factsToVerify: z.array(z.string()),
  questionsForUser: z.array(z.string()),
  researchedFacts: z.array(z.string()).optional().describe('Source-backed facts from web search about this dish'),
});

export const collectFoodMemoryOutputSchema = collectedFoodMemorySchema;
export const planDishResearchOutputSchema = dishResearchPlanSchema;
export const buildReconstructionDossierOutputSchema = z.object({
  title: z.string(),
  evidenceLedger: z.object({
    userSaid: z.array(z.string()),
    researched: z.array(z.string()),
    inferred: z.array(z.string()),
    unknown: z.array(z.string()),
  }),
  hypotheses: z.array(dishHypothesisSchema),
  nostalgiaCriticalElements: z.array(z.string()),
  recreationStrategy: z.array(z.string()),
  whatToAskFamily: z.array(z.string()),
  confidence: confidenceSchema,
});
export const generateFamilyFollowupQuestionsOutputSchema = z.object({
  questions: z.array(z.string()),
  toneGuidance: z.string(),
});

export const memoryReceiptOutputSchema = z.object({
  title: z.literal('Achiote Memory Receipt'),
  createdAt: z.string(),
  status: z.enum(['needs_more_clues', 'first_test_ready', 'recipe_handoff_ready']),
  evidence: z.object({
    userSaid: z.array(z.string()),
    inferred: z.array(z.string()),
    researched: z.array(z.string()),
    unknown: z.array(z.string()),
  }),
  hypotheses: z.array(dishHypothesisSchema),
  nextBestQuestions: z.array(z.string()),
  firstTinyTasteTest: z.object({
    title: z.string(),
    cue: z.string(),
    estimatedTime: z.string(),
  }).optional(),
  assistantSummary: z.string(),
});


const sourceReferenceSchema = z.object({
  title: z.string(),
  url: z.string(),
  sourceType: z.enum(['recipe', 'video', 'article', 'book', 'oral_history', 'market', 'other']),
  accessedAt: z.string(),
  reliability: confidenceSchema,
  author: z.string().optional(),
  quotedFacts: z.array(z.string()),
});

const extractedCulinaryFactsSchema = z.object({
  namesAndAliases: z.array(z.string()),
  regions: z.array(z.string()),
  ingredients: z.array(z.string()),
  techniques: z.array(z.string()),
  sensoryDescriptors: z.array(z.string()),
  culturalOccasions: z.array(z.string()),
  regionalVariants: z.array(z.string()),
});

export const researchRecordInputSchema = z.object({
  dishName: z.string(),
  query: z.string(),
  sources: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      sourceType: z.enum(['recipe', 'video', 'article', 'book', 'oral_history', 'market', 'other']),
      accessedAt: z.string(),
      reliability: confidenceSchema,
      author: z.string().optional(),
      extractedFacts: z.array(z.string()),
    }),
  ),
});

export const researchRecordOutputSchema = z.object({
  dishName: z.string(),
  query: z.string(),
  sources: z.array(sourceReferenceSchema),
  extractedFacts: extractedCulinaryFactsSchema,
  uncertainty: z.array(z.string()),
  confidence: confidenceSchema,
  createdAt: z.string(),
});

export const researchValidationOutputSchema = z.object({
  issues: z.array(z.object({ path: z.string(), message: z.string() })),
});

export const researchFindingsOutputSchema = z.object({
  researchedFacts: z.array(z.string()),
  inferredFacts: z.array(z.string()),
  unknowns: z.array(z.string()),
  sourceCount: z.number(),
  confidence: confidenceSchema,
});


const minimumViableNostalgiaIngredientSchema = z.object({
  item: z.string(),
  amount: z.string(),
  purpose: z.string(),
  optional: z.boolean().optional(),
});

const cueComponentSchema = z.object({
  role: z.enum(['starch', 'protein', 'sauce', 'vegetable', 'broth', 'beverage', 'confectionery', 'overall']),
  criticalElement: z.string(),
  flavorProfile: z.string(),
  localTestWith: z.string(),
  substitutionReason: z.string(),
  confidence: confidenceSchema,
});

export const minimumViableNostalgiaInputSchema = z.object({
  dossier: buildReconstructionDossierOutputSchema,
  researchFindings: researchFindingsOutputSchema.optional(),
  userLocation: z.string().optional(),
  constraints: z.array(z.string()).optional(),
  maxEffortMinutes: z.number().optional(),
});

export const minimumViableNostalgiaOutputSchema = z.object({
  title: z.string(),
  goal: z.string(),
  effortMinutes: z.number(),
  format: z.enum(['aroma-cue', 'bite', 'sip', 'condiment', 'ritual']),
  ingredients: z.array(minimumViableNostalgiaIngredientSchema),
  steps: z.array(z.string()),
  preserves: z.array(z.string()),
  doesNotPreserve: z.array(z.string()),
  accessibilityPrinciples: z.array(z.string()),
  substituteLogic: z.array(z.string()),
  whyThisIsMinimum: z.string(),
  confidence: confidenceSchema,
  safetyNotes: z.array(z.string()),
  followUpIfItWorks: z.array(z.string()),
  components: z.array(cueComponentSchema),
});

export const webSearchOutputSchema = z.object({
  query: z.string(),
  searchStatus: z.enum(['ok', 'not_configured', 'error']),
  results: z.array(
    z.object({
      title: z.string(),
      link: z.string(),
      snippet: z.string(),
    }),
  ),
});

export const planToolWorkflowOutputSchema = z.object({
  detectedIntent: z.enum([
    'nostalgic_memory',
    'recipe_adaptation',
    'dietary_substitution',
    'ritual_ceremony',
    'multilingual_inquiry',
    'contradictory_memory',
    'unknown_dish',
    'general_food_inquiry',
  ]),
  workflowSteps: z.array(z.object({
    tool: z.string(),
    reason: z.string(),
    required: z.boolean(),
  })),
  maxSearchCalls: z.number(),
  needsSubstitutions: z.boolean(),
  needsSourcing: z.boolean().optional(),
  detectedRestrictions: z.array(z.string()),
  needsResolve: z.boolean(),
  confidenceNote: z.string(),
});

export const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
