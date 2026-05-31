import type { CollectedFoodMemory, DishResearchPlan, MemoryReceipt, MinimumViableNostalgiaCue } from './types.js';
import { inferSafetyConstraints } from './ask-memory-correction.js';

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isRestrictedAnchorForConstraints(anchor: string, constraints: string[]): boolean {
  const lower = anchor.toLowerCase();
  return constraints.some((constraint) => {
    if (/nut allergy/.test(constraint)) return /\b(?:nuts?|nutty|peanuts?|tree nuts?|cashews?|almonds?|walnuts?|pecans?|pistachios?|hazelnuts?|macadamias?)\b/i.test(lower);
    if (/egg allergy/.test(constraint)) return /\b(?:eggs?|mayonnaise|mayo|meringue)\b/i.test(lower);
    if (/shellfish allergy/.test(constraint)) return /\b(?:shellfish|shrimp|prawns?|crab|lobster|oysters?|clams?|mussels?|scallops?)\b/i.test(lower);
    if (/fish allergy/.test(constraint)) return /\b(?:fish|seafood|anchov(?:y|ies)|sardines?|bonito|tuna|salmon|mackerel|fish sauce)\b/i.test(lower);
    if (/sesame allergy/.test(constraint)) return /\b(?:sesame|tahini|benne)\b/i.test(lower);
    if (/dairy-free/.test(constraint)) return /\b(?:milk|cream|butter|cheese|yogurt|dairy)\b/i.test(lower);
    if (/gluten-free/.test(constraint)) return /\b(?:wheat|gluten|barley|rye|bread|naan)\b/i.test(lower);
    if (/soy allergy/.test(constraint)) return /\bsoy\b/i.test(lower);
    if (/pork-free/.test(constraint)) return /\bpork\b/i.test(lower);
    return false;
  });
}

export function buildMemoryReceipt(input: {
  memory: CollectedFoodMemory;
  researchPlan?: DishResearchPlan;
  cue?: MinimumViableNostalgiaCue;
  assistantText?: string;
  createdAt?: string;
  researchedFacts?: string[];
}): MemoryReceipt {
  const safetyConstraints = inferSafetyConstraints([
    input.memory.rawMemory,
    input.assistantText ?? '',
  ].join('\n'));
  const filterSafetyBounded = (values: string[]): string[] =>
    safetyConstraints.length > 0
      ? values.filter((value) => !isRestrictedAnchorForConstraints(value, safetyConstraints))
      : values;
  const inferred = [
    ...input.memory.inferredContext.culturalOrRegional,
    ...input.memory.inferredContext.language,
  ].map((clue) => `${clue.label} (${clue.confidence} confidence): ${clue.basis}`);

  const unknown = unique([
    ...input.memory.missingInformation,
    ...(input.researchPlan?.factsToVerify ?? []),
  ]);
  const hypotheses = (input.researchPlan?.hypotheses ?? [])
    .filter((hypothesis) => !isRestrictedAnchorForConstraints(hypothesis.name, safetyConstraints))
    .map((hypothesis) => ({
      ...hypothesis,
      whyPossible: filterSafetyBounded(hypothesis.whyPossible),
      whatWouldConfirm: filterSafetyBounded(hypothesis.whatWouldConfirm),
    }));
  const nextBestQuestions = filterSafetyBounded(input.researchPlan?.questionsForUser.length
    ? input.researchPlan.questionsForUser
    : input.memory.nextQuestions).slice(0, 5);

  return {
    title: 'Achiote Memory Receipt',
    createdAt: input.createdAt ?? new Date().toISOString(),
    status: input.cue ? 'first_test_ready' : 'needs_more_clues',
    evidence: {
      userSaid: [input.memory.rawMemory],
      inferred: filterSafetyBounded(inferred),
      researched: filterSafetyBounded(input.researchedFacts ?? []),
      unknown: filterSafetyBounded(unknown),
    },
    hypotheses,
    nextBestQuestions,
    firstTinyTasteTest: input.cue
      ? {
          title: input.cue.title,
          cue: input.cue.goal,
          estimatedTime: `${input.cue.effortMinutes} minutes`,
        }
      : undefined,
    assistantSummary: input.assistantText ?? '',
  };
}

export function formatMemoryReceiptMarkdown(receipt: MemoryReceipt): string {
  const list = (items: string[]) => items.length
    ? items.map((item) => `- ${item}`).join('\n')
    : '- None recorded yet.';

  return [
    '# Achiote Memory Receipt',
    '',
    `Created: ${receipt.createdAt}`,
    `Status: ${receipt.status}`,
    '',
    '## User-Said Evidence',
    list(receipt.evidence.userSaid),
    '',
    '## Inferred Context',
    list(receipt.evidence.inferred),
    '',
    '## Researched Or Source-Backed Facts',
    list(receipt.evidence.researched),
    '',
    '## Unknowns',
    list(receipt.evidence.unknown),
    '',
    '## Family Questions',
    list(receipt.nextBestQuestions),
    '',
    '## First Tiny Taste Test',
    receipt.firstTinyTasteTest
      ? `- ${receipt.firstTinyTasteTest.title}: ${receipt.firstTinyTasteTest.cue} (${receipt.firstTinyTasteTest.estimatedTime})`
      : '- Not ready yet. Answer the family questions first.',
    '',
    '## Assistant Summary',
    receipt.assistantSummary || '- No final summary recorded.',
    '',
  ].join('\n');
}
