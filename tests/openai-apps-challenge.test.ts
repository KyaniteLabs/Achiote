import { describe, expect, it, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFreePort } from './helpers/ports.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PATH = '/.well-known/openai-apps-challenge';

async function boot(extraEnv: Record<string, string>): Promise<{ server: ChildProcess; baseUrl: string }> {
  const port = await getFreePort();
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), ACHIOTE_AUTH_ENABLED: 'false', ACHIOTE_DETERMINISTIC_TOOL_CHAIN: 'false', ...extraEnv };
  if (!('OPENAI_APPS_CHALLENGE_TOKEN' in extraEnv)) delete env.OPENAI_APPS_CHALLENGE_TOKEN;
  const server = spawn('node', [resolve(ROOT, 'dist/http-server.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  await new Promise<void>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('Server startup timeout')), 10000);
    server.stdout!.on('data', (d: Buffer) => { if (d.toString().includes(`localhost:${port}`)) { clearTimeout(timer); ok(); } });
    server.on('error', (e) => { clearTimeout(timer); fail(e); });
  });
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

describe('OpenAI apps domain challenge', () => {
  let server: ChildProcess | undefined;
  afterEach(() => { server?.kill('SIGINT'); server = undefined; });

  it('returns 404 when no token is configured', async () => {
    const booted = await boot({});
    server = booted.server;
    const res = await fetch(`${booted.baseUrl}${PATH}`);
    expect(res.status).toBe(404);
  }, 15000);

  it('serves the configured token as plain text', async () => {
    const booted = await boot({ OPENAI_APPS_CHALLENGE_TOKEN: '  test-token-123  ' });
    server = booted.server;
    const res = await fetch(`${booted.baseUrl}${PATH}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toBe('test-token-123');
    const post = await fetch(`${booted.baseUrl}${PATH}`, { method: 'POST' });
    expect(post.status).toBe(405);
  }, 15000);
});
