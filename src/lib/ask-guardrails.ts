/**
 * Ask guardrails: detection, sanitization, and tool-name normalization
 * extracted from http-server.ts for maintainability.
 */
import type { AskModelResponse } from './ask-provider.js';
import type { CollectedFoodMemory, DishResearchPlan } from './types.js';
import { isBroadRegionalHint } from './food-memory-collector.js';
import { inferSafetyConstraints } from './ask-memory-correction.js';

import { anthropicTools as TOOLS } from '../tools/tool-registry.js';

// ── Constants ──────────────────────────────────────────────────────────────

export const KNOWN_TOOL_NAMES = new Set(TOOLS.map((tool) => tool.name));

export const MODEL_TOOL_NAME_ALIASES: Record<string, string> = {
  find_sensory_subutes: 'find_sensory_substitutes',
  generate_minimum_viable_nystalgia: 'generate_minimum_viable_nostalgia',
};

// ── Tool name normalization ────────────────────────────────────────────────

export function normalizeModelToolCalls(toolCalls: AskModelResponse['toolCalls']): {
  toolCalls: AskModelResponse['toolCalls'];
  corrections: Array<{ from: string; to: string }>;
  droppedMalformed: Array<{ name: string; reason: string }>;
  normalizedAny: boolean;
} {
  const corrections: Array<{ from: string; to: string }> = [];
  const droppedMalformed: Array<{ name: string; reason: string }> = [];
  const normalized: AskModelResponse['toolCalls'] = [];
  for (const call of toolCalls) {
    const toolName = normalizeModelToolName(call.name);
    if (toolName === call.name && !KNOWN_TOOL_NAMES.has(toolName) && isMalformedToolNameEnvelope(toolName)) {
      droppedMalformed.push({ name: call.name, reason: 'provider_tool_name_envelope' });
      continue;
    }
    if (toolName === call.name) {
      normalized.push(call);
      continue;
    }
    corrections.push({ from: call.name, to: toolName });
    normalized.push({ ...call, name: toolName });
  }
  return { toolCalls: normalized, corrections, droppedMalformed, normalizedAny: corrections.length > 0 || droppedMalformed.length > 0 };
}

export function normalizeModelToolName(toolName: string): string {
  const stripped = stripModelToolNameDecoration(toolName);
  if (stripped !== toolName && KNOWN_TOOL_NAMES.has(stripped)) return stripped;
  if (KNOWN_TOOL_NAMES.has(toolName)) return toolName;
  const alias = MODEL_TOOL_NAME_ALIASES[toolName];
  if (alias && KNOWN_TOOL_NAMES.has(alias)) return alias;
  const candidates = [...KNOWN_TOOL_NAMES]
    .map((candidate) => ({ candidate, distance: boundedEditDistance(toolName, candidate, 2) }))
    .filter((candidate) => candidate.distance <= 2)
    .sort((a, b) => a.distance - b.distance);
  if (candidates.length === 1) return candidates[0].candidate;
  if (candidates.length > 1 && candidates[0].distance < candidates[1].distance) return candidates[0].candidate;
  return toolName;
}

export function stripModelToolNameDecoration(toolName: string): string {
  return toolName
    .replace(/<\|channel\|>.*$/i, '')
    .replace(/<\|.*$/i, '')
    .trim();
}

export function isMalformedToolNameEnvelope(toolName: string): boolean {
  return /<\/?arg_(?:key|value)>/i.test(toolName)
    || /<\/?(?:tool|function|tool_call|function_call)\b/i.test(toolName)
    || (toolName.length > 80 && /[{}[\]":]/.test(toolName) && /<\//.test(toolName));
}

export function boundedEditDistance(left: string, right: string, maxDistance: number): number {
  if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    const current = [leftIndex];
    let rowMin = current[0];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      const value = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
      current[rightIndex] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    previous = current;
  }
  return previous[right.length] ?? maxDistance + 1;
}

// ── Guardrail detection ───────────────────────────────────────────────────

export function containsConcreteFoodCue(text: string): boolean {
  return /\b(?:smallest safe cue|tasting cue|concrete food cue|recipe move|try this|try it tonight)\b/i.test(text)
    || /\b\d+\s*(?:teaspoons?|tablespoons?|cups?|pinch(?:es)?)\b/i.test(text)
    || /\b(?:heat|stir|steep|mix)\b[\s\S]{0,60}\b\d+\s*(?:mins?|minutes?|hours?|°[FC])\b/i.test(text);
}

export function containsRecipeMeasurementLanguage(text: string): boolean {
  const spelledAmount = String.raw`(?:a|an|half|quarter|one|two|three|four|five|six|seven|eight|nine|ten)`;
  return /\b\d+(?:\s*[-\u2013]\s*\d+)?(?:\s*\/\s*\d+)?\s*(?:tsp|tbsp|teaspoons?|tablespoons?|cups?|ounces?|oz|pounds?|lbs?|grams?|g|ml|milliliters?|liters?|quarts?|gallons?|sticks?|cloves?|heads?|bunches?)\b/i.test(text)
    || /(?:[¼½¾⅓⅔⅛⅜⅝⅞]|\b\d+\/\d+)\s*(?:tsp|tbsp|teaspoons?|tablespoons?|cups?|ounces?|oz|pounds?|lbs?|grams?|g|ml|milliliters?|liters?|quarts?|gallons?|sticks?|cloves?|heads?|bunches?)\b/i.test(text)
    || /\b(?:one|half)[-\s]?cup\b/i.test(text)
    || new RegExp(String.raw`\b${spelledAmount}\s+(?:(?:small|large|tiny)\s+)?(?:of\s+|a\s+)?(?:tsp|tbsp|teaspoons?|tablespoons?|cups?|glass(?:es)?|bowls?|spoonfuls?|ounces?|oz|pounds?|lbs?|grams?|milliliters?|liters?|quarts?|gallons?|sticks?|cloves?|heads?|bunches?)\b`, 'i').test(text)
    || /\b\d+(?:\s*[-\u2013]\s*\d+)?\s*(?:mins?|minutes?|hrs?|hours?)\b/i.test(text)
    || /\b\d{2,4}\s*°?\s*[FC]\b/i.test(text)
    || /\bpreheat\b.*\b(?:oven|to)\b/i.test(text)
    || /\b(?:bake|roast|simmer|boil)\b.*\b(?:minutes?|hours?|degrees?|°)\b/i.test(text)
    || /\b(?:gentle\s+simmer|rolling\s+boil)\b/i.test(text);
}

export function containsRecipeProcedureOrAdaptationLanguage(text: string): boolean {
  const cookingVerbs = text.match(/\b(?:peel|grate|boil|mash|form|press|seal|fry|shallow-fry|simmer|strain|blend|knead|roll|stuff|marinate|bake|roast|saute|sauté|whisk|stir|mix|combine|cook|heat|top|taste|add|serve|chill|steep|sip)\b/gi) || [];
  const recipeBullets = text.match(/(?:^|\n)\s*[-*]\s*(?:simmer|add|serve|mix|blend|heat|stir|combine|cook)\b/gi) || [];
  if (recipeBullets.length >= 2) return true;
  if (new Set(cookingVerbs.map((match) => match.toLowerCase())).size >= 4) return true;
  return /\b(?:for your|adaptations?|replacement for|heart-healthier swaps?|halal chicken|vegan adaptation|gluten-free adaptations?|nut-free replacement)\b[\s\S]{0,500}\b(?:substitute|replace|swap|blend|certification|tofu|coconut cream|white beans|sunflower seeds)\b/i.test(text)
    || /\b(?:full substitution map|complex set of dietary needs|overlapping constraints|biggest challenges)\b/i.test(text)
    || /\bwhat the substitutions target\b[\s\S]{0,400}\b(?:original role|constraint|stand-?in)\b/i.test(text)
    || /\boriginal role\b[\s\S]{0,200}\bconstraint\b[\s\S]{0,200}\bstand-?in\b/i.test(text)
    || /\b(?:smallest memory cue|adapted first-pass bite)\b[\s\S]{0,250}\b(?:blend|replace|serve with|gluten-free|silken tofu|sunflower seed butter)\b/i.test(text)
    || /\bbefore I give you\b[\s\S]{0,200}\bsubstitution map\b/i.test(text)
    || /\btry this simple version\b[\s\S]{0,500}\b(?:simmer|serve with|add|sauce)\b/i.test(text)
    || /\bmake a simple (?:broth|sauce|slurry|mixture|paste)\b[\s\S]{0,250}\b(?:dash|pinch|squeeze|spoon|sip|simmer|mix|blend|taste)\b/i.test(text)
    || /\b(?:simple\s+)?tiny\s+sip\s+test\b[\s\S]{0,400}\b(?:boil|steep|cook|simmer|specific ingredients?)\b/i.test(text)
    || /\bminimum viable nostalgia bite\b[\s\S]{0,600}\btake\b[\s\S]{0,200}\btop\b[\s\S]{0,200}\btaste\b/i.test(text);
}

export function lacksMinimumCueLanguage(text: string): boolean {
  if (!text || text.length < 80) return false;
  const hasMarker = /\bminimum viable\b/i.test(text)
    || /\bfirst[-\s]?pass verification\b/i.test(text)
    || /\bfirst tiny check\b/i.test(text)
    || /\bdo not buy the exact suspected (?:dish|sweet|beverage|drink)\b/i.test(text)
    || /\bwhy this is minimum\b/i.test(text)
    || /\btiny amount of\b/i.test(text)
    || /\bone (?:sip|bite|spoon|teaspoon)\b/i.test(text);
  return !hasMarker;
}

export function containsGenericUncertaintyWaffle(text: string): boolean {
  return /\b(?:fits|matches|could\s+be|might\s+be|applies\s+to)\s+(?:dozens|many|lots|a\s+lot)\s+of\s+dishes\b/i.test(text)
    || /\bcould\s+point\s+to\s+(?:so\s+)?(?:many|lots|dozens|different)[\s\S]{0,60}\bdishes\b/i.test(text)
    || /\bcould\s+point\s+in\s+(?:quite\s+)?a\s+few\s+directions\b/i.test(text)
    || /\b(?:there\s+are\s+)?(?:dozens|many|lots|so\s+many\s+different)\s+(?:different\s+)?dishes\b[\s\S]{0,80}\b(?:fit|match|could|might|similar|point)\b/i.test(text);
}

export function containsStalledFallbackText(text: string): boolean {
  return /\bI've gathered enough information so far\.?\s+Let me work with what we have\.?\b/i.test(text.trim());
}

export function containsBlockedRecipeToolSynthesis(text: string): boolean {
  return /\brecipe generation was skipped\b/i.test(text)
    || /\boutside the minimum cue flow\b/i.test(text)
    || /\bsynthesize directly from the minimum viable nostalgia cue\b/i.test(text);
}

export function containsOverconfidentIdentityClaim(text: string): boolean {
  return /\b(?:almost certainly|definitely|clearly|you(?:'re| are) thinking of|your memory is spot[-\s]?on|it'?s called)\b/i.test(text)
    || /\bmost likely\s+(?:points?\s+to|matches|is|was|means|refers?\s+to)\b/i.test(text)
    || /\bit\s+points?\s+(?:strongly\s+)?toward\b/i.test(text)
    || /\b(?:your\s+)?(?:memory|description|clues?)\s+(?:points?|pointed)\s+(?:strongly\s+)?(?:toward|to)\b/i.test(text)
    || /\b(?:sounds like|likely maps to|maps to|is essentially|is basically)\s+(?:a|an|the)?\s*(?:classic\s+)?(?:[\p{L}\p{M}][\p{L}\p{M}'-]*)(?:\s+[\p{L}\p{M}][\p{L}\p{M}'-]*){0,5}\b/iu.test(text)
    || /\b(?:your dish is|you're remembering|you are remembering)\b/iu.test(text)
    || /\byour (?:\S+ )?dish is\b/iu.test(text)
    || /\bthis is\s+(?:a|an|the)?\s*(?:classic|traditional|iconic|famous)\s+[\p{L}\p{M}]/iu.test(text)
    || /\b(?:your|the)\s+(?:\S+\s+){0,2}(?:was making|made|served|prepared)\s+(?:a|an|the)?\s*[\p{L}\p{M}]/iu.test(text)
    || /\beverything you described matches\b/iu.test(text)
    || /\bthis is exactly\s+(?:what|how|the)\b/iu.test(text)
    || /\bthat's\s+\*\*/iu.test(text)
    || /\byour description matches\b/iu.test(text)
    || /\bmatches it perfectly\b/iu.test(text);
}

export function containsPrematureCandidateSpeculation(text: string, toolPayloads: Record<string, unknown>): boolean {
  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  const hasStableAnchor = Boolean(
    memory?.extractedClues.possibleDishNames.length ||
    memory?.extractedClues.culturalOrRegionalHints.some((hint) => !isBroadRegionalHint(hint)),
  );
  if (hasStableAnchor) return false;
  return /\bcould\s+be\s+(?:a|an|the)?\s*[\s\S]{0,120}\b(?:or\s+even|,\s*(?:a|an|the)?\s*[\p{L}\p{M}])/iu.test(text)
    || /\bmight\s+be\s+(?:a|an|the)?\s*[\s\S]{0,120}\b(?:or\s+even|,\s*(?:a|an|the)?\s*[\p{L}\p{M}])/iu.test(text)
    || /\bcould\s+come\s+from\b[\s\S]{0,160}\bbut\s+(?:it\s+)?could\s+also\b/iu.test(text)
    || /\bfrom\s+(?:a|an|the)?\s*[\s\S]{0,160}\bto\s+(?:a|an|the)?\s*[\s\S]{0,160}\bto\b/iu.test(text)
    || /\bfor example\s+[\s\S]{0,160},\s*[\s\S]{0,80}\bor\s+[\s\S]{0,80}\b/iu.test(text);
}

export function shouldClarifyBroadUncertainMemory(userMessage: string, toolPayloads: Record<string, unknown>): boolean {
  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  if (!memory) return false;

  const text = `${userMessage}\n${memory.normalizedMemory}`.toLowerCase();
  const explicitUncertainty = /\b(?:do\s+not|don't|not\s+sure|uncertain|no\s+idea|unknown|never\s+(?:learned|knew)|nobody\s+(?:left\s+)?(?:really\s+)?remembers?|no\s+one\s+(?:really\s+)?remembers?)\b[\s\S]{0,180}\b(?:country|region|dish\s+name|name|called|ingredients?|soup|sauce|stew)\b/i.test(text)
    || /\b(?:no\s+name|unknown\s+name|not\s+sure\s+what\s+it\s+was\s+called)\b/i.test(text)
    || /\bwhether\s+(?:it\s+)?(?:was\s+)?(?:a\s+)?(?:soup|sauce|stew)\b/i.test(text);
  const asksNotToGuess = /\b(?:do\s+not|don't)\s+(?:list\s+candidate(?:\s+dishes|\s+lists?|s)?|guess|pretend\s+certainty)\b/i.test(text)
    || /\bno\s+(?:guesses|candidate\s+lists?)\b/i.test(text);
  if (!explicitUncertainty && !asksNotToGuess) return false;

  const explicitlyRequestsCue = /\b(?:smallest|minimum|tiny|first)\b[\s\S]{0,80}\b(?:cue|sip|bite|test)\b/i.test(text);
  if (explicitlyRequestsCue && !asksNotToGuess && !explicitUncertainty) return false;

  const stableNames = memory.extractedClues.possibleDishNames.filter((name) => name.trim().length > 0);
  const stableRegions = memory.extractedClues.culturalOrRegionalHints.filter((hint) => !isBroadRegionalHint(hint));
  const concreteIngredients = memory.extractedClues.rememberedIngredients.filter((ingredient) =>
    !/\b(?:unknown|ingredient|herb|spice|sour|something)\b/i.test(ingredient),
  );
  if (asksNotToGuess && explicitUncertainty) return true;
  return stableNames.length === 0 && stableRegions.length === 0 && concreteIngredients.length === 0;
}

export function shouldClarifySparseUnanchoredMemory(userMessage: string, toolPayloads: Record<string, unknown>): boolean {
  if (isExplicitMinimumTestRequest(userMessage)) return false;
  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  if (!memory) return false;
  const text = `${userMessage}\n${memory.normalizedMemory}`.toLowerCase();
  if (/\bi\s+remember\s+something\b[\s\S]{0,160}\b(?:smelled|tasted|felt|looked|toasty|herby|aroma|texture)\b/i.test(text)) {
    return true;
  }
  const stableNames = memory.extractedClues.possibleDishNames.filter((name) => name.trim().length > 0);
  const stableRegions = memory.extractedClues.culturalOrRegionalHints.filter((hint) => !isBroadRegionalHint(hint));
  const concreteIngredients = memory.extractedClues.rememberedIngredients.filter((ingredient) =>
    !/\b(?:unknown|ingredient|herb|herby|spice|spiced|aromatic|something|toasty)\b/i.test(ingredient),
  );
  const sensoryOnly = memory.extractedClues.sensoryClues.length > 0 && concreteIngredients.length === 0;
  const sparseSomethingMemory = /\b(?:something|thing)\b[\s\S]{0,120}\b(?:smelled|tasted|felt|looked|toasty|herby|aroma|texture)\b/i.test(text);
  return stableNames.length === 0
    && stableRegions.length === 0
    && (sensoryOnly || sparseSomethingMemory);
}

export function hasSubstantialMemoryAnchors(memory: unknown): boolean {
  // Returns true when a follow-up message has given enough new anchors to proceed without
  // another clarification round: a location, a cultural/regional hint, or multiple ingredients.
  const m = memory as CollectedFoodMemory | undefined;
  if (!m) return false;
  return Boolean(m.userLocation?.trim())
    || (m.extractedClues?.culturalOrRegionalHints?.length ?? 0) > 0
    || (m.extractedClues?.rememberedIngredients?.length ?? 0) >= 2;
}

export function isExplicitMinimumTestRequest(text: string): boolean {
  return /\b(?:minimum viable|minimum|smallest|smallest safe|smallest local|tiny|first|local)\b[\s\S]{0,60}\b(?:test|cue|try|taste|nostalgia|sip|bite|drink)\b/i.test(text)
    || /\b(?:test|cue|try|taste|sip|bite|drink)\b[\s\S]{0,60}\b(?:minimum viable|minimum|smallest|tiny|first|local)\b/i.test(text);
}

export function getStringArray(value: unknown, key: string): string[] {
  if (!value || typeof value !== 'object') return [];
  const item = (value as Record<string, unknown>)[key];
  return Array.isArray(item) ? item.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

// ── Sanitization ───────────────────────────────────────────────────────────

export function sanitizeRecipeStyleCueLanguage(text: string): string {
  return text
    .replace(/(?:[¼½¾⅓⅔⅛⅜⅝⅞]|\b\d+\/\d+)\s*(?:tsp|tbsp|teaspoons?|tablespoons?|cups?|ounces?|oz|pounds?|lbs?|grams?|g|ml|milliliters?|liters?|quarts?|gallons?|sticks?|cloves?|heads?|bunches?)\b/gi, 'a small amount of')
    .replace(/\b(?:one|half)[-\s]?cup\b/gi, 'tiny sip')
    .replace(/\bfull\s+recipe\b/gi, 'full dish')
    .replace(/\b\d+(?:\s*[-\u2013]\s*\d+)?(?:\s*\/\s*\d+)?\s*(?:tsp|tbsp|teaspoons?|tablespoons?|cups?|ounces?|oz|pounds?|lbs?|grams?|g|ml|milliliters?|liters?|quarts?|gallons?|sticks?|cloves?|heads?|bunches?)\b/gi, 'a small amount of')
    .replace(/\b(?:a|an|half|quarter|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:(?:small|large|tiny)\s+)?(?:of\s+|a\s+)?(?:tsp|tbsp|teaspoons?|tablespoons?|cups?|glass(?:es)?|bowls?|spoonfuls?|ounces?|oz|pounds?|lbs?|grams?|milliliters?|liters?|quarts?|gallons?|sticks?|cloves?|heads?|bunches?)\b/gi, 'a tiny sip or bite')
    .replace(/\b\d+(?:\s*[-\u2013]\s*\d+)?\s*(?:mins?|minutes?|hrs?|hours?)\b/gi, 'briefly')
    .replace(/\b\d{2,4}\s*°?\s*[FC]\b/gi, 'gentle heat')
    .replace(/\b(?:gentle\s+simmer|rolling\s+boil)\b/gi, 'gentle heat')
    .replace(/\bpreheat\b[^.?!]*(?:[.?!]|$)/gi, 'Keep this to a tiny tasting cue, not an oven recipe. ')
    .replace(/\b(?:serves?|servings?|serving)\s*:?\s*\d+\b/gi, 'a tiny test portion')
    .replace(/\bexact\s+recipe\s+(?:follows|below|is)\b\.?/gi, 'This is not a full recipe.')
    .replace(/\ba small amount of\s+of\b/gi, 'a small amount of')
    .replace(/\babout\s+briefly\b/gi, 'briefly')
    .replace(/\bfor\s+briefly\b/gi, 'briefly')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function sanitizeMinimumCueFallbackText(text: string): string {
  return sanitizeRecipeStyleCueLanguage(text)
    .replace(/\btiny\s+sip\s+sip\b/gi, 'tiny sip')
    .replace(/\bsip\s+sip\b/gi, 'sip')
    .replace(/\bexact\s+ingredients\b/gi, 'exact components')
    .replace(/\bordinary grocery or pantry ingredients\b/gi, 'ordinary grocery or pantry items')
    .replace(/\bingredients?\b/gi, 'items')
    .replace(/\bnot an oven recipe\b/gi, 'not an oven meal')
    .replace(/\brecipe\b/gi, 'dish')
    .replace(/\bbriefly\s+min\b/gi, 'briefly')
    .trim();
}

export function sanitizeMinimumCueFallbackBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => sanitizeMinimumCueFallbackText(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sanitizeFinalAnswerTrustBoundaryLanguage(text: string): string {
  const revised = text
    .replace(/(?:^|[.?!]\s*|\n)\s*(?:[-*]\s*)?[^.\n?!]*?(?:I\s+am\s+not\s+browsing|I\s+am\s+Achiote|built\s+into\s+this\s+specific\s+toolset|specific\s+toolset|toolset|workflow)[^.\n?!]*?(?:[.?!]|$)/gim, '\n')
    .replace(/\bafter\s+(?:browsing|searching|checking|looking\s+up)\b[:,]?\s*/gi, '')
    .replace(/\bI\s+am\s+Achiote\b[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/\bI\s+am\s+not\s+browsing\b[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/\bI(?:'ve|\s+have)?\s+browsed\b[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/\bI\s+just\s+(?:checked|searched|looked\s+up|browsed)\b[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/\bI\s+do\s+not\s+browse\b[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/\bMy\s+model\b[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/\bI\s+cannot\s+browse\b[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/\b[^.?!]*?(?:ignore\s+Achiote|Achiote\s+(?:assistant|app|tool|toolset|workflow|model|server|searched|browsed)|browse)\b[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/\b[^.?!]*?(?:specific\s+toolset|toolset|workflow)\b[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/(?:^|\n)\s*(?:[-*]\s*)?[^.\n?!]*?(?:medical advice|legal advice|professional advice|medically safe|legally safe|heart-healthy|lowers cholesterol|cures?)[^.\n?!]*?(?:[.?!]|$)/gim, '\n')
    .replace(/\bI\s+cannot\s+give\b[^.?!]*?(?:medical advice|legal advice|professional advice)[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/\b(?:OpenAI|Anthropic|Claude|GPT[-\s]?\d[\w.-]*|gpt[-\s]?\d[\w.-]*|fake-hostile-model|provider(?:\/model)?|model identity)\b[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/\b(?:I(?:'ve|\s+have)?\s+(?:browsed|searched|checked|looked\s+up)|Achiote\s+(?:browsed|searched|checked)|live web|live grocery prices?|live prices?|current prices|current grocery prices|live search results?|web results?|under\s+\$\d+)\b[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/\b[^.?!]*?\$\d+(?:\.\d{1,2})?[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/\b(?:a\s+)?(?:tiny\s+)?(?:drop|drops?|few\s+drops)\s+of\s+dill\s+oil\b/gi, 'a pinch of crushed fresh or dried dill')
    .replace(/\bdill\s+oil\b/gi, 'crushed fresh or dried dill')
    .replace(/\b(?:a\s+)?(?:tiny\s+)?(?:drop|drops?|few\s+drops)\s+of\s+([a-z][a-z\s-]{0,30}?)\s+essential\s+oils?\b/gi, (_match, herb: string) => `a pinch of crushed fresh or dried ${herb.trim()}`)
    .replace(/\b([a-z][a-z\s-]{0,30}?)\s+essential\s+oils?\b/gi, (_match, herb: string) => `crushed fresh or dried ${herb.trim()}`)
    .replace(/\b(?:This\s+)?(?:medically safe|medical(?:ly)?|heart-healthy|cure|cures|lowers cholesterol|(?:treats?|prevents?|diagnoses?)\s+(?:a\s+|an\s+|the\s+)?(?:illness|disease|condition|symptoms?|inflammation|cholesterol|infection|diabetes|heart disease|medical problem))\b[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/\b(?:legal(?:ly)? safe|legal advice|medical advice|professional advice)\b[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/\bFirst-pass verification bite\b/g, 'first-pass verification bite')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return revised || 'Use this only as a first-pass verification bite; keep the result evidence-bounded and revise if the sensory cue is wrong.';
}

// ── Helpers for clarification response ─────────────────────────────────────

function extractNegatedTerms(text: string): string[] {
  const matches = [...text.matchAll(/\b(?:not|no|without|wasn['']?t|was not|isn['']?t|is not|aren['']?t|are not)\b[^.:?!;]{0,48}\b[\p{L}\p{M}]+(?:\s+[\p{L}\p{M}]+){0,3}\b/giu)];
  return [...new Set(matches.map((m) => m[0].trim()))].filter((m) => m.length > 4).slice(0, 4);
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

function filterAnchorsForConstraints(anchors: string[], constraints: string[]): string[] {
  return anchors.filter((anchor) => !isRestrictedAnchorForConstraints(anchor, constraints));
}

export function buildEvidencePreamble(toolPayloads: Record<string, unknown>, userMessage?: string): string {
  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  const plan = toolPayloads.plan_dish_research as DishResearchPlan | undefined;
  const top = plan?.hypotheses?.[0];
  const clues = memory?.extractedClues;
  const constraints = userMessage ? inferSafetyConstraints(userMessage) : [];
  const topName = top && !/^Unidentified\b/i.test(top.name) && !isRestrictedAnchorForConstraints(top.name, constraints)
    ? top.name
    : '';
  const userAnchors = [
    ...(clues?.culturalOrRegionalHints ?? []),
    ...(clues?.possibleDishNames ?? []),
    ...(clues?.rememberedIngredients ?? []),
    ...(clues?.sensoryClues ?? []),
  ].filter((anchor) => !isBroadRegionalHint(anchor) && !isRestrictedAnchorForConstraints(anchor, constraints)).slice(0, 8);
  const inferred = [
    topName,
    ...(top?.whatWouldConfirm ?? []).slice(0, 3),
  ].filter((anchor) => Boolean(anchor) && !isRestrictedAnchorForConstraints(anchor, constraints));
  const unknown = top?.confidence === 'Low' || !top ? 'exact name and family version' : 'family version and exact proportions';
  const correction = userMessage && /\b(?:spelling|wrong|mistake|sound(?:ed)? like|called it)\b/i.test(userMessage) && topName
    ? ` Likely correction: your fragment points toward ${topName}; keep that as a research start, not a final identity.`
    : '';
  const negated = userMessage ? extractNegatedTerms(userMessage) : [];

  const researchedFacts: string[] = [];
  const resolved = toolPayloads.resolve_dish_name as
    | { dishName?: string; canonicalName?: string; region?: string; confidence?: string; aliases?: string[] }
    | undefined;
  if (resolved?.canonicalName && !/^Unknown$/i.test(resolved.canonicalName)) {
    const userRegionHint = (toolPayloads.collect_food_memory as { extractedClues?: { culturalOrRegionalHints?: string[] } } | undefined)?.extractedClues?.culturalOrRegionalHints?.find((h) => Boolean(h));
    const displayRegion = (resolved.region && !/^unknown$/i.test(resolved.region)) ? resolved.region : (userRegionHint ?? 'unknown');
    researchedFacts.push(`Dish resolved: "${resolved.canonicalName}" (confidence: ${resolved.confidence ?? 'unknown'}, region: ${displayRegion})`);
  }
  const searched = toolPayloads.search_web as
    | { results?: Array<{ title?: string; snippet?: string }> }
    | undefined;
  for (const result of (searched?.results ?? []).slice(0, 2)) {
    if (result.snippet?.trim()) researchedFacts.push(result.snippet.trim().replace(/[\u2014\u2013]/g, ', '));
  }

  if (userAnchors.length === 0 && inferred.length === 0 && negated.length === 0 && constraints.length === 0 && researchedFacts.length === 0) return '';
  return [
    `What I heard: ${userAnchors.length > 0 ? userAnchors.join(', ') : 'not enough yet'}.`,
    negated.length > 0 ? `What not to assume: ${negated.join('; ')}.` : '',
    inferred.length > 0 ? `Best research start: ${inferred.join('; ')}.${correction}` : '',
    constraints.length > 0 ? `Food boundaries: ${constraints.join(', ')}.` : '',
    researchedFacts.length > 0 ? `What the tools found: ${researchedFacts.join('; ')}.` : '',
    `Still uncertain: ${unknown}.`,
  ].filter(Boolean).join('\n');
}

export function buildClarificationOnlyResponse(toolPayloads: Record<string, unknown>, userMessage?: string): string {
  const constraints = userMessage ? inferSafetyConstraints(userMessage) : [];
  const memoryQuestions = filterAnchorsForConstraints(getStringArray(toolPayloads.collect_food_memory, 'nextQuestions'), constraints);
  const planQuestions = filterAnchorsForConstraints(getStringArray(toolPayloads.plan_dish_research, 'questionsForUser'), constraints);
  const questions = [...new Set([...planQuestions, ...memoryQuestions])].slice(0, 3);
  const selectedQuestions = questions.length > 0 ? questions : [
    'Where did you eat this, or where was it from? Even a country, region, city, or community helps.',
    'Do you remember anything about the name, even a rough sound-alike?',
  ];

  // Build a context-aware preamble based on what signals are already present
  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  const sensoryClues = filterAnchorsForConstraints(memory?.extractedClues?.sensoryClues ?? [], constraints);
  const ingredients = filterAnchorsForConstraints(memory?.extractedClues?.rememberedIngredients ?? [], constraints);
  const inferred = memory?.inferredContext?.culturalOrRegional ?? [];
  const nonBroadInferred = inferred.filter((c) => !isBroadRegionalHint(c.label));

  let preamble: string;
  if (nonBroadInferred.length > 0) {
    // Acknowledge the cultural inference so the user knows we heard them
    const context = nonBroadInferred[0].label.replace(/\s+context$/i, '').toLowerCase();
    preamble = `Your description already points toward a ${context} tradition. I just need one more anchor to give you a real test instead of a guess.`;
  } else if (sensoryClues.length > 0 || ingredients.length > 0) {
    const anchor = [...sensoryClues, ...ingredients].slice(0, 2).join(' and ');
    preamble = `The ${anchor} you mentioned is a real anchor. One more detail will keep the first test specific rather than generic.`;
  } else {
    preamble = 'Before I give you a tasting cue, I need one or two details so I do not fake certainty.';
  }

  const evidencePreamble = buildEvidencePreamble(toolPayloads, userMessage);
  const parts = evidencePreamble ? [evidencePreamble, '', preamble] : [preamble];
  return [
    ...parts,
    '',
    ...selectedQuestions.map((question, index) => `${index + 1}. ${question}`),
    '',
    'Those answers decide the dish family and keep the first test cheap, specific, and tied to the memory instead of a guess.',
  ].join('\n');
}
