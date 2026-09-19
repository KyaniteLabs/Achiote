/**
 * `achiote ask` CLI surface. Drives runAskCommand (the thin adapter over the shared engine) against a
 * fake OpenAI-compatible endpoint, asserting: (1) --json prints a structured final result, and (2) the
 * default streaming mode renders progress and the final prose. The CLI must reach a reconstruction, not
 * an error, the same way the characterization net proves the HTTP path.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { Writable } from 'node:stream';
import { runAskCommand } from '../src/cli-ask.js';
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

function collector(): { stream: Writable; text: () => string } {
  let buf = '';
  const stream = new Writable({
    write(chunk, _enc, cb) { buf += chunk.toString(); cb(); },
  });
  return { stream, text: () => buf };
}

const SAVED_ENV: Record<string, string | undefined> = {};
const ENV_KEYS = ['ACHIOTE_ASK_PROVIDER', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'OPENAI_API_KEY', 'OPENAI_TIMEOUT_MS', 'ACHIOTE_DETERMINISTIC_TOOL_CHAIN'];

describe('achiote ask CLI', () => {
  let fake: Server | undefined;

  beforeEach(() => {
    for (const key of ENV_KEYS) SAVED_ENV[key] = process.env[key];
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      if (SAVED_ENV[key] === undefined) delete process.env[key];
      else process.env[key] = SAVED_ENV[key];
    }
    if (fake) {
      fake.closeAllConnections();
      await new Promise<void>((r) => fake?.close(() => r()));
      fake = undefined;
    }
  });

  async function startFake(content: string): Promise<void> {
    const port = await getFreePort();
    fake = createFakeOpenAi(content);
    await new Promise<void>((r) => fake?.listen(port, '127.0.0.1', r));
    process.env.ACHIOTE_ASK_PROVIDER = 'openai';
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;
    process.env.OPENAI_MODEL = 'fake-openai-model';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.OPENAI_TIMEOUT_MS = '30000';
    process.env.ACHIOTE_DETERMINISTIC_TOOL_CHAIN = 'true';
  }

  it('--json prints a structured final result with answer, status, and toolsRun', async () => {
    await startFake('Here is a warm first taste test for your mole negro memory. Toast a chilhuacle chile against dark chocolate.');
    const out = collector();
    const progress = collector();

    const code = await runAskCommand({
      memory: 'My abuela in Oaxaca made mole negro with chilhuacle chiles. Give me the smallest first taste test.',
      json: true,
      quiet: false,
      out: out.stream,
      progress: progress.stream,
    });

    expect(code).toBe(0);
    const parsed = JSON.parse(out.text());
    expect(parsed.errored).toBe(false);
    expect(typeof parsed.answer).toBe('string');
    expect(parsed.answer).toContain('chilhuacle');
    expect(parsed.toolsRun).toEqual(
      expect.arrayContaining(['collect_food_memory', 'plan_dish_research', 'generate_minimum_viable_nostalgia']),
    );
    expect(parsed.status).toBe('first_test_ready');
    // --json mode prints nothing to the progress stream.
    expect(progress.text()).toBe('');
  }, 25_000);

  it('streaming mode renders progress and the final answer to a TTY-like output', async () => {
    await startFake('Here is a warm first taste test for your mole negro memory. Toast a chilhuacle chile against dark chocolate.');
    const out = collector();
    const progress = collector();

    const code = await runAskCommand({
      memory: 'My abuela in Oaxaca made mole negro with chilhuacle chiles. Give me the smallest first taste test.',
      json: false,
      quiet: false,
      out: out.stream,
      progress: progress.stream,
      forceStream: true,
    });

    expect(code).toBe(0);
    // Progress rendering shows the workflow advancing.
    expect(progress.text()).toContain('Reconstructing your food memory');
    expect(progress.text()).toMatch(/running|done:/);
    // The final answer prints to stdout.
    expect(out.text()).toContain('chilhuacle');
    expect(out.text()).toContain('First tiny taste test');
  }, 25_000);

  it('quiet mode suppresses progress but still prints the answer', async () => {
    await startFake('Here is a warm first taste test for your mole negro memory. Toast a chilhuacle chile against dark chocolate.');
    const out = collector();
    const progress = collector();

    const code = await runAskCommand({
      memory: 'My abuela in Oaxaca made mole negro with chilhuacle chiles. Give me the smallest first taste test.',
      json: false,
      quiet: true,
      out: out.stream,
      progress: progress.stream,
      forceStream: true,
    });

    expect(code).toBe(0);
    expect(progress.text()).toBe('');
    expect(out.text()).toContain('chilhuacle');
  }, 25_000);
});
