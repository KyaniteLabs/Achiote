/**
 * API hardening: the canonical /v1/ask route, the /ask backward-compat alias, API-key auth on a
 * non-demo programmatic request, and the published OpenAPI contract. Spawns the real built server
 * (dist/http-server.js) against a fake OpenAI endpoint, mirroring the characterization net harness.
 *
 * Prerequisite: `npm run build` must run first (drives dist/http-server.js), same as the sibling
 * subprocess suites.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { getFreePort } from './helpers/ports.js';

function readBody(req: Parameters<Parameters<typeof createServer>[0]>[0]): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function createFakeOpenAi(content: string): Server {
  return createServer(async (req, res) => {
    if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    await readBody(req);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }] }));
  });
}

function spawnServer(port: number, openAiBaseUrl: string, env: Record<string, string> = {}): Promise<ChildProcess> {
  const server = spawn('node', [resolve('dist/http-server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      ACHIOTE_ASK_PROVIDER: 'openai',
      OPENAI_BASE_URL: openAiBaseUrl,
      OPENAI_MODEL: 'fake-openai-model',
      OPENAI_API_KEY: 'test-openai-key',
      OPENAI_TIMEOUT_MS: '30000',
      ACHIOTE_RATE_LIMIT_DB: '',
      ACHIOTE_DETERMINISTIC_TOOL_CHAIN: 'true',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolveServer, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => { server.kill('SIGINT'); reject(new Error(`startup timeout${stderr ? `: ${stderr.slice(-800)}` : ''}`)); }, 30_000);
    server.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    server.stdout?.on('data', (d: Buffer) => {
      if (d.toString().includes(`localhost:${port}`)) { clearTimeout(timeout); resolveServer(server); }
    });
    server.once('error', (err) => { clearTimeout(timeout); reject(err); });
  });
}

const ASK_BODY = JSON.stringify({
  message: 'My abuela in Oaxaca made mole negro with chilhuacle chiles. Give me the smallest first taste test.',
});

describe('API versioning and auth', () => {
  let achiote: ChildProcess | undefined;
  let fake: Server | undefined;

  async function startFake(content: string): Promise<number> {
    const port = await getFreePort();
    fake = createFakeOpenAi(content);
    await new Promise<void>((r) => fake?.listen(port, '127.0.0.1', r));
    return port;
  }

  afterEach(async () => {
    achiote?.kill('SIGINT');
    achiote = undefined;
    if (fake) {
      fake.closeAllConnections();
      await new Promise<void>((r) => fake?.close(() => r()));
      fake = undefined;
    }
  });

  it('serves /v1/ask as the canonical route and /ask as an alias with identical SSE shape (anon demo)', async () => {
    const fakePort = await startFake('Here is a warm first taste test. Toast a chilhuacle chile against dark chocolate.');
    const port = await getFreePort();
    achiote = await spawnServer(port, `http://127.0.0.1:${fakePort}/v1`, {
      ACHIOTE_AUTH_ENABLED: 'false',
      ACHIOTE_ALLOW_ANON_ASK: 'true',
    });

    const headers = { 'Content-Type': 'application/json' };
    const v1 = await fetch(`http://127.0.0.1:${port}/v1/ask`, { method: 'POST', headers, body: ASK_BODY });
    const legacy = await fetch(`http://127.0.0.1:${port}/ask`, { method: 'POST', headers, body: ASK_BODY });

    expect(v1.status).toBe(200);
    expect(legacy.status).toBe(200);
    expect(v1.headers.get('content-type')).toContain('text/event-stream');
    expect(legacy.headers.get('content-type')).toContain('text/event-stream');

    const v1Text = await v1.text();
    const legacyText = await legacy.text();

    // Both surface the same event vocabulary and reach a clean done.
    for (const text of [v1Text, legacyText]) {
      expect(text).toContain('event: tool_call');
      expect(text).toContain('event: text');
      expect(text).toContain('event: done');
      expect(text).not.toContain('event: error');
      expect(text).toContain('chilhuacle');
    }

    // Method guard: GET /v1/ask is not allowed (it is a programmatic POST endpoint).
    const getV1 = await fetch(`http://127.0.0.1:${port}/v1/ask`, { method: 'GET' });
    expect(getV1.status).toBe(405);
  }, 30_000);

  it('rejects a non-demo programmatic request with a bad API key and accepts a valid one', async () => {
    const fakePort = await startFake('Here is a warm first taste test. Toast a chilhuacle chile against dark chocolate.');
    const port = await getFreePort();
    // Auth enabled, no demo password, no anon ask: this is the programmatic API posture. The built-in dev
    // key (ach_dev_test_only) is enabled via ACHIOTE_ENABLE_DEV_AUTH_KEY when no real keys are configured.
    achiote = await spawnServer(port, `http://127.0.0.1:${fakePort}/v1`, {
      ACHIOTE_AUTH_ENABLED: 'true',
      ACHIOTE_ALLOW_ANON_ASK: 'true',
      ACHIOTE_ENABLE_DEV_AUTH_KEY: 'true',
    });

    // Missing key -> 401.
    const noKey = await fetch(`http://127.0.0.1:${port}/v1/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: ASK_BODY,
    });
    expect(noKey.status).toBe(401);

    // Bad bearer key -> 401.
    const badKey = await fetch(`http://127.0.0.1:${port}/v1/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ach_not_a_real_key' },
      body: ASK_BODY,
    });
    expect(badKey.status).toBe(401);

    // Valid bearer key -> 200 SSE.
    const goodKey = await fetch(`http://127.0.0.1:${port}/v1/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ach_dev_test_only' },
      body: ASK_BODY,
    });
    expect(goodKey.status).toBe(200);
    expect(goodKey.headers.get('content-type')).toContain('text/event-stream');
    const goodText = await goodKey.text();
    expect(goodText).toContain('event: done');

    // Same valid key via x-api-key header also works.
    const apiKeyHeader = await fetch(`http://127.0.0.1:${port}/v1/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'ach_dev_test_only' },
      body: ASK_BODY,
    });
    expect(apiKeyHeader.status).toBe(200);
  }, 30_000);

  it('publishes a machine-readable OpenAPI 3.1 contract at /openapi.json and /openapi.yaml', async () => {
    const fakePort = await startFake('warm cue');
    const port = await getFreePort();
    achiote = await spawnServer(port, `http://127.0.0.1:${fakePort}/v1`, {
      ACHIOTE_AUTH_ENABLED: 'false',
      ACHIOTE_ALLOW_ANON_ASK: 'true',
    });

    const json = await fetch(`http://127.0.0.1:${port}/openapi.json`);
    expect(json.status).toBe(200);
    expect(json.headers.get('content-type')).toContain('application/json');
    const spec = await json.json() as { openapi?: string; paths?: Record<string, unknown> };
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.paths?.['/v1/ask']).toBeDefined();
    expect(spec.paths?.['/health']).toBeDefined();

    const yaml = await fetch(`http://127.0.0.1:${port}/openapi.yaml`);
    expect(yaml.status).toBe(200);
    expect(yaml.headers.get('content-type')).toContain('yaml');
    const yamlText = await yaml.text();
    expect(yamlText).toContain('openapi: 3.1.0');
    expect(yamlText).toContain('/v1/ask');
  }, 30_000);
});
