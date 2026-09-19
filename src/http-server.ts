try { process.loadEnvFile(); } catch { /* no .env file present */ }

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AskHistoryItem, AskImage } from './lib/ask-provider.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createAchioteServer } from './server.js';
import { createAuthenticator, loadKeysFromEnv } from './lib/auth.js';
import { createRateLimiter } from './lib/rate-limit.js';
import { createAccountAccess, rateLimitHeaders, type AuthedRequest } from './lib/account-access.js';
import { BillingDb, defaultBillingDbPath } from './lib/billing-db.js';
import { BillingStripe, loadBillingConfigFromEnv, type CheckoutTier } from './lib/billing-stripe.js';
import { CryptoCheckout, CryptoOrderError, loadCryptoConfigFromEnv } from './lib/billing-crypto.js';
import { getHttpReadiness, getRequestRateLimitIdentity, shouldApplyRateLimit } from './lib/http-runtime.js';
import { resolveLocalSpeechConfig } from './lib/local-speech.js';
import { createLocalSpeechController } from './lib/local-speech-controller.js';
import { buildReferenceSeedOperatorReport } from './lib/reference-seed-operator.js';
import { createTelemetryCollector, sanitizeTelemetryProperties as sanitizeTelemetryProps } from './lib/telemetry-collector.js';
import type { Tier } from './lib/auth.js';
import { createAskEngineDeps, parsePositiveInteger } from './core/ask-engine-deps.js';
import { runAskWorkflow, type AskEventSink } from './core/ask-engine.js';
import { createJsonLogger } from './core/logger.js';

const TRUST_PROXY = process.env.ACHIOTE_TRUST_PROXY === 'true';
const TRUSTED_PROXY_IPS = (process.env.ACHIOTE_TRUSTED_PROXY_IPS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const ALLOW_ANON_ASK = process.env.ACHIOTE_ALLOW_ANON_ASK === 'true';
const ANON_WEB_RECONSTRUCTIONS = parsePositiveInteger(process.env.ACHIOTE_ANON_WEB_RECONSTRUCTIONS);

const PORT = parseInt(process.env.PORT || '3000', 10);
// Provider timeouts and synthesis budgets now live in createAskEngineDeps (src/core/ask-engine-deps.ts).
const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = resolve(__dirname, '..', 'docs', 'landing');
const ALLOWED_ORIGINS = (process.env.ACHIOTE_ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,https://achiote.kyanitelabs.tech')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const TELEMETRY_LIMIT_PER_MINUTE = parseInt(process.env.ACHIOTE_TELEMETRY_LIMIT_PER_MINUTE || '120', 10);
const EVENTS_ADMIN_TOKEN = process.env.ACHIOTE_EVENTS_ADMIN_TOKEN?.trim();
const POSTHOG_PROJECT_API_KEY = process.env.POSTHOG_PROJECT_API_KEY?.trim();
const POSTHOG_HOST = (process.env.POSTHOG_HOST?.trim() || 'https://us.i.posthog.com').replace(/\/+$/, '');
const POSTHOG_DISABLED = process.env.POSTHOG_DISABLED === 'true';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

// Cache-Control by asset class so Cloudflare can serve edge copies of the static site.
// Immutable assets (fonts, images) carry content-hashing-equivalent stability; CSS/JS are
// always requested with `?v=` cache-busters so a one-day TTL is safe; HTML pages get a short
// browser TTL but a long shared (CDN) TTL so edge copies stay warm while updates ship quickly.
const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';
const CACHE_VERSIONED = 'public, max-age=86400';
const CACHE_HTML = 'public, max-age=300, s-maxage=86400';
const IMMUTABLE_EXTS = new Set(['.woff2', '.woff', '.jpg', '.jpeg', '.png', '.webp', '.svg', '.ico']);
const VERSIONED_EXTS = new Set(['.css', '.js']);

// Text/config surfaces (llms.txt, robots.txt, sitemap.xml, manifest) are crawl-facing and change
// occasionally; short browser TTL + long shared TTL keeps them edge-cached but quick to refresh.
const SHORT_TTL_EXTS = new Set(['.html', '.txt', '.xml', '.json', '.webmanifest', '.md']);

function cacheControlForExt(ext: string): string | undefined {
  if (IMMUTABLE_EXTS.has(ext)) return CACHE_IMMUTABLE;
  if (VERSIONED_EXTS.has(ext)) return CACHE_VERSIONED;
  if (SHORT_TTL_EXTS.has(ext)) return CACHE_HTML;
  return undefined;
}

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
// Single deps-construction path shared by every ask surface (HTTP, MCP tool, CLI). The HTTP server keeps
// references to cache/toolContext/providerRuntime/qualitySignalReport for /health, billing, and the MCP
// transport; the engine reads them through `askEngineDeps`.
// The HTTP server logs engine diagnostics as structured JSON to STDERR, keeping the SSE response stream
// (stdout/the socket) free of diagnostic noise.
const serverLogger = createJsonLogger({ component: 'http' });
const askEngine = createAskEngineDeps({ logger: serverLogger });
const { deps: askEngineDeps, providerRuntime, toolContext, qualitySignalReport, cacheState, cache } = askEngine;
const configuredApiKeys = loadKeysFromEnv(process.env.ACHIOTE_API_KEYS);
const authenticator = createAuthenticator(configuredApiKeys, process.env.ACHIOTE_ENABLE_DEV_AUTH_KEY === 'true');
const rateLimiter = createRateLimiter(process.env.ACHIOTE_RATE_LIMIT_DB);

const billingConfig = loadBillingConfigFromEnv();
const cryptoConfig = loadCryptoConfigFromEnv();
// Crypto checkout carries its own billing rail: the DB (sessions, keys, credits) must exist
// even when Stripe is unconfigured, so the condition is either-or.
const billingDb = billingConfig || cryptoConfig
  ? new BillingDb(process.env.ACHIOTE_BILLING_DB ? resolve(process.env.ACHIOTE_BILLING_DB) : defaultBillingDbPath())
  : null;
const billingStripe = billingConfig ? new BillingStripe(billingConfig) : null;
const cryptoCheckout = cryptoConfig && billingDb ? new CryptoCheckout(cryptoConfig, billingDb) : null;
cryptoCheckout?.start();
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

function telemetryDistinctId(req: IncomingMessage): string {
  return `anon_${createHash('sha256').update(telemetryClientKey(req)).digest('hex').slice(0, 24)}`;
}

async function forwardTelemetryToPostHog(eventName: string, properties: Record<string, string>, req: IncomingMessage): Promise<void> {
  if (POSTHOG_DISABLED || !POSTHOG_PROJECT_API_KEY) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    await fetch(`${POSTHOG_HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: POSTHOG_PROJECT_API_KEY,
        event: eventName,
        properties: {
          ...properties,
          distinct_id: telemetryDistinctId(req),
          $process_person_profile: false,
          $lib: 'achiote-server',
        },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    console.warn('[telemetry] posthog capture failed:', err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timeout);
  }
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

  // Adapt the transport-neutral engine event sink to an SSE frame. The engine already performs the
  // `text`-event boundary sanitization the old `send` closure did, so this writer stays byte-identical.
  const sseAdapter: AskEventSink = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await runAskWorkflow({
      input: { userMessage, history, images: images.value, consent },
      // Reuse the shared engine deps (createAskEngineDeps) and only override the per-request stream guard.
      deps: { ...askEngineDeps, streamClosed: () => res.writableEnded },
      emit: sseAdapter,
    });
  } finally {
    res.end();
  }
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
  // Redirect retired paths so old inbound links don't 404.
  // - /week6: the former competition "proof" page is now "how it works".
  // - /mixology and /for-kitchens: the per-vertical pages were consolidated into
  //   one "for professionals" surface under the single brand.
  const redirects: Record<string, string> = {
    '/week6': '/how-it-works',
    '/mixology': '/for-professionals',
    '/for-kitchens': '/for-professionals',
  };
  if (redirects[raw]) {
    res.writeHead(301, { Location: redirects[raw] });
    res.end();
    return true;
  }
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
    '/meaning': 'meaning.html',
    '/how-it-works': 'how-it-works.html',
    '/for-professionals': 'for-professionals.html',
  };
  const assetPath = routeMap[raw] ?? raw.replace(/^\//, '');
  const filePath = resolve(STATIC_DIR, assetPath);

  if (!filePath.startsWith(resolve(STATIC_DIR) + sep)) return false;

  try {
    const data = await readFile(filePath);
    const ext = assetPath.slice(assetPath.lastIndexOf('.'));
    const contentType = MIME[ext] || 'application/octet-stream';
    const scriptSrc = assetPath === 'billing-success.html' ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'";
    // analytics.js (PostHog) loads the SDK from PostHog's asset host and ships events to its ingestion
    // host. Allow those origins so the snippet works once a real key is set; with the placeholder key
    // it never loads, so this is a no-op in the un-keyed default state.
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Security-Policy': [
        "default-src 'self'",
        `${scriptSrc} https://*.posthog.com`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "media-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "connect-src 'self' https://*.posthog.com",
        "worker-src 'self' blob:",
      ].join('; '),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    };
    const cacheControl = cacheControlForExt(ext);
    if (cacheControl) headers['Cache-Control'] = cacheControl;
    res.writeHead(200, headers);
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

const DOCS_DIR = resolve(__dirname, '..', 'docs');

// Serve the machine-readable API contract. The JSON form is the source of truth (no YAML parser needed);
// the YAML form is a hand-maintained mirror. Both describe /v1/ask and /health.
async function serveOpenApiSpec(_req: IncomingMessage, res: ServerResponse, format: 'json' | 'yaml'): Promise<void> {
  const filePath = resolve(DOCS_DIR, format === 'json' ? 'openapi.json' : 'openapi.yaml');
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': format === 'json' ? 'application/json' : 'application/yaml',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'OpenAPI spec not found' });
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
      void forwardTelemetryToPostHog(eventName, properties, req);
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
      version: '0.2.2',
      authEnabled: AUTH_ENABLED,
      billingEnabled: Boolean(billingConfig),
      cryptoEnabled: Boolean(cryptoCheckout),
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

  // Canonical versioned endpoint. `/ask` (below) stays as a backward-compatible alias for the live site.
  if (pathname === '/v1/ask' && req.method !== 'POST') {
    sendMethodNotAllowed(res, ['POST']);
    return;
  }

  if (pathname === '/v1/ask' && req.method === 'POST') {
    await handleAsk(req, res);
    return;
  }

  if (pathname === '/ask' && (req.method === 'GET' || req.method === 'HEAD')) {
    res.writeHead(303, { Location: '/app' });
    res.end();
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

  if (pathname === '/openapi.json' || pathname === '/openapi.yaml') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendMethodNotAllowed(res, ['GET', 'HEAD']);
      return;
    }
    await serveOpenApiSpec(req, res, pathname === '/openapi.json' ? 'json' : 'yaml');
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

  if (pathname === '/billing/crypto-order' && req.method === 'POST') {
    if (!cryptoCheckout) {
      sendJson(res, 503, { error: 'Crypto payments not configured' });
      return;
    }
    let raw: string;
    try { raw = await readBody(req, 10_000); } catch { sendJson(res, 413, { error: 'Body too large' }); return; }
    let parsed: { tier?: string; mode?: string; asset?: string; billing?: string };
    try { parsed = JSON.parse(raw); } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return; }
    if (parsed.mode && parsed.mode !== 'subscription' && parsed.mode !== 'payment') {
      sendJson(res, 400, { error: 'Invalid checkout mode. Use subscription or payment.' });
      return;
    }
    if (parsed.asset && parsed.asset !== 'sol' && parsed.asset !== 'usdc') {
      sendJson(res, 400, { error: 'Invalid asset. Use sol or usdc.' });
      return;
    }
    if (parsed.billing === 'annual') {
      sendJson(res, 400, { error: 'Annual billing is not supported for crypto checkout.' });
      return;
    }
    const mode: 'subscription' | 'payment' = parsed.mode === 'payment' ? 'payment' : 'subscription';
    const asset: 'sol' | 'usdc' = parsed.asset === 'usdc' ? 'usdc' : 'sol';
    const requestedTier = parsed.tier ?? (mode === 'payment' ? 'memory-pack' : 'personal');
    try {
      const order = await cryptoCheckout.createOrder({ tier: requestedTier, mode, asset });
      sendJson(res, 200, {
        ref: order.ref,
        asset: order.asset,
        address: order.address,
        amount: order.amount,
        uri: order.uri,
        expiresAtMs: order.expiresAtMs,
      });
    } catch (err) {
      if (err instanceof CryptoOrderError) {
        sendJson(res, err.status, { error: err.message });
      } else {
        sendJson(res, 500, { error: err instanceof Error ? err.message : 'Crypto checkout failed' });
      }
    }
    return;
  }

  if (pathname === '/billing/crypto-status' && req.method === 'GET') {
    if (!cryptoCheckout) {
      sendJson(res, 503, { error: 'Crypto payments not configured' });
      return;
    }
    const query = new URL(req.url || '', `http://localhost:${PORT}`).searchParams;
    const ref = query.get('ref')?.trim() ?? '';
    if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(ref)) {
      sendJson(res, 400, { error: 'Invalid order reference' });
      return;
    }
    try {
      const { status, sessionId } = await cryptoCheckout.getOrderStatus(ref);
      sendJson(res, 200, status === 'paid' ? { status, sessionId } : { status });
    } catch (err) {
      if (err instanceof CryptoOrderError) {
        sendJson(res, err.status, { error: err.message });
      } else {
        sendJson(res, 500, { error: err instanceof Error ? err.message : 'Status lookup failed' });
      }
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
    // Crypto orders carry no email: the order ref is the buyer's proof of purchase.
    const isCryptoSession = session.stripeCustomerId?.startsWith('crypto:') === true;
    if (session.stripeCustomerId && !isCryptoSession) {
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
  console.log(`Achiote - http://localhost:${PORT}`);
});

async function shutdown(): Promise<void> {
  await Promise.allSettled([...transports].map(([sid, entry]) => closeMcpSession(sid, entry)));
  cryptoCheckout?.stop();
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
