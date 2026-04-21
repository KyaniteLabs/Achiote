import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function spawnServer(port: number, env?: Record<string, string>): Promise<ChildProcess> {
  const server = spawn('node', [resolve(ROOT, 'dist/http-server.js')], {
    env: { ...process.env, PORT: String(port), ACHIOTE_AUTH_ENABLED: 'false', ACHIOTE_ALLOW_ANON_ASK: 'true', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 10000);
    server.stdout!.on('data', (data: Buffer) => {
      if (data.toString().includes(`localhost:${port}`)) {
        clearTimeout(timeout);
        resolve(server);
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
}

function randomPort(): number {
  return 35000 + Math.floor(Math.random() * 25000);
}

// ─── CORS edge cases ─────────────────────────────────────────────

describe('CORS edge cases', () => {
  let server: ChildProcess;
  let baseUrl: string;

  beforeAll(async () => {
    const port = randomPort();
    baseUrl = `http://127.0.0.1:${port}`;
    server = await spawnServer(port);
  }, 15000);

  afterAll(() => { server?.kill('SIGINT'); });

  it('OPTIONS preflight returns 204 with CORS headers', async () => {
    const res = await fetch(`${baseUrl}/ask`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type,x-api-key',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy();
    expect(res.headers.get('access-control-allow-methods')).toBeTruthy();
    expect(res.headers.get('access-control-allow-headers')).toBeTruthy();
    expect(await res.text()).toBe('');
  });

  it('allows requests from configured origin', async () => {
    const res = await fetch(`${baseUrl}/health`, {
      headers: { Origin: 'http://localhost:3000' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy();
  });

  it('returns CORS headers even for disallowed origins', async () => {
    const res = await fetch(`${baseUrl}/health`, {
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(res.status).toBe(200);
  });
});

// ─── HTTP method edge cases ───────────────────────────────────────

describe('HTTP method edge cases', () => {
  let server: ChildProcess;
  let baseUrl: string;

  beforeAll(async () => {
    const port = randomPort();
    baseUrl = `http://127.0.0.1:${port}`;
    server = await spawnServer(port);
  }, 15000);

  afterAll(() => { server?.kill('SIGINT'); });

  it('GET /ask returns 404 or method-not-allowed', async () => {
    const res = await fetch(`${baseUrl}/ask`);
    expect([404, 405]).toContain(res.status);
  });

  it('PUT /health returns 405 method not allowed', async () => {
    const res = await fetch(`${baseUrl}/health`, {
      method: 'PUT',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(405);
  });

  it('DELETE / returns 405 method not allowed', async () => {
    const res = await fetch(`${baseUrl}/`, { method: 'DELETE' });
    expect(res.status).toBe(405);
  });

  it('GET /mcp without session returns error', async () => {
    const res = await fetch(`${baseUrl}/mcp`);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('POST /mcp without session returns error', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ─── Path traversal protection ────────────────────────────────────

describe('path traversal protection', () => {
  let server: ChildProcess;
  let baseUrl: string;

  beforeAll(async () => {
    const port = randomPort();
    baseUrl = `http://127.0.0.1:${port}`;
    server = await spawnServer(port);
  }, 15000);

  afterAll(() => { server?.kill('SIGINT'); });

  it('blocks path traversal via /../../etc/passwd', async () => {
    const res = await fetch(`${baseUrl}/../../etc/passwd`);
    expect(res.status).toBe(404);
  });

  it('blocks path traversal via encoded dots', async () => {
    const res = await fetch(`${baseUrl}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`);
    expect(res.status).toBe(404);
  });

  it('blocks double-dot in nested path', async () => {
    const res = await fetch(`${baseUrl}/foo/../../../etc/shadow`);
    expect(res.status).toBe(404);
  });
});

// ─── /ask pre-API-call guards ─────────────────────────────────────

describe('/ask pre-API-call guards', () => {
  it('returns 415 for wrong content-type', async () => {
    const port = randomPort();
    const server = await spawnServer(port);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'hello',
      });
      expect(res.status).toBe(415);
      const body = await res.json();
      expect(body.error).toContain('application/json');
    } finally { server.kill('SIGINT'); }
  });

  it('returns 413 for body too large', async () => {
    const port = randomPort();
    const server = await spawnServer(port);
    try {
      const hugeBody = 'x'.repeat(1_100_000);
      const res = await fetch(`http://127.0.0.1:${port}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: hugeBody,
      });
      expect(res.status).toBe(413);
    } finally { server.kill('SIGINT'); }
  });

  it('returns 400 for invalid JSON', async () => {
    const port = randomPort();
    const server = await spawnServer(port);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json{{{',
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Invalid JSON');
    } finally { server.kill('SIGINT'); }
  });

  it('returns 400 for missing message field', async () => {
    const port = randomPort();
    const server = await spawnServer(port);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notMessage: 'hello' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('message');
    } finally { server.kill('SIGINT'); }
  });

  it('returns 400 for empty message', async () => {
    const port = randomPort();
    const server = await spawnServer(port);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '   ' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('message');
    } finally { server.kill('SIGINT'); }
  });
});

// ─── Auth edge cases ──────────────────────────────────────────────

describe('auth edge cases', () => {
  let server: ChildProcess;
  let baseUrl: string;

  beforeAll(async () => {
    const port = randomPort();
    baseUrl = `http://127.0.0.1:${port}`;
    server = await spawnServer(port, { ACHIOTE_AUTH_ENABLED: 'true' });
  }, 15000);

  afterAll(() => { server?.kill('SIGINT'); });

  it('rejects wrong API key format', async () => {
    const res = await fetch(`${baseUrl}/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'totally-wrong-key',
      },
      body: JSON.stringify({ message: 'hello' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects empty API key', async () => {
    const res = await fetch(`${baseUrl}/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': '',
      },
      body: JSON.stringify({ message: 'hello' }),
    });
    expect(res.status).toBe(401);
  });

  it('health endpoint works without auth even when auth is enabled', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
  });

  it('static files work without auth', async () => {
    const res = await fetch(`${baseUrl}/app.js`);
    expect(res.status).toBe(200);
  });
});

// ─── Static file edge cases ───────────────────────────────────────

describe('static file edge cases', () => {
  let server: ChildProcess;
  let baseUrl: string;

  beforeAll(async () => {
    const port = randomPort();
    baseUrl = `http://127.0.0.1:${port}`;
    server = await spawnServer(port);
  }, 15000);

  afterAll(() => { server?.kill('SIGINT'); });

  it('returns 404 for nonexistent JS file', async () => {
    const res = await fetch(`${baseUrl}/nonexistent.js`);
    expect(res.status).toBe(404);
  });

  it('serves about page', async () => {
    const res = await fetch(`${baseUrl}/about`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('doctype html');
  });

  it('root serves app.html', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Achiote');
  });
});
