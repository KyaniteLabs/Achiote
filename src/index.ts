#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolveDishName } from './lib/name-resolver.js';
import { findSubstitutes } from './lib/substitution-engine.js';
import { ResearchCache } from './lib/research-cache.js';
import sensoryProfilesData from './data/sensory-profiles.json' with { type: 'json' };
import regionalData from './data/regional-availability.json' with { type: 'json' };
import dishFamiliesData from './data/dish-families.json' with { type: 'json' };
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

let cache: ResearchCache | null = null;

const server = new McpServer({
  name: 'member-berries',
  version: '0.1.0',
});

// Tool 1: resolve_dish_name
server.tool(
  'resolve_dish_name',
  'Resolve a dish name to its canonical form, aliases, transliterations, and dish family. Handles fuzzy matching, transliterations, and regional variant names.',
  { input: z.string().describe('The dish name as the user described it (any spelling, language, or transliteration)') },
  async ({ input }) => {
    try {
      const result = resolveDishName(input);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: String(error) }) }],
        isError: true,
      };
    }
  }
);

// Tool 2: analyze_nostalgic_dish
server.tool(
  'analyze_nostalgic_dish',
  'Decompose a nostalgic dish memory into sensory elements: aroma, texture, flavor, visual, temperature. Identifies nostalgia-critical elements.',
  {
    description: z.string().describe("The user's memory/description of the dish"),
    region: z.string().optional().describe("Cultural/geographic region of the dish"),
  },
  async ({ description, region }) => {
    try {
      const resolvedRegion = region ?? 'unknown';

      // Build structured response with sensory dimension definitions
      const result: Record<string, unknown> = {
        description,
        region: resolvedRegion,
        sensoryDimensions: sensoryProfilesData.dimensions,
        nostalgiaCriticalCriteria: sensoryProfilesData.nostalgiaCriticalCriteria,
      };

      // Check cache for existing research
      if (cache) {
        const cached = cache.get('all', resolvedRegion);
        if (cached) {
          result.cachedResearch = {
            researchData: cached.researchData,
            createdAt: cached.createdAt,
            hitCount: cached.hitCount,
          };
        }
      }

      result.promptForAgent = `Analyze this nostalgic dish memory into five sensory dimensions. For each dimension, score 1-10 and determine if it is nostalgia-critical.

Dish memory: "${description}"
Region: ${resolvedRegion}

Dimensions: aroma, texture, flavor, visual, temperature

Sensory dimension definitions and scoring criteria have been provided as structured data above.

For each:
1. Score intensity (1-10)
2. Describe what you detect from the memory
3. Mark as nostalgia-critical if this element is essential to the emotional trigger

Then identify the TOP 3 nostalgia-critical elements and explain WHY each triggers nostalgia.`;

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: String(error) }) }],
        isError: true,
      };
    }
  }
);

// Tool 3: find_sensory_substitutes
server.tool(
  'find_sensory_substitutes',
  'Find chemistry-aware ingredient substitutions based on volatile compounds and sensory contribution.',
  {
    ingredient: z.string().describe('The original ingredient to substitute'),
    location: z.string().describe("User's location for availability check"),
  },
  async ({ ingredient, location }) => {
    try {
      const result: Record<string, unknown> = {
        ingredient,
        location,
      };

      // Run compound-matched substitution engine
      const substitutes = findSubstitutes(ingredient);

      if (substitutes.length > 0) {
        result.substitutes = substitutes;
        result.mode = 'compound-matched';
      } else {
        result.mode = 'prompt-only';
        result.note = `Ingredient "${ingredient}" not found in compound database. Falling back to AI-driven analysis.`;
      }

      // Check regional availability data for location match
      const matchedRegion = findMatchingRegion(location);
      if (matchedRegion) {
        result.regionalAvailability = {
          region: matchedRegion.key,
          ethnicCorridors: matchedRegion.data.majorEthnicCorridors,
          majorStores: matchedRegion.data.majorStores,
        };
      }

      result.promptForAgent = `Find a chemistry-aware substitution for "${ingredient}" available near ${location}.

${substitutes.length > 0
  ? `Compound-matched substitutes have been provided as structured data above. Use these as the primary recommendations and supplement with any additional knowledge.`
  : `The ingredient was not found in the compound database. Use your knowledge to:
1. Identify its key flavor compounds and sensory contribution
2. Find ingredients with matching or overlapping flavor profiles
3. Check which are available at the user's location
4. Present the best substitution with confidence (High/Medium/Low) and what will be similar vs different`}

${matchedRegion ? `Regional store data has been provided above for ${matchedRegion.key}.` : 'No specific regional store data available for this location.'}`;

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: String(error) }) }],
        isError: true,
      };
    }
  }
);

// Tool 4: source_ingredients
server.tool(
  'source_ingredients',
  'Find where to buy specific ingredients near the user. Searches local stores, ethnic markets, and online sources.',
  {
    ingredients: z.array(z.string()).describe('List of ingredients to source'),
    location: z.string().describe("User's city/region"),
  },
  async ({ ingredients, location }) => {
    try {
      const result: Record<string, unknown> = {
        ingredients,
        location,
      };

      // Match location against regional data
      const matchedRegion = findMatchingRegion(location);
      if (matchedRegion) {
        result.regionalData = {
          region: matchedRegion.key,
          ethnicCorridors: matchedRegion.data.majorEthnicCorridors,
          majorStores: matchedRegion.data.majorStores,
        };
      }

      result.promptForAgent = `Find where to buy these ingredients near ${location}:

${ingredients.map((i: string, idx: number) => `${idx + 1}. ${i}`).join('\n')}

${matchedRegion
  ? `Regional data has been provided above with known ethnic corridors and stores in the ${matchedRegion.key} area. Use these as starting points.`
  : 'No specific regional data available for this location.'}

For each ingredient:
1. Search for local ethnic markets that carry it
2. Search for mainstream grocery stores that stock it
3. Find online sources with pricing
4. Note any seasonal availability

Format as a sourcing guide the user can act on immediately.`;

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: String(error) }) }],
        isError: true,
      };
    }
  }
);

// Tool 5: discover_regional_similars
server.tool(
  'discover_regional_similars',
  'Find similar dishes from neighboring regions and cultures with shared and divergent elements.',
  {
    dishName: z.string().describe('The dish to find similars for'),
    region: z.string().describe("The dish's cultural region"),
  },
  async ({ dishName, region }) => {
    try {
      const resolution = resolveDishName(dishName);
      const resolvedFamily = resolution.canonicalName;

      const result: Record<string, unknown> = {
        dishName,
        region,
        resolvedFamily,
        knownAliases: resolution.aliases,
      };

      // Look up the family in dish-families data for shared/divergent elements
      const familyEntry = dishFamiliesData.families.find(
        (f) => f.canonicalName === resolvedFamily
      );

      if (familyEntry) {
        result.familyData = {
          sharedElements: familyEntry.sharedElements,
          divergentElements: familyEntry.divergentElements,
          nostalgiaTriggers: familyEntry.nostalgiaTriggers,
          regions: familyEntry.regions,
        };
      }

      // Check cache for existing regional research
      if (cache) {
        const cached = cache.get(resolvedFamily, region);
        if (cached) {
          result.cachedResearch = {
            researchData: cached.researchData,
            createdAt: cached.createdAt,
            hitCount: cached.hitCount,
          };
        }
      }

      result.promptForAgent = `Find dishes similar to "${dishName}" (${resolvedFamily} family) from cultures neighboring ${region}.

Known aliases in this family: ${resolution.aliases.join(', ')}
${familyEntry ? `
Shared elements across this family: ${familyEntry.sharedElements.join(', ')}
Key divergent elements: ${familyEntry.divergentElements.join(', ')}
Nostalgia triggers: ${familyEntry.nostalgiaTriggers.join(', ')}
Known regions: ${familyEntry.regions.join(', ')}
` : ''}
For each similar dish:
1. Name and culture of origin
2. Shared sensory elements with the original
3. Key differences (ingredients, technique, flavor)
4. Nostalgia overlap rating (High/Medium/Low)`;

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: String(error) }) }],
        isError: true,
      };
    }
  }
);

// Tool 6: generate_recipe
server.tool(
  'generate_recipe',
  'Generate a complete adapted recipe with sensory analysis, sourcing notes, and confidence levels.',
  {
    dishDescription: z.string().describe("The user's original dish description"),
    location: z.string().describe("User's location"),
    sensoryAnalysis: z.string().describe('The completed sensory analysis from analyze_nostalgic_dish'),
    substitutions: z.string().describe('The completed substitutions from find_sensory_substitutes'),
    sourcing: z.string().describe('The completed sourcing guide from source_ingredients'),
  },
  async ({ dishDescription, location, sensoryAnalysis, substitutions, sourcing }) => {
    try {
      const result: Record<string, unknown> = {
        dishDescription,
        location,
        expectedOutputSchema: {
          title: 'string - Recipe name (e.g., "Recreated [Dish Name]")',
          yield: 'string - Number of servings',
          prepTime: 'string - Preparation time',
          cookTime: 'string - Cooking time',
          ingredients: 'Array of { item: string, amount: string, notes?: string }',
          steps: 'Array of step-by-step instruction strings',
          sensoryAnalysis: 'string - Summary of sensory recreation strategy',
          confidencePerElement: 'Record<string, "High" | "Medium" | "Low"> - Confidence per key sensory element',
          whatsDifferent: 'string - Honest assessment of what will differ and why',
        },
        promptForAgent: `Generate the complete reverse-engineered recipe.

Original dish memory: "${dishDescription}"
Location: ${location}

Sensory analysis:
${sensoryAnalysis}

Ingredient substitutions:
${substitutions}

Sourcing guide:
${sourcing}

Generate a recipe with:
1. Title (e.g., "Recreated [Dish Name]")
2. Yield, prep time, cook time
3. Full ingredient list with measurements
4. Step-by-step instructions
5. Sensory analysis summary
6. Confidence level per key sensory element (High/Medium/Low)
7. What will be different and why

Then self-critique: Does this recipe recreate the target sensory experience? If not, suggest adjustments.`,
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: String(error) }) }],
        isError: true,
      };
    }
  }
);

/**
 * Match a user-provided location string against the regional availability data.
 * Checks both region keys and city names for a case-insensitive match.
 */
function findMatchingRegion(location: string): { key: string; data: { cities: string[]; majorEthnicCorridors: { name: string; city: string; cuisines: string[] }[]; majorStores: Record<string, string[]> } } | null {
  const normalized = location.toLowerCase().trim();

  for (const [key, data] of Object.entries(regionalData.regions)) {
    // Check region key match
    if (normalized.includes(key.replace(/-/g, ' ')) || key.replace(/-/g, ' ').includes(normalized)) {
      return { key, data };
    }

    // Check city name match
    for (const city of data.cities) {
      if (normalized.includes(city.toLowerCase()) || city.toLowerCase().includes(normalized)) {
        return { key, data };
      }
    }
  }

  return null;
}

async function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const dataDir = path.join(__dirname, '..', 'data');

  // Ensure the data directory exists for the SQLite database
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, 'culture-cache.db');
  cache = new ResearchCache(dbPath);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
