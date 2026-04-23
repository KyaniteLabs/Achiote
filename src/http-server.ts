import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { createAnthropicAskSession, createOpenAICompatibleAskSession, openAIBaseUrlFromEnv, openAICompatibleProviderReady, resolveAskProviderKind, anthropicBaseUrlFromEnv } from './lib/ask-provider.js';
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
const ASK_MODEL = ASK_PROVIDER_KIND === 'openai'
  ? process.env.ACHIOTE_ASK_MODEL || process.env.OPENAI_MODEL || process.env.LMSTUDIO_MODEL || process.env.LM_STUDIO_MODEL || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'gpt-4o-mini'
  : process.env.ACHIOTE_ASK_MODEL || process.env.GLM_MODEL || process.env.ZHIPU_MODEL || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'claude-sonnet-4-5-20250929';
const ANTHROPIC_TIMEOUT_MS = parseInt(process.env.ANTHROPIC_TIMEOUT_MS || process.env.API_TIMEOUT_MS || '120000', 10);
const OPENAI_TIMEOUT_MS = parseInt(process.env.OPENAI_TIMEOUT_MS || process.env.LMSTUDIO_TIMEOUT_MS || process.env.GLM_TIMEOUT_MS || process.env.ZHIPU_TIMEOUT_MS || process.env.API_TIMEOUT_MS || '180000', 10);
const OPENAI_BASE_URL = openAIBaseUrlFromEnv();
const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = resolve(__dirname, '..', 'docs', 'landing');
const ALLOWED_ORIGINS = (process.env.ACHIOTE_ALLOWED_ORIGINS || 'http://localhost:3000').split(',');

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
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

function isGlm4Model(model: string): boolean {
  return model.startsWith('glm-4');
}

function createAskSession(userMessage: string) {
  // GLM 4.x models (4.7, 4.5-air, etc.) use OpenAI-compatible endpoint with OpenAI-style tools
  // GLM 5.x models (5.1, 5, 5-turbo) use Anthropic-compatible endpoint
  if (isGlm4Model(ASK_MODEL)) {
    return createOpenAICompatibleAskSession({
      model: ASK_MODEL,
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
      tools: TOOLS,
      baseUrl: process.env.GLM_OPENAI_BASE_URL?.trim() || 'https://api.z.ai/api/coding/paas/v4',
      apiKey: process.env.GLM_API_KEY || process.env.ZHIPU_API_KEY || null,
      timeoutMs: OPENAI_TIMEOUT_MS,
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
    });
  }

  return createAnthropicAskSession({
    client: anthropic,
    model: ASK_MODEL,
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    tools: TOOLS,
  });
}

const SYSTEM_PROMPT = `You are a food memory assistant built into Achiote. You MUST use the provided tools — never answer from memory alone.

## MANDATORY WORKFLOW

When a user shares a food memory, you MUST call tools in this exact sequence. Do NOT respond with plain text until you have completed the tool chain.

Step 1: Call \`collect_food_memory\` with the user's text.
Step 2: Pass the result into \`plan_dish_research\`.
Step 3: Call \`resolve_dish_name\` with the \`input\` parameter set to the \`name\` field of the first hypothesis from the research plan. NEVER skip this step.
Step 4: Call \`build_reconstruction_dossier\` with the memory, research plan, and any researchedFacts from the research plan output.
Step 5: Call \`generate_minimum_viable_nostalgia\` with the dossier.

Only AFTER step 5 should you write a text response. Present the results warmly and conversationally.
- LEAD with the specific dish name if researchedFacts identified one. Example: "This sounds like arroz con dulce, a Puerto Rican Christmas rice pudding made with coconut milk, cinnamon, and raisins."
- If the user provided a region or country, ALWAYS anchor your response to that region. NEVER suggest "different cultures" or ask if it could be from somewhere else.
- If the user already provided rich sensory details (texture, flavor, appearance, wrapper, temperature), do NOT ask for more sensory details. Present the minimum viable nostalgia cue directly.
- Cite 1–2 sources from researchedFacts.
- Then present the minimum viable nostalgia cue.
- If no dish was identified, say so clearly before giving the cue. Do NOT apologize for not knowing; instead, present the cue as a way to test what the memory might be.
- When the dossier confidence is Low BUT the user provided rich sensory details, still LEAD with your best hypothesis. Example: "This sounds like a grainy caramel milk confection from Panama — possibly a dulce de leche-style candy." Then present the cue. Do NOT hedge with "I don't know" or ask for more clues.

## OPTIONAL TOOLS (use when relevant)
- \`search_web\` to find current recipes, blogs, or sources about a dish or ingredient
- \`analyze_nostalgic_dish\` for sensory breakdown
- \`find_sensory_substitutes\` for ingredient swaps
- \`source_ingredients\` for where to buy things
- \`discover_regional_similars\` for related dishes in neighboring cultures
- \`generate_family_followup_questions\` for questions the user can ask family
- \`generate_recipe\` only if the user explicitly asks for a full recipe

## RULES
- ALWAYS call collect_food_memory FIRST. Never skip it.
- NEVER respond with plain text before Step 5 is complete — even if earlier steps return uncertain or low-confidence results. Always finish the tool chain.
- Never invent dish names or ingredients — trust the tool output.
- Keep final text responses under 200 words.
- Be warm, not clinical.`;

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
    raw = await readBody(req);
  } catch (err) {
    if (err instanceof Error && err.message === 'Body too large') {
      sendJson(res, 413, { error: 'Body too large' });
      req.resume();
    }
    return;
  }
  let parsed: { message?: string };
  try { parsed = JSON.parse(raw); } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return; }

  const userMessage = parsed.message?.trim();
  if (!userMessage) { sendJson(res, 400, { error: 'message is required' }); return; }

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
    const askSession = createAskSession(userMessage);
    let modelResponse = await askSession.create(4096);
    console.log(`[ask] provider=${ASK_PROVIDER_KIND} content=text:${modelResponse.textBlocks.length},tools:${modelResponse.toolCalls.length}`);

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

// ── Helpers ─────────────────────────────────────────────────────────────────

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
  const raw = req.url?.split('?')[0] ?? '/';
  const assetPath = raw === '/' ? 'index.html' : raw === '/app' ? 'app.html' : raw === '/about' ? 'about.html' : raw.replace(/^\//, '');
  const filePath = resolve(STATIC_DIR, assetPath);

  if (!filePath.startsWith(resolve(STATIC_DIR) + sep)) return false;

  try {
    const data = await readFile(filePath);
    const ext = assetPath.slice(assetPath.lastIndexOf('.'));
    const contentType = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;",
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

  if ((pathname === '/health' || pathname === '/ready') && req.method !== 'GET' && req.method !== 'HEAD') {
    sendMethodNotAllowed(res, ['GET', 'HEAD']);
    return;
  }

  if (pathname === '/health' || pathname === '/ready') {
    const readiness = getHttpReadiness({
      authEnabled: AUTH_ENABLED,
      apiKeyCount: configuredApiKeys.length,
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
