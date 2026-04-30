try { process.loadEnvFile(); } catch { /* no .env file present */ }

import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { createAnthropicAskSession, createOpenAICompatibleAskSession, isLocalInferenceUrl, isOpenRouterUrl, openAIBaseUrlFromEnv, openAICompatibleProviderReady, openRouterCatalogModelSupportsParameter, resolveAskModel, resolveAskProviderKind, anthropicBaseUrlFromEnv } from './lib/ask-provider.js';
import type { AskHistoryItem, AskImage, AskModelResponse } from './lib/ask-provider.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createAchioteServer } from './server.js';
import { buildAskCaseFile, formatAskCaseFileForModel } from './lib/ask-case-file.js';
import { createCacheWithStatus } from './lib/cache-path.js';
import { createAuthenticator, loadKeysFromEnv } from './lib/auth.js';
import { createRateLimiter } from './lib/rate-limit.js';
import { BillingDb, defaultBillingDbPath } from './lib/billing-db.js';
import { BillingStripe, loadBillingConfigFromEnv, type CheckoutTier } from './lib/billing-stripe.js';
import { getHttpReadiness, getRequestRateLimitIdentity, isAnonymousAskAllowed, shouldApplyRateLimit } from './lib/http-runtime.js';
import { resolveLocalSpeechConfig, synthesizeWithLocalSpeech, transcribeWithLocalSpeech, validateSpeechAudioPayload, validateSpeechTextPayload } from './lib/local-speech.js';
import { buildMemoryReceipt } from './lib/memory-receipt.js';
import { buildAskQualitySignal, emptyQualitySignalReport, inferAskCacheOutcome, recordQualitySignal } from './lib/quality-signals.js';
import { buildReferenceSeedOperatorReport } from './lib/reference-seed-operator.js';
import { filterRepeatedToolCalls } from './lib/tool-loop.js';
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

const TRUST_PROXY = process.env.ACHIOTE_TRUST_PROXY === 'true';
const TRUSTED_PROXY_IPS = (process.env.ACHIOTE_TRUSTED_PROXY_IPS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const ALLOW_ANON_ASK = process.env.ACHIOTE_ALLOW_ANON_ASK === 'true';
const ANON_WEB_RECONSTRUCTIONS = parsePositiveInteger(process.env.ACHIOTE_ANON_WEB_RECONSTRUCTIONS);

const PORT = parseInt(process.env.PORT || '3000', 10);
const ASK_PROVIDER_KIND = resolveAskProviderKind();
const ASK_MODEL = resolveAskModel();
const ANTHROPIC_TIMEOUT_MS = parseInt(process.env.ANTHROPIC_TIMEOUT_MS || process.env.API_TIMEOUT_MS || '120000', 10);
const OPENAI_TIMEOUT_MS = parseInt(process.env.LOCAL_INFERENCE_TIMEOUT_MS || process.env.OPENAI_TIMEOUT_MS || process.env.LMSTUDIO_TIMEOUT_MS || process.env.GLM_TIMEOUT_MS || process.env.ZHIPU_TIMEOUT_MS || process.env.API_TIMEOUT_MS || '180000', 10);
const FINAL_SYNTHESIS_TIMEOUT_MS = parsePositiveInteger(process.env.ACHIOTE_FINAL_SYNTHESIS_TIMEOUT_MS) ?? 20_000;
const OPENAI_BASE_URL = openAIBaseUrlFromEnv();
const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = resolve(__dirname, '..', 'docs', 'landing');
const ALLOWED_ORIGINS = (process.env.ACHIOTE_ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,https://achiote.kyanitelabs.tech')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const TELEMETRY_LIMIT_PER_MINUTE = parseInt(process.env.ACHIOTE_TELEMETRY_LIMIT_PER_MINUTE || '120', 10);
const EVENTS_ADMIN_TOKEN = process.env.ACHIOTE_EVENTS_ADMIN_TOKEN?.trim();
const KNOWN_TOOL_NAMES = new Set(TOOLS.map((tool) => tool.name));
const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));
const MODEL_TOOL_NAME_ALIASES: Record<string, string> = {
  find_sensory_subutes: 'find_sensory_substitutes',
  generate_minimum_viable_nystalgia: 'generate_minimum_viable_nostalgia',
};

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
  for (const [sid, entry] of transports) {
    if (now - entry.lastActivity > SESSION_TTL) {
      void closeMcpSession(sid, entry);
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
  apiKey: process.env.ANTHROPIC_API_KEY?.trim() || process.env.GLM_API_KEY?.trim() || process.env.ZHIPU_API_KEY?.trim() || null,
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

const AUTH_ENABLED = process.env.ACHIOTE_AUTH_ENABLED !== 'false';
const DEMO_PASSWORD = process.env.ACHIOTE_DEMO_PASSWORD?.trim();
const allowedTelemetryEvents = new Set([
  'page_view',
  'pricing_viewed',
  'app_opened',
  'onboarding_prompt_selected',
  'ask_started',
  'ask_succeeded',
  'ask_failed',
  'checkout_started',
  'checkout_failed',
  'feedback_close',
  'feedback_closer',
  'feedback_wrong_region',
  'feedback_wrong_acid',
  'feedback_wrong_texture',
  'feedback_too_generic',
  'feedback_too_hard',
  'feedback_missed_correction',
  'feedback_missed_name_correction',
  'receipt_downloaded',
  'family_questions_copied',
]);
const allowedTelemetryProperties = new Set(['route', 'source', 'category', 'tier', 'mode', 'billing', 'reason', 'hasHistory']);
const MAX_TELEMETRY_VALUES_PER_PROPERTY = 25;
const OTHER_TELEMETRY_VALUE = 'other';
const telemetryCounters = new Map<string, number>();
const telemetryBreakdowns = new Map<string, Map<string, Map<string, number>>>();
const telemetryBuckets = new Map<string, { count: number; resetAt: number }>();
const qualitySignalReport = emptyQualitySignalReport();

function sanitizeTelemetryProperties(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowedTelemetryProperties.has(key)) continue;
    if (!['string', 'number', 'boolean'].includes(typeof value)) continue;
    const normalized = String(value).trim().slice(0, 80);
    if (!/^[a-zA-Z0-9_./:-]+$/.test(normalized)) continue;
    sanitized[key] = normalized;
  }
  return sanitized;
}

function incrementTelemetryBreakdowns(eventName: string, properties: Record<string, string>): void {
  if (!telemetryBreakdowns.has(eventName)) telemetryBreakdowns.set(eventName, new Map());
  const eventBreakdown = telemetryBreakdowns.get(eventName)!;
  for (const [property, value] of Object.entries(properties)) {
    if (!eventBreakdown.has(property)) eventBreakdown.set(property, new Map());
    const values = eventBreakdown.get(property)!;
    const bucket = values.has(value) || values.size < MAX_TELEMETRY_VALUES_PER_PROPERTY - 1
      ? value
      : OTHER_TELEMETRY_VALUE;
    values.set(bucket, (values.get(bucket) ?? 0) + 1);
  }
}

function serializeTelemetryBreakdowns(): Record<string, Record<string, Record<string, number>>> {
  const serialized: Record<string, Record<string, Record<string, number>>> = {};
  for (const [eventName, properties] of telemetryBreakdowns.entries()) {
    serialized[eventName] = {};
    for (const [property, values] of properties.entries()) {
      serialized[eventName][property] = Object.fromEntries(values);
    }
  }
  return serialized;
}

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

function createAskSession(userMessage: string, history?: AskHistoryItem[], images?: AskImage[]) {
  if (ASK_PROVIDER_KIND === 'openai') {
    return createOpenAICompatibleAskSession({
      model: ASK_MODEL,
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
      tools: TOOLS,
      baseUrl: OPENAI_BASE_URL,
      apiKey: process.env.LOCAL_INFERENCE_API_KEY || process.env.OPENAI_API_KEY || process.env.LMSTUDIO_API_KEY || process.env.LM_STUDIO_API_KEY || null,
      timeoutMs: OPENAI_TIMEOUT_MS,
      history,
      images,
    });
  }

  return createAnthropicAskSession({
    client: anthropic,
    model: ASK_MODEL,
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    tools: TOOLS,
    history,
    images,
  });
}

const SYSTEM_PROMPT = `You are a food memory assistant built into Achiote. You MUST use the provided tools — never answer from memory alone. This applies to ALL user messages: nostalgic memories, recipe adaptation requests, dietary substitution questions, and cooking guidance.

## TOOL WORKFLOW

For EVERY user message, you MUST follow this workflow:

1. The server runs \`plan_tool_workflow\` before your first turn and injects its result into your conversation context. Treat that result as already completed; do not call \`plan_tool_workflow\` again.
2. Follow the injected \`workflowSteps\` from the plan exactly — call the tools in the order listed.
3. Respect \`maxSearchCalls\` — the server enforces this cap. Do not call \`search_web\` more than the plan allows.
4. If \`needsSubstitutions\` is true, call \`find_sensory_substitutes\` for each restricted ingredient.
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
- Use the strongest remembered ingredient family when choosing the ordinary-grocery proxy: peanut memories should test peanut plus sugar/caramel, yuca/cassava memories should test cassava-family chew before potato fallback, fish memories should test a small fish bite unless constraints say otherwise, and hot-orange sauce memories should test acid + chile heat + color/aroma rather than generic salsa.
- Make the answer sensory and concrete: name what the user should smell, feel, or notice first, then say what a wrong result would rule out.
- Avoid clinical labels like "research-bounded proxy test" in user-facing prose. Say "first-pass verification bite" or "first tiny check" instead.
- Keep responses under 220 words.
- Be warm and direct, like a knowledgeable friend who wants to help them taste the memory again.
- If the user shares a photo, describe what you see in the image and combine it with any text description they provide before calling tools.`;

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

type AuthedRequest = { tier: Tier; name: string; keyId: string } | null;

function authenticateRequest(req: IncomingMessage): AuthedRequest {
  const demo = extractDemoPassword(req);
  if (DEMO_PASSWORD && demo) {
    const demoBuf = Buffer.from(demo);
    const passBuf = Buffer.from(DEMO_PASSWORD);
    if (demoBuf.length === passBuf.length && timingSafeEqual(demoBuf, passBuf)) {
      return { tier: 'pro', name: 'demo-user', keyId: 'demo' };
    }
  }
  const rawKey = extractApiKey(req) ?? extractBearer(req);
  const result = AUTH_ENABLED ? authenticator.authenticate(rawKey) : { authenticated: false as const, error: 'auth disabled' };

  if (result.authenticated) {
    return getRequestRateLimitIdentity({
      authEnabled: AUTH_ENABLED,
      authenticated: { authenticated: true, tier: result.tier, name: result.name, keyId: result.keyId },
      headers: req.headers,
      remoteAddress: req.socket.remoteAddress,
      trustProxy: TRUST_PROXY,
      trustedProxyIps: TRUSTED_PROXY_IPS,
    });
  }

  // Fallback to billing-generated API keys
  if (rawKey && billingDb) {
    const billingAuth = billingDb.authenticateApiKey(rawKey);
    if (billingAuth) {
      return { tier: billingAuth.tier, name: billingAuth.name, keyId: billingAuth.keyId };
    }
  }

  return getRequestRateLimitIdentity({
    authEnabled: AUTH_ENABLED,
    authenticated: undefined,
    headers: req.headers,
    remoteAddress: req.socket.remoteAddress,
    trustProxy: TRUST_PROXY,
    trustedProxyIps: TRUSTED_PROXY_IPS,
  });
}

function checkCreditsForAuthed(authed: AuthedRequest, scope: 'mcp' | 'web'): boolean {
  if (!authed || !billingDb) return false;
  const customerId = billingDb.getCustomerIdByKeyId(authed.keyId);
  if (!customerId) return false;
  if (scope === 'mcp') return billingDb.deductMcpCredit(customerId);
  return billingDb.deductWebCredit(customerId);
}

function isSubscriptionCheckoutTier(tier: string): tier is Extract<Tier, 'personal' | 'family'> {
  return tier === 'personal' || tier === 'family';
}

function isPaymentCheckoutTier(tier: string): tier is Extract<CheckoutTier, 'memory-pack' | 'family-sprint'> {
  return tier === 'memory-pack' || tier === 'family-sprint';
}

function sendRateLimitHeaders(res: ServerResponse, limitResult: { remaining: number; limit: number; resetAt: number }): void {
  res.setHeader('X-RateLimit-Remaining', String(limitResult.remaining));
  res.setHeader('X-RateLimit-Limit', String(limitResult.limit));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(limitResult.resetAt / 1000)));
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

function checkTelemetryLimit(key: string): { allowed: boolean; remaining: number; limit: number; resetAt: number } {
  const limit = Math.max(1, TELEMETRY_LIMIT_PER_MINUTE);
  const now = Date.now();
  const windowMs = 60_000;
  let bucket = telemetryBuckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    telemetryBuckets.set(key, bucket);
  }

  if (bucket.count >= limit) {
    return { allowed: false, remaining: 0, limit, resetAt: bucket.resetAt };
  }

  bucket.count++;
  return { allowed: true, remaining: Math.max(0, limit - bucket.count), limit, resetAt: bucket.resetAt };
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
  if (!isAnonymousAskAllowed({ authEnabled: AUTH_ENABLED, allowAnonymousAsk: ALLOW_ANON_ASK })) {
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
    const limitResult = rateLimiter.checkWebLimit(authed.tier, authed.keyId, anonymousWebLimitOverride(authed));
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
    const askSession = createAskSession(userMessage, history, images.value);
    const calledTools = new Set<string>();
    const toolPayloads: Record<string, unknown> = {};
    const deterministicPlanInput = { userMessage };
    let didInjectPlanToolResult = false;
    const finish: DoneSender = (data = {}) => {
      recordAskCompletion(toolPayloads, calledTools, data, consent);
      send('done', data);
    };

    // Execute plan_tool_workflow deterministically — do not rely on the model to call it.
    send('status', { stage: 'routing', tool: 'plan_tool_workflow' });
    try {
      const planResult = await executeToolDefinition('plan_tool_workflow', deterministicPlanInput, toolContext);
      calledTools.add('plan_tool_workflow');
      toolPayloads.plan_tool_workflow = planResult.payload;
      askSession.injectDeterministicToolResult('deterministic_plan_tool_workflow', 'plan_tool_workflow', deterministicPlanInput, planResult.payload);
      didInjectPlanToolResult = true;
      configureAvailableAskTools(askSession, toolPayloads, calledTools);
      send('tool_call', { name: 'plan_tool_workflow', input: deterministicPlanInput, deterministic: true });
      send('tool_result', { name: 'plan_tool_workflow', result: planResult.payload, deterministic: true });
      console.log(`[ask] plan_tool_workflow: intent=${(planResult.payload as Record<string, unknown>)?.detectedIntent} maxSearch=${(planResult.payload as Record<string, unknown>)?.maxSearchCalls}`);
    } catch (err) {
      console.warn('[ask] plan_tool_workflow failed, using defaults:', err instanceof Error ? err.message : String(err));
      configureAvailableAskTools(askSession, toolPayloads, calledTools);
    }

    const nativeToolSupport = await selectedProviderSupportsNativeTools();
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
    const toolCallHistory: Array<{ name: string; input: unknown }> = didInjectPlanToolResult
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
          // Enforce search_web call cap — hard block, never falls through
          if (call.name === 'search_web' && searchCallCount >= getMaxSearchCalls()) {
            const cached = toolPayloads.search_web;
            console.warn(`[ask] search_web cap hard-block (${searchCallCount}/${getMaxSearchCalls()}), ${cached ? 'reusing cached' : 'returning cap message'}`);
            const resultPayload = cached ?? { capReached: true, message: `search_web capped at ${getMaxSearchCalls()} call(s). Use prior research results.` };
            send('tool_call', { name: 'search_web', input: call.input, blocked: true });
            send('tool_result', { name: 'search_web', result: resultPayload, blocked: true });
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
          console.warn(`[ask] final synthesis unavailable after minimum cue, using deterministic response: ${detail}`);
          const responseText = buildMinimumCueCompletedResponse(toolPayloads);
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
    await maybeRunPlannedSubstitutions({ userMessage, toolPayloads, calledTools, send });

    if (await maybeSendForcedMinimumCue({ userMessage, toolPayloads, calledTools, send, finish })) {
      return;
    }

    if (calledTools.has('collect_food_memory') && !calledTools.has('plan_dish_research') && !calledTools.has('generate_minimum_viable_nostalgia')) {
      // In a follow-up turn the user answered the previous clarification question. If the
      // collected memory now has substantive anchors (location, cultural hint, or ≥2 ingredients)
      // let the model's natural response through instead of looping back to clarification.
      const isFollowUp = history !== undefined && history.length > 0;
      if (isFollowUp && hasSubstantialMemoryAnchors(toolPayloads.collect_food_memory)) {
        console.log('[ask] follow-up with substantive anchors — skipping missing_research_plan_clarification guard');
      } else {
        console.warn('[ask] replaced response that skipped research planning with structured clarification');
        const responseText = buildClarificationOnlyResponse(toolPayloads);
        send('text', responseText);
        maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
        finish({ guarded: 'missing_research_plan_clarification' });
        return;
      }
    }

    if (calledTools.has('collect_food_memory')
      && calledTools.has('plan_dish_research')
      && !calledTools.has('generate_minimum_viable_nostalgia')
      && (modelResponse.textBlocks.length === 0 || containsStalledFallbackText(modelResponse.textBlocks.join('\n\n')))) {
      const isFollowUp = history !== undefined && history.length > 0;
      if (isFollowUp && hasSubstantialMemoryAnchors(toolPayloads.collect_food_memory)) {
        console.log('[ask] follow-up with substantive anchors — skipping stalled_planning_clarification guard');
      } else {
        console.warn('[ask] replaced stalled post-plan response with structured clarification');
        const responseText = buildClarificationOnlyResponse(toolPayloads);
        send('text', responseText);
        maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
        finish({ guarded: 'missing_research_plan_clarification' });
        return;
      }
    }

    if (!calledTools.has('generate_minimum_viable_nostalgia') && containsConcreteFoodCue(modelResponse.textBlocks.join('\n\n'))) {
      console.warn('[ask] suppressed concrete cue before minimum viable nostalgia tool');
      const responseText = buildClarificationOnlyResponse(toolPayloads);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'premature_concrete_cue' });
      return;
    }

    if (!calledTools.has('generate_minimum_viable_nostalgia') && containsGenericUncertaintyWaffle(modelResponse.textBlocks.join('\n\n'))) {
      console.warn('[ask] replaced generic uncertainty prose with structured clarification');
      const responseText = buildClarificationOnlyResponse(toolPayloads);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'generic_uncertainty_clarification' });
      return;
    }

    if (!calledTools.has('generate_minimum_viable_nostalgia') && containsPrematureCandidateSpeculation(modelResponse.textBlocks.join('\n\n'), toolPayloads)) {
      console.warn('[ask] replaced premature candidate list with structured clarification');
      const responseText = buildClarificationOnlyResponse(toolPayloads);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'premature_candidate_speculation' });
      return;
    }

    if (calledTools.has('generate_minimum_viable_nostalgia') && shouldClarifyBroadUncertainMemory(userMessage, toolPayloads)) {
      console.warn('[ask] replaced broad uncertain post-cue response with structured clarification');
      const responseText = buildClarificationOnlyResponse(toolPayloads);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'broad_memory_clarification' });
      return;
    }

    if (calledTools.has('generate_minimum_viable_nostalgia') && shouldClarifySparseUnanchoredMemory(userMessage, toolPayloads)) {
      console.warn('[ask] replaced sparse unanchored post-cue response with structured clarification');
      const responseText = buildClarificationOnlyResponse(toolPayloads);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'generic_uncertainty_clarification' });
      return;
    }

    if (calledTools.has('generate_minimum_viable_nostalgia') && containsBlockedRecipeToolSynthesis(modelResponse.textBlocks.join('\n\n'))) {
      console.warn('[ask] replaced blocked recipe-tool synthesis with deterministic minimum cue');
      const responseText = buildMinimumCueCompletedResponse(toolPayloads);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'minimum_cue_deterministic_completion' });
      return;
    }

    if (calledTools.has('generate_minimum_viable_nostalgia')
      && (modelResponse.textBlocks.length === 0 || containsStalledFallbackText(modelResponse.textBlocks.join('\n\n')))) {
      console.warn('[ask] replaced stalled post-cue response with deterministic minimum cue');
      const responseText = buildMinimumCueCompletedResponse(toolPayloads);
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
      const responseText = sanitizeLatestCorrectionResponse(buildMinimumCueCompletedResponse(toolPayloads), userMessage);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      finish({ guarded: 'latest_correction_sanitized' });
      return;
    }

    if (calledTools.has('generate_minimum_viable_nostalgia') && containsRecipeMeasurementLanguage(trustBoundedResponseText)) {
      console.warn('[ask] suppressed recipe-style measurements in cue response');
      const sanitized = sanitizeRecipeStyleCueLanguage(trustBoundedResponseText);
      send('text', sanitized);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: sanitized, send });
      finish({ guarded: 'recipe_measurement_sanitized' });
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

  // resolve_dish_name: emit canonical name + region when a real match was found
  const resolved = toolPayloads.resolve_dish_name as
    | { dishName?: string; canonicalName?: string; region?: string; confidence?: string; aliases?: string[] }
    | undefined;
  if (resolved?.canonicalName && !/^Unknown$/i.test(resolved.canonicalName)) {
    facts.push(`Dish resolved: "${resolved.canonicalName}" (confidence: ${resolved.confidence ?? 'unknown'}, region: ${resolved.region ?? 'unknown'})`);
    const aliases = (resolved.aliases ?? []).filter(Boolean).slice(0, 3);
    if (aliases.length) facts.push(`Also known as: ${aliases.join(', ')}`);
  }

  // search_web: emit the snippet from each top result (up to 3)
  const searched = toolPayloads.search_web as
    | { results?: Array<{ title?: string; snippet?: string }> }
    | undefined;
  for (const result of (searched?.results ?? []).slice(0, 3)) {
    if (result.snippet?.trim()) facts.push(result.snippet.trim());
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
    };
  }
  return input;
}

function buildGroundedSearchQuery(collectedMemory: unknown, resolvedDish: unknown): string {
  const memory = collectedMemory as CollectedFoodMemory;
  const clues = memory.extractedClues;
  const resolved = isRecord(resolvedDish) ? resolvedDish : {};
  const canonicalName = typeof resolved.canonicalName === 'string' && !/^unknown$/i.test(resolved.canonicalName)
    ? resolved.canonicalName
    : '';
  const parts = [
    canonicalName,
    ...clues.possibleDishNames,
    ...clues.rememberedIngredients,
    ...clues.sensoryClues,
    ...clues.culturalOrRegionalHints.filter((hint) => !isBroadRegionalHint(hint)),
    memory.normalizedMemory,
  ];
  return sanitizeGroundedSearchQuery([...new Set(parts.map((part) => part.trim()).filter(Boolean))].join(' '));
}

function sanitizeGroundedSearchQuery(query: string): string {
  return query
    .replace(/\b(?:I\s+remember|I\s+do\s+not\s+know|give\s+me|smallest|first-pass|not\s+a\s+full\s+recipe|memory|memories)\b/gi, ' ')
    .replace(/[^\p{L}\p{M}\p{N}\s'-]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 180);
}

function isLatestCorrectionMessage(userMessage: string): boolean {
  return /\b(?:correction|actually|wait\s+no|remembered\s+wrong)\b/i.test(userMessage);
}

function buildCorrectedMemoryText(modelMemoryText: string, userMessage: string, history?: AskHistoryItem[]): string {
  const userHistory = (history ?? [])
    .filter((item) => item.role === 'user')
    .map((item) => item.content)
    .join('\n');
  return sanitizeStaleModelMemoryText([
    userHistory,
    modelMemoryText,
    `Latest correction: ${sanitizeLatestCorrectionMemoryText(userMessage)}`,
  ].filter((entry) => entry.trim().length > 0).join('\n'), userMessage);
}

function sanitizeLatestCorrectionMemoryText(userMessage: string): string {
  return userMessage
    .replace(/\b(?:not|no|wasn['’]?t|weren['’]?t|isn['’]?t|aren['’]?t|was\s+not|were\s+not|is\s+not|are\s+not)\s+(?:milky|creamy|cream|thick|warm|hot|sweet)(?:\s+or\s+(?:milky|creamy|cream|thick|warm|hot|sweet))*[;,.]?\s*/gi, '')
    .replace(/\b(was|were|is|are)\s+(?:;|,)\s+/gi, '$1 ')
    .replace(/\b(was|were|is|are)\s+(it|this|that|they)\s+\1\b/gi, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function sanitizeStaleModelMemoryText(modelMemoryText: string, userMessage: string): string {
  let sanitized = modelMemoryText;
  const rejectsPreviousDescription = /\b(?:correction:\s*)?no,?\s+I\s+remembered\s+wrong\b/i.test(userMessage);
  for (const descriptor of ['milky', 'creamy', 'cream', 'milk-forward', 'thick', 'warm', 'hot', 'sweet']) {
    const isContradicted = rejectsPreviousDescription
      || new RegExp(`\\b(?:not|no|wasn['’]?t|was\\s+not|isn['’]?t|is\\s+not)\\s+(?:\\w+\\s+){0,3}${descriptor}\\b`, 'i').test(userMessage);
    if (isContradicted) {
      sanitized = sanitized.replace(new RegExp(`\\b${descriptor}\\b`, 'gi'), '');
    }
  }
  return sanitized.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
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
      ? [record.snippet]
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

function anonymousWebLimitOverride(authed: AuthedRequest): number | undefined {
  if (!authed || AUTH_ENABLED || !ALLOW_ANON_ASK) return undefined;
  return ANON_WEB_RECONSTRUCTIONS;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function createWithTimeout(
  askSession: ReturnType<typeof createAskSession>,
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
  if (/\b(?:401|402|403|api[_ -]?key|invalid key|authorization|bearer|token|credential|secret|moderation|flagged|insufficient credits)\b/i.test(message)) {
    return false;
  }

  if (/\b(?:Failed to parse tool arguments|no assistant message|finish_reason: length|fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|AbortError|timed out)\b/i.test(message)) {
    return true;
  }

  if (ASK_PROVIDER_KIND === 'openai') {
    return /\bOpenAI-compatible provider returned (?:400|404|408|429|5\d\d)\b/i.test(message)
      || /\b(?:No endpoints found that support tool use|unsupported.*tool|tool use|provider returned error|model provider failed|rate limit)\b/i.test(message);
  }

  return /\b(?:429|5\d\d|rate limit|overloaded|temporarily unavailable|timeout|model provider failed)\b/i.test(message);
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

let openRouterToolsSupportPromise: Promise<boolean | undefined> | undefined;

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return undefined;
}

async function selectedProviderSupportsNativeTools(): Promise<boolean | undefined> {
  const explicit = parseBooleanEnv(process.env.ACHIOTE_ASK_MODEL_SUPPORTS_TOOLS)
    ?? parseBooleanEnv(process.env.OPENROUTER_MODEL_SUPPORTS_TOOLS);
  if (explicit !== undefined) return explicit;

  if (ASK_PROVIDER_KIND !== 'openai' || !isOpenRouterUrl(OPENAI_BASE_URL)) return undefined;

  openRouterToolsSupportPromise ??= fetchOpenRouterModelSupportsTools();
  return openRouterToolsSupportPromise;
}

async function fetchOpenRouterModelSupportsTools(): Promise<boolean | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7_500);
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models?supported_parameters=tools', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return undefined;
    const catalog = await response.json() as unknown;
    return openRouterCatalogModelSupportsParameter(catalog, ASK_MODEL, 'tools');
  } catch (err) {
    console.warn('[ask] OpenRouter tool capability lookup failed:', err instanceof Error ? err.message : String(err));
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
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
  askSession: ReturnType<typeof createAskSession>,
  toolPayloads: Record<string, unknown>,
  calledTools: Set<string>,
): void {
  const toolNames = nextAskToolNames(toolPayloads, calledTools);
  askSession.setAvailableTools(toolNames.map((name) => TOOLS_BY_NAME.get(name)).filter((tool): tool is typeof TOOLS[number] => Boolean(tool)));
}

function nextAskToolNames(toolPayloads: Record<string, unknown>, calledTools: Set<string>): string[] {
  const plan = toolPayloads.plan_tool_workflow as { workflowSteps?: Array<{ tool?: unknown }> } | undefined;
  const plannedToolNames = (plan?.workflowSteps ?? [])
    .map((step) => step.tool)
    .filter((tool): tool is string => typeof tool === 'string' && KNOWN_TOOL_NAMES.has(tool) && tool !== 'plan_tool_workflow');

  if (plannedToolNames.length === 0) return calledTools.has('collect_food_memory') ? [] : ['collect_food_memory'];
  if (!calledTools.has('collect_food_memory') && plannedToolNames.includes('collect_food_memory')) return ['collect_food_memory'];
  if (!calledTools.has('plan_dish_research') && plannedToolNames.includes('plan_dish_research')) return ['plan_dish_research'];

  const remaining = plannedToolNames.filter((name) => !calledTools.has(name));
  return [...new Set(remaining)];
}

async function recoverFromInitialProviderFailure({
  userMessage,
  toolPayloads,
  calledTools,
  send,
  finish,
  guarded,
}: {
  userMessage: string;
  toolPayloads: Record<string, unknown>;
  calledTools: Set<string>;
  send: SseSender;
  finish: DoneSender;
  guarded: string;
}): Promise<boolean> {
  send('status', { stage: 'deterministic_recovery', reason: 'provider_context_limit' });

  if (!calledTools.has('collect_food_memory')) {
    send('status', { stage: 'calling_tools', tools: ['collect_food_memory'], deterministic: true });
    await executeAndStreamTool('collect_food_memory', { memoryText: userMessage }, userMessage, send, calledTools, toolPayloads);
  }

  await maybeRunMissingResearchPlan({ userMessage, toolPayloads, calledTools, send });
  await maybeRunPlannedSubstitutions({ userMessage, toolPayloads, calledTools, send });

  if (await maybeSendForcedMinimumCue({ userMessage, toolPayloads, calledTools, send, finish })) {
    return true;
  }

  const responseText = buildClarificationOnlyResponse(toolPayloads);
  send('text', responseText);
  maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
  finish({ guarded });
  return true;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
    maxEffortMinutes: 10,
  }, userMessage, send, calledTools, toolPayloads) as MinimumViableNostalgiaCue;

  const responseText = formatMinimumCueFallback(cue, memory.userLocation);
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

function extractSubstitutionTargets(userMessage: string, collectedMemory: unknown): string[] {
  const targets = new Set<string>();
  const clues = collectedMemory && typeof collectedMemory === 'object'
    ? (collectedMemory as { extractedClues?: { rememberedIngredients?: unknown } }).extractedClues
    : undefined;
  const rememberedIngredients = Array.isArray(clues?.rememberedIngredients) ? clues.rememberedIngredients : [];
  for (const ingredient of rememberedIngredients) {
    if (typeof ingredient === 'string' && ingredient.trim()) targets.add(normalizeSubstitutionTarget(ingredient));
  }

  const ingredientPatterns: Array<[RegExp, string]> = [
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

function normalizeSubstitutionTarget(ingredient: string): string {
  const normalized = ingredient.trim().toLowerCase();
  if (normalized === 'cashew') return 'cashews';
  if (normalized === 'chickpea') return 'chickpeas';
  if (normalized === 'lentil') return 'lentils';
  if (normalized === 'egg') return 'eggs';
  return normalized;
}

function isExplicitMinimumTestRequest(text: string): boolean {
  return /\b(?:minimum viable|minimum|smallest|smallest safe|smallest local|tiny|first|local)\b[\s\S]{0,60}\b(?:test|cue|try|taste|nostalgia|sip|bite|drink)\b/i.test(text)
    || /\b(?:test|cue|try|taste|sip|bite|drink)\b[\s\S]{0,60}\b(?:minimum viable|minimum|smallest|tiny|first|local)\b/i.test(text);
}

function hasSensorySignal(userMessage: string, collectedMemory: unknown): boolean {
  const clues = collectedMemory && typeof collectedMemory === 'object'
    ? (collectedMemory as { extractedClues?: { rememberedIngredients?: unknown; sensoryClues?: unknown } }).extractedClues
    : undefined;
  const rememberedIngredients = Array.isArray(clues?.rememberedIngredients) ? clues.rememberedIngredients : [];
  const sensoryClues = Array.isArray(clues?.sensoryClues) ? clues.sensoryClues : [];
  if (rememberedIngredients.length > 0 || sensoryClues.length > 0) return true;

  return /\b(?:sweet|sour|salty|bitter|spicy|hot|cold|warm|icy|ice|iced|thin|thinner|watery|lightly sweet|barely sweet|crispy|crunchy|crumbly|grainy|powdery|chewy|creamy|sticky|aroma|smell|texture|color|mouth|tongue|sip|drink|bebida|agua|arroz|rice|canela|cinnamon|hielo|vainilla|vanilla|lime|barley|cebada|sesame|coconut|peanut|dill|garlic|onion|sauce|gravy|relish)\b/i.test(userMessage);
}

function formatMinimumCueFallback(cue: MinimumViableNostalgiaCue, userLocation?: string): string {
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
    ? `Local sourcing: use ordinary grocery or pantry ingredients near ${userLocation}; do not buy the exact suspected dish for this first test.`
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

function formatMinimumCueIngredientPhrase(ingredient: MinimumViableNostalgiaCue['ingredients'][number]): string {
  const item = sanitizeMinimumCueFallbackText(ingredient.item)
    .replace(/^(?:a\s+)?(?:tiny|small)\s+(?:test\s+)?amount\s+of\s+/i, '')
    .replace(/^tiny\s+/i, '')
    .trim();
  return `a tiny amount of ${item}`;
}

function firstUsefulCueStep(cue: MinimumViableNostalgiaCue): string {
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

function compactMinimumCueWhy(text: string): string {
  return sanitizeMinimumCueFallbackText(text)
    .replace(/\b(?:before wasting ingredients on a full pot|before committing to specialty shopping or a full dish|before specialty shopping or cooking|before buying the suspected sweet)\b/gi, 'before you spend more effort')
    .replace(/\bfood-science mechanisms\b/gi, 'memory mechanisms');
}

function buildMinimumCueCompletedResponse(toolPayloads: Record<string, unknown>): string {
  const cue = toolPayloads.generate_minimum_viable_nostalgia as MinimumViableNostalgiaCue | undefined;
  if (!cue) {
    return 'I completed the structured Achiote tool workflow, but the final synthesis model did not return in time. Try again with a shorter prompt or a faster provider.';
  }
  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  return ensureCueQualityLanguage(formatMinimumCueFallback(cue, memory?.userLocation), toolPayloads, new Set(['generate_minimum_viable_nostalgia']));
}

function ensureLocalCueLanguage(text: string, toolPayloads: Record<string, unknown>, calledTools: Set<string>): string {
  if (!calledTools.has('generate_minimum_viable_nostalgia')) return text;
  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  const location = memory?.userLocation;
  if (!location) return text;
  const mentionsLocality = new RegExp(`\\b${escapeRegExp(location)}\\b`, 'i').test(text)
    || /\b(?:local|nearby|ordinary grocery|grocery-store|grocery store|pantry|available near)\b/i.test(text);
  if (mentionsLocality) return text;
  return `${text.trim()}\n\nUse ordinary grocery or pantry ingredients near ${location}; do not buy the exact suspected dish for this first test.`;
}

function ensureCueQualityLanguage(text: string, toolPayloads: Record<string, unknown>, calledTools: Set<string>): string {
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
  revised = `${revised.trim()}\n\nThis is only a first-pass verification bite: if the aroma, texture, or aftertaste is wrong, we should revise the guess before chasing exact ingredients.`;
  return revised;
}

function ensureComposedCueCoverage(text: string, toolPayloads: Record<string, unknown>): string {
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

function authenticateVoiceRequest(req: IncomingMessage, res: ServerResponse): AuthedRequest {
  const authed = authenticateRequest(req);
  if (!authed) {
    sendJson(res, 401, { error: DEMO_PASSWORD ? 'Unauthorized. Provide the demo password via x-demo-password header.' : 'Unauthorized. Provide a valid API key via x-api-key header or Authorization bearer token.' });
    return null;
  }
  if (!isAnonymousAskAllowed({ authEnabled: AUTH_ENABLED, allowAnonymousAsk: ALLOW_ANON_ASK })) {
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
  const payload = validateSpeechAudioPayload(parsed);
  if (!payload.ok) { sendJson(res, 400, { error: payload.error }); return; }
  if (!localSpeechConfig.stt.ready) { sendJson(res, 503, { error: localSpeechConfig.stt.reason || 'speech-to-text is not ready' }); return; }

  try {
    const transcript = await transcribeWithLocalSpeech(localSpeechConfig, payload);
    sendJson(res, 200, transcript);
  } catch (err) {
    sendJson(res, 502, { error: err instanceof Error ? err.message : 'Local transcription failed' });
  }
}

async function handleVoiceSynthesize(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!authenticateVoiceRequest(req, res)) return;
  const parsed = await readJsonBody(req, res, 32_000);
  if (parsed === null) return;
  const payload = validateSpeechTextPayload(parsed);
  if (!payload.ok) { sendJson(res, 400, { error: payload.error }); return; }
  if (!localSpeechConfig.tts.ready) { sendJson(res, 503, { error: localSpeechConfig.tts.reason || 'text-to-speech is not ready' }); return; }

  try {
    const speech = await synthesizeWithLocalSpeech(localSpeechConfig, payload);
    sendJson(res, 200, speech);
  } catch (err) {
    sendJson(res, 502, { error: err instanceof Error ? err.message : 'Local speech synthesis failed' });
  }
}

function containsConcreteFoodCue(text: string): boolean {
  return /\b(?:smallest safe cue|tasting cue|concrete food cue|recipe move|try this|try it tonight)\b/i.test(text)
    || /\b(?:teaspoons?|tablespoons?|cups?|pinch)\b/i.test(text)
    || /\b(?:heat|stir|sip|bite|steep|mix)\b[\s\S]{0,80}\b(?:dill|broth|buttermilk|vinegar|lemon|salt|sour cream|yogurt|potato)\b/i.test(text);
}

function containsRecipeMeasurementLanguage(text: string): boolean {
  const spelledAmount = String.raw`(?:a|an|half|quarter|one|two|three|four|five|six|seven|eight|nine|ten)`;
  return /\b\d+(?:\s*[-–]\s*\d+)?(?:\s*\/\s*\d+)?\s*(?:tsp|tbsp|teaspoons?|tablespoons?|cups?|ounces?|oz|pounds?|lbs?|grams?|g|ml|milliliters?|liters?|quarts?|gallons?|sticks?|cloves?|heads?|bunches?)\b/i.test(text)
    || /\b(?:one|half)[-\s]?cup\b/i.test(text)
    || new RegExp(String.raw`\b${spelledAmount}\s+(?:of\s+|a\s+)?(?:tsp|tbsp|teaspoons?|tablespoons?|cups?|ounces?|oz|pounds?|lbs?|grams?|milliliters?|liters?|quarts?|gallons?|sticks?|cloves?|heads?|bunches?)\b`, 'i').test(text)
    || /\b\d+(?:\s*[-–]\s*\d+)?\s*(?:mins?|minutes?|hrs?|hours?)\b/i.test(text)
    || /\b\d{2,4}\s*°?\s*[FC]\b/i.test(text)
    || /\bpreheat\b.*\b(?:oven|to)\b/i.test(text)
    || /\b(?:bake|roast|simmer|boil)\b.*\b(?:minutes?|hours?|degrees?|°)\b/i.test(text)
    || /\b(?:gentle\s+simmer|rolling\s+boil)\b/i.test(text);
}

function sanitizeRecipeStyleCueLanguage(text: string): string {
  return text
    .replace(/\b(?:one|half)[-\s]?cup\b/gi, 'tiny sip')
    .replace(/\bfull\s+recipe\b/gi, 'full dish')
    .replace(/\b\d+(?:\s*[-–]\s*\d+)?(?:\s*\/\s*\d+)?\s*(?:tsp|tbsp|teaspoons?|tablespoons?|cups?|ounces?|oz|pounds?|lbs?|grams?|g|ml|milliliters?|liters?|quarts?|gallons?|sticks?|cloves?|heads?|bunches?)\b/gi, 'a small amount of')
    .replace(/\b(?:a|an|half|quarter|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:of\s+|a\s+)?(?:tsp|tbsp|teaspoons?|tablespoons?|cups?|ounces?|oz|pounds?|lbs?|grams?|milliliters?|liters?|quarts?|gallons?|sticks?|cloves?|heads?|bunches?)\b/gi, 'a small amount of')
    .replace(/\b\d+(?:\s*[-–]\s*\d+)?\s*(?:mins?|minutes?|hrs?|hours?)\b/gi, 'briefly')
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

function normalizeModelToolCalls(toolCalls: AskModelResponse['toolCalls']): {
  toolCalls: AskModelResponse['toolCalls'];
  corrections: Array<{ from: string; to: string }>;
  normalizedAny: boolean;
} {
  const corrections: Array<{ from: string; to: string }> = [];
  const normalized = toolCalls.map((call) => {
    const toolName = normalizeModelToolName(call.name);
    if (toolName === call.name) return call;
    corrections.push({ from: call.name, to: toolName });
    return { ...call, name: toolName };
  });
  return { toolCalls: normalized, corrections, normalizedAny: corrections.length > 0 };
}

function normalizeModelToolName(toolName: string): string {
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

function boundedEditDistance(left: string, right: string, maxDistance: number): number {
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

function sanitizeMinimumCueFallbackText(text: string): string {
  return sanitizeRecipeStyleCueLanguage(text)
    .replace(/\bnot an oven recipe\b/gi, 'not an oven meal')
    .replace(/\brecipe\b/gi, 'dish')
    .replace(/\bbriefly\s+min\b/gi, 'briefly')
    .trim();
}

function sanitizeMinimumCueFallbackBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => sanitizeMinimumCueFallbackText(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeFinalAnswerTrustBoundaryLanguage(text: string): string {
  const revised = text
    .replace(/(?:^|[.?!]\s*|\n)\s*(?:[-*]\s*)?[^.\n?!]*?(?:I\s+am\s+not\s+browsing|I\s+am\s+Achiote|built\s+into\s+this\s+specific\s+toolset|specific\s+toolset|toolset|workflow)[^.\n?!]*?(?:[.?!]|$)/gim, '\n')
    .replace(/\bI\s+am\s+Achiote\b[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/\bI\s+am\s+not\s+browsing\b[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/\bI\s+have\s+browsed\b[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/\bI\s+do\s+not\s+browse\b[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/\bMy\s+model\b[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/\bI\s+cannot\s+browse\b[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/\b[^.?!]*?(?:ignore\s+Achiote|Achiote\s+(?:assistant|app|tool|toolset|workflow|model|server|searched|browsed)|browse)\b[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/\b[^.?!]*?(?:specific\s+toolset|toolset|workflow)\b[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/(?:^|\n)\s*(?:[-*]\s*)?[^.\n?!]*?(?:medical advice|legal advice|professional advice|medically safe|legally safe|heart-healthy|lowers cholesterol|cures?)[^.\n?!]*?(?:[.?!]|$)/gim, '\n')
    .replace(/\bI\s+cannot\s+give\b[^.?!]*?(?:medical advice|legal advice|professional advice)[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/\b(?:OpenAI|Anthropic|Claude|GPT[-\s]?\d[\w.-]*|gpt[-\s]?\d[\w.-]*|fake-hostile-model|provider(?:\/model)?|model identity)\b[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/\b(?:I\s+(?:browsed|searched)|Achiote\s+(?:browsed|searched)|live web|current grocery prices|live search results?|web results?)\b[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/\b(?:This\s+)?(?:medically safe|medical(?:ly)?|heart-healthy|cure|cures|lowers cholesterol|(?:treats?|prevents?|diagnoses?)\s+(?:a\s+|an\s+|the\s+)?(?:illness|disease|condition|symptoms?|inflammation|cholesterol|infection|diabetes|heart disease|medical problem))\b[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/\b(?:legal(?:ly)? safe|legal advice|medical advice|professional advice)\b[^.?!]*?(?:[.?!]|$)/gi, '')
    .replace(/\bFirst-pass verification bite\b/g, 'first-pass verification bite')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return revised || 'Use this only as a first-pass verification bite; keep the result evidence-bounded and revise if the sensory cue is wrong.';
}

function containsGenericUncertaintyWaffle(text: string): boolean {
  return /\b(?:fits|matches|could\s+be|might\s+be|applies\s+to)\s+(?:dozens|many|lots|a\s+lot)\s+of\s+dishes\b/i.test(text)
    || /\bcould\s+point\s+to\s+(?:so\s+)?(?:many|lots|dozens|different)[\s\S]{0,60}\bdishes\b/i.test(text)
    || /\bcould\s+point\s+in\s+(?:quite\s+)?a\s+few\s+directions\b/i.test(text)
    || /\b(?:there\s+are\s+)?(?:dozens|many|lots|so\s+many\s+different)\s+(?:different\s+)?dishes\b[\s\S]{0,80}\b(?:fit|match|could|might|similar|point)\b/i.test(text);
}

function containsStalledFallbackText(text: string): boolean {
  return /\bI've gathered enough information so far\.?\s+Let me work with what we have\.?\b/i.test(text.trim());
}

function containsBlockedRecipeToolSynthesis(text: string): boolean {
  return /\brecipe generation was skipped\b/i.test(text)
    || /\boutside the minimum cue flow\b/i.test(text)
    || /\bsynthesize directly from the minimum viable nostalgia cue\b/i.test(text);
}

function containsPrematureCandidateSpeculation(text: string, toolPayloads: Record<string, unknown>): boolean {
  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  const hasStableAnchor = Boolean(
    memory?.extractedClues.possibleDishNames.length ||
    memory?.extractedClues.culturalOrRegionalHints.some((hint) => !isBroadRegionalHint(hint)),
  );
  if (hasStableAnchor) return false;
  return /\bcould\s+be\s+(?:a|an|the)?\s*[\s\S]{0,120}\b(?:or\s+even|,\s*(?:a|an|the)?\s*[\p{L}\p{M}])/iu.test(text)
    || /\bmight\s+be\s+(?:a|an|the)?\s*[\s\S]{0,120}\b(?:or\s+even|,\s*(?:a|an|the)?\s*[\p{L}\p{M}])/iu.test(text)
    || /\bfrom\s+(?:a|an|the)?\s*[\s\S]{0,160}\bto\s+(?:a|an|the)?\s*[\s\S]{0,160}\bto\b/iu.test(text)
    || /\bfor example\s+[\s\S]{0,160},\s*[\s\S]{0,80}\bor\s+[\s\S]{0,80}\b/iu.test(text);
}

function shouldClarifyBroadUncertainMemory(userMessage: string, toolPayloads: Record<string, unknown>): boolean {
  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  if (!memory) return false;

  const text = `${userMessage}\n${memory.normalizedMemory}`.toLowerCase();
  const explicitUncertainty = /\b(?:do\s+not|don't|not\s+sure|uncertain|no\s+idea|unknown)\b[\s\S]{0,180}\b(?:country|region|dish\s+name|name|ingredients?|soup|sauce|stew)\b/i.test(text)
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

function shouldClarifySparseUnanchoredMemory(userMessage: string, toolPayloads: Record<string, unknown>): boolean {
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

function hasSubstantialMemoryAnchors(memory: unknown): boolean {
  // Returns true when a follow-up message has given enough new anchors to proceed without
  // another clarification round: a location, a cultural/regional hint, or multiple ingredients.
  const m = memory as CollectedFoodMemory | undefined;
  if (!m) return false;
  return Boolean(m.userLocation?.trim())
    || (m.extractedClues?.culturalOrRegionalHints?.length ?? 0) > 0
    || (m.extractedClues?.rememberedIngredients?.length ?? 0) >= 2;
}

function isBroadRegionalHint(hint: string): boolean {
  return /\b(?:latin\s+america|hispanic|spanish-speaking|asia|europe|africa|middle\s+east|mediterranean|caribbean|south\s+america|central\s+america)\b/i.test(hint);
}

function getStringArray(value: unknown, key: string): string[] {
  if (!value || typeof value !== 'object') return [];
  const item = (value as Record<string, unknown>)[key];
  return Array.isArray(item) ? item.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function buildClarificationOnlyResponse(toolPayloads: Record<string, unknown>): string {
  const memoryQuestions = getStringArray(toolPayloads.collect_food_memory, 'nextQuestions');
  const planQuestions = getStringArray(toolPayloads.plan_dish_research, 'questionsForUser');
  const questions = [...new Set([...planQuestions, ...memoryQuestions])].slice(0, 3);
  const selectedQuestions = questions.length > 0 ? questions : [
    'Where did you eat this, or where was it from? Even a country, region, city, or community helps.',
    'Do you remember anything about the name, even a rough sound-alike?',
  ];

  // Build a context-aware preamble based on what signals are already present
  const memory = toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  const sensoryClues = memory?.extractedClues?.sensoryClues ?? [];
  const ingredients = memory?.extractedClues?.rememberedIngredients ?? [];
  const inferred = memory?.inferredContext?.culturalOrRegional ?? [];
  const nonBroadInferred = inferred.filter((c) => !isBroadRegionalHint(c.label));

  let preamble: string;
  if (nonBroadInferred.length > 0) {
    // Acknowledge the cultural inference so the user knows we heard them
    const context = nonBroadInferred[0].label.replace(/\s+context$/i, '').toLowerCase();
    preamble = `Your description already points toward a ${context} tradition — I just need one more anchor to give you a real test instead of a guess.`;
  } else if (sensoryClues.length > 0 || ingredients.length > 0) {
    const anchor = [...sensoryClues, ...ingredients].slice(0, 2).join(' and ');
    preamble = `The ${anchor} you mentioned is a real anchor. One more detail will keep the first test specific rather than generic.`;
  } else {
    preamble = 'Before I give you a tasting cue, I need one or two details so I do not fake certainty.';
  }

  return [
    preamble,
    '',
    ...selectedQuestions.map((question, index) => `${index + 1}. ${question}`),
    '',
    'Those answers decide the dish family and keep the first test cheap, specific, and tied to the memory instead of a guess.',
  ].join('\n');
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

    const telemetryLimit = checkTelemetryLimit(telemetryClientKey(req));
    sendRateLimitHeaders(res, telemetryLimit);
    if (!telemetryLimit.allowed) {
      sendJson(res, 429, { error: 'Telemetry rate limit exceeded' });
      return;
    }

    try {
      const raw = await readBody(req, 1_024);
      const parsed = JSON.parse(raw) as { event?: unknown; properties?: unknown; consent?: unknown };
      const eventName = typeof parsed.event === 'string' ? parsed.event : '';
      if (!allowedTelemetryEvents.has(eventName)) {
        sendJson(res, 400, { error: 'Unsupported telemetry event' });
        return;
      }
      const consent = parseDataConsent(parsed.consent);
      if (!consent.analytics) {
        sendJson(res, 202, { ok: true, skipped: 'analytics_consent_required' });
        return;
      }
      const properties = sanitizeTelemetryProperties(parsed.properties);
      telemetryCounters.set(eventName, (telemetryCounters.get(eventName) ?? 0) + 1);
      incrementTelemetryBreakdowns(eventName, properties);
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
      counters: Object.fromEntries(telemetryCounters),
      breakdowns: serializeTelemetryBreakdowns(),
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
    const readiness = getHttpReadiness({
      authEnabled: AUTH_ENABLED,
      apiKeyCount: configuredApiKeys.length,
      demoPasswordConfigured: Boolean(DEMO_PASSWORD),
      billingEnabled: Boolean(billingConfig),
      anthropicApiKey: ASK_PROVIDER_KIND === 'openai' && openAICompatibleProviderReady(OPENAI_BASE_URL, process.env.LOCAL_INFERENCE_API_KEY || process.env.OPENAI_API_KEY || process.env.LMSTUDIO_API_KEY || process.env.LM_STUDIO_API_KEY) ? 'openai-compatible-provider' : ASK_PROVIDER_KIND === 'openai' ? undefined : (process.env.ANTHROPIC_API_KEY || process.env.GLM_API_KEY || process.env.ZHIPU_API_KEY || undefined),
      anthropicAuthToken: ASK_PROVIDER_KIND === 'openai' ? undefined : process.env.ANTHROPIC_AUTH_TOKEN,
      openaiProviderReady: ASK_PROVIDER_KIND === 'openai' && openAICompatibleProviderReady(OPENAI_BASE_URL, process.env.LOCAL_INFERENCE_API_KEY || process.env.OPENAI_API_KEY || process.env.LMSTUDIO_API_KEY || process.env.LM_STUDIO_API_KEY),
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
    sendJson(res, 200, localSpeechConfig);
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

    const limitResult = rateLimiter.checkMcpLimit(authed.tier, authed.keyId);
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
