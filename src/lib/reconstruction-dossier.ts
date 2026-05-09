import type { CollectedFoodMemory, Confidence, DishResearchPlan, ReconstructionDossier } from './types.js';
import { generateFamilyFollowupQuestions } from './family-followup-generator.js';

export function buildReconstructionDossier(input: {
  memory: CollectedFoodMemory;
  researchPlan: DishResearchPlan;
  researchedFacts?: string[];
  inferredFacts?: string[];
}): ReconstructionDossier {
  const researched = input.researchedFacts ?? [];
  const inferred = input.inferredFacts ?? [];
  const dedupedResearched = [...new Set(researched)];
  const confidence: Confidence = dedupedResearched.length >= 2 ? 'Medium' : 'Low';

  const sensoryClues = input.memory.extractedClues?.sensoryClues ?? [];
  const ingredients = input.memory.extractedClues?.rememberedIngredients ?? [];
  const occasions = input.memory.extractedClues?.occasions ?? [];
  const nostalgiaCriticalElements = deriveNostalgiaCriticalElements(sensoryClues, ingredients, occasions, dedupedResearched);

  return {
    title: 'Food Memory Reconstruction Dossier',
    evidenceLedger: {
      userSaid: [input.memory.rawMemory],
      researched,
      inferred,
      unknown: ['exact dish identity', 'family-specific version', 'must-preserve sensory trigger ranking'],
    },
    hypotheses: input.researchPlan.hypotheses,
    nostalgiaCriticalElements,
    recreationStrategy: [
      'Do not finalize a recipe until the top hypothesis is confirmed or explicitly marked as a best-effort reconstruction.',
      'Preserve the strongest sensory cues before optimizing for exact ingredient names.',
      'Offer substitutions only with a clear note about what changes and what is preserved.',
      'After the minimum viable nostalgia cue, help the user find ingredients near where they live now using the source_ingredients and find_sensory_substitutes tools.',
    ],
    whatToAskFamily: generateFamilyFollowupQuestions({ memory: input.memory, researchPlan: input.researchPlan }).questions,
    confidence,
  };
}

function deriveNostalgiaCriticalElements(
  sensoryClues: string[],
  ingredients: string[],
  occasions: string[],
  researchedFacts: string[],
): string[] {
  const elements: string[] = [];

  if (sensoryClues.length > 0) {
    elements.push(`sensory trigger: ${sensoryClues.slice(0, 2).join(' + ')}`);
  }
  if (ingredients.length > 0) {
    elements.push(`flavor profile from ${ingredients.slice(0, 3).join(', ')}`);
  }
  if (occasions.length > 0) {
    const occasion = occasions.find((o) => /grandmother|grandfather|family|mother|father/i.test(o)) ?? occasions[0];
    elements.push(`${occasion} context and ritual`);
  }
  if (researchedFacts.length > 0) {
    const firstFact = researchedFacts[0].length > 80 ? researchedFacts[0].slice(0, 77) + '...' : researchedFacts[0];
    elements.push(`researched anchor: ${firstFact}`);
  }

  if (elements.length < 2) {
    if (!elements.some((e) => /sensory|aroma|texture/i.test(e))) {
      elements.push('aroma tied to cooking method');
    }
    if (!elements.some((e) => /texture/i.test(e))) {
      elements.push('texture of the base');
    }
  }

  return elements.slice(0, 5);
}
