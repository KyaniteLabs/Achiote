import dishFamiliesData from '../data/dish-families.json' with { type: 'json' };
import type { planToolWorkflowOutputSchema } from '../schemas/tool-schemas.js';
import type { z } from 'zod';

export type AskWorkflowPlan = z.infer<typeof planToolWorkflowOutputSchema>;

export type AskWorkflowPlannerInput = {
  userMessage: string;
  searchDisabled?: boolean;
};

type WorkflowStep = AskWorkflowPlan['workflowSteps'][number];

const DIETARY_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(?:anaphylact\w*|anaphylax\w*|tree.?nut|peanut|cashew|almond|walnut|pecan|pistachio|hazelnut|macadamia|nut.?allerg|nut.?free)\b/i, label: 'nut_allergy' },
  { pattern: /\b(?:gluten.?free|celiac|coeliac)\b/i, label: 'gluten_free' },
  { pattern: /\b(?:dairy.?free|lactose|milk.?allerg|vegan)\b/i, label: 'dairy_free' },
  { pattern: /\bvegan\b/i, label: 'vegan' },
  { pattern: /\b(?:halal)\b/i, label: 'halal' },
  { pattern: /\b(?:kosher)\b/i, label: 'kosher' },
  { pattern: /\b(?:heart|cardiolog|saturated.?fat|cholesterol|low.?fat)\b/i, label: 'heart_healthy' },
  { pattern: /\b(?:diabet|sugar.?free|low.?sugar|low.?carb|keto)\b/i, label: 'diabetic' },
  { pattern: /\b(?:soy.?allerg|soy.?free)\b/i, label: 'soy_free' },
  { pattern: /\b(?:egg.?allerg|egg.?free)\b/i, label: 'egg_free' },
  { pattern: /\b(?:shellfish|seafood.?allerg)\b/i, label: 'shellfish_allergy' },
];

export function planAskWorkflow(input: AskWorkflowPlannerInput): AskWorkflowPlan {
  const userMessage = input.userMessage;
  const msg = userMessage.toLowerCase();
  const detectedRestrictions = DIETARY_PATTERNS
    .filter((pattern) => pattern.pattern.test(msg))
    .map((pattern) => pattern.label);
  const hasRestrictions = detectedRestrictions.length > 0;

  const hasMemoryKeywords = /\b(?:grandmother|grandfather|abuela|nonna|oma|yia|grandpa|nana|baba|tata|memo|tita|mami|dad|mom|mother|father|aunt|uncle|cousin|family|childhood|grew up|hometown|home country|village|old country|remember|memory|memories|used to make|tasted|smelled)\b/i.test(msg);
  const hasSensoryKeywords = /\b(?:taste|smell|aroma|flavor|texture|crispy|creamy|spicy|sweet|sour|salty|crunchy|chewy|soft|hot|cold|warm|bitter|savory|umami|gravy|sauce|broth)\b/i.test(msg);
  const hasSubstitutionKeywords = /\b(?:substitut\w*|instead of|replace|swap|alternative|can't eat|allergic|allergy|intolerance|dietary|restriction|halal|kosher|vegan|gluten.?free|dairy.?free|nut.?free)\b/i.test(msg);
  const wantsAdaptation = /\b(?:substitut\w*|adapt(?:ing|ed|s)?(?:\s+(?:the\s+)?(?:recipe|dish|version))?|make\s+it\s+(?:work|safe|for)|can\s+(?:all\s+)?(?:eat|have)|version\s+(?:that\s+)?work|without\b[\s\S]{0,80}\bbut\s+still|honou?r\b[\s\S]{0,80}\b(?:restrictions?|dietary|allergy|allergies|needs?))\b/i.test(msg);
  const negatesSubstitutionNeed = /\b(?:do\s+not|don't|does\s+not|doesn't|not|no)\s+(?:need|want|looking\s+for|asking\s+for)?[\s\S]{0,160}\b(?:substitut\w*|adapt(?:ation|ed|ing)?|dietary\s+(?:help|adaptation)|restriction\s+help)\b/i.test(msg)
    || /\b(?:only|just)\s+(?:want|need)[\s\S]{0,120}\b(?:memory cue|nostalgia cue|sensory cue|smallest memory cue)\b/i.test(msg);
  const hasRecipeKeywords = /\b(?:recipe|how to make|how do i|cook|bake|prepare|instructions|steps|ingredients)\b/i.test(msg);
  const hasRitualKeywords = /\b(?:ceremony|ritual|tradition|festival|holiday|celebration|wedding|funeral|birth|death|coming of age|bar mitzvah|bat mitzvah|quinceañera|diwali|eid|christmas|ramadan|passover|lunar new year|day of the dead)\b/i.test(msg);
  const hasMultilingualKeywords = /[-￿]{3,}/.test(msg) && /[a-z]{3,}/i.test(msg);
  const hasContradictionKeywords = /\b(?:but also|on the other hand|contradict|conflict|uncertain|not sure if|or was it|maybe it was|i think|actually|wait no)\b/i.test(msg);
  const hasDishName = /\b(?:curry|stew|soup|rice|bread|pasta|noodle|dumpling|pie|cake|taco|tamale|samosa|tagine|paella|risotto|biryani|ramen|pho|adobo|rendang|mole|gumbo|jambalaya|paella|lasagna|casserole|roast|grill|fry|bake|stew)\b/i.test(msg);
  const hasNothingConcrete = msg.length < 40 && !hasSensoryKeywords && !hasDishName;
  const suppressSearchFromUserText = /\b(?:call|use|run|invoke)\s+search_web\b/i.test(msg)
    || /\b(?:tell|say|claim)\s+(?:me\s+)?(?:you\s+)?(?:browsed|searched)\b[\s\S]{0,80}\b(?:live\s+)?(?:web|results|prices)\b/i.test(msg)
    || /\bdo\s+not\s+(?:claim\s+)?(?:browse|search|use\s+live\s+web|claim\s+(?:you\s+)?(?:browsed|searched))\b/i.test(msg)
    || /\b(?:do\s+not|don't)\s+claim\s+(?:you\s+)?(?:browsed|searched)\b/i.test(msg);

  const needsSubstitutions = (hasRestrictions || hasSubstitutionKeywords) && wantsAdaptation && !negatesSubstitutionNeed;
  const detectedIntent = detectIntent({
    hasSubstitutions: needsSubstitutions,
    hasRitualKeywords,
    hasMemoryKeywords,
    hasMultilingualKeywords,
    hasContradictionKeywords,
    hasRecipeKeywords,
    hasSensoryKeywords,
    hasNothingConcrete,
  });

  const steps: WorkflowStep[] = [
    { tool: 'collect_food_memory', reason: 'Parse user message into structured clues and missing information', required: true },
    { tool: 'plan_dish_research', reason: 'Build hypotheses and identify what to research', required: true },
  ];

  const searchWebDisabled = input.searchDisabled === true || suppressSearchFromUserText;
  const bundledMechanismFamily = searchWebDisabled ? null : bundledMechanismFamilyFor(userMessage);
  let maxSearchCalls = searchWebDisabled ? 0 : 1;
  const addSearchStep = (reason: string): void => {
    if (!searchWebDisabled && !bundledMechanismFamily) steps.push({ tool: 'search_web', reason, required: false });
  };

  if (needsSubstitutions) {
    steps.push({ tool: 'resolve_dish_name', reason: 'Identify the base dish to substitute for', required: true });
    addSearchStep('Find authentic preparation details for the base dish');
    steps.push({ tool: 'build_reconstruction_dossier', reason: 'Assemble the original evidence boundary before substitutions', required: true });
    steps.push({ tool: 'generate_minimum_viable_nostalgia', reason: 'Create the original minimum cue that will become the substitution basis', required: true });
    steps.push({ tool: 'find_sensory_substitutes', reason: 'Find compound-matched substitutions after the original cue is clear', required: true });
  } else if (detectedIntent === 'recipe_adaptation') {
    steps.push({ tool: 'resolve_dish_name', reason: 'Identify the target dish', required: true });
    addSearchStep('Find current recipe approaches');
    steps.push({ tool: 'build_reconstruction_dossier', reason: 'Assemble evidence for adaptation', required: true });
    steps.push({ tool: 'generate_minimum_viable_nostalgia', reason: 'Create a test cue for the adaptation', required: true });
  } else if (detectedIntent === 'unknown_dish' || detectedIntent === 'general_food_inquiry') {
    maxSearchCalls = 0;
  } else {
    steps.push({ tool: 'resolve_dish_name', reason: 'Match dish name from memory clues', required: false });
    addSearchStep('Confirm dish identity or find regional details');
    steps.push({ tool: 'build_reconstruction_dossier', reason: 'Assemble evidence boundary', required: true });
    steps.push({ tool: 'generate_minimum_viable_nostalgia', reason: 'Create first sensory test cue', required: true });
  }

  if (bundledMechanismFamily) maxSearchCalls = 0;
  const needsResolve = steps.some((step) => step.tool === 'resolve_dish_name');
  const bundledMechanismNote = bundledMechanismFamily
    ? ` Bundled mechanism family: ${bundledMechanismFamily}; live search deferred until the user asks for exact identity or source-backed details.`
    : '';

  return {
    detectedIntent,
    workflowSteps: steps,
    maxSearchCalls,
    needsSubstitutions,
    detectedRestrictions,
    needsResolve,
    confidenceNote: `Intent: ${detectedIntent}. Dietary restrictions: ${detectedRestrictions.length > 0 ? detectedRestrictions.join(', ') : 'none detected'}. Max search_web calls: ${maxSearchCalls}.${bundledMechanismNote}`,
  };
}

function detectIntent(input: {
  hasSubstitutions: boolean;
  hasRitualKeywords: boolean;
  hasMemoryKeywords: boolean;
  hasMultilingualKeywords: boolean;
  hasContradictionKeywords: boolean;
  hasRecipeKeywords: boolean;
  hasSensoryKeywords: boolean;
  hasNothingConcrete: boolean;
}): AskWorkflowPlan['detectedIntent'] {
  if (input.hasSubstitutions) return 'dietary_substitution';
  if (input.hasRitualKeywords && input.hasMemoryKeywords) return 'ritual_ceremony';
  if (input.hasMultilingualKeywords) return 'multilingual_inquiry';
  if (input.hasContradictionKeywords && input.hasMemoryKeywords) return 'contradictory_memory';
  if (input.hasRecipeKeywords && !input.hasMemoryKeywords) return 'recipe_adaptation';
  if (input.hasMemoryKeywords || input.hasSensoryKeywords) return 'nostalgic_memory';
  if (input.hasNothingConcrete) return 'unknown_dish';
  return 'general_food_inquiry';
}

function normalizeKnowledgeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function hasPhrase(textValue: string, phrase: string): boolean {
  const normalizedPhrase = normalizeKnowledgeText(phrase);
  if (!normalizedPhrase) return false;
  const escaped = normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|\\b)${escaped}(?:$|\\b)`, 'i').test(textValue);
}

function termParts(value: string): string[] {
  return normalizeKnowledgeText(value)
    .split(/\s+/)
    .filter((part) => part.length >= 4);
}

function bundledMechanismFamilyFor(userMessage: string): string | null {
  const normalized = normalizeKnowledgeText(userMessage);
  const cueOnly = /\b(?:smallest|tiny|sip|cue|test|not recipe|not a recipe|not full recipe|without pretending)\b/i.test(userMessage)
    || /\b(?:first|safe|local)\s+(?:cue|test|sip|bite)\b/i.test(userMessage);
  if (!cueOnly) return null;

  for (const family of dishFamiliesData.families) {
    const provenanceNotes = family.provenance?.notes ?? [];
    const isKnowledgeGapFamily = provenanceNotes.some((note) => /knowledge-gap evidence/i.test(note));
    if (!isKnowledgeGapFamily) continue;

    const aliasMatch = family.aliases.some((alias) => hasPhrase(normalized, alias));
    const mechanismTerms = [
      ...family.sharedElements,
      ...family.divergentElements,
      ...family.nostalgiaTriggers,
    ].flatMap(termParts);
    const matchedMechanismTerms = new Set(mechanismTerms.filter((term) => hasPhrase(normalized, term)));

    if (aliasMatch || matchedMechanismTerms.size >= 3) {
      return family.canonicalName;
    }
  }

  return null;
}
