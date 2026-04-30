import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFreePort } from './helpers/ports.js';
import { generateApiKey } from '../src/lib/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function spawnServer(port: number, authEnabled: string, env?: Record<string, string>): Promise<ChildProcess> {
  const server = spawn('node', [resolve(ROOT, 'dist/http-server.js')], {
    env: { ...process.env, PORT: String(port), ACHIOTE_AUTH_ENABLED: authEnabled, ...env },
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
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    server = await spawnServer(port, 'false', { ACHIOTE_ALLOW_ANON_ASK: 'true' });
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
    const hugeBody = 'x'.repeat(3_100_000);
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
    const port = await getFreePort();
    const server = await spawnServer(port, 'false', { ACHIOTE_ALLOW_ANON_ASK: 'true' });
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
    const port = await getFreePort();
    const server = await spawnServer(port, 'false', { ACHIOTE_ALLOW_ANON_ASK: 'true' });
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
    const port = await getFreePort();
    const server = await spawnServer(port, 'false', { ACHIOTE_ALLOW_ANON_ASK: 'true' });
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

  it('accepts images without a text message', async () => {
    const port = await getFreePort();
    const server = await spawnServer(port, 'false', { ACHIOTE_ALLOW_ANON_ASK: 'true' });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: ['data:image/jpeg;base64,/9j/4AAQ'] }),
      });
      expect(res.status).toBe(200);
    } finally { server.kill('SIGINT'); }
  });

  it('accepts multiple images that are below the advertised per-image limit', async () => {
    const port = await getFreePort();
    const server = await spawnServer(port, 'false', { ACHIOTE_ALLOW_ANON_ASK: 'true' });
    try {
      const image = `data:image/jpeg;base64,${'A'.repeat(300_000)}`;
      const res = await fetch(`http://127.0.0.1:${port}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: [image, image, image, image] }),
      });
      expect(res.status).toBe(200);
    } finally { server.kill('SIGINT'); }
  }, 15_000);

  it('returns 400 for invalid image format', async () => {
    const port = await getFreePort();
    const server = await spawnServer(port, 'false', { ACHIOTE_ALLOW_ANON_ASK: 'true' });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello', images: ['not-a-data-uri'] }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('data URI');
    } finally { server.kill('SIGINT'); }
  });

  it('returns 400 for unsupported image MIME type', async () => {
    const port = await getFreePort();
    const server = await spawnServer(port, 'false', { ACHIOTE_ALLOW_ANON_ASK: 'true' });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello', images: ['data:image/svg+xml;base64,PHN2Zz4='] }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('unsupported MIME type');
    } finally { server.kill('SIGINT'); }
  });

  it('returns 400 for too many images', async () => {
    const port = await getFreePort();
    const server = await spawnServer(port, 'false', { ACHIOTE_ALLOW_ANON_ASK: 'true' });
    try {
      const images = Array.from({ length: 5 }, () => 'data:image/jpeg;base64,/9j/4AAQ');
      const res = await fetch(`http://127.0.0.1:${port}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello', images }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('maximum 4 images');
    } finally { server.kill('SIGINT'); }
  });
});

describe('/ask endpoint with auth enabled', () => {
  let server: ChildProcess;
  let baseUrl: string;

  beforeAll(async () => {
    const port = await getFreePort();
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

  it('accepts hashed ACHIOTE_API_KEYS env records with a raw x-api-key', async () => {
    const port = await getFreePort();
    const record = generateApiKey('free', 'hashed-env');
    const envRecord = { keyId: record.keyId, keyHash: record.keyHash, tier: record.tier, name: record.name, createdAt: record.createdAt };
    const server = await spawnServer(port, 'true', { ACHIOTE_API_KEYS: JSON.stringify([envRecord]) });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': record.key },
        body: JSON.stringify({ message: '   ' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('message');
    } finally { server.kill('SIGINT'); }
  });

});

describe('/ask endpoint with auth disabled', () => {
  it('requires explicit ACHIOTE_ALLOW_ANON_ASK for anonymous /ask', async () => {
    const port = await getFreePort();
    const server = await spawnServer(port, 'false');
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain('ACHIOTE_ALLOW_ANON_ASK');
    } finally { server.kill('SIGINT'); }
  });

  it('allows anonymous /ask only when ACHIOTE_ALLOW_ANON_ASK=true', async () => {
    const port = await getFreePort();
    const server = await spawnServer(port, 'false', { ACHIOTE_ALLOW_ANON_ASK: 'true' });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '   ' }),
      });
      expect(res.status).toBe(400);
    } finally { server.kill('SIGINT'); }
  });
});
