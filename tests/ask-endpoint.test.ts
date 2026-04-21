import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function spawnServer(port: number, authEnabled: string): Promise<ChildProcess> {
  const server = spawn('node', [resolve(ROOT, 'dist/http-server.js')], {
    env: { ...process.env, PORT: String(port), ACHIOTE_AUTH_ENABLED: authEnabled },
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

// Tests that run BEFORE rate limiting in the request pipeline
describe('/ask endpoint — pre-rate-limit guards', () => {
  let server: ChildProcess;
  let baseUrl: string;

  beforeAll(async () => {
    const port = 20000 + Math.floor(Math.random() * 40000);
    baseUrl = `http://127.0.0.1:${port}`;
    server = await spawnServer(port, 'false');
  }, 15000);

  afterAll(() => { server?.kill('SIGINT'); });

  it('returns 415 for wrong content-type', async () => {
    const res = await fetch(`${baseUrl}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'hello',
    });
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toContain('application/json');
  });

  it('returns 413 for body too large', async () => {
    const hugeBody = 'x'.repeat(1_100_000);
    const res = await fetch(`${baseUrl}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: hugeBody,
    });
    expect(res.status).toBe(413);
  });
});

// Tests that run AFTER rate limiting — each gets its own server to avoid quota exhaustion
describe('/ask endpoint — post-rate-limit guards', () => {
  it('returns 400 for invalid JSON', async () => {
    const port = 25000 + Math.floor(Math.random() * 30000);
    const server = await spawnServer(port, 'false');
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
    const port = 25000 + Math.floor(Math.random() * 30000);
    const server = await spawnServer(port, 'false');
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
    const port = 25000 + Math.floor(Math.random() * 30000);
    const server = await spawnServer(port, 'false');
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

describe('/ask endpoint with auth enabled', () => {
  let server: ChildProcess;
  let baseUrl: string;

  beforeAll(async () => {
    const port = 30000 + Math.floor(Math.random() * 30000);
    baseUrl = `http://127.0.0.1:${port}`;
    server = await spawnServer(port, 'true');
  }, 15000);

  afterAll(() => { server?.kill('SIGINT'); });

  it('returns 401 when auth enabled and no key provided', async () => {
    const res = await fetch(`${baseUrl}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('Unauthorized');
  });
});
