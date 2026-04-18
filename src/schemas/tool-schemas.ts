import { z } from 'zod';

export const confidenceSchema = z.enum(['High', 'Medium', 'Low']);

export const dishNameResolutionSchema = z.object({
  input: z.string(),
  canonicalName: z.string(),
  aliases: z.array(z.string()),
  transliterations: z.array(z.string()),
  dishFamily: z.string(),
  region: z.string(),
  confidence: confidenceSchema,
});

const cachedResearchSchema = z.object({
  researchData: z.string(),
  createdAt: z.string(),
  hitCount: z.number(),
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
  promptForAgent: z.string(),
});

export const generateRecipeOutputSchema = z.object({
  dishDescription: z.string(),
  location: z.string(),
  expectedOutputSchema: z.record(z.string(), z.string()),
  promptForAgent: z.string(),
});

export const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
