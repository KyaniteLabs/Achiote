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
