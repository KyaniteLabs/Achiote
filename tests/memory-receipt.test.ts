import { describe, expect, it } from 'vitest';
import { buildMemoryReceipt, formatMemoryReceiptMarkdown } from '../src/lib/memory-receipt.js';

describe('memory receipt', () => {
  it('renders a portable evidence-bounded receipt', () => {
    const receipt = buildMemoryReceipt({
      memory: {
        rawMemory: 'My abuela made something sour and herby.',
        normalizedMemory: 'My abuela made something sour and herby.',
        extractedClues: {
          possibleDishNames: [],
          culturalOrRegionalHints: [],
          rememberedIngredients: [],
          sensoryClues: ['sour/tangy'],
          occasions: ['grandmother/family context'],
        },
        inferredContext: {
          culturalOrRegional: [{
            label: 'Spanish-speaking family context',
            basis: 'User used the family word "abuela".',
            confidence: 'Low',
            evidenceKind: 'model_inferred',
            canSeedQuestions: true,
            canSeedCandidateDishes: false,
          }],
          language: [],
        },
        missingInformation: ['country, island, region, town, or community'],
        nextQuestions: ['Where was your abuela from?'],
        reassurance: "You don't need to spell it correctly or know the original language; sound-alikes and tiny clues are enough to start.",
      },
      researchPlan: {
        researchRequired: true,
        hypotheses: [{
          name: 'Unidentified traditional dish',
          whyPossible: ['You mentioned: sour/tangy; grandmother/family context'],
          whatWouldConfirm: ['exact dish name or local nickname'],
          confidence: 'Low',
          researchRequired: true,
        }],
        searchQueries: [],
        preferredSourceTypes: ['family/community recipe sources'],
        factsToVerify: ['region'],
        questionsForUser: ['Where was your abuela from?'],
      },
      assistantText: 'Before I give you a tasting cue, I need one or two details.',
      createdAt: '2026-04-27T12:00:00.000Z',
    });

    expect(receipt.title).toBe('Achiote Memory Receipt');
    expect(receipt.evidence.userSaid).toEqual(['My abuela made something sour and herby.']);
    expect(receipt.evidence.inferred[0]).toContain('Spanish-speaking family context');
    expect(receipt.status).toBe('needs_more_clues');
    expect(receipt.nextBestQuestions).toContain('Where was your abuela from?');

    const markdown = formatMemoryReceiptMarkdown(receipt);
    expect(markdown).toContain('# Achiote Memory Receipt');
    expect(markdown).toContain('## User-Said Evidence');
    expect(markdown).toContain('## Inferred Context');
    expect(markdown).toContain('## Unknowns');
    expect(markdown).toContain('## Family Questions');
    expect(markdown).not.toContain('undefined');
  });

  it('keeps allergy-constrained terms out of receipt questions and research sections', () => {
    const receipt = buildMemoryReceipt({
      memory: {
        rawMemory: 'I am allergic to peanuts. I remember a sauce.',
        normalizedMemory: 'I am allergic to peanuts. I remember a sauce.',
        extractedClues: {
          possibleDishNames: [],
          culturalOrRegionalHints: [],
          rememberedIngredients: ['peanuts'],
          sensoryClues: ['sauce/gravy'],
          occasions: [],
        },
        inferredContext: {
          culturalOrRegional: [],
          language: [],
        },
        missingInformation: ['core ingredients'],
        nextQuestions: ['How were the peanuts served?', 'Where did you eat this?'],
        reassurance: "You don't need to spell it correctly or know the original language; sound-alikes and tiny clues are enough to start.",
      },
      researchPlan: {
        researchRequired: true,
        hypotheses: [{
          name: 'Peanut chikki',
          whyPossible: ['peanuts set in jaggery'],
          whatWouldConfirm: ['peanuts set in jaggery', 'hard brittle texture'],
          confidence: 'Low',
          researchRequired: true,
        }],
        searchQueries: [],
        preferredSourceTypes: ['family/community recipe sources'],
        factsToVerify: ['peanut texture'],
        questionsForUser: ['Was it peanuts set in jaggery?', 'Where did you eat this?'],
      },
      assistantText: 'Food boundaries: nut allergy.',
      researchedFacts: ['Dish resolved: "Peanut chikki"'],
      createdAt: '2026-04-27T12:00:00.000Z',
    });

    expect(receipt.nextBestQuestions).toEqual(['Where did you eat this?']);
    expect(receipt.hypotheses).toEqual([]);
    expect(receipt.evidence.researched).toEqual([]);
    expect(receipt.evidence.unknown.join(' ')).not.toMatch(/\bpeanuts?\b/i);
  });

  it('surfaces negated clues as ruled-out receipt evidence', () => {
    const receipt = buildMemoryReceipt({
      memory: {
        rawMemory: 'something like goyura in panama. savory, thick cut fried, not potatoes, sweet syrup on top.',
        normalizedMemory: 'something like goyura in panama. savory, thick cut fried, not potatoes, sweet syrup on top.',
        extractedClues: {
          possibleDishNames: ['goyura'],
          culturalOrRegionalHints: ['Panamanian'],
          rememberedIngredients: [],
          sensoryClues: ['savory', 'thick cut fried', 'sweet syrup on top'],
          occasions: [],
        },
        inferredContext: {
          culturalOrRegional: [],
          language: [],
        },
        missingInformation: ['exact dish family'],
        nextQuestions: ['Where in Panama did you have it?'],
        reassurance: "You don't need to spell it correctly or know the original language; sound-alikes and tiny clues are enough to start.",
      },
      createdAt: '2026-04-27T12:00:00.000Z',
    });

    expect(receipt.evidence.userSaid).toContain('Ruled out: potatoes');
    expect(formatMemoryReceiptMarkdown(receipt)).toContain('Ruled out: potatoes');
  });

  it('lists only empty extracted clue fields as unknowns', () => {
    const receipt = buildMemoryReceipt({
      memory: {
        rawMemory: 'my mom made arepas con queso, my family is from Venezuela.',
        normalizedMemory: 'my mom made arepas con queso, my family is from Venezuela.',
        extractedClues: {
          possibleDishNames: ['arepas con queso'],
          culturalOrRegionalHints: ['Venezuela'],
          rememberedIngredients: ['cheese', 'corn'],
          sensoryClues: ['toasted corn aroma'],
          occasions: ['mother/family context'],
        },
        inferredContext: {
          culturalOrRegional: [],
          language: [],
        },
        missingInformation: [
          'cooking method or serving format',
          'core ingredients',
          'taste, texture, aroma, sauce, or heat level',
        ],
        nextQuestions: [],
        reassurance: "You don't need to spell it correctly or know the original language; sound-alikes and tiny clues are enough to start.",
      },
      researchPlan: {
        researchRequired: true,
        hypotheses: [],
        searchQueries: [],
        preferredSourceTypes: [],
        factsToVerify: [
          'base ingredient, beverage base, or starch',
          'cooking, extraction, mixing, or serving method',
          'sensory cues: aroma, texture, flavor, appearance, temperature, or dilution',
        ],
        questionsForUser: [],
      },
      createdAt: '2026-04-27T12:00:00.000Z',
    });

    expect(receipt.evidence.unknown).toEqual([]);
  });
});
