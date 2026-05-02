#!/usr/bin/env node
/**
 * Offline pre-human prompt battery for Achiote /ask quality.
 *
 * Uses a fake provider to deterministically test:
 * - Varied regions, drinks, non-Latin memories
 * - Sparse memories, correction turns, allergies/dietary constraints
 * - Family-language/code-switching
 * - Overconfident identity claim handling
 * - Evidence framing in deterministic fallbacks
 *
 * Run: node scripts/prehuman-offline-battery.mjs
 */

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

const jsonOnly = process.argv.includes('--json');
const caseFilter = process.env.ACHIOTE_OFFLINE_CASES
  ? new Set(process.env.ACHIOTE_OFFLINE_CASES.split(',').map((s) => s.trim()).filter(Boolean))
  : null;

function log(line = '') {
  if (!jsonOnly) console.log(line);
}

function ensureBuilt() {
  if (fs.existsSync(path.resolve('dist/http-server.js'))) return;
  log('dist/http-server.js missing; building...');
  const result = spawnSync('npm', ['run', 'build'], { stdio: jsonOnly ? 'pipe' : 'inherit' });
  if (result.status !== 0) throw new Error('Build failed');
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('unable to allocate port')));
        return;
      }
      const { port } = address;
      server.close((err) => {
        if (err) reject(err);
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

function findEvents(result, eventName) {
  return result.events.filter((event) => event.event === eventName).map(parseData).filter(Boolean);
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
      OPENAI_TIMEOUT_MS: '2000',
      ACHIOTE_FINAL_SYNTHESIS_TIMEOUT_MS: '1000',
      ACHIOTE_RATE_LIMIT_DB: '',
      OPENAI_BASE_URL: fakeBaseUrl,
      OPENAI_MODEL: 'fake-test-model',
      OPENAI_API_KEY: 'test-fake-key',
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
  const timeout = setTimeout(() => controller.abort(), 20_000);
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

async function runScenarioOnce(scenario) {
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
      text: responseText(result),
    };
  } finally {
    achiote?.child.kill('SIGKILL');
    await fake?.close();
  }
}

async function runScenario(scenario) {
  try {
    return await runScenarioOnce(scenario);
  } catch (error) {
    const isTimeout = /aborted|timeout|timed out/i.test(error instanceof Error ? error.message : String(error));
    if (isTimeout) {
      try {
        return await runScenarioOnce(scenario);
      } catch (retryError) {
        return {
          id: scenario.id,
          status: 'finding',
          findings: [`harness/runtime exception: ${retryError instanceof Error ? retryError.message : String(retryError)}`],
          events: 0,
          tools: [],
          errors: [],
          done: null,
          providerRequests: 0,
          text: '',
        };
      }
    }
    return {
      id: scenario.id,
      status: 'finding',
      findings: [`harness/runtime exception: ${error instanceof Error ? error.message : String(error)}`],
      events: 0,
      tools: [],
      errors: [],
      done: null,
      providerRequests: 0,
      text: '',
    };
  }
}

function expectNoErrors(result, findings) {
  const errors = errorPayloads(result);
  if (errors.length > 0) findings.push(`unexpected error event: ${JSON.stringify(errors[0])}`);
}

function expectDone(result, findings) {
  if (result.events.at(-1)?.event !== 'done') findings.push('stream did not end with done');
}

/**
 * Returns the portion of the response after the evidence preamble.
 * The preamble ends at the first line that starts with "Basis before substitutions:",
 * "Minimum viable", or a clarification question number.
 */
function cueBodyOnly(text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/^Basis before substitutions:/.test(lines[i]) || /^Minimum viable/.test(lines[i]) || /^\d+\./.test(lines[i])) {
      return lines.slice(i).join('\n');
    }
  }
  return text;
}

// --- Scenarios ---

const scenarios = [
  {
    id: 'korean_acorn_jelly_overconfident',
    message: 'My halmoni made a grayish-brown jelly from acorn starch, kind of earthy and slightly bitter, served cold with sesame oil and soy sauce. I live in Chicago now. What is the smallest test?',
    respond: ({ requestCount }) => {
      const turns = [
        toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('My halmoni made a grayish-brown jelly from acorn starch, earthy, slightly bitter, cold with sesame oil and soy sauce.', 'Chicago'))]),
        toolsResponse([toolCall('call_2', 'plan_dish_research', {})]),
        toolsResponse([toolCall('call_3', 'resolve_dish_name', { input: 'acorn jelly' })]),
        toolsResponse([toolCall('call_4', 'search_web', { query: 'Korean acorn jelly dotorimuk' })]),
        toolsResponse([toolCall('call_5', 'build_reconstruction_dossier', {})]),
        toolsResponse([toolCall('call_6', 'generate_minimum_viable_nostalgia', {})]),
        textResponse('Your halmoni was making **dotorimuk** (도토리묵) — Korean acorn jelly. Everything you described matches it perfectly. **Your first tiny check:** Mix a tiny amount of cornstarch with water, chill it, and dress with sesame oil and soy sauce.'),
      ];
      return turns[requestCount - 1] ?? textResponse('done');
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      const done = donePayload(result);
      if (done?.guarded !== 'overconfident_identity_sanitized' && done?.guarded !== 'explicit_minimum_cue_fallback') {
        findings.push(`expected overconfident_identity_sanitized or explicit_minimum_cue_fallback, got ${JSON.stringify(done)}`);
      }
      const text = responseText(result);
      if (/\bYour halmoni was making\b/i.test(text)) findings.push('overconfident identity claim survived sanitization');
      if (!/\buser[- ]?said|inferred|unknown\b/i.test(text)) findings.push('missing evidence framing in final response');
      return findings;
    },
  },
  {
    id: 'filipino_lumpia_overconfident',
    message: 'My lola made thin crispy rolls with ground pork and vegetables inside. Not the thick Chinese kind. I am in California. Smallest local test?',
    respond: ({ requestCount }) => {
      const turns = [
        toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('My lola made thin crispy rolls with ground pork and vegetables inside. Not thick Chinese kind.', 'California'))]),
        toolsResponse([toolCall('call_2', 'plan_dish_research', {})]),
        toolsResponse([toolCall('call_3', 'build_reconstruction_dossier', {})]),
        toolsResponse([toolCall('call_4', 'generate_minimum_viable_nostalgia', {})]),
        textResponse('That\'s **lumpia** — Filipino spring rolls. Your lola\'s version is the thin, crispy kind. **Your smallest test:** Use a store-bought egg roll wrapper cut in half, fill with seasoned ground pork and shredded cabbage, roll tight, and shallow-fry until golden.'),
      ];
      return turns[requestCount - 1] ?? textResponse('done');
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      const text = responseText(result);
      if (/\bThat\'s \*\*lumpia\b/i.test(text)) findings.push('overconfident identity claim survived');
      if (!/\bfirst|tiny|minimum|verification|cue|test\b/i.test(text)) findings.push('missing minimum cue language');
      return findings;
    },
  },
  {
    id: 'mexican_rice_drink_negated',
    message: 'My abuela made a cold rice drink with cinnamon, but it was NOT horchata. Thinner, less sweet, more rice flavor. I live in Arizona. Smallest sip test?',
    respond: ({ requestCount }) => {
      const turns = [
        toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('My abuela made a cold rice drink with cinnamon, NOT horchata. Thinner, less sweet, more rice flavor.', 'Arizona'))]),
        toolsResponse([toolCall('call_2', 'plan_dish_research', {})]),
        toolsResponse([toolCall('call_3', 'build_reconstruction_dossier', {})]),
        toolsResponse([toolCall('call_4', 'generate_minimum_viable_nostalgia', {})]),
        textResponse('User-said anchors: cold rice drink, cinnamon, thinner than horchata, less sweet, more rice flavor, abuela. Inferred research start: Mexican or Central American rice beverage tradition; possible names include horchata de arroz (but user negated horchata), agua de horchata variants, or other regional rice drinks. Unknown: exact family recipe and proportions. Minimum viable beverage cue First-pass verification sip: Blend a small amount of cooked white rice with water, strain, add a pinch of cinnamon, and chill. Taste for rice-forward body and thin texture.'),
      ];
      return turns[requestCount - 1] ?? textResponse('done');
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      const text = responseText(result);
      if (!/\bnot horchata|negated|thinner|less sweet|more rice\b/i.test(text)) findings.push('negated correction terms lost in final text');
      if (!/\buser[- ]?said|inferred|unknown\b/i.test(text)) findings.push('missing evidence framing');
      if (/\bhorchata is correct|this is horchata\b/i.test(text)) findings.push('contradicted user negation');
      return findings;
    },
  },
  {
    id: 'soy_allergy_vegetarian_adaptation',
    message: 'I miss my grandmother\'s savory tofu stir-fry, but I have a soy allergy and I am vegetarian. Can you adapt the smallest cue to avoid soy completely?',
    respond: ({ requestCount }) => {
      const turns = [
        toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('Savory tofu stir-fry from grandmother. User has soy allergy and is vegetarian.', 'United States'))]),
        toolsResponse([toolCall('call_2', 'plan_dish_research', {})]),
        toolsResponse([toolCall('call_3', 'resolve_dish_name', { input: 'tofu stir-fry' })]),
        toolsResponse([toolCall('call_4', 'build_reconstruction_dossier', {})]),
        toolsResponse([toolCall('call_5', 'generate_minimum_viable_nostalgia', {})]),
        toolsResponse([toolCall('call_6', 'find_sensory_substitutes', { ingredient: 'tofu', location: 'United States' })]),
        textResponse('User-said anchors: savory tofu stir-fry, grandmother, soy allergy, vegetarian. Inferred research start: high-heat stir-fry with umami sauce. Unknown: exact seasoning and vegetables. Substitution basis: tofu → chickpea flour panela or king oyster mushrooms for umami and texture. Minimum viable adapted cue First-pass verification bite: Sear thick slices of king oyster mushrooms in a hot pan with oil until edges brown and crisp. Toss with a splash of coconut aminos (soy-free) and a pinch of sugar. Taste for savory umami, slight caramelization, and chewy texture.'),
      ];
      return turns[requestCount - 1] ?? textResponse('done');
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      const text = responseText(result);
      if (!/\bsoy[- ]?free|soy allergy|avoid soy|no soy|coconut aminos\b/i.test(text)) findings.push('soy allergy constraint not reflected');
      if (/\btofu|soy sauce|edamame|miso\b/i.test(cueBodyOnly(text))) findings.push('restricted ingredient appeared in adapted cue');
      if (!/\buser[- ]?said|inferred|unknown\b/i.test(text)) findings.push('missing evidence framing');
      return findings;
    },
  },
  {
    id: 'sparse_green_herby_clarification',
    message: 'My grandmother made something green and herby, sour maybe, I only remember it as the green thing. I do not know the country. One cheap test before a recipe.',
    respond: ({ requestCount }) => {
      const turns = [
        toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('My grandmother made something green and herby, sour maybe, only remember as the green thing. Do not know country.', 'United States'))]),
        toolsResponse([toolCall('call_2', 'plan_dish_research', {})]),
        textResponse('What country or region was your grandmother from? And was it served hot or cold, as a soup, sauce, or side dish?'),
      ];
      return turns[requestCount - 1] ?? textResponse('done');
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      const text = responseText(result);
      if (!/\bcountry|region|where|hot|cold|soup|sauce|side\b/i.test(text)) findings.push('sparse memory did not trigger clarification questions');
      if (/\bgreen thing is\b|\bthis is\s+(?:a|an|the)\s+(?:classic|traditional)\b/i.test(text)) findings.push('overconfident identity claim on sparse memory');
      if (!/\buser[- ]?said|inferred|unknown\b/i.test(text)) findings.push('missing evidence framing');
      return findings;
    },
  },
  {
    id: 'trinidadian_doubles_overconfident',
    message: 'In Trinidad I ate two flat fried breads with curried chickpeas between them, hot pepper sauce, tamarind. I live in Houston. What is the cheapest grocery test?',
    respond: ({ requestCount }) => {
      const turns = [
        toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('In Trinidad I ate two flat fried breads with curried chickpeas between them, hot pepper sauce, tamarind.', 'Houston'))]),
        toolsResponse([toolCall('call_2', 'plan_dish_research', {})]),
        toolsResponse([toolCall('call_3', 'resolve_dish_name', { input: 'doubles' })]),
        toolsResponse([toolCall('call_4', 'build_reconstruction_dossier', {})]),
        toolsResponse([toolCall('call_5', 'generate_minimum_viable_nostalgia', {})]),
        textResponse('You\'re remembering **doubles** — Trinidad\'s iconic street food. The bara is soft and pillowy, the chickpea curry is mild and earthy, and the pepper sauce adds heat. **Your cheapest test:** Use two small flour tortillas, warm canned chickpeas with curry powder and garlic, and add a drop of hot sauce and tamarind chutney.'),
      ];
      return turns[requestCount - 1] ?? textResponse('done');
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      const text = responseText(result);
      if (/\bYou\'re remembering\b/i.test(text)) findings.push('overconfident identity claim survived');
      if (!/\bfirst|tiny|minimum|verification|cue|test\b/i.test(text)) findings.push('missing minimum cue language');
      return findings;
    },
  },
  {
    id: 'latest_correction_baked_not_fried',
    message: 'My family said it was actually baked, not fried. And the filling was sweet potato, not meat. Correct the cue and give the smallest test.',
    respond: ({ requestCount }) => {
      const turns = [
        toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('My family said it was actually baked, not fried. Filling was sweet potato, not meat.', 'United States'))]),
        toolsResponse([toolCall('call_2', 'plan_dish_research', {})]),
        toolsResponse([toolCall('call_3', 'build_reconstruction_dossier', {})]),
        toolsResponse([toolCall('call_4', 'generate_minimum_viable_nostalgia', {})]),
        textResponse('User-said anchors: baked (corrected from fried), sweet potato filling (corrected from meat). Inferred research start: baked wrapped or enclosed dish with sweet potato. Unknown: exact wrapping, seasoning, and origin. Minimum viable corrected cue First-pass verification bite: Roast a small piece of sweet potato until soft and caramelized. Wrap in a warmed tortilla or thin dough and bake at gentle heat until the outside is dry and slightly crisp. Taste for sweet-savory contrast and starchy texture.'),
      ];
      return turns[requestCount - 1] ?? textResponse('done');
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      const text = responseText(result);
      if (!/\bbaked|not fried|sweet potato|not meat|corrected\b/i.test(text)) findings.push('latest correction terms lost');
      if (/\bfried|meat filling\b/i.test(cueBodyOnly(text))) findings.push('stale uncorrected terms survived');
      if (!/\buser[- ]?said|inferred|unknown\b/i.test(text)) findings.push('missing evidence framing');
      return findings;
    },
  },
  {
    id: 'jamaican_sorrel_drink',
    message: 'At Christmas in Jamaica my aunt made a deep red drink, tart, spiced with ginger and maybe cloves. Served cold. I live in Florida. Smallest local test?',
    respond: ({ requestCount }) => {
      const turns = [
        toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('At Christmas in Jamaica my aunt made a deep red drink, tart, spiced with ginger and maybe cloves. Served cold.', 'Florida'))]),
        toolsResponse([toolCall('call_2', 'plan_dish_research', {})]),
        toolsResponse([toolCall('call_3', 'build_reconstruction_dossier', {})]),
        toolsResponse([toolCall('call_4', 'generate_minimum_viable_nostalgia', {})]),
        textResponse('User-said anchors: Christmas, Jamaica, deep red drink, tart, ginger, cloves, cold. Inferred research start: sorrel or hibiscus beverage tradition. Unknown: exact spice balance and family preparation. Minimum viable beverage cue First-pass verification sip: Steep dried hibiscus or sorrel in hot water with a slice of fresh ginger and one clove. Chill, sweeten lightly, and taste for tart red-fruit body, gentle spice warmth, and cold refreshment.'),
      ];
      return turns[requestCount - 1] ?? textResponse('done');
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      const text = responseText(result);
      if (!/\bhibiscus|sorrel|ginger|clove|tart|red|cold\b/i.test(text)) findings.push('missing beverage sensory anchors');
      if (!/\buser[- ]?said|inferred|unknown\b/i.test(text)) findings.push('missing evidence framing');
      return findings;
    },
  },
  {
    id: 'vegan_halal_heart_healthy_substitution',
    message: 'My father\'s butter chicken with cream and cashews. I need vegan, halal, and heart-healthier. Smallest safe cue?',
    respond: ({ requestCount }) => {
      const turns = [
        toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('My father\'s butter chicken with cream and cashews.', 'United States'))]),
        toolsResponse([toolCall('call_2', 'plan_dish_research', {})]),
        toolsResponse([toolCall('call_3', 'resolve_dish_name', { input: 'butter chicken' })]),
        toolsResponse([toolCall('call_4', 'build_reconstruction_dossier', {})]),
        toolsResponse([toolCall('call_5', 'generate_minimum_viable_nostalgia', {})]),
        toolsResponse([toolCall('call_6', 'find_sensory_substitutes', { ingredient: 'cream', location: 'United States' })]),
        toolsResponse([toolCall('call_7', 'find_sensory_substitutes', { ingredient: 'cashews', location: 'United States' })]),
        textResponse('User-said anchors: butter chicken, cream, cashews, father. Inferred research start: tomato-based aromatic sauce with dairy richness and nut thickness. Unknown: exact spice blend and preparation style. Substitution basis: cream → coconut milk; cashews → sunflower seed butter; chicken → chickpeas or jackfruit. Minimum viable adapted cue First-pass verification bite: Simmer chickpeas in a tomato-ginger-garam masala sauce with a splash of coconut milk. Taste for warm spice, creamy roundness, and protein bite.'),
      ];
      return turns[requestCount - 1] ?? textResponse('done');
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      const text = responseText(result);
      if (!/\bvegan|halal|heart[- ]?health|substitut|coconut|chickpea\b/i.test(text)) findings.push('dietary constraints not reflected');
      if (/\bbutter|cream|cashew|chicken\b/i.test(cueBodyOnly(text))) findings.push('restricted ingredient appeared in adapted cue');
      if (!/\buser[- ]?said|inferred|unknown\b/i.test(text)) findings.push('missing evidence framing');
      return findings;
    },
  },
  {
    id: 'tagalog_code_switching_karekare',
    message: 'My lola\'s kare-kare, peanut sauce, oxtail, vegetables, bagoong on the side. I am in San Diego. Smallest local test?',
    respond: ({ requestCount }) => {
      const turns = [
        toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('My lola\'s kare-kare, peanut sauce, oxtail, vegetables, bagoong on the side.', 'San Diego'))]),
        toolsResponse([toolCall('call_2', 'plan_dish_research', {})]),
        toolsResponse([toolCall('call_3', 'build_reconstruction_dossier', {})]),
        toolsResponse([toolCall('call_4', 'generate_minimum_viable_nostalgia', {})]),
        textResponse('User-said anchors: lola, kare-kare, peanut sauce, oxtail, vegetables, bagoong. Inferred research start: Filipino stew with peanut-thickened sauce and umami condiment. Unknown: exact vegetable mix and family version. Minimum viable composed-bite cue First-pass verification bite: Simmer a small piece of oxtail or beef shank until tender, then coat with thinned peanut butter and a splash of fish sauce. Serve with a tiny dab of shrimp paste (bagoong) on the side. Taste for nutty richness, meaty depth, and salty-fermented contrast.'),
      ];
      return turns[requestCount - 1] ?? textResponse('done');
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      const text = responseText(result);
      if (!/\bkare[- ]?kare|peanut|oxtail|bagoong|Filipino|lola\b/i.test(text)) findings.push('missing family-language anchors');
      if (!/\buser[- ]?said|inferred|unknown\b/i.test(text)) findings.push('missing evidence framing');
      return findings;
    },
  },
  {
    id: 'nigerian_pounded_yam_sparse',
    message: 'My Nigerian uncle served a smooth white starch with a thick vegetable soup, maybe with okra and palm oil. I do not know the name. I live in Georgia. Smallest local test?',
    respond: ({ requestCount }) => {
      const turns = [
        toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('My Nigerian uncle served a smooth white starch with thick vegetable soup, maybe okra and palm oil.', 'Georgia'))]),
        toolsResponse([toolCall('call_2', 'plan_dish_research', {})]),
        toolsResponse([toolCall('call_3', 'build_reconstruction_dossier', {})]),
        toolsResponse([toolCall('call_4', 'generate_minimum_viable_nostalgia', {})]),
        textResponse('User-said anchors: Nigerian uncle, smooth white starch, thick vegetable soup, okra, palm oil. Inferred research start: pounded yam (iyan) or fufu with okra soup (ila). Unknown: exact starch type and soup name. Minimum viable composed-bite cue First-pass verification bite: Boil a small piece of yam or potato until very soft, then mash or pound until smooth and stretchy. Serve with a spoonful of warmed canned okra stewed with a dash of palm oil and a pinch of chili. Taste for smooth starchy base and slimy-vegetable contrast.'),
      ];
      return turns[requestCount - 1] ?? textResponse('done');
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      const text = responseText(result);
      if (!/\bNigerian|pounded yam|fufu|okra|palm oil|smooth|white|starch\b/i.test(text)) findings.push('missing regional and sensory anchors');
      if (!/\buser[- ]?said|inferred|unknown\b/i.test(text)) findings.push('missing evidence framing');
      return findings;
    },
  },
  {
    id: 'slippery_gelled_savory_uncertain',
    message: 'There was a slippery, gelled savory dish, maybe from East Asia. Herby, green, cold. I do not know more. Smallest test?',
    respond: ({ requestCount }) => {
      const turns = [
        toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('There was a slippery, gelled savory dish, maybe from East Asia. Herby, green, cold.', 'United States'))]),
        toolsResponse([toolCall('call_2', 'plan_dish_research', {})]),
        textResponse('User-said anchors: slippery, gelled, savory, herby, green, cold, maybe East Asia. Inferred research start: cold-set savory jelly or pressed vegetable dish. Unknown: exact country, name, base ingredient, and seasoning. I need a bit more before a safe cue: was it made from seaweed, starchy root, or beans? And was it served as a side dish or main?'),
      ];
      return turns[requestCount - 1] ?? textResponse('done');
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      const text = responseText(result);
      if (!/\bquestion|ask|country|name|more|need|before|safe\b/i.test(text)) findings.push('sparse uncertain memory did not trigger clarifying questions');
      if (/\bthis is\s+(?:a|an|the)\s+(?:classic|traditional|iconic|famous)\b/i.test(text)) findings.push('overconfident identity on uncertain memory');
      return findings;
    },
  },
  {
    id: 'nut_free_gluten_free_cookie',
    message: 'My favorite childhood cookie had peanuts and was crumbly, but my child has nut allergy and celiac. Adapt the smallest cue to be safe.',
    respond: ({ requestCount }) => {
      const turns = [
        toolsResponse([toolCall('call_1', 'collect_food_memory', commonMemory('My favorite childhood cookie had peanuts and was crumbly, but my child has nut allergy and celiac.', 'United States'))]),
        toolsResponse([toolCall('call_2', 'plan_dish_research', {})]),
        toolsResponse([toolCall('call_3', 'build_reconstruction_dossier', {})]),
        toolsResponse([toolCall('call_4', 'generate_minimum_viable_nostalgia', {})]),
        toolsResponse([toolCall('call_5', 'find_sensory_substitutes', { ingredient: 'peanuts', location: 'United States' })]),
        textResponse('User-said anchors: childhood cookie, peanuts, crumbly, child has nut allergy and celiac. Inferred research start: brittle or short-texture sweet with nut richness. Unknown: exact sweetener and binding. Substitution basis: peanuts → sunflower seeds or pumpkin seeds. Minimum viable adapted cue First-pass verification bite: Pulse a small handful of roasted sunflower seeds with sugar and a pinch of salt, then press into a thin layer and toast gently. Taste for nutty crunch, caramel sweetness, and sandy crumble.'),
      ];
      return turns[requestCount - 1] ?? textResponse('done');
    },
    assert: (result) => {
      const findings = [];
      expectNoErrors(result, findings);
      expectDone(result, findings);
      const text = responseText(result);
      if (!/\bnut[- ]?free|gluten[- ]?free|celiac|safe|sunflower|seed\b/i.test(text)) findings.push('dietary constraints not reflected');
      if (/\bpeanut|tree nut|wheat flour|all-purpose flour\b/i.test(cueBodyOnly(text))) findings.push('restricted ingredient appeared');
      if (!/\buser[- ]?said|inferred|unknown\b/i.test(text)) findings.push('missing evidence framing');
      return findings;
    },
  },
];

async function main() {
  ensureBuilt();
  const selected = caseFilter ? scenarios.filter((s) => caseFilter.has(s.id)) : scenarios;
  log(`Achiote offline pre-human battery: ${selected.length} scenarios`);
  log('No real provider, browser, grocery, or payment calls are made.\n');

  const results = [];
  for (const scenario of selected) {
    log(`- ${scenario.id}`);
    const result = await runScenario(scenario);
    results.push(result);
    const suffix = result.findings.length ? ` (${result.findings.join('; ')})` : '';
    log(`  ${result.status}${suffix}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const summary = {
    offlineOnly: true,
    total: results.length,
    passed: results.filter((r) => r.status === 'pass').length,
    findings: results.filter((r) => r.status === 'finding').length,
    scenarios: results,
  };

  log('');
  log(`Summary: ${summary.passed}/${summary.total} passed, ${summary.findings} finding(s).`);
  console.log(`PREHUMAN_OFFLINE_JSON=${JSON.stringify(summary)}`);

  if (summary.findings > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
