import type { CollectedFoodMemory, DishResearchPlan, MemoryReceipt, MinimumViableNostalgiaCue } from './types.js';

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function buildMemoryReceipt(input: {
  memory: CollectedFoodMemory;
  researchPlan?: DishResearchPlan;
  cue?: MinimumViableNostalgiaCue;
  assistantText?: string;
  createdAt?: string;
}): MemoryReceipt {
  const inferred = [
    ...input.memory.inferredContext.culturalOrRegional,
    ...input.memory.inferredContext.language,
  ].map((clue) => `${clue.label} (${clue.confidence} confidence): ${clue.basis}`);

  const unknown = unique([
    ...input.memory.missingInformation,
    ...(input.researchPlan?.factsToVerify ?? []),
  ]);

  return {
    title: 'Achiote Memory Receipt',
    createdAt: input.createdAt ?? new Date().toISOString(),
    status: input.cue ? 'first_test_ready' : 'needs_more_clues',
    evidence: {
      userSaid: [input.memory.rawMemory],
      inferred,
      researched: [],
      unknown,
    },
    hypotheses: input.researchPlan?.hypotheses ?? [],
    nextBestQuestions: (input.researchPlan?.questionsForUser.length
      ? input.researchPlan.questionsForUser
      : input.memory.nextQuestions).slice(0, 5),
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
