try { process.loadEnvFile(); } catch { /* no .env file present */ }

import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { createAnthropicAskSession, createOpenAICompatibleAskSession, openAIBaseUrlFromEnv, openAICompatibleProviderReady, resolveAskModel, resolveAskProviderKind, anthropicBaseUrlFromEnv } from './lib/ask-provider.js';
import type { AskHistoryItem, AskImage } from './lib/ask-provider.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createAchioteServer } from './server.js';
import { createCacheWithStatus } from './lib/cache-path.js';
import { createAuthenticator, loadKeysFromEnv } from './lib/auth.js';
import { createRateLimiter } from './lib/rate-limit.js';
import { BillingDb, defaultBillingDbPath } from './lib/billing-db.js';
import { BillingStripe, loadBillingConfigFromEnv, type CheckoutTier } from './lib/billing-stripe.js';
import { getHttpReadiness, getRequestRateLimitIdentity, isAnonymousAskAllowed, shouldApplyRateLimit } from './lib/http-runtime.js';
import { resolveLocalSpeechConfig, synthesizeWithLocalSpeech, transcribeWithLocalSpeech, validateSpeechAudioPayload, validateSpeechTextPayload } from './lib/local-speech.js';
import { buildMemoryReceipt } from './lib/memory-receipt.js';
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
const OPENAI_BASE_URL = openAIBaseUrlFromEnv();
const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = resolve(__dirname, '..', 'docs', 'landing');
const ALLOWED_ORIGINS = (process.env.ACHIOTE_ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,https://achiote.kyanitelabs.tech')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const TELEMETRY_LIMIT_PER_MINUTE = parseInt(process.env.ACHIOTE_TELEMETRY_LIMIT_PER_MINUTE || '120', 10);
const EVENTS_ADMIN_TOKEN = process.env.ACHIOTE_EVENTS_ADMIN_TOKEN?.trim();

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

function isGlm4Model(model: string): boolean {
  return model.startsWith('glm-4');
}

function createAskSession(userMessage: string, history?: AskHistoryItem[], images?: AskImage[]) {
  // GLM 4.x models on Z.ai use OpenAI-compatible endpoint; honor explicit openai provider
  const provider = process.env.ACHIOTE_ASK_PROVIDER?.trim().toLowerCase() ?? '';
  if ((provider === 'glm' || provider === 'zhipu') && isGlm4Model(ASK_MODEL)) {
    return createOpenAICompatibleAskSession({
      model: ASK_MODEL,
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
      tools: TOOLS,
      baseUrl: process.env.GLM_OPENAI_BASE_URL?.trim() || 'https://api.z.ai/api/coding/paas/v4',
      apiKey: process.env.GLM_API_KEY || process.env.ZHIPU_API_KEY || null,
      timeoutMs: OPENAI_TIMEOUT_MS,
      history,
      images,
    });
  }

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

const SYSTEM_PROMPT = `You are a food memory assistant built into Achiote. You MUST use the provided tools — never answer from memory alone.

## TOOL WORKFLOW

When a user shares a food memory, start with tools before writing any user-facing answer.

1. \`collect_food_memory\` — parse the user's text.
2. \`plan_dish_research\` — build hypotheses from the parsed memory.
3. Look at the structured \`nextQuestions\`, \`questionsForUser\`, hypotheses, confidence, and missing-information fields.
4. If the memory is still sparse or the next best move is clarification, stop tool calling and ask targeted questions.
5. If there is enough signal for a sensory test, continue:
   - \`resolve_dish_name\` with the top non-generic hypothesis name.
   - \`search_web\` only when a specific named dish needs external confirmation or the match is Low/Unknown.
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
Ask 1-3 specific, high-value follow-up questions before offering a reconstruction. Prefer questions about dish name/sound-alike, region/community, cooking method, sensory trigger, serving format, or occasion. Whenever possible, quote or adapt the tool-generated nextQuestions instead of inventing generic questions. Explain in one short sentence why those answers matter.

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
- If the tools have no dish name and no region, do not list candidate dishes. Ask the highest-value missing detail.
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
  let parsed: { message?: string; history?: AskHistoryItem[]; images?: unknown };
  try { parsed = JSON.parse(raw); } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return; }

  const images = parseImages(parsed.images);
  if (images.error) { sendJson(res, 400, { error: images.error }); return; }

  const userMessage = parsed.message?.trim() ?? '';
  if (!userMessage && images.value.length === 0) { sendJson(res, 400, { error: 'message or images is required' }); return; }

  const history = parseHistory(parsed.history);

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
    send('status', { stage: 'model', provider: ASK_PROVIDER_KIND, model: ASK_MODEL });
    let modelResponse = await askSession.create(4096);
    console.log(`[ask] provider=${ASK_PROVIDER_KIND} model=${ASK_MODEL} content=text:${modelResponse.textBlocks.length},tools:${modelResponse.toolCalls.length}`);
    if (modelResponse.toolCalls.length === 0) {
      console.warn('[ask] model skipped required Achiote tool workflow');
      send('error', {
        message: 'The model skipped Achiote\'s structured memory workflow. Try again, or use a provider/model with tool-calling support.',
        code: 'tool_workflow_skipped',
      });
      return;
    }

    let iterations = 0;
    const toolCallHistory: Array<{ name: string; input: unknown }> = [];
    const MAX_DUPLICATE_CALLS = 2;

    while (modelResponse.toolCalls.length > 0 && iterations < 15) {
      if (res.writableEnded) return;
      iterations++;
      const toolNames = modelResponse.toolCalls.map((call) => call.name);
      console.log(`[ask] iteration=${iterations} calling tools: ${toolNames.join(', ')}`);

      // Detect tool loops: same tool called repeatedly without progress
      for (const call of modelResponse.toolCalls) {
        const previousCalls = toolCallHistory.filter((h) => h.name === call.name);
        if (previousCalls.length >= MAX_DUPLICATE_CALLS) {
          console.warn(`[ask] tool loop detected: ${call.name} called ${previousCalls.length + 1} times, stopping tool calls`);
          send('status', { iteration: iterations, stage: 'tool_loop_detected', tool: call.name, count: previousCalls.length + 1 });
          modelResponse = {
            textBlocks: modelResponse.textBlocks.length > 0 ? modelResponse.textBlocks : [`I've gathered enough information so far. Let me work with what we have.`],
            toolCalls: [],
            providerMessage: modelResponse.providerMessage ?? null,
          };
          break;
        }
      }

      if (modelResponse.toolCalls.length === 0) break;

      send('status', { iteration: iterations, stage: 'calling_tools', tools: toolNames });
      const toolResults: Array<{ id: string; content: string }> = [];

      for (const call of modelResponse.toolCalls) {
        try {
          const payload = await executeAndStreamTool(call.name, call.input, userMessage, send, calledTools, toolPayloads);
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
      send('status', { iteration: iterations, stage: 'thinking' });
      modelResponse = await askSession.create(2048);
    }

    if (await maybeSendForcedMinimumCue({ userMessage, toolPayloads, calledTools, send })) {
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
        send('done', { guarded: 'missing_research_plan_clarification' });
        return;
      }
    }

    if (!calledTools.has('generate_minimum_viable_nostalgia') && containsConcreteFoodCue(modelResponse.textBlocks.join('\n\n'))) {
      console.warn('[ask] suppressed concrete cue before minimum viable nostalgia tool');
      const responseText = buildClarificationOnlyResponse(toolPayloads);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      send('done', { guarded: 'premature_concrete_cue' });
      return;
    }

    if (!calledTools.has('generate_minimum_viable_nostalgia') && containsGenericUncertaintyWaffle(modelResponse.textBlocks.join('\n\n'))) {
      console.warn('[ask] replaced generic uncertainty prose with structured clarification');
      const responseText = buildClarificationOnlyResponse(toolPayloads);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      send('done', { guarded: 'generic_uncertainty_clarification' });
      return;
    }

    if (!calledTools.has('generate_minimum_viable_nostalgia') && containsPrematureCandidateSpeculation(modelResponse.textBlocks.join('\n\n'), toolPayloads)) {
      console.warn('[ask] replaced premature candidate list with structured clarification');
      const responseText = buildClarificationOnlyResponse(toolPayloads);
      send('text', responseText);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
      send('done', { guarded: 'premature_candidate_speculation' });
      return;
    }

    const responseText = modelResponse.textBlocks
      .map((text) => ensureCueQualityLanguage(text, toolPayloads, calledTools))
      .join('\n\n');

    if (calledTools.has('generate_minimum_viable_nostalgia') && containsRecipeMeasurementLanguage(responseText)) {
      console.warn('[ask] suppressed recipe-style measurements in cue response');
      const sanitized = responseText
        // Only replace explicit numeric quantities (e.g. "2 tablespoons", "1/2 cup"); bare unit words in prose are fine.
        .replace(/\b\d+(?:\s*\/\s*\d+)?\s*(?:teaspoons?|tablespoons?|cups?|ounces?|pounds?|grams?|ml|liters?|quarts?|gallons?|sticks?|cloves?|heads?|bunches?)\b/gi, 'a small amount of')
        .replace(/\b(preheat|bake|roast|simmer|boil)\b[\s\S]*?\b(?:minutes?|hours?|degrees?|°|oven)\b/gi, 'prepare briefly')
        .replace(/\bserves?\s+\d+\b/gi, 'a small portion');
      send('text', sanitized);
      maybeSendMemoryReceipt({ toolPayloads, assistantText: sanitized, send });
      send('done', { guarded: 'recipe_measurement_sanitized' });
      return;
    }

    if (responseText) send('text', responseText);
    maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
    send('done', {});
  } catch (err) {
    send('error', { message: err instanceof Error ? err.message : 'Unknown error' });
  } finally {
    res.end();
  }
}

type SseSender = (event: string, data: unknown) => void;

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
): Promise<unknown> {
  if (toolName === 'generate_minimum_viable_nostalgia' && shouldBuildMissingDossier(input, toolPayloads)) {
    await executeAndStreamTool('build_reconstruction_dossier', {
      memory: toolPayloads.collect_food_memory,
      researchPlan: toolPayloads.plan_dish_research,
      inferredFacts: [
        'The model requested a minimum viable cue before building a dossier, so the server built the evidence boundary first.',
      ],
    }, userMessage, send, calledTools, toolPayloads);
  }
  const normalizedInput = normalizeDependentToolInput(toolName, input, userMessage, toolPayloads);
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

function normalizeDependentToolInput(toolName: string, input: unknown, userMessage: string, toolPayloads: Record<string, unknown>): unknown {
  const record = isRecord(input) ? input : {};
  const collectedMemory = hasUsableCollectedMemory(toolPayloads.collect_food_memory)
    ? toolPayloads.collect_food_memory
    : undefined;
  const researchPlan = hasUsableResearchPlan(toolPayloads.plan_dish_research)
    ? toolPayloads.plan_dish_research
    : undefined;

  if (toolName === 'collect_food_memory') {
    const memoryText = typeof record.memoryText === 'string' && record.memoryText.trim()
      ? record.memoryText
      : userMessage;
    const normalizedRecord: Record<string, unknown> = { ...record, memoryText };
    delete normalizedRecord.knownRegion;
    delete normalizedRecord.knownLanguage;
    const userLocation = inferUserLocation(userMessage);
    return typeof normalizedRecord.userLocation === 'string' || !userLocation
      ? normalizedRecord
      : { ...normalizedRecord, userLocation };
  }
  if (toolName === 'build_research_record') {
    return normalizeResearchRecordInput(record, toolPayloads);
  }
  if (toolName === 'plan_dish_research' && !hasUsableCollectedMemory(record.memory) && collectedMemory) {
    return { ...record, memory: collectedMemory };
  }
  if (toolName === 'build_reconstruction_dossier') {
    return {
      ...record,
      ...(!hasUsableCollectedMemory(record.memory) && collectedMemory ? { memory: collectedMemory } : {}),
      ...(!hasUsableResearchPlan(record.researchPlan) && researchPlan ? { researchPlan } : {}),
    };
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
}: {
  userMessage: string;
  toolPayloads: Record<string, unknown>;
  calledTools: Set<string>;
  send: SseSender;
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
    dossier = await executeAndStreamTool('build_reconstruction_dossier', {
      memory,
      researchPlan,
      inferredFacts: [
        'The user explicitly asked for a minimum test, so the first response should give a cheap local proxy before exact dish sourcing.',
        'The cue should isolate remembered sensory mechanisms from pantry or ordinary grocery ingredients.',
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
  send('done', { guarded: 'explicit_minimum_cue_fallback' });
  return true;
}

function shouldForceMinimumCue(userMessage: string, toolPayloads: Record<string, unknown>, calledTools: Set<string>): boolean {
  if (!toolPayloads.collect_food_memory || !toolPayloads.plan_dish_research) return false;

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

function isExplicitMinimumTestRequest(text: string): boolean {
  return /\b(?:minimum viable|minimum|smallest|smallest safe|smallest local|first|local)\b[\s\S]{0,40}\b(?:test|cue|try|taste|nostalgia)\b/i.test(text)
    || /\b(?:test|cue|try|taste)\b[\s\S]{0,40}\b(?:minimum viable|minimum|smallest|first|local)\b/i.test(text);
}

function hasSensorySignal(userMessage: string, collectedMemory: unknown): boolean {
  const clues = collectedMemory && typeof collectedMemory === 'object'
    ? (collectedMemory as { extractedClues?: { rememberedIngredients?: unknown; sensoryClues?: unknown } }).extractedClues
    : undefined;
  const rememberedIngredients = Array.isArray(clues?.rememberedIngredients) ? clues.rememberedIngredients : [];
  const sensoryClues = Array.isArray(clues?.sensoryClues) ? clues.sensoryClues : [];
  if (rememberedIngredients.length > 0 || sensoryClues.length > 0) return true;

  return /\b(?:sweet|sour|salty|bitter|spicy|hot|cold|warm|crispy|crunchy|crumbly|grainy|powdery|chewy|creamy|sticky|aroma|smell|texture|color|mouth|tongue|sesame|coconut|peanut|dill|garlic|onion|sauce|gravy|relish)\b/i.test(userMessage);
}

function formatMinimumCueFallback(cue: MinimumViableNostalgiaCue, userLocation?: string): string {
  const ingredientLines = cue.ingredients
    .slice(0, 4)
    .map((ingredient) => `- ${ingredient.amount} ${ingredient.item}${ingredient.optional ? ' (optional)' : ''}`);
  const stepLines = cue.steps
    .slice(0, 4)
    .map((step, index) => `${index + 1}. ${step}`);
  const followUp = cue.followUpIfItWorks[0];
  const localLine = userLocation
    ? `Local sourcing: use ordinary grocery or pantry ingredients near ${userLocation}; do not buy the exact suspected dish for this first test.`
    : '';

  return [
    `${cue.title} (${cue.effortMinutes} min)`,
    '',
    cue.goal,
    '',
    'Use:',
    ...ingredientLines,
    '',
    'Try:',
    ...stepLines,
    '',
    `Why this is minimum: ${cue.whyThisIsMinimum}`,
    localLine,
    followUp ? `If it works: ${followUp}` : '',
  ].filter((line) => line.length > 0).join('\n');
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
  // Require an explicit numeric quantity before the unit so prose like "a pinch of dill"
  // or "a tablespoon of broth" does not fire. Only "2 tablespoons", "1/2 cup", etc. match.
  return /\b\d+(?:\s*\/\s*\d+)?\s*(?:teaspoons?|tablespoons?|cups?|ounces?|pounds?|grams?|ml|liters?|quarts?|gallons?|sticks?|cloves?|heads?|bunches?)\b/i.test(text)
    || /\bpreheat\b.*\b(?:oven|to)\b/i.test(text)
    || /\b(?:bake|roast|simmer|boil)\b.*\b(?:minutes?|hours?|degrees?|°)\b/i.test(text);
}

function containsGenericUncertaintyWaffle(text: string): boolean {
  return /\b(?:fits|matches|could\s+be|might\s+be|applies\s+to)\s+(?:dozens|many|lots|a\s+lot)\s+of\s+dishes\b/i.test(text)
    || /\bcould\s+point\s+to\s+(?:so\s+)?(?:many|lots|dozens|different)[\s\S]{0,60}\bdishes\b/i.test(text)
    || /\bcould\s+point\s+in\s+(?:quite\s+)?a\s+few\s+directions\b/i.test(text)
    || /\b(?:there\s+are\s+)?(?:dozens|many|lots|so\s+many\s+different)\s+(?:different\s+)?dishes\b[\s\S]{0,80}\b(?:fit|match|could|might|similar|point)\b/i.test(text);
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
    || /\bfrom\s+(?:a|an|the)?\s*[\s\S]{0,160}\bto\s+(?:a|an|the)?\s*[\s\S]{0,160}\bto\b/iu.test(text);
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
      const parsed = JSON.parse(raw) as { event?: unknown; properties?: unknown };
      const eventName = typeof parsed.event === 'string' ? parsed.event : '';
      if (!allowedTelemetryEvents.has(eventName)) {
        sendJson(res, 400, { error: 'Unsupported telemetry event' });
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
      cacheAvailable: cache !== null && !cacheState.fallbackUsed,
      rateLimitPersistenceConfigured: Boolean(process.env.ACHIOTE_RATE_LIMIT_DB),
    });
    sendJson(res, pathname === '/ready' && !readiness.ready ? 503 : 200, {
      status: pathname === '/health' ? 'ok' : readiness.status,
      version: '0.2.0',
      authEnabled: AUTH_ENABLED,
      billingEnabled: Boolean(billingConfig),
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
