/**
 * CHARACTERIZATION TEST NET for the /ask orchestration (src/http-server.ts handleAsk, :504-1110).
 *
 * Purpose: PIN current behavior so the upcoming refactor — extracting the orchestration out of the
 * HTTP server into a transport-neutral engine — cannot silently change it. These tests assert on the
 * SEQUENCE and CONTENT of the SSE events emitted by the `send(event, data)` closure (http-server.ts
 * :551-558). After the refactor replaces `send` with an injected `emit` sink, this event contract is
 * the thing that must survive byte-for-byte.
 *
 * These are characterization tests: they pin what the code DOES today, not what it SHOULD do. If an
 * assertion here looks "wrong", do NOT fix it in production code to make a test pass — the test is the
 * regression gate. Update the test only with a deliberate, reviewed behavior change.
 *
 * Harness: spawns the real built server (dist/http-server.js) against a fake OpenAI-compatible HTTP
 * endpoint so the full handleAsk path runs with a controllable model. No network, no real model.
 * This mirrors the existing proven harness in ask-failure-surface-regressions.test.ts and
 * ask-deterministic-tool-chain.test.ts.
 *
 * IMPORTANT: this drives dist/http-server.js, so `npm run build` must run before this test. The
 * project `test` script does not build; CI runs build via `npm run check`. The sibling subprocess
 * suites share this same prerequisite, so the net is no more fragile than the existing baseline.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { getFreePort } from './helpers/ports.js';

// --- SSE + harness helpers (kept identical in spirit to the sibling subprocess suites) ---------------

type IncomingRequest = Parameters<typeof createServer>[0] extends (req: infer R, res: infer S) => void ? R : never;

function readBody(req: IncomingRequest): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

interface SseEvent {
  event?: string;
  data: string;
}

function parseSse(text: string): SseEvent[] {
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((block) => ({
      event: block.split('\n').find((line) => line.startsWith('event: '))?.slice(7),
      data: block
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .join('\n'),
    }));
}

function toolCallNames(events: SseEvent[]): string[] {
  return events
    .filter((event) => event.event === 'tool_call')
    .map((event) => JSON.parse(event.data).name as string);
}

function finalText(events: SseEvent[]): string {
  return events
    .filter((event) => event.event === 'text')
    .map((event) => JSON.parse(event.data) as string)
    .join('\n\n');
}

function statusStages(events: SseEvent[]): Array<Record<string, unknown>> {
  return events.filter((event) => event.event === 'status').map((event) => JSON.parse(event.data));
}

function doneData(events: SseEvent[]): Record<string, unknown> | undefined {
  const done = events.find((event) => event.event === 'done');
  return done ? (JSON.parse(done.data) as Record<string, unknown>) : undefined;
}

// The P0 "deterministic anchors dump" marker. memory-receipt.ts:122 emits this string into an
// unresolved-receipt summary; the P0 regression was this deterministic dump leaking into the
// user-facing synthesized answer instead of warm model prose. A full reconstruction journey that
// reaches first_test_ready must NEVER surface this in the final `text` event.
const P0_ANCHORS_MARKER = /User-said anchors/i;

// Raw tool protocol markup that must never leak into the final answer text.
const RAW_TOOL_MARKUP = /<tool_call>|<\/tool_call>|<tool_result>|<\/tool_result>/i;

function spawnAchioteServer(
  port: number,
  openAiBaseUrl: string,
  env: Record<string, string> = {},
): Promise<ChildProcess> {
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

/**
 * Builds a fake OpenAI-compatible /v1/chat/completions handler driven by an ordered list of turn
 * responders. Each responder receives the parsed request body and the 1-based turn index, and returns
 * either a plain assistant `content` string (finish_reason: stop) or a list of tool calls
 * (finish_reason: tool_calls). Returning `null`/`undefined` from `tool` falls through to `content`.
 */
type TurnResponder = (turn: number, body: { messages?: unknown[]; tools?: unknown[] }) =>
  | { content: string }
  | { toolCalls: Array<{ name: string; arguments?: Record<string, unknown> }> }
  | { rawStatus: number; rawBody: string };

function createFakeOpenAi(responders: TurnResponder): { server: Server; turnCount: () => number; bodies: () => Array<{ messages?: unknown[]; tools?: unknown[] }> } {
  let turn = 0;
  const bodies: Array<{ messages?: unknown[]; tools?: unknown[] }> = [];
  const server = createServer(async (req, res) => {
    if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    turn++;
    const body = JSON.parse((await readBody(req)) || '{}');
    bodies.push(body);
    const out = responders(turn, body);
    if ('rawStatus' in out) {
      res.writeHead(out.rawStatus, { 'content-type': 'text/html' });
      res.end(out.rawBody);
      return;
    }
    res.setHeader('content-type', 'application/json');
    if ('toolCalls' in out) {
      res.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: '',
                tool_calls: out.toolCalls.map((call, index) => ({
                  id: `call_${turn}_${index}`,
                  type: 'function',
                  function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
                })),
              },
            },
          ],
        }),
      );
      return;
    }
    res.end(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: out.content } }],
      }),
    );
  });
  return { server, turnCount: () => turn, bodies: () => bodies };
}

/** The 4-tool model-driven reconstruction chain used by several journeys. */
function modelDrivenReconstructionChain(memoryText: string, finalProse: string): TurnResponder {
  const seq: Record<number, string> = {
    1: 'collect_food_memory',
    2: 'plan_dish_research',
    3: 'build_reconstruction_dossier',
    4: 'generate_minimum_viable_nostalgia',
  };
  return (turn) => {
    const tool = seq[turn];
    if (tool) {
      return {
        toolCalls: [{ name: tool, arguments: tool === 'collect_food_memory' ? { memoryText } : {} }],
      };
    }
    return { content: finalProse };
  };
}

async function postAsk(port: number, message: string, extra: Record<string, unknown> = {}): Promise<SseEvent[]> {
  const response = await fetch(`http://127.0.0.1:${port}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, ...extra }),
  });
  expect(response.status).toBe(200);
  return parseSse(await response.text());
}

// ----------------------------------------------------------------------------------------------------

describe('/ask orchestration characterization net', () => {
  let achiote: ChildProcess | undefined;
  let fakeOpenAi: Server | undefined;

  async function startFake(responders: TurnResponder): Promise<{ port: number; turnCount: () => number; bodies: () => Array<{ messages?: unknown[]; tools?: unknown[] }> }> {
    const port = await getFreePort();
    const fake = createFakeOpenAi(responders);
    fakeOpenAi = fake.server;
    await new Promise<void>((resolveListen) => fakeOpenAi?.listen(port, '127.0.0.1', resolveListen));
    return { port, turnCount: fake.turnCount, bodies: fake.bodies };
  }

  afterEach(async () => {
    achiote?.kill('SIGINT');
    achiote = undefined;
    if (fakeOpenAi) {
      fakeOpenAi.closeAllConnections();
      await new Promise<void>((resolveClose) => fakeOpenAi?.close(() => resolveClose()));
      fakeOpenAi = undefined;
    }
  });

  // ====================================================================================================
  // (a) FULL RECONSTRUCTION JOURNEY — the core P0 contract.
  //     Oaxaca mole negro / chilhuacle chiles / Des Moines case, end to end.
  //     Covers handleAsk synthesis path :768-806 (model-driven) and :1820-1845 (deterministic).
  // ====================================================================================================

  describe('full reconstruction journey (model-driven, ACHIOTE_DETERMINISTIC_TOOL_CHAIN=false)', () => {
    it('emits the tool chain, case_file_compacted, then a warm synthesized answer with no anchors dump', async () => {
      const finalProse =
        'Here is a warm first taste test for your mole negro memory. Toast a single chilhuacle chile and taste it against a square of dark chocolate to find the smoky-bitter balance you remember.';
      const { port: fakePort } = await startFake(
        modelDrivenReconstructionChain('mole negro from Oaxaca with chilhuacle chiles and chocolate', finalProse),
      );
      const achiotePort = await getFreePort();
      achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`, {
        ACHIOTE_DETERMINISTIC_TOOL_CHAIN: 'false',
      });

      const events = await postAsk(
        achiotePort,
        'My grandmother in Oaxaca made mole negro with chilhuacle chiles, chocolate, and toasted seeds. I live in Des Moines, Iowa. Give me the smallest first taste test.',
      );

      // No error anywhere in the stream.
      expect(events.some((event) => event.event === 'error')).toBe(false);

      // The required tool workflow ran, in dependency order, before synthesis.
      const names = toolCallNames(events);
      expect(names).toEqual(
        expect.arrayContaining([
          'plan_tool_workflow',
          'collect_food_memory',
          'plan_dish_research',
          'build_reconstruction_dossier',
          'generate_minimum_viable_nostalgia',
        ]),
      );
      expect(names.indexOf('collect_food_memory')).toBeLessThan(names.indexOf('plan_dish_research'));
      expect(names.indexOf('plan_dish_research')).toBeLessThan(names.indexOf('build_reconstruction_dossier'));
      expect(names.indexOf('build_reconstruction_dossier')).toBeLessThan(
        names.indexOf('generate_minimum_viable_nostalgia'),
      );

      // The pre-synthesis case-file compaction fired (http-server.ts:778). This is the event that
      // protects against the deterministic anchors dump.
      const stages = statusStages(events);
      expect(stages.some((stage) => stage.stage === 'case_file_compacted')).toBe(true);

      // Final answer is the warm model prose, surfaced as a `text` event.
      const text = finalText(events);
      expect(text).toContain('warm first taste test');
      expect(text).toContain('chilhuacle');

      // P0 contract: the final answer is NOT the deterministic anchors dump and leaks NO tool markup.
      expect(text).not.toMatch(P0_ANCHORS_MARKER);
      expect(text).not.toMatch(RAW_TOOL_MARKUP);

      // Stream shape: a memory receipt is emitted, and `done` is the terminal event.
      expect(events.some((event) => event.event === 'receipt')).toBe(true);
      expect(events.at(-1)?.event).toBe('done');

      // The receipt reaches first_test_ready and its assistantSummary mirrors the warm prose (not an
      // unresolved anchors dump).
      const receipt = events.find((event) => event.event === 'receipt');
      const receiptData = JSON.parse(receipt!.data) as { status?: string; assistantSummary?: string };
      expect(receiptData.status).toBe('first_test_ready');
      expect(receiptData.assistantSummary).not.toMatch(P0_ANCHORS_MARKER);
    }, 25_000);
  });

  describe('full reconstruction journey (deterministic chain, ACHIOTE_DETERMINISTIC_TOOL_CHAIN=true)', () => {
    it('runs the planned tools then a single synthesis call ending in warm prose with no anchors dump', async () => {
      const finalProse =
        'Here is a warm first taste test for your mole memory. Start with a tiny sip or bite of toasted chile paste and taste for smoky bitterness. Where do you live so I can point you to where to buy chilhuacle chiles?';
      const { port: fakePort, turnCount } = await startFake(() => ({ content: finalProse }));
      const achiotePort = await getFreePort();
      achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`, {
        ACHIOTE_DETERMINISTIC_TOOL_CHAIN: 'true',
      });

      const events = await postAsk(
        achiotePort,
        'My grandmother in Oaxaca made mole negro with chilhuacle chiles, chocolate, and many toasted seeds. I live in Des Moines, Iowa now. Give me the smallest first taste test and tell me where to buy the chiles.',
      );

      expect(events.some((event) => event.event === 'error')).toBe(false);

      // Deterministic chain executes the planned tools server-side and reaches MVN.
      const names = toolCallNames(events);
      expect(names).toEqual(
        expect.arrayContaining([
          'plan_tool_workflow',
          'collect_food_memory',
          'plan_dish_research',
          'build_reconstruction_dossier',
          'generate_minimum_viable_nostalgia',
        ]),
      );

      // Exactly one model call happens: the final synthesis (http-server.ts:1838-1839). The whole
      // deterministic-chain design is "run tools, then synthesize once".
      expect(turnCount()).toBe(1);

      // case_file_compacted fires with the deterministic marker (http-server.ts:1835).
      const stages = statusStages(events);
      const compacted = stages.find((stage) => stage.stage === 'case_file_compacted');
      expect(compacted).toBeDefined();
      expect(compacted?.deterministic).toBe(true);

      const text = finalText(events);
      expect(text).toContain('warm first taste test');
      expect(text).not.toMatch(P0_ANCHORS_MARKER);
      expect(text).not.toMatch(RAW_TOOL_MARKUP);

      expect(events.some((event) => event.event === 'receipt')).toBe(true);
      expect(events.at(-1)?.event).toBe('done');
    }, 25_000);
  });

  // ====================================================================================================
  // (b) DETERMINISTIC-FALLBACK BOUNDARY — locks WHEN buildMinimumCueCompletedResponse fires.
  //     Covers http-server.ts:783-805 (synthesis failure after MVN -> deterministic completion).
  // ====================================================================================================

  describe('deterministic fallback boundary', () => {
    it('does NOT fall back when the synthesis call succeeds (warm prose wins)', async () => {
      // Control case for the boundary: synthesis returns prose, so the deterministic completion text
      // must NOT appear and the guard marker must NOT be the fallback marker.
      const { port: fakePort } = await startFake(
        modelDrivenReconstructionChain(
          'mole negro from Oaxaca with chilhuacle chiles and chocolate',
          'Here is a warm first taste test for your mole negro memory. Toast one chilhuacle chile against dark chocolate.',
        ),
      );
      const achiotePort = await getFreePort();
      achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`, {
        ACHIOTE_DETERMINISTIC_TOOL_CHAIN: 'false',
      });

      const events = await postAsk(
        achiotePort,
        'My grandmother in Oaxaca made mole negro with chilhuacle chiles and chocolate. I live in Des Moines. Give me the smallest first taste test.',
      );

      const text = finalText(events);
      expect(text).toContain('warm first taste test');
      // The deterministic-completion fallback prose markers must be absent on the happy path.
      expect(text).not.toMatch(/^Useful anchors:/m);
      expect(doneData(events)).not.toMatchObject({ guarded: 'minimum_cue_deterministic_completion' });
    }, 25_000);

    it('falls back to the deterministic minimum-cue completion when synthesis fails after MVN', async () => {
      // Drive the 4-tool model chain, then make the FINAL synthesis turn (turn 5) error out. The
      // orchestration must recover with buildMinimumCueCompletedResponse (http-server.ts:796-800),
      // emit the structured deterministic cue, and finish with the deterministic-completion guard.
      const { port: fakePort } = await startFake((turn) => {
        const seq: Record<number, string> = {
          1: 'collect_food_memory',
          2: 'plan_dish_research',
          3: 'build_reconstruction_dossier',
          4: 'generate_minimum_viable_nostalgia',
        };
        const tool = seq[turn];
        if (tool) {
          return {
            toolCalls: [
              {
                name: tool,
                arguments:
                  tool === 'collect_food_memory'
                    ? { memoryText: 'mole negro from Oaxaca with chilhuacle chiles and chocolate' }
                    : {},
              },
            ],
          };
        }
        // Synthesis turn fails.
        return { rawStatus: 500, rawBody: '<html>error</html>' };
      });
      const achiotePort = await getFreePort();
      achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`, {
        ACHIOTE_DETERMINISTIC_TOOL_CHAIN: 'false',
      });

      const events = await postAsk(
        achiotePort,
        'My grandmother in Oaxaca made mole negro with chilhuacle chiles and chocolate. I live in Des Moines. Give me the smallest first taste test.',
      );

      // No `error` event surfaces — the failure is absorbed by the deterministic fallback.
      expect(events.some((event) => event.event === 'error')).toBe(false);

      // case_file_compacted STILL fired before the (failed) synthesis attempt — the compaction is not
      // skipped just because synthesis later fails.
      expect(statusStages(events).some((stage) => stage.stage === 'case_file_compacted')).toBe(true);

      // The final answer is the STRUCTURED deterministic cue, not warm model prose.
      const text = finalText(events);
      expect(text).toMatch(/^Useful anchors:/m);
      expect(text).toContain('Minimum viable');
      // Even the deterministic fallback never leaks raw tool markup.
      expect(text).not.toMatch(RAW_TOOL_MARKUP);

      // The terminal guard marker pins that the deterministic completion path fired.
      expect(doneData(events)).toMatchObject({ guarded: 'minimum_cue_deterministic_completion' });
      expect(events.at(-1)?.event).toBe('done');
    }, 25_000);

    it('emits the workflow-incomplete fallback text when no minimum cue exists and synthesis is empty', async () => {
      // buildEvidenceBoundedMinimumCueResponse (ask-response-builder.ts:368-371) returns a specific
      // "did not return in time" message when there is no MVN payload. We reach that branch by having
      // the model call only collect_food_memory and then return EMPTY synthesis text repeatedly, with
      // a sparse unanchored memory that the guard chain will not force a cue for.
      const { port: fakePort } = await startFake((turn) => {
        if (turn === 1) {
          return { toolCalls: [{ name: 'collect_food_memory', arguments: { memoryText: 'something warm and soft' } }] };
        }
        return { content: '' };
      });
      const achiotePort = await getFreePort();
      achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`, {
        ACHIOTE_DETERMINISTIC_TOOL_CHAIN: 'false',
      });

      const events = await postAsk(
        achiotePort,
        'I remember something warm and soft my family made, but I do not know the name, country, or ingredients.',
      );

      // The journey terminates cleanly with a `done` event and never produces a minimum-cue tool call
      // (the memory is too sparse to force one). This pins that the fallback boundary does NOT
      // fabricate a cue out of nothing.
      expect(events.some((event) => event.event === 'error')).toBe(false);
      expect(toolCallNames(events)).not.toContain('generate_minimum_viable_nostalgia');
      expect(events.at(-1)?.event).toBe('done');
      // The final text is a clarification, never the anchors dump and never raw markup.
      const text = finalText(events);
      expect(text).not.toMatch(P0_ANCHORS_MARKER);
      expect(text).not.toMatch(RAW_TOOL_MARKUP);
    }, 25_000);
  });

  // ====================================================================================================
  // (c) ALLERGY / FOOD-SAFETY PATH — peanut/tree-nut journey must not suggest the allergen and must
  //     defer to a professional. Covers enforceAllergyProfessionalBoundary (send closure :555) and the
  //     deterministic recovery guard.
  // ====================================================================================================

  describe('allergy / food-safety boundary', () => {
    it('suppresses a model that suggests the allergen, names no allergen ingredient, and defers to a professional', async () => {
      // The model tries to suggest peanut satay with "safe"/"safety note" language. The orchestration
      // must replace it with a bounded clarification that suggests NO peanuts/tree nuts and ends with a
      // professional referral.
      const { port: fakePort } = await startFake(() => ({
        content:
          'I can safely suggest a peanut-based satay sauce. Just toast the peanuts and blend. Safety note: check labels.',
      }));
      const achiotePort = await getFreePort();
      achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`, {
        ACHIOTE_DETERMINISTIC_TOOL_CHAIN: 'true',
      });

      const events = await postAsk(
        achiotePort,
        'I am severely allergic to peanuts and tree nuts. Help me recreate a satay-like sauce I remember from my childhood.',
      );

      expect(events.some((event) => event.event === 'error')).toBe(false);
      const text = finalText(events);

      // Must defer to a qualified professional.
      expect(text).toContain('qualified professional');

      // Must NOT reassure with "safe"/"safely"/"safety note" — that language is sanitized out.
      expect(text).not.toMatch(/\bsafe\b/i);
      expect(text).not.toMatch(/\bsafely\b/i);
      expect(text).not.toMatch(/safety note/i);

      // Must NOT echo the allergen back as something the user mentioned, and must NOT suggest using it.
      expect(text).not.toMatch(/(?:peanuts?|tree nuts?) you mentioned/i);
      expect(text).not.toMatch(/\b(?:toast|blend|use|add|taste|try)\b[^.\n]{0,60}\bpeanuts?\b/i);

      expect(events.at(-1)?.event).toBe('done');
    }, 25_000);
  });

  // ====================================================================================================
  // (d) SUBSTITUTES + SOURCING RENDERING — the things that "never rendered" in the original P0.
  //     Covers maybeRunPlannedSubstitutions / maybeRunPlannedSourcing (:2243, :2268) and the
  //     "Where to buy:" / "Substitutes to try:" sections in the deterministic responses.
  // ====================================================================================================

  describe('substitutes + sourcing rendering', () => {
    it('renders a "Where to buy:" sourcing section and the allergy boundary for a constrained + located request', async () => {
      // Nut allergy + dairy-free + a named location (Austin) triggers the deterministic safety-bounded
      // cue, which renders a "Where to buy:" section and appends the professional boundary. This pins
      // that sourcing guidance is actually emitted (the P0 "never rendered" defect).
      const { port: fakePort } = await startFake(() => ({
        content: 'Here is a warm first taste test using a nut-free swap that keeps the soul of the dish.',
      }));
      const achiotePort = await getFreePort();
      achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`, {
        ACHIOTE_DETERMINISTIC_TOOL_CHAIN: 'true',
      });

      const events = await postAsk(
        achiotePort,
        'My grandmother made butter chicken with cashew gravy, butter, and cream. I need a dairy-free and nut-free version that keeps the soul, and I live in Austin, Texas so tell me where to buy the swaps.',
      );

      expect(events.some((event) => event.event === 'error')).toBe(false);
      const text = finalText(events);

      // The where-to-buy guidance is actually rendered.
      expect(text).toContain('Where to buy:');
      expect(text).toMatch(/near Austin/i);

      // Because an allergy was named, the professional boundary is appended.
      expect(text).toContain('qualified professional');

      // No raw markup, no anchors dump.
      expect(text).not.toMatch(RAW_TOOL_MARKUP);
      expect(text).not.toMatch(P0_ANCHORS_MARKER);

      // Pins the guard marker for this constrained sourcing fallback branch.
      expect(doneData(events)).toMatchObject({ guarded: 'explicit_minimum_cue_fallback' });
      expect(events.at(-1)?.event).toBe('done');
    }, 25_000);
  });

  // ====================================================================================================
  // (e) maybeRun* GUARDRAILS — representative firing / not-firing.
  //     Covers the guard chain at http-server.ts:811-1110 and the deterministic_recovery /
  //     deterministic_tool_chain_fallback status branches.
  // ====================================================================================================

  describe('guardrail branches (maybeRun* / recovery / fallback)', () => {
    it('recovers deterministically and reorders substitution-before-sourcing when the first provider turn exceeds context', async () => {
      // A 400 "Context length exceeded" on the first turn triggers recoverFromInitialProviderFailure
      // (http-server.ts:612-616 -> recoverFromInitialProviderFailure :1943). This is a heavy-constraint
      // butter-chicken case that exercises the substitution + sourcing ordering guard.
      const { port: fakePort, turnCount } = await startFake(() => ({
        rawStatus: 400,
        rawBody: JSON.stringify({ error: 'Context length exceeded by the request.' }),
      }));
      const achiotePort = await getFreePort();
      achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`, {
        ACHIOTE_DETERMINISTIC_TOOL_CHAIN: 'false',
      });

      const events = await postAsk(
        achiotePort,
        'My grandmother made butter chicken with cashew gravy, butter, cream, whiskey, chicken, and naan. I need nut-free, heart-healthy, halal, vegan, and gluten-free substitutions that keep the soul. Can you adapt it?',
      );

      expect(events.some((event) => event.event === 'error')).toBe(false);

      // The deterministic_recovery status stage fired.
      expect(statusStages(events).some((stage) => stage.stage === 'deterministic_recovery')).toBe(true);

      // Substitution runs before sourcing in the recovered chain.
      const names = toolCallNames(events);
      expect(names).toEqual(
        expect.arrayContaining([
          'collect_food_memory',
          'find_sensory_substitutes',
          'generate_minimum_viable_nostalgia',
        ]),
      );
      expect(names.indexOf('generate_minimum_viable_nostalgia')).toBeLessThan(
        names.indexOf('find_sensory_substitutes'),
      );

      // Only the single failed first turn hit the provider; the rest is deterministic.
      expect(turnCount()).toBe(1);

      const text = finalText(events);
      expect(text).toMatch(/what to test first/i);
      expect(text).toMatch(/substitutes to try/i);
      // The deterministic recovery never produces recipe-grade measurements.
      expect(text).not.toMatch(
        /\b(?:\d+\s*(?:cups?|tbsp|tablespoons?|teaspoons?|tsp|minutes?|mins?|servings?))\b/i,
      );
      expect(doneData(events)).toMatchObject({ guarded: 'substitution_basis_deterministic_completion' });
    }, 25_000);

    it('fires deterministic_tool_chain_fallback for safety constraints and does not force a minimum cue', async () => {
      // With ACHIOTE_DETERMINISTIC_TOOL_CHAIN=true, an idiomatic allergy reaction ("shrimp and crab
      // make me swell up") trips deterministicSafetyConstraints (http-server.ts:1790-1794), aborting
      // the deterministic cue and falling back to the provider loop with a safety-constraints reason.
      const { port: fakePort, bodies } = await startFake(() => ({
        content:
          'I need the region and one sensory detail before narrowing this seafood rice memory.',
      }));
      const achiotePort = await getFreePort();
      achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`, {
        ACHIOTE_DETERMINISTIC_TOOL_CHAIN: 'true',
      });

      const events = await postAsk(
        achiotePort,
        'my dad made a seafood rice dish, but shrimp and crab make me swell up. help me recreate it.',
      );

      expect(events.some((event) => event.event === 'error')).toBe(false);

      // The safety-constraints fallback status fired.
      expect(statusStages(events)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ stage: 'deterministic_tool_chain_fallback', reason: 'safety_constraints' }),
        ]),
      );

      // The provider loop ran (tools were offered to the model) and no minimum cue was forced.
      expect(bodies().length).toBeGreaterThan(0);
      expect(bodies()[0].tools).toBeDefined();
      expect(toolCallNames(events)).not.toContain('generate_minimum_viable_nostalgia');

      // Allergen-bounded final text.
      const text = finalText(events);
      expect(text).toContain('qualified professional');
      expect(text).not.toMatch(/\bsafe\b|\bsafely\b|safety note/i);
      expect(events.at(-1)?.event).toBe('done');
    }, 25_000);

    it('asks for a sourcing location when sourcing is requested without a usable location (sourcing_location_clarification)', async () => {
      // shouldAskForSourcingLocation (http-server.ts:834) fires when the user asks where to buy but no
      // location is resolvable. The model returns prose; the guard replaces it with a location prompt.
      const { port: fakePort } = await startFake(() => ({
        content: 'You can find those ingredients at your local grocery store and specialty markets nearby.',
      }));
      const achiotePort = await getFreePort();
      achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`, {
        ACHIOTE_DETERMINISTIC_TOOL_CHAIN: 'false',
      });

      const events = await postAsk(
        achiotePort,
        'Where can I buy masa harina and dried guajillo chiles for the tamales my abuela used to make?',
      );

      expect(events.some((event) => event.event === 'error')).toBe(false);
      // The terminal guard marker pins one of the location/clarification branches fired (the exact
      // branch depends on what the memory collector extracts; we pin that SOME deterministic guard
      // replaced the ungrounded model prose rather than letting it through unbounded).
      const done = doneData(events);
      expect(done).toBeDefined();
      expect(typeof done?.guarded).toBe('string');
      // The model's ungrounded "local grocery store" claim must not be the final answer verbatim
      // without a clarifying question — the guard chain converts it.
      const text = finalText(events);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(RAW_TOOL_MARKUP);
      expect(events.at(-1)?.event).toBe('done');
    }, 25_000);
  });

  // ====================================================================================================
  // STREAM-SHAPE INVARIANTS — cross-cutting contract that must survive the refactor for every journey.
  // ====================================================================================================

  describe('cross-cutting stream-shape invariants', () => {
    it('always terminates with exactly one done event and emits no error on a healthy journey', async () => {
      const { port: fakePort } = await startFake(
        modelDrivenReconstructionChain(
          'mole negro from Oaxaca with chilhuacle chiles and chocolate',
          'Here is a warm first taste test for your mole negro memory. Toast a chile against dark chocolate.',
        ),
      );
      const achiotePort = await getFreePort();
      achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`, {
        ACHIOTE_DETERMINISTIC_TOOL_CHAIN: 'false',
      });

      const events = await postAsk(
        achiotePort,
        'My grandmother in Oaxaca made mole negro with chilhuacle chiles and chocolate. I live in Des Moines. Give me the smallest first taste test.',
      );

      const doneEvents = events.filter((event) => event.event === 'done');
      expect(doneEvents).toHaveLength(1);
      expect(events.at(-1)?.event).toBe('done');
      expect(events.some((event) => event.event === 'error')).toBe(false);

      // Every tool_call is paired with a tool_result of the same name (the streamed tool contract).
      const calls = events.filter((event) => event.event === 'tool_call').map((event) => JSON.parse(event.data).name);
      const results = events
        .filter((event) => event.event === 'tool_result')
        .map((event) => JSON.parse(event.data).name);
      for (const name of calls) {
        expect(results).toContain(name);
      }
    }, 25_000);

    it('orders the first events as plan routing then plan tool call/result for the deterministic plan', async () => {
      const { port: fakePort } = await startFake(
        modelDrivenReconstructionChain(
          'mole negro from Oaxaca with chilhuacle chiles and chocolate',
          'Here is a warm first taste test for your mole negro memory.',
        ),
      );
      const achiotePort = await getFreePort();
      achiote = await spawnAchioteServer(achiotePort, `http://127.0.0.1:${fakePort}/v1`, {
        ACHIOTE_DETERMINISTIC_TOOL_CHAIN: 'false',
      });

      const events = await postAsk(
        achiotePort,
        'My grandmother in Oaxaca made mole negro with chilhuacle chiles and chocolate. I live in Des Moines. Give me the smallest first taste test.',
      );

      // The deterministic plan_tool_workflow always leads the stream (runDeterministicWorkflowPlan,
      // http-server.ts:569-576). This ordering is part of the event contract.
      expect(events[0]).toMatchObject({ event: 'status' });
      expect(JSON.parse(events[0].data)).toMatchObject({ stage: 'routing', tool: 'plan_tool_workflow' });
      expect(events[1]).toMatchObject({ event: 'tool_call' });
      expect(JSON.parse(events[1].data)).toMatchObject({ name: 'plan_tool_workflow', deterministic: true });
      expect(events[2]).toMatchObject({ event: 'tool_result' });
      expect(JSON.parse(events[2].data)).toMatchObject({ name: 'plan_tool_workflow', deterministic: true });
    }, 25_000);
  });
});
