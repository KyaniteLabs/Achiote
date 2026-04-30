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
    const finalText = events
      .filter((event) => event.event === 'text')
      .map((event) => JSON.parse(event.data))
      .join('\n\n');
    expect(events.at(-1)?.event).toBe('done');
    expect(JSON.parse(events.at(-1)!.data)).toMatchObject({ guarded: 'explicit_minimum_cue_fallback' });
    expect(finalText).not.toMatch(/\b(?:\d+\s*(?:cups?|tbsp|tablespoons?|teaspoons?|tsp|minutes?|mins?|servings?)|one-cup|half-cup|recipe)\b/i);
    expect(finalText).not.toMatch(/amount of (?:small amount|tiny)\b/i);
    expect(requestCount).toBe(1);
  }, 20_000);

  it('recovers deterministically from llama.cpp n_keep/n_ctx context errors', async () => {
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
      res.end(JSON.stringify({
        error: 'The number of tokens to keep from the initial prompt is greater than the context length (n_keep: 4166>= n_ctx: 4096). Try to load the model with a larger context length, or provide a shorter input.',
      }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi?.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`);

    const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'I remember a warm sour soup with dill and soft pale chunks. I do not know the name. Give me the smallest first-pass cue, not a full recipe.',
      }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const toolNames = events.filter((event) => event.event === 'tool_call').map((event) => JSON.parse(event.data).name);

    expect(events.some((event) => event.event === 'error')).toBe(false);
    expect(events.some((event) => event.event === 'status' && JSON.parse(event.data).stage === 'deterministic_recovery')).toBe(true);
    expect(toolNames).toEqual(expect.arrayContaining([
      'collect_food_memory',
      'plan_dish_research',
      'build_reconstruction_dossier',
      'generate_minimum_viable_nostalgia',
    ]));
    expect(events.at(-1)?.event).toBe('done');
    expect(JSON.parse(events.at(-1)!.data)).toMatchObject({ guarded: 'explicit_minimum_cue_fallback' });
    expect(requestCount).toBe(1);
  }, 20_000);

  it('forces a minimum sip cue for code-switched beverage memories after llama.cpp context errors', async () => {
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
      res.end(JSON.stringify({
        error: 'The number of tokens to keep from the initial prompt is greater than the context length (n_keep: 4166>= n_ctx: 4096). Try to load the model with a larger context length, or provide a shorter input.',
      }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi?.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`);

    const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Mi abuela made una bebida fria de arroz con canela, muy ligera, served over ice. Give me the smallest sip cue.',
      }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const toolNames = events.filter((event) => event.event === 'tool_call').map((event) => JSON.parse(event.data).name);

    expect(events.some((event) => event.event === 'error')).toBe(false);
    expect(events.some((event) => event.event === 'status' && JSON.parse(event.data).stage === 'deterministic_recovery')).toBe(true);
    expect(toolNames).toEqual(expect.arrayContaining([
      'collect_food_memory',
      'plan_dish_research',
      'generate_minimum_viable_nostalgia',
    ]));
    expect(events.at(-1)?.event).toBe('done');
    expect(JSON.parse(events.at(-1)!.data)).toMatchObject({ guarded: 'explicit_minimum_cue_fallback' });
    expect(requestCount).toBe(1);
  }, 20_000);

  it('treats tiny sip cue requests as explicit minimum-cue requests after llama.cpp context errors', async () => {
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
      res.end(JSON.stringify({
        error: 'The number of tokens to keep from the initial prompt is greater than the context length (n_keep: 4166>= n_ctx: 4096). Try to load the model with a larger context length, or provide a shorter input.',
      }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi?.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`);

    const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'The label in my memory says arroz, canela, hielo, maybe vainilla. Please reconstruct only from my memory and give a tiny sip cue.',
      }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const toolNames = events.filter((event) => event.event === 'tool_call').map((event) => JSON.parse(event.data).name);

    expect(events.some((event) => event.event === 'error')).toBe(false);
    expect(events.some((event) => event.event === 'status' && JSON.parse(event.data).stage === 'deterministic_recovery')).toBe(true);
    expect(toolNames).toEqual(expect.arrayContaining([
      'collect_food_memory',
      'plan_dish_research',
      'generate_minimum_viable_nostalgia',
    ]));
    expect(events.at(-1)?.event).toBe('done');
    expect(JSON.parse(events.at(-1)!.data)).toMatchObject({ guarded: 'explicit_minimum_cue_fallback' });
    expect(requestCount).toBe(1);
  }, 20_000);

  it('recovers deterministically from local provider 5xx errors before the first model turn', async () => {
    const fakePort = await getFreePort();
    let requestCount = 0;
    fakeOpenAi = createServer(async (req, res) => {
      if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
        res.writeHead(404).end();
        return;
      }
      requestCount++;
      await readBody(req);
      res.writeHead(500, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>Error</title><pre>Internal Server Error</pre>');
    });
    await new Promise<void>((resolveListen) => fakeOpenAi?.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`);

    const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Please do not claim you browsed. I remember a toasted corn drink with cinnamon from a street cart. What is the smallest memory test?',
      }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const toolNames = events.filter((event) => event.event === 'tool_call').map((event) => JSON.parse(event.data).name);

    expect(events.some((event) => event.event === 'error')).toBe(false);
    expect(events.some((event) => event.event === 'status' && JSON.parse(event.data).stage === 'deterministic_recovery')).toBe(true);
    expect(toolNames).toEqual(expect.arrayContaining([
      'collect_food_memory',
      'plan_dish_research',
      'generate_minimum_viable_nostalgia',
    ]));
    expect(events.at(-1)?.event).toBe('done');
    expect(JSON.parse(events.at(-1)!.data)).toMatchObject({ guarded: 'explicit_minimum_cue_fallback' });
    expect(requestCount).toBe(1);
  }, 20_000);

  it('clarifies broad uncertain memories after provider recovery instead of forcing a generic tiny cue', async () => {
    const fakePort = await getFreePort();
    fakeOpenAi = createServer(async (req, res) => {
      if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
        res.writeHead(404).end();
        return;
      }
      await readBody(req);
      res.writeHead(500, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>Error</title><pre>Internal Server Error</pre>');
    });
    await new Promise<void>((resolveListen) => fakeOpenAi?.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`);

    const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'My abuela made something sour and herby, maybe green, but I do not know the country, dish name, ingredients, or whether it was soup, sauce, or stew. Do not list candidate dishes; ask only what is needed or give a safe tiny cue if you have enough.',
      }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const toolNames = events.filter((event) => event.event === 'tool_call').map((event) => JSON.parse(event.data).name);
    const finalText = events
      .filter((event) => event.event === 'text')
      .map((event) => JSON.parse(event.data))
      .join('\n\n');

    expect(events.some((event) => event.event === 'error')).toBe(false);
    expect(toolNames).not.toContain('generate_minimum_viable_nostalgia');
    expect(finalText).toMatch(/\b(?:one more detail|need one|do not fake certainty|specific rather than generic)\b/i);
    expect(events.at(-1)?.event).toBe('done');
    expect(JSON.parse(events.at(-1)!.data)).toMatchObject({ guarded: 'provider_context_deterministic_recovery' });
  }, 20_000);

  it('strips model-invented user locations from memory collection tool input', async () => {
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
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: {
                name: 'collect_food_memory',
                arguments: JSON.stringify({
                  memoryText: 'Warm sour soup with dill and soft pale chunks.',
                  userLocation: 'Sichuan, China',
                }),
              },
            }],
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
        message: 'I remember a warm sour soup with dill and soft pale chunks. I do not know the country or name.',
      }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const collectCall = events
      .filter((event) => event.event === 'tool_call')
      .map((event) => JSON.parse(event.data))
      .find((event) => event.name === 'collect_food_memory');
    const collectResult = events
      .filter((event) => event.event === 'tool_result')
      .map((event) => JSON.parse(event.data))
      .find((event) => event.name === 'collect_food_memory')?.result;

    expect(collectCall?.input).not.toHaveProperty('userLocation');
    expect(collectResult?.userLocation).toBeUndefined();
    expect(JSON.stringify(collectResult)).not.toMatch(/Sichuan/i);
  }, 20_000);

  it('uses server-collected memory for research planning instead of model-rewritten memory objects', async () => {
    const fakePort = await getFreePort();
    let requestCount = 0;
    const hallucinatedMemory = {
      rawMemory: 'Warm sour soup from Sichuan.',
      normalizedMemory: 'Warm sour soup from Sichuan.',
      userLocation: 'Sichuan, China',
      extractedClues: {
        possibleDishNames: ['Sichuan sour soup'],
        culturalOrRegionalHints: ['Sichuan, China'],
        rememberedIngredients: ['dill'],
        sensoryClues: ['sour', 'warm'],
        occasions: [],
      },
      inferredContext: { culturalOrRegional: [], language: [] },
      missingInformation: [],
      nextQuestions: [],
      reassurance: 'I will use this invented region.',
    };
    fakeOpenAi = createServer(async (req, res) => {
      if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
        res.writeHead(404).end();
        return;
      }
      requestCount++;
      await readBody(req);
      const toolCalls = requestCount === 1
        ? [{ id: 'call_1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'Warm sour soup with dill and soft pale chunks.' }) } }]
        : requestCount === 2
          ? [{ id: 'call_2', type: 'function', function: { name: 'plan_dish_research', arguments: JSON.stringify({ memory: hallucinatedMemory }) } }]
          : undefined;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: 'done' },
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
        message: 'I remember a warm sour soup with dill and soft pale chunks. I do not know the country or name.',
      }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const planCall = events
      .filter((event) => event.event === 'tool_call')
      .map((event) => JSON.parse(event.data))
      .find((event) => event.name === 'plan_dish_research');

    expect(planCall?.input.memory.normalizedMemory).toMatch(/soft pale chunks/i);
    expect(planCall?.input.memory).not.toHaveProperty('userLocation');
    expect(JSON.stringify(planCall?.input.memory)).not.toMatch(/Sichuan/i);
  }, 20_000);

  it('grounds search queries in collected memory instead of model-invented regions', async () => {
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
        ? [{ id: 'call_1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'Warm sour soup with dill and soft pale chunks.' }) } }]
        : requestCount === 2
          ? [{ id: 'call_2', type: 'function', function: { name: 'plan_dish_research', arguments: JSON.stringify({}) } }]
          : requestCount === 3
            ? [{ id: 'call_3', type: 'function', function: { name: 'search_web', arguments: JSON.stringify({ query: 'warm dill sour soup soft pale chunks Sichuan' }) } }]
            : undefined;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: 'done' },
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
        message: 'I remember a warm sour soup with dill and soft pale chunks. I do not know the country or name.',
      }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const searchCall = events
      .filter((event) => event.event === 'tool_call')
      .map((event) => JSON.parse(event.data))
      .find((event) => event.name === 'search_web');

    expect(searchCall?.input.query).toMatch(/\b(?:sour|dill|soft|pale|chunks)\b/i);
    expect(searchCall?.input.query).not.toMatch(/Sichuan/i);
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
    const finalText = events
      .filter((event) => event.event === 'text')
      .map((event) => JSON.parse(event.data))
      .join('\n\n');
    expect(events.at(-1)?.event).toBe('done');
    expect(JSON.parse(events.at(-1)!.data)).toMatchObject({ guarded: 'explicit_minimum_cue_fallback' });
    expect(finalText).not.toMatch(/\b(?:\d+\s*(?:cups?|tbsp|tablespoons?|teaspoons?|tsp|minutes?|mins?|servings?)|one-cup|half-cup|recipe)\b/i);
    expect(finalText).not.toMatch(/amount of (?:small amount|tiny)\b/i);
    expect(requestCount).toBeGreaterThanOrEqual(1);
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

  it('scrubs recipe-style quantities, timing, and serving language after the minimum cue tool', async () => {
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
        [{ id: 'call_1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'Warm sour dill soup with pale potato chunks.' }) } }],
        [{ id: 'call_2', type: 'function', function: { name: 'plan_dish_research', arguments: JSON.stringify({}) } }],
        [{ id: 'call_3', type: 'function', function: { name: 'build_reconstruction_dossier', arguments: JSON.stringify({}) } }],
        [{ id: 'call_4', type: 'function', function: { name: 'generate_minimum_viable_nostalgia', arguments: JSON.stringify({}) } }],
        [{ id: 'call_5', type: 'function', function: { name: 'generate_recipe', arguments: JSON.stringify({ sensoryAnalysis: '{}', substitutions: '{}', sourcing: '{}' }) } }],
      ];
      const toolCalls = toolCallsByTurn[requestCount - 1];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: 'Use 2 tbsp sour cream, 1/2 cup broth, one-cup water, half-cup rice milk, and 6 oz potato. Add half a teaspoon vinegar. Preheat oven to 350°F, then bring to a gentle simmer for 12-15 min before serving 4. Exact recipe follows.' },
        }],
      }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi?.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`);

    const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Warm sour dill soup with pale potato chunks. Give me a first cue, not a full recipe.' }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const finalText = events
      .filter((event) => event.event === 'text')
      .map((event) => JSON.parse(event.data))
      .join('\n\n');

    expect(events.some((event) => event.event === 'error')).toBe(false);
    expect(events.at(-1)?.event).toBe('done');
    expect(JSON.parse(events.at(-1)!.data)).toMatchObject({ guarded: 'recipe_measurement_sanitized' });
    expect(finalText).not.toMatch(/\b(?:2\s*tbsp|1\/2\s*cup|one-cup|half-cup|6\s*oz|half a teaspoon|350\s*°?F|gentle simmer|12-15\s*min|serving\s+4|exact recipe)\b/i);
    expect(finalText).not.toContain('amount of of');
    expect(finalText).toContain('first-pass verification bite');
  }, 20_000);

  it('normalizes an unambiguous weak-model typo in a tool name', async () => {
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
        [{ id: 'call_1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'Cold rice-cinnamon drink like horchata but thinner.' }) } }],
        [{ id: 'call_2', type: 'function', function: { name: 'plan_dish_research', arguments: JSON.stringify({}) } }],
        [{ id: 'call_3', type: 'function', function: { name: 'build_reconstruction_dossier', arguments: JSON.stringify({}) } }],
        [{ id: 'call_4', type: 'function', function: { name: 'generate_minimum_viable_nystalgia', arguments: JSON.stringify({}) } }],
      ];
      const toolCalls = toolCallsByTurn[requestCount - 1];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: 'First-pass verification bite: cold rice aroma, cinnamon lift, and a thin sweet sip.' },
        }],
      }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi?.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`);

    const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Cold rice-cinnamon drink like horchata but thinner. Give me a tiny sip cue.' }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const toolNames = events.filter((event) => event.event === 'tool_call').map((event) => JSON.parse(event.data).name);
    const normalizedStatus = events.find((event) => event.event === 'status' && JSON.parse(event.data).stage === 'tool_name_normalized');

    expect(events.some((event) => event.event === 'error')).toBe(false);
    expect(toolNames).toContain('generate_minimum_viable_nostalgia');
    expect(toolNames).not.toContain('generate_minimum_viable_nystalgia');
    expect(normalizedStatus).toBeDefined();
    expect(JSON.parse(normalizedStatus!.data)).toMatchObject({
      from: 'generate_minimum_viable_nystalgia',
      to: 'generate_minimum_viable_nostalgia',
    });
    expect(events.at(-1)?.event).toBe('done');
  }, 20_000);

  it('normalizes an observed weak-model substitution tool typo', async () => {
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
        [{ id: 'call_1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'Butter chicken with cashew gravy, butter, cream, chicken, and naan.' }) } }],
        [{ id: 'call_2', type: 'function', function: { name: 'plan_dish_research', arguments: JSON.stringify({}) } }],
        [{ id: 'call_3', type: 'function', function: { name: 'resolve_dish_name', arguments: JSON.stringify({ input: 'butter chicken' }) } }],
        [{ id: 'call_4', type: 'function', function: { name: 'find_sensory_subutes', arguments: JSON.stringify({ ingredient: 'cashews', location: 'United States' }) } }],
        [{ id: 'call_5', type: 'function', function: { name: 'build_reconstruction_dossier', arguments: JSON.stringify({}) } }],
        [{ id: 'call_6', type: 'function', function: { name: 'generate_minimum_viable_nostalgia', arguments: JSON.stringify({}) } }],
      ];
      const toolCalls = toolCallsByTurn[requestCount - 1];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: 'First-pass verification bite: browned spice aroma, tomato roundness, and a creamy texture cue.' },
        }],
      }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi?.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`);

    const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Butter chicken with cashew gravy, but adapt the smallest cue to be nut-free.' }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const toolNames = events.filter((event) => event.event === 'tool_call').map((event) => JSON.parse(event.data).name);
    const normalizedStatuses = events
      .filter((event) => event.event === 'status' && JSON.parse(event.data).stage === 'tool_name_normalized')
      .map((event) => JSON.parse(event.data));

    expect(events.some((event) => event.event === 'error')).toBe(false);
    expect(toolNames).toContain('find_sensory_substitutes');
    expect(toolNames).not.toContain('find_sensory_subutes');
    expect(normalizedStatuses).toContainEqual(expect.objectContaining({
      from: 'find_sensory_subutes',
      to: 'find_sensory_substitutes',
    }));
    expect(events.at(-1)?.event).toBe('done');
  }, 20_000);

  it('blocks recipe tools inside /ask minimum-cue flows', async () => {
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
        [{ id: 'call_1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'Cold rice-cinnamon drink like horchata but thinner.' }) } }],
        [{ id: 'call_2', type: 'function', function: { name: 'plan_dish_research', arguments: JSON.stringify({}) } }],
        [{ id: 'call_3', type: 'function', function: { name: 'build_reconstruction_dossier', arguments: JSON.stringify({}) } }],
        [{ id: 'call_4', type: 'function', function: { name: 'generate_minimum_viable_nostalgia', arguments: JSON.stringify({}) } }],
        [{ id: 'call_5', type: 'function', function: { name: 'generate_recipe', arguments: JSON.stringify({ sensoryAnalysis: '{"broken"', substitutions: '{"broken"', sourcing: '{"broken"' }) } }],
      ];
      const toolCalls = toolCallsByTurn[requestCount - 1];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: 'First-pass verification sip: cold rice aroma, cinnamon lift, and a thin sweet sip.' },
        }],
      }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi?.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`);

    const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'I want the exact recipe with measurements for that cold rice-cinnamon drink, but keep me to a tiny sip cue.' }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const recipeResult = events
      .filter((event) => event.event === 'tool_result')
      .map((event) => JSON.parse(event.data))
      .find((event) => event.name === 'generate_recipe');

    expect(events.some((event) => event.event === 'error')).toBe(false);
    expect(recipeResult).toMatchObject({ blocked: true, result: { skipped: true } });
    expect(events.at(-1)?.event).toBe('done');
  }, 20_000);

  it('replaces weak-model generic text after a beverage cue with deterministic cue text', async () => {
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
        [{ id: 'call_1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'Cold rice-cinnamon drink like horchata but thinner.' }) } }],
        [{ id: 'call_2', type: 'function', function: { name: 'plan_dish_research', arguments: JSON.stringify({}) } }],
        [{ id: 'call_3', type: 'function', function: { name: 'resolve_dish_name', arguments: JSON.stringify({ input: 'cold rice cinnamon drink' }) } }],
        [{ id: 'call_4', type: 'function', function: { name: 'search_web', arguments: JSON.stringify({ query: 'cold rice cinnamon drink horchata thin' }) } }],
        [{ id: 'call_5', type: 'function', function: { name: 'build_reconstruction_dossier', arguments: JSON.stringify({}) } }],
        [{ id: 'call_6', type: 'function', function: { name: 'generate_minimum_viable_nostalgia', arguments: JSON.stringify({}) } }],
        [{ id: 'call_7', type: 'function', function: { name: 'generate_recipe', arguments: JSON.stringify({ sensoryAnalysis: '{}', substitutions: '{}', sourcing: '{}' }) } }],
      ];
      const toolCalls = toolCallsByTurn[requestCount - 1];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: "I've gathered enough information so far. Let me work with what we have." },
        }],
      }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi?.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`);

    const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'I miss the cold rice-cinnamon drink my aunt made, kind of like horchata but thinner. Give me the smallest local sip test, not a recipe.' }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const finalText = events
      .filter((event) => event.event === 'text')
      .map((event) => JSON.parse(event.data))
      .join('\n\n');

    expect(events.some((event) => event.event === 'error')).toBe(false);
    expect(finalText).toMatch(/\b(?:beverage|drink|sip|rice|cinnamon|cold|horchata)\b/i);
    expect(finalText).not.toMatch(/I've gathered enough information so far/i);
    expect(events.at(-1)?.event).toBe('done');
    expect(JSON.parse(events.at(-1)!.data)).toMatchObject({ guarded: 'minimum_cue_deterministic_completion' });
  }, 20_000);

  it('records private aggregate quality signals for ask completions without raw memory text', async () => {
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
        [{ id: 'call_1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'Cold rice-cinnamon drink like horchata but thinner over ice.' }) } }],
        [{ id: 'call_2', type: 'function', function: { name: 'plan_dish_research', arguments: JSON.stringify({}) } }],
        [{ id: 'call_3', type: 'function', function: { name: 'build_reconstruction_dossier', arguments: JSON.stringify({}) } }],
        [{ id: 'call_4', type: 'function', function: { name: 'generate_minimum_viable_nostalgia', arguments: JSON.stringify({}) } }],
      ];
      const toolCalls = toolCallsByTurn[requestCount - 1];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: "I've gathered enough information so far. Let me work with what we have." },
        }],
      }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi?.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`, {
      ACHIOTE_EVENTS_ADMIN_TOKEN: 'operator-quality-token',
    });

    const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'I miss a cold rice-cinnamon drink like horchata but thinner over ice. Smallest sip cue only.',
        consent: { qualitySignals: true },
      }),
    });
    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    expect(events.at(-1)?.event).toBe('done');

    const operatorRead = await fetch(`http://127.0.0.1:${achiotePort}/events`, {
      headers: { Authorization: 'Bearer operator-quality-token' },
    });
    expect(operatorRead.status).toBe(200);
    const bodyText = await operatorRead.text();
    const body = JSON.parse(bodyText);

    expect(body.quality).toMatchObject({
      total: 1,
      byMemoryType: { beverage: 1 },
      byGuard: { minimum_cue_deterministic_completion: 1 },
      bySearch: { skipped: 1 },
      byCache: { unavailable: 1 },
    });
    expect(body.referenceSeeds.priorities[0]).toMatchObject({
      seedId: 'beverage-rice-cinnamon-latin-america',
      reasons: expect.arrayContaining(['frequent_memory_type', 'cache_unavailable']),
    });
    expect(body.referenceSeeds.cacheWarmingTasks[0]).toMatchObject({
      id: 'warm-beverage-rice-cinnamon-latin-america',
      seedId: 'beverage-rice-cinnamon-latin-america',
      promptForHostResearch: expect.stringContaining('host-led research'),
    });
    expect(bodyText).not.toContain('Cold rice-cinnamon drink');
    expect(bodyText).not.toContain('horchata but thinner');
  }, 20_000);

  it('keeps /ask fully functional while skipping aggregate quality signals when the user opts out', async () => {
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
        [{ id: 'call_1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'Cold rice-cinnamon drink like horchata but thinner over ice.' }) } }],
        [{ id: 'call_2', type: 'function', function: { name: 'plan_dish_research', arguments: JSON.stringify({}) } }],
        [{ id: 'call_3', type: 'function', function: { name: 'build_reconstruction_dossier', arguments: JSON.stringify({}) } }],
        [{ id: 'call_4', type: 'function', function: { name: 'generate_minimum_viable_nostalgia', arguments: JSON.stringify({}) } }],
      ];
      const toolCalls = toolCallsByTurn[requestCount - 1];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: "I've gathered enough information so far. Let me work with what we have." },
        }],
      }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi?.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`, {
      ACHIOTE_EVENTS_ADMIN_TOKEN: 'operator-quality-token',
    });

    const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'I miss a cold rice-cinnamon drink like horchata but thinner over ice. Smallest sip cue only.',
        consent: { qualitySignals: false },
      }),
    });
    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    expect(events.some((event) => event.event === 'error')).toBe(false);
    expect(events.at(-1)?.event).toBe('done');

    const operatorRead = await fetch(`http://127.0.0.1:${achiotePort}/events`, {
      headers: { Authorization: 'Bearer operator-quality-token' },
    });
    expect(operatorRead.status).toBe(200);
    const body = await operatorRead.json();
    expect(body.quality).toMatchObject({ total: 0 });
    expect(body.referenceSeeds.priorities).toEqual([]);
  }, 20_000);

  it('keeps latest user corrections authoritative when weak model tool args echo stale history', async () => {
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
        [{ id: 'call_1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'The old memory was a milky, creamy, sweet rice-cinnamon drink.' }) } }],
        [{ id: 'call_2', type: 'function', function: { name: 'plan_dish_research', arguments: JSON.stringify({}) } }],
        [{ id: 'call_3', type: 'function', function: { name: 'build_reconstruction_dossier', arguments: JSON.stringify({}) } }],
        [{ id: 'call_4', type: 'function', function: { name: 'generate_minimum_viable_nostalgia', arguments: JSON.stringify({}) } }],
        [{ id: 'call_5', type: 'function', function: { name: 'generate_recipe', arguments: JSON.stringify({ sensoryAnalysis: '{}', substitutions: '{}', sourcing: '{}' }) } }],
      ];
      const toolCalls = toolCallsByTurn[requestCount - 1];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: 'The recipe generation was skipped because it is outside the minimum cue flow. Let me synthesize directly from the minimum viable nostalgia cue.' },
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
        history: [
          { role: 'user', content: 'My aunt made a cold rice-cinnamon drink. It may have been milky and creamy.' },
          { role: 'assistant', content: 'I need one more detail about the drink.' },
        ],
        message: 'Correction: I remembered wrong. The rice-cinnamon drink was not milky or creamy; it was watery, icy, barely sweet, and sharp with lime.',
      }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const finalText = events
      .filter((event) => event.event === 'text')
      .map((event) => JSON.parse(event.data))
      .join('\n\n');
    const collectedMemory = events
      .filter((event) => event.event === 'tool_result')
      .map((event) => JSON.parse(event.data))
      .find((event) => event.name === 'collect_food_memory')?.result;

    expect(events.some((event) => event.event === 'error')).toBe(false);
    expect(collectedMemory?.normalizedMemory).toMatch(/\b(?:rice|cinnamon|drink)\b/i);
    expect(collectedMemory?.normalizedMemory).toMatch(/\b(?:watery|icy|lime|barely sweet)\b/i);
    expect(collectedMemory?.normalizedMemory).not.toMatch(/\b(?:milky|creamy|cream)\b/i);
    expect(finalText).toMatch(/\b(?:watery|ice|icy|lime|citrus|acid|barely sweet|dilution)\b/i);
    expect(finalText).not.toMatch(/\b(?:milky|creamy|cream)\b/i);
    expect(events.at(-1)?.event).toBe('done');
    expect(JSON.parse(events.at(-1)!.data)).toMatchObject({ guarded: 'minimum_cue_deterministic_completion' });
  }, 20_000);

  it('replaces final text that contradicts the latest correction with the deterministic cue', async () => {
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
        [{ id: 'call_1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'The old memory was a milky, creamy, sweet rice-cinnamon drink.' }) } }],
        [{ id: 'call_2', type: 'function', function: { name: 'plan_dish_research', arguments: JSON.stringify({}) } }],
        [{ id: 'call_3', type: 'function', function: { name: 'build_reconstruction_dossier', arguments: JSON.stringify({}) } }],
        [{ id: 'call_4', type: 'function', function: { name: 'generate_minimum_viable_nostalgia', arguments: JSON.stringify({}) } }],
      ];
      const toolCalls = toolCallsByTurn[requestCount - 1];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: 'First pass verification bite: Take a tiny sip for 30 minutes. It should feel thick and creamy (milky), not watery or icy.' },
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
        history: [
          { role: 'user', content: 'My aunt made a cold rice-cinnamon drink. It may have been milky and creamy.' },
          { role: 'assistant', content: 'I need one more detail about the drink.' },
        ],
        message: 'Correction: I remembered wrong. The rice-cinnamon drink was not milky or creamy; it was watery, icy, barely sweet, and sharp with lime.',
      }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const finalText = events
      .filter((event) => event.event === 'text')
      .map((event) => JSON.parse(event.data))
      .join('\n\n');

    expect(events.some((event) => event.event === 'error')).toBe(false);
    expect(finalText).toMatch(/\b(?:watery|ice|icy|lime|citrus|acid|barely sweet|dilution)\b/i);
    expect(finalText).not.toMatch(/\b(?:milky|creamy|cream|thick)\b/i);
    expect(events.at(-1)?.event).toBe('done');
    expect(JSON.parse(events.at(-1)!.data)).toMatchObject({ guarded: 'latest_correction_sanitized' });
  }, 20_000);

  it('clarifies broad uncertain memories instead of forcing a generic post-cue fallback', async () => {
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
        [{ id: 'call_1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'My abuela made something sour and herby, maybe green, but I do not know the country, dish name, ingredients, or whether it was soup, sauce, or stew. Do not list candidate dishes; ask only what is needed or give a safe tiny cue if you have enough.' }) } }],
        [{ id: 'call_2', type: 'function', function: { name: 'plan_dish_research', arguments: JSON.stringify({}) } }],
        [{ id: 'call_3', type: 'function', function: { name: 'build_reconstruction_dossier', arguments: JSON.stringify({}) } }],
        [{ id: 'call_4', type: 'function', function: { name: 'generate_minimum_viable_nostalgia', arguments: JSON.stringify({}) } }],
      ];
      const toolCalls = toolCallsByTurn[requestCount - 1];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: "I've gathered enough information so far. Let me work with what we have." },
        }],
      }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi?.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`);

    const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'My abuela made something sour and herby, maybe green, but I do not know the country, dish name, ingredients, or whether it was soup, sauce, or stew. Do not list candidate dishes; ask only what is needed or give a safe tiny cue if you have enough.' }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const finalText = events
      .filter((event) => event.event === 'text')
      .map((event) => JSON.parse(event.data))
      .join('\n\n');

    expect(events.some((event) => event.event === 'error')).toBe(false);
    expect(finalText).toMatch(/\b(?:one more detail|need one|do not fake certainty|specific rather than generic)\b/i);
    expect(finalText).not.toMatch(/\b(?:Use:|Try:|minimum viable beverage|minimum viable composed-bite)\b/i);
    expect(events.at(-1)?.event).toBe('done');
    expect(JSON.parse(events.at(-1)!.data)).toMatchObject({ guarded: 'broad_memory_clarification' });
  }, 20_000);

  it('clarifies sparse unanchored memories even after a weak model reaches the cue tool', async () => {
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
        [{ id: 'call_1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'I remember something that smelled toasty and herby when it hit the table.' }) } }],
        [{ id: 'call_2', type: 'function', function: { name: 'plan_dish_research', arguments: JSON.stringify({}) } }],
        [{ id: 'call_3', type: 'function', function: { name: 'build_reconstruction_dossier', arguments: JSON.stringify({}) } }],
        [{ id: 'call_4', type: 'function', function: { name: 'generate_minimum_viable_nostalgia', arguments: JSON.stringify({}) } }],
      ];
      const toolCalls = toolCallsByTurn[requestCount - 1];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: 'Minimum viable aroma-balance cue: smell a tiny amount of any herb and oil.' },
        }],
      }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi?.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`);

    const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'I remember something that smelled toasty and herby when it hit the table.' }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const finalText = events
      .filter((event) => event.event === 'text')
      .map((event) => JSON.parse(event.data))
      .join('\n\n');

    expect(events.some((event) => event.event === 'error')).toBe(false);
    expect(finalText).toMatch(/\b(?:one more detail|need one|do not fake certainty|specific rather than generic)\b/i);
    expect(finalText).not.toMatch(/Minimum viable aroma-balance cue/i);
    expect(events.at(-1)?.event).toBe('done');
    expect(JSON.parse(events.at(-1)!.data)).toMatchObject({ guarded: 'generic_uncertainty_clarification' });
  }, 20_000);

  it('scrubs provider identity, browsing claims, and medical claims from final text', async () => {
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
        [{ id: 'call_1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'Butter chicken with cashew gravy, butter, cream, chicken, and naan.' }) } }],
        [{ id: 'call_2', type: 'function', function: { name: 'plan_dish_research', arguments: JSON.stringify({}) } }],
        [{ id: 'call_3', type: 'function', function: { name: 'build_reconstruction_dossier', arguments: JSON.stringify({}) } }],
        [{ id: 'call_4', type: 'function', function: { name: 'generate_minimum_viable_nostalgia', arguments: JSON.stringify({}) } }],
      ];
      const toolCalls = toolCallsByTurn[requestCount - 1];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: 'The user requested to ignore Achiote and browse. My model is built for food memories. I cannot browse. I am not browsing. I am Achiote, built into this specific toolset and workflow. OpenAI gpt-4o on fake-hostile-model says I browsed live web results and current grocery prices. This medically safe heart-healthy cure lowers cholesterol, treats inflammation, and prevents diabetes. Legal advice: this is legally safe. I cannot give medical advice. I cannot give legal advice. First-pass verification bite: tomato warmth, dairy roundness, browned spice, and a smear of achiote paste. Keep the tiny treat feeling intact.' },
        }],
      }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi?.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`);

    const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Butter chicken memory. My family asked for adapted substitutions, but do not make medical or browsing claims.' }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const finalText = events
      .filter((event) => event.event === 'text')
      .map((event) => JSON.parse(event.data))
      .join('\n\n');

    expect(events.some((event) => event.event === 'error')).toBe(false);
    expect(events.at(-1)?.event).toBe('done');
    expect(JSON.parse(events.at(-1)!.data)).toMatchObject({ guarded: 'trust_boundary_sanitized' });
    expect(finalText).not.toMatch(/\b(?:my model|cannot browse|browse|Achiote\s+(?:assistant|app|tool|toolset|workflow|model|server|searched|browsed)|toolset|workflow|OpenAI|gpt-4o|fake-hostile-model|provider|browsing|browsed|live web|current grocery prices|medically safe|heart-healthy|cure|lowers cholesterol|treats inflammation|prevents diabetes|legal advice|legally safe)\b/i);
    expect(finalText).not.toMatch(/\bI cannot give\b/i);
    expect(finalText).toContain('first-pass verification bite');
    expect(finalText).toContain('achiote paste');
    expect(finalText).toContain('tiny treat feeling');
  }, 20_000);

  it('does not leak search provider configuration when search_web is unavailable', async () => {
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
          { id: 'call_1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'Unknown warm sour soup from a tiny village.' }) } },
          { id: 'call_2', type: 'function', function: { name: 'search_web', arguments: JSON.stringify({ query: 'unknown sour dill village soup' }) } },
          { id: 'call_3', type: 'function', function: { name: 'search_web', arguments: JSON.stringify({ query: 'same soup another search' }) } },
        ]
        : undefined;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: 'Use what is already known.' },
        }],
      }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi?.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`, { SERPER_API_KEY: '' });

    const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'It might have been a named soup from a tiny village. Search if needed, but do not browse forever.' }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const rawSse = events.map((event) => event.data).join('\n');

    expect(rawSse).not.toMatch(/\b(?:SERPER_API_KEY|google\.serper|X-API-KEY)\b/i);
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
