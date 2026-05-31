import { z } from 'zod';

const shortText = z.preprocess(
  (value) => value === null || value === undefined ? '' : value,
  z.string().trim().max(240),
);

const textArray = z.array(z.string().trim().min(1).max(160)).max(12);

export const foodMemoryModelExtractionSchema = z.object({
  possibleDishNames: textArray,
  originRegion: shortText,
  residenceLocation: shortText,
  ingredients: textArray,
  ruledOutIngredients: textArray,
  cookingMethod: textArray,
  sensoryCues: textArray,
  occasion: textArray,
  language: shortText,
}).strict();

export const foodMemoryModelExtractionJsonSchema = {
  type: 'object' as const,
  additionalProperties: false,
  required: [
    'possibleDishNames',
    'originRegion',
    'residenceLocation',
    'ingredients',
    'ruledOutIngredients',
    'cookingMethod',
    'sensoryCues',
    'occasion',
    'language',
  ],
  properties: {
    possibleDishNames: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'Dish names, rough sound-alikes, or user-described dish labels. Empty array if none.',
    },
    originRegion: {
      type: 'string' as const,
      description: 'User-stated origin country, region, town, island, or community. Empty string if unknown.',
    },
    residenceLocation: {
      type: 'string' as const,
      description: 'User current location only if explicitly stated. Empty string if unknown.',
    },
    ingredients: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'Ingredients the user is trying to remember. Exclude allergy, reaction, intolerance, and negated terms.',
    },
    ruledOutIngredients: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'Ingredients ruled out by allergy, reaction, intolerance, or not/without wording.',
    },
    cookingMethod: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'Cooking method, serving format, or preparation clue such as fried, steamed, wrapped, rice dish, or griddled.',
    },
    sensoryCues: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'Taste, aroma, texture, appearance, temperature, sauce, or flavor clues.',
    },
    occasion: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'Person, place, holiday, ritual, meal, or social context clues.',
    },
    language: {
      type: 'string' as const,
      description: 'Language or dialect clue only if explicitly indicated. Empty string if unknown.',
    },
  },
};
