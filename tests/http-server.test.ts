import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFreePort } from './helpers/ports.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

describe('HTTP server integration', () => {
  let server: ChildProcess;
  let baseUrl: string;
  let port: number;

  beforeAll(async () => {
    port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;

    server = spawn('node', [resolve(ROOT, 'dist/http-server.js')], {
      env: { ...process.env, PORT: String(port), ACHIOTE_AUTH_ENABLED: 'false', ACHIOTE_DETERMINISTIC_TOOL_CHAIN: 'false' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 10000);
      server.stdout!.on('data', (data: Buffer) => {
        if (data.toString().includes(`localhost:${port}`)) {
          clearTimeout(timeout);
          resolve();
        }
      });
      server.stderr!.on('data', (data: Buffer) => {
        if (data.toString().includes('EADDRINUSE')) {
          clearTimeout(timeout);
          reject(new Error(`Port ${port} already in use`));
        }
      });
      server.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }, 15000);

  afterAll(() => {
    server?.kill('SIGINT');
  });

  it('GET /health returns status JSON', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'ok', version: '0.2.0' });
    expect(body).toHaveProperty('authEnabled');
    expect(body).toHaveProperty('billingEnabled');
    expect(body).toHaveProperty('uptime');
    expect(body.provider).toMatchObject({
      kind: 'anthropic',
      provider: 'anthropic',
      nativeTools: 'unknown',
      rateLimitSensitive: false,
    });
    expect(typeof body.uptime).toBe('number');
  });

  it('GET /voice/status reports local OSS speech readiness without requiring auth', async () => {
    const res = await fetch(`${baseUrl}/voice/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      stt: { provider: 'disabled', ready: false, reason: 'speech-to-text is disabled', language: 'auto', languages: ['auto'] },
      tts: { provider: 'disabled', ready: false, reason: 'text-to-speech is disabled', mediaType: 'audio/wav' },
    });
  });

  it('requires the ask auth gate before accepting voice audio uploads', async () => {
    const res = await fetch(`${baseUrl}/voice/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioBase64: Buffer.from('tiny').toString('base64'),
        mediaType: 'audio/wav',
        language: 'auto',
      }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('ACHIOTE_ALLOW_ANON_ASK');
  });

  it('returns 503 for local transcription until a ready OSS backend is configured', async () => {
    server.kill('SIGINT');
    await new Promise((resolve) => server.once('exit', resolve));

    port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;

    server = spawn('node', [resolve(ROOT, 'dist/http-server.js')], {
      env: { ...process.env, PORT: String(port), ACHIOTE_AUTH_ENABLED: 'false', ACHIOTE_ALLOW_ANON_ASK: 'true', ACHIOTE_DETERMINISTIC_TOOL_CHAIN: 'false' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server restart timeout')), 10000);
      server.stdout!.on('data', (data: Buffer) => {
        if (data.toString().includes(`localhost:${port}`)) {
          clearTimeout(timeout);
          resolve();
        }
      });
      server.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    const res = await fetch(`${baseUrl}/voice/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioBase64: Buffer.from('tiny').toString('base64'),
        mediaType: 'audio/wav',
        language: 'es',
      }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain('speech-to-text is disabled');
  }, 20_000);

  it('rejects unsupported voice audio payloads before invoking a backend', async () => {
    const res = await fetch(`${baseUrl}/voice/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioBase64: Buffer.from('tiny').toString('base64'),
        mediaType: 'video/mp4',
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Unsupported audio media type');
  });

  it('returns 503 for local speech synthesis until a ready OSS backend is configured', async () => {
    const res = await fetch(`${baseUrl}/voice/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Read this cue back in the family language.',
        language: 'es',
      }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain('text-to-speech is disabled');
  });

  it('GET / returns app.html', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('doctype html');
  });

  it('GET /app returns app.html', async () => {
    const res = await fetch(`${baseUrl}/app`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('serves trust, launch-support, and AI-search routes with security headers', async () => {
    for (const path of ['/privacy', '/privacy/', '/terms', '/terms/', '/support', '/support/', '/safety', '/safety/', '/ai-search', '/ai-search/']) {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(res.headers.get('content-security-policy')).toContain("object-src 'none'");
      expect(res.headers.get('content-security-policy')).toContain("media-src 'self' data:");
      expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    }
  });

  it('serves llms.txt as text/plain for AI retrieval', async () => {
    const res = await fetch(`${baseUrl}/llms.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toContain('food-memory reconstruction');
  });

  it('serves static JS with correct MIME type', async () => {
    const res = await fetch(`${baseUrl}/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
  });

  it('accepts only same-origin allowlisted telemetry events and keeps counters private', async () => {
    const optedOut = await fetch(`${baseUrl}/events`, {
      method: 'POST',
      headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'ask_started',
        properties: { route: '/app', source: 'typed' },
      }),
    });
    expect(optedOut.status).toBe(202);
    expect(await optedOut.json()).toEqual({ ok: true, skipped: 'analytics_consent_required' });

    const accepted = await fetch(`${baseUrl}/events`, {
      method: 'POST',
      headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'ask_started',
        consent: { analytics: true },
        properties: { route: '/app', source: 'typed', prompt_text: 'should_not_be_stored', tier: 'personal' },
        prompt_text: 'should_not_be_stored',
      }),
    });
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toEqual({ ok: true });

    const rejectedOrigin = await fetch(`${baseUrl}/events`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'ask_started' }),
    });
    expect(rejectedOrigin.status).toBe(403);

    const rejectedEvent = await fetch(`${baseUrl}/events`, {
      method: 'POST',
      headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'prompt_text', consent: { analytics: true } }),
    });
    expect(rejectedEvent.status).toBe(400);

    const counters = await fetch(`${baseUrl}/events`);
    expect(counters.status).toBe(404);
  });

  it('exposes telemetry counters only with the operator token', async () => {
    server.kill('SIGINT');
    await new Promise((resolve) => server.once('exit', resolve));

    port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;

    server = spawn('node', [resolve(ROOT, 'dist/http-server.js')], {
      env: { ...process.env, PORT: String(port), ACHIOTE_AUTH_ENABLED: 'false', ACHIOTE_EVENTS_ADMIN_TOKEN: 'operator-test-token', ACHIOTE_DETERMINISTIC_TOOL_CHAIN: 'false' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server restart timeout')), 10000);
      server.stdout!.on('data', (data: Buffer) => {
        if (data.toString().includes(`localhost:${port}`)) {
          clearTimeout(timeout);
          resolve();
        }
      });
      server.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    const event = await fetch(`${baseUrl}/events`, {
      method: 'POST',
      headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'feedback_close', consent: { analytics: true }, properties: { route: '/app', category: 'answer_quality' } }),
    });
    expect(event.status).toBe(202);

    const publicRead = await fetch(`${baseUrl}/events`);
    expect(publicRead.status).toBe(404);

    const operatorRead = await fetch(`${baseUrl}/events`, {
      headers: { Authorization: 'Bearer operator-test-token' },
    });
    expect(operatorRead.status).toBe(200);
    expect(await operatorRead.json()).toEqual({
      counters: { feedback_close: 1 },
      breakdowns: { feedback_close: { route: { '/app': 1 }, category: { answer_quality: 1 } } },
      quality: {
        total: 0,
        byMemoryType: {},
        byFamily: {},
        byRegion: {},
        byGuard: {},
        bySearch: {},
        byCache: {},
        missing: {},
      },
      referenceSeeds: {
        priorities: [],
        cacheWarmingTasks: [],
        coverage: expect.objectContaining({
          axes: expect.objectContaining({
            foodForms: expect.objectContaining({ covered: expect.any(Number), total: expect.any(Number) }),
          }),
        }),
        sourcePolicy: expect.objectContaining({
          allowedFixtureSources: expect.arrayContaining([
            expect.objectContaining({ id: 'wikidata-structured-food-data', licenseId: 'CC0-1.0' }),
            expect.objectContaining({ id: 'usda-fooddata-central', licenseId: 'CC0-1.0' }),
          ]),
          manualReviewSources: expect.arrayContaining([
            expect.objectContaining({ id: 'open-food-facts-products', licenseId: 'ODbL-1.0' }),
            expect.objectContaining({ id: 'fao-infoods-food-composition' }),
          ]),
          disallowedPatterns: expect.arrayContaining(['copied recipe instructions or article prose']),
        }),
      },
    });

    for (let i = 0; i < 30; i += 1) {
      const cardinalityEvent = await fetch(`${baseUrl}/events`, {
        method: 'POST',
        headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'feedback_too_hard', consent: { analytics: true }, properties: { route: '/app', category: `segment-${i}` } }),
      });
      expect(cardinalityEvent.status).toBe(202);
    }

    const boundedRead = await fetch(`${baseUrl}/events`, {
      headers: { Authorization: 'Bearer operator-test-token' },
    });
    const boundedBody = await boundedRead.json();
    expect(Object.keys(boundedBody.breakdowns.feedback_too_hard.category)).toHaveLength(25);
    expect(boundedBody.breakdowns.feedback_too_hard.category.other).toBe(6);
    expect(boundedBody.breakdowns.feedback_too_hard.route).toEqual({ '/app': 30 });
  }, 15_000);

  it('returns 404 for unknown paths', async () => {
    const res = await fetch(`${baseUrl}/nonexistent-path-xyz`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('sets CORS headers', async () => {
    const res = await fetch(`${baseUrl}/health`, {
      headers: { Origin: 'http://localhost:3000' },
    });
    const acao = res.headers.get('access-control-allow-origin');
    expect(acao).toBeTruthy();
  });

  it('GET /mcp without session returns error', async () => {
    const res = await fetch(`${baseUrl}/mcp`);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('returns 503 for billing endpoints when billing is not configured', async () => {
    const checkout = await fetch(`${baseUrl}/billing/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(checkout.status).toBe(503);

    const portal = await fetch(`${baseUrl}/billing/portal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(portal.status).toBe(503);

    const webhook = await fetch(`${baseUrl}/billing/webhook`, { method: 'POST' });
    expect(webhook.status).toBe(503);

    const session = await fetch(`${baseUrl}/billing/session?session_id=test`);
    expect(session.status).toBe(503);
  });
});

describe('HTTP server billing integration', () => {
  let server: ChildProcess;
  let baseUrl: string;
  let port: number;

  beforeAll(async () => {
    port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;

    server = spawn('node', [resolve(ROOT, 'dist/http-server.js')], {
      env: {
        ...process.env,
        PORT: String(port),
        ACHIOTE_AUTH_ENABLED: 'false',
        ACHIOTE_DETERMINISTIC_TOOL_CHAIN: 'false',
        STRIPE_SECRET_KEY: 'sk_test_dummy',
        STRIPE_WEBHOOK_SECRET: 'whsec_dummy_secret_for_testing_only',
        STRIPE_PERSONAL_PRICE_ID: 'price_test',
        ACHIOTE_KEY_ENCRYPTION_KEY: '0'.repeat(64),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 10000);
      server.stdout!.on('data', (data: Buffer) => {
        if (data.toString().includes(`localhost:${port}`)) {
          clearTimeout(timeout);
          resolve();
        }
      });
      server.stderr!.on('data', (data: Buffer) => {
        if (data.toString().includes('EADDRINUSE')) {
          clearTimeout(timeout);
          reject(new Error(`Port ${port} already in use`));
        }
      });
      server.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }, 15000);

  afterAll(() => {
    server?.kill('SIGINT');
  });

  it('rejects webhook requests without stripe-signature header', async () => {
    const res = await fetch(`${baseUrl}/billing/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Missing stripe-signature/);
  });

  it('rejects webhook requests with invalid stripe-signature', async () => {
    const res = await fetch(`${baseUrl}/billing/webhook`, {
      method: 'POST',
      headers: { 'stripe-signature': 'invalid_signature', 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Webhook processing failed|No signatures found|Unable to extract timestamp/);
  });

  it('rejects checkout with invalid tier', async () => {
    const res = await fetch(`${baseUrl}/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'invalid-tier', mode: 'subscription' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid tier/);
  });

  it('rejects checkout with invalid mode', async () => {
    const res = await fetch(`${baseUrl}/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'personal', mode: 'invalid' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid checkout mode/);
  });
});
