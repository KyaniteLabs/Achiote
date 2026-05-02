import dishFamiliesData from '../data/dish-families.json' with { type: 'json' };
import pantryFixturesData from '../data/reference-pantry-fixtures.json' with { type: 'json' };
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
  const hasRecipeKeywords = /\b(?:recipe|how to make|how do i|cook|bake|prepare|instructions|steps|ingredients)\b/i.test(msg)
    && !/\b(?:not|no|don't|doesn't|never)\s+(?:a\s+|any\s+)?(?:recipe|full\s+recipe|instructions)\b/i.test(msg);
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

  const isMemoryIntent = detectedIntent === 'nostalgic_memory' || detectedIntent === 'ritual_ceremony' || detectedIntent === 'multilingual_inquiry' || detectedIntent === 'contradictory_memory';
  const searchWebDisabled = input.searchDisabled === true || suppressSearchFromUserText;
  const bundledMechanismFamily = searchWebDisabled || !isMemoryIntent ? null : bundledMechanismFamilyFor(userMessage);
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

const MECHANISM_STOPWORDS = new Set([
  'with', 'from', 'type', 'specific', 'over', 'home', 'dish', 'food', 'method',
  'family', 'region', 'level', 'inclusion', 'served', 'often', 'when', 'cooked',
  'cooking', 'using', 'made', 'made', 'into', 'such', 'than', 'more', 'most',
  'very', 'well', 'also', 'only', 'just', 'like', 'than', 'them', 'they', 'this',
  'that', 'have', 'been', 'being', 'were', 'where', 'what', 'which', 'while',
  'other', 'another', 'between', 'among', 'within', 'without', 'through', 'during',
  'before', 'after', 'above', 'below', 'under', 'over', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both',
  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'nor', 'not', 'only',
  'own', 'same', 'so', 'than', 'too', 'very', 'can', 'will', 'shall', 'should',
  'would', 'could', 'might', 'must', 'shall', 'may', 'need', 'dare', 'ought',
  'used', 'use', 'used', 'get', 'gets', 'got', 'getting', 'make', 'makes',
  'making', 'take', 'takes', 'taking', 'come', 'comes', 'coming', 'give', 'gives',
  'giving', 'say', 'says', 'saying', 'know', 'knows', 'knowing', 'think', 'thinks',
  'thinking', 'see', 'sees', 'seeing', 'look', 'looks', 'looking', 'want', 'wants',
  'wanting', 'find', 'finds', 'finding', 'tell', 'tells', 'telling', 'ask', 'asks',
  'asking', 'work', 'works', 'working', 'seem', 'seems', 'seeming', 'feel', 'feels',
  'feeling', 'try', 'tries', 'trying', 'leave', 'leaves', 'leaving', 'call', 'calls',
  'calling', 'keep', 'keeps', 'keeping', 'let', 'lets', 'letting', 'put', 'puts',
  'putting', 'bring', 'brings', 'bringing', 'begin', 'begins', 'beginning', 'help',
  'helps', 'helping', 'show', 'shows', 'showing', 'hear', 'hears', 'hearing', 'play',
  'plays', 'playing', 'run', 'runs', 'running', 'move', 'moves', 'moving', 'live',
  'lives', 'living', 'believe', 'believes', 'believing', 'hold', 'holds', 'holding',
  'bring', 'brings', 'bringing', 'happen', 'happens', 'happening', 'stand', 'stands',
  'standing', 'lose', 'loses', 'losing', 'pay', 'pays', 'paying', 'meet', 'meets',
  'meeting', 'include', 'includes', 'including', 'continue', 'continues', 'continuing',
  'set', 'sets', 'setting', 'learn', 'learns', 'learning', 'change', 'changes',
  'changing', 'lead', 'leads', 'leading', 'understand', 'understands', 'understanding',
  'watch', 'watches', 'watching', 'follow', 'follows', 'following', 'stop', 'stops',
  'stopping', 'create', 'creates', 'creating', 'speak', 'speaks', 'speaking', 'read',
  'reads', 'reading', 'allow', 'allows', 'allowing', 'add', 'adds', 'adding', 'spend',
  'spends', 'spending', 'grow', 'grows', 'growing', 'open', 'opens', 'opening',
  'walk', 'walks', 'walking', 'offer', 'offers', 'offering', 'remember', 'remembers',
  'remembering', 'love', 'loves', 'loving', 'consider', 'considers', 'considering',
  'appear', 'appears', 'appearing', 'buy', 'buys', 'buying', 'wait', 'waits',
  'waiting', 'serve', 'serves', 'serving', 'die', 'dies', 'dying', 'send', 'sends',
  'sending', 'expect', 'expects', 'expecting', 'build', 'builds', 'building', 'stay',
  'stays', 'staying', 'fall', 'falls', 'falling', 'cut', 'cuts', 'cutting', 'reach',
  'reaches', 'reaching', 'kill', 'kills', 'killing', 'remain', 'remains', 'remaining',
  'suggest', 'suggests', 'suggesting', 'raise', 'raises', 'raising', 'pass', 'passes',
  'passing', 'sell', 'sells', 'selling', 'require', 'requires', 'requiring', 'report',
  'reports', 'reporting', 'decide', 'decides', 'deciding', 'pull', 'pulls', 'pulling',
  'whose', 'whom', 'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'doing', 'done', 'a', 'an',
  'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of', 'at',
  'by', 'for', 'to', 'in', 'on', 'off', 'up', 'down', 'out', 'about', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'between', 'among',
  'within', 'without', 'against', 'under', 'over', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both',
  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'nor', 'not', 'only',
  'own', 'same', 'so', 'than', 'too', 'very', 'just', 'now', 'also', 'back',
  'still', 'already', 'yet', 'almost', 'quite', 'rather', 'enough', 'even',
  'much', 'many', 'little', 'less', 'least', 'last', 'first', 'second', 'next',
  'every', 'several', 'various', 'certain', 'particular', 'general', 'common',
  'usual', 'normal', 'regular', 'standard', 'typical', 'traditional', 'classic',
  'authentic', 'original', 'real', 'true', 'actual', 'exact', 'precise', 'accurate',
  'correct', 'right', 'proper', 'appropriate', 'suitable', 'fitting', 'likely',
  'possible', 'probable', 'certain', 'sure', 'clear', 'obvious', 'evident',
  'apparent', 'plain', 'simple', 'easy', 'difficult', 'hard', 'complex',
  'complicated', 'detailed', 'complete', 'full', 'whole', 'entire', 'total',
  'partial', 'half', 'quarter', 'third', 'double', 'single', 'multiple',
  'different', 'similar', 'same', 'opposite', 'reverse', 'inverse', 'varied',
  'various', 'diverse', 'range', 'series', 'group', 'set', 'collection',
  'amount', 'number', 'quantity', 'volume', 'mass', 'size', 'length', 'width',
  'height', 'depth', 'area', 'space', 'place', 'spot', 'point', 'part',
  'piece', 'section', 'segment', 'portion', 'share', 'bit', 'lot', 'deal',
  'sort', 'kind', 'type', 'form', 'shape', 'way', 'manner', 'style', 'mode',
  'fashion', 'trend', 'pattern', 'design', 'plan', 'scheme', 'system',
  'structure', 'framework', 'model', 'example', 'sample', 'instance', 'case',
  'situation', 'condition', 'state', 'position', 'status', 'stage', 'phase',
  'step', 'level', 'degree', 'extent', 'scale', 'scope', 'range', 'reach',
  'span', 'stretch', 'spread', 'cover', 'contain', 'include', 'involve',
  'concern', 'relate', 'connect', 'link', 'tie', 'bind', 'attach', 'join',
  'unite', 'combine', 'mix', 'merge', 'blend', 'fuse', 'integrate', 'incorporate',
  'absorb', 'adopt', 'accept', 'receive', 'get', 'obtain', 'gain', 'acquire',
  'achieve', 'attain', 'reach', 'arrive', 'come', 'go', 'leave', 'depart',
  'enter', 'exit', 'return', 'turn', 'change', 'shift', 'switch', 'transfer',
  'move', 'motion', 'movement', 'action', 'activity', 'act', 'deed', 'feat',
  'effort', 'attempt', 'try', 'trial', 'test', 'experiment', 'experience',
  'event', 'occasion', 'opportunity', 'chance', 'luck', 'fortune', 'fate',
  'destiny', 'future', 'past', 'present', 'time', 'moment', 'minute',
  'hour', 'day', 'week', 'month', 'year', 'today', 'tomorrow', 'yesterday',
  'morning', 'afternoon', 'evening', 'night', 'dawn', 'dusk', 'noon',
  'midnight', 'early', 'late', 'soon', 'later', 'eventually', 'finally',
  'ultimately', 'initially', 'originally', 'previously', 'formerly',
  'recently', 'lately', 'currently', 'presently', 'nowadays', 'today',
  'always', 'never', 'sometimes', 'often', 'frequently', 'usually',
  'normally', 'generally', 'typically', 'commonly', 'regularly',
  'constantly', 'continuously', 'repeatedly', 'periodically',
  'occasionally', 'rarely', 'seldom', 'hardly', 'barely', 'scarcely',
  'nearly', 'almost', 'practically', 'virtually', 'essentially',
  'basically', 'fundamentally', 'primarily', 'mainly', 'mostly',
  'largely', 'partly', 'partially', 'slightly', 'somewhat', 'rather',
  'fairly', 'pretty', 'quite', 'really', 'truly', 'actually', 'indeed',
  'certainly', 'definitely', 'absolutely', 'completely', 'totally',
  'entirely', 'fully', 'wholly', 'thoroughly', 'deeply', 'strongly',
  'highly', 'greatly', 'significantly', 'considerably', 'substantially',
  'markedly', 'noticeably', 'clearly', 'obviously', 'evidently',
  'apparently', 'seemingly', 'presumably', 'supposedly', 'allegedly',
  'reportedly', 'supposedly', ' arguably', 'perhaps', 'maybe',
  'possibly', 'probably', 'likely', 'presumably', 'presumably',
  'the', 'and', 'but', 'or', 'for', 'with', 'from', 'into', 'onto',
  'upon', 'about', 'above', 'across', 'after', 'against', 'along',
  'amid', 'among', 'around', 'as', 'at', 'before', 'behind',
  'below', 'beneath', 'beside', 'besides', 'between', 'beyond',
  'but', 'by', 'concerning', 'considering', 'despite', 'down',
  'during', 'except', 'excepting', 'excluding', 'following', 'for',
  'from', 'in', 'inside', 'into', 'like', 'minus', 'near', 'of',
  'off', 'on', 'onto', 'opposite', 'out', 'outside', 'over',
  'past', 'per', 'plus', 'regarding', 'round', 'save', 'since',
  'than', 'through', 'throughout', 'till', 'to', 'toward',
  'towards', 'under', 'underneath', 'unlike', 'until', 'up',
  'upon', 'versus', 'via', 'with', 'within', 'without',
]);

function termParts(value: string): string[] {
  return normalizeKnowledgeText(value)
    .split(/\s+/)
    .filter((part) => part.length >= 4 && !MECHANISM_STOPWORDS.has(part));
}

const ALIAS_TO_CANONICAL = new Map<string, string>();
for (const family of dishFamiliesData.families) {
  ALIAS_TO_CANONICAL.set(family.canonicalName, family.canonicalName);
  for (const alias of family.aliases) {
    ALIAS_TO_CANONICAL.set(alias, family.canonicalName);
  }
}

const PANTRY_FAMILIES = new Set(
  pantryFixturesData.fixtures
    .map((f) => f.cacheTarget?.dishFamily)
    .filter((f): f is string => typeof f === 'string')
    .map((dishFamily) => ALIAS_TO_CANONICAL.get(dishFamily) ?? dishFamily),
);

function bundledMechanismFamilyFor(userMessage: string): string | null {
  const normalized = normalizeKnowledgeText(userMessage);

  for (const family of dishFamiliesData.families) {
    if (!PANTRY_FAMILIES.has(family.canonicalName)) continue;

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
