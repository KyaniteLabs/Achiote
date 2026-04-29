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

function spawnAchioteServer(port: number, openAiBaseUrl: string, env?: Record<string, string>): Promise<ChildProcess> {
  const server = spawn('node', [resolve('dist/http-server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      ACHIOTE_AUTH_ENABLED: 'false',
      ACHIOTE_ALLOW_ANON_ASK: 'true',
      ACHIOTE_ASK_PROVIDER: 'openai',
      OPENAI_BASE_URL: openAiBaseUrl,
      OPENAI_MODEL: 'fake-openai-model',
      OPENAI_API_KEY: 'test-openai-key',
      OPENAI_TIMEOUT_MS: '30000',
      ACHIOTE_RATE_LIMIT_DB: '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise((resolveServer, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 10_000);
    server.stdout?.on('data', (data: Buffer) => {
      if (data.toString().includes(`localhost:${port}`)) {
        clearTimeout(timeout);
        resolveServer(server);
      }
    });
    server.once('error', reject);
  });
}

describe('/ask failure surface regressions', () => {
  let achiote: ChildProcess | undefined;
  let fakeOpenAi: Server | undefined;

  afterEach(async () => {
    achiote?.kill('SIGINT');
    achiote = undefined;
    if (fakeOpenAi) {
      fakeOpenAi.closeAllConnections();
      await new Promise<void>((resolveClose) => fakeOpenAi?.close(() => resolveClose()));
      fakeOpenAi = undefined;
    }
  });

  it('recovers deterministically when the first provider turn exceeds context', async () => {
    const fakePort = await getFreePort();
    let requestCount = 0;
    fakeOpenAi = createServer(async (req, res) => {
      if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
        res.writeHead(404).end();
        return;
      }
      requestCount++;
      await readBody(req);
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Context length exceeded by the request.' }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi?.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`);

    const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'My grandmother made butter chicken with cashew gravy, butter, cream, whiskey, chicken, and naan. I need nut-free, heart-healthy, halal, vegan, and gluten-free substitutions that keep the soul. Can you adapt it?',
      }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const toolNames = events.filter((event) => event.event === 'tool_call').map((event) => JSON.parse(event.data).name);

    expect(events.some((event) => event.event === 'error')).toBe(false);
    expect(events.some((event) => event.event === 'status' && JSON.parse(event.data).stage === 'deterministic_recovery')).toBe(true);
    expect(toolNames).toEqual(expect.arrayContaining([
      'collect_food_memory',
      'find_sensory_substitutes',
      'generate_minimum_viable_nostalgia',
    ]));
    expect(events.at(-1)?.event).toBe('done');
    expect(JSON.parse(events.at(-1)!.data)).toMatchObject({ guarded: 'explicit_minimum_cue_fallback' });
    expect(requestCount).toBe(1);
  }, 20_000);

  it('continues planned substitutions when the provider stalls after early tools', async () => {
    const fakePort = await getFreePort();
    let requestCount = 0;
    fakeOpenAi = createServer(async (req, res) => {
      if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
        res.writeHead(404).end();
        return;
      }
      requestCount++;
      await readBody(req);
      const toolCalls = requestCount === 1
        ? [
          { id: 'call_1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'Butter chicken with cashew gravy, butter, cream, whiskey, and naan.', userLocation: 'United States' }) } },
          { id: 'call_2', type: 'function', function: { name: 'resolve_dish_name', arguments: JSON.stringify({ input: 'butter chicken' }) } },
        ]
        : undefined;
      if (!toolCalls) return;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: toolCalls } }],
      }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi?.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`, { ACHIOTE_FINAL_SYNTHESIS_TIMEOUT_MS: '50' });

    const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Butter chicken with cashew gravy, butter, cream, whiskey, and naan. My family needs nut-free, heart-healthy, halal, vegan, and gluten-free substitutions. Can you adapt it?' }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const substituteInputs = events
      .filter((event) => event.event === 'tool_call' && JSON.parse(event.data).name === 'find_sensory_substitutes')
      .map((event) => JSON.parse(event.data).input.ingredient);

    expect(substituteInputs).toHaveLength(5);
    expect(substituteInputs).toEqual(expect.arrayContaining(['cashews', 'butter', 'cream', 'chicken', 'naan']));
    expect(events.some((event) => event.event === 'error')).toBe(false);
    expect(events.at(-1)?.event).toBe('done');
    expect(JSON.parse(events.at(-1)!.data)).toMatchObject({ guarded: 'explicit_minimum_cue_fallback' });
    expect(requestCount).toBe(2);
  }, 20_000);

  it('filters duplicate tool calls while allowing new calls in the same batch', async () => {
    const fakePort = await getFreePort();
    let requestCount = 0;
    fakeOpenAi = createServer(async (req, res) => {
      if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
        res.writeHead(404).end();
        return;
      }
      requestCount++;
      await readBody(req);
      const toolCallsByTurn = [
        [{ id: 'call_1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'Warm sour dill soup with pale chunks.' }) } }],
        [
          { id: 'call_2', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'Warm sour dill soup with pale chunks.' }) } },
          { id: 'call_3', type: 'function', function: { name: 'plan_dish_research', arguments: JSON.stringify({}) } },
        ],
      ];
      const toolCalls = toolCallsByTurn[requestCount - 1];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: 'Planning continued after duplicate filtering.' },
        }],
      }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi?.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`);

    const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Warm sour dill soup with pale chunks. Ask me what matters first.' }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const collectResults = events.filter((event) => event.event === 'tool_result' && JSON.parse(event.data).name === 'collect_food_memory');
    const toolNames = events.filter((event) => event.event === 'tool_call').map((event) => JSON.parse(event.data).name);

    expect(events).toContainEqual(expect.objectContaining({
      event: 'status',
      data: expect.stringContaining('"stage":"tool_loop_detected"'),
    }));
    expect(collectResults).toHaveLength(1);
    expect(toolNames).toContain('plan_dish_research');
    expect(events.some((event) => event.event === 'error')).toBe(false);
    expect(events.at(-1)?.event).toBe('done');
  }, 20_000);

  it('does not run substitution tools for incidental dietary context', async () => {
    const fakePort = await getFreePort();
    let requestCount = 0;
    fakeOpenAi = createServer(async (req, res) => {
      if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
        res.writeHead(404).end();
        return;
      }
      requestCount++;
      await readBody(req);
      const toolCalls = requestCount === 1
        ? [{ id: 'call_1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'My father used to make Syrian lentil soup after his heart attack, no more salt, but I remember lemon and cumin most.' }) } }]
        : undefined;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: 'What texture did the lentils have, and was there browned onion or garlic?' },
        }],
      }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi?.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`);

    const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'My father used to make Syrian lentil soup after his heart attack, no more salt, but I remember lemon and cumin most.' }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const deterministicPlan = events.find((event) => event.event === 'tool_result' && JSON.parse(event.data).name === 'plan_tool_workflow');
    const toolNames = events.filter((event) => event.event === 'tool_call').map((event) => JSON.parse(event.data).name);

    expect(JSON.parse(deterministicPlan!.data).result).toMatchObject({
      detectedIntent: 'nostalgic_memory',
      needsSubstitutions: false,
    });
    expect(toolNames).not.toContain('find_sensory_substitutes');
    expect(events.some((event) => event.event === 'error')).toBe(false);
    expect(events.at(-1)?.event).toBe('done');
  }, 20_000);

  it('sanitizes upstream provider errors before streaming them to browsers', async () => {
    const fakePort = await getFreePort();
    fakeOpenAi = createServer(async (req, res) => {
      if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
        res.writeHead(404).end();
        return;
      }
      await readBody(req);
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        error: 'invalid key sk-live-secret-from-upstream for provider acct_123',
      }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi?.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`);

    const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Warm sour dill soup with pale chunks.' }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const error = events.find((event) => event.event === 'error');

    expect(error).toBeDefined();
    expect(JSON.parse(error!.data)).toMatchObject({
      message: 'The model provider failed while processing this request. Try again shortly, or ask support to check provider configuration.',
      code: 'model_provider_failed',
    });
    expect(error!.data).not.toContain('sk-live-secret-from-upstream');
    expect(error!.data).not.toContain('acct_123');
    expect(error!.data).not.toContain('OpenAI-compatible provider returned');
  }, 20_000);
});
