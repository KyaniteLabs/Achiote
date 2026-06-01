import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { getFreePort } from './helpers/ports.js';

function readBody(req: Parameters<typeof createServer>[0] extends (req: infer R, res: infer S) => void ? R : never): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseSse(text: string): Array<{ event?: string; data: string }> {
  return text.split('\n\n').filter(Boolean).map((block) => ({
    event: block.split('\n').find((line) => line.startsWith('event: '))?.slice(7),
    data: block.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n'),
  }));
}

function spawnAchioteServer(port: number, openAiBaseUrl: string): Promise<ChildProcess> {
  const server = spawn('node', [resolve('dist/http-server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      ACHIOTE_AUTH_ENABLED: 'false',
      ACHIOTE_ALLOW_ANON_ASK: 'true',
      ACHIOTE_ASK_PROVIDER: 'openai',
      ACHIOTE_DETERMINISTIC_TOOL_CHAIN: 'true',
      OPENAI_BASE_URL: openAiBaseUrl,
      OPENAI_MODEL: 'fake-openai-model',
      OPENAI_API_KEY: 'test-openai-key',
      OPENAI_TIMEOUT_MS: '30000',
      ACHIOTE_RATE_LIMIT_DB: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise((resolveServer, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => {
      server.kill('SIGINT');
      reject(new Error(`Server startup timeout${stderr ? `: ${stderr.slice(-1000)}` : ''}`));
    }, 30_000);
    server.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    server.stdout?.on('data', (data: Buffer) => {
      if (data.toString().includes(`localhost:${port}`)) {
        clearTimeout(timeout);
        resolveServer(server);
      }
    });
    server.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

describe('/ask deterministic planned tool chain', () => {
  let fakeOpenAi: Server | undefined;
  let achiote: ChildProcess | undefined;

  afterEach(async () => {
    achiote?.kill('SIGINT');
    achiote = undefined;
    if (fakeOpenAi) {
      fakeOpenAi.closeAllConnections();
      await new Promise<void>((resolveClose) => fakeOpenAi?.close(() => resolveClose()));
      fakeOpenAi = undefined;
    }
  });

  it('runs the planned tools before a single model synthesis call', async () => {
    const fakePort = await getFreePort();
    const requestBodies: Array<{ messages?: Array<{ role?: string; content?: unknown }>; tools?: unknown[] }> = [];
    fakeOpenAi = createServer(async (req, res) => {
      if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
        res.writeHead(404).end();
        return;
      }
      requestBodies.push(JSON.parse(await readBody(req)));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'Final synthesized receipt from the completed minimum cue case file.',
          },
        }],
      }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi?.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`);

    const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'My aunt made cachapas with queso de mano, family from Caracas. Give me the smallest first taste test.',
      }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const toolNames = events
      .filter((event) => event.event === 'tool_call')
      .map((event) => JSON.parse(event.data).name);

    expect(toolNames).toEqual(expect.arrayContaining([
      'plan_tool_workflow',
      'collect_food_memory',
      'plan_dish_research',
      'build_reconstruction_dossier',
      'generate_minimum_viable_nostalgia',
    ]));
    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0].tools).toBeUndefined();
    expect(JSON.stringify(requestBodies[0].messages)).toContain('Achiote compact case file');
    expect(JSON.stringify(requestBodies[0].messages)).toContain('minimum_cue_ready');
    expect(events.find((event) => event.event === 'text')?.data).toContain('Final synthesized receipt');
  });

  it('falls back out of deterministic cue generation for idiomatic allergy reactions', async () => {
    const fakePort = await getFreePort();
    const requestBodies: Array<{ tools?: unknown[] }> = [];
    fakeOpenAi = createServer(async (req, res) => {
      if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
        res.writeHead(404).end();
        return;
      }
      requestBodies.push(JSON.parse(await readBody(req)));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'I need the region and one sensory detail before narrowing this seafood rice memory.',
          },
        }],
      }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi?.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`);

    const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'my dad made a seafood rice dish, but shrimp and crab make me swell up. help me recreate it.',
      }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const toolNames = events
      .filter((event) => event.event === 'tool_call')
      .map((event) => JSON.parse(event.data).name);
    const statusEvents = events
      .filter((event) => event.event === 'status')
      .map((event) => JSON.parse(event.data));
    const finalText = events
      .filter((event) => event.event === 'text')
      .map((event) => JSON.parse(event.data))
      .join('\n\n');
    const receipt = events.find((event) => event.event === 'receipt');

    expect(statusEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'deterministic_tool_chain_fallback', reason: 'safety_constraints' }),
    ]));
    expect(requestBodies.length).toBeGreaterThan(0);
    expect(requestBodies[0].tools).toBeDefined();
    expect(toolNames).not.toContain('generate_minimum_viable_nostalgia');
    expect(finalText).toContain('qualified professional');
    expect(finalText).not.toMatch(/\bsafe\b|\bsafely\b|\bsafety note\b/i);
    expect(finalText).not.toMatch(/\b(?:taste|try|buy|use|add|cook|simmer|toast|saute|sauté|source|get)\b[^.\n]{0,100}\b(?:shrimp|crab|shellfish|prawn|lobster|crayfish|crawfish)\b/i);
    if (receipt) {
      expect(receipt.data).not.toMatch(/first_test_ready|firstTinyTasteTest/i);
    }
  });

  it('does not mark rich unnamed memories as first-test-ready before narrowing questions', async () => {
    const fakePort = await getFreePort();
    fakeOpenAi = createServer(async (req, res) => {
      if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
        res.writeHead(404).end();
        return;
      }
      await readBody(req);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'I have enough to give a first tiny check. Take a spoonful of plain porridge and add a sour splash. What country, language, or community was this tied to?',
          },
        }],
      }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi?.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`);

    const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'thick sour fermented porridge, steamed in a banana leaf, grayish savory, served at funerals. I never knew the name.',
      }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const toolNames = events
      .filter((event) => event.event === 'tool_call')
      .map((event) => JSON.parse(event.data).name);
    const receipt = events.find((event) => event.event === 'receipt');
    const finalText = events
      .filter((event) => event.event === 'text')
      .map((event) => JSON.parse(event.data))
      .join('\n\n');

    expect(toolNames).not.toContain('generate_minimum_viable_nostalgia');
    expect(finalText).toMatch(/\?/);
    expect(finalText).not.toMatch(/first tiny check|take a spoonful/i);
    if (receipt) {
      expect(receipt.data).not.toMatch(/first_test_ready|firstTinyTasteTest/i);
    }
  });
});
