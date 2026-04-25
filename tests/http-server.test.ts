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
      env: { ...process.env, PORT: String(port), ACHIOTE_AUTH_ENABLED: 'false' },
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
    expect(body).toHaveProperty('activeSessions');
    expect(body).toHaveProperty('memory');
    expect(body).toHaveProperty('uptime');
    expect(typeof body.uptime).toBe('number');
    expect(body.memory).toHaveProperty('heapUsed');
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
    const accepted = await fetch(`${baseUrl}/events`, {
      method: 'POST',
      headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'ask_started',
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
      body: JSON.stringify({ event: 'prompt_text' }),
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
      env: { ...process.env, PORT: String(port), ACHIOTE_AUTH_ENABLED: 'false', ACHIOTE_EVENTS_ADMIN_TOKEN: 'operator-test-token' },
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
      body: JSON.stringify({ event: 'feedback_helpful', properties: { route: '/app', category: 'answer_quality' } }),
    });
    expect(event.status).toBe(202);

    const publicRead = await fetch(`${baseUrl}/events`);
    expect(publicRead.status).toBe(404);

    const operatorRead = await fetch(`${baseUrl}/events`, {
      headers: { Authorization: 'Bearer operator-test-token' },
    });
    expect(operatorRead.status).toBe(200);
    expect(await operatorRead.json()).toEqual({
      counters: { feedback_helpful: 1 },
      breakdowns: { feedback_helpful: { route: { '/app': 1 }, category: { answer_quality: 1 } } },
    });
  });

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
});
