/**
 * Transport-neutral /ask orchestration engine.
 *
 * Extracted verbatim from http-server.ts handleAsk (the SSE `send` closure is replaced by an injected
 * `emit` sink). This module is free of HTTP, auth, billing, and SSE-frame specifics so the CLI (stdout
 * sink) and MCP (buffering sink) surfaces can drive the same orchestration. The emitted event NAMES,
 * ORDER, and DATA are byte-identical to the original HTTP path — see
 * tests/ask-orchestration-characterization.test.ts.
 */
import type { AskHistoryItem, AskImage, AskModelResponse, AskSession } from '../lib/ask-provider.js';
import type { ProviderRuntime } from '../lib/provider-runtime.js';
import { defaultEngineLogger, type Logger } from './logger.js';
import type { CacheInitStatus } from '../lib/cache-path.js';
import type { QualitySignalReport } from '../lib/quality-signals.js';
import { createAskTurnState, runDeterministicWorkflowPlan } from '../lib/ask-controller.js';
import { buildAskCaseFile, formatAskCaseFileForModel } from '../lib/ask-case-file.js';
import { buildMemoryReceipt } from '../lib/memory-receipt.js';
import { buildAskQualitySignal, inferAskCacheOutcome, recordQualitySignal } from '../lib/quality-signals.js';
import { filterMemoryResearchFacts, filterMemoryResearchSearchResults, buildMemoryRelevanceContext } from '../lib/research-evidence-filter.js';
import { filterRepeatedToolCalls } from '../lib/tool-loop.js';
import { inferUserLocationFromMessage as inferUserLocation } from '../lib/user-location.js';
import type { CollectedFoodMemory, DishResearchPlan, MinimumViableNostalgiaCue, ReconstructionDossier } from '../lib/types.js';
import {
  anthropicTools as TOOLS,
  executeToolDefinition,
  outputSchemas,
  ToolExecutionError,
  type AchioteToolExecutionContext,
} from '../tools/tool-registry.js';
import {
  inferSafetyConstraints,
  buildGroundedSearchQuery,
  sanitizeGroundedSearchQuery,
  isLatestCorrectionMessage,
  buildCorrectedMemoryText,
  buildAccumulatedMemoryText,
  isRecord,
} from '../lib/ask-memory-correction.js';
import { escapeRegExp } from '../lib/food-memory-text.js';
import {
  KNOWN_TOOL_NAMES,
  normalizeModelToolCalls,
  containsConcreteFoodCue,
  containsRecipeMeasurementLanguage,
  containsRecipeProcedureOrAdaptationLanguage,
  lacksMinimumCueLanguage,
  sanitizeRecipeStyleCueLanguage,
  sanitizeMinimumCueFallbackBlock,
  sanitizeFinalAnswerTrustBoundaryLanguage,
  containsGenericUncertaintyWaffle,
  containsStalledFallbackText,
  containsBlockedRecipeToolSynthesis,
  containsOverconfidentIdentityClaim,
  containsPrematureCandidateSpeculation,
  shouldClarifyBroadUncertainMemory,
  shouldClarifySparseUnanchoredMemory,
  hasSubstantialMemoryAnchors,
  buildClarificationOnlyResponse,
  isExplicitMinimumTestRequest,
} from '../lib/ask-guardrails.js';
import {
  hasSubstitutionBasisReady,
  isSubstitutionPlan,
  buildSubstitutionBasisResponse,
  buildSourcingGuidanceResponse,
  extractSubstitutionTargets,
  hasSensorySignal,
  buildMinimumCueCompletedResponse,
  buildEvidenceBoundedMinimumCueResponse,
  buildResearchGroundedForcedCueResponse,
  containsCueFamilyMismatch,
  ensureCueQualityLanguage,
  appendGroundedCitation,
} from '../lib/ask-response-builder.js';

// ── Event sink ────────────────────────────────────────────────────────────────
// The engine speaks in raw (event, data) pairs. The HTTP surface adapts this to an SSE frame; a CLI
// surface writes to stdout; an MCP surface buffers. `emit` REPLACES the former SSE `send` closure.
export type AskEventSink = (event: string, data: unknown) => void;

type SseSender = (event: string, data: unknown) => void;
type DoneSender = (data?: Record<string, unknown>) => void;

export type DataConsent = {
  analytics: boolean;
  qualitySignals: boolean;
  savedMemory: boolean;
  familyConfirmation: boolean;
  publicContribution: boolean;
};

/** Runtime objects the engine needs injected (constructed once by the host surface). */
export type AskEngineDeps = {
  providerRuntime: ProviderRuntime;
  toolContext: AchioteToolExecutionContext;
  qualitySignalReport: QualitySignalReport;
  cacheState: CacheInitStatus;
  deterministicToolChain: boolean;
  finalSynthesisMaxTokens: number;
  finalSynthesisTimeoutMs: number;
  /** Returns true once the downstream stream is closed; mid-loop writes short-circuit when set. */
  streamClosed?: () => boolean;
  /**
   * Structured diagnostics sink. Replaces the engine's former bare `console.log`/`console.warn` writes
   * to stdout. Each surface injects the sink it needs (HTTP: JSON-stderr, CLI: text-stderr, MCP: no-op).
   * Optional; defaults to a JSON-stderr logger so behavior is unchanged when a caller omits it.
   */
  logger?: Logger;
};

export type RunAskWorkflowInput = {
  userMessage: string;
  history?: AskHistoryItem[];
  images: AskImage[];
  consent: DataConsent;
};

// ── Engine-owned configuration ──────────────────────────────────────────────────
// Pure config derived deterministically at load (identical to the values the HTTP layer reads). These
// belong to the engine now; nothing else mutates them.
const DISABLE_SEARCH_WEB = process.env.ACHIOTE_DISABLE_SEARCH_WEB === 'true';
const ENABLE_LOCAL_SOURCING_SEARCH = process.env.ACHIOTE_ENABLE_LOCAL_SOURCING_SEARCH === 'true';
const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));
const DESCRIPTIVE_HYPHEN_DISH_TOKENS = new Set([
  'aroma',
  'broth',
  'cold',
  'crispy',
  'drink',
  'egg',
  'fat',
  'green',
  'gravy',
  'herb',
  'hot',
  'oily',
  'pale',
  'potato',
  'rice',
  'sauce',
  'savory',
  'sour',
  'spice',
  'starch',
  'sweet',
  'tart',
  'thick',
  'thin',
  'warm',
]);

// ── Per-call run context (constructed fresh at the top of every runAskWorkflow) ────────────────────
// The engine holds NO mutable module-scoped per-call state. Everything an invocation needs is bundled
// into this immutable context object and threaded explicitly into every helper that touches it. This
// is what prevents cross-request state bleed when two ask runs (e.g. an HTTP /ask and an in-process MCP
// reconstruct_food_memory) execute concurrently in the same process.
type AskRunContext = {
  providerRuntime: ProviderRuntime;
  toolContext: AchioteToolExecutionContext;
  qualitySignalReport: QualitySignalReport;
  cacheState: CacheInitStatus;
  deterministicToolChain: boolean;
  finalSynthesisMaxTokens: number;
  finalSynthesisTimeoutMs: number;
  logger: Logger;
};

// ── Orchestration helpers (moved verbatim from http-server.ts) ──────────────────────────────────

function enforceAllergyProfessionalBoundary(text: string, userMessage: string): string {
  const constraints = inferSafetyConstraints(userMessage);
  const hasAllergyBoundary = constraints.some((constraint) => /\ballergy\b|dairy-free|gluten-free/i.test(constraint))
    || /\b(?:allerg(?:y|ic|ies|en)|intoleran(?:ce|t)|anaphylaxis|severely allergic|tree nuts?|peanuts?)\b/i.test(userMessage);
  if (!hasAllergyBoundary) return text;
  const boundedText = sanitizeNamedAllergenExamples(sanitizeFoodSafetyClaimLanguage(text), constraints);
  if (/\b(?:qualified professional|medical professional|doctor|allergist|clinician|dietitian)\b/i.test(boundedText)) return boundedText;
  return [
    boundedText,
    'Because you named an allergy, check any new substitute with a qualified professional before tasting.',
  ].filter(Boolean).join('\n\n');
}

function sanitizeFoodSafetyClaimLanguage(text: string): string {
  return text
    .replace(/\bmedically safe\b/gi, 'medically appropriate')
    .replace(/\ballergen-free\b/gi, 'without the named allergen only when labels and a qualified professional support that')
    .replace(/\b(?:shellfish|shrimp|crab|lobster|clam|mussel|oyster|scallop|fish|seafood|nut|peanut|tree nut|dairy|gluten|egg|soy|sesame)[-\s]?free\s+swaps?\b/gi, 'substitutes that avoid the named allergen only when labels and a qualified professional support that')
    .replace(/\b(?:will|would|should|can)\s+not\s+trigger\s+(?:your\s+)?reaction\b/gi, 'still need your own label checks and professional guidance')
    .replace(/\b(?:won['’]?t|wouldn['’]?t|shouldn['’]?t|cannot|can['’]?t)\s+trigger\s+(?:your\s+)?reaction\b/gi, 'still need your own label checks and professional guidance')
    .replace(/\ball\s+use\s+shellfish\b/gi, 'may involve the named allergen')
    .replace(/\bno\s+shrimp\s+or\s+crab\s+involved\b/gi, 'without the named allergens')
    .replace(/\bno\s+shellfish\s+anywhere\s+near\s+it\b/gi, 'without the named allergens')
    .replace(/\bno\s+shellfish\b/gi, 'without the named allergens')
    .replace(/\bwithout\s+(?:the\s+)?shrimp\s+and\s+crab\b/gi, 'without the named allergens')
    .replace(/\blegally safe\b/gi, 'legally appropriate')
    .replace(/\bsafety note\b/gi, 'allergy boundary')
    .replace(/\bfood safety\b/gi, 'food boundary')
    .replace(/\bsafely\b/gi, 'with the allergy boundary in mind')
    .replace(/\bsafe neutral\b/gi, 'plain neutral')
    .replace(/\bsafe liquid\b/gi, 'plain liquid')
    .replace(/\bsafe pantry\b/gi, 'known tolerated pantry')
    .replace(/\bsafe local\b/gi, 'known tolerated local')
    .replace(/\bsafe remembered\b/gi, 'already tolerated remembered')
    .replace(/\bsafe edible\b/gi, 'known edible')
    .replace(/\bsafe cue\b/gi, 'first cue')
    .replace(/\bsmallest safe\b/gi, 'smallest')
    .replace(/\bonly if safe\b/gi, 'only if already tolerated')
    .replace(/\bif safe\b/gi, 'if already tolerated')
    .replace(/\bsafe\b/gi, 'already tolerated');
}

function sanitizeNamedAllergenExamples(text: string, constraints: string[]): string {
  let revised = text;
  if (constraints.includes('shellfish allergy')) {
    revised = revised
      .replace(/\b[A-Z][^.!?]{0,240}\b(?:arroz\s+con\s+mariscos|hipon|paella|jambalaya|shellfish|shrimp|crab)[^.!?]*[.!?]/g, 'Different regional rice dishes use very different seasoning, color, and texture. ')
      .replace(/\b(?:shrimp\s*(?:-|and|&)\s*crab|crab\s*(?:-|and|&)\s*shrimp)\s+([a-z][a-z -]{1,40})\b/gi, 'restricted-ingredient $1')
      .replace(/\b(?:shrimp\s*(?:-|and|&)\s*crab|crab\s*(?:-|and|&)\s*shrimp)\b/gi, 'the named allergens')
      .replace(/\b(?:arroz\s+con\s+mariscos|hipon|shrimp|prawns?|crab|lobster|oysters?|clams?|mussels?|scallops?)\b/gi, 'the named allergen')
      .replace(/\bshellfish\b/gi, 'the named allergen')
      .replace(/(?:Different regional rice dishes use very different seasoning, color, and texture\.\s*){2,}/g, 'Different regional rice dishes use very different seasoning, color, and texture. ');
    revised = keepFirstRepeatedSentence(revised, 'Different regional rice dishes use very different seasoning, color, and texture.');
  }
  return revised;
}

function keepFirstRepeatedSentence(text: string, sentence: string): string {
  let seen = false;
  const pattern = new RegExp(`${escapeRegExp(sentence)}\\s*`, 'g');
  return text.replace(pattern, () => {
    if (seen) return '';
    seen = true;
    return `${sentence} `;
  });
}

function payloadForModelToolResult(toolName: string, payload: unknown, userMessage: string): unknown {
  if (toolName !== 'collect_food_memory') return payload;
  const constraints = inferSafetyConstraints(userMessage);
  if (constraints.length === 0 || !isRecord(payload)) return payload;
  const extractedClues = isRecord(payload.extractedClues) ? payload.extractedClues : {};
  return {
    ...payload,
    extractionMetadata: undefined,
    extractedClues: {
      possibleDishNames: Array.isArray(extractedClues.possibleDishNames) ? extractedClues.possibleDishNames : [],
      culturalOrRegionalHints: Array.isArray(extractedClues.culturalOrRegionalHints) ? extractedClues.culturalOrRegionalHints : [],
      rememberedIngredients: [],
      sensoryClues: Array.isArray(extractedClues.sensoryClues) ? extractedClues.sensoryClues : [],
      occasions: Array.isArray(extractedClues.occasions) ? extractedClues.occasions : [],
    },
  };
}

function containsRawToolMarkup(text: string): boolean {
  return /<\/?tool_[a-z_?]+>/i.test(text)
    || /<details\b[\s\S]{0,1200}\btool calls?\b/i.test(text)
    || /\btool calls?\s*\(click to expand\)/i.test(text)
    || /\b(?:tool\s+chain|walk\s+through\s+the\s+tools?|run\s+through\s+the\s+tools?|tool\s+outputs?|reasoning\s+trace)\b/i.test(text)
    || /\*\*(?:collect_food_memory|plan_dish_research|resolve_dish_name|search_web|build_reconstruction_dossier|generate_minimum_viable_nostalgia|source_ingredients|find_sensory_substitutes)\*\*/i.test(text);
}

function shouldReplaceWithSourcingGuidance(text: string, calledTools: Set<string>, toolPayloads: Record<string, unknown>): boolean {
  if (!calledTools.has('source_ingredients')) return false;
  if (!/\bWhere to buy\b/i.test(text)) return true;
  const localSourcingSearch = toolPayloads.local_sourcing_search as { results?: unknown[] } | undefined;
  if ((localSourcingSearch?.results?.length ?? 0) > 0 && !/\b(?:Local search leads|candidate stores|not proof of current stock)\b/i.test(text)) {
    return true;
  }
  return /\b(?:let me|I'll|I will|I can|I'd love to)\s+(?:research|find|track|look up|source)\b/i.test(text);
}

function shouldAskForSourcingLocation(userMessage: string, toolPayloads: Record<string, unknown>, calledTools: Set<string>): boolean {
  if (calledTools.has('source_ingredients')) return false;
  const plan = toolPayloads.plan_tool_workflow as { needsSourcing?: boolean } | undefined;
  if (plan?.needsSourcing !== true) return false;
  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  return !memory?.userLocation && !inferUserLocation(userMessage);
}

function buildSourcingLocationClarificationResponse(toolPayloads: Record<string, unknown>, userMessage: string): string {
  const ingredients = extractSourcingIngredients(userMessage, toolPayloads.collect_food_memory).slice(0, 5);
  const targetLine = ingredients.length > 0
    ? `I have ${ingredients.join(', ')} as sourcing targets.`
    : 'I can help source the remembered ingredients once the target is clear.';
  const substitutionLine = isSubstitutionPlan(toolPayloads)
    ? 'If you also need substitutes, I will match them by sensory role after you give the shopping location.'
    : '';

  return sanitizeMinimumCueFallbackBlock([
    'Where should I source this from?',
    targetLine,
    'I need your current city, metro area, or country before I name markets or area-specific substitutes.',
    'Reply with a location like "Des Moines, Iowa" and whether online ordering is okay.',
    substitutionLine,
  ].filter((line) => line.length > 0).join('\n'));
}

function recordAskCompletion(ctx: AskRunContext, toolPayloads: Record<string, unknown>, calledTools: Set<string>, donePayload: Record<string, unknown>, consent: DataConsent): void {
  if (!consent.qualitySignals) return;
  const guarded = typeof donePayload.guarded === 'string' ? donePayload.guarded : 'none';
  recordQualitySignal(ctx.qualitySignalReport, buildAskQualitySignal({
    toolPayloads,
    calledTools: [...calledTools],
    guarded,
    cache: inferAskCacheOutcome({
      toolPayloads,
      calledTools: [...calledTools],
      cacheAvailable: ctx.cacheState.cache !== null,
      cacheFallbackUsed: ctx.cacheState.fallbackUsed,
    }),
  }));
}

function maybeSendMemoryReceipt(input: {
  toolPayloads: Record<string, unknown>;
  assistantText: string;
  send: SseSender;
}): void {
  const parsedMemory = outputSchemas.collect_food_memory.safeParse(input.toolPayloads.collect_food_memory);
  if (!parsedMemory.success) return;
  const parsedResearchPlan = outputSchemas.plan_dish_research.safeParse(input.toolPayloads.plan_dish_research);
  const parsedCue = outputSchemas.generate_minimum_viable_nostalgia.safeParse(input.toolPayloads.generate_minimum_viable_nostalgia);
  const researchedFacts = deriveResearchedFactsForReceipt(input.toolPayloads);
  if (!parsedCue.success && researchedFacts.length === 0) return;
  input.send('receipt', buildMemoryReceipt({
    memory: parsedMemory.data as CollectedFoodMemory,
    researchPlan: parsedResearchPlan.success ? parsedResearchPlan.data as DishResearchPlan : undefined,
    cue: parsedCue.success ? parsedCue.data as MinimumViableNostalgiaCue : undefined,
    assistantText: input.assistantText,
    researchedFacts,
  }));
}

/** Extract a compact set of sourced facts from search_web and resolve_dish_name payloads. */
export function deriveResearchedFactsForReceipt(toolPayloads: Record<string, unknown>): string[] {
  const facts: string[] = [];
  const relevance = buildMemoryRelevanceContext(toolPayloads.collect_food_memory);

  // search_web: reference for confidence boosting
  const searched = toolPayloads.search_web as
    | { results?: Array<{ title?: string; snippet?: string }> }
    | undefined;

  // resolve_dish_name: emit canonical name + region when a real match was found
  const resolved = toolPayloads.resolve_dish_name as
    | { dishName?: string; canonicalName?: string; region?: string; confidence?: string; aliases?: string[]; matchType?: string }
    | undefined;
  const sourcing = toolPayloads.source_ingredients as
    | { ingredients?: string[]; location?: string; regionalData?: { region?: string; ethnicCorridors?: unknown; majorStores?: unknown } }
    | undefined;
  // Surface a real dish match (valid name + known matchType). A Low-confidence match is promoted to
  // Medium when search_web produced results (research backed the identity up), and is otherwise left
  // unsurfaced. The promotion gates on the *match*, not on confidence: the old `hasResolvedDishEvidence`
  // guard already excluded Low, which made the Low->Medium branch below unreachable dead code.
  if (hasResolvedDishMatch(resolved)) {
    const hasResearchProduct = (searched?.results?.length ?? 0) > 0;
    const effectiveConfidence = (resolved.confidence === 'Low' && hasResearchProduct) ? 'Medium' : resolved.confidence;
    if (effectiveConfidence !== 'Low') {
      const userRegionHint = (toolPayloads.collect_food_memory as { extractedClues?: { culturalOrRegionalHints?: string[] } } | undefined)?.extractedClues?.culturalOrRegionalHints?.find((h) => Boolean(h));
      const displayRegion = (resolved.region && !/^unknown$/i.test(resolved.region)) ? resolved.region : (userRegionHint ?? 'unknown');
      facts.push(`Dish resolved: "${resolved.canonicalName}" (confidence: ${effectiveConfidence ?? 'unknown'}, region: ${displayRegion})`);
      const aliases = (resolved.aliases ?? []).filter(Boolean).slice(0, 3);
      if (aliases.length) facts.push(`Also known as: ${aliases.join(', ')}`);
    }
  }

  const sourcedIngredients = (sourcing?.ingredients ?? []).filter((ingredient) => typeof ingredient === 'string' && ingredient.trim().length > 0);
  if (sourcedIngredients.length > 0) {
    facts.push(`Sourcing guide: ${sourcedIngredients.slice(0, 5).join(', ')} near ${sourcing?.location?.trim() || 'the requested area'}`);
    if (sourcing?.regionalData?.region) {
      facts.push(`Static regional availability matched: ${sourcing.regionalData.region}`);
    }
    const localHints = [
      ...flattenReceiptSourcingHints(sourcing?.regionalData?.majorStores),
      ...flattenReceiptSourcingHints(sourcing?.regionalData?.ethnicCorridors),
    ].slice(0, 3);
    if (localHints.length > 0) facts.push(`Starting points: ${localHints.join(', ')}`);
  }

  // search_web: emit only source-like cultural/cooking snippets, never shopping noise
  // or flavor-contradicting results (e.g. a savory dish for a remembered dessert).
  for (const result of filterMemoryResearchSearchResults(searched?.results ?? [], relevance).slice(0, 3)) {
    if (result.snippet?.trim()) facts.push(result.snippet.trim().replace(/[\u2014\u2013]/g, ', '));
  }

  return filterMemoryResearchFacts(facts, relevance);
}

function sourceBackedSearchFacts(toolPayloads: Record<string, unknown>): string[] {
  const searchResults = toolPayloads.search_web as
    | { results?: Array<{ title?: string; snippet?: string }> }
    | undefined;
  return filterMemoryResearchSearchResults(
    searchResults?.results ?? [],
    buildMemoryRelevanceContext(toolPayloads.collect_food_memory),
  )
    .filter((r) => r.snippet?.trim())
    .map((r) => `${r.title}: ${r.snippet}`)
    .slice(0, 5);
}

function hasUsableSearchEvidence(toolPayloads: Record<string, unknown>): boolean {
  const searchResults = toolPayloads.search_web as
    | { results?: Array<{ title?: string; snippet?: string }> }
    | undefined;
  return filterMemoryResearchSearchResults(searchResults?.results ?? []).length > 0;
}

function sourceBackedDossierFacts(toolPayloads: Record<string, unknown>): string[] {
  const facts = [...sourceBackedSearchFacts(toolPayloads)];
  const resolved = toolPayloads.resolve_dish_name as
    | { canonicalName?: string; region?: string; confidence?: string; matchType?: string }
    | undefined;
  if (hasResolvedDishEvidence(resolved)) {
    facts.unshift(`Dish resolved: "${resolved.canonicalName}" (confidence: ${resolved.confidence ?? 'unknown'}, region: ${resolved.region ?? 'unknown'})`);
  }
  return [...new Set(facts)].slice(0, 5);
}

/** A real dish match: a valid canonical name plus a non-"unknown" matchType, at any confidence tier. */
function hasResolvedDishMatch<T extends { canonicalName?: string; matchType?: string }>(
  resolved: T | undefined,
): resolved is T & { canonicalName: string } {
  return Boolean(
    resolved?.canonicalName
    && !/^Unknown$/i.test(resolved.canonicalName)
    && resolved.matchType !== 'unknown',
  );
}

/** A confident dish match: a real match whose own confidence is not Low. */
function hasResolvedDishEvidence<T extends { canonicalName?: string; matchType?: string; confidence?: string }>(
  resolved: T | undefined,
): resolved is T & { canonicalName: string } {
  return hasResolvedDishMatch(resolved) && resolved.confidence !== 'Low';
}

function flattenReceiptSourcingHints(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (typeof entry === 'string' && entry.trim()) return [entry.trim()];
      if (!isRecord(entry)) return [];
      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      const city = typeof entry.city === 'string' ? entry.city.trim() : '';
      return name ? [city ? `${name} in ${city}` : name] : [];
    });
  }
  if (!isRecord(value)) return [];
  return Object.values(value)
    .flatMap((entry) => Array.isArray(entry) ? entry : [])
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function validateToolOutput(toolName: string, result: unknown): void {
  const schema = outputSchemas[toolName];
  if (!schema) return;
  const parsed = schema.safeParse(result);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`[validation] ${toolName} output schema mismatch: ${issues}`);
  }
}

async function executeAndStreamTool(
  ctx: AskRunContext,
  toolName: string,
  input: unknown,
  userMessage: string,
  send: SseSender,
  calledTools: Set<string>,
  toolPayloads: Record<string, unknown>,
  history?: AskHistoryItem[],
): Promise<unknown> {
  if (toolName === 'generate_minimum_viable_nostalgia' && shouldBuildMissingDossier(input, toolPayloads)) {
    const searchResults = toolPayloads.search_web as { results?: Array<{ title?: string; snippet?: string }> } | undefined;
    const researchedFacts = filterMemoryResearchSearchResults(
      searchResults?.results ?? [],
      buildMemoryRelevanceContext(toolPayloads.collect_food_memory),
    )
      .filter((r) => r.snippet)
      .map((r) => `${r.title}: ${r.snippet}`)
      .slice(0, 5);
    await executeAndStreamTool(ctx, 'build_reconstruction_dossier', {
      memory: toolPayloads.collect_food_memory,
      researchPlan: toolPayloads.plan_dish_research,
      researchedFacts,
      inferredFacts: [
        'The model requested a minimum viable cue before building a dossier, so the server built the evidence boundary from available research.',
      ],
    }, userMessage, send, calledTools, toolPayloads, history);
  }
  const normalizedInput = normalizeDependentToolInput(toolName, input, userMessage, toolPayloads, history);
  send('tool_call', { name: toolName, input: normalizedInput });
  const result = await executeToolDefinition(toolName, normalizedInput, ctx.toolContext);
  const payload = normalizeAskToolPayload(toolName, normalizedInput, result.payload);
  validateToolOutput(toolName, payload);
  calledTools.add(toolName);
  const payloadKey = toolName === 'search_web'
    && isRecord(normalizedInput)
    && normalizedInput.purpose === 'local_sourcing'
    ? 'local_sourcing_search'
    : toolName;
  toolPayloads[payloadKey] = payload;
  if (toolName === 'find_sensory_substitutes') {
    const existing = Array.isArray(toolPayloads.find_sensory_substitutes_all)
      ? toolPayloads.find_sensory_substitutes_all
      : [];
    toolPayloads.find_sensory_substitutes_all = [...existing, result.payload];
  }
  send('tool_result', { name: toolName, result: payload });
  return payload;
}

function normalizeAskToolPayload(toolName: string, input: unknown, payload: unknown): unknown {
  if (toolName !== 'search_web' || !isRecord(payload)) return payload;
  if (isRecord(input) && input.purpose === 'local_sourcing') return payload;
  const rawResults = Array.isArray(payload.results)
    ? payload.results.filter((result): result is { title?: string; link?: string; snippet?: string } => isRecord(result))
    : [];
  const filteredResults = filterMemoryResearchSearchResults(rawResults)
    .map((result) => ({
      title: typeof result.title === 'string' ? result.title : '',
      link: typeof result.link === 'string' ? result.link : '',
      snippet: typeof result.snippet === 'string' ? result.snippet : '',
    }));
  return { ...payload, results: filteredResults };
}

function shouldBuildMissingDossier(toolInput: unknown, toolPayloads: Record<string, unknown>): boolean {
  const record = isRecord(toolInput) ? toolInput : {};
  return !hasUsableDossier(record.dossier)
    && !toolPayloads.build_reconstruction_dossier
    && Boolean(toolPayloads.collect_food_memory)
    && Boolean(toolPayloads.plan_dish_research);
}

function hasUsableDossier(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const ledger = value.evidenceLedger;
  if (!isRecord(ledger)) return false;
  return Array.isArray(ledger.userSaid) && ledger.userSaid.some((entry) => typeof entry === 'string' && entry.trim().length > 0);
}

function hasUsableCollectedMemory(value: unknown): boolean {
  return outputSchemas.collect_food_memory.safeParse(value).success;
}

function hasUsableResearchPlan(value: unknown): boolean {
  return outputSchemas.plan_dish_research.safeParse(value).success;
}

function normalizeDependentToolInput(toolName: string, input: unknown, userMessage: string, toolPayloads: Record<string, unknown>, history?: AskHistoryItem[]): unknown {
  const record = isRecord(input) ? input : {};
  const collectedMemory = hasUsableCollectedMemory(toolPayloads.collect_food_memory)
    ? toolPayloads.collect_food_memory
    : undefined;
  const researchPlan = hasUsableResearchPlan(toolPayloads.plan_dish_research)
    ? toolPayloads.plan_dish_research
    : undefined;

  if (toolName === 'collect_food_memory') {
    const rawMemoryText = typeof record.memoryText === 'string' && record.memoryText.trim()
      ? record.memoryText
      : userMessage;
    const memoryText = isLatestCorrectionMessage(userMessage)
      ? buildCorrectedMemoryText(rawMemoryText, userMessage, history)
      : buildAccumulatedMemoryText(rawMemoryText, history);
    const normalizedRecord: Record<string, unknown> = { ...record, memoryText };
    delete normalizedRecord.knownRegion;
    delete normalizedRecord.knownLanguage;
    const userLocation = inferUserLocation(userMessage);
    if (userLocation) {
      normalizedRecord.userLocation = userLocation;
    } else {
      delete normalizedRecord.userLocation;
    }
    return normalizedRecord;
  }
  if (toolName === 'build_research_record') {
    return normalizeResearchRecordInput(record, toolPayloads);
  }
  if (toolName === 'plan_dish_research' && collectedMemory) {
    return { ...record, memory: collectedMemory };
  }
  if (toolName === 'resolve_dish_name' && collectedMemory) {
    const normalized: Record<string, unknown> = { ...record, memory: collectedMemory };
    const researchedFacts = sourceBackedSearchFacts(toolPayloads);
    if (researchedFacts.length > 0) {
      normalized.researchedFacts = researchedFacts;
    } else if (!shouldPreserveModelProvidedResearchFacts(collectedMemory as CollectedFoodMemory, userMessage)) {
      delete normalized.researchedFacts;
    }
    return normalized;
  }
  if (toolName === 'build_reconstruction_dossier') {
    const normalized: Record<string, unknown> = {
      ...record,
      ...(collectedMemory ? { memory: collectedMemory } : {}),
      ...(researchPlan ? { researchPlan } : {}),
    };
    const researchedFacts = sourceBackedDossierFacts(toolPayloads);
    if (researchedFacts.length > 0) {
      normalized.researchedFacts = researchedFacts;
    } else if (!shouldPreserveModelProvidedResearchFacts(collectedMemory as CollectedFoodMemory | undefined, userMessage)) {
      delete normalized.researchedFacts;
    }
    if (sourceBackedSearchFacts(toolPayloads).length === 0
      && !shouldPreserveModelProvidedResearchFacts(collectedMemory as CollectedFoodMemory | undefined, userMessage)) {
      delete normalized.inferredFacts;
    }
    return normalized;
  }
  if (toolName === 'search_web'
    && record.purpose === 'local_sourcing'
    && typeof record.query === 'string'
    && record.query.trim()) {
    return { ...record, query: sanitizeGroundedSearchQuery(record.query) };
  }
  if (toolName === 'search_web' && collectedMemory) {
    return { ...record, query: buildGroundedSearchQuery(collectedMemory, toolPayloads.resolve_dish_name) };
  }
  if (toolName === 'generate_minimum_viable_nostalgia' && !hasUsableDossier(record.dossier) && toolPayloads.build_reconstruction_dossier) {
    const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
    return {
      ...record,
      dossier: toolPayloads.build_reconstruction_dossier,
      ...(typeof record.userLocation === 'string' || !memory?.userLocation ? {} : { userLocation: memory.userLocation }),
      ...(Array.isArray(record.constraints) ? {} : { constraints: inferSafetyConstraints(userMessage) }),
    };
  }
  if (toolName === 'generate_minimum_viable_nostalgia' && !Array.isArray(record.constraints)) {
    return { ...record, constraints: inferSafetyConstraints(userMessage) };
  }
  return input;
}

function contradictsLatestCorrection(text: string, userMessage: string): boolean {
  if (!isLatestCorrectionMessage(userMessage)) return false;
  const contradictedDescriptors = latestCorrectionContradictedDescriptors(userMessage);
  return contradictedDescriptors.some((descriptor) => new RegExp(`\\b${descriptor}\\b`, 'i').test(text));
}

function latestCorrectionContradictedDescriptors(userMessage: string): string[] {
  return ['milky', 'creamy', 'cream', 'milk', 'milk-forward', 'thick', 'warm', 'hot', 'sweet']
    .filter((descriptor) => {
      const negatedDescriptor = new RegExp(`\\b(?:not|no|wasn['’]?t|was\\s+not|isn['’]?t|is\\s+not)\\s+(?:\\w+\\s+){0,4}${descriptor}\\b`, 'i');
      return negatedDescriptor.test(userMessage) || /\b(?:remembered\s+wrong|correction)\b/i.test(userMessage);
    });
}

function sanitizeLatestCorrectionResponse(text: string, userMessage: string): string {
  const contradictedDescriptors = latestCorrectionContradictedDescriptors(userMessage);
  if (contradictedDescriptors.length === 0) return text;
  const contradictedPattern = new RegExp(`\\b(?:${contradictedDescriptors.map(escapeRegExp).join('|')})\\b`, 'i');
  return text
    .split('\n')
    .filter((line) => !contradictedPattern.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildLatestCorrectionAlignedResponse(text: string, userMessage: string, toolPayloads: Record<string, unknown>): string {
  const sanitized = sanitizeLatestCorrectionResponse(text, userMessage);
  if (!latestCorrectionNeedsMechanismFallback(sanitized, userMessage)) return sanitized;

  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  const localLine = memory?.userLocation
    ? `\n\nUse ordinary grocery or pantry items near ${memory.userLocation}; do not buy the exact suspected dish for this first test.`
    : '';
  return sanitizeMinimumCueFallbackBlock([
    'Minimum viable corrected-memory cue',
    '',
    'First-pass verification bite: a tiny amount of a safe neutral carrier plus one tiny corrected sensory cue from the latest message.',
    '',
    'Keep it to one sip, smell, or bite that tests only the corrected aroma, acid, texture, temperature, or mouthfeel.',
    'Do not buy the exact suspected dish yet; this is only the first check.',
    '',
    'Why this is minimum: The latest correction is the highest-trust evidence, so the first cue should test that corrected mechanism before reusing older assumptions.',
    localLine.trim(),
    'If it works, next ask: Ask which corrected detail hit first: smell, texture, acid, fat, starch, temperature, or serving ritual.',
  ].filter((line) => line.length > 0).join('\n'));
}

function latestCorrectionNeedsMechanismFallback(text: string, userMessage: string): boolean {
  if (!isLatestCorrectionMessage(userMessage)) return false;
  if (text.length < 80 || !/\bminimum viable|first[-\s]?pass verification bite\b/i.test(text)) return true;
  if (/\b(?:soup|broth|stew)\b/i.test(userMessage) && /\b(?:beverage-memory|carbonation|foamy|iced|over ice|exact drink)\b/i.test(text)) {
    return true;
  }
  return false;
}

function normalizeResearchRecordInput(record: Record<string, unknown>, toolPayloads: Record<string, unknown>): unknown {
  const researchPlan = toolPayloads.plan_dish_research as DishResearchPlan | undefined;
  const searchResult = toolPayloads.search_web as { query?: string; results?: unknown[] } | undefined;
  const topHypothesis = researchPlan?.hypotheses?.[0]?.name;
  const sources = Array.isArray(record.sources) ? record.sources : searchResult?.results;

  return {
    ...record,
    dishName: typeof record.dishName === 'string' ? record.dishName : topHypothesis ?? 'unknown food memory',
    query: typeof record.query === 'string' ? record.query : searchResult?.query ?? researchPlan?.searchQueries?.[0] ?? 'unknown food memory research',
    sources: Array.isArray(sources) ? sources.map(normalizeResearchSource) : [],
  };
}

function normalizeResearchSource(source: unknown): Record<string, unknown> {
  const record = isRecord(source) ? source : {};
  const title = typeof record.title === 'string' && record.title.trim() ? record.title : 'Untitled source';
  const url = typeof record.url === 'string'
    ? record.url
    : typeof record.link === 'string'
      ? record.link
      : '';
  const extractedFacts = Array.isArray(record.extractedFacts)
    ? record.extractedFacts.filter((fact): fact is string => typeof fact === 'string' && fact.trim().length > 0)
    : typeof record.snippet === 'string' && record.snippet.trim()
      ? [record.snippet.replace(/[\u2014\u2013]/g, ', ')]
      : [];

  return {
    title,
    url,
    sourceType: normalizeSourceType(record.sourceType, title, url),
    accessedAt: typeof record.accessedAt === 'string' && record.accessedAt.trim() ? record.accessedAt : new Date().toISOString(),
    reliability: normalizeConfidence(record.reliability),
    author: typeof record.author === 'string' ? record.author : undefined,
    extractedFacts,
  };
}

function normalizeSourceType(value: unknown, title: string, url: string): string {
  const normalized = typeof value === 'string' ? value.toLowerCase().replace(/[-_\s]+/g, '_') : '';
  if (['recipe', 'video', 'article', 'book', 'oral_history', 'market', 'other'].includes(normalized)) return normalized;
  const combined = `${title} ${url}`.toLowerCase();
  if (combined.includes('youtube') || combined.includes('video')) return 'video';
  if (combined.includes('recipe')) return 'recipe';
  if (combined.includes('market') || combined.includes('shop') || combined.includes('store')) return 'market';
  return 'article';
}

function normalizeConfidence(value: unknown): 'High' | 'Medium' | 'Low' {
  return value === 'High' || value === 'Medium' || value === 'Low' ? value : 'Medium';
}

async function createWithTimeout(
  askSession: AskSession,
  maxTokens: number,
  timeoutMs: number,
): Promise<AskModelResponse> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      askSession.create(maxTokens),
      new Promise<AskModelResponse>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`final synthesis timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function isProviderContextLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  if (/\bn_keep\b[\s\S]{0,80}\bn_ctx\b/i.test(message)) return true;
  return /\b(?:context size|context length|maximum context|token limit|too many tokens)\b/i.test(message)
    && /\b(?:exceeded|limit|too large|too many)\b/i.test(message);
}

function isRecoverableAskProviderFailure(ctx: AskRunContext, err: unknown): boolean {
  if (isProviderContextLimitError(err)) return true;
  const message = err instanceof Error ? err.message : String(err);
  if (isDownstreamProviderWrappedFailure(message)) return true;
  if (/\b(?:401|402|403|api[_ -]?key|invalid key|authorization|bearer|token|credential|secret|moderation|flagged|insufficient credits)\b/i.test(message)) {
    return false;
  }

  if (/\b(?:Failed to parse tool arguments|no assistant message|finish_reason: length|fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|AbortError|timed out)\b/i.test(message)) {
    return true;
  }

  if (ctx.providerRuntime.providerKind === 'openai') {
    return /\bOpenAI-compatible provider returned (?:400|404|408|429|5\d\d)\b/i.test(message)
      || /\b(?:No endpoints found that support tool use|unsupported.*tool|tool use|provider returned error|model provider failed|rate limit)\b/i.test(message);
  }

  return /\b(?:429|5\d\d|rate limit|overloaded|temporarily unavailable|timeout|model provider failed)\b/i.test(message);
}

function isDownstreamProviderWrappedFailure(message: string): boolean {
  return /\bProvider returned error\b/i.test(message)
    && /\b(?:metadata|provider_name|is_byok|googleapis\.com|temporarily rate-limited upstream|google\.rpc\.ErrorInfo)\b/i.test(message);
}

function providerRecoveryLogSummary(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const statusMatch = message.match(/\b(?:returned|status)\s+(\d{3})\b/i) ?? message.match(/\b(4\d\d|5\d\d)\b/);
  if (statusMatch?.[1]) return `status=${statusMatch[1]}`;
  if (isProviderContextLimitError(err)) return 'context_limit';
  if (/\brate limit|429\b/i.test(message)) return 'rate_limited';
  if (/\btool use|tools?\b/i.test(message)) return 'tool_capability';
  if (/\bFailed to parse tool arguments\b/i.test(message)) return 'malformed_tool_arguments';
  if (/\btimeout|timed out|AbortError\b/i.test(message)) return 'timeout';
  return 'provider_unavailable';
}

function sanitizeAskError(err: unknown): { message: string; code?: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (isModelProviderErrorMessage(message)) {
    return {
      message: 'The model provider failed while processing this request. Try again shortly, or ask support to check provider configuration.',
      code: 'model_provider_failed',
    };
  }
  return { message: message || 'Unknown error' };
}

function isModelProviderErrorMessage(message: string): boolean {
  return /\b(?:OpenAI-compatible provider|Anthropic|model provider|provider returned|finish_reason|fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND)\b/i.test(message)
    || /\b(?:api[_ -]?key|authorization|bearer|token|credential|secret)\b/i.test(message)
    || /\b(?:sk|ach|ak|whsec)_[A-Za-z0-9_-]{8,}\b/.test(message);
}

function configureAvailableAskTools(
  askSession: AskSession,
  toolPayloads: Record<string, unknown>,
  calledTools: Set<string>,
): void {
  const toolNames = nextAskToolNames(toolPayloads, calledTools);
  askSession.setAvailableTools(toolNames.map((name) => TOOLS_BY_NAME.get(name)).filter((tool): tool is typeof TOOLS[number] => Boolean(tool)));
}

function nextAskToolNames(toolPayloads: Record<string, unknown>, calledTools: Set<string>): string[] {
  const plan = toolPayloads.plan_tool_workflow as { workflowSteps?: Array<{ tool?: unknown }>; needsSubstitutions?: boolean } | undefined;
  const plannedToolNames = (plan?.workflowSteps ?? [])
    .map((step) => step.tool)
    .filter((tool): tool is string => typeof tool === 'string' && KNOWN_TOOL_NAMES.has(tool) && tool !== 'plan_tool_workflow' && !(DISABLE_SEARCH_WEB && tool === 'search_web'));

  if (plannedToolNames.length === 0) return calledTools.has('collect_food_memory') ? [] : ['collect_food_memory'];
  if (!calledTools.has('collect_food_memory') && plannedToolNames.includes('collect_food_memory')) return ['collect_food_memory'];

  const remaining = plannedToolNames.filter((name) => !calledTools.has(name));
  // Show up to 3 remaining tools so the model can progress naturally through the workflow
  return [...new Set(remaining)].slice(0, 3);
}

async function runDeterministicPlannedToolChain({
  ctx,
  userMessage,
  history,
  askSession,
  toolPayloads,
  calledTools,
  send,
}: {
  ctx: AskRunContext;
  userMessage: string;
  history?: AskHistoryItem[];
  askSession: AskSession;
  toolPayloads: Record<string, unknown>;
  calledTools: Set<string>;
  send: SseSender;
}): Promise<AskModelResponse | null> {
  const plannedToolNames = deterministicPlannedToolNames(toolPayloads, calledTools);
  if (plannedToolNames.length === 0) return null;
  const safetyConstraints = deterministicSafetyConstraints(userMessage, toolPayloads);
  if (safetyConstraints.length > 0) {
    send('status', { stage: 'deterministic_tool_chain_fallback', reason: 'safety_constraints' });
    return null;
  }

  send('status', { stage: 'deterministic_tool_chain', tools: plannedToolNames });
  let executedTool = false;
  let searchCallCount = 0;
  const maxSearchCalls = deterministicMaxSearchCalls(toolPayloads);

  for (const toolName of plannedToolNames) {
    if (calledTools.has(toolName)) continue;
    if (toolName === 'search_web') {
      if (DISABLE_SEARCH_WEB || maxSearchCalls <= 0 || searchCallCount >= maxSearchCalls) continue;
    }
    if (toolName === 'find_sensory_substitutes' || toolName === 'source_ingredients') continue;
    if (toolName === 'generate_minimum_viable_nostalgia' && shouldStopBeforeDeterministicCue(userMessage, toolPayloads)) break;

    send('status', { stage: 'calling_tools', tools: [toolName], deterministic: true });
    await executeAndStreamTool(
      ctx,
      toolName,
      deterministicPlannedToolInput(toolName, userMessage, toolPayloads),
      userMessage,
      send,
      calledTools,
      toolPayloads,
      history,
    );
    executedTool = true;
    if (toolName === 'search_web') searchCallCount++;
    if (toolName === 'generate_minimum_viable_nostalgia') {
      await maybeRunPlannedSubstitutions({ ctx, userMessage, toolPayloads, calledTools, send });
      await maybeRunPlannedSourcing({ ctx, userMessage, toolPayloads, calledTools, send });
    }
  }

  if (!executedTool || !calledTools.has('collect_food_memory')) return null;

  askSession.compactForSynthesis(formatAskCaseFileForModel(buildAskCaseFile({
    userMessage,
    history,
    toolPayloads,
    calledTools: [...calledTools],
  })));
  send('status', { stage: 'case_file_compacted', deterministic: true });
  send('status', { stage: 'thinking', deterministic: true });

  try {
    return await createWithTimeout(askSession, ctx.finalSynthesisMaxTokens, ctx.finalSynthesisTimeoutMs);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    ctx.logger.warn(`[ask] deterministic planned synthesis unavailable, using guard chain continuation: ${detail}`);
    return { textBlocks: [], toolCalls: [], providerMessage: null };
  }
}

function deterministicPlannedToolNames(toolPayloads: Record<string, unknown>, calledTools: Set<string>): string[] {
  const plan = toolPayloads.plan_tool_workflow as { workflowSteps?: Array<{ tool?: unknown }> } | undefined;
  const planned = (plan?.workflowSteps ?? [])
    .map((step) => step.tool)
    .filter((tool): tool is string => typeof tool === 'string' && KNOWN_TOOL_NAMES.has(tool) && tool !== 'plan_tool_workflow');
  if (planned.length === 0) return calledTools.has('collect_food_memory') ? [] : ['collect_food_memory'];
  return [...new Set(planned.filter((tool) => !calledTools.has(tool)))];
}

function deterministicMaxSearchCalls(toolPayloads: Record<string, unknown>): number {
  const plan = toolPayloads.plan_tool_workflow as { maxSearchCalls?: number } | undefined;
  return typeof plan?.maxSearchCalls === 'number' ? plan.maxSearchCalls : 1;
}

function deterministicSafetyConstraints(userMessage: string, toolPayloads: Record<string, unknown>): string[] {
  const workflowPlan = toolPayloads.plan_tool_workflow as { detectedRestrictions?: unknown[] } | undefined;
  const planRestrictions = (workflowPlan?.detectedRestrictions ?? [])
    .filter((restriction): restriction is string => typeof restriction === 'string' && restriction.trim().length > 0);
  return [...new Set([...inferSafetyConstraints(userMessage), ...planRestrictions])];
}

function shouldStopBeforeDeterministicCue(userMessage: string, toolPayloads: Record<string, unknown>): boolean {
  const workflowPlan = toolPayloads.plan_tool_workflow as { detectedRestrictions?: unknown[]; needsSubstitutions?: boolean } | undefined;
  if (deterministicSafetyConstraints(userMessage, toolPayloads).length > 0) return true;
  if ((workflowPlan?.detectedRestrictions?.length ?? 0) > 0 && !workflowPlan?.needsSubstitutions) return true;
  if (isExplicitUnnamedMemory(userMessage)) return true;
  if (isExplicitMinimumTestRequest(userMessage)) {
    return !hasSensorySignal(userMessage, toolPayloads.collect_food_memory)
      && !hasStableDeterministicCueAnchor(toolPayloads);
  }
  return shouldClarifyBroadUncertainMemory(userMessage, toolPayloads)
    || shouldClarifySparseUnanchoredMemory(userMessage, toolPayloads);
}

function isExplicitUnnamedMemory(userMessage: string): boolean {
  return /\b(?:never knew the name|never learned the name|do not know the name|don['’]?t know the name|did not know the name|didn['’]?t know the name|no name|unnamed)\b/i.test(userMessage);
}

function hasStableDeterministicCueAnchor(toolPayloads: Record<string, unknown>): boolean {
  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  const researchPlan = toolPayloads.plan_dish_research as DishResearchPlan | undefined;
  return Boolean(
    memory?.extractedClues?.possibleDishNames?.some((name) => name.trim())
    || memory?.extractedClues?.culturalOrRegionalHints?.some((hint) => hint.trim())
    || researchPlan?.hypotheses?.some((hypothesis) => hypothesis.name?.trim()),
  );
}

function deterministicPlannedToolInput(
  toolName: string,
  userMessage: string,
  toolPayloads: Record<string, unknown>,
): unknown {
  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  const researchPlan = toolPayloads.plan_dish_research as DishResearchPlan | undefined;
  if (toolName === 'collect_food_memory') return { memoryText: userMessage };
  if (toolName === 'plan_dish_research') return { memory };
  if (toolName === 'resolve_dish_name') {
    return {
      input: deterministicResolveInput(memory, researchPlan, userMessage),
      ...(memory ? { memory } : {}),
    };
  }
  if (toolName === 'search_web') {
    return { query: memory ? buildGroundedSearchQuery(memory, toolPayloads.resolve_dish_name) : userMessage };
  }
  if (toolName === 'build_reconstruction_dossier') {
    return {
      memory,
      researchPlan,
      researchedFacts: sourceBackedDossierFacts(toolPayloads),
    };
  }
  if (toolName === 'generate_minimum_viable_nostalgia') {
    return {
      dossier: toolPayloads.build_reconstruction_dossier,
      ...(memory?.userLocation ? { userLocation: memory.userLocation } : {}),
      constraints: inferSafetyConstraints(userMessage),
      maxEffortMinutes: 10,
    };
  }
  return {};
}

function deterministicResolveInput(
  memory: CollectedFoodMemory | undefined,
  researchPlan: DishResearchPlan | undefined,
  userMessage: string,
): string {
  const hypothesisName = researchPlan?.hypotheses?.find((hypothesis) => hypothesis.name?.trim())?.name;
  if (hypothesisName) return hypothesisName;
  const possibleName = memory?.extractedClues?.possibleDishNames?.find((name) => name.trim());
  if (possibleName) return possibleName;
  return userMessage.slice(0, 200);
}

async function recoverFromInitialProviderFailure({
  ctx,
  userMessage,
  toolPayloads,
  calledTools,
  send,
  finish,
  guarded,
  reason = 'provider_context_limit',
}: {
  ctx: AskRunContext;
  userMessage: string;
  toolPayloads: Record<string, unknown>;
  calledTools: Set<string>;
  send: SseSender;
  finish: DoneSender;
  guarded: string;
  reason?: string;
}): Promise<boolean> {
  send('status', { stage: 'deterministic_recovery', reason });

  if (!calledTools.has('collect_food_memory')) {
    send('status', { stage: 'calling_tools', tools: ['collect_food_memory'], deterministic: true });
    await executeAndStreamTool(ctx, 'collect_food_memory', { memoryText: userMessage }, userMessage, send, calledTools, toolPayloads);
  }

  await maybeRunMissingResearchPlan({ ctx, userMessage, toolPayloads, calledTools, send });
  await maybeRunOriginalSubstitutionBasisCue({ ctx, userMessage, toolPayloads, calledTools, send });
  await maybeRunPlannedSubstitutions({ ctx, userMessage, toolPayloads, calledTools, send });
  await maybeRunPlannedSourcing({ ctx, userMessage, toolPayloads, calledTools, send });

  if (maybeSendSubstitutionBasisResponse({ userMessage, toolPayloads, calledTools, send, finish })) {
    return true;
  }

  if (await maybeSendForcedMinimumCue({ ctx, userMessage, toolPayloads, calledTools, send, finish })) {
    return true;
  }

  const responseText = buildClarificationOnlyResponse(toolPayloads, userMessage);
  send('text', responseText);
  maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
  finish({ guarded });
  return true;
}

async function maybeSendForcedMinimumCue({
  ctx,
  userMessage,
  toolPayloads,
  calledTools,
  send,
  finish,
}: {
  ctx: AskRunContext;
  userMessage: string;
  toolPayloads: Record<string, unknown>;
  calledTools: Set<string>;
  send: SseSender;
  finish: DoneSender;
}): Promise<boolean> {
  if (calledTools.has('generate_minimum_viable_nostalgia')) return false;
  if (!shouldForceMinimumCue(userMessage, toolPayloads, calledTools)) return false;

  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  const researchPlan = toolPayloads.plan_dish_research as DishResearchPlan | undefined;
  if (!memory || !researchPlan) return false;

  ctx.logger.warn('[ask] forcing minimum viable cue after explicit test request stalled before cue tool');
  send('status', { stage: 'calling_tools', tools: ['build_reconstruction_dossier', 'generate_minimum_viable_nostalgia'], guarded: 'explicit_minimum_cue_fallback' });

  let dossier = toolPayloads.build_reconstruction_dossier as ReconstructionDossier | undefined;
  if (!dossier) {
    const searchResults = toolPayloads.search_web as { results?: Array<{ title?: string; snippet?: string }> } | undefined;
    const researchedFacts = filterMemoryResearchSearchResults(
      searchResults?.results ?? [],
      buildMemoryRelevanceContext(memory),
    )
      .filter((r) => r.snippet)
      .map((r) => `${r.title}: ${r.snippet}`)
      .slice(0, 5);
    dossier = await executeAndStreamTool(ctx, 'build_reconstruction_dossier', {
      memory,
      researchPlan,
      researchedFacts,
      inferredFacts: [
        'The model stalled before building a dossier, so the server assembled the evidence boundary from available research.',
      ],
    }, userMessage, send, calledTools, toolPayloads) as ReconstructionDossier;
  }

  const cue = await executeAndStreamTool(ctx, 'generate_minimum_viable_nostalgia', {
    dossier,
    userLocation: memory.userLocation,
    constraints: inferSafetyConstraints(userMessage),
    maxEffortMinutes: 10,
  }, userMessage, send, calledTools, toolPayloads) as MinimumViableNostalgiaCue;

  const responseText = hasUsableSearchEvidence(toolPayloads)
    ? buildResearchGroundedForcedCueResponse(toolPayloads, userMessage)
    : buildEvidenceBoundedMinimumCueResponse(toolPayloads, userMessage);
  send('text', responseText);
  maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
  finish({ guarded: 'explicit_minimum_cue_fallback' });
  return true;
}

async function maybeSendPrematureCandidateMinimumCue({
  ctx,
  userMessage,
  toolPayloads,
  calledTools,
  send,
  finish,
}: {
  ctx: AskRunContext;
  userMessage: string;
  toolPayloads: Record<string, unknown>;
  calledTools: Set<string>;
  send: SseSender;
  finish: DoneSender;
}): Promise<boolean> {
  if (calledTools.has('generate_minimum_viable_nostalgia')) return false;
  if (!shouldForceMinimumCueAfterPrematureCandidate(userMessage, toolPayloads)) return false;

  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  const researchPlan = toolPayloads.plan_dish_research as DishResearchPlan | undefined;
  if (!memory || !researchPlan) return false;

  ctx.logger.warn('[ask] converting premature candidate list into deterministic minimum cue');
  send('status', { stage: 'calling_tools', tools: ['build_reconstruction_dossier', 'generate_minimum_viable_nostalgia'], guarded: 'premature_candidate_minimum_cue' });

  let dossier = toolPayloads.build_reconstruction_dossier as ReconstructionDossier | undefined;
  if (!dossier) {
    dossier = await executeAndStreamTool(ctx, 'build_reconstruction_dossier', {
      memory,
      researchPlan,
      inferredFacts: [
        'The model produced candidate speculation before the minimum cue, so the server preserved the sensory anchors and withheld identity claims.',
      ],
    }, userMessage, send, calledTools, toolPayloads) as ReconstructionDossier;
  }

  await executeAndStreamTool(ctx, 'generate_minimum_viable_nostalgia', {
    dossier,
    userLocation: memory.userLocation,
    constraints: inferSafetyConstraints(userMessage),
    maxEffortMinutes: 10,
  }, userMessage, send, calledTools, toolPayloads);

  const responseText = buildEvidenceBoundedMinimumCueResponse(toolPayloads, userMessage);
  send('text', responseText);
  maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
  finish({ guarded: 'premature_candidate_minimum_cue' });
  return true;
}

function shouldForceMinimumCueAfterPrematureCandidate(userMessage: string, toolPayloads: Record<string, unknown>): boolean {
  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  const researchPlan = toolPayloads.plan_dish_research as DishResearchPlan | undefined;
  if (!memory || !researchPlan) return false;
  if (isExplicitUnnamedMemory(userMessage)) return false;
  if (shouldClarifyBroadUncertainMemory(userMessage, toolPayloads)) return false;

  const clues = memory.extractedClues;
  return hasSensorySignal(userMessage, memory)
    || (clues.rememberedIngredients?.length ?? 0) > 0
    || (clues.cookingMethods?.length ?? 0) > 0
    || (clues.possibleDishNames?.length ?? 0) > 0
    || (clues.culturalOrRegionalHints?.length ?? 0) > 0;
}

function shouldForceMinimumCue(userMessage: string, toolPayloads: Record<string, unknown>, calledTools: Set<string>): boolean {
  if (!toolPayloads.collect_food_memory || !toolPayloads.plan_dish_research) return false;
  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  if (isExplicitUnnamedMemory(userMessage)) {
    const hasRegionAnchor = Boolean(memory?.userLocation)
      || (memory?.extractedClues?.culturalOrRegionalHints ?? []).some((hint) => hint.trim().length > 0);
    if (!isExplicitMinimumTestRequest(userMessage) || !hasRegionAnchor) return false;
  }
  if (shouldClarifyBroadUncertainMemory(userMessage, toolPayloads)) return false;
  if (shouldClarifySparseUnanchoredMemory(userMessage, toolPayloads)) return false;

  const workflowPlan = toolPayloads.plan_tool_workflow as { needsSubstitutions?: boolean; workflowSteps?: Array<{ tool?: string }> } | undefined;
  const plannedTools = workflowPlan?.workflowSteps?.map((step) => step.tool) ?? [];
  if (plannedTools.includes('source_ingredients') && !plannedTools.includes('generate_minimum_viable_nostalgia')) return false;
  if (workflowPlan?.needsSubstitutions && calledTools.has('find_sensory_substitutes')) return true;

  // Explicit minimum-cue request, force whenever we have memory + plan + any sensory signal.
  if (isExplicitMinimumTestRequest(userMessage)) {
    return hasSensorySignal(userMessage, toolPayloads.collect_food_memory);
  }

  // Full research pipeline ran but model stalled without calling generate_minimum_viable_nostalgia.
  // Once plan_dish_research + any search-type tool have run we have enough to produce a cue.
  const didSearch = calledTools.has('search_web') || calledTools.has('resolve_dish_name');
  if (didSearch) {
    // Only force when the research produced something usable (a canonical match or result snippets).
    const resolved = toolPayloads.resolve_dish_name as
      | { canonicalName?: string; confidence?: string }
      | undefined;
    const searched = toolPayloads.search_web as { results?: unknown[] } | undefined;
    const hasResearchProduct =
      (resolved?.canonicalName && !/^Unknown$/i.test(resolved.canonicalName)) ||
      (searched?.results?.length ?? 0) > 0 ||
      ((toolPayloads.plan_dish_research as { hypotheses?: unknown[] } | undefined)?.hypotheses?.length ?? 0) > 0;
    if (hasResearchProduct) return true;
  }

  return false;
}

function shouldClarifyUnresolvedUnnamedMemory(
  userMessage: string,
  toolPayloads: Record<string, unknown>,
  calledTools: Set<string>,
  responseText: string,
): boolean {
  if (!/\b(?:never knew the name|do not know the name|don['’]?t know the name|did not know the name|didn['’]?t know the name|no name|unnamed)\b/i.test(userMessage)) return false;
  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  const hasNameAnchor = (memory?.extractedClues?.possibleDishNames ?? []).some((name) => name.trim().length > 0);
  const hasRegionAnchor = (memory?.extractedClues?.culturalOrRegionalHints ?? []).some((hint) => hint.trim().length > 0);
  if (calledTools.has('search_web') && hasRegionAnchor) return false;
  const cueBeforeIdentity = containsConcreteFoodCue(responseText)
    || /\b(?:first[-\s]?pass verification bite|first\s+tiny\s+check|tiny\s+check|minimum viable|sensory test|buy one|pan[-\s]?fry|simmer|recipe)\b/i.test(responseText);
  const identityOverclaim = containsOverconfidentIdentityClaim(responseText);
  if (!hasRegionAnchor && (cueBeforeIdentity || identityOverclaim)) return true;

  const resolved = toolPayloads.resolve_dish_name as
    | { confidence?: string; matchType?: string; region?: string; needsClarification?: boolean }
    | undefined;
  const unresolved = !resolved
    || resolved.needsClarification === true
    || resolved.matchType === 'unknown'
    || resolved.confidence === 'Low'
    || !resolved.region
    || /^unknown$/i.test(resolved.region);
  if (!unresolved) return false;

  const questionCount = (responseText.match(/\?/g) ?? []).length;
  return questionCount === 0 || questionCount > 3 || cueBeforeIdentity || identityOverclaim;
}

function shouldPreserveModelProvidedResearchFacts(memory: CollectedFoodMemory | undefined, userMessage: string): boolean {
  if (!memory) return false;
  const explicitlyUnnamed = /\b(?:never knew the name|do not know the name|don['’]?t know the name|did not know the name|didn['’]?t know the name|no name|unnamed)\b/i.test(userMessage);
  const hasNameAnchor = (memory.extractedClues.possibleDishNames ?? []).some((name) => name.trim().length > 0);
  const hasRegionAnchor = (memory.extractedClues.culturalOrRegionalHints ?? []).some((hint) => hint.trim().length > 0);
  if (explicitlyUnnamed && !hasRegionAnchor) return false;
  return hasNameAnchor || hasRegionAnchor;
}

async function maybeRunMissingResearchPlan({
  ctx,
  userMessage,
  toolPayloads,
  calledTools,
  send,
}: {
  ctx: AskRunContext;
  userMessage: string;
  toolPayloads: Record<string, unknown>;
  calledTools: Set<string>;
  send: SseSender;
}): Promise<void> {
  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  if (!memory || calledTools.has('plan_dish_research')) return;
  send('status', { stage: 'calling_tools', tools: ['plan_dish_research'], deterministic: true });
  await executeAndStreamTool(ctx, 'plan_dish_research', { memory }, userMessage, send, calledTools, toolPayloads);
}

async function maybeRunOriginalSubstitutionBasisCue({
  ctx,
  userMessage,
  toolPayloads,
  calledTools,
  send,
}: {
  ctx: AskRunContext;
  userMessage: string;
  toolPayloads: Record<string, unknown>;
  calledTools: Set<string>;
  send: SseSender;
}): Promise<void> {
  if (!isSubstitutionPlan(toolPayloads) || calledTools.has('generate_minimum_viable_nostalgia')) return;

  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  const researchPlan = toolPayloads.plan_dish_research as DishResearchPlan | undefined;
  if (!memory || !researchPlan) return;

  let dossier = toolPayloads.build_reconstruction_dossier as ReconstructionDossier | undefined;
  if (!dossier) {
    send('status', { stage: 'calling_tools', tools: ['build_reconstruction_dossier'], deterministic: true, reason: 'substitution_original_basis' });
    dossier = await executeAndStreamTool(ctx, 'build_reconstruction_dossier', {
      memory,
      researchPlan,
      inferredFacts: [
        'This is the original nostalgia basis before any dietary substitutions are applied.',
      ],
    }, userMessage, send, calledTools, toolPayloads) as ReconstructionDossier;
  }

  send('status', { stage: 'calling_tools', tools: ['generate_minimum_viable_nostalgia'], deterministic: true, reason: 'substitution_original_basis' });
  await executeAndStreamTool(ctx, 'generate_minimum_viable_nostalgia', {
    dossier,
    userLocation: memory.userLocation,
    maxEffortMinutes: 10,
  }, userMessage, send, calledTools, toolPayloads);
}

async function maybeRunPlannedSubstitutions({
  ctx,
  userMessage,
  toolPayloads,
  calledTools,
  send,
}: {
  ctx: AskRunContext;
  userMessage: string;
  toolPayloads: Record<string, unknown>;
  calledTools: Set<string>;
  send: SseSender;
}): Promise<void> {
  const plan = toolPayloads.plan_tool_workflow as { needsSubstitutions?: boolean } | undefined;
  if (!plan?.needsSubstitutions || calledTools.has('find_sensory_substitutes')) return;

  const targets = extractSubstitutionTargets(userMessage, toolPayloads.collect_food_memory);
  if (targets.length === 0) return;

  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  const location = memory?.userLocation ?? inferUserLocation(userMessage) ?? 'unknown';
  send('status', { stage: 'calling_tools', tools: ['find_sensory_substitutes'], deterministic: true });
  for (const ingredient of targets.slice(0, 5)) {
    await executeAndStreamTool(ctx, 'find_sensory_substitutes', { ingredient, location }, userMessage, send, calledTools, toolPayloads);
  }
}

async function maybeRunPlannedSourcing({
  ctx,
  userMessage,
  toolPayloads,
  calledTools,
  send,
}: {
  ctx: AskRunContext;
  userMessage: string;
  toolPayloads: Record<string, unknown>;
  calledTools: Set<string>;
  send: SseSender;
}): Promise<void> {
  const plan = toolPayloads.plan_tool_workflow as { workflowSteps?: Array<{ tool?: string }> } | undefined;
  const plannedTools = plan?.workflowSteps?.map((step) => step.tool) ?? [];
  if (!plannedTools.includes('source_ingredients')) return;

  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  const location = memory?.userLocation ?? inferUserLocation(userMessage);
  const ingredients = extractSourcingIngredients(userMessage, toolPayloads.collect_food_memory);
  if (!location || ingredients.length === 0) return;

  if (!calledTools.has('source_ingredients')) {
    send('status', { stage: 'calling_tools', tools: ['source_ingredients'], deterministic: true });
    await executeAndStreamTool(ctx, 'source_ingredients', { ingredients: ingredients.slice(0, 10), location }, userMessage, send, calledTools, toolPayloads);
  }
  await maybeRunLocalSourcingSearch({ ctx, userMessage, toolPayloads, calledTools, send, ingredients, location });
}

async function maybeRunLocalSourcingSearch({
  ctx,
  userMessage,
  toolPayloads,
  calledTools,
  send,
  ingredients,
  location,
}: {
  ctx: AskRunContext;
  userMessage: string;
  toolPayloads: Record<string, unknown>;
  calledTools: Set<string>;
  send: SseSender;
  ingredients: string[];
  location: string;
}): Promise<void> {
  if (DISABLE_SEARCH_WEB || toolPayloads.local_sourcing_search) return;
  if (!ENABLE_LOCAL_SOURCING_SEARCH && !isExplicitLocalSourcingSearchRequest(userMessage)) return;
  const plan = toolPayloads.plan_tool_workflow as { maxSearchCalls?: number } | undefined;
  if (typeof plan?.maxSearchCalls === 'number' && plan.maxSearchCalls <= 0) return;
  const query = buildLocalSourcingSearchQuery(ingredients, location);
  if (!query) return;
  send('status', { stage: 'calling_tools', tools: ['search_web'], deterministic: true, reason: 'local_sourcing' });
  await executeAndStreamTool(ctx, 'search_web', { query, purpose: 'local_sourcing' }, userMessage, send, calledTools, toolPayloads);
}

function isExplicitLocalSourcingSearchRequest(userMessage: string): boolean {
  return /\b(?:where\s+(?:can|could|should)\s+i\s+(?:buy|find|get|source)|where\s+to\s+(?:buy|find|get|source)|near\s+me|nearby|local\s+(?:store|market|grocery|shop|source|supplier)|grocery\s+(?:store|market)|source\s+(?:ingredients?|this)|buy\s+(?:ingredients?|it)|find\s+(?:ingredients?|it))\b/i.test(userMessage);
}

function buildLocalSourcingSearchQuery(ingredients: string[], location: string): string {
  const ingredientQuery = ingredients
    .map((ingredient) => ingredient.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' ');
  if (!ingredientQuery || !location.trim()) return '';
  const specialtyTerms = /\b(?:chilhuacle|chile|chiles|mole|masa|maiz|maize|achiote|annatto|epazote|quesillo|oaxac)/i.test(ingredientQuery)
    ? 'Mexican Oaxacan grocery dried chiles spice shop'
    : 'specialty grocery market store shop';
  return sanitizeGroundedSearchQuery(`${ingredientQuery} ${location.trim()} ${specialtyTerms}`);
}

function extractSourcingIngredients(userMessage: string, collectedMemory: unknown): string[] {
  const memory = collectedMemory as CollectedFoodMemory | undefined;
  const remembered = memory?.extractedClues?.rememberedIngredients ?? [];
  return [...new Set([
    ...remembered,
    ...extractSubstitutionTargets(userMessage, collectedMemory),
  ].map((ingredient) => ingredient.trim()).filter(Boolean))];
}

function maybeSendSubstitutionBasisResponse({
  userMessage,
  toolPayloads,
  calledTools,
  send,
  finish,
}: {
  userMessage: string;
  toolPayloads: Record<string, unknown>;
  calledTools: Set<string>;
  send: SseSender;
  finish: DoneSender;
}): boolean {
  if (!hasSubstitutionBasisReady(toolPayloads, calledTools)) return false;
  const responseText = buildSubstitutionBasisResponse(toolPayloads, userMessage);
  send('text', responseText);
  maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
  finish({ guarded: 'substitution_basis_deterministic_completion' });
  return true;
}

function shouldReplaceWithSubstitutionBasisResponse(text: string, toolPayloads: Record<string, unknown>, calledTools: Set<string>): boolean {
  if (!hasSubstitutionBasisReady(toolPayloads, calledTools)) return false;
  const plan = toolPayloads.plan_tool_workflow as { workflowSteps?: Array<{ tool?: string }> } | undefined;
  const needsSourcing = (plan?.workflowSteps ?? []).some((step) => step.tool === 'source_ingredients');
  const hasFirstCue = /\b(?:what to test first|minimum viable|first[-\s]?pass|first tiny check)\b/i.test(text);
  const hasSubstitutes = /\bSubstitutes to try\b/i.test(text);
  const hasSourcing = /\bWhere to (?:buy|find)\b/i.test(text);
  return !(hasFirstCue && hasSubstitutes && (!needsSourcing || hasSourcing));
}

// ── Public entry point ──────────────────────────────────────────────────────────
export async function runAskWorkflow({
  input,
  deps,
  emit,
}: {
  input: RunAskWorkflowInput;
  deps: AskEngineDeps;
  emit: AskEventSink;
}): Promise<void> {
  // All per-call state lives on this immutable context, threaded explicitly into every helper. No module
  // singletons, so concurrent invocations (e.g. HTTP /ask + in-process MCP reconstruct) never clobber
  // each other's provider runtime, tool context, quality report, cache, budgets, or ctx.logger.
  const ctx: AskRunContext = {
    providerRuntime: deps.providerRuntime,
    toolContext: deps.toolContext,
    qualitySignalReport: deps.qualitySignalReport,
    cacheState: deps.cacheState,
    deterministicToolChain: deps.deterministicToolChain,
    finalSynthesisMaxTokens: deps.finalSynthesisMaxTokens,
    finalSynthesisTimeoutMs: deps.finalSynthesisTimeoutMs,
    logger: deps.logger ?? defaultEngineLogger,
  };
  const streamClosed = deps.streamClosed ?? (() => false);

  const { userMessage, history, consent } = input;

  // Replaces the former SSE `send` closure: the same text-event boundary sanitization, writing to the
  // injected transport-neutral `emit` sink instead of an SSE frame.
  const send: SseSender = (event, data) => {
    const payload = event === 'text' && typeof data === 'string'
      ? enforceAllergyProfessionalBoundary(sanitizeFoodSafetyClaimLanguage(data), userMessage)
      : data;
    emit(event, payload);
  };

  try {
    const askSession = ctx.providerRuntime.createAskSession({ userMessage, history, images: input.images });
    const askTurn = createAskTurnState(userMessage);
    const { calledTools, toolPayloads, deterministicPlanInput } = askTurn;
    const finish: DoneSender = (data = {}) => {
      recordAskCompletion(ctx, toolPayloads, calledTools, data, consent);
      send('done', data);
    };

    await runDeterministicWorkflowPlan({
      askSession,
      state: askTurn,
      toolContext: ctx.toolContext,
      executeTool: executeToolDefinition,
      configureAvailableTools: configureAvailableAskTools,
      send,
    });

    let modelResponse: AskModelResponse | null = null;
    if (ctx.deterministicToolChain) {
      const calledToolCountBeforeDeterministicChain = calledTools.size;
      try {
        modelResponse = await runDeterministicPlannedToolChain({
          ctx,
          userMessage,
          history,
          askSession,
          toolPayloads,
          calledTools,
          send,
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        if (calledTools.size === calledToolCountBeforeDeterministicChain) {
          ctx.logger.warn(`[ask] deterministic planned tool chain unavailable before tool execution, falling back to provider loop: ${detail}`);
          send('status', { stage: 'deterministic_tool_chain_fallback', reason: 'pre_tool_failure' });
        } else {
          throw err;
        }
      }
    }

    if (!modelResponse) {
      const nativeToolSupport = await ctx.providerRuntime.selectedProviderSupportsNativeTools();
      if (nativeToolSupport === false) {
        ctx.logger.warn('[ask] selected provider/model does not advertise native tool support, using deterministic workflow');
        if (await recoverFromInitialProviderFailure({ ctx, userMessage, toolPayloads, calledTools, send, finish, guarded: 'provider_tool_deterministic_recovery' })) return;
      }

      send('status', { stage: 'model' });
      try {
        modelResponse = await askSession.create(4096);
      } catch (err) {
        if (isRecoverableAskProviderFailure(ctx, err)) {
          ctx.logger.warn(`[ask] recoverable provider failure before first model turn, using deterministic recovery: ${providerRecoveryLogSummary(err)}`);
          if (await recoverFromInitialProviderFailure({ ctx, userMessage, toolPayloads, calledTools, send, finish, guarded: 'provider_context_deterministic_recovery' })) return;
        }
        throw err;
      }
      ctx.logger.info(`[ask] model_response content=text:${modelResponse.textBlocks.length},tools:${modelResponse.toolCalls.length}`);
      if (modelResponse.toolCalls.length === 0) {
        ctx.logger.warn('[ask] model skipped required Achiote tool workflow, retrying with explicit tool instruction');
        askSession.pushUserMessage('You did not call any tools. You MUST call collect_food_memory with the user\'s message as the memoryText parameter before responding. Do not answer without using tools.');
        send('status', { stage: 'model', retry: true });
        try {
          modelResponse = await askSession.create(4096);
        } catch (err) {
          if (isRecoverableAskProviderFailure(ctx, err)) {
            ctx.logger.warn(`[ask] recoverable provider failure on retry, using deterministic recovery: ${providerRecoveryLogSummary(err)}`);
            if (await recoverFromInitialProviderFailure({ ctx, userMessage, toolPayloads, calledTools, send, finish, guarded: 'provider_context_deterministic_recovery' })) return;
          }
          throw err;
        }
        ctx.logger.info(`[ask] retry model_response content=text:${modelResponse.textBlocks.length},tools:${modelResponse.toolCalls.length}`);
      }
      if (modelResponse.toolCalls.length === 0) {
        ctx.logger.warn('[ask] model still skipped tool workflow after retry');
        if (await recoverFromInitialProviderFailure({ ctx, userMessage, toolPayloads, calledTools, send, finish, guarded: 'provider_tool_deterministic_recovery' })) return;
      }

      let iterations = 0;
      const toolCallHistory: Array<{ name: string; input: unknown }> = askTurn.didInjectPlanToolResult
        ? [{ name: 'plan_tool_workflow', input: deterministicPlanInput }]
        : [];
      const MAX_TOOL_CALLS_PER_NAME = 5;
      let searchCallCount = 0;

      function getMaxSearchCalls(): number {
        const plan = toolPayloads.plan_tool_workflow as { maxSearchCalls?: number } | undefined;
        return typeof plan?.maxSearchCalls === 'number' ? plan.maxSearchCalls : 1;
      }

      while (modelResponse.toolCalls.length > 0 && iterations < 15) {
        if (streamClosed()) return;
        iterations++;
        const normalizedToolCalls = normalizeModelToolCalls(modelResponse.toolCalls);
        if (normalizedToolCalls.normalizedAny) {
          modelResponse = { ...modelResponse, toolCalls: normalizedToolCalls.toolCalls };
          for (const correction of normalizedToolCalls.corrections) {
            ctx.logger.warn(`[ask] normalized model tool name typo: ${correction.from} -> ${correction.to}`);
            send('status', { iteration: iterations, stage: 'tool_name_normalized', from: correction.from, to: correction.to });
          }
          for (const dropped of normalizedToolCalls.droppedMalformed) {
            ctx.logger.warn(`[ask] dropped malformed provider tool-call envelope from tool name: ${dropped.name.slice(0, 160)}`);
            send('status', { iteration: iterations, stage: 'malformed_tool_call_dropped', tool: dropped.name, reason: dropped.reason });
          }
        }
        const toolNames = modelResponse.toolCalls.map((call) => call.name);
        ctx.logger.info(`[ask] iteration=${iterations} calling tools: ${toolNames.join(', ')}`);

        // Detect tool loops: filter out tools called too many times,
        // but allow other new tools in the same batch to proceed.
        const { allowedCalls: filteredCalls, blockedCalls } = filterRepeatedToolCalls(
          modelResponse.toolCalls,
          toolCallHistory,
          MAX_TOOL_CALLS_PER_NAME,
        );

        if (blockedCalls.length > 0) {
          for (const blocked of blockedCalls) {
            const tool = blocked.call.name;
            const count = blocked.previousCount + 1;
            ctx.logger.warn(`[ask] tool loop detected: ${tool} called ${count} times, skipping duplicate (${blocked.reason})`);
            send('status', { iteration: iterations, stage: 'tool_loop_detected', tool, count, reason: blocked.reason });
          }
          modelResponse = {
            textBlocks: filteredCalls.length > 0
              ? modelResponse.textBlocks
              : (modelResponse.textBlocks.length > 0 ? modelResponse.textBlocks : [`I've gathered enough information so far. Let me work with what we have.`]),
            toolCalls: filteredCalls,
            providerMessage: modelResponse.providerMessage ?? null,
          };
        }

        if (modelResponse.toolCalls.length === 0) break;

        send('status', { iteration: iterations, stage: 'calling_tools', tools: toolNames });
        const toolResults: Array<{ id: string; content: string }> = [];

        for (const call of modelResponse.toolCalls) {
          try {
            if (!KNOWN_TOOL_NAMES.has(call.name)) {
              const resultPayload = {
                skipped: true,
                unknownTool: true,
                message: `Unknown tool "${call.name}" is outside the Achiote workflow. Continue with the available Achiote food-memory tools.`,
              };
              ctx.logger.warn(`[ask] blocked unknown provider tool call: ${call.name}`);
              send('status', { iteration: iterations, stage: 'unknown_tool_call_blocked', tool: call.name });
              send('tool_call', { name: call.name, input: call.input, blocked: true, unknownTool: true });
              send('tool_result', { name: call.name, result: resultPayload, blocked: true, unknownTool: true });
              toolResults.push({ id: call.id, content: JSON.stringify(resultPayload) });
              toolCallHistory.push({ name: call.name, input: call.input });
              continue;
            }
            if (call.name === 'generate_recipe' || call.name === 'validate_recipe_output') {
              const resultPayload = {
                skipped: true,
                message: 'Recipe tools are outside the /ask minimum-cue flow. Synthesize from the minimum viable nostalgia cue instead.',
              };
              ctx.logger.warn(`[ask] blocked ${call.name} during minimum-cue ask flow`);
              send('tool_call', { name: call.name, input: call.input, blocked: true });
              send('tool_result', { name: call.name, result: resultPayload, blocked: true });
              toolResults.push({ id: call.id, content: JSON.stringify(resultPayload) });
              toolCallHistory.push({ name: call.name, input: call.input });
              continue;
            }
            if (call.name === 'search_web' && DISABLE_SEARCH_WEB) {
              const resultPayload = {
                skipped: true,
                disabled: true,
                message: 'search_web is disabled for this Achiote run. Continue from collected memory, resolver, and internal reference data.',
              };
              ctx.logger.warn('[ask] blocked search_web because ACHIOTE_DISABLE_SEARCH_WEB=true');
              send('status', { iteration: iterations, stage: 'search_web_blocked', disabled: true });
              toolResults.push({ id: call.id, content: JSON.stringify(resultPayload) });
              toolCallHistory.push({ name: call.name, input: call.input });
              continue;
            }
            // Enforce search_web call cap. Hard block, never falls through.
            if (call.name === 'search_web' && searchCallCount >= getMaxSearchCalls()) {
              const cached = toolPayloads.search_web;
              const maxSearchCalls = getMaxSearchCalls();
              const normalizedInput = normalizeDependentToolInput('search_web', call.input, userMessage, toolPayloads, history);
              ctx.logger.warn(`[ask] search_web cap hard-block (${searchCallCount}/${maxSearchCalls}), ${cached ? 'reusing cached' : 'returning cap message'}`);
              const resultPayload = cached ?? { capReached: true, message: `search_web capped at ${maxSearchCalls} call(s). Use prior research results.` };
              send('tool_call', { name: 'search_web', input: normalizedInput, blocked: true });
              send('tool_result', { name: 'search_web', result: resultPayload, blocked: true });
              if (maxSearchCalls === 0) {
                send('status', { iteration: iterations, stage: 'search_web_blocked', reason: 'no_search_plan' });
              }
              toolResults.push({ id: call.id, content: JSON.stringify(resultPayload) });
              toolCallHistory.push({ name: call.name, input: normalizedInput });
              continue;
            }
            const payload = await executeAndStreamTool(ctx, call.name, call.input, userMessage, send, calledTools, toolPayloads, history);
            if (call.name === 'search_web') searchCallCount++;
            const content = JSON.stringify(payloadForModelToolResult(call.name, payload, userMessage));
            toolResults.push({ id: call.id, content });
            toolCallHistory.push({ name: call.name, input: call.input });
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            const code = err instanceof ToolExecutionError ? err.code : 'tool_failed';
            send('error', { message: 'Tool failed', tool: call.name, code, detail });
            finish({ error: code, detail });
            return;
          }
        }

        askSession.appendToolResults(modelResponse, toolResults);
        if (modelResponse.toolCalls.some((call) => call.name === 'generate_minimum_viable_nostalgia')) {
          await maybeRunPlannedSubstitutions({ ctx, userMessage, toolPayloads, calledTools, send });
          await maybeRunPlannedSourcing({ ctx, userMessage, toolPayloads, calledTools, send });
          askSession.compactForSynthesis(formatAskCaseFileForModel(buildAskCaseFile({
            userMessage,
            history,
            toolPayloads,
            calledTools: [...calledTools],
          })));
          send('status', { iteration: iterations, stage: 'case_file_compacted' });
        } else {
          configureAvailableAskTools(askSession, toolPayloads, calledTools);
        }
        send('status', { iteration: iterations, stage: 'thinking' });
        try {
          modelResponse = await createWithTimeout(askSession, ctx.finalSynthesisMaxTokens, ctx.finalSynthesisTimeoutMs);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          if (modelResponse.toolCalls.some((call) => call.name === 'generate_minimum_viable_nostalgia')) {
            if (isSubstitutionPlan(toolPayloads)) {
              await maybeRunPlannedSubstitutions({ ctx, userMessage, toolPayloads, calledTools, send });
              if (maybeSendSubstitutionBasisResponse({ userMessage, toolPayloads, calledTools, send, finish })) {
                return;
              }
            }
            await maybeRunPlannedSourcing({ ctx, userMessage, toolPayloads, calledTools, send });
            ctx.logger.warn(`[ask] final synthesis unavailable after minimum cue, using deterministic response: ${detail}`);
            const responseText = buildMinimumCueCompletedResponse(toolPayloads, userMessage);
            send('text', responseText);
            maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
            finish({ guarded: 'minimum_cue_deterministic_completion' });
            return;
          }
          ctx.logger.warn(`[ask] model thinking turn timed out after tools, using deterministic continuation: ${detail}`);
          modelResponse = { textBlocks: [], toolCalls: [], providerMessage: null };
          break;
        }
      }
    }

    if (!modelResponse) throw new Error('ask model response unavailable');

    await maybeRunMissingResearchPlan({ ctx, userMessage, toolPayloads, calledTools, send });
    await maybeRunOriginalSubstitutionBasisCue({ ctx, userMessage, toolPayloads, calledTools, send });
    await maybeRunPlannedSubstitutions({ ctx, userMessage, toolPayloads, calledTools, send });
    await maybeRunPlannedSourcing({ ctx, userMessage, toolPayloads, calledTools, send });

    if ((modelResponse.textBlocks.length === 0 || containsStalledFallbackText(modelResponse.textBlocks.join('\n\n')))
      && maybeSendSubstitutionBasisResponse({ userMessage, toolPayloads, calledTools, send, finish })) {
      return;
    }

    if (!calledTools.has('collect_food_memory')) {
      ctx.logger.warn('[ask] model called tools but skipped required memory collection, using deterministic recovery');
      if (await recoverFromInitialProviderFailure({
        ctx,
        userMessage,
        toolPayloads,
        calledTools,
        send,
        finish,
        guarded: 'provider_tool_deterministic_recovery',
        reason: 'missing_required_memory_tool',
      })) return;
    }

    if (shouldAskForSourcingLocation(userMessage, toolPayloads, calledTools)) {
      ctx.logger.warn('[ask] sourcing requested without a current location, asking for sourcing location');
      const responseText = enforceAllergyProfessionalBoundary(buildSourcingLocationClarificationResponse(toolPayloads, userMessage), userMessage);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'sourcing_location_clarification' });
      return;
    }

    if (await maybeSendForcedMinimumCue({ ctx, userMessage, toolPayloads, calledTools, send, finish })) {
      return;
    }

    // Follow-up escape hatch: if the user has already answered clarification questions and
    // their memory now has substantive anchors, skip the entire guard chain. The guards are
    // designed for first-turn sparsity; on follow-ups they just replace good model output.
    const isFollowUpWithAnchors = (history !== undefined && history.length > 0)
      && hasSubstantialMemoryAnchors(toolPayloads.collect_food_memory);
    if (isFollowUpWithAnchors) {
      ctx.logger.info('[ask] follow-up with substantive anchors, skipping guard chain');
    }

    if (!isFollowUpWithAnchors && calledTools.has('collect_food_memory') && !calledTools.has('plan_dish_research') && !calledTools.has('generate_minimum_viable_nostalgia')) {
      // In a follow-up turn the user answered the previous clarification question. If the
      // collected memory now has substantive anchors (location, cultural hint, or ≥2 ingredients)
      // let the model's natural response through instead of looping back to clarification.
      const isFollowUp = history !== undefined && history.length > 0;
      if (isFollowUp && hasSubstantialMemoryAnchors(toolPayloads.collect_food_memory)) {
        ctx.logger.info('[ask] follow-up with substantive anchors, skipping missing_research_plan_clarification guard');
      } else {
        ctx.logger.warn('[ask] replaced response that skipped research planning with structured clarification');
        const responseText = buildClarificationOnlyResponse(toolPayloads, userMessage);
        send('text', responseText);
        maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
        finish({ guarded: 'missing_research_plan_clarification' });
        return;
      }
    }

    if (!isFollowUpWithAnchors && calledTools.has('collect_food_memory')
      && calledTools.has('plan_dish_research')
      && !calledTools.has('generate_minimum_viable_nostalgia')
      && (modelResponse.textBlocks.length === 0 || containsStalledFallbackText(modelResponse.textBlocks.join('\n\n')))) {
      ctx.logger.warn('[ask] replaced stalled post-plan response with structured clarification');
      const responseText = buildClarificationOnlyResponse(toolPayloads, userMessage);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'missing_research_plan_clarification' });
      return;
    }

    if (!isFollowUpWithAnchors
      && !calledTools.has('generate_minimum_viable_nostalgia')
      && shouldClarifyUnresolvedUnnamedMemory(userMessage, toolPayloads, calledTools, modelResponse.textBlocks.join('\n\n'))) {
      ctx.logger.warn('[ask] replaced unresolved unnamed pre-cue response with targeted clarification');
      const responseText = buildClarificationOnlyResponse(toolPayloads, userMessage, { includeEvidencePreamble: false });
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'unnamed_memory_clarification' });
      return;
    }

    if (!isFollowUpWithAnchors && !calledTools.has('generate_minimum_viable_nostalgia') && containsConcreteFoodCue(modelResponse.textBlocks.join('\n\n'))) {
      ctx.logger.warn('[ask] suppressed concrete cue before minimum viable nostalgia tool');
      const responseText = buildClarificationOnlyResponse(toolPayloads, userMessage);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'premature_concrete_cue' });
      return;
    }

    if (!isFollowUpWithAnchors && !calledTools.has('generate_minimum_viable_nostalgia') && containsGenericUncertaintyWaffle(modelResponse.textBlocks.join('\n\n'))) {
      ctx.logger.warn('[ask] replaced generic uncertainty prose with structured clarification');
      const responseText = buildClarificationOnlyResponse(toolPayloads, userMessage);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'generic_uncertainty_clarification' });
      return;
    }

    if (!isFollowUpWithAnchors && !calledTools.has('generate_minimum_viable_nostalgia') && containsPrematureCandidateSpeculation(modelResponse.textBlocks.join('\n\n'), toolPayloads)) {
      ctx.logger.warn('[ask] replaced premature candidate list with structured clarification');
      if (await maybeSendPrematureCandidateMinimumCue({ ctx, userMessage, toolPayloads, calledTools, send, finish })) return;
      const responseText = buildClarificationOnlyResponse(toolPayloads, userMessage);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'premature_candidate_speculation' });
      return;
    }

    if (!isFollowUpWithAnchors && calledTools.has('generate_minimum_viable_nostalgia') && shouldClarifyBroadUncertainMemory(userMessage, toolPayloads)) {
      ctx.logger.warn('[ask] replaced broad uncertain post-cue response with structured clarification');
      const responseText = buildClarificationOnlyResponse(toolPayloads, userMessage);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'broad_memory_clarification' });
      return;
    }

    // NOTE: removed shouldClarifySparseUnanchoredMemory guard here.
    // The MVN tool is the designed answer to sparse, unanchored sensory memories.
    // Replacing its output with generic clarification defeats the core product use case.

    if (calledTools.has('generate_minimum_viable_nostalgia') && containsBlockedRecipeToolSynthesis(modelResponse.textBlocks.join('\n\n'))) {
      ctx.logger.warn('[ask] replaced blocked recipe-tool synthesis with deterministic minimum cue');
      const responseText = buildMinimumCueCompletedResponse(toolPayloads, userMessage);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'minimum_cue_deterministic_completion' });
      return;
    }

    if (calledTools.has('generate_minimum_viable_nostalgia')
      && (modelResponse.textBlocks.length === 0 || containsStalledFallbackText(modelResponse.textBlocks.join('\n\n')))) {
      ctx.logger.warn('[ask] replaced stalled post-cue response with deterministic minimum cue');
      const responseText = hasUsableSearchEvidence(toolPayloads)
        ? buildResearchGroundedForcedCueResponse(toolPayloads, userMessage)
        : buildMinimumCueCompletedResponse(toolPayloads, userMessage);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'minimum_cue_deterministic_completion' });
      return;
    }

    const responseText = modelResponse.textBlocks
      .map((text) => ensureCueQualityLanguage(text, toolPayloads, calledTools))
      .join('\n\n');
    // Ground the model-synthesized reconstruction answer in the curated, Crossref-verified
    // DB (this is the live path when an API key is configured). Gated on the cue tool having
    // run, so clarification questions and planning-recovery messages are left untouched — and
    // skipped entirely when the message carries an allergen/safety constraint, so a
    // professional-deferral answer never gets a cooking citation appended.
    const groundedModelText = calledTools.has('generate_minimum_viable_nostalgia')
      && inferSafetyConstraints(userMessage).length === 0
      ? appendGroundedCitation(responseText, userMessage)
      : responseText;
    const trustBoundedResponseText = enforceAllergyProfessionalBoundary(sanitizeFinalAnswerTrustBoundaryLanguage(groundedModelText), userMessage);
    const didSanitizeTrustBoundary = trustBoundedResponseText !== responseText;

    if (calledTools.has('source_ingredients') && containsRawToolMarkup(trustBoundedResponseText)) {
      ctx.logger.warn('[ask] replaced raw tool markup sourcing synthesis with deterministic sourcing guide');
      const responseText = calledTools.has('generate_minimum_viable_nostalgia')
        ? (calledTools.has('find_sensory_substitutes') || isSubstitutionPlan(toolPayloads)
          ? buildSubstitutionBasisResponse(toolPayloads, userMessage)
          : buildMinimumCueCompletedResponse(toolPayloads, userMessage))
        : buildSourcingGuidanceResponse(toolPayloads, userMessage);
      const boundedResponseText = enforceAllergyProfessionalBoundary(responseText, userMessage);
      send('text', boundedResponseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: boundedResponseText, send });
      finish({ guarded: 'raw_tool_markup_sanitized' });
      return;
    }

    if (calledTools.has('generate_minimum_viable_nostalgia') && containsRawToolMarkup(trustBoundedResponseText)) {
      ctx.logger.warn('[ask] replaced raw tool markup synthesis with deterministic response');
      const responseText = calledTools.has('find_sensory_substitutes') || isSubstitutionPlan(toolPayloads)
        ? buildSubstitutionBasisResponse(toolPayloads, userMessage)
        : hasUsableSearchEvidence(toolPayloads)
          ? buildResearchGroundedForcedCueResponse(toolPayloads, userMessage)
          : buildMinimumCueCompletedResponse(toolPayloads, userMessage);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'raw_tool_markup_sanitized' });
      return;
    }

    if (shouldReplaceWithSourcingGuidance(trustBoundedResponseText, calledTools, toolPayloads)) {
      ctx.logger.warn('[ask] replaced sourcing response that failed to render source_ingredients guidance');
      const responseText = calledTools.has('generate_minimum_viable_nostalgia')
        ? (calledTools.has('find_sensory_substitutes') || isSubstitutionPlan(toolPayloads)
          ? buildSubstitutionBasisResponse(toolPayloads, userMessage)
          : buildMinimumCueCompletedResponse(toolPayloads, userMessage))
        : buildSourcingGuidanceResponse(toolPayloads, userMessage);
      const boundedResponseText = enforceAllergyProfessionalBoundary(responseText, userMessage);
      send('text', boundedResponseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: boundedResponseText, send });
      finish({ guarded: 'sourcing_guidance_deterministic_completion' });
      return;
    }

    if (calledTools.has('generate_minimum_viable_nostalgia') && contradictsLatestCorrection(trustBoundedResponseText, userMessage)) {
      ctx.logger.warn('[ask] replaced stale correction-conflicting response with deterministic minimum cue');
      const responseText = buildLatestCorrectionAlignedResponse(buildMinimumCueCompletedResponse(toolPayloads, userMessage), userMessage, toolPayloads);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'latest_correction_sanitized' });
      return;
    }

    // If the answer is grounded in research or concrete resolver evidence, trust the model. The quality guards below were
    // discarding good tool-backed synthesis as false positives and replacing it with generic templates.
    const resolvedForGrounding = toolPayloads.resolve_dish_name as
      | { region?: string; confidence?: string; matchType?: string }
      | undefined;
    const resolverGrounded = calledTools.has('resolve_dish_name')
      && resolvedForGrounding?.matchType !== 'unknown'
      && resolvedForGrounding?.confidence !== 'Low'
      && Boolean(resolvedForGrounding?.region && !/^unknown$/i.test(resolvedForGrounding.region));
    const researchGrounded = hasUsableSearchEvidence(toolPayloads) || resolverGrounded;
    if (calledTools.has('generate_minimum_viable_nostalgia') && containsCueFamilyMismatch(trustBoundedResponseText, userMessage) && !researchGrounded) {
      ctx.logger.warn('[ask] advisory cue-family mismatch detected; preserving model synthesis');
    }

    if (shouldReplaceWithSubstitutionBasisResponse(trustBoundedResponseText, toolPayloads, calledTools)) {
      ctx.logger.warn('[ask] replaced substitution response with explicit original-basis adaptation frame');
      const responseText = buildSubstitutionBasisResponse(toolPayloads, userMessage);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'substitution_basis_deterministic_completion' });
      return;
    }

    const collectedMemoryForIdentity = toolPayloads.collect_food_memory as { rawMemory?: string; extractedClues?: { possibleDishNames?: unknown[] } } | undefined;
    const possibleDishNames = collectedMemoryForIdentity?.extractedClues?.possibleDishNames ?? [];
    const dishNameIsExplicitlyApproximate = /\b(?:something\s+like|sounds?\s+like|sounded\s+like|kind\s+of\s+like|sort\s+of\s+like|like\s+[\p{L}\p{M}'-]+(?:\s+[\p{L}\p{M}'-]+){0,4}\s+but|rough(?:ly)?|phonetic(?:ally)?|maybe\s+called)\b/iu.test(collectedMemoryForIdentity?.rawMemory ?? userMessage);
    const userNamedDishAnchor = possibleDishNames.some((name) => {
      if (typeof name !== 'string') return false;
      const normalized = name.toLowerCase().trim();
      if (!normalized) return false;
      if (normalized.includes('-')) {
        const tokens = normalized.split(/[\s-]+/).filter(Boolean);
        if (tokens.length > 0 && tokens.every((token) => DESCRIPTIVE_HYPHEN_DISH_TOKENS.has(token))) return false;
      }
      return true;
    }) && !dishNameIsExplicitlyApproximate && researchGrounded;
    if (calledTools.has('generate_minimum_viable_nostalgia') && containsOverconfidentIdentityClaim(trustBoundedResponseText) && !userNamedDishAnchor && !researchGrounded) {
      ctx.logger.warn('[ask] advisory overconfident identity claim detected; preserving model synthesis');
    }

    if (calledTools.has('generate_minimum_viable_nostalgia') && containsRecipeProcedureOrAdaptationLanguage(trustBoundedResponseText) && !researchGrounded) {
      ctx.logger.warn('[ask] advisory recipe procedure drift detected; preserving model synthesis');
    }

    if (calledTools.has('generate_minimum_viable_nostalgia')
      && shouldClarifyUnresolvedUnnamedMemory(userMessage, toolPayloads, calledTools, trustBoundedResponseText)) {
      ctx.logger.warn('[ask] replaced unresolved unnamed cue with targeted clarification');
      const responseText = buildClarificationOnlyResponse(toolPayloads, userMessage, { includeEvidencePreamble: false });
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'unnamed_memory_clarification' });
      return;
    }

    if (calledTools.has('generate_minimum_viable_nostalgia') && containsRecipeMeasurementLanguage(trustBoundedResponseText)) {
      ctx.logger.warn('[ask] suppressed recipe-style measurements in cue response');
      const sanitized = sanitizeRecipeStyleCueLanguage(trustBoundedResponseText);
      if (lacksMinimumCueLanguage(sanitized)) {
        ctx.logger.warn('[ask] sanitized measurement text still lacks minimum cue language; falling back to deterministic minimum cue');
        const responseText = hasUsableSearchEvidence(toolPayloads)
          ? buildResearchGroundedForcedCueResponse(toolPayloads, userMessage)
          : buildMinimumCueCompletedResponse(toolPayloads, userMessage);
        send('text', responseText);
        maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
        finish({ guarded: 'minimum_cue_language_sanitized' });
        return;
      }
      send('text', sanitized);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: sanitized, send });
      finish({ guarded: 'recipe_measurement_sanitized' });
      return;
    }

    if (calledTools.has('generate_minimum_viable_nostalgia') && lacksMinimumCueLanguage(trustBoundedResponseText)) {
      ctx.logger.warn('[ask] replaced missing-minimum-cue response with deterministic minimum cue');
      const responseText = hasUsableSearchEvidence(toolPayloads)
        ? buildResearchGroundedForcedCueResponse(toolPayloads, userMessage)
        : buildMinimumCueCompletedResponse(toolPayloads, userMessage);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'minimum_cue_language_sanitized' });
      return;
    }

    if (trustBoundedResponseText) send('text', trustBoundedResponseText);
    maybeSendMemoryReceipt({ toolPayloads, assistantText: trustBoundedResponseText, send });
    finish(didSanitizeTrustBoundary ? { guarded: 'trust_boundary_sanitized' } : {});
  } catch (err) {
    send('error', sanitizeAskError(err));
  }
}
