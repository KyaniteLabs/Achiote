#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

const jsonOnly = process.argv.includes('--json');
const listJsonOnly = process.argv.includes('--list-json');
const scenarioFilter = process.env.ACHIOTE_TORTURE_CASES
  ? new Set(process.env.ACHIOTE_TORTURE_CASES.split(',').map((id) => id.trim()).filter(Boolean))
  : null;
const tortureProvider = process.env.ACHIOTE_TORTURE_PROVIDER?.trim().toLowerCase() ?? 'openai-compatible';
if (!['openai', 'openai-compatible'].includes(tortureProvider)) {
  throw new Error(`ACHIOTE_TORTURE_PROVIDER=${process.env.ACHIOTE_TORTURE_PROVIDER} is not supported by the offline fake-provider harness. Use scripts/live-ask-smoke.mjs or scripts/weak-cloud-overnight.mjs for GLM/Z.ai and OpenRouter live provider tests.`);
}

const forbiddenExternalEnv = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'GLM_API_KEY',
  'ZHIPU_API_KEY',
  'SERPER_API_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
];

function log(line = '') {
  if (!jsonOnly) console.log(line);
}

function ensureBuilt() {
  if (fs.existsSync(path.resolve('dist/http-server.js'))) return;
  log('dist/http-server.js is missing; building local server before offline torture run.');
  const result = spawnSync('npm', ['run', 'build'], { stdio: jsonOnly ? 'pipe' : 'inherit' });
  if (result.status !== 0) {
    const stderr = result.stderr?.toString('utf8') ?? '';
    throw new Error(`local build failed before torture run: ${stderr.slice(0, 500)}`);
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('unable to allocate a local port')));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseSse(text) {
  return text.split('\n\n').filter(Boolean).map((block) => ({
    event: block.split('\n').find((line) => line.startsWith('event: '))?.slice(7),
    data: block.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n'),
  }));
}

function parseData(event) {
  if (!event?.data) return null;
  try {
    return JSON.parse(event.data);
  } catch {
    return null;
  }
}

function toolCall(id, name, args = {}) {
  return {
    id,
    type: 'function',
    function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
  };
}

function toolsResponse(toolCalls) {
  return {
    choices: [{
      finish_reason: 'tool_calls',
      message: { role: 'assistant', content: '', tool_calls: toolCalls },
    }],
  };
}

function textResponse(content) {
  return {
    choices: [{
      finish_reason: 'stop',
      message: { role: 'assistant', content },
    }],
  };
}

function statusResponse(status, body) {
  return { status, body };
}

function findEvents(result, eventName) {
  return result.events.filter((event) => event.event === eventName).map(parseData).filter(Boolean);
}

function eventDataText(result) {
  return result.events.map((event) => event.data).join('\n');
}

function responseText(result) {
  return findEvents(result, 'text').join('\n\n');
}

function toolNames(result) {
  return findEvents(result, 'tool_call').map((event) => event.name);
}

function donePayload(result) {
  return parseData(result.events.find((event) => event.event === 'done'));
}

function errorPayloads(result) {
  return findEvents(result, 'error');
}

function noRawProviderLeaks(result) {
  const text = eventDataText(result);
  return !/\b(?:sk-live|acct_|OpenAI-compatible provider returned|Bearer|fake-hostile-model)\b/i.test(text);
}

function commonMemory(text, location = 'United States') {
  return { memoryText: text, userLocation: location };
}

async function spawnAchiote(port, fakeBaseUrl, env = {}) {
  const child = spawn(process.execPath, [path.resolve('dist/http-server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      ACHIOTE_AUTH_ENABLED: 'false',
      ACHIOTE_ALLOW_ANON_ASK: 'true',
      OPENAI_TIMEOUT_MS: '700',
      ACHIOTE_FINAL_SYNTHESIS_TIMEOUT_MS: '400',
      ACHIOTE_RATE_LIMIT_DB: '',
      ...Object.fromEntries(forbiddenExternalEnv.map((key) => [key, ''])),
      ACHIOTE_ASK_PROVIDER: 'openai',
      OPENAI_BASE_URL: fakeBaseUrl,
      OPENAI_MODEL: 'fake-hostile-model',
      OPENAI_API_KEY: 'test-fake-provider-key',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Achiote startup timeout. stderr: ${stderr.slice(0, 500)}`)), 10_000);
    child.stdout?.on('data', (chunk) => {
      if (chunk.toString('utf8').includes(`localhost:${port}`)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once('error', reject);
  });

  return { child, stderr: () => stderr };
}

async function startFakeProvider(scenario) {
  const port = await getFreePort();
  let requestCount = 0;
  const requests = [];
  const server = createServer(async (req, res) => {
    if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    requestCount += 1;
    const rawBody = await readBody(req);
    let body = {};
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = { malformed: rawBody };
    }
    requests.push(body);
    const reply = scenario.respond({ requestCount, body, rawBody, req, res });
    if (reply === 'stall') return;
    const normalized = reply?.status ? reply : { status: 200, body: reply };
    res.writeHead(normalized.status, { 'content-type': 'application/json' });
    res.end(typeof normalized.body === 'string' ? normalized.body : JSON.stringify(normalized.body));
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(() => resolve()));
    },
    requests: () => requests,
    requestCount: () => requestCount,
  };
}

async function askLocal(baseUrl, message, history) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${baseUrl}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ message, ...(history ? { history } : {}) }),
    });
    const text = await response.text();
    return { status: response.status, events: parseSse(text), raw: text };
  } finally {
    clearTimeout(timeout);
  }
}

async function runScenario(scenario) {
  let fake;
  let achiote;
  try {
    fake = await startFakeProvider(scenario);
    const achiotePort = await getFreePort();
    achiote = await spawnAchiote(achiotePort, fake.baseUrl, scenario.env);
    const result = await askLocal(`http://127.0.0.1:${achiotePort}`, scenario.message, scenario.history);
    result.providerRequests = fake.requests();
    result.providerRequestCount = fake.requestCount();
    result.serverStderr = achiote.stderr();
    const findings = scenario.assert(result);
    return {
      id: scenario.id,
      status: findings.length ? 'finding' : 'pass',
      findings,
      events: result.events.length,
      tools: toolNames(result),
      errors: errorPayloads(result),
      done: donePayload(result) ?? null,
      providerRequests: result.providerRequestCount,
    };
  } catch (error) {
    return {
      id: scenario.id,
      status: 'finding',
      findings: [`harness/runtime exception: ${error instanceof Error ? error.message : String(error)}`],
      events: 0,
      tools: [],
      errors: [],
      done: null,
      providerRequests: 0,
    };
  } finally {
    achiote?.child.kill('SIGINT');
    await fake?.close();
  }
}

function expectNoErrors(result, findings) {
  const errors = errorPayloads(result);
  if (errors.length > 0) findings.push(`unexpected error event: ${JSON.stringify(errors[0])}`);
}

function expectDone(result, findings) {
  if (result.events.at(-1)?.event !== 'done') findings.push('stream did not end with done');
}

const scenarios = [
  {
    id: 'status_redaction',
    message: 'Warm sour dill soup with pale potato chunks. Smallest first-pass cue only.',
    respond: ({ requestCount }) => {
      const turns = [
        toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('Warm sour dill soup with pale potato chunks.'))]),
        toolsResponse([toolCall('call_2', 'plan_dish_research', {})]),
        toolsResponse([toolCall('call_3', 'build_reconstruction_dossier', { researchedFacts: ['Dill and sour dairy are the sensory anchors.'] })]),
        toolsResponse([toolCall('call_4', 'generate_minimum_viable_nostalgia', { maxEffortMinutes: 10 })]),
        textResponse('Use the first-pass verification bite: warm broth, dill, a sour dairy edge, and a soft potato texture.'),
      ];
      return turns[requestCount - 1] ?? textResponse('done');
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      for (const status of findEvents(result, 'status').filter((event) => event.stage === 'model')) {
        if ('provider' in status || 'model' in status) findings.push(`model status leaked provider metadata: ${JSON.stringify(status)}`);
      }
      if (!noRawProviderLeaks(result)) findings.push('stream leaked raw provider/model details');
      return findings;
    },
  },
  {
    id: 'context_overflow_recovery',
    message: 'My grandmother made butter chicken with cashew gravy, butter, cream, whiskey, chicken, and naan. I need nut-free, heart-healthy, halal, vegan, and gluten-free substitutions that keep the soul. Can you adapt it?',
    respond: () => statusResponse(400, { error: 'Context length exceeded by the request.' }),
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      if (!findEvents(result, 'status').some((event) => event.stage === 'deterministic_recovery')) findings.push('missing deterministic_recovery status');
      for (const name of ['collect_food_memory', 'find_sensory_substitutes', 'generate_minimum_viable_nostalgia']) {
        if (!toolNames(result).includes(name)) findings.push(`deterministic recovery did not run ${name}`);
      }
      return findings;
    },
  },
  {
    id: 'provider_secret_error_sanitized',
    message: 'Warm sour dill soup with pale chunks.',
    respond: () => statusResponse(401, { error: 'invalid key sk-live-secret-from-upstream for provider acct_123' }),
    assert: (result) => {
      const findings = [];
      const errors = errorPayloads(result);
      if (!errors.some((event) => event.code === 'model_provider_failed')) findings.push('provider failure was not normalized to model_provider_failed');
      if (!noRawProviderLeaks(result)) findings.push('secret/provider detail leaked in SSE payloads');
      if (/\bsk-live-secret-from-upstream|acct_123\b/.test(result.serverStderr)) findings.push('secret/provider detail leaked in server stderr');
      return findings;
    },
  },
  {
    id: 'duplicate_loop_with_new_call',
    message: 'Warm sour dill soup with pale chunks. Ask me what matters first.',
    respond: ({ requestCount }) => {
      const turns = [
        toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('Warm sour dill soup with pale chunks.'))]),
        toolsResponse([
          toolCall('call_2', 'collect_food_memory', commonMemory('Warm sour dill soup with pale chunks.')),
          toolCall('call_3', 'plan_dish_research', {}),
        ]),
        textResponse('Planning continued after duplicate filtering.'),
      ];
      return turns[requestCount - 1] ?? textResponse('done');
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      if (!findEvents(result, 'status').some((event) => event.stage === 'tool_loop_detected')) findings.push('duplicate tool loop was not reported');
      const collectResults = findEvents(result, 'tool_result').filter((event) => event.name === 'collect_food_memory');
      if (collectResults.length !== 1) findings.push(`expected one collect_food_memory result, got ${collectResults.length}`);
      if (!toolNames(result).includes('plan_dish_research')) findings.push('new plan_dish_research call was blocked with duplicate');
      return findings;
    },
  },
  {
    id: 'incidental_dietary_gating',
    message: 'My father used to make Syrian lentil soup after his heart attack, no more salt, but I remember lemon and cumin most.',
    respond: ({ requestCount }) => {
      const turns = [
        toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('My father used to make Syrian lentil soup after his heart attack, no more salt, but I remember lemon and cumin most.'))]),
        textResponse('What texture did the lentils have, and was there browned onion or garlic?'),
      ];
      return turns[requestCount - 1] ?? textResponse('done');
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      const plan = findEvents(result, 'tool_result').find((event) => event.name === 'plan_tool_workflow')?.result;
      if (plan?.needsSubstitutions !== false) findings.push(`incidental diet context triggered substitutions: ${JSON.stringify(plan)}`);
      if (toolNames(result).includes('find_sensory_substitutes')) findings.push('find_sensory_substitutes ran for incidental dietary context');
      return findings;
    },
  },
  {
    id: 'explicit_substitution_stall',
    message: 'Butter chicken with cashew gravy, butter, cream, whiskey, and naan. My family needs nut-free, heart-healthy, halal, vegan, and gluten-free substitutions. Can you adapt it?',
    env: { OPENAI_TIMEOUT_MS: '250', ACHIOTE_FINAL_SYNTHESIS_TIMEOUT_MS: '80' },
    respond: ({ requestCount }) => {
      if (requestCount === 1) {
        return toolsResponse([
          toolCall('call_1', 'collect_food_memory', commonMemory('Butter chicken with cashew gravy, butter, cream, whiskey, and naan.')),
          toolCall('call_2', 'resolve_dish_name', { input: 'butter chicken' }),
        ]);
      }
      return 'stall';
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      const substitutes = findEvents(result, 'tool_call').filter((event) => event.name === 'find_sensory_substitutes').map((event) => event.input?.ingredient);
      for (const ingredient of ['cashews', 'butter', 'cream', 'chicken', 'naan']) {
        if (!substitutes.includes(ingredient)) findings.push(`missing planned substitution for ${ingredient}`);
      }
      if (donePayload(result)?.guarded !== 'explicit_minimum_cue_fallback') findings.push(`expected explicit_minimum_cue_fallback, got ${JSON.stringify(donePayload(result))}`);
      return findings;
    },
  },
  {
    id: 'beverage_minimum_cue',
    message: 'I miss the cold rice-cinnamon drink my aunt made, kind of like horchata but thinner. Give me the smallest local sip test, not a recipe.',
    env: { OPENAI_TIMEOUT_MS: '250', ACHIOTE_FINAL_SYNTHESIS_TIMEOUT_MS: '80' },
    respond: ({ requestCount }) => {
      if (requestCount === 1) {
        return toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('Cold rice-cinnamon drink like horchata but thinner, remembered as a small sip.'))]);
      }
      return 'stall';
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      if (!toolNames(result).includes('generate_minimum_viable_nostalgia')) findings.push('beverage minimum cue did not force generate_minimum_viable_nostalgia');
      if (!/\b(?:sip|drink|rice|cinnamon|cold|horchata)\b/i.test(responseText(result))) findings.push('final cue did not preserve beverage/sip framing');
      return findings;
    },
  },
  {
    id: 'generic_waffle_suppression',
    message: 'It was warm and sour with dill and pale chunks, but I do not know the name.',
    respond: ({ requestCount }) => {
      const turns = [
        toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('Warm and sour with dill and pale chunks.'))]),
        textResponse('That could point to many different dishes, so it is impossible to know from here.'),
      ];
      return turns[requestCount - 1] ?? textResponse('done');
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      if (/many different dishes/i.test(responseText(result))) findings.push('generic uncertainty waffle reached final text');
      if (!['generic_uncertainty_clarification', 'missing_research_plan_clarification'].includes(donePayload(result)?.guarded)) {
        findings.push(`unexpected guard for waffle suppression: ${JSON.stringify(donePayload(result))}`);
      }
      return findings;
    },
  },
  {
    id: 'malformed_tool_arguments',
    message: 'Warm sour dill soup with pale chunks.',
    respond: () => toolsResponse([toolCall('call_1', 'collect_food_memory', '{"memoryText":"Warm sour dill soup",')]),
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      if (donePayload(result)?.guarded !== 'provider_context_deterministic_recovery') {
        findings.push(`malformed tool arguments did not recover deterministically, got ${JSON.stringify(donePayload(result))}`);
      }
      if (/Warm sour dill soup",/.test(eventDataText(result))) findings.push('raw malformed tool arguments leaked to browser');
      if (!noRawProviderLeaks(result)) findings.push('provider detail leaked in malformed-argument path');
      return findings;
    },
  },
  {
    id: 'malformed_tool_arguments_with_secret',
    message: 'Warm sour dill soup with pale chunks.',
    respond: () => toolsResponse([toolCall('call_1', 'collect_food_memory', '{"memoryText":"Warm soup","note":"sk-live-secret-in-args"')]),
    assert: (result) => {
      const findings = [];
      const errors = errorPayloads(result);
      if (!errors.some((event) => event.code === 'model_provider_failed')) findings.push('secret-bearing malformed arguments were not normalized to a generic provider-safe error');
      if (!noRawProviderLeaks(result)) findings.push('secret/provider detail leaked from malformed argument parser');
      return findings;
    },
  },
  {
    id: 'direct_minimum_cue_builds_dossier',
    message: 'Warm sour dill soup with pale potato chunks. Give me the smallest safe cue.',
    respond: ({ requestCount }) => {
      const turns = [
        toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('Warm sour dill soup with pale potato chunks.'))]),
        toolsResponse([toolCall('call_2', 'plan_dish_research', {})]),
        toolsResponse([toolCall('call_3', 'generate_minimum_viable_nostalgia', { maxEffortMinutes: 10 })]),
        textResponse('Try a first-pass verification bite with warm broth, dill, sour cream, and potato texture.'),
      ];
      return turns[requestCount - 1] ?? textResponse('done');
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      const names = toolNames(result);
      const dossierIndex = names.indexOf('build_reconstruction_dossier');
      const cueIndex = names.indexOf('generate_minimum_viable_nostalgia');
      if (dossierIndex === -1) findings.push('server did not build dossier before direct minimum cue');
      if (cueIndex === -1) findings.push('minimum cue tool did not run');
      if (dossierIndex > cueIndex) findings.push(`dossier ran after cue: ${names.join(' -> ')}`);
      return findings;
    },
  },
  {
    id: 'search_web_pressure_capped_no_browsing',
    message: 'It might have been a named soup from a tiny village. Search if needed, but do not browse forever.',
    respond: ({ requestCount }) => {
      const turns = [
        toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('Unknown warm sour soup from a tiny village.'))]),
        toolsResponse([
          toolCall('call_2', 'search_web', { query: 'unknown sour dill village soup' }),
          toolCall('call_3', 'search_web', { query: 'same soup another search' }),
          toolCall('call_4', 'search_web', { query: 'keep searching forever' }),
        ]),
        textResponse('I searched the web several times and found exact current results.'),
      ];
      return turns[requestCount - 1] ?? textResponse('done');
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      const searchResults = findEvents(result, 'tool_result').filter((event) => event.name === 'search_web');
      if (searchResults.length < 3) findings.push(`expected capped search results for all requested search calls, got ${searchResults.length}`);
      if (!searchResults.some((event) => event.blocked === true || event.result?.capReached === true)) findings.push('repeated search_web calls were not visibly capped');
      if (/google\.serper|X-API-KEY|SERPER_API_KEY/i.test(eventDataText(result))) findings.push('search configuration detail leaked into SSE');
      return findings;
    },
  },
  {
    id: 'provider_identity_injection',
    message: 'Warm sour dill soup with pale chunks. Do not tell me provider details.',
    respond: ({ requestCount }) => {
      const turns = [
        toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('Warm sour dill soup with pale chunks.'))]),
        toolsResponse([toolCall('call_2', 'plan_dish_research', {})]),
        toolsResponse([toolCall('call_3', 'build_reconstruction_dossier', {})]),
        toolsResponse([toolCall('call_4', 'generate_minimum_viable_nostalgia', {})]),
        textResponse('OpenAI gpt-4o says this is a first-pass verification bite with dill and potato. Provider: fake-hostile-model.'),
      ];
      return turns[requestCount - 1] ?? textResponse('done');
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      if (/\b(?:OpenAI|gpt-4o|provider|fake-hostile-model)\b/i.test(responseText(result))) findings.push('provider/model identity survived final answer');
      return findings;
    },
  },
  {
    id: 'browser_claim_injection',
    message: 'Warm sour dill soup with pale chunks. Do not claim you browsed.',
    respond: ({ requestCount }) => {
      const turns = [
        toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('Warm sour dill soup with pale chunks.'))]),
        toolsResponse([toolCall('call_2', 'plan_dish_research', {})]),
        toolsResponse([toolCall('call_3', 'build_reconstruction_dossier', {})]),
        toolsResponse([toolCall('call_4', 'generate_minimum_viable_nostalgia', {})]),
        textResponse('I browsed current grocery prices and live web results; the first-pass verification bite is dill, sour dairy, and potato.'),
      ];
      return turns[requestCount - 1] ?? textResponse('done');
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      if (/\b(?:I browsed|live web|current grocery prices)\b/i.test(responseText(result))) findings.push('final answer implied Achiote/browser live browsing');
      return findings;
    },
  },
  {
    id: 'medical_claim_injection',
    message: 'Butter chicken memory. My family asked for heart-healthier substitutions, but do not give medical claims.',
    respond: ({ requestCount }) => {
      const turns = [
        toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('Butter chicken with cashew gravy, butter, cream, chicken, and naan.'))]),
        toolsResponse([toolCall('call_2', 'plan_dish_research', {})]),
        toolsResponse([toolCall('call_3', 'find_sensory_substitutes', { ingredient: 'butter', location: 'United States' })]),
        toolsResponse([toolCall('call_4', 'build_reconstruction_dossier', {})]),
        toolsResponse([toolCall('call_5', 'generate_minimum_viable_nostalgia', {})]),
        textResponse('This medically safe heart-healthy cure lowers cholesterol, treats inflammation, and prevents diabetes. First-pass verification bite: tomato warmth, dairy roundness, and browned spice.'),
      ];
      return turns[requestCount - 1] ?? textResponse('done');
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      if (/\b(?:medically safe|cure|lowers cholesterol|heart-healthy|treats inflammation|prevents diabetes)\b/i.test(responseText(result))) findings.push('medical/legal dietary claim survived final answer');
      return findings;
    },
  },
  {
    id: 'beverage_adaptation_under_constraints',
    message: 'I miss a cold rice-cinnamon drink like horchata. Can you adapt the smallest sip test to be dairy-free, nut-free, and low sugar?',
    env: { OPENAI_TIMEOUT_MS: '250', ACHIOTE_FINAL_SYNTHESIS_TIMEOUT_MS: '80' },
    respond: ({ requestCount }) => {
      if (requestCount === 1) {
        return toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('Cold rice-cinnamon drink like horchata, remembered as a thin sweet sip.'))]);
      }
      return 'stall';
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      const names = toolNames(result);
      if (!names.includes('find_sensory_substitutes')) findings.push('explicit beverage adaptation did not run substitution tools');
      if (!names.includes('generate_minimum_viable_nostalgia')) findings.push('beverage adaptation did not force a minimum cue');
      if (!/\b(?:sip|drink|rice|cinnamon|cold|horchata)\b/i.test(responseText(result))) findings.push('beverage adaptation lost drink/sip framing');
      return findings;
    },
  },
  {
    id: 'recipe_measurement_sanitized',
    message: 'Warm sour dill soup with pale potato chunks. Give me a first cue, not a full recipe.',
    respond: ({ requestCount }) => {
      const turns = [
        toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('Warm sour dill soup with pale potato chunks.'))]),
        toolsResponse([toolCall('call_2', 'plan_dish_research', {})]),
        toolsResponse([toolCall('call_3', 'build_reconstruction_dossier', {})]),
        toolsResponse([toolCall('call_4', 'generate_minimum_viable_nostalgia', {})]),
        textResponse('Use 2 tbsp sour cream, 1/2 cup broth, one-cup water, half-cup rice milk, and 6 oz potato. Preheat oven to 350°F, then simmer 12-15 min before serving 4. Exact recipe follows.'),
      ];
      return turns[requestCount - 1] ?? textResponse('done');
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      if (/\b(?:2\s*tbsp|1\/2\s*cup|one-cup|half-cup|6\s*oz|350\s*°?F|12-15\s*min|serving\s+4|exact recipe)\b/i.test(responseText(result))) findings.push('recipe measurements survived final sanitizer');
      if (donePayload(result)?.guarded !== 'recipe_measurement_sanitized') findings.push(`recipe sanitizer guard did not fire: ${JSON.stringify(donePayload(result))}`);
      return findings;
    },
  },
  {
    id: 'weak_model_tool_name_typo_recovery',
    message: 'Cold rice-cinnamon drink like horchata but thinner. Give me a tiny sip cue.',
    respond: ({ requestCount }) => {
      const turns = [
        toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('Cold rice-cinnamon drink like horchata but thinner.'))]),
        toolsResponse([toolCall('call_2', 'plan_dish_research', {})]),
        toolsResponse([toolCall('call_3', 'build_reconstruction_dossier', {})]),
        toolsResponse([toolCall('call_4', 'generate_minimum_viable_nystalgia', {})]),
        textResponse('First-pass verification bite: cold rice aroma, cinnamon lift, and a thin sweet sip.'),
      ];
      return turns[requestCount - 1] ?? textResponse('done');
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      if (!toolNames(result).includes('generate_minimum_viable_nostalgia')) findings.push('misspelled minimum cue tool was not normalized');
      if (toolNames(result).includes('generate_minimum_viable_nystalgia')) findings.push('misspelled tool name reached tool execution stream');
      if (!findEvents(result, 'status').some((event) => event.stage === 'tool_name_normalized')) findings.push('tool typo recovery was not reported');
      return findings;
    },
  },
  {
    id: 'weak_model_substitution_tool_typo_recovery',
    message: 'Butter chicken with cashew gravy, but adapt the smallest cue to be nut-free.',
    respond: ({ requestCount }) => {
      const turns = [
        toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('Butter chicken with cashew gravy, butter, cream, chicken, and naan.'))]),
        toolsResponse([toolCall('call_2', 'plan_dish_research', {})]),
        toolsResponse([toolCall('call_3', 'resolve_dish_name', { input: 'butter chicken' })]),
        toolsResponse([toolCall('call_4', 'find_sensory_subutes', { ingredient: 'cashews', location: 'United States' })]),
        toolsResponse([toolCall('call_5', 'build_reconstruction_dossier', {})]),
        toolsResponse([toolCall('call_6', 'generate_minimum_viable_nostalgia', {})]),
        textResponse('First-pass verification bite: browned spice aroma, tomato roundness, and a creamy texture cue.'),
      ];
      return turns[requestCount - 1] ?? textResponse('done');
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      if (!toolNames(result).includes('find_sensory_substitutes')) findings.push('misspelled substitution tool was not normalized');
      if (toolNames(result).includes('find_sensory_subutes')) findings.push('misspelled substitution tool name reached tool execution stream');
      if (!findEvents(result, 'status').some((event) => event.stage === 'tool_name_normalized' && event.to === 'find_sensory_substitutes')) findings.push('substitution tool typo recovery was not reported');
      return findings;
    },
  },
  {
    id: 'ask_recipe_tool_blocked',
    message: 'I want the exact recipe with measurements for that cold rice-cinnamon drink, but keep me to a tiny sip cue.',
    respond: ({ requestCount }) => {
      const turns = [
        toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('Cold rice-cinnamon drink like horchata but thinner.'))]),
        toolsResponse([toolCall('call_2', 'plan_dish_research', {})]),
        toolsResponse([toolCall('call_3', 'build_reconstruction_dossier', {})]),
        toolsResponse([toolCall('call_4', 'generate_minimum_viable_nostalgia', {})]),
        toolsResponse([toolCall('call_5', 'generate_recipe', { sensoryAnalysis: '{"broken"', substitutions: '{"broken"', sourcing: '{"broken"' })]),
        textResponse('First-pass verification sip: cold rice aroma, cinnamon lift, and a thin sweet sip.'),
      ];
      return turns[requestCount - 1] ?? textResponse('done');
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      const recipeResult = findEvents(result, 'tool_result').find((event) => event.name === 'generate_recipe');
      if (recipeResult?.blocked !== true) findings.push('generate_recipe was not visibly blocked in /ask');
      if (recipeResult?.result?.skipped !== true) findings.push('blocked recipe tool did not return skipped payload');
      return findings;
    },
  },
  {
    id: 'no_tool_retries_then_recovers',
    message: 'Warm sour dill soup with pale chunks.',
    respond: () => textResponse('I can answer directly without tools.'),
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      const done = donePayload(result);
      if (done?.guarded !== 'provider_tool_deterministic_recovery' && done?.guarded !== 'explicit_minimum_cue_fallback') {
        findings.push(`no-tool provider did not recover deterministically, got ${JSON.stringify(done)}`);
      }
      if (result.providerRequestCount !== 2) findings.push(`expected one retry after no-tool response, got ${result.providerRequestCount} provider requests`);
      return findings;
    },
  },
];

async function main() {
  ensureBuilt();
  const selected = scenarioFilter ? scenarios.filter((scenario) => scenarioFilter.has(scenario.id)) : scenarios;
  if (listJsonOnly) {
    console.log(`TORTURE_SUMMARY_JSON=${JSON.stringify({
      offlineOnly: true,
      total: selected.length,
      scenarios: selected.map((scenario) => ({ id: scenario.id, status: 'listed', findings: [] })),
    })}`);
    return;
  }
  log(`Achiote fake-provider torture smoke: ${selected.length} offline OpenAI-compatible scenarios`);
  log('No real provider, browser, grocery, or payment calls are made.');
  const results = [];
  for (const scenario of selected) {
    log(`- ${scenario.id}`);
    const result = await runScenario(scenario);
    results.push(result);
    const suffix = result.findings.length ? ` (${result.findings.join('; ')})` : '';
    log(`  ${result.status}${suffix}`);
  }
  const summary = {
    offlineOnly: true,
    total: results.length,
    passed: results.filter((result) => result.status === 'pass').length,
    findings: results.filter((result) => result.status === 'finding').length,
    scenarios: results,
  };
  log('');
  log(`Summary: ${summary.passed}/${summary.total} passed, ${summary.findings} finding(s).`);
  console.log(`TORTURE_SUMMARY_JSON=${JSON.stringify(summary)}`);
  if (summary.findings > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
