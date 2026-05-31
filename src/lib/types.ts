export type SensoryDimension = 'aroma' | 'texture' | 'flavor' | 'visual' | 'temperature';

export type Confidence = 'High' | 'Medium' | 'Low';

export interface DishDescription {
  name: string;
  description: string;
  region?: string;
  location: string;
  culturalContext?: string;
  dietaryConstraints?: string[];
}

export interface SensoryElement {
  score: number;
  notes: string;
  isNostalgiaCritical: boolean;
}

export interface SensoryProfile {
  aroma: SensoryElement;
  texture: SensoryElement;
  flavor: SensoryElement;
  visual: SensoryElement;
  temperature: SensoryElement;
}

export interface IngredientCompound {
  ingredient: string;
  compounds: string[];
  sensoryContribution: { aroma: string; flavor: string };
  substitutionGroup: string;
}

export interface SubstitutionResult {
  original: string;
  substitute: string;
  compoundMatch: number;
  confidence: Confidence;
  reasoning: string;
  availableAt: string;
}

export interface RecipeIngredient {
  item: string;
  amount: string;
  notes?: string;
}

export interface RecipeOutput {
  title: string;
  yield: string;
  prepTime: string;
  cookTime: string;
  ingredients: RecipeIngredient[];
  steps: string[];
  sensoryAnalysis: string;
  confidencePerElement: Record<string, Confidence>;
  whatsDifferent: string;
}

export interface SourcingResult {
  ingredients: string[];
  location: string;
  regionalData?: {
    region: string;
    ethnicCorridors: { name: string; city: string; cuisines: string[] }[];
    majorStores: Record<string, string[]>;
  };
  promptForAgent: string;
}

export interface RegionalSimilar {
  dishName: string;
  culture: string;
  sharedElements: string[];
  divergentElements: string[];
  nostalgiaOverlap: Confidence;
}

export type DishNameMatchType = 'exact' | 'variant' | 'transliteration' | 'fuzzy' | 'ambiguous' | 'unknown';

export interface DishNameCandidate {
  canonicalName: string;
  dishFamily: string;
  region: string;
  confidence: Confidence;
  score: number;
  matchType: DishNameMatchType;
  matchedName: string;
  variantName?: string;
  distinguishingElements?: string[];
  clarificationPrompt?: string;
}

export interface DishNameResolution {
  input: string;
  canonicalName: string;
  aliases: string[];
  transliterations: string[];
  dishFamily: string;
  region: string;
  confidence: Confidence;
  matchType?: DishNameMatchType;
  score?: number;
  needsClarification?: boolean;
  candidates?: DishNameCandidate[];
  clarificationPrompt?: string;
}

export interface ResearchCacheEntry {
  dishFamily: string;
  region: string;
  researchData: string;
  createdAt: string;
  hitCount: number;
}


export interface FoodMemoryInput {
  memoryText: string;
  knownRegion?: string;
  knownLanguage?: string;
  userLocation?: string;
}

export interface ModelFoodMemoryExtraction {
  possibleDishNames: string[];
  originRegion: string;
  residenceLocation: string;
  ingredients: string[];
  ruledOutIngredients: string[];
  cookingMethod: string[];
  sensoryCues: string[];
  occasion: string[];
  language: string;
}

export type FoodMemoryModelExtractor = (input: FoodMemoryInput) => Promise<unknown>;

export type FoodMemoryExtractionSource = 'regex' | 'model' | 'regex_fallback';

export interface FoodMemoryExtractionMetadata {
  source: FoodMemoryExtractionSource;
  originRegion?: string;
  residenceLocation?: string;
  ruledOutIngredients: string[];
  cookingMethod: string[];
  language?: string;
  timeoutMs?: number;
  fallbackReason?: string;
}

export type EvidenceKind = 'user_said' | 'model_inferred' | 'source_researched' | 'unknown';

export interface InferredContextClue {
  label: string;
  basis: string;
  confidence: Confidence;
  evidenceKind: Extract<EvidenceKind, 'model_inferred'>;
  canSeedQuestions: boolean;
  canSeedCandidateDishes: boolean;
}

export interface InferredMemoryContext {
  culturalOrRegional: InferredContextClue[];
  language: InferredContextClue[];
}

export interface CollectedFoodMemory {
  rawMemory: string;
  normalizedMemory: string;
  userLocation?: string;
  extractedClues: {
    possibleDishNames: string[];
    culturalOrRegionalHints: string[];
    rememberedIngredients: string[];
    ruledOutIngredients?: string[];
    cookingMethods?: string[];
    sensoryClues: string[];
    occasions: string[];
  };
  inferredContext: InferredMemoryContext;
  missingInformation: string[];
  nextQuestions: string[];
  reassurance: string;
  extractionMetadata?: FoodMemoryExtractionMetadata;
}

export interface DishHypothesis {
  name: string;
  whyPossible: string[];
  whatWouldConfirm: string[];
  confidence: Confidence;
  researchRequired: boolean;
}

export interface DishResearchPlan {
  researchRequired: boolean;
  hypotheses: DishHypothesis[];
  searchQueries: string[];
  preferredSourceTypes: string[];
  factsToVerify: string[];
  questionsForUser: string[];
}

export interface ReconstructionDossier {
  title: string;
  evidenceLedger: {
    userSaid: string[];
    researched: string[];
    inferred: string[];
    unknown: string[];
  };
  hypotheses: DishHypothesis[];
  nostalgiaCriticalElements: string[];
  recreationStrategy: string[];
  whatToAskFamily: string[];
  confidence: Confidence;
}

export interface FamilyFollowupQuestions {
  questions: string[];
  toneGuidance: string;
}

export type MemoryReceiptStatus = 'needs_more_clues' | 'first_test_ready' | 'recipe_handoff_ready';

export interface MemoryReceipt {
  title: 'Achiote Memory Receipt';
  createdAt: string;
  status: MemoryReceiptStatus;
  evidence: {
    userSaid: string[];
    inferred: string[];
    researched: string[];
    unknown: string[];
  };
  hypotheses: DishHypothesis[];
  nextBestQuestions: string[];
  firstTinyTasteTest?: {
    title: string;
    cue: string;
    estimatedTime: string;
  };
  assistantSummary: string;
}


export type SourceType = 'recipe' | 'video' | 'article' | 'book' | 'oral_history' | 'market' | 'other';

export interface SourceReference {
  title: string;
  url: string;
  sourceType: SourceType;
  accessedAt: string;
  reliability: Confidence;
  author?: string;
  quotedFacts: string[];
}

export interface ExtractedCulinaryFacts {
  namesAndAliases: string[];
  regions: string[];
  ingredients: string[];
  techniques: string[];
  sensoryDescriptors: string[];
  culturalOccasions: string[];
  regionalVariants: string[];
}

export interface ResearchRecord {
  dishName: string;
  query: string;
  sources: SourceReference[];
  extractedFacts: ExtractedCulinaryFacts;
  uncertainty: string[];
  confidence: Confidence;
  createdAt: string;
}

export interface ResearchRecordInput {
  dishName: string;
  query: string;
  sources: Array<{
    title: string;
    url: string;
    sourceType: SourceType;
    accessedAt: string;
    reliability: Confidence;
    author?: string;
    extractedFacts: string[];
  }>;
}

export interface ResearchValidationIssue {
  path: string;
  message: string;
}

export interface ResearchFindingsForDossier {
  researchedFacts: string[];
  inferredFacts: string[];
  unknowns: string[];
  sourceCount: number;
  confidence: Confidence;
}


export interface MinimumViableNostalgiaInput {
  dossier: ReconstructionDossier;
  researchFindings?: ResearchFindingsForDossier;
  userLocation?: string;
  constraints?: string[];
  maxEffortMinutes?: number;
}

export type CueComponentRole = 'starch' | 'protein' | 'sauce' | 'vegetable' | 'broth' | 'beverage' | 'confectionery' | 'overall';

export interface CueComponent {
  role: CueComponentRole;
  criticalElement: string;
  flavorProfile: string;
  localTestWith: string;
  substitutionReason: string;
  confidence: Confidence;
}

export interface MinimumViableNostalgiaCue {
  title: string;
  goal: string;
  effortMinutes: number;
  format: 'aroma-cue' | 'bite' | 'sip' | 'condiment' | 'ritual';
  ingredients: Array<{ item: string; amount: string; purpose: string; optional?: boolean }>;
  steps: string[];
  preserves: string[];
  doesNotPreserve: string[];
  accessibilityPrinciples: string[];
  substituteLogic: string[];
  whyThisIsMinimum: string;
  confidence: Confidence;
  safetyNotes: string[];
  followUpIfItWorks: string[];
  components: CueComponent[];
}
