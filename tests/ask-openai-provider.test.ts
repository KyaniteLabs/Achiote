import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
      OPENAI_BASE_URL: openAiBaseUrl,
      OPENAI_MODEL: 'fake-openai-model',
      OPENAI_API_KEY: 'test-openai-key',
      OPENAI_TIMEOUT_MS: '30000',
      ACHIOTE_RATE_LIMIT_DB: '',
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

describe('/ask OpenAI-compatible provider mode', () => {
  let fakeOpenAi: Server;
  let fakeOpenAiBaseUrl: string;
  let achiote: ChildProcess;
  let achioteBaseUrl: string;
  const seenAuthHeaders: Array<string | undefined> = [];
  let requestCount = 0;

  beforeAll(async () => {
    const fakePort = await getFreePort();
    fakeOpenAiBaseUrl = `http://127.0.0.1:${fakePort}/v1`;
    fakeOpenAi = createServer(async (req, res) => {
      if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
        res.writeHead(404).end();
        return;
      }
      seenAuthHeaders.push(req.headers.authorization);
      requestCount++;
      await readBody(req);
      const toolCallsByTurn = [
        [{ id: 'call_1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'Warm sour dill soup with pale chunks.' }) } }],
        [{ id: 'call_2', type: 'function', function: { name: 'plan_dish_research', arguments: JSON.stringify({ memory: { normalizedMemory: 'Warm sour dill soup with pale chunks.' } }) } }],
        [{ id: 'call_3', type: 'function', function: { name: 'build_reconstruction_dossier', arguments: JSON.stringify({ memory: { normalizedMemory: 'Warm sour dill soup with pale chunks.' }, researchPlan: { hypotheses: [{ name: 'unknown regional soup' }] } }) } }],
        [{ id: 'call_4', type: 'function', function: { name: 'generate_minimum_viable_nostalgia', arguments: JSON.stringify({ dossier: { evidenceLedger: { userSaid: ['Warm sour dill soup with pale chunks.'], researched: ['dill'], inferred: [], unknown: ['exact dish identity'] } } }) } }],
      ];
      const toolCalls = toolCallsByTurn[requestCount - 1];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: 'OpenAI-compatible final minimum cue.' },
        }],
      }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    achioteBaseUrl = `http://127.0.0.1:${achiotePort}`;
    achiote = await spawnAchioteServer(achiotePort, fakeOpenAiBaseUrl);
  }, 20_000);

  afterAll(async () => {
    achiote?.kill('SIGINT');
    await new Promise<void>((resolveClose) => fakeOpenAi?.close(() => resolveClose()));
  });

  it('drives the /ask tool loop through an OpenAI-compatible chat completions endpoint', async () => {
    const response = await fetch(`${achioteBaseUrl}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Warm sour dill soup memory. Smallest cue only.' }),
    });

    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    const eventNames = events.map((event) => event.event);
    expect(eventNames[0]).toBe('status');
    expect(eventNames.at(-2)).toBe('text');
    expect(eventNames.at(-1)).toBe('done');
    expect(JSON.parse(events.find((e) => e.event === 'text')!.data)).toBe('OpenAI-compatible final minimum cue.');
    expect(requestCount).toBe(5);
    expect(seenAuthHeaders.every((header) => header === 'Bearer test-openai-key')).toBe(true);
  });
});

describe('/ask premature cue guard', () => {
  it('forces a local minimum cue when the model stalls on an explicit test request', async () => {
    const fakePort = await getFreePort();
    let requestCount = 0;
    const fakeOpenAi = createServer(async (req, res) => {
      if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
        res.writeHead(404).end();
        return;
      }
      requestCount++;
      await readBody(req);
      const toolCallsByTurn = [
        [{ id: 'call_1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'White coconut sweet, grainy sugar crystals, school festival abroad.', userLocation: 'Madison, WI' }) } }],
        [{ id: 'call_2', type: 'function', function: { name: 'plan_dish_research', arguments: JSON.stringify({}) } }],
      ];
      const toolCalls = toolCallsByTurn[requestCount - 1];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: 'Before I give you a tasting cue, tell me the name first.' },
        }],
      }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    const achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`);
    try {
      const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'White coconut sweet, grainy sugar crystals, school festival abroad. What is the smallest local test?' }),
      });

      expect(response.status).toBe(200);
      const events = parseSse(await response.text());
      const toolNames = events
        .filter((event) => event.event === 'tool_call')
        .map((event) => JSON.parse(event.data).name);
      const text = events.filter((event) => event.event === 'text').map((event) => JSON.parse(event.data)).join('');

      expect(toolNames).toContain('generate_minimum_viable_nostalgia');
      expect(text).toContain('Minimum viable');
      expect(text).toContain('granulated sugar');
      expect(text).toContain('Do not buy the exact');
      expect(text).not.toContain('tell me the name first');
      expect(JSON.parse(events.at(-1)!.data)).toMatchObject({ guarded: 'explicit_minimum_cue_fallback' });
      expect(requestCount).toBe(3);
    } finally {
      achiote.kill('SIGINT');
      await new Promise<void>((resolveClose) => fakeOpenAi.close(() => resolveClose()));
    }
  }, 20_000);

  it('infers current user location for local minimum cue tools when the model omits it', async () => {
    const fakePort = await getFreePort();
    let requestCount = 0;
    const fakeOpenAi = createServer(async (req, res) => {
      if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
        res.writeHead(404).end();
        return;
      }
      requestCount++;
      await readBody(req);
      const toolCallsByTurn = [
        [{ id: 'call_1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'Hot fried fish sandwich with sharp orange sauce from Trinidad.' }) } }],
        [{ id: 'call_2', type: 'function', function: { name: 'plan_dish_research', arguments: JSON.stringify({}) } }],
      ];
      const toolCalls = toolCallsByTurn[requestCount - 1];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: 'Try fried fish on a bun with orange sauce.' },
        }],
      }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    const achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`);
    try {
      const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'I do not know the name. It was a hot fried fish sandwich with sharp orange sauce from Trinidad. I live in Portland now. What is the smallest local test?' }),
      });

      expect(response.status).toBe(200);
      const events = parseSse(await response.text());
      const collectCall = events.find((event) => event.event === 'tool_call' && JSON.parse(event.data).name === 'collect_food_memory');
      const collectResult = events.find((event) => event.event === 'tool_result' && JSON.parse(event.data).name === 'collect_food_memory');
      const cueCall = events.find((event) => event.event === 'tool_call' && JSON.parse(event.data).name === 'generate_minimum_viable_nostalgia');
      const text = events.filter((event) => event.event === 'text').map((event) => JSON.parse(event.data)).join('');

      expect(JSON.parse(collectCall!.data).input.userLocation).toBe('Portland');
      expect(JSON.parse(collectResult!.data).result.userLocation).toBe('Portland');
      expect(JSON.parse(cueCall!.data).input.userLocation).toBe('Portland');
      expect(text).toContain('near Portland');
      expect(JSON.parse(events.at(-1)!.data)).toMatchObject({ guarded: 'explicit_minimum_cue_fallback' });
    } finally {
      achiote.kill('SIGINT');
      await new Promise<void>((resolveClose) => fakeOpenAi.close(() => resolveClose()));
    }
  }, 20_000);

  it('does not stream concrete food cues before the minimum viable nostalgia tool runs', async () => {
    const fakePort = await getFreePort();
    let requestCount = 0;
    const fakeOpenAi = createServer(async (req, res) => {
      if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
        res.writeHead(404).end();
        return;
      }
      requestCount++;
      await readBody(req);
      const toolCallsByTurn = [
        [{ id: 'call_1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'Warm sour dill soup with pale chunks.' }) } }],
        [{ id: 'call_2', type: 'function', function: { name: 'plan_dish_research', arguments: JSON.stringify({ memory: { normalizedMemory: 'Warm sour dill soup with pale chunks.' } }) } }],
      ];
      const toolCalls = toolCallsByTurn[requestCount - 1];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: 'Try this tonight: warm dill with buttermilk and sip it.' },
        }],
      }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    const achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`);
    try {
      const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Warm sour dill soup memory. Smallest cue only.' }),
      });

      expect(response.status).toBe(200);
      const events = parseSse(await response.text());
      const toolNames = events
        .filter((event) => event.event === 'tool_call')
        .map((event) => JSON.parse(event.data).name);
      const text = events.filter((event) => event.event === 'text').map((event) => JSON.parse(event.data)).join('');

      expect(toolNames).toContain('generate_minimum_viable_nostalgia');
      expect(text).toContain('Minimum viable');
      expect(text).not.toContain('warm dill with buttermilk');
      expect(events.at(-1)?.event).toBe('done');
      expect(JSON.parse(events.at(-1)!.data)).toMatchObject({ guarded: 'explicit_minimum_cue_fallback' });
      expect(requestCount).toBe(3);
    } finally {
      achiote.kill('SIGINT');
      await new Promise<void>((resolveClose) => fakeOpenAi.close(() => resolveClose()));
    }
  });

  it('allows clarification questions that mention sensory temperature before the cue tool runs', async () => {
    const fakePort = await getFreePort();
    let requestCount = 0;
    const fakeOpenAi = createServer(async (req, res) => {
      if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
        res.writeHead(404).end();
        return;
      }
      requestCount++;
      await readBody(req);
      const toolCallsByTurn = [
        [{ id: 'call_1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'Warm sour dill soup with pale chunks.' }) } }],
        [{ id: 'call_2', type: 'function', function: { name: 'plan_dish_research', arguments: JSON.stringify({ memory: { normalizedMemory: 'Warm sour dill soup with pale chunks.' } }) } }],
      ];
      const toolCalls = toolCallsByTurn[requestCount - 1];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: 'Was it served warm or cold, and were the pale chunks potato-soft or firmer?' },
        }],
      }));
    });
    await new Promise<void>((resolveListen) => fakeOpenAi.listen(fakePort, '127.0.0.1', resolveListen));

    const achiotePort = await getFreePort();
    const achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`);
    try {
      const response = await fetch(`http://127.0.0.1:${achiotePort}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Warm sour dill soup memory. Ask me what matters.' }),
      });

      expect(response.status).toBe(200);
      const events = parseSse(await response.text());
      const text = events.filter((event) => event.event === 'text').map((event) => JSON.parse(event.data)).join('');
      expect(text).toBe('Was it served warm or cold, and were the pale chunks potato-soft or firmer?');
      expect(requestCount).toBe(3);
    } finally {
      achiote.kill('SIGINT');
      await new Promise<void>((resolveClose) => fakeOpenAi.close(() => resolveClose()));
    }
  });
});
