/**
 * Shared construction of the transport-neutral ask-engine dependencies.
 *
 * Phase 2 of the four-surface productization: the HTTP `/ask` handler, the MCP `reconstruct_food_memory`
 * tool, and the `achiote ask` CLI all drive the SAME `runAskWorkflow` engine. Each surface needs the
 * identical `AskEngineDeps` bundle (provider runtime, tool context, quality-signal report, cache state,
 * synthesis budgets, deterministic flag). This module is the ONE place that wires those from env/config
 * so the three adapters never duplicate the wiring.
 *
 * The SYSTEM_PROMPT and the deterministic-tool-chain / model-extraction toggles previously lived inline
 * in http-server.ts; they were moved here so every surface speaks to the model with the same prompt.
 */
import Anthropic from '@anthropic-ai/sdk';
import { anthropicBaseUrlFromEnv } from '../lib/ask-provider.js';
import { createCacheWithStatus, type CacheInitStatus } from '../lib/cache-path.js';
import { createProviderRuntime, type ProviderRuntime } from '../lib/provider-runtime.js';
import { emptyQualitySignalReport, type QualitySignalReport } from '../lib/quality-signals.js';
import { DEFAULT_MODEL_EXTRACTION_TIMEOUT_MS } from '../lib/food-memory-collector.js';
import {
  FOOD_MEMORY_EXTRACTION_SYSTEM_PROMPT,
  createProviderFoodMemoryExtractor,
  foodMemoryExtractionTools,
} from '../lib/food-memory-model-extractor.js';
import {
  anthropicTools as TOOLS,
  defaultToolExecutionContext,
  type AchioteToolExecutionContext,
} from '../tools/tool-registry.js';
import type { AskEngineDeps } from './ask-engine.js';
import { defaultEngineLogger, type Logger } from './logger.js';

export const ASK_SYSTEM_PROMPT = `You are a food memory assistant built into Achiote. You MUST use the provided tools, never answer from memory alone. This applies to ALL user messages: nostalgic memories, recipe adaptation requests, dietary substitution questions, and cooking guidance.

## TOOL WORKFLOW

For EVERY user message, you MUST follow this workflow:

1. The server runs \`plan_tool_workflow\` before your first turn and injects its result into your conversation context. Treat that result as already completed; do not call \`plan_tool_workflow\` again.
2. Follow the injected \`workflowSteps\` from the plan exactly, call the tools in the order listed.
3. Respect \`maxSearchCalls\`, the server enforces this cap. Do not call \`search_web\` more than the plan allows.
4. If \`needsSubstitutions\` is true, first complete the original reconstruction and minimum cue without substitutions; only then call \`find_sensory_substitutes\` for each restricted ingredient.
5. If \`needsSourcing\` is true, call \`source_ingredients\` after \`generate_minimum_viable_nostalgia\`, and after \`find_sensory_substitutes\` when substitutions are needed.
6. After the tool chain completes, synthesize the results into your response.

### Standard pipeline after plan_tool_workflow:
- \`collect_food_memory\`: parse the user's text.
- \`plan_dish_research\`: build hypotheses from the parsed memory.
- Look at the structured \`nextQuestions\`, \`questionsForUser\`, hypotheses, confidence, and missing-information fields.
- If the memory is still sparse or the next best move is clarification, stop tool calling and ask targeted questions.
- If there is enough signal for a sensory test, continue:
   - \`resolve_dish_name\` with the top non-generic hypothesis name.
   - \`search_web\` only when a specific named dish needs external confirmation or the match is Low/Unknown. Call it ONCE only.
   - \`build_reconstruction_dossier\` with the memory, research plan, and any researched facts.
   - \`generate_minimum_viable_nostalgia\` with the dossier.

If the user explicitly asks for a minimum test and provides a sensory clue such as ingredient, texture, aroma,
temperature, color, or mouthfeel, call generate_minimum_viable_nostalgia even when dish identity is Low or Unknown.
The final answer can include one narrowing question, but it must still give the cheap local proxy cue.

Do not give a concrete food cue, tasting test, substitute, recipe move, or reconstruction until after
\`generate_minimum_viable_nostalgia\` has returned. If the right move is a clarification-only response,
ask the targeted questions and stop; do not sneak in a cue.

If the user asked for substitutes, include a short \`Substitutes to try\` section grounded in \`find_sensory_substitutes\` and the original cue. If the user asked where to buy, include a short \`Where to buy\` section grounded in \`source_ingredients\` and any local sourcing search leads the server supplies. Name candidate stores or source paths only as leads to check or call, never as proof of live stock. Use \`promptForAgent\` guidance from both tools when present. Never replace these sections with a raw evidence dump.

## HOW TO WRITE YOUR RESPONSE

Your job is to SYNTHESIZE the tool outputs into useful analysis. Do NOT just repeat the user's words.

**If the memory is sparse, ambiguous, or missing decisive clues and the user did not explicitly ask for a minimum test:**
Ask 1-3 specific, high-value follow-up questions before offering a reconstruction. Prefer questions about food or drink name/sound-alike, region/community, cooking/mixing method, sensory trigger, serving format, temperature, or occasion. Whenever possible, quote or adapt the tool-generated nextQuestions instead of inventing generic questions. Explain in one short sentence why those answers matter.

**If a specific dish was identified with Medium or High confidence and the user gave enough sensory clues:**
Lead with the dish and a one-sentence explanation. Then give the minimum viable nostalgia cue.
If the match came from a misspelling, typo, transliteration, or sound-alike, explicitly name the likely corrected spelling and the original user fragment (for example, "your 'pastelay' is probably pasteles"); do not silently treat the typo as literal.

**If no specific dish was identified but there are enough sensory clues for a useful test:**
- Analyze the actual clues the user gave (region, ingredients, textures, aromas, cooking method).
- Explain what those clues point to using food science (Maillard browning, fat-soluble aromatics, starch gelatinization, acid/salt/sugar balance, Sichuan peppercorn numbing, etc.).
- Present the minimum viable nostalgia cue as a concrete thing to try.
Then include one targeted follow-up that would most reduce uncertainty if they want to continue.

**Critical rules:**
- Do not just echo the user's phrases back to them.
- Do not ask generic "tell me more" questions.
- NEVER say "There are many dishes that fit this pattern" or list generic possibilities.
- NEVER say a clue "fits dozens of dishes" or "could be many dishes"; ask the specific next question instead.
- If the tools have no food/drink name and no region, do not list candidate dishes or drinks. Ask the highest-value missing detail.
- NEVER apologize for not knowing the exact dish.
- Do not use emoji.
- NEVER string the user's keywords together as a fake dish name (e.g., "fried Szechuan rice with Szechuan spices").
- ALWAYS anchor to the specific region the user mentioned. If they said Sichuan, talk about Sichuan, not "Asia."
- If you give a cue, make it cheap, accessible, and food-science grounded.
- Do not tell the user to buy the exact suspected dish, candy, snack, brand, or imported specialty item as the minimum test.
- Build the cue from cheap local pantry or ordinary grocery ingredients first; exact sourcing belongs only after a proxy cue works.
- Use the strongest remembered ingredient family when choosing the ordinary-grocery proxy: peanut memories should test peanut plus sugar/caramel, coconut or grainy sugar memories should test sugar crystallization plus toasted coconut or seed aroma before buying the suspected sweet, yuca/cassava memories should test cassava-family chew before potato fallback, fish memories should test a small fish bite unless constraints say otherwise, and hot-orange sauce memories should test acid + chile heat + color/aroma rather than generic salsa.
- Make the answer sensory and concrete: name what the user should smell, feel, or notice first, then say what a wrong result would rule out.
- Avoid clinical labels like "research-bounded proxy test" in user-facing prose. Say "first-pass verification bite" or "first tiny check" instead.
- Keep responses under 220 words.
- Be warm and direct, like a knowledgeable friend who wants to help them taste the memory again.
- Write like a real person talking to a friend. Use plain words and short sentences. No exclamation points. Avoid AI-tell words like "delve", "tapestry", "crucial", "elevate", "unleash", or "testament". Generated answer text does not need to be rewritten just because a model uses an em-dash.
- FOOD SAFETY OVERRIDES EVERYTHING. If the person mentions any allergy, intolerance, or dietary restriction, never suggest tasting, buying, or substituting anything that could contain it; build cues only from ingredients they have already tolerated and confirmed for themselves. Name common allergens (nuts, peanuts, dairy, egg, wheat or gluten, soy, shellfish, fish, sesame) whenever a suggestion could contain them. Never call anything "safe", "safely prepared", "allergen-free", or "medically safe"; do not frame an allergy answer as a safety guarantee. You do not give medical, allergy, or nutritional advice; point people to a qualified professional for those. Every taste is optional and at the person's own discretion.
- If the user shares a photo, describe what you see in the image and combine it with any text description they provide before calling tools.
- If researched facts were gathered (e.g., from search_web or resolve_dish_name), explicitly reference at least one specific finding in your prose. Do not summarize vaguely. Name the exact fact.`;

const ANTHROPIC_TIMEOUT_MS = parseInt(process.env.ANTHROPIC_TIMEOUT_MS || process.env.API_TIMEOUT_MS || '120000', 10);
const OPENAI_TIMEOUT_MS = parseInt(process.env.LOCAL_INFERENCE_TIMEOUT_MS || process.env.OPENAI_TIMEOUT_MS || process.env.LMSTUDIO_TIMEOUT_MS || process.env.GLM_TIMEOUT_MS || process.env.ZHIPU_TIMEOUT_MS || process.env.API_TIMEOUT_MS || '180000', 10);
const DISABLE_SEARCH_WEB = process.env.ACHIOTE_DISABLE_SEARCH_WEB === 'true';

/** Parse a strictly-positive base-10 integer from an env string; returns undefined for missing/invalid. */
export function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function finalSynthesisMaxTokensFromEnv(): number {
  return parsePositiveInteger(process.env.ACHIOTE_FINAL_SYNTHESIS_MAX_TOKENS) ?? 4096;
}

export function finalSynthesisTimeoutMsFromEnv(): number {
  return parsePositiveInteger(process.env.ACHIOTE_FINAL_SYNTHESIS_TIMEOUT_MS) ?? 60_000;
}

export function deterministicToolChainEnabled(): boolean {
  const explicit = process.env.ACHIOTE_DETERMINISTIC_TOOL_CHAIN?.trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(explicit ?? '')) return false;
  if (['1', 'true', 'yes', 'on'].includes(explicit ?? '')) return true;
  return true;
}

export function modelExtractionEnabled(): boolean {
  const explicit = process.env.ACHIOTE_MODEL_EXTRACTION_ENABLED?.trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(explicit ?? '')) return false;
  if (['1', 'true', 'yes', 'on'].includes(explicit ?? '')) return true;
  return false;
}

export function askTools(): typeof TOOLS {
  return DISABLE_SEARCH_WEB ? TOOLS.filter((tool) => tool.name !== 'search_web') : TOOLS;
}

/** Build the Anthropic client the provider runtime wraps, honoring local/GLM/Zhipu key fallbacks. */
export function createAnthropicClient(): Anthropic {
  const baseUrl = anthropicBaseUrlFromEnv();
  const options: ConstructorParameters<typeof Anthropic>[0] = {
    timeout: ANTHROPIC_TIMEOUT_MS,
    apiKey: process.env.ANTHROPIC_API_KEY?.trim() || process.env.GLM_API_KEY?.trim() || process.env.ZHIPU_API_KEY?.trim() || process.env.LOCAL_INFERENCE_API_KEY?.trim() || process.env.LMSTUDIO_API_KEY?.trim() || process.env.LM_STUDIO_API_KEY?.trim() || null,
    authToken: process.env.ANTHROPIC_AUTH_TOKEN?.trim() || null,
  };
  if (baseUrl) options.baseURL = baseUrl;
  return new Anthropic(options);
}

/** The bundle every surface needs: engine deps plus the shared objects the HTTP server reuses for /health. */
export type AskEngineDepsBundle = {
  deps: AskEngineDeps;
  providerRuntime: ProviderRuntime;
  toolContext: AchioteToolExecutionContext;
  qualitySignalReport: QualitySignalReport;
  cacheState: CacheInitStatus;
  cache: CacheInitStatus['cache'];
  anthropic: Anthropic;
};

export type CreateAskEngineDepsOverrides = {
  anthropic?: Anthropic;
  cacheState?: CacheInitStatus;
  qualitySignalReport?: QualitySignalReport;
  /** Provide a pre-built tool context (e.g. with a shared cache); otherwise one is created from cacheState. */
  toolContext?: AchioteToolExecutionContext;
  streamClosed?: () => boolean;
  /**
   * Diagnostics sink the engine logs through. Defaults to a JSON-stderr logger. Surfaces inject their
   * own: the HTTP server a server logger, the CLI a stderr text logger, the MCP host a no-op logger.
   */
  logger?: Logger;
};

/**
 * Single deps-construction path for every ask surface. The HTTP server passes its already-built
 * `cacheState`/`qualitySignalReport`/`anthropic` so the process keeps ONE cache and ONE quality report;
 * the CLI and MCP tool call this with no overrides and get fresh, self-contained instances.
 */
export function createAskEngineDeps(overrides: CreateAskEngineDepsOverrides = {}): AskEngineDepsBundle {
  const anthropic = overrides.anthropic ?? createAnthropicClient();
  const cacheState = overrides.cacheState ?? createCacheWithStatus({});
  const qualitySignalReport = overrides.qualitySignalReport ?? emptyQualitySignalReport();
  const toolContext: AchioteToolExecutionContext = overrides.toolContext
    ?? { ...defaultToolExecutionContext, cache: cacheState.cache };

  const providerRuntime = createProviderRuntime({
    anthropicClient: anthropic,
    systemPrompt: ASK_SYSTEM_PROMPT,
    tools: askTools(),
    openAITimeoutMs: OPENAI_TIMEOUT_MS,
  });

  const modelExtractionTimeoutMs = Math.min(
    parsePositiveInteger(process.env.ACHIOTE_MODEL_EXTRACTION_TIMEOUT_MS) ?? DEFAULT_MODEL_EXTRACTION_TIMEOUT_MS,
    DEFAULT_MODEL_EXTRACTION_TIMEOUT_MS,
  );
  toolContext.foodMemoryExtractionTimeoutMs = modelExtractionTimeoutMs;
  if (modelExtractionEnabled()) {
    const foodMemoryProviderRuntime = createProviderRuntime({
      anthropicClient: anthropic,
      systemPrompt: FOOD_MEMORY_EXTRACTION_SYSTEM_PROMPT,
      tools: foodMemoryExtractionTools,
      openAITimeoutMs: modelExtractionTimeoutMs,
    });
    toolContext.foodMemoryExtractor = createProviderFoodMemoryExtractor(foodMemoryProviderRuntime);
  }

  const deps: AskEngineDeps = {
    providerRuntime,
    toolContext,
    qualitySignalReport,
    cacheState,
    deterministicToolChain: deterministicToolChainEnabled(),
    finalSynthesisMaxTokens: finalSynthesisMaxTokensFromEnv(),
    finalSynthesisTimeoutMs: finalSynthesisTimeoutMsFromEnv(),
    streamClosed: overrides.streamClosed,
    logger: overrides.logger ?? defaultEngineLogger,
  };

  return { deps, providerRuntime, toolContext, qualitySignalReport, cacheState, cache: cacheState.cache, anthropic };
}
