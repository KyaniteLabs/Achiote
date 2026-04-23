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

  it('serves static JS with correct MIME type', async () => {
    const res = await fetch(`${baseUrl}/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
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
