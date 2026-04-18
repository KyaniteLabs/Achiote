#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolveDishName } from './lib/name-resolver.js';

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
    const result = resolveDishName(input);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
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
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          description,
          region: region ?? 'unknown',
          promptForAgent: `Analyze this nostalgic dish memory into five sensory dimensions. For each dimension, score 1-10 and determine if it is nostalgia-critical.

Dish memory: "${description}"
Region: ${region ?? 'unknown'}

Dimensions: aroma, texture, flavor, visual, temperature

For each:
1. Score intensity (1-10)
2. Describe what you detect from the memory
3. Mark as nostalgia-critical if this element is essential to the emotional trigger

Then identify the TOP 3 nostalgia-critical elements and explain WHY each triggers nostalgia.`,
        }, null, 2),
      }],
    };
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
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          ingredient,
          location,
          promptForAgent: `Find a chemistry-aware substitution for "${ingredient}" available near ${location}.

Steps:
1. Look up the ingredient in the compound database (use ingredients.json data)
2. Identify its key volatile compounds and sensory contribution
3. Find ingredients with matching or overlapping compounds
4. Check which are available at the user's location
5. Present the best substitution with compound match %, confidence (High/Medium/Low), and what will be similar vs different`,
        }, null, 2),
      }],
    };
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
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          ingredients,
          location,
          promptForAgent: `Find where to buy these ingredients near ${location}:

${ingredients.map((i: string, idx: number) => `${idx + 1}. ${i}`).join('\n')}

For each ingredient:
1. Search for local ethnic markets that carry it
2. Search for mainstream grocery stores that stock it
3. Find online sources with pricing
4. Note any seasonal availability

Format as a sourcing guide the user can act on immediately.`,
        }, null, 2),
      }],
    };
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
    const resolution = resolveDishName(dishName);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          dishName,
          region,
          resolvedFamily: resolution.canonicalName,
          knownAliases: resolution.aliases,
          promptForAgent: `Find dishes similar to "${dishName}" (${resolution.canonicalName} family) from cultures neighboring ${region}.

Known aliases in this family: ${resolution.aliases.join(', ')}

For each similar dish:
1. Name and culture of origin
2. Shared sensory elements with the original
3. Key differences (ingredients, technique, flavor)
4. Nostalgia overlap rating (High/Medium/Low)`,
        }, null, 2),
      }],
    };
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
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          dishDescription,
          location,
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
        }, null, 2),
      }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
