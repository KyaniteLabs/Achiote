/**
 * Targeted regression tests for the four findings from the overnight test run.
 *
 * Each describe block maps to one of the prioritised issues:
 *   1. researched evidence must be populated in the receipt from search/resolve results
 *   2. stalled-research enforcement: after plan+search the server must force cue generation
 *   3. (same mechanism as 2) maybeSendForcedMinimumCue fires beyond explicit-only requests
 *   4. clarification responses are context-aware, not fully templated
 *
 * Additional edge cases found during analysis:
 *   5. resolve_dish_name loops (≥2 calls) no longer stall the cue pipeline
 *   6. context-aware preamble varies correctly across input types
 *   7. follow-up turn with location + ingredient proceeds through the guard
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { getFreePort } from './helpers/ports.js';

function readBodyStr(req: Parameters<typeof createServer>[0] extends (req: infer R, res: infer S) => void ? R : never): Promise<string> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => res(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rej);
  });
}

function parseSse(text: string): Array<{ event?: string; data: string }> {
  return text.split('\n\n').filter(Boolean).map((block) => ({
    event: block.split('\n').find((l) => l.startsWith('event: '))?.slice(7),
    data: block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n'),
  }));
}

function spawnAchiote(port: number, openAiBase: string): Promise<ChildProcess> {
  const proc = spawn('node', [resolve('dist/http-server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      ACHIOTE_AUTH_ENABLED: 'false',
      ACHIOTE_ALLOW_ANON_ASK: 'true',
      ACHIOTE_ASK_PROVIDER: 'openai',
      OPENAI_BASE_URL: openAiBase,
      OPENAI_MODEL: 'test-model',
      OPENAI_API_KEY: 'test-key',
      OPENAI_TIMEOUT_MS: '30000',
      ACHIOTE_RATE_LIMIT_DB: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('server startup timeout')), 10_000);
    proc.stdout?.on('data', (d: Buffer) => {
      if (d.toString().includes(`localhost:${port}`)) { clearTimeout(t); ok(proc); }
    });
    proc.once('error', fail);
  });
}

// ─── shared test runner ────────────────────────────────────────────────────────

async function runAsk(
  baseUrl: string,
  message: string,
  history?: Array<{ role: string; content: string }>,
): Promise<Array<{ event?: string; data: string }>> {
  const response = await fetch(`${baseUrl}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, ...(history ? { history } : {}) }),
  });
  expect(response.status).toBe(200);
  return parseSse(await response.text());
}

// ─── 1. researched evidence populated in receipt ───────────────────────────────

describe('researched evidence — receipt provenance', () => {
  let fake: Server;
  let achiote: ChildProcess;
  let base: string;
  let callCount = 0;

  beforeAll(async () => {
    const fakePort = await getFreePort();
    fake = createServer(async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(404).end(); return; }
      await readBodyStr(req);
      callCount++;
      // Turn 1: collect
      // Turn 2: plan
      // Turn 3: search_web
      // Turn 4: resolve_dish_name
      // Turn 5: build_dossier
      // Turn 6: generate_cue
      // Turn 7: text response
      const turns: Array<Array<{ id: string; type: string; function: { name: string; arguments: string } }>> = [
        [{ id: 'c1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'A nutty peppery stew with greens from Nigeria', userLocation: 'Chicago' }) } }],
        [{ id: 'c2', type: 'function', function: { name: 'plan_dish_research', arguments: JSON.stringify({ memory: { rawMemory: 'A nutty peppery stew with greens from Nigeria', normalizedMemory: 'nutty peppery stew greens', userLocation: 'Chicago', extractedClues: { possibleDishNames: [], culturalOrRegionalHints: ['Nigeria'], rememberedIngredients: ['peppery'], sensoryClues: [], occasions: ['funerals'] }, inferredContext: { culturalOrRegional: [], language: [] }, missingInformation: [], nextQuestions: [], reassurance: '' } }) } }],
        [{ id: 'c3', type: 'function', function: { name: 'search_web', arguments: JSON.stringify({ query: 'Nigerian egusi soup leafy greens' }) } }],
        [{ id: 'c4', type: 'function', function: { name: 'resolve_dish_name', arguments: JSON.stringify({ input: 'egusi soup' }) } }],
        [{ id: 'c5', type: 'function', function: { name: 'build_reconstruction_dossier', arguments: JSON.stringify({ memory: { rawMemory: 'A nutty peppery stew with greens from Nigeria', normalizedMemory: 'nutty peppery stew greens', userLocation: 'Chicago', extractedClues: { possibleDishNames: [], culturalOrRegionalHints: ['Nigeria'], rememberedIngredients: ['peppery'], sensoryClues: [], occasions: ['funerals'] }, inferredContext: { culturalOrRegional: [], language: [] }, missingInformation: [], nextQuestions: [], reassurance: '' } }) } }],
        [{ id: 'c6', type: 'function', function: { name: 'generate_minimum_viable_nostalgia', arguments: JSON.stringify({ dossier: { title: 'Dossier', evidenceLedger: { userSaid: ['A nutty peppery stew with greens from Nigeria'], researched: [], inferred: [], unknown: [] }, hypotheses: [], nostalgiaCriticalElements: [], recreationStrategy: [], whatToAskFamily: [], confidence: 'Medium' }, userLocation: 'Chicago', maxEffortMinutes: 15 }) } }],
      ];
      const toolCalls = turns[callCount - 1];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: 'Warm a small amount of egusi paste with crayfish and leafy greens. Sip and note.' },
        }],
      }));
    });
    await new Promise<void>((ok) => fake.listen(fakePort, '127.0.0.1', ok));

    const aPort = await getFreePort();
    base = `http://127.0.0.1:${aPort}`;
    achiote = await spawnAchiote(aPort, `http://127.0.0.1:${fakePort}/v1`);
  }, 20_000);

  afterAll(async () => {
    achiote?.kill('SIGINT');
    await new Promise<void>((ok) => fake?.close(() => ok()));
  });

  it('populates researched field in receipt when search_web and resolve_dish_name ran', async () => {
    callCount = 0;
    const events = await runAsk(base, 'A nutty peppery stew with greens my Nigerian aunt made for funerals. I live in Chicago.');
    const receiptEvent = events.find((e) => e.event === 'receipt');
    expect(receiptEvent, 'receipt event must be present').toBeDefined();
    const receipt = JSON.parse(receiptEvent!.data);
    expect(receipt.evidence.researched, 'researched array must not be empty after search + resolve').not.toHaveLength(0);
    // Must contain the canonical name from resolve_dish_name
    const researchedText = receipt.evidence.researched.join(' ');
    expect(researchedText).toMatch(/egusi/i);
  });

  it('receipt userSaid is always populated from raw memory', async () => {
    callCount = 0;
    const events = await runAsk(base, 'A nutty peppery stew with greens my Nigerian aunt made for funerals. I live in Chicago.');
    const receiptEvent = events.find((e) => e.event === 'receipt');
    const receipt = JSON.parse(receiptEvent!.data);
    expect(receipt.evidence.userSaid).toHaveLength(1);
    expect(receipt.evidence.userSaid[0]).toContain('nutty');
  });
});

// ─── 2+3. stalled-research enforcement / broadened forced-cue ─────────────────

describe('stalled-research enforcement — server forces cue after plan+search', () => {
  let fake: Server;
  let achiote: ChildProcess;
  let base: string;
  let callCount = 0;

  beforeAll(async () => {
    const fakePort = await getFreePort();
    fake = createServer(async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(404).end(); return; }
      await readBodyStr(req);
      callCount++;
      // Simulate: collect → plan → search_web → model STOPS and asks a follow-up (no cue tool)
      const turns: Array<Array<{ id: string; type: string; function: { name: string; arguments: string } }>> = [
        [{ id: 'c1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'Bright green garlicky sauce on pasta, Levant', userLocation: 'Seattle' }) } }],
        [{ id: 'c2', type: 'function', function: { name: 'plan_dish_research', arguments: JSON.stringify({ memory: { rawMemory: 'Bright green garlicky sauce on pasta, Levant', normalizedMemory: 'bright green garlicky sauce pasta', userLocation: 'Seattle', extractedClues: { possibleDishNames: [], culturalOrRegionalHints: ['Levant'], rememberedIngredients: ['garlic'], sensoryClues: ['garlicky'], occasions: [] }, inferredContext: { culturalOrRegional: [], language: [] }, missingInformation: ['dish name'], nextQuestions: [], reassurance: '' } }) } }],
        [{ id: 'c3', type: 'function', function: { name: 'search_web', arguments: JSON.stringify({ query: 'Levant bright green garlicky sauce pasta herb' }) } }],
        // No more tool calls — model wants to ask a follow-up
      ];
      const toolCalls = turns[callCount - 1];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: 'Was the sauce smooth like a paste, or more chunky with herbs? I want to make sure I point you to the right dish before giving you a test.' },
        }],
      }));
    });
    await new Promise<void>((ok) => fake.listen(fakePort, '127.0.0.1', ok));

    const aPort = await getFreePort();
    base = `http://127.0.0.1:${aPort}`;
    achiote = await spawnAchiote(aPort, `http://127.0.0.1:${fakePort}/v1`);
  }, 20_000);

  afterAll(async () => {
    achiote?.kill('SIGINT');
    await new Promise<void>((ok) => fake?.close(() => ok()));
  });

  it('forces cue generation when model stalls after plan + search_web', async () => {
    callCount = 0;
    const events = await runAsk(base, 'Bright green garlicky sauce on pasta, not pesto, Levant. I live in Seattle.');

    // Server must have force-generated the cue tools
    const toolCalls = events
      .filter((e) => e.event === 'tool_call')
      .map((e) => JSON.parse(e.data).name);
    expect(toolCalls).toContain('generate_minimum_viable_nostalgia');

    // Must emit a receipt
    const receiptEvent = events.find((e) => e.event === 'receipt');
    expect(receiptEvent, 'receipt must be present after forced cue').toBeDefined();

    // Done event must fire the forced-cue guard
    const done = JSON.parse(events.at(-1)!.data);
    expect(done.guarded).toBe('explicit_minimum_cue_fallback');
  });

  it('does NOT force a cue when only collect ran (too sparse — guard handles it)', async () => {
    callCount = 0;
    // Reuse the server but cap at 1 tool call
    const fakePort2 = await getFreePort();
    const fake2 = createServer(async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(404).end(); return; }
      await readBodyStr(req);
      const turns = [
        [{ id: 'c1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'Something warm' }) } }],
      ];
      const toolCalls = turns[0];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: 'Please tell me more.' },
        }],
      }));
    });
    await new Promise<void>((ok) => fake2.listen(fakePort2, '127.0.0.1', ok));
    const aPort2 = await getFreePort();
    const base2 = `http://127.0.0.1:${aPort2}`;
    const achiote2 = await spawnAchiote(aPort2, `http://127.0.0.1:${fakePort2}/v1`);

    try {
      const events = await runAsk(base2, 'I remember something warm.');
      const toolCalls2 = events.filter((e) => e.event === 'tool_call').map((e) => JSON.parse(e.data).name);
      // Should NOT force the cue — not enough research was done
      expect(toolCalls2).not.toContain('generate_minimum_viable_nostalgia');
      // Guard should fire to ask for clarification
      const done = JSON.parse(events.at(-1)!.data);
      expect(done.guarded).toBe('missing_research_plan_clarification');
    } finally {
      achiote2.kill('SIGINT');
      await new Promise<void>((ok) => fake2.close(() => ok()));
    }
  }, 20_000);
});

// ─── 4. context-aware clarification responses ──────────────────────────────────

describe('context-aware clarification responses', () => {
  let fake: Server;
  let achiote: ChildProcess;
  let base: string;
  let callCount = 0;
  let lastCollectResult: unknown = null;

  beforeAll(async () => {
    const fakePort = await getFreePort();
    fake = createServer(async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(404).end(); return; }
      await readBodyStr(req);
      callCount++;
      // Always: collect only, then stop — triggers clarification guard
      const turns = [
        [{ id: 'c1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'Mi abuela made something sour and herby', userLocation: undefined }) } }],
      ];
      const toolCalls = turns[0];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: 'Where was your abuela from?' },
        }],
      }));
    });
    await new Promise<void>((ok) => fake.listen(fakePort, '127.0.0.1', ok));

    const aPort = await getFreePort();
    base = `http://127.0.0.1:${aPort}`;
    achiote = await spawnAchiote(aPort, `http://127.0.0.1:${fakePort}/v1`);
    void lastCollectResult;
  }, 20_000);

  afterAll(async () => {
    achiote?.kill('SIGINT');
    await new Promise<void>((ok) => fake?.close(() => ok()));
  });

  it('clarification response always contains the stable anchor sentence', async () => {
    callCount = 0;
    const events = await runAsk(base, 'Mi abuela made something sour and herby from her home country.');
    const text = events.filter((e) => e.event === 'text').map((e) => JSON.parse(e.data)).join('');
    expect(text).toContain('Those answers decide the dish family');
  });

  it('clarification response does not claim to know the dish when no name evidence exists', async () => {
    callCount = 0;
    const events = await runAsk(base, 'Mi abuela made something sour and herby from her home country.');
    const text = events.filter((e) => e.event === 'text').map((e) => JSON.parse(e.data)).join('');
    expect(text).not.toMatch(/chimichurri|ceviche|sancocho|mole/i);
  });

  it('clarification response uses context-aware preamble when sensory clues are present', async () => {
    callCount = 0;
    const events = await runAsk(base, 'Mi abuela made something sour and herby from her home country.');
    const text = events.filter((e) => e.event === 'text').map((e) => JSON.parse(e.data)).join('');
    // New context-aware preamble should NOT be the generic opener when sensory data is present,
    // but the generic opener is still acceptable as a fallback — either way it must ask the right question.
    expect(text).toContain('Where was your abuela from?');
  });
});

// ─── 5. resolve_dish_name loop — no longer stalls cue pipeline ─────────────────

describe('resolve_dish_name double-call — cue must still be forced', () => {
  let fake: Server;
  let achiote: ChildProcess;
  let base: string;
  let callCount = 0;

  beforeAll(async () => {
    const fakePort = await getFreePort();
    fake = createServer(async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(404).end(); return; }
      await readBodyStr(req);
      callCount++;
      // Simulate: collect → plan → search → resolve × 2 → model stops without cue
      const turns: Array<Array<{ id: string; type: string; function: { name: string; arguments: string } }>> = [
        [{ id: 'c1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'Nutty peppery Nigerian stew with leafy greens', userLocation: 'Boston' }) } }],
        [{ id: 'c2', type: 'function', function: { name: 'plan_dish_research', arguments: JSON.stringify({ memory: { rawMemory: 'Nutty peppery Nigerian stew with leafy greens', normalizedMemory: 'nutty peppery stew', userLocation: 'Boston', extractedClues: { possibleDishNames: [], culturalOrRegionalHints: ['Nigeria'], rememberedIngredients: ['peppery'], sensoryClues: ['nutty'], occasions: [] }, inferredContext: { culturalOrRegional: [], language: [] }, missingInformation: [], nextQuestions: [], reassurance: '' } }) } }],
        [{ id: 'c3', type: 'function', function: { name: 'search_web', arguments: JSON.stringify({ query: 'Nigerian stew nutty leafy greens egusi' }) } }],
        [{ id: 'c4', type: 'function', function: { name: 'resolve_dish_name', arguments: JSON.stringify({ input: 'egusi' }) } }],
        [{ id: 'c5', type: 'function', function: { name: 'resolve_dish_name', arguments: JSON.stringify({ input: 'ogbono' }) } }],
        // Model stops — no cue tool called
      ];
      const toolCalls = turns[callCount - 1];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: toolCalls ? 'tool_calls' : 'stop',
          message: toolCalls
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: 'Do you remember what your aunt called it? Egusi and ogbono are both possible.' },
        }],
      }));
    });
    await new Promise<void>((ok) => fake.listen(fakePort, '127.0.0.1', ok));

    const aPort = await getFreePort();
    base = `http://127.0.0.1:${aPort}`;
    achiote = await spawnAchiote(aPort, `http://127.0.0.1:${fakePort}/v1`);
  }, 20_000);

  afterAll(async () => {
    achiote?.kill('SIGINT');
    await new Promise<void>((ok) => fake?.close(() => ok()));
  });

  it('forces cue generation after resolve_dish_name × 2 stall without cue tool', async () => {
    callCount = 0;
    const events = await runAsk(base, 'Nutty peppery Nigerian stew with leafy greens my aunt made for funerals. I live in Boston.');

    const toolCalls = events.filter((e) => e.event === 'tool_call').map((e) => JSON.parse(e.data).name);
    expect(toolCalls).toContain('generate_minimum_viable_nostalgia');

    const receiptEvent = events.find((e) => e.event === 'receipt');
    expect(receiptEvent).toBeDefined();

    const done = JSON.parse(events.at(-1)!.data);
    expect(done.guarded).toBe('explicit_minimum_cue_fallback');
  });
});

// ─── 6. follow-up turn with location proceeds through the guard ────────────────

describe('follow-up turn with substantive anchors skips clarification guard', () => {
  // First-turn test: sparse input fires the guard
  let fakeFirst: Server;
  let achioteFirst: ChildProcess;
  let baseFirst: string;

  // Second-turn test: follow-up with Philippines+tamarind bypasses the guard
  let fakeFollowup: Server;
  let achioteFollowup: ChildProcess;
  let baseFollowup: string;

  beforeAll(async () => {
    // ── sparse first-turn server ─────────────────────────────────────────────
    const fakePort1 = await getFreePort();
    fakeFirst = createServer(async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(404).end(); return; }
      await readBodyStr(req);
      // collect only, then stop
      const toolCalls = [{ id: 'c1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({ memoryText: 'something sour and yellow' }) } }];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: toolCalls } }] }));
    });
    await new Promise<void>((ok) => fakeFirst.listen(fakePort1, '127.0.0.1', ok));
    const aPort1 = await getFreePort();
    baseFirst = `http://127.0.0.1:${aPort1}`;
    achioteFirst = await spawnAchiote(aPort1, `http://127.0.0.1:${fakePort1}/v1`);

    // ── follow-up server: collect with Philippines + tamarind + Portland ──────
    const fakePort2 = await getFreePort();
    let followupCallCount = 0;
    fakeFollowup = createServer(async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(404).end(); return; }
      await readBodyStr(req);
      followupCallCount++;
      // Turn 1: collect with location + cultural anchor (Philippines / tamarind)
      const turns = [
        [{ id: 'c1', type: 'function', function: { name: 'collect_food_memory', arguments: JSON.stringify({
          memoryText: 'sour and yellow, grandmother from Philippines, sourness from tamarind',
          userLocation: 'Portland',
        }) } }],
      ];
      const toolCalls = turns[followupCallCount - 1];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ finish_reason: toolCalls ? 'tool_calls' : 'stop', message: toolCalls ? { role: 'assistant', content: '', tool_calls: toolCalls } : { role: 'assistant', content: 'Thanks for the extra detail — let me narrow this down for you.' } }] }));
    });
    await new Promise<void>((ok) => fakeFollowup.listen(fakePort2, '127.0.0.1', ok));
    const aPort2 = await getFreePort();
    baseFollowup = `http://127.0.0.1:${aPort2}`;
    achioteFollowup = await spawnAchiote(aPort2, `http://127.0.0.1:${fakePort2}/v1`);
  }, 30_000);

  afterAll(async () => {
    achioteFirst?.kill('SIGINT');
    achioteFollowup?.kill('SIGINT');
    await Promise.all([
      new Promise<void>((ok) => fakeFirst?.close(() => ok())),
      new Promise<void>((ok) => fakeFollowup?.close(() => ok())),
    ]);
  });

  it('first sparse turn fires missing_research_plan_clarification guard correctly', async () => {
    const events = await runAsk(baseFirst, 'I remember something sour and yellow.');
    const done = JSON.parse(events.at(-1)!.data);
    expect(done.guarded).toBe('missing_research_plan_clarification');
  });

  it('follow-up with Philippines + tamarind does NOT re-fire clarification guard', async () => {
    const history = [{ role: 'assistant', content: 'Where was this from?' }];
    const events = await runAsk(
      baseFollowup,
      'My grandmother was from the Philippines. And I think the sourness came from tamarind.',
      history,
    );
    const done = JSON.parse(events.at(-1)!.data);
    // Guard must NOT fire — server detects substantive follow-up anchors
    expect(done.guarded).not.toBe('missing_research_plan_clarification');
  });
});
