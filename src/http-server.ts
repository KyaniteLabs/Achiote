try { process.loadEnvFile(); } catch { /* no .env file present */ }

import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { isLocalInferenceUrl, anthropicBaseUrlFromEnv } from './lib/ask-provider.js';
import type { AskHistoryItem, AskImage, AskModelResponse, AskSession } from './lib/ask-provider.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createAchioteServer } from './server.js';
import { createAskTurnState, runDeterministicWorkflowPlan } from './lib/ask-controller.js';
import { buildAskCaseFile, formatAskCaseFileForModel } from './lib/ask-case-file.js';
import { createCacheWithStatus } from './lib/cache-path.js';
import { createAuthenticator, loadKeysFromEnv } from './lib/auth.js';
import { createRateLimiter } from './lib/rate-limit.js';
import { createAccountAccess, rateLimitHeaders, type AuthedRequest } from './lib/account-access.js';
import { BillingDb, defaultBillingDbPath } from './lib/billing-db.js';
import { BillingStripe, loadBillingConfigFromEnv, type CheckoutTier } from './lib/billing-stripe.js';
import { getHttpReadiness, getRequestRateLimitIdentity, shouldApplyRateLimit } from './lib/http-runtime.js';
import { resolveLocalSpeechConfig } from './lib/local-speech.js';
import { createLocalSpeechController } from './lib/local-speech-controller.js';
import { buildMemoryReceipt } from './lib/memory-receipt.js';
import { buildAskQualitySignal, emptyQualitySignalReport, inferAskCacheOutcome, recordQualitySignal } from './lib/quality-signals.js';
import { createProviderRuntime } from './lib/provider-runtime.js';
import { buildReferenceSeedOperatorReport } from './lib/reference-seed-operator.js';
import { filterRepeatedToolCalls } from './lib/tool-loop.js';
import { createTelemetryCollector, sanitizeTelemetryProperties as sanitizeTelemetryProps } from './lib/telemetry-collector.js';
import type { Tier } from './lib/auth.js';
import type { CollectedFoodMemory, DishResearchPlan, MinimumViableNostalgiaCue, ReconstructionDossier } from './lib/types.js';
import {
  anthropicTools as TOOLS,
  defaultToolExecutionContext,
  executeToolDefinition,
  outputSchemas,
  ToolExecutionError,
  type AchioteToolExecutionContext,
} from './tools/tool-registry.js';
import {
  inferSafetyConstraints,
  buildGroundedSearchQuery,
  sanitizeGroundedSearchQuery,
  isLatestCorrectionMessage,
  buildCorrectedMemoryText,
  sanitizeLatestCorrectionMemoryText,
  stripNegatedCorrectionTerms,
  sanitizeStaleModelMemoryText,
  isRecord,
} from './lib/ask-memory-correction.js';
import { escapeRegExp } from './lib/food-memory-text.js';
import {
  KNOWN_TOOL_NAMES,
  MODEL_TOOL_NAME_ALIASES,
  normalizeModelToolCalls,
  containsConcreteFoodCue,
  containsRecipeMeasurementLanguage,
  containsRecipeProcedureOrAdaptationLanguage,
  lacksMinimumCueLanguage,
  sanitizeRecipeStyleCueLanguage,
  sanitizeMinimumCueFallbackText,
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
  getStringArray,
  buildClarificationOnlyResponse,
  isExplicitMinimumTestRequest,
  buildEvidencePreamble,
} from './lib/ask-guardrails.js';
import {
  hasSubstitutionBasisReady,
  isSubstitutionPlan,
  buildSubstitutionBasisResponse,
  summarizeSubstitutionResults,
  extractSubstitutionTargets,
  normalizeSubstitutionTarget,
  hasSensorySignal,
  formatMinimumCueFallback,
  formatMinimumCueIngredientPhrase,
  firstUsefulCueStep,
  compactMinimumCueWhy,
  buildMinimumCueCompletedResponse,
  buildEvidenceBoundedMinimumCueResponse,
  containsCueFamilyMismatch,
  buildUserMessageMechanismCueResponse,
  ensureLocalCueLanguage,
  ensureCueQualityLanguage,
  ensureComposedCueCoverage,
} from './lib/ask-response-builder.js';

const TRUST_PROXY = process.env.ACHIOTE_TRUST_PROXY === 'true';
const TRUSTED_PROXY_IPS = (process.env.ACHIOTE_TRUSTED_PROXY_IPS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const ALLOW_ANON_ASK = process.env.ACHIOTE_ALLOW_ANON_ASK === 'true';
const ANON_WEB_RECONSTRUCTIONS = parsePositiveInteger(process.env.ACHIOTE_ANON_WEB_RECONSTRUCTIONS);

const PORT = parseInt(process.env.PORT || '3000', 10);
const ANTHROPIC_TIMEOUT_MS = parseInt(process.env.ANTHROPIC_TIMEOUT_MS || process.env.API_TIMEOUT_MS || '120000', 10);
const OPENAI_TIMEOUT_MS = parseInt(process.env.LOCAL_INFERENCE_TIMEOUT_MS || process.env.OPENAI_TIMEOUT_MS || process.env.LMSTUDIO_TIMEOUT_MS || process.env.GLM_TIMEOUT_MS || process.env.ZHIPU_TIMEOUT_MS || process.env.API_TIMEOUT_MS || '180000', 10);
const FINAL_SYNTHESIS_TIMEOUT_MS = parsePositiveInteger(process.env.ACHIOTE_FINAL_SYNTHESIS_TIMEOUT_MS) ?? 20_000;
const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = resolve(__dirname, '..', 'docs', 'landing');
const ALLOWED_ORIGINS = (process.env.ACHIOTE_ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,https://achiote.kyanitelabs.tech')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const TELEMETRY_LIMIT_PER_MINUTE = parseInt(process.env.ACHIOTE_TELEMETRY_LIMIT_PER_MINUTE || '120', 10);
const EVENTS_ADMIN_TOKEN = process.env.ACHIOTE_EVENTS_ADMIN_TOKEN?.trim();
const DISABLE_SEARCH_WEB = process.env.ACHIOTE_DISABLE_SEARCH_WEB === 'true';
const ASK_TOOLS = DISABLE_SEARCH_WEB ? TOOLS.filter((tool) => tool.name !== 'search_web') : TOOLS;
const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.xml': 'application/xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

type McpSessionEntry = {
  transport: StreamableHTTPServerTransport;
  mcpServer: ReturnType<typeof createAchioteServer>;
  lastActivity: number;
};

type DataConsent = {
  analytics: boolean;
  qualitySignals: boolean;
  savedMemory: boolean;
  familyConfirmation: boolean;
  publicContribution: boolean;
};

const transports = new Map<string, McpSessionEntry>();
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes

async function closeMcpSession(sid: string, entry: McpSessionEntry): Promise<void> {
  transports.delete(sid);
  await Promise.allSettled([entry.transport.close(), entry.mcpServer.close()]);
}

function sweepStaleSessions(): void {
  const now = Date.now();
  for (const [sid, entry] of [...transports]) {
    if (now - entry.lastActivity > SESSION_TTL) {
      closeMcpSession(sid, entry).catch((err) => {
        console.error('[mcp] session cleanup failed:', err instanceof Error ? err.message : String(err));
      });
    }
  }
}

// Periodic cleanup of stale sessions to prevent memory leak
setInterval(sweepStaleSessions, SESSION_TTL).unref();
const cacheState = createCacheWithStatus({});
const cache = cacheState.cache;
const toolContext: AchioteToolExecutionContext = { ...defaultToolExecutionContext, cache };
const ANTHROPIC_BASE_URL = anthropicBaseUrlFromEnv();
const anthropicClientOptions: ConstructorParameters<typeof Anthropic>[0] = {
  timeout: ANTHROPIC_TIMEOUT_MS,
  apiKey: process.env.ANTHROPIC_API_KEY?.trim() || process.env.GLM_API_KEY?.trim() || process.env.ZHIPU_API_KEY?.trim() || process.env.LOCAL_INFERENCE_API_KEY?.trim() || process.env.LMSTUDIO_API_KEY?.trim() || process.env.LM_STUDIO_API_KEY?.trim() || null,
  authToken: process.env.ANTHROPIC_AUTH_TOKEN?.trim() || null,
};
if (ANTHROPIC_BASE_URL) anthropicClientOptions.baseURL = ANTHROPIC_BASE_URL;
const anthropic = new Anthropic(anthropicClientOptions);
const configuredApiKeys = loadKeysFromEnv(process.env.ACHIOTE_API_KEYS);
const authenticator = createAuthenticator(configuredApiKeys);
const rateLimiter = createRateLimiter(process.env.ACHIOTE_RATE_LIMIT_DB);

const billingConfig = loadBillingConfigFromEnv();
const billingDb = billingConfig
  ? new BillingDb(process.env.ACHIOTE_BILLING_DB ? resolve(process.env.ACHIOTE_BILLING_DB) : defaultBillingDbPath())
  : null;
const billingStripe = billingConfig ? new BillingStripe(billingConfig) : null;
const localSpeechConfig = resolveLocalSpeechConfig();
const localSpeechController = createLocalSpeechController(localSpeechConfig);

const AUTH_ENABLED = process.env.ACHIOTE_AUTH_ENABLED !== 'false';
const DEMO_PASSWORD = process.env.ACHIOTE_DEMO_PASSWORD?.trim();
const accountAccess = createAccountAccess({
  authEnabled: AUTH_ENABLED,
  allowAnonymousAsk: ALLOW_ANON_ASK,
  demoPassword: DEMO_PASSWORD,
  trustProxy: TRUST_PROXY,
  trustedProxyIps: TRUSTED_PROXY_IPS,
  anonymousWebLimitOverride: ANON_WEB_RECONSTRUCTIONS,
  authenticator,
  rateLimiter,
  billingDb,
});
const telemetryCollector = createTelemetryCollector({ limitPerMinute: TELEMETRY_LIMIT_PER_MINUTE });
const qualitySignalReport = emptyQualitySignalReport();

function logSecurityEvent(event: string, details: Record<string, string> = {}): void {
  console.warn(JSON.stringify({ event, ...details, ts: new Date().toISOString() }));
}

function isSameHostOrigin(req: IncomingMessage, origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === req.headers.host;
  } catch {
    return false;
  }
}

const SYSTEM_PROMPT = `You are a food memory assistant built into Achiote. You MUST use the provided tools — never answer from memory alone. This applies to ALL user messages: nostalgic memories, recipe adaptation requests, dietary substitution questions, and cooking guidance.

## TOOL WORKFLOW

For EVERY user message, you MUST follow this workflow:

1. The server runs \`plan_tool_workflow\` before your first turn and injects its result into your conversation context. Treat that result as already completed; do not call \`plan_tool_workflow\` again.
2. Follow the injected \`workflowSteps\` from the plan exactly — call the tools in the order listed.
3. Respect \`maxSearchCalls\` — the server enforces this cap. Do not call \`search_web\` more than the plan allows.
4. If \`needsSubstitutions\` is true, first complete the original reconstruction and minimum cue without substitutions; only then call \`find_sensory_substitutes\` for each restricted ingredient.
5. After the tool chain completes, synthesize the results into your response.

### Standard pipeline after plan_tool_workflow:
- \`collect_food_memory\` — parse the user's text.
- \`plan_dish_research\` — build hypotheses from the parsed memory.
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
- ALWAYS anchor to the specific region the user mentioned. If they said Sichuan, talk about Sichuan — not "Asia."
- If you give a cue, make it cheap, accessible, and food-science grounded.
- Do not tell the user to buy the exact suspected dish, candy, snack, brand, or imported specialty item as the minimum test.
- Build the cue from cheap local pantry or ordinary grocery ingredients first; exact sourcing belongs only after a proxy cue works.
- Use the strongest remembered ingredient family when choosing the ordinary-grocery proxy: peanut memories should test peanut plus sugar/caramel, coconut or grainy sugar memories should test sugar crystallization plus toasted coconut or seed aroma before buying the suspected sweet, yuca/cassava memories should test cassava-family chew before potato fallback, fish memories should test a small fish bite unless constraints say otherwise, and hot-orange sauce memories should test acid + chile heat + color/aroma rather than generic salsa.
- Make the answer sensory and concrete: name what the user should smell, feel, or notice first, then say what a wrong result would rule out.
- Avoid clinical labels like "research-bounded proxy test" in user-facing prose. Say "first-pass verification bite" or "first tiny check" instead.
- Keep responses under 220 words.
- Be warm and direct, like a knowledgeable friend who wants to help them taste the memory again.
- Write like a real person talking to a friend. Use plain words and short sentences. Never use em-dashes or en-dashes; use commas, periods, or "and" instead. No exclamation points. Avoid AI-tell words like "delve", "tapestry", "crucial", "elevate", "unleash", or "testament".
- FOOD SAFETY OVERRIDES EVERYTHING. If the person mentions any allergy, intolerance, or dietary restriction, never suggest tasting, buying, or substituting anything that could contain it; build cues only from ingredients they have confirmed are safe for them. Name common allergens (nuts, peanuts, dairy, egg, wheat or gluten, soy, shellfish, fish, sesame) whenever a suggestion could contain them. Never call anything "safe", "allergen-free", or "medically safe". You do not give medical, allergy, or nutritional advice; point people to a qualified professional for those. Every taste is optional and at the person's own discretion.
- If the user shares a photo, describe what you see in the image and combine it with any text description they provide before calling tools.
- If researched facts were gathered (e.g., from search_web or resolve_dish_name), explicitly reference at least one specific finding in your prose. Do not summarize vaguely. Name the exact fact.`;

const providerRuntime = createProviderRuntime({
  anthropicClient: anthropic,
  systemPrompt: SYSTEM_PROMPT,
  tools: ASK_TOOLS,
  openAITimeoutMs: OPENAI_TIMEOUT_MS,
});

// ── Tool execution ──────────────────────────────────────────────────────────

function validateToolOutput(toolName: string, result: unknown): void {
  const schema = outputSchemas[toolName];
  if (!schema) return;
  const parsed = schema.safeParse(result);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`[validation] ${toolName} output schema mismatch: ${issues}`);
  }
}

// ── Auth middleware ─────────────────────────────────────────────────────────

function extractApiKey(req: IncomingMessage): string | undefined {
  const header = req.headers['x-api-key'];
  if (typeof header === 'string' && header.length > 0) return header;
  return undefined;
}

function extractBearer(req: IncomingMessage): string | undefined {
  const header = req.headers['authorization'];
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7).trim();
  return undefined;
}

function extractDemoPassword(req: IncomingMessage): string | undefined {
  const header = req.headers['x-demo-password'];
  if (typeof header === 'string' && header.length > 0) return header;
  return undefined;
}

function authenticateRequest(req: IncomingMessage): AuthedRequest {
  return accountAccess.authenticate({
    apiKey: extractApiKey(req),
    bearer: extractBearer(req),
    demoPassword: extractDemoPassword(req),
    headers: req.headers,
    remoteAddress: req.socket.remoteAddress,
  });
}

function checkCreditsForAuthed(authed: AuthedRequest, scope: 'mcp' | 'web'): boolean {
  return accountAccess.spendCredit(authed, scope);
}

function isSubscriptionCheckoutTier(tier: string): tier is Extract<Tier, 'personal' | 'family'> {
  return tier === 'personal' || tier === 'family';
}

function isPaymentCheckoutTier(tier: string): tier is Extract<CheckoutTier, 'memory-pack' | 'family-sprint'> {
  return tier === 'memory-pack' || tier === 'family-sprint';
}

function sendRateLimitHeaders(res: ServerResponse, limitResult: { remaining: number; limit: number; resetAt: number }): void {
  for (const [name, value] of Object.entries(rateLimitHeaders(limitResult))) {
    res.setHeader(name, value);
  }
}

function telemetryClientKey(req: IncomingMessage): string {
  const identity = getRequestRateLimitIdentity({
    authEnabled: false,
    headers: req.headers,
    remoteAddress: req.socket.remoteAddress,
    trustProxy: TRUST_PROXY,
    trustedProxyIps: TRUSTED_PROXY_IPS,
  });
  return identity?.keyId ?? 'anon:ip:unknown';
}

function hasEventsAdminAccess(req: IncomingMessage): boolean {
  if (!EVENTS_ADMIN_TOKEN) return false;
  const token = extractBearer(req);
  if (!token) return false;
  const tokenBuf = Buffer.from(token);
  const adminBuf = Buffer.from(EVENTS_ADMIN_TOKEN);
  return tokenBuf.length === adminBuf.length && timingSafeEqual(tokenBuf, adminBuf);
}

function parseDataConsent(value: unknown): DataConsent {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    analytics: input.analytics === true,
    qualitySignals: input.qualitySignals === true,
    savedMemory: input.savedMemory === true,
    familyConfirmation: input.familyConfirmation === true,
    publicContribution: input.publicContribution === true,
  };
}

// ── AI agent endpoint ───────────────────────────────────────────────────────

async function handleAsk(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Validate content-type
  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('application/json')) {
    sendJson(res, 415, { error: 'Unsupported Media Type: Content-Type must be application/json' });
    return;
  }

  const authed = authenticateRequest(req);
  if (!authed) { logSecurityEvent('auth_failure', { path: '/ask' }); sendJson(res, 401, { error: DEMO_PASSWORD ? 'Unauthorized. Provide the demo password via x-demo-password header.' : 'Unauthorized. Provide a valid API key via x-api-key header or Authorization bearer token.' }); return; }
  if (!accountAccess.anonymousProductAccessAllowed()) {
    sendJson(res, 401, { error: 'Anonymous /ask access is disabled. Enable ACHIOTE_ALLOW_ANON_ASK=true only for local demos, or provide a valid API key.' });
    return;
  }

  let raw: string;
  try {
    raw = await readBody(req, MAX_ASK_BODY_BYTES);
  } catch (err) {
    if (err instanceof Error && err.message === 'Body too large') {
      sendJson(res, 413, { error: 'Body too large' });
      req.resume();
    }
    return;
  }
  let parsed: { message?: string; history?: AskHistoryItem[]; images?: unknown; consent?: unknown };
  try { parsed = JSON.parse(raw); } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return; }

  const images = parseImages(parsed.images);
  if (images.error) { sendJson(res, 400, { error: images.error }); return; }

  const userMessage = parsed.message?.trim() ?? '';
  if (!userMessage && images.value.length === 0) { sendJson(res, 400, { error: 'message or images is required' }); return; }

  const history = parseHistory(parsed.history);
  const consent = parseDataConsent(parsed.consent);

  if (shouldApplyRateLimit({ contentType, parsedBody: parsed })) {
    const limitResult = accountAccess.webLimit(authed);
    sendRateLimitHeaders(res, limitResult);
    if (!limitResult.allowed && !checkCreditsForAuthed(authed, 'web')) {
      logSecurityEvent('rate_limit', { keyId: authed.keyId, path: '/ask' });
      sendJson(res, 429, { error: 'Rate limit exceeded. Upgrade your plan for more reconstructions.' });
      return;
    }
  }

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const askSession = providerRuntime.createAskSession({ userMessage, history, images: images.value });
    const askTurn = createAskTurnState(userMessage);
    const { calledTools, toolPayloads, deterministicPlanInput } = askTurn;
    const finish: DoneSender = (data = {}) => {
      recordAskCompletion(toolPayloads, calledTools, data, consent);
      send('done', data);
    };

    await runDeterministicWorkflowPlan({
      askSession,
      state: askTurn,
      toolContext,
      executeTool: executeToolDefinition,
      configureAvailableTools: configureAvailableAskTools,
      send,
    });

    const nativeToolSupport = await providerRuntime.selectedProviderSupportsNativeTools();
    if (nativeToolSupport === false) {
      console.warn('[ask] selected provider/model does not advertise native tool support, using deterministic workflow');
      if (await recoverFromInitialProviderFailure({ userMessage, toolPayloads, calledTools, send, finish, guarded: 'provider_tool_deterministic_recovery' })) return;
    }

    send('status', { stage: 'model' });
    let modelResponse: AskModelResponse;
    try {
      modelResponse = await askSession.create(4096);
    } catch (err) {
      if (isRecoverableAskProviderFailure(err)) {
        console.warn(`[ask] recoverable provider failure before first model turn, using deterministic recovery: ${providerRecoveryLogSummary(err)}`);
        if (await recoverFromInitialProviderFailure({ userMessage, toolPayloads, calledTools, send, finish, guarded: 'provider_context_deterministic_recovery' })) return;
      }
      throw err;
    }
    console.log(`[ask] model_response content=text:${modelResponse.textBlocks.length},tools:${modelResponse.toolCalls.length}`);
    if (modelResponse.toolCalls.length === 0) {
      console.warn('[ask] model skipped required Achiote tool workflow, retrying with explicit tool instruction');
      askSession.pushUserMessage('You did not call any tools. You MUST call collect_food_memory with the user\'s message as the memoryText parameter before responding. Do not answer without using tools.');
      send('status', { stage: 'model', retry: true });
      try {
        modelResponse = await askSession.create(4096);
      } catch (err) {
        if (isRecoverableAskProviderFailure(err)) {
          console.warn(`[ask] recoverable provider failure on retry, using deterministic recovery: ${providerRecoveryLogSummary(err)}`);
          if (await recoverFromInitialProviderFailure({ userMessage, toolPayloads, calledTools, send, finish, guarded: 'provider_context_deterministic_recovery' })) return;
        }
        throw err;
      }
      console.log(`[ask] retry model_response content=text:${modelResponse.textBlocks.length},tools:${modelResponse.toolCalls.length}`);
    }
    if (modelResponse.toolCalls.length === 0) {
      console.warn('[ask] model still skipped tool workflow after retry');
      if (await recoverFromInitialProviderFailure({ userMessage, toolPayloads, calledTools, send, finish, guarded: 'provider_tool_deterministic_recovery' })) return;
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
      if (res.writableEnded) return;
      iterations++;
      const normalizedToolCalls = normalizeModelToolCalls(modelResponse.toolCalls);
      if (normalizedToolCalls.normalizedAny) {
        modelResponse = { ...modelResponse, toolCalls: normalizedToolCalls.toolCalls };
        for (const correction of normalizedToolCalls.corrections) {
          console.warn(`[ask] normalized model tool name typo: ${correction.from} -> ${correction.to}`);
          send('status', { iteration: iterations, stage: 'tool_name_normalized', from: correction.from, to: correction.to });
        }
        for (const dropped of normalizedToolCalls.droppedMalformed) {
          console.warn(`[ask] dropped malformed provider tool-call envelope from tool name: ${dropped.name.slice(0, 160)}`);
          send('status', { iteration: iterations, stage: 'malformed_tool_call_dropped', tool: dropped.name, reason: dropped.reason });
        }
      }
      const toolNames = modelResponse.toolCalls.map((call) => call.name);
      console.log(`[ask] iteration=${iterations} calling tools: ${toolNames.join(', ')}`);

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
          console.warn(`[ask] tool loop detected: ${tool} called ${count} times, skipping duplicate (${blocked.reason})`);
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
            console.warn(`[ask] blocked unknown provider tool call: ${call.name}`);
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
            console.warn(`[ask] blocked ${call.name} during minimum-cue ask flow`);
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
            console.warn('[ask] blocked search_web because ACHIOTE_DISABLE_SEARCH_WEB=true');
            send('status', { iteration: iterations, stage: 'search_web_blocked', disabled: true });
            toolResults.push({ id: call.id, content: JSON.stringify(resultPayload) });
            toolCallHistory.push({ name: call.name, input: call.input });
            continue;
          }
          // Enforce search_web call cap — hard block, never falls through
          if (call.name === 'search_web' && searchCallCount >= getMaxSearchCalls()) {
            const cached = toolPayloads.search_web;
            const maxSearchCalls = getMaxSearchCalls();
            console.warn(`[ask] search_web cap hard-block (${searchCallCount}/${maxSearchCalls}), ${cached ? 'reusing cached' : 'returning cap message'}`);
            const resultPayload = cached ?? { capReached: true, message: `search_web capped at ${maxSearchCalls} call(s). Use prior research results.` };
            send('tool_call', { name: 'search_web', input: call.input, blocked: true });
            send('tool_result', { name: 'search_web', result: resultPayload, blocked: true });
            if (maxSearchCalls === 0) {
              send('status', { iteration: iterations, stage: 'search_web_blocked', reason: 'no_search_plan' });
            }
            toolResults.push({ id: call.id, content: JSON.stringify(resultPayload) });
            toolCallHistory.push({ name: call.name, input: call.input });
            continue;
          }
          const payload = await executeAndStreamTool(call.name, call.input, userMessage, send, calledTools, toolPayloads, history);
          if (call.name === 'search_web') searchCallCount++;
          const content = JSON.stringify(payload);
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
        modelResponse = await createWithTimeout(askSession, 2048, FINAL_SYNTHESIS_TIMEOUT_MS);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        if (modelResponse.toolCalls.some((call) => call.name === 'generate_minimum_viable_nostalgia')) {
          if (isSubstitutionPlan(toolPayloads)) {
            await maybeRunPlannedSubstitutions({ userMessage, toolPayloads, calledTools, send });
            if (maybeSendSubstitutionBasisResponse({ userMessage, toolPayloads, calledTools, send, finish })) {
              return;
            }
          }
          await maybeRunPlannedSourcing({ userMessage, toolPayloads, calledTools, send });
          console.warn(`[ask] final synthesis unavailable after minimum cue, using deterministic response: ${detail}`);
          const responseText = buildMinimumCueCompletedResponse(toolPayloads, userMessage);
          send('text', responseText);
          maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
          finish({ guarded: 'minimum_cue_deterministic_completion' });
          return;
        }
        console.warn(`[ask] model thinking turn timed out after tools, using deterministic continuation: ${detail}`);
        modelResponse = { textBlocks: [], toolCalls: [], providerMessage: null };
        break;
      }
    }

    await maybeRunMissingResearchPlan({ userMessage, toolPayloads, calledTools, send });
    await maybeRunOriginalSubstitutionBasisCue({ userMessage, toolPayloads, calledTools, send });
    await maybeRunPlannedSubstitutions({ userMessage, toolPayloads, calledTools, send });
    await maybeRunPlannedSourcing({ userMessage, toolPayloads, calledTools, send });

    if ((modelResponse.textBlocks.length === 0 || containsStalledFallbackText(modelResponse.textBlocks.join('\n\n')))
      && maybeSendSubstitutionBasisResponse({ userMessage, toolPayloads, calledTools, send, finish })) {
      return;
    }

    if (!calledTools.has('collect_food_memory')) {
      console.warn('[ask] model called tools but skipped required memory collection, using deterministic recovery');
      if (await recoverFromInitialProviderFailure({
        userMessage,
        toolPayloads,
        calledTools,
        send,
        finish,
        guarded: 'provider_tool_deterministic_recovery',
        reason: 'missing_required_memory_tool',
      })) return;
    }

    if (await maybeSendForcedMinimumCue({ userMessage, toolPayloads, calledTools, send, finish })) {
      return;
    }

    // Follow-up escape hatch: if the user has already answered clarification questions and
    // their memory now has substantive anchors, skip the entire guard chain. The guards are
    // designed for first-turn sparsity; on follow-ups they just replace good model output.
    const isFollowUpWithAnchors = (history !== undefined && history.length > 0)
      && hasSubstantialMemoryAnchors(toolPayloads.collect_food_memory);
    if (isFollowUpWithAnchors) {
      console.log('[ask] follow-up with substantive anchors — skipping guard chain');
    }

    if (!isFollowUpWithAnchors && calledTools.has('collect_food_memory') && !calledTools.has('plan_dish_research') && !calledTools.has('generate_minimum_viable_nostalgia')) {
      // In a follow-up turn the user answered the previous clarification question. If the
      // collected memory now has substantive anchors (location, cultural hint, or ≥2 ingredients)
      // let the model's natural response through instead of looping back to clarification.
      const isFollowUp = history !== undefined && history.length > 0;
      if (isFollowUp && hasSubstantialMemoryAnchors(toolPayloads.collect_food_memory)) {
        console.log('[ask] follow-up with substantive anchors — skipping missing_research_plan_clarification guard');
      } else {
        console.warn('[ask] replaced response that skipped research planning with structured clarification');
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
      console.warn('[ask] replaced stalled post-plan response with structured clarification');
      const responseText = buildClarificationOnlyResponse(toolPayloads, userMessage);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'missing_research_plan_clarification' });
      return;
    }

    if (!isFollowUpWithAnchors && !calledTools.has('generate_minimum_viable_nostalgia') && containsConcreteFoodCue(modelResponse.textBlocks.join('\n\n'))) {
      console.warn('[ask] suppressed concrete cue before minimum viable nostalgia tool');
      const responseText = buildClarificationOnlyResponse(toolPayloads, userMessage);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'premature_concrete_cue' });
      return;
    }

    if (!isFollowUpWithAnchors && !calledTools.has('generate_minimum_viable_nostalgia') && containsGenericUncertaintyWaffle(modelResponse.textBlocks.join('\n\n'))) {
      console.warn('[ask] replaced generic uncertainty prose with structured clarification');
      const responseText = buildClarificationOnlyResponse(toolPayloads, userMessage);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'generic_uncertainty_clarification' });
      return;
    }

    if (!isFollowUpWithAnchors && !calledTools.has('generate_minimum_viable_nostalgia') && containsPrematureCandidateSpeculation(modelResponse.textBlocks.join('\n\n'), toolPayloads)) {
      console.warn('[ask] replaced premature candidate list with structured clarification');
      const responseText = buildClarificationOnlyResponse(toolPayloads, userMessage);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'premature_candidate_speculation' });
      return;
    }

    if (!isFollowUpWithAnchors && calledTools.has('generate_minimum_viable_nostalgia') && shouldClarifyBroadUncertainMemory(userMessage, toolPayloads)) {
      console.warn('[ask] replaced broad uncertain post-cue response with structured clarification');
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
      console.warn('[ask] replaced blocked recipe-tool synthesis with deterministic minimum cue');
      const responseText = buildMinimumCueCompletedResponse(toolPayloads, userMessage);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'minimum_cue_deterministic_completion' });
      return;
    }

    if (calledTools.has('generate_minimum_viable_nostalgia')
      && (modelResponse.textBlocks.length === 0 || containsStalledFallbackText(modelResponse.textBlocks.join('\n\n')))) {
      console.warn('[ask] replaced stalled post-cue response with deterministic minimum cue');
      const responseText = buildMinimumCueCompletedResponse(toolPayloads, userMessage);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'minimum_cue_deterministic_completion' });
      return;
    }

    const responseText = modelResponse.textBlocks
      .map((text) => ensureCueQualityLanguage(text, toolPayloads, calledTools))
      .join('\n\n');
    const trustBoundedResponseText = sanitizeFinalAnswerTrustBoundaryLanguage(responseText);
    const didSanitizeTrustBoundary = trustBoundedResponseText !== responseText;

    if (calledTools.has('generate_minimum_viable_nostalgia') && contradictsLatestCorrection(trustBoundedResponseText, userMessage)) {
      console.warn('[ask] replaced stale correction-conflicting response with deterministic minimum cue');
      const responseText = buildLatestCorrectionAlignedResponse(buildMinimumCueCompletedResponse(toolPayloads, userMessage), userMessage, toolPayloads);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'latest_correction_sanitized' });
      return;
    }

    if (calledTools.has('generate_minimum_viable_nostalgia') && containsCueFamilyMismatch(trustBoundedResponseText, userMessage)) {
      console.warn('[ask] replaced cue-family mismatch with deterministic mechanism cue');
      const responseText = buildUserMessageMechanismCueResponse(userMessage, toolPayloads);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'cue_family_sanitized' });
      return;
    }

    if (shouldReplaceWithSubstitutionBasisResponse(trustBoundedResponseText, toolPayloads, calledTools)) {
      console.warn('[ask] replaced substitution response with explicit original-basis adaptation frame');
      const responseText = buildSubstitutionBasisResponse(toolPayloads, userMessage);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'substitution_basis_deterministic_completion' });
      return;
    }

    if (calledTools.has('generate_minimum_viable_nostalgia') && containsOverconfidentIdentityClaim(trustBoundedResponseText)) {
      console.warn('[ask] replaced overconfident identity claim with deterministic minimum cue');
      const responseText = buildMinimumCueCompletedResponse(toolPayloads, userMessage);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'overconfident_identity_sanitized' });
      return;
    }

    if (calledTools.has('generate_minimum_viable_nostalgia') && containsRecipeProcedureOrAdaptationLanguage(trustBoundedResponseText)) {
      console.warn('[ask] replaced recipe procedure drift with deterministic minimum cue');
      const responseText = buildMinimumCueCompletedResponse(toolPayloads, userMessage);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'recipe_procedure_sanitized' });
      return;
    }

    if (calledTools.has('generate_minimum_viable_nostalgia') && containsRecipeMeasurementLanguage(trustBoundedResponseText)) {
      console.warn('[ask] suppressed recipe-style measurements in cue response');
      const sanitized = sanitizeRecipeStyleCueLanguage(trustBoundedResponseText);
      if (lacksMinimumCueLanguage(sanitized)) {
        console.warn('[ask] sanitized measurement text still lacks minimum cue language; falling back to deterministic minimum cue');
        const responseText = buildMinimumCueCompletedResponse(toolPayloads, userMessage);
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
      console.warn('[ask] replaced missing-minimum-cue response with deterministic minimum cue');
      const responseText = buildMinimumCueCompletedResponse(toolPayloads, userMessage);
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
  } finally {
    res.end();
  }
}

type SseSender = (event: string, data: unknown) => void;
type DoneSender = (data?: Record<string, unknown>) => void;

function recordAskCompletion(toolPayloads: Record<string, unknown>, calledTools: Set<string>, donePayload: Record<string, unknown>, consent: DataConsent): void {
  if (!consent.qualitySignals) return;
  const guarded = typeof donePayload.guarded === 'string' ? donePayload.guarded : 'none';
  recordQualitySignal(qualitySignalReport, buildAskQualitySignal({
    toolPayloads,
    calledTools: [...calledTools],
    guarded,
    cache: inferAskCacheOutcome({
      toolPayloads,
      calledTools: [...calledTools],
      cacheAvailable: cache !== null,
      cacheFallbackUsed: cacheState.fallbackUsed,
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
  input.send('receipt', buildMemoryReceipt({
    memory: parsedMemory.data as CollectedFoodMemory,
    researchPlan: parsedResearchPlan.success ? parsedResearchPlan.data as DishResearchPlan : undefined,
    cue: parsedCue.success ? parsedCue.data as MinimumViableNostalgiaCue : undefined,
    assistantText: input.assistantText,
    researchedFacts: deriveResearchedFactsForReceipt(input.toolPayloads),
  }));
}

/** Extract a compact set of sourced facts from search_web and resolve_dish_name payloads. */
function deriveResearchedFactsForReceipt(toolPayloads: Record<string, unknown>): string[] {
  const facts: string[] = [];

  // search_web: reference for confidence boosting
  const searched = toolPayloads.search_web as
    | { results?: Array<{ title?: string; snippet?: string }> }
    | undefined;

  // resolve_dish_name: emit canonical name + region when a real match was found
  const resolved = toolPayloads.resolve_dish_name as
    | { dishName?: string; canonicalName?: string; region?: string; confidence?: string; aliases?: string[] }
    | undefined;
  if (resolved?.canonicalName && !/^Unknown$/i.test(resolved.canonicalName)) {
    const hasResearchProduct = (searched?.results?.length ?? 0) > 0;
    const effectiveConfidence = (resolved.confidence === 'Low' && hasResearchProduct) ? 'Medium' : resolved.confidence;
    facts.push(`Dish resolved: "${resolved.canonicalName}" (confidence: ${effectiveConfidence ?? 'unknown'}, region: ${resolved.region ?? 'unknown'})`);
    const aliases = (resolved.aliases ?? []).filter(Boolean).slice(0, 3);
    if (aliases.length) facts.push(`Also known as: ${aliases.join(', ')}`);
  }

  // search_web: emit the snippet from each top result (up to 3)
  for (const result of (searched?.results ?? []).slice(0, 3)) {
    if (result.snippet?.trim()) facts.push(result.snippet.trim().replace(/[\u2014\u2013]/g, ', '));
  }

  return facts;
}

async function executeAndStreamTool(
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
    const researchedFacts = searchResults?.results
      ?.filter((r) => r.snippet)
      .map((r) => `${r.title}: ${r.snippet}`)
      .slice(0, 5) ?? [];
    await executeAndStreamTool('build_reconstruction_dossier', {
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
  const result = await executeToolDefinition(toolName, normalizedInput, toolContext);
  validateToolOutput(toolName, result.payload);
  calledTools.add(toolName);
  toolPayloads[toolName] = result.payload;
  if (toolName === 'find_sensory_substitutes') {
    const existing = Array.isArray(toolPayloads.find_sensory_substitutes_all)
      ? toolPayloads.find_sensory_substitutes_all
      : [];
    toolPayloads.find_sensory_substitutes_all = [...existing, result.payload];
  }
  send('tool_result', { name: toolName, result: result.payload });
  return result.payload;
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
      : rawMemoryText;
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
  if (toolName === 'build_reconstruction_dossier') {
    return {
      ...record,
      ...(collectedMemory ? { memory: collectedMemory } : {}),
      ...(researchPlan ? { researchPlan } : {}),
    };
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

function inferUserLocation(userMessage: string): string | undefined {
  const match = userMessage.match(/\b(?:i\s+(?:live|am|currently\s+live|currently\s+am)|i['’]?m|im|we\s+(?:live|are)|based|located)\s+in\s+([^.!?;,]{2,80})/i);
  if (!match?.[1]) return undefined;
  const location = match[1]
    .replace(/\s+(?:now|currently|these days|at the moment)\b.*$/i, '')
    .replace(/\s+(?:and|but|so|because|while)\b.*$/i, '')
    .trim();
  if (location.length < 2 || /^(the|a|an|this|that|it|there)$/i.test(location)) return undefined;
  return location.slice(0, 80);
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
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

function isRecoverableAskProviderFailure(err: unknown): boolean {
  if (isProviderContextLimitError(err)) return true;
  const message = err instanceof Error ? err.message : String(err);
  if (isDownstreamProviderWrappedFailure(message)) return true;
  if (/\b(?:401|402|403|api[_ -]?key|invalid key|authorization|bearer|token|credential|secret|moderation|flagged|insufficient credits)\b/i.test(message)) {
    return false;
  }

  if (/\b(?:Failed to parse tool arguments|no assistant message|finish_reason: length|fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|AbortError|timed out)\b/i.test(message)) {
    return true;
  }

  if (providerRuntime.providerKind === 'openai') {
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

async function recoverFromInitialProviderFailure({
  userMessage,
  toolPayloads,
  calledTools,
  send,
  finish,
  guarded,
  reason = 'provider_context_limit',
}: {
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
    await executeAndStreamTool('collect_food_memory', { memoryText: userMessage }, userMessage, send, calledTools, toolPayloads);
  }

  await maybeRunMissingResearchPlan({ userMessage, toolPayloads, calledTools, send });
  await maybeRunOriginalSubstitutionBasisCue({ userMessage, toolPayloads, calledTools, send });
  await maybeRunPlannedSubstitutions({ userMessage, toolPayloads, calledTools, send });
  await maybeRunPlannedSourcing({ userMessage, toolPayloads, calledTools, send });

  if (maybeSendSubstitutionBasisResponse({ userMessage, toolPayloads, calledTools, send, finish })) {
    return true;
  }

  if (await maybeSendForcedMinimumCue({ userMessage, toolPayloads, calledTools, send, finish })) {
    return true;
  }

  const responseText = buildClarificationOnlyResponse(toolPayloads, userMessage);
  send('text', responseText);
  maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
  finish({ guarded });
  return true;
}

async function maybeSendForcedMinimumCue({
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
}): Promise<boolean> {
  if (calledTools.has('generate_minimum_viable_nostalgia')) return false;
  if (!shouldForceMinimumCue(userMessage, toolPayloads, calledTools)) return false;

  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  const researchPlan = toolPayloads.plan_dish_research as DishResearchPlan | undefined;
  if (!memory || !researchPlan) return false;

  console.warn('[ask] forcing minimum viable cue after explicit test request stalled before cue tool');
  send('status', { stage: 'calling_tools', tools: ['build_reconstruction_dossier', 'generate_minimum_viable_nostalgia'], guarded: 'explicit_minimum_cue_fallback' });

  let dossier = toolPayloads.build_reconstruction_dossier as ReconstructionDossier | undefined;
  if (!dossier) {
    const searchResults = toolPayloads.search_web as { results?: Array<{ title?: string; snippet?: string }> } | undefined;
    const researchedFacts = searchResults?.results
      ?.filter((r) => r.snippet)
      .map((r) => `${r.title}: ${r.snippet}`)
      .slice(0, 5) ?? [];
    dossier = await executeAndStreamTool('build_reconstruction_dossier', {
      memory,
      researchPlan,
      researchedFacts,
      inferredFacts: [
        'The model stalled before building a dossier, so the server assembled the evidence boundary from available research.',
      ],
    }, userMessage, send, calledTools, toolPayloads) as ReconstructionDossier;
  }

  const cue = await executeAndStreamTool('generate_minimum_viable_nostalgia', {
    dossier,
    userLocation: memory.userLocation,
    constraints: inferSafetyConstraints(userMessage),
    maxEffortMinutes: 10,
  }, userMessage, send, calledTools, toolPayloads) as MinimumViableNostalgiaCue;

  const responseText = buildEvidenceBoundedMinimumCueResponse(toolPayloads, userMessage);
  send('text', responseText);
  maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
  finish({ guarded: 'explicit_minimum_cue_fallback' });
  return true;
}

function shouldForceMinimumCue(userMessage: string, toolPayloads: Record<string, unknown>, calledTools: Set<string>): boolean {
  if (!toolPayloads.collect_food_memory || !toolPayloads.plan_dish_research) return false;
  if (shouldClarifyBroadUncertainMemory(userMessage, toolPayloads)) return false;
  if (shouldClarifySparseUnanchoredMemory(userMessage, toolPayloads)) return false;

  const workflowPlan = toolPayloads.plan_tool_workflow as { needsSubstitutions?: boolean } | undefined;
  if (workflowPlan?.needsSubstitutions && calledTools.has('find_sensory_substitutes')) return true;

  // Explicit minimum-cue request — force whenever we have memory + plan + any sensory signal
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

async function maybeRunMissingResearchPlan({
  userMessage,
  toolPayloads,
  calledTools,
  send,
}: {
  userMessage: string;
  toolPayloads: Record<string, unknown>;
  calledTools: Set<string>;
  send: SseSender;
}): Promise<void> {
  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  if (!memory || calledTools.has('plan_dish_research')) return;
  send('status', { stage: 'calling_tools', tools: ['plan_dish_research'], deterministic: true });
  await executeAndStreamTool('plan_dish_research', { memory }, userMessage, send, calledTools, toolPayloads);
}

async function maybeRunOriginalSubstitutionBasisCue({
  userMessage,
  toolPayloads,
  calledTools,
  send,
}: {
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
    dossier = await executeAndStreamTool('build_reconstruction_dossier', {
      memory,
      researchPlan,
      inferredFacts: [
        'This is the original nostalgia basis before any dietary substitutions are applied.',
      ],
    }, userMessage, send, calledTools, toolPayloads) as ReconstructionDossier;
  }

  send('status', { stage: 'calling_tools', tools: ['generate_minimum_viable_nostalgia'], deterministic: true, reason: 'substitution_original_basis' });
  await executeAndStreamTool('generate_minimum_viable_nostalgia', {
    dossier,
    userLocation: memory.userLocation,
    maxEffortMinutes: 10,
  }, userMessage, send, calledTools, toolPayloads);
}

async function maybeRunPlannedSubstitutions({
  userMessage,
  toolPayloads,
  calledTools,
  send,
}: {
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
    await executeAndStreamTool('find_sensory_substitutes', { ingredient, location }, userMessage, send, calledTools, toolPayloads);
  }
}

async function maybeRunPlannedSourcing({
  userMessage,
  toolPayloads,
  calledTools,
  send,
}: {
  userMessage: string;
  toolPayloads: Record<string, unknown>;
  calledTools: Set<string>;
  send: SseSender;
}): Promise<void> {
  const plan = toolPayloads.plan_tool_workflow as { workflowSteps?: Array<{ tool?: string }> } | undefined;
  const plannedTools = plan?.workflowSteps?.map((step) => step.tool) ?? [];
  if (!plannedTools.includes('source_ingredients') || calledTools.has('source_ingredients')) return;

  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  const location = memory?.userLocation ?? inferUserLocation(userMessage);
  const ingredients = memory?.extractedClues?.rememberedIngredients ?? [];
  if (!location || ingredients.length === 0) return;

  send('status', { stage: 'calling_tools', tools: ['source_ingredients'], deterministic: true });
  await executeAndStreamTool('source_ingredients', { ingredients: ingredients.slice(0, 10), location }, userMessage, send, calledTools, toolPayloads);
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
  return !/\bbasis before substitutions\b/i.test(text) || !/\badapted cue\b/i.test(text);
}

function authenticateVoiceRequest(req: IncomingMessage, res: ServerResponse): AuthedRequest {
  const authed = authenticateRequest(req);
  if (!authed) {
    sendJson(res, 401, { error: DEMO_PASSWORD ? 'Unauthorized. Provide the demo password via x-demo-password header.' : 'Unauthorized. Provide a valid API key via x-api-key header or Authorization bearer token.' });
    return null;
  }
  if (!accountAccess.anonymousProductAccessAllowed()) {
    sendJson(res, 401, { error: 'Anonymous voice access is disabled. Enable ACHIOTE_ALLOW_ANON_ASK=true only for local demos, or provide a valid API key.' });
    return null;
  }
  return authed;
}

async function readJsonBody(req: IncomingMessage, res: ServerResponse, maxBytes = 1_000_000): Promise<unknown | null> {
  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('application/json')) {
    sendJson(res, 415, { error: 'Unsupported Media Type: Content-Type must be application/json' });
    return null;
  }

  try {
    return JSON.parse(await readBody(req, maxBytes));
  } catch (err) {
    sendJson(res, err instanceof Error && err.message === 'Body too large' ? 413 : 400, { error: err instanceof Error && err.message === 'Body too large' ? 'Body too large' : 'Invalid JSON' });
    return null;
  }
}

async function handleVoiceTranscribe(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!authenticateVoiceRequest(req, res)) return;
  const parsed = await readJsonBody(req, res, MAX_SPEECH_REQUEST_BYTES);
  if (parsed === null) return;
  const response = await localSpeechController.transcribe(parsed);
  sendJson(res, response.status, response.body);
}

async function handleVoiceSynthesize(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!authenticateVoiceRequest(req, res)) return;
  const parsed = await readJsonBody(req, res, 32_000);
  if (parsed === null) return;
  const response = await localSpeechController.synthesize(parsed);
  sendJson(res, response.status, response.body);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const MAX_IMAGES = 4;
const MAX_IMAGE_BASE64_CHARS = 700_000; // ~525KB actual image
const MAX_ASK_BODY_BYTES = (MAX_IMAGES * MAX_IMAGE_BASE64_CHARS) + 100_000;
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_HISTORY_ITEMS = 20;
const MAX_HISTORY_CONTENT_CHARS = 4_000;
const MAX_SPEECH_REQUEST_BYTES = 12_500_000;

function parseHistory(raw: unknown): AskHistoryItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const history = raw
    .filter((h): h is AskHistoryItem =>
      typeof h === 'object' && h !== null &&
      (h.role === 'user' || h.role === 'assistant') &&
      typeof h.content === 'string',
    )
    .map((h) => ({
      role: h.role,
      content: h.content.trim().slice(0, MAX_HISTORY_CONTENT_CHARS),
    }))
    .filter((h) => h.content.length > 0);
  return history.slice(-MAX_HISTORY_ITEMS);
}

function parseImages(raw: unknown): { value: AskImage[]; error?: string } {
  if (raw === undefined) return { value: [] };
  if (!Array.isArray(raw)) return { value: [], error: 'images must be an array' };
  if (raw.length > MAX_IMAGES) return { value: [], error: `maximum ${MAX_IMAGES} images allowed` };
  const result: AskImage[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (typeof item !== 'string') return { value: [], error: `image[${i}] must be a string` };
    if (item.length > MAX_IMAGE_BASE64_CHARS) return { value: [], error: `image[${i}] exceeds maximum size` };
    const match = item.match(/^data:([a-zA-Z0-9+/-]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return { value: [], error: `image[${i}] must be a data URI (data:image/...;base64,...)` };
    const mediaType = match[1];
    if (!ALLOWED_IMAGE_MIME_TYPES.has(mediaType)) {
      return { value: [], error: `image[${i}] has unsupported MIME type: ${mediaType}` };
    }
    result.push({ base64: match[2], mediaType: mediaType as AskImage['mediaType'] });
  }
  return { value: result };
}

function readBody(req: IncomingMessage, maxBytes = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let rejected = false;
    req.on('data', (chunk: Buffer) => {
      if (rejected) return;
      total += chunk.length;
      if (total > maxBytes) {
        rejected = true;
        reject(new Error('Body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!rejected) resolve(Buffer.concat(chunks).toString('utf-8')); });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendMethodNotAllowed(res: ServerResponse, allowed: string[]): void {
  res.writeHead(405, { Allow: allowed.join(', '), 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Method not allowed', allowed }));
}

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const rawPath = req.url?.split('?')[0] ?? '/';
  const raw = rawPath === '/' ? '/' : rawPath.replace(/\/$/, '');
  const routeMap: Record<string, string> = {
    '/': 'index.html',
    '/app': 'app.html',
    '/about': 'about.html',
    '/pricing': 'pricing.html',
    '/roadmap': 'roadmap.html',
    '/changelog': 'changelog.html',
    '/status': 'status.html',
    '/blog': 'blog.html',
    '/receipt': 'receipt.html',
    '/privacy': 'privacy.html',
    '/terms': 'terms.html',
    '/support': 'support.html',
    '/safety': 'safety.html',
    '/ai-search': 'ai-search.html',
    '/compare': 'compare.html',
  };
  const assetPath = routeMap[raw] ?? raw.replace(/^\//, '');
  const filePath = resolve(STATIC_DIR, assetPath);

  if (!filePath.startsWith(resolve(STATIC_DIR) + sep)) return false;

  try {
    const data = await readFile(filePath);
    const ext = assetPath.slice(assetPath.lastIndexOf('.'));
    const contentType = MIME[ext] || 'application/octet-stream';
    const scriptSrc = assetPath === 'billing-success.html' ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'";
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Security-Policy': [
        "default-src 'self'",
        scriptSrc,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "media-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "connect-src 'self'",
      ].join('; '),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

// ── Server ──────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  const isOriginAllowed = !origin || ALLOWED_ORIGINS.includes(origin);
  const allowedOrigin = isOriginAllowed ? (origin || ALLOWED_ORIGINS[0]) : null;
  const originalWriteHead = res.writeHead.bind(res) as typeof res.writeHead;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (res as any).writeHead = (statusCode: number, ...rest: any[]) => {
    const extra = (typeof rest[rest.length - 1] === 'object' && rest[rest.length - 1] !== null)
      ? rest.pop() : {};
    const corsHeaders = allowedOrigin ? {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id, Accept, x-api-key, x-demo-password, authorization, stripe-signature',
      'Access-Control-Expose-Headers': 'mcp-session-id, X-RateLimit-Remaining, X-RateLimit-Limit, X-RateLimit-Reset',
      Vary: 'Origin',
    } : { Vary: 'Origin' };
    const merged = { ...corsHeaders, ...extra };
    return originalWriteHead(statusCode, merged);
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {});
    res.end();
    return;
  }

  const pathname = req.url?.split('?')[0].replace(/\/$/, '') ?? '';

  if (pathname === '/events' && req.method === 'POST') {
    if (!origin || (!isOriginAllowed && !isSameHostOrigin(req, origin))) {
      sendJson(res, 403, { error: 'Forbidden origin' });
      return;
    }

    const telemetryLimit = telemetryCollector.checkRateLimit(telemetryClientKey(req));
    sendRateLimitHeaders(res, telemetryLimit);
    if (!telemetryLimit.allowed) {
      sendJson(res, 429, { error: 'Telemetry rate limit exceeded' });
      return;
    }

    try {
      const raw = await readBody(req, 1_024);
      const parsed = JSON.parse(raw) as { event?: unknown; properties?: unknown; consent?: unknown };
      const eventName = typeof parsed.event === 'string' ? parsed.event : '';
      if (!telemetryCollector.isEventAllowed(eventName)) {
        sendJson(res, 400, { error: 'Unsupported telemetry event' });
        return;
      }
      const consent = parseDataConsent(parsed.consent);
      if (!consent.analytics) {
        sendJson(res, 202, { ok: true, skipped: 'analytics_consent_required' });
        return;
      }
      const properties = sanitizeTelemetryProps(parsed.properties);
      telemetryCollector.record(eventName, properties);
      sendJson(res, 202, { ok: true });
    } catch (err) {
      sendJson(res, err instanceof Error && err.message === 'Body too large' ? 413 : 400, { error: 'Invalid telemetry event' });
    }
    return;
  }

  if (pathname === '/events' && req.method === 'GET') {
    if (!hasEventsAdminAccess(req)) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    sendJson(res, 200, {
      counters: telemetryCollector.serialize().counters,
      breakdowns: telemetryCollector.serialize().breakdowns,
      quality: qualitySignalReport,
      referenceSeeds: buildReferenceSeedOperatorReport(qualitySignalReport),
    });
    return;
  }

  if ((pathname === '/health' || pathname === '/ready') && req.method !== 'GET' && req.method !== 'HEAD') {
    sendMethodNotAllowed(res, ['GET', 'HEAD']);
    return;
  }

  if (pathname === '/health' || pathname === '/ready') {
    const providerReadiness = providerRuntime.readinessCredentials();
    const readiness = getHttpReadiness({
      authEnabled: AUTH_ENABLED,
      apiKeyCount: configuredApiKeys.length,
      demoPasswordConfigured: Boolean(DEMO_PASSWORD),
      billingEnabled: Boolean(billingConfig),
      anthropicApiKey: providerReadiness.anthropicApiKey,
      anthropicAuthToken: providerReadiness.anthropicAuthToken,
      openaiProviderReady: providerReadiness.openaiProviderReady,
      cacheAvailable: cache !== null && !cacheState.fallbackUsed,
      rateLimitPersistenceConfigured: Boolean(process.env.ACHIOTE_RATE_LIMIT_DB),
    });
    sendJson(res, pathname === '/ready' && !readiness.ready ? 503 : 200, {
      status: pathname === '/health' ? 'ok' : readiness.status,
      version: '0.2.0',
      authEnabled: AUTH_ENABLED,
      billingEnabled: Boolean(billingConfig),
      readiness,
      uptime: process.uptime(),
      provider: {
        kind: providerRuntime.profile.providerKind,
        provider: providerRuntime.profile.provider,
        model: providerRuntime.profile.model,
        endpointStyle: providerRuntime.profile.endpointStyle,
        nativeTools: providerRuntime.profile.nativeTools,
        rateLimitSensitive: providerRuntime.profile.rateLimitSensitive,
        compatibilitySource: providerRuntime.profile.compatibilitySource,
        fallback: providerRuntime.fallbackConfig.enabled
          ? {
              enabled: true,
              baseUrl: providerRuntime.fallbackConfig.baseUrl,
              model: providerRuntime.fallbackConfig.model,
            }
          : { enabled: false },
      },
    });
    return;
  }

  if (pathname === '/ask' && req.method !== 'POST') {
    sendMethodNotAllowed(res, ['POST']);
    return;
  }

  if (pathname === '/ask' && req.method === 'POST') {
    await handleAsk(req, res);
    return;
  }

  if (pathname === '/voice/status' && req.method !== 'GET' && req.method !== 'HEAD') {
    sendMethodNotAllowed(res, ['GET', 'HEAD']);
    return;
  }

  if (pathname === '/voice/status') {
    sendJson(res, 200, localSpeechController.status());
    return;
  }

  if (pathname === '/voice/transcribe' && req.method !== 'POST') {
    sendMethodNotAllowed(res, ['POST']);
    return;
  }

  if (pathname === '/voice/transcribe') {
    await handleVoiceTranscribe(req, res);
    return;
  }

  if (pathname === '/voice/synthesize' && req.method !== 'POST') {
    sendMethodNotAllowed(res, ['POST']);
    return;
  }

  if (pathname === '/voice/synthesize') {
    await handleVoiceSynthesize(req, res);
    return;
  }

  if (pathname === '/mcp' && !['GET', 'POST', 'DELETE'].includes(req.method ?? '')) {
    sendMethodNotAllowed(res, ['GET', 'POST', 'DELETE']);
    return;
  }

  if (pathname === '/mcp') {
    const authed = authenticateRequest(req);
    if (!authed) { logSecurityEvent('auth_failure', { path: '/mcp' }); sendJson(res, 401, { jsonrpc: '2.0', error: { code: -32001, message: DEMO_PASSWORD ? 'Unauthorized: provide the demo password via x-demo-password header' : 'Unauthorized: valid API key required' }, id: null }); return; }

    const limitResult = accountAccess.mcpLimit(authed);
    sendRateLimitHeaders(res, limitResult);
    if (!limitResult.allowed && !checkCreditsForAuthed(authed, 'mcp')) {
      logSecurityEvent('rate_limit', { keyId: authed.keyId, path: '/mcp' });
      sendJson(res, 429, { jsonrpc: '2.0', error: { code: -32002, message: 'Rate limit exceeded' }, id: null });
      return;
    }

    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport | undefined;

      if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId)!.transport;
        transports.get(sessionId)!.lastActivity = Date.now();
      }
      sweepStaleSessions();

      if (!transport) {
        const raw = await readBody(req);
        let parsed: unknown;
        try { parsed = JSON.parse(raw); } catch {
          sendJson(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
          return;
        }

        if (req.method === 'POST' && isInitializeRequest(parsed)) {
          const mcpServer = createAchioteServer();
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid) => { transports.set(sid, { transport: transport!, mcpServer, lastActivity: Date.now() }); },
          });
          transport.onclose = () => {
            const sid = transport!.sessionId;
            if (sid) {
              const entry = transports.get(sid);
              if (entry) void closeMcpSession(sid, entry);
            }
          };
          await mcpServer.connect(transport);
          await transport.handleRequest(req, res, parsed);
          return;
        }

        sendJson(res, 400, { jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: initialize first' }, id: null });
        return;
      }

      const raw = await readBody(req);
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch {
        sendJson(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
        return;
      }
      await transport.handleRequest(req, res, parsed);
    } catch (error) {
      if (error instanceof Error && error.message === 'Body too large') {
        sendJson(res, 413, { jsonrpc: '2.0', error: { code: -32603, message: 'Body too large' }, id: null });
        req.resume();
      } else {
        console.error('Request error:', error);
        if (!res.headersSent) {
          sendJson(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
        }
      }
    }
    return;
  }

  // ── Billing endpoints ─────────────────────────────────────────────────────

  if (pathname === '/billing/checkout' && req.method === 'POST') {
    if (!billingStripe || !billingDb) {
      sendJson(res, 503, { error: 'Billing is not configured' });
      return;
    }
    let raw: string;
    try { raw = await readBody(req, 10_000); } catch { sendJson(res, 413, { error: 'Body too large' }); return; }
    let parsed: { tier?: string; mode?: string; billing?: string; email?: string };
    try { parsed = JSON.parse(raw); } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return; }
    if (parsed.mode && parsed.mode !== 'subscription' && parsed.mode !== 'payment') {
      sendJson(res, 400, { error: 'Invalid checkout mode. Use subscription or payment.' });
      return;
    }
    const mode: 'subscription' | 'payment' = parsed.mode === 'payment' ? 'payment' : 'subscription';
    const billing = parsed.billing === 'annual' ? 'annual' : 'monthly';
    const requestedTier = parsed.tier ?? (mode === 'payment' ? 'memory-pack' : 'personal');
    try {
      if (mode === 'subscription') {
        if (!isSubscriptionCheckoutTier(requestedTier)) {
          sendJson(res, 400, { error: 'Invalid tier for subscription. Use personal or family.' });
          return;
        }
        if (billing === 'annual' && requestedTier !== 'personal') {
          sendJson(res, 400, { error: 'Annual billing is available for personal only.' });
          return;
        }
        const session = await billingStripe.createCheckoutSession({ tier: requestedTier, mode, billingCycle: billing, customerEmail: parsed.email });
        billingDb.createCheckoutSession(session.sessionId, mode, undefined, requestedTier);
        sendJson(res, 200, { url: session.url });
        return;
      }

      if (!isPaymentCheckoutTier(requestedTier)) {
        sendJson(res, 400, { error: 'Invalid tier for one-time payment. Use memory-pack or family-sprint.' });
        return;
      }
      const tier: CheckoutTier = requestedTier;
      const session = await billingStripe.createCheckoutSession({ tier, mode, billingCycle: billing, customerEmail: parsed.email });
      billingDb.createCheckoutSession(session.sessionId, mode);
      sendJson(res, 200, { url: session.url });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : 'Checkout failed' });
    }
    return;
  }

  if (pathname === '/billing/portal' && req.method === 'POST') {
    if (!billingStripe || !billingDb) {
      sendJson(res, 503, { error: 'Billing is not configured' });
      return;
    }
    const rawBillingKey = extractApiKey(req) ?? extractBearer(req);
    if (!rawBillingKey) {
      sendJson(res, 401, { error: 'Billing API key is required.' });
      return;
    }
    const billingAuth = billingDb.authenticateApiKey(rawBillingKey);
    if (!billingAuth) {
      sendJson(res, 401, { error: 'Invalid billing API key.' });
      return;
    }
    const customerId = billingDb.getCustomerIdByKeyId(billingAuth.keyId);
    if (!customerId) {
      sendJson(res, 403, { error: 'No Stripe billing customer is attached to this API key.' });
      return;
    }
    try {
      const portal = await billingStripe.createCustomerPortalSession(customerId);
      sendJson(res, 200, { url: portal.url });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : 'Portal creation failed' });
    }
    return;
  }

  if (pathname === '/billing/webhook' && req.method === 'POST') {
    if (!billingStripe || !billingDb) {
      sendJson(res, 503, { error: 'Billing is not configured' });
      return;
    }
    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string') {
      sendJson(res, 400, { error: 'Missing stripe-signature header' });
      return;
    }
    let raw: Buffer;
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      raw = Buffer.concat(chunks);
    } catch {
      sendJson(res, 400, { error: 'Failed to read body' });
      return;
    }
    try {
      const event = billingStripe.constructEvent(raw, signature);
      await billingStripe.handleWebhookEvent(event, billingDb);
      sendJson(res, 200, { received: true });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : 'Webhook processing failed' });
    }
    return;
  }

  if (pathname === '/billing/session' && req.method === 'GET') {
    if (!billingDb) {
      sendJson(res, 503, { error: 'Billing is not configured' });
      return;
    }
    const query = new URL(req.url || '', `http://localhost:${PORT}`).searchParams;
    const sessionId = query.get('session_id');
    if (!sessionId) {
      sendJson(res, 400, { error: 'session_id is required' });
      return;
    }
    const email = query.get('email')?.trim().toLowerCase();
    const session = billingDb.getCheckoutSession(sessionId);
    if (!session) {
      sendJson(res, 404, { error: 'Session not found' });
      return;
    }
    if (session.stripeCustomerId) {
      if (!email) {
        sendJson(res, 400, { error: 'Email verification required. Include your checkout email as the ?email= parameter.' });
        return;
      }
      const customer = billingDb.getCustomer(session.stripeCustomerId);
      if (!customer?.email || customer.email.toLowerCase() !== email) {
        logSecurityEvent('billing_session_email_mismatch', { sessionId: sessionId.slice(0, 20), path: pathname });
        sendJson(res, 403, { error: 'Email verification required. Include your checkout email as the ?email= parameter.' });
        return;
      }
    }
    const consumed = billingDb.consumeCheckoutSessionApiKey(sessionId);
    if (!consumed) {
      sendJson(res, 404, { error: 'Session not found or key already consumed' });
      return;
    }
    if (consumed.status === 'pending') {
      sendJson(res, 202, { status: 'pending', message: 'Payment is being processed. Please wait.' });
      return;
    }
    sendJson(res, 200, {
      status: 'completed',
      tier: consumed.tier,
      apiKey: consumed.keyPlaintext,
      keyId: consumed.keyId,
      apiKeyAvailable: Boolean(consumed.keyPlaintext),
    });
    return;
  }

  if (pathname === '/billing/success') {
    try {
      const data = await readFile(resolve(STATIC_DIR, 'billing-success.html'));
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self';" });
      res.end(data);
    } catch {
      sendJson(res, 404, { error: 'Not found' });
    }
    return;
  }

  // ── Static files ──────────────────────────────────────────────────────────

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendMethodNotAllowed(res, ['GET', 'HEAD']);
    return;
  }

  const served = await serveStatic(req, res);
  if (!served) {
    sendJson(res, 404, { error: 'Not found' });
  }
});

server.requestTimeout = 120_000;
server.headersTimeout = 125_000;

server.listen(PORT, () => {
  console.log(`Achiote — http://localhost:${PORT}`);
});

async function shutdown(): Promise<void> {
  await Promise.allSettled([...transports].map(([sid, entry]) => closeMcpSession(sid, entry)));
  cache?.close();
  rateLimiter.close();
  billingDb?.close();
  server.close();
}

process.on('SIGINT', () => {
  void shutdown().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0));
});
