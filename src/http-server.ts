try { process.loadEnvFile(); } catch { /* no .env file present */ }

import { randomUUID } from 'node:crypto';
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
import { BillingStripe, loadBillingConfigFromEnv } from './lib/billing-stripe.js';
import { getHttpReadiness, getRequestRateLimitIdentity, isAnonymousAskAllowed, shouldApplyRateLimit } from './lib/http-runtime.js';
import type { Tier } from './lib/auth.js';
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

const PORT = parseInt(process.env.PORT || '3000', 10);
const ASK_PROVIDER_KIND = resolveAskProviderKind();
const ASK_MODEL = resolveAskModel();
const ANTHROPIC_TIMEOUT_MS = parseInt(process.env.ANTHROPIC_TIMEOUT_MS || process.env.API_TIMEOUT_MS || '120000', 10);
const OPENAI_TIMEOUT_MS = parseInt(process.env.OPENAI_TIMEOUT_MS || process.env.LMSTUDIO_TIMEOUT_MS || process.env.GLM_TIMEOUT_MS || process.env.ZHIPU_TIMEOUT_MS || process.env.API_TIMEOUT_MS || '180000', 10);
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

const AUTH_ENABLED = process.env.ACHIOTE_AUTH_ENABLED !== 'false';
const DEMO_PASSWORD = process.env.ACHIOTE_DEMO_PASSWORD?.trim();
const allowedTelemetryEvents = new Set([
  'page_view',
  'app_opened',
  'ask_started',
  'ask_succeeded',
  'ask_failed',
  'checkout_started',
  'feedback_helpful',
  'feedback_generic',
  'feedback_wrong_region',
  'feedback_unsafe',
]);
const telemetryCounters = new Map<string, number>();
const telemetryBuckets = new Map<string, { count: number; resetAt: number }>();

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
      apiKey: process.env.OPENAI_API_KEY || process.env.LMSTUDIO_API_KEY || process.env.LM_STUDIO_API_KEY || null,
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

Do not give a concrete food cue, tasting test, substitute, recipe move, or reconstruction until after
\`generate_minimum_viable_nostalgia\` has returned. If the right move is a clarification-only response,
ask the targeted questions and stop; do not sneak in a cue.

## HOW TO WRITE YOUR RESPONSE

Your job is to SYNTHESIZE the tool outputs into useful analysis. Do NOT just repeat the user's words.

**If the memory is sparse, ambiguous, or missing decisive clues:**
Ask 1-3 specific, high-value follow-up questions before offering a reconstruction. Prefer questions about dish name/sound-alike, region/community, cooking method, sensory trigger, serving format, or occasion. Whenever possible, quote or adapt the tool-generated nextQuestions instead of inventing generic questions. Explain in one short sentence why those answers matter.

**If a specific dish was identified with Medium or High confidence and the user gave enough sensory clues:**
Lead with the dish and a one-sentence explanation. Then give the minimum viable nostalgia cue.

**If no specific dish was identified but there are enough sensory clues for a useful test:**
- Analyze the actual clues the user gave (region, ingredients, textures, aromas, cooking method).
- Explain what those clues point to using food science (Maillard browning, fat-soluble aromatics, starch gelatinization, acid/salt/sugar balance, Sichuan peppercorn numbing, etc.).
- Present the minimum viable nostalgia cue as a concrete thing to try.
Then include one targeted follow-up that would most reduce uncertainty if they want to continue.

**Critical rules:**
- Do not just echo the user's phrases back to them.
- Do not ask generic "tell me more" questions.
- NEVER say "There are many dishes that fit this pattern" or list generic possibilities.
- NEVER apologize for not knowing the exact dish.
- NEVER string the user's keywords together as a fake dish name (e.g., "fried Szechuan rice with Szechuan spices").
- ALWAYS anchor to the specific region the user mentioned. If they said Sichuan, talk about Sichuan — not "Asia."
- If you give a cue, make it cheap, accessible, and food-science grounded.
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
  if (DEMO_PASSWORD && demo === DEMO_PASSWORD) {
    return { tier: 'pro', name: 'demo-user', keyId: 'demo' };
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
  return extractBearer(req) === EVENTS_ADMIN_TOKEN;
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
  if (!authed) { sendJson(res, 401, { error: DEMO_PASSWORD ? 'Unauthorized. Provide the demo password via x-demo-password header.' : 'Unauthorized. Provide a valid API key via x-api-key header or Authorization bearer token.' }); return; }
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
    const limitResult = rateLimiter.checkWebLimit(authed.tier, authed.keyId);
    sendRateLimitHeaders(res, limitResult);
    if (!limitResult.allowed && !checkCreditsForAuthed(authed, 'web')) {
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
    let modelResponse = await askSession.create(4096);
    console.log(`[ask] provider=${ASK_PROVIDER_KIND} content=text:${modelResponse.textBlocks.length},tools:${modelResponse.toolCalls.length}`);
    if (modelResponse.toolCalls.length === 0) {
      console.warn('[ask] model skipped required Achiote tool workflow');
      send('error', {
        message: 'The model skipped Achiote\'s structured memory workflow. Try again, or use a provider/model with tool-calling support.',
        code: 'tool_workflow_skipped',
      });
      return;
    }

    let iterations = 0;
    while (modelResponse.toolCalls.length > 0 && iterations < 15) {
      if (res.writableEnded) return;
      iterations++;
      const toolNames = modelResponse.toolCalls.map((call) => call.name);
      console.log(`[ask] iteration=${iterations} calling tools: ${toolNames.join(', ')}`);
      send('status', { iteration: iterations, stage: 'calling_tools', tools: toolNames });
      const toolResults: Array<{ id: string; content: string }> = [];

      for (const call of modelResponse.toolCalls) {
        send('tool_call', { name: call.name, input: call.input });
        try {
          const result = await executeToolDefinition(call.name, call.input, toolContext);
          validateToolOutput(call.name, result.payload);
          calledTools.add(call.name);
          toolPayloads[call.name] = result.payload;
          const content = JSON.stringify(result.payload);
          toolResults.push({ id: call.id, content });
          send('tool_result', { name: call.name, result: result.payload });
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

    if (!calledTools.has('generate_minimum_viable_nostalgia') && containsConcreteFoodCue(modelResponse.textBlocks.join('\n\n'))) {
      console.warn('[ask] suppressed concrete cue before minimum viable nostalgia tool');
      send('text', buildClarificationOnlyResponse(toolPayloads));
      send('done', { guarded: 'premature_concrete_cue' });
      return;
    }

    for (const text of modelResponse.textBlocks) {
      send('text', text);
    }
    send('done', {});
  } catch (err) {
    send('error', { message: err instanceof Error ? err.message : 'Unknown error' });
  } finally {
    res.end();
  }
}

function containsConcreteFoodCue(text: string): boolean {
  return /\b(?:smallest safe cue|tasting cue|concrete food cue|recipe move|try this|try it tonight)\b/i.test(text)
    || /\b(?:teaspoons?|tablespoons?|cups?|pinch)\b/i.test(text)
    || /\b(?:heat|stir|sip|bite|steep|mix)\b[\s\S]{0,80}\b(?:dill|broth|buttermilk|vinegar|lemon|salt|sour cream|yogurt|potato)\b/i.test(text);
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

  return [
    'Before I give you a tasting cue, I need one or two details so I do not fake certainty.',
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
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "connect-src 'self'",
      ].join('; '),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
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
      const parsed = JSON.parse(raw) as { event?: unknown };
      const eventName = typeof parsed.event === 'string' ? parsed.event : '';
      if (!allowedTelemetryEvents.has(eventName)) {
        sendJson(res, 400, { error: 'Unsupported telemetry event' });
        return;
      }
      telemetryCounters.set(eventName, (telemetryCounters.get(eventName) ?? 0) + 1);
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
    sendJson(res, 200, { counters: Object.fromEntries(telemetryCounters) });
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
      anthropicApiKey: ASK_PROVIDER_KIND === 'openai' && openAICompatibleProviderReady(OPENAI_BASE_URL, process.env.OPENAI_API_KEY || process.env.LMSTUDIO_API_KEY || process.env.LM_STUDIO_API_KEY) ? 'openai-compatible-provider' : ASK_PROVIDER_KIND === 'openai' ? undefined : (process.env.ANTHROPIC_API_KEY || process.env.GLM_API_KEY || process.env.ZHIPU_API_KEY || undefined),
      anthropicAuthToken: ASK_PROVIDER_KIND === 'openai' ? undefined : process.env.ANTHROPIC_AUTH_TOKEN,
      cacheAvailable: cache !== null && !cacheState.fallbackUsed,
      rateLimitPersistenceConfigured: Boolean(process.env.ACHIOTE_RATE_LIMIT_DB),
    });
    sendJson(res, pathname === '/ready' && !readiness.ready ? 503 : 200, {
      status: pathname === '/health' ? 'ok' : readiness.status,
      version: '0.2.0',
      authEnabled: AUTH_ENABLED,
      activeSessions: transports.size,
      readiness,
      memory: process.memoryUsage(),
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

  if (pathname === '/mcp' && !['GET', 'POST', 'DELETE'].includes(req.method ?? '')) {
    sendMethodNotAllowed(res, ['GET', 'POST', 'DELETE']);
    return;
  }

  if (pathname === '/mcp') {
    const authed = authenticateRequest(req);
    if (!authed) { sendJson(res, 401, { jsonrpc: '2.0', error: { code: -32001, message: DEMO_PASSWORD ? 'Unauthorized: provide the demo password via x-demo-password header' : 'Unauthorized: valid API key required' }, id: null }); return; }

    const limitResult = rateLimiter.checkMcpLimit(authed.tier, authed.keyId);
    sendRateLimitHeaders(res, limitResult);
    if (!limitResult.allowed && !checkCreditsForAuthed(authed, 'mcp')) {
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
    try { raw = await readBody(req); } catch { sendJson(res, 413, { error: 'Body too large' }); return; }
    let parsed: { tier?: Tier; mode?: 'subscription' | 'payment'; email?: string };
    try { parsed = JSON.parse(raw); } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return; }
    const tier = parsed.tier ?? 'pro';
    const mode = parsed.mode ?? 'subscription';
    if (mode === 'subscription' && tier !== 'pro' && tier !== 'business') {
      sendJson(res, 400, { error: 'Invalid tier for subscription. Use pro or business.' });
      return;
    }
    try {
      const session = await billingStripe.createCheckoutSession({ tier, mode, customerEmail: parsed.email });
      billingDb.createCheckoutSession(session.sessionId, mode, undefined, tier);
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
    let raw: string;
    try { raw = await readBody(req); } catch { sendJson(res, 413, { error: 'Body too large' }); return; }
    let parsed: { customerId?: string };
    try { parsed = JSON.parse(raw); } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return; }
    const customerId = parsed.customerId;
    if (!customerId) {
      sendJson(res, 400, { error: 'customerId is required' });
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
    const session = billingDb.getCheckoutSession(sessionId);
    if (!session) {
      sendJson(res, 404, { error: 'Session not found' });
      return;
    }
    if (session.status === 'pending') {
      sendJson(res, 202, { status: 'pending', message: 'Payment is being processed. Please wait.' });
      return;
    }
    sendJson(res, 200, {
      status: 'completed',
      tier: session.tier,
      apiKey: session.keyPlaintext,
      keyId: session.keyId,
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
