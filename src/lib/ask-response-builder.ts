/**
 * Ask response builder: substitution basis, minimum-cue formatting,
 * evidence-bounded response construction, and cue quality enforcement.
 * Extracted from http-server.ts for maintainability.
 */
import type { CollectedFoodMemory, MinimumViableNostalgiaCue } from './types.js';
import {
  buildClarificationOnlyResponse,
  buildEvidencePreamble,
  sanitizeMinimumCueFallbackBlock,
  sanitizeMinimumCueFallbackText,
} from './ask-guardrails.js';
import { inferSafetyConstraints, isRecord } from './ask-memory-correction.js';
import { escapeRegExp } from './food-memory-text.js';

// ── Substitution helpers ──────────────────────────────────────────────────

export function hasSubstitutionBasisReady(toolPayloads: Record<string, unknown>, calledTools: Set<string>): boolean {
  return (isSubstitutionPlan(toolPayloads) || calledTools.has('find_sensory_substitutes'))
    && calledTools.has('generate_minimum_viable_nostalgia')
    && calledTools.has('find_sensory_substitutes');
}

export function isSubstitutionPlan(toolPayloads: Record<string, unknown>): boolean {
  const plan = toolPayloads.plan_tool_workflow as { needsSubstitutions?: boolean } | undefined;
  return plan?.needsSubstitutions === true;
}

export function buildSubstitutionBasisResponse(toolPayloads: Record<string, unknown>, userMessage: string): string {
  const cue = toolPayloads.generate_minimum_viable_nostalgia as MinimumViableNostalgiaCue | undefined;
  if (!cue) return buildClarificationOnlyResponse(toolPayloads, userMessage);

  const cueItems = cue.ingredients
    .filter((ingredient) => !ingredient.optional)
    .slice(0, 2)
    .map((ingredient) => formatMinimumCueIngredientPhrase(ingredient));
  const cuePhrase = cueItems.length > 0
    ? cueItems.join(' plus ')
    : 'one ordinary grocery or pantry cue that matches the remembered aroma, texture, or balance';
  const constraints = inferSafetyConstraints(userMessage);
  const substitutionLines = summarizeSubstitutionResults(toolPayloads, constraints.length > 0);
  const preserved = cue.preserves[0]
    ? sanitizeMinimumCueFallbackText(cue.preserves[0]).replace(/\.$/, '')
    : 'the strongest remembered aroma, texture, or sauce balance';
  const firstStep = firstUsefulCueStep(cue);
  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  const localLine = memory?.userLocation
    ? `Use ordinary grocery or pantry items near ${memory.userLocation}; do not buy the exact suspected dish for this first test.`
    : 'Use ordinary grocery or pantry items first; do not buy the exact suspected dish for this first test.';
  const sourcingLines = summarizeSourcingResults(toolPayloads);
  const sourcingSection = sourcingLines.length > 0
    ? ['Where to buy:', ...sourcingLines.map((line) => `- ${line}`)]
    : [];

  return sanitizeMinimumCueFallbackBlock([
    'What to test first:',
    `${cue.title}: ${cuePhrase}.`,
    firstStep,
    '',
    'Substitutes to try:',
    substitutionLines.length > 0
      ? `Keep that same sensory target, but swap constrained pieces by role: ${substitutionLines.join('; ')}.`
      : `Keep that same sensory target, but choose substitutes by role: fat carrier, aroma base, starch texture, protein bite, acid, salt, and sauce body.`,
    `Test the adapted version as a tiny bite or sip; if it loses ${preserved}, the substitute is wrong even if the restriction is satisfied.`,
    localLine,
    ...sourcingSection,
    '',
    'Next ask: tell me which part hit first after the adapted test: smell, texture, fat, starch, sauce, heat, or acidity.',
  ].filter(Boolean).join('\n'));
}

export function buildSourcingGuidanceResponse(toolPayloads: Record<string, unknown>, userMessage: string): string {
  const sourcingLines = summarizeSourcingResults(toolPayloads);
  const substitutionLines = summarizeSubstitutionResults(toolPayloads, inferSafetyConstraints(userMessage).length > 0);
  const substitutionSection = substitutionLines.length > 0
    ? ['Substitutes to try:', ...substitutionLines.map((line) => `- ${line}`)]
    : [];

  if (sourcingLines.length === 0) {
    return buildClarificationOnlyResponse(toolPayloads, userMessage);
  }

  return sanitizeMinimumCueFallbackBlock([
    'Where to buy:',
    ...sourcingLines.map((line) => `- ${line}`),
    ...(substitutionSection.length > 0 ? ['', ...substitutionSection] : []),
    '',
    'Next ask: tell me what city or store type you can actually reach, and I can narrow the path without claiming live inventory.',
  ].join('\n'));
}

export function summarizeSubstitutionResults(toolPayloads: Record<string, unknown>, maskAsRestricted = false): string[] {
  const allResults = Array.isArray(toolPayloads.find_sensory_substitutes_all)
    ? toolPayloads.find_sensory_substitutes_all
    : [toolPayloads.find_sensory_substitutes].filter(Boolean);

  return allResults.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const rawIngredient = typeof entry.ingredient === 'string' ? entry.ingredient : 'restricted ingredient';
    const ingredient = maskAsRestricted ? 'the restricted ingredient' : rawIngredient;
    const substitutes = Array.isArray(entry.substitutes) ? entry.substitutes : [];
    const first = substitutes.find(isRecord);
    if (!first) return [`${ingredient} -> match the original sensory role, then mark the result uncertain`];
    const substitute = typeof first.substitute === 'string' ? first.substitute : 'role-matched substitute';
    const reasoning = typeof first.reasoning === 'string' ? first.reasoning : '';
    return [`${ingredient} -> ${substitute}${reasoning ? ` (${sanitizeMinimumCueFallbackText(reasoning).replace(/\.$/, '')})` : ''}`];
  }).slice(0, 5);
}

export function summarizeSourcingResults(toolPayloads: Record<string, unknown>): string[] {
  const sourcing = isRecord(toolPayloads.source_ingredients) ? toolPayloads.source_ingredients : undefined;
  if (!sourcing) return [];
  const ingredients = Array.isArray(sourcing.ingredients)
    ? sourcing.ingredients.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const location = typeof sourcing.location === 'string' && sourcing.location.trim()
    ? sourcing.location.trim()
    : 'your area';
  if (ingredients.length === 0) return [];

  const regionalData = isRecord(sourcing.regionalData) ? sourcing.regionalData : undefined;
  const majorStores = flattenRegionalStores(regionalData?.majorStores);
  const corridors = flattenRegionalCorridors(regionalData?.ethnicCorridors);
  const localHints = [...majorStores, ...corridors].slice(0, 3);
  const localLine = localHints.length > 0
    ? `Start with ${localHints.join(', ')}. Treat that as static guidance, not live inventory.`
    : 'Start with Mexican, Latin, international, or spice-focused markets, then check online specialty chile importers if local shelves miss.';

  return [
    `Where to buy near ${location}: look for ${ingredients.join(', ')}.`,
    localLine,
    'Call ahead or check labels yourself; this is sourcing guidance, not a live inventory claim.',
  ];
}

function flattenRegionalStores(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  if (!isRecord(value)) return [];
  return Object.values(value)
    .flatMap((entry) => Array.isArray(entry) ? entry : [])
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function flattenRegionalCorridors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === 'string' && entry.trim()) return [entry.trim()];
    if (!isRecord(entry)) return [];
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    const city = typeof entry.city === 'string' ? entry.city.trim() : '';
    return name ? [city ? `${name} in ${city}` : name] : [];
  });
}

export function extractSubstitutionTargets(userMessage: string, collectedMemory: unknown): string[] {
  const targets = new Set<string>();
  const clues = collectedMemory && typeof collectedMemory === 'object'
    ? (collectedMemory as { extractedClues?: { rememberedIngredients?: unknown } }).extractedClues
    : undefined;
  const rememberedIngredients = Array.isArray(clues?.rememberedIngredients) ? clues.rememberedIngredients : [];
  for (const ingredient of rememberedIngredients) {
    if (typeof ingredient === 'string' && ingredient.trim()) targets.add(normalizeSubstitutionTarget(ingredient));
  }

  const ingredientPatterns: Array<[RegExp, string]> = [
    [/\bchilhuacle(?:\s+(?:negro|rojo|amarillo))?\s+chiles?\b/i, 'chilhuacle chiles'],
    [/\bchiles?\s+chilhuacles?\b/i, 'chilhuacle chiles'],
    [/\bcashews?\b/i, 'cashews'],
    [/\btree nuts?\b/i, 'tree nuts'],
    [/\bbutter\b/i, 'butter'],
    [/\bcream\b/i, 'cream'],
    [/\byogurt\b/i, 'yogurt'],
    [/\bmilk\b/i, 'milk'],
    [/\bcheese\b/i, 'cheese'],
    [/\bchicken\b/i, 'chicken'],
    [/\blamb\b/i, 'lamb'],
    [/\bbeef\b/i, 'beef'],
    [/\bpork\b/i, 'pork'],
    [/\bwhiske?y\b/i, 'whiskey'],
    [/\balcohol\b/i, 'alcohol'],
    [/\bnaan\b/i, 'naan'],
    [/\bwheat\b/i, 'wheat'],
    [/\bgluten\b/i, 'gluten'],
    [/\bchickpeas?\b/i, 'chickpeas'],
    [/\blentils?\b/i, 'lentils'],
    [/\beggs?\b/i, 'eggs'],
    [/\bsoy\b/i, 'soy'],
    [/\bshellfish\b/i, 'shellfish'],
  ];
  for (const [pattern, ingredient] of ingredientPatterns) {
    if (pattern.test(userMessage)) targets.add(ingredient);
  }

  return [...targets].filter((ingredient) => !/^(incredible|heart|brother-in-law)$/i.test(ingredient));
}

export function normalizeSubstitutionTarget(ingredient: string): string {
  const normalized = ingredient.trim().toLowerCase();
  if (normalized === 'cashew') return 'cashews';
  if (normalized === 'chickpea') return 'chickpeas';
  if (normalized === 'lentil') return 'lentils';
  if (normalized === 'egg') return 'eggs';
  return normalized;
}

export function hasSensorySignal(userMessage: string, collectedMemory: unknown): boolean {
  const clues = collectedMemory && typeof collectedMemory === 'object'
    ? (collectedMemory as { extractedClues?: { rememberedIngredients?: unknown; sensoryClues?: unknown } }).extractedClues
    : undefined;
  const rememberedIngredients = Array.isArray(clues?.rememberedIngredients) ? clues.rememberedIngredients : [];
  const sensoryClues = Array.isArray(clues?.sensoryClues) ? clues.sensoryClues : [];
  if (rememberedIngredients.length > 0 || sensoryClues.length > 0) return true;

  return /\b(?:sweet|sour|salty|bitter|spicy|hot|cold|warm|icy|ice|iced|thin|thinner|watery|lightly sweet|barely sweet|crispy|crunchy|crumbly|grainy|powdery|chewy|creamy|sticky|aroma|smell|texture|color|mouth|tongue|sip|drink|bebida|agua|arroz|rice|canela|cinnamon|hielo|vainilla|vanilla|lime|barley|cebada|sesame|coconut|peanut|dill|garlic|onion|sauce|gravy|relish)\b/i.test(userMessage);
}

// ── Minimum-cue formatting ───────────────────────────────────────────────

export function formatMinimumCueFallback(cue: MinimumViableNostalgiaCue, userLocation?: string): string {
  const cueItems = cue.ingredients
    .filter((ingredient) => !ingredient.optional)
    .slice(0, 2)
    .map((ingredient) => formatMinimumCueIngredientPhrase(ingredient));
  const optionalItem = cue.ingredients.find((ingredient) => ingredient.optional);
  const cuePhrase = cueItems.length > 0
    ? cueItems.join(' plus ')
    : 'one ordinary grocery or pantry cue that matches the remembered aroma, texture, or balance';
  const action = firstUsefulCueStep(cue);
  const followUp = cue.followUpIfItWorks[0] ? sanitizeMinimumCueFallbackText(cue.followUpIfItWorks[0]) : undefined;
  const localLine = userLocation
    ? `Local sourcing: use ordinary grocery or pantry items near ${userLocation}; do not buy the exact suspected dish for this first test.`
    : '';

  return sanitizeMinimumCueFallbackBlock([
    cue.title,
    '',
    `First-pass verification bite: ${cuePhrase}.`,
    '',
    action,
    'Do not buy the exact suspected dish yet; this is only the first check.',
    optionalItem ? `Optional adjustment: ${formatMinimumCueIngredientPhrase(optionalItem)}.` : '',
    '',
    `Why this is minimum: ${compactMinimumCueWhy(cue.whyThisIsMinimum)}`,
    localLine,
    followUp ? `If it works, next ask: ${followUp}` : '',
  ].filter((line) => line.length > 0).join('\n'));
}

export function formatMinimumCueIngredientPhrase(ingredient: MinimumViableNostalgiaCue['ingredients'][number]): string {
  const item = sanitizeMinimumCueFallbackText(ingredient.item)
    .replace(/^(?:a\s+)?(?:tiny|small)\s+(?:test\s+)?amount\s+of\s+/i, '')
    .replace(/^tiny\s+/i, '')
    .trim();
  if (/^(?:a|an|one|some)\b/i.test(item)) return item;
  return `a tiny amount of ${item}`;
}

export function firstUsefulCueStep(cue: MinimumViableNostalgiaCue): string {
  const step = cue.steps
    .map((candidate) => sanitizeMinimumCueFallbackText(candidate))
    .find((candidate) => candidate && !/\b(?:do not buy|do not build|record whether|change one|escalating|full dish)\b/i.test(candidate))
    ?? cue.steps.map((candidate) => sanitizeMinimumCueFallbackText(candidate)).find(Boolean)
    ?? 'Taste once, then stop and notice whether aroma, texture, acidity, fat, sweetness, or salt carried the memory.';
  return step
    .replace(/^(?:try|step\s*\d+[:.)-]?)\s*/i, '')
    .replace(/\b(?:one teaspoon|one-cup|one cup|1 cup|1-2 bites|1-2 tablespoons)\b/gi, 'a tiny amount')
    .replace(/\.$/, '') + '.';
}

export function compactMinimumCueWhy(text: string): string {
  return sanitizeMinimumCueFallbackText(text)
    .replace(/\b(?:before wasting ingredients on a full pot|before committing to specialty shopping or a full dish|before specialty shopping or cooking|before buying the suspected sweet)\b/gi, 'before you spend more effort')
    .replace(/\bfood-science mechanisms\b/gi, 'memory mechanisms');
}

// ── Response builders ─────────────────────────────────────────────────────

export function containsCueFamilyMismatch(text: string, userMessage: string): boolean {
  if (/\b(?:soup|broth|stew)\b/i.test(userMessage) && /\b(?:beverage-memory|carbonation|foamy|iced|over ice|exact drink)\b/i.test(text)) {
    return true;
  }
  if (/\b(?:gravy|sauce|chicken|naan|substitution|adapt)\b/i.test(userMessage) && /\b(?:sweet-texture|confectionery|suspected candy)\b/i.test(text)) {
    return true;
  }
  return false;
}

export function buildUserMessageMechanismCueResponse(userMessage: string, toolPayloads: Record<string, unknown>): string {
  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  const localLine = memory?.userLocation
    ? `Use ordinary grocery or pantry items near ${memory.userLocation}; do not buy the exact suspected dish for this first test.`
    : '';
  const cuePhrase = /\b(?:soup|broth|stew)\b/i.test(userMessage)
    ? 'a tiny amount of safe neutral liquid carrier plus one tiny remembered aroma, acid, herb, or texture cue from the user message'
    : 'a tiny amount of a safe neutral carrier plus one tiny remembered aroma, fat, acid, texture, or mouthfeel cue from the user message';
  const preamble = buildEvidencePreamble(toolPayloads, userMessage);
  return sanitizeMinimumCueFallbackBlock([
    preamble,
    'Minimum viable memory-family cue',
    '',
    `First-pass verification bite: ${cuePhrase}.`,
    '',
    'Keep it to one sip, smell, or bite that tests only the corrected memory family instead of reusing an older or incompatible cue type.',
    'Do not buy the exact suspected dish yet; this is only the first check.',
    '',
    'Why this is minimum: The user message is the highest-trust evidence, so the first cue should match that memory family before adding recipe structure or exact identity.',
    localLine,
    'If it works, next ask: Ask which detail hit first: smell, texture, acid, fat, starch, temperature, or serving ritual.',
  ].filter((line) => line.length > 0).join('\n'));
}

export function buildMinimumCueCompletedResponse(toolPayloads: Record<string, unknown>, userMessage?: string): string {
  const responseText = buildEvidenceBoundedMinimumCueResponse(toolPayloads, userMessage);
  if (userMessage && containsCueFamilyMismatch(responseText, userMessage)) {
    return buildUserMessageMechanismCueResponse(userMessage, toolPayloads);
  }
  return responseText;
}

export function buildEvidenceBoundedMinimumCueResponse(toolPayloads: Record<string, unknown>, userMessage?: string): string {
  const cue = toolPayloads.generate_minimum_viable_nostalgia as MinimumViableNostalgiaCue | undefined;
  if (!cue) {
    return 'I completed the structured Achiote tool workflow, but the final synthesis model did not return in time. Try again with a shorter prompt or a faster provider.';
  }
  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  const body = ensureCueQualityLanguage(formatMinimumCueFallback(cue, memory?.userLocation), toolPayloads, new Set(['generate_minimum_viable_nostalgia']));
  const preamble = buildEvidencePreamble(toolPayloads, userMessage);
  const substitutionLines = summarizeSubstitutionResults(toolPayloads, inferSafetyConstraints(userMessage ?? '').length > 0);
  const sourcingLines = summarizeSourcingResults(toolPayloads);
  const substitutionSection = substitutionLines.length > 0
    ? ['Substitutes to try:', ...substitutionLines.map((line) => `- ${line}`)].join('\n')
    : '';
  const sourcingSection = sourcingLines.length > 0
    ? ['Where to buy:', ...sourcingLines.map((line) => `- ${line}`)].join('\n')
    : '';
  return sanitizeMinimumCueFallbackBlock([preamble, body, substitutionSection, sourcingSection].filter(Boolean).join('\n\n'));
}

// ── Cue quality enforcement ───────────────────────────────────────────────

export function ensureLocalCueLanguage(text: string, toolPayloads: Record<string, unknown>, calledTools: Set<string>): string {
  if (!calledTools.has('generate_minimum_viable_nostalgia')) return text;
  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  const location = memory?.userLocation;
  if (!location) return text;
  const mentionsLocality = new RegExp(`\\b${escapeRegExp(location)}\\b`, 'i').test(text)
    || /\b(?:local|nearby|ordinary grocery|grocery-store|grocery store|pantry|available near)\b/i.test(text);
  if (mentionsLocality) return text;
  return `${text.trim()}\n\nUse ordinary grocery or pantry items near ${location}; do not buy the exact suspected dish for this first test.`;
}

export function ensureCueQualityLanguage(text: string, toolPayloads: Record<string, unknown>, calledTools: Set<string>): string {
  let revised = ensureLocalCueLanguage(text, toolPayloads, calledTools);
  if (!calledTools.has('generate_minimum_viable_nostalgia')) return revised;
  revised = ensureComposedCueCoverage(revised, toolPayloads);
  revised = revised.replace(/\bnarrow,\s*research-bounded proxy test\b/gi, 'first-pass verification bite');
  if (!/\bfirst[-\s]?pass verification bite\b/i.test(revised)) {
    if (/\bfirst\s+(?:cheap local\s+)?verification bite\b/i.test(revised)) {
      revised = revised.replace(/\bfirst\s+(?:cheap local\s+)?verification bite\b/i, 'first-pass verification bite');
    } else {
      revised = revised.replace(/\b(?:cheap local\s+)?verification bite\b/i, 'first-pass verification bite');
    }
  }
  if (/\b(?:verify|verification|narrow|first[-\s]?pass|tiny check|rule out|revise)\b/i.test(revised)) return revised;
  revised = `${revised.trim()}\n\nThis is only a first-pass verification bite: if the aroma, texture, or aftertaste is wrong, we should revise the guess before chasing exact components.`;
  return revised;
}

export function ensureComposedCueCoverage(text: string, toolPayloads: Record<string, unknown>): string {
  const cue = toolPayloads.generate_minimum_viable_nostalgia as MinimumViableNostalgiaCue | undefined;
  const roles = new Set(cue?.components?.map((component) => component.role) ?? []);
  if (!roles.has('starch') || !roles.has('protein')) return text;

  const cueStart = text.search(/\b(?:try|test|bite|take|mix|boil|pan[-\s]?sear|sear|fry|crisp|taste)\b/i);
  const cueText = cueStart >= 0 ? text.slice(cueStart) : text;
  const mentionsStarch = /\b(?:plantain|banana|starch|masa|yuca|cassava|tapioca|potato|rice|dough|carrier)\b/i.test(cueText);
  const mentionsProtein = /\b(?:pork|meat|protein|fish|chicken|beef|tofu|fat|sofrito|brown|browned|sear|filling|umami)\b/i.test(cueText);
  if (mentionsStarch && mentionsProtein) return text;

  return `${text.trim()}\n\nFor the test itself, keep the starch and browned fat/protein together; the memory may live in that contrast, not either piece alone.`;
}
