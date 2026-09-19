/**
 * The MCP `reconstruct_food_memory` tool runs the full /ask engine in one call and returns structured
 * output. This test drives it through the real MCP client/server pair (InMemoryTransport) against a fake
 * OpenAI-compatible endpoint, asserting the structured content carries the reconstruction prose, the
 * Memory Receipt, and the milestones (tools run, status).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createAchioteServer } from '../src/index.js';
import { getFreePort } from './helpers/ports.js';

type FakeBody = { messages?: unknown[]; tools?: unknown[] };
type TurnResponder = (turn: number, body: FakeBody) =>
  | { content: string }
  | { toolCalls: Array<{ name: string; arguments?: Record<string, unknown> }> };

function readBody(req: Parameters<Parameters<typeof createServer>[0]>[0]): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function createFakeOpenAi(responders: TurnResponder): Server {
  let turn = 0;
  return createServer(async (req, res) => {
    if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    turn++;
    const body = JSON.parse((await readBody(req)) || '{}');
    const out = responders(turn, body);
    res.setHeader('content-type', 'application/json');
    if ('toolCalls' in out) {
      res.end(JSON.stringify({
        choices: [{
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
        }],
      }));
      return;
    }
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: out.content } }] }));
  });
}

const SAVED_ENV: Record<string, string | undefined> = {};
const ENV_KEYS = ['ACHIOTE_ASK_PROVIDER', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'OPENAI_API_KEY', 'OPENAI_TIMEOUT_MS', 'ACHIOTE_DETERMINISTIC_TOOL_CHAIN'];

describe('reconstruct_food_memory MCP tool', () => {
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

  async function startFake(responders: TurnResponder): Promise<string> {
    const port = await getFreePort();
    fake = createFakeOpenAi(responders);
    await new Promise<void>((r) => fake?.listen(port, '127.0.0.1', r));
    process.env.ACHIOTE_ASK_PROVIDER = 'openai';
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;
    process.env.OPENAI_MODEL = 'fake-openai-model';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.OPENAI_TIMEOUT_MS = '30000';
    return `http://127.0.0.1:${port}/v1`;
  }

  it('returns structured content with the reconstruction prose, receipt, and milestones', async () => {
    process.env.ACHIOTE_DETERMINISTIC_TOOL_CHAIN = 'true';
    await startFake(() => ({
      content: 'Here is a warm first taste test for your mole negro memory. Toast a chilhuacle chile and taste it against dark chocolate for the smoky-bitter balance.',
    }));

    const server = createAchioteServer({ enableCache: false });
    const client = new Client({ name: 'achiote-test', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain('reconstruct_food_memory');

      const result = await client.callTool({
        name: 'reconstruct_food_memory',
        arguments: {
          memory: 'My grandmother in Oaxaca made mole negro with chilhuacle chiles, chocolate, and toasted seeds. Give me the smallest first taste test.',
          userLocation: 'Des Moines, Iowa',
        },
      });

      expect(result.isError).not.toBe(true);
      const structured = result.structuredContent as {
        answer?: string;
        status?: string;
        toolsRun?: string[];
        receipt?: { title?: string; status?: string };
      };

      // The reconstruction prose came back as structured output.
      expect(typeof structured.answer).toBe('string');
      expect(structured.answer).toContain('chilhuacle');

      // Milestones: the workflow tools actually ran, including the minimum-cue tool.
      expect(structured.toolsRun).toEqual(
        expect.arrayContaining(['collect_food_memory', 'plan_dish_research', 'generate_minimum_viable_nostalgia']),
      );

      // The Memory Receipt is present and reaches first_test_ready.
      expect(structured.receipt?.title).toBe('Achiote Memory Receipt');
      expect(structured.receipt?.status).toBe('first_test_ready');
      expect(structured.status).toBe('first_test_ready');
    } finally {
      await client.close();
      await server.close();
    }
  }, 25_000);
});
