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
  ingredient: string;
  localStores: { name: string; address?: string; notes?: string }[];
  onlineSources: { retailer: string; url?: string; price?: string }[];
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

export interface CollectedFoodMemory {
  rawMemory: string;
  normalizedMemory: string;
  userLocation?: string;
  extractedClues: {
    possibleDishNames: string[];
    culturalOrRegionalHints: string[];
    rememberedIngredients: string[];
    sensoryClues: string[];
    occasions: string[];
  };
  missingInformation: string[];
  nextQuestions: string[];
  reassurance: string;
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
