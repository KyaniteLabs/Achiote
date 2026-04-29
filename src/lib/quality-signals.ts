import type { CollectedFoodMemory, DishResearchPlan, MinimumViableNostalgiaCue } from './types.js';

export type QualityMemoryType = 'beverage' | 'dish' | 'sauce_broth' | 'confectionery' | 'unknown';
export type QualityMissingDimension = 'missing_name' | 'missing_region' | 'missing_ingredient' | 'missing_format';
export type QualitySearchOutcome = 'called' | 'capped' | 'skipped' | 'not_applicable';
export type QualityCacheOutcome = 'unavailable' | 'miss' | 'hit' | 'fallback';

export interface AskQualitySignal {
  memoryType: QualityMemoryType;
  familyKey: string;
  regionKey: string;
  languageKey: string;
  missing: QualityMissingDimension[];
  search: QualitySearchOutcome;
  cache: QualityCacheOutcome;
  guarded: string;
}

export interface AskQualitySignalInput {
  toolPayloads: Record<string, unknown>;
  calledTools: string[];
  guarded?: string;
  cache?: string;
}

export interface QualitySignalReport {
  total: number;
  byMemoryType: Record<string, number>;
  byFamily: Record<string, number>;
  byRegion: Record<string, number>;
  byGuard: Record<string, number>;
  bySearch: Record<string, number>;
  byCache: Record<string, number>;
  missing: Record<string, number>;
}

const KNOWN_GUARDS = new Set([
  'none',
  'provider_context_deterministic_recovery',
  'minimum_cue_deterministic_completion',
  'missing_research_plan_clarification',
  'premature_concrete_cue',
  'generic_uncertainty_clarification',
  'premature_candidate_speculation',
  'broad_memory_clarification',
  'recipe_measurement_sanitized',
  'trust_boundary_sanitized',
  'explicit_minimum_cue_fallback',
]);

const BROAD_REGION = /\b(?:latin\s+america|hispanic|spanish-speaking|asia|europe|africa|middle\s+east|mediterranean|caribbean|south\s+america|central\s+america)\b/i;
const FAMILY_BUCKETS = new Set([
  'beverage_like',
  'sweet_like',
  'soup_sauce_stew',
  'starch_base',
  'protein_base',
  'vegetable_base',
  'fermented_sour',
  'dish_like',
  'unknown',
]);

export function buildAskQualitySignal(input: AskQualitySignalInput): AskQualitySignal {
  const memory = input.toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  const plan = input.toolPayloads.plan_dish_research as DishResearchPlan | undefined;
  const cue = input.toolPayloads.generate_minimum_viable_nostalgia as MinimumViableNostalgiaCue | undefined;
  const memoryType = inferMemoryType(memory, cue);

  return {
    memoryType,
    familyKey: inferFamilyBucket(memory, plan, cue, memoryType),
    regionKey: normalizeRegion(memory),
    languageKey: normalizeKey(memory?.inferredContext.language[0]?.label ?? 'unknown'),
    missing: inferMissing(memory),
    search: inferSearch(input.calledTools, input.toolPayloads, plan),
    cache: normalizeCache(input.cache),
    guarded: normalizeGuard(input.guarded),
  };
}

export function emptyQualitySignalReport(): QualitySignalReport {
  return {
    total: 0,
    byMemoryType: {},
    byFamily: {},
    byRegion: {},
    byGuard: {},
    bySearch: {},
    byCache: {},
    missing: {},
  };
}

export function recordQualitySignal(report: QualitySignalReport, signal: AskQualitySignal): void {
  report.total += 1;
  increment(report.byMemoryType, signal.memoryType);
  increment(report.byFamily, signal.familyKey);
  increment(report.byRegion, signal.regionKey);
  increment(report.byGuard, signal.guarded);
  increment(report.bySearch, signal.search);
  increment(report.byCache, signal.cache);
  for (const dimension of signal.missing) increment(report.missing, dimension);
}

function inferMemoryType(memory?: CollectedFoodMemory, cue?: MinimumViableNostalgiaCue): QualityMemoryType {
  const signals = qualitySignalsText(memory, cue);
  if (/\b(?:beverage|drink|bebida|sip|horchata|agua|juice|soda|tea|coffee|barley|cebada)\b/i.test(signals)) return 'beverage';
  if (/\b(?:candy|confection|sweet-texture|brittle|fudge|halva|dessert|cookie)\b/i.test(signals)) return 'confectionery';
  if (/\b(?:sauce|broth|soup|stew|porridge|gravy|caldo|sour|tangy)\b/i.test(signals)) return 'sauce_broth';
  if (memory?.extractedClues.possibleDishNames.length || cue) return 'dish';
  return 'unknown';
}

function qualitySignalsText(memory?: CollectedFoodMemory, cue?: MinimumViableNostalgiaCue): string {
  const signals = [
    cue?.title,
    cue?.format,
    ...(cue?.components.map((component) => `${component.role} ${component.criticalElement} ${component.flavorProfile}`) ?? []),
    memory?.normalizedMemory,
    ...(memory?.extractedClues.sensoryClues ?? []),
    ...(memory?.extractedClues.rememberedIngredients ?? []),
  ].filter(Boolean).join(' ');
  return signals;
}

function inferFamilyBucket(
  memory: CollectedFoodMemory | undefined,
  plan: DishResearchPlan | undefined,
  cue: MinimumViableNostalgiaCue | undefined,
  memoryType: QualityMemoryType,
): string {
  const signals = [
    qualitySignalsText(memory, cue),
    ...(plan?.hypotheses.flatMap((hypothesis) => hypothesis.whyPossible) ?? []),
  ].join(' ');
  const bucket =
    memoryType === 'beverage' ? 'beverage_like'
      : memoryType === 'confectionery' ? 'sweet_like'
        : memoryType === 'sauce_broth' ? 'soup_sauce_stew'
          : /\b(?:rice|corn|maize|wheat|bread|noodle|dumpling|starch|cassava|yuca|potato|plantain)\b/i.test(signals) ? 'starch_base'
            : /\b(?:chicken|beef|pork|fish|shrimp|goat|lamb|egg|meat|seafood)\b/i.test(signals) ? 'protein_base'
              : /\b(?:greens?|leafy|vegetable|bean|lentil|peas?|squash|pepper|tomato)\b/i.test(signals) ? 'vegetable_base'
                : /\b(?:pickle|ferment|fermented|sour|tangy|vinegar|brine)\b/i.test(signals) ? 'fermented_sour'
                  : memoryType === 'dish' ? 'dish_like'
                    : 'unknown';
  return FAMILY_BUCKETS.has(bucket) ? bucket : 'unknown';
}

function normalizeRegion(memory?: CollectedFoodMemory): string {
  const region = [
    ...(memory?.extractedClues.culturalOrRegionalHints ?? []),
    ...(memory?.inferredContext.culturalOrRegional.map((hint) => hint.label) ?? []),
  ].find((hint) => hint.trim().length > 0 && !BROAD_REGION.test(hint));
  return normalizeKey(region ?? 'unknown');
}

function inferMissing(memory?: CollectedFoodMemory): QualityMissingDimension[] {
  const missing = new Set<QualityMissingDimension>();
  const info = (memory?.missingInformation ?? []).join(' ');
  const normalized = (memory?.normalizedMemory ?? '').toLowerCase();
  if (!memory?.extractedClues.possibleDishNames.length || /\b(?:dish name|name)\b/.test(info)) missing.add('missing_name');
  if (!normalizeRegion(memory) || normalizeRegion(memory) === 'unknown' || /\b(?:country|island|region|town|community)\b/.test(info)) missing.add('missing_region');
  if (!memory?.extractedClues.rememberedIngredients.length || /\b(?:core ingredient|ingredients?)\b/.test(info)) missing.add('missing_ingredient');
  if (/\b(?:format|serving format)\b/i.test(info)
    || /\b(?:whether|not sure|unsure|unknown|do not know|don't know|maybe|could have been)\b[^.?!]*(?:soup|sauce|stew|porridge|drink|beverage|fried|baked|solid|liquid|format)\b/.test(normalized)
    || /\b(?:soup|sauce|stew|porridge|drink|beverage|fried|baked|solid|liquid)\b[^.?!]*(?:or|not sure|unsure|unknown|do not know|don't know|maybe|could have been)\b/.test(normalized)) {
    missing.add('missing_format');
  }
  return [...missing].sort();
}

function inferSearch(calledTools: string[], toolPayloads: Record<string, unknown>, plan?: DishResearchPlan): QualitySearchOutcome {
  const search = toolPayloads.search_web as { capReached?: unknown } | undefined;
  if (search?.capReached === true) return 'capped';
  if (calledTools.includes('search_web')) return 'called';
  if (plan?.searchQueries?.length === 0 || plan?.researchRequired === false) return 'not_applicable';
  return 'skipped';
}

function normalizeCache(value?: string): QualityCacheOutcome {
  if (value === 'hit' || value === 'miss' || value === 'fallback') return value;
  return 'unavailable';
}

function normalizeGuard(value?: string): string {
  const guard = normalizeKey(value || 'none');
  return KNOWN_GUARDS.has(guard) ? guard : 'other';
}

function normalizeKey(value: string): string {
  const normalized = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return normalized || 'unknown';
}

function increment(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}
