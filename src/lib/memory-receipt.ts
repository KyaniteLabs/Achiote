import type { CollectedFoodMemory, DishResearchPlan, MemoryReceipt, MinimumViableNostalgiaCue } from './types.js';
import { inferSafetyConstraints } from './ask-memory-correction.js';
import { filterMemoryResearchFacts, isLowQualityMemoryResearchText } from './research-evidence-filter.js';

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

function extractRuledOutTerms(text: string): string[] {
  const matches = [...text.matchAll(/\b(?:not|no|without|wasn['']?t|was not|isn['']?t|is not|aren['']?t|are not)\b[^.:?!;]{0,48}\b[\p{L}\p{M}]+(?:\s+[\p{L}\p{M}]+){0,3}\b/giu)];
  return unique(matches.flatMap((match) => {
    const cleaned = match[0]
      .replace(/^\b(?:not|no|without|wasn['']?t|was not|isn['']?t|is not|aren['']?t|are not)\b\s*/iu, '')
      .split(/[,.:?!;]/, 1)[0]
      .trim();
    return cleaned ? [cleaned] : [];
  })).slice(0, 4);
}

function extractedValuesLine(label: string, values: string[]): string | undefined {
  const cleaned = unique(values.map((value) => value.trim()).filter(Boolean));
  return cleaned.length > 0 ? `${label}: ${cleaned.join(', ')}` : undefined;
}

function buildReceiptExtractionProjection(memory: CollectedFoodMemory): {
  userSaid: string[];
  ruledOut: string[];
  names: string[];
  regions: string[];
  ingredients: string[];
  methods: string[];
  sensory: string[];
  occasions: string[];
} {
  const clues = memory.extractedClues;
  const names = unique(clues.possibleDishNames);
  const regions = unique([
    ...clues.culturalOrRegionalHints,
    memory.extractionMetadata?.originRegion ?? '',
  ]);
  const ingredients = unique(clues.rememberedIngredients);
  const methods = unique([
    ...(clues.cookingMethods ?? []),
    ...(memory.extractionMetadata?.cookingMethod ?? []),
  ]);
  const sensory = unique(clues.sensoryClues);
  const occasions = unique(clues.occasions);
  const ruledOut = unique([
    ...extractRuledOutTerms(memory.rawMemory),
    ...(clues.ruledOutIngredients ?? []),
    ...(memory.extractionMetadata?.ruledOutIngredients ?? []),
  ]);
  const language = memory.extractionMetadata?.language?.trim();
  const residence = memory.extractionMetadata?.residenceLocation?.trim() || memory.userLocation?.trim();

  return {
    userSaid: unique([
      memory.rawMemory,
      extractedValuesLine('Possible name or sound-alike', names) ?? '',
      extractedValuesLine('Region or community', regions) ?? '',
      extractedValuesLine('Remembered ingredients', ingredients) ?? '',
      extractedValuesLine('Ruled out', ruledOut) ?? '',
      extractedValuesLine('Cooking or serving method', methods) ?? '',
      extractedValuesLine('Sensory cues', sensory) ?? '',
      extractedValuesLine('Occasion or person', occasions) ?? '',
      language ? `Language clue: ${language}` : '',
      residence ? `Current/residence context: ${residence}` : '',
    ]),
    ruledOut,
    names,
    regions,
    ingredients,
    methods,
    sensory,
    occasions,
  };
}

function buildUnknownsFromProjection(projection: ReturnType<typeof buildReceiptExtractionProjection>): string[] {
  return unique([
    projection.names.length === 0 ? 'food or drink name or local nickname' : '',
    projection.regions.length === 0 ? 'country, island, region, town, or community' : '',
    projection.ingredients.length === 0 ? 'core ingredients' : '',
    projection.methods.length === 0 ? 'cooking method or serving format' : '',
    projection.sensory.length === 0 ? 'taste, texture, aroma, sauce, or heat level' : '',
    projection.occasions.length === 0 ? 'where/when they ate it or who made it' : '',
  ]);
}

function hasOverconfidentReceiptIdentity(text: string): boolean {
  return /\b(?:almost certainly|definitely|clearly|it'?s called|most likely\s+(?:is|was|means|refers?\s+to)|sounds like|this is exactly|your description matches|matches it perfectly)\b/i.test(text);
}

function buildUnresolvedReceiptSummary(
  projection: ReturnType<typeof buildReceiptExtractionProjection>,
  cue: MinimumViableNostalgiaCue | undefined,
): string {
  const name = projection.names[0] ? `"${projection.names[0]}"` : 'The dish name';
  const anchors = unique([
    ...projection.regions,
    ...projection.ingredients,
    ...projection.methods,
    ...projection.sensory,
  ]).slice(0, 5);
  const anchorText = anchors.length > 0
    ? ` User-said anchors: ${anchors.join(', ')}.`
    : '';
  const cueText = cue
    ? ` First tiny test: ${cue.title}. ${cue.goal}`
    : ' Answer the family questions before treating this as a recipe.';
  return `${name} is still unresolved, so this receipt should be read as a first-pass memory test, not a confirmed identity.${anchorText} ${cueText}`.trim();
}

function buildReceiptAssistantSummary(
  assistantText: string,
  projection: ReturnType<typeof buildReceiptExtractionProjection>,
  researchedFacts: string[],
  cue: MinimumViableNostalgiaCue | undefined,
): string {
  const text = assistantText.trim();
  if (!text) return '';
  const unresolvedNamedMemory = projection.names.length > 0 && researchedFacts.length === 0;
  const guardrailPreamble = /^What I heard:/i.test(text);
  if (unresolvedNamedMemory && (guardrailPreamble || hasOverconfidentReceiptIdentity(text) || isLowQualityMemoryResearchText(text))) {
    return buildUnresolvedReceiptSummary(projection, cue);
  }
  return text;
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

  const projection = buildReceiptExtractionProjection(input.memory);
  const unknown = buildUnknownsFromProjection(projection);
  const ruledOutLine = extractedValuesLine('Ruled out', projection.ruledOut);
  const extractedUserSaid = projection.userSaid
    .slice(1)
    .filter((line) => line !== ruledOutLine);
  const userSaid = [
    projection.userSaid[0],
    ...filterSafetyBounded(extractedUserSaid),
    ruledOutLine ?? '',
  ].filter(Boolean);
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
  const researched = filterSafetyBounded(filterMemoryResearchFacts(input.researchedFacts ?? []));

  return {
    title: 'Achiote Memory Receipt',
    createdAt: input.createdAt ?? new Date().toISOString(),
    status: input.cue ? 'first_test_ready' : 'needs_more_clues',
    evidence: {
      userSaid,
      ruledOut: projection.ruledOut,
      inferred: filterSafetyBounded(inferred),
      researched,
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
    assistantSummary: buildReceiptAssistantSummary(input.assistantText ?? '', projection, researched, input.cue),
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
    '## Ruled-Out Evidence',
    list(receipt.evidence.ruledOut),
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
