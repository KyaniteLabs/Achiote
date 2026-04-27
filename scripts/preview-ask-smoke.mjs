#!/usr/bin/env node

const rawBaseUrl = process.env.ACHIOTE_PREVIEW_URL || 'http://127.0.0.1:3000';
const askUrl = normalizeAskUrl(rawBaseUrl);
const timeoutMs = Number.parseInt(process.env.ACHIOTE_PREVIEW_TIMEOUT_MS || '180000', 10);

const buyExactDishPatterns = [
  /buy (?:a|the)\s+.{0,40}(?:carima[nñ]ola|chikki|bake and shark|fried fish sandwich|coconut sweet|candy|dulce|masa real|pastel(?:es)?)/gi,
  /go (?:find|get|purchase)\s+.{0,40}(?:carima[nñ]ola|chikki|bake and shark|coconut sweet|pastel(?:es)?)/gi,
];

const cases = [
  {
    id: 'typo_carimanola',
    message: 'I had something in Panama that sounded like carimanolla or carimanola. Fried, golden, kind of yuca-ish outside with savory meat inside. I live in Seattle now. Give me the first cheap local test, not a full recipe.',
    expect: [/carima[nñ]ola|carimanola/i, /yuca|cassava/i, /meat|beef|savory/i, /first|tiny|minimum|verification/i],
  },
  {
    id: 'soundalike_chikki',
    message: 'My coworker brought a crunchy brown peanut sweet from India years ago. The name sounded like chicky or cheeky. It snapped, then got sticky. I am in Denver now. What is the smallest local verification bite?',
    expect: [/chikki/i, /peanut/i, /sugar|jaggery|caramel/i, /snap|sticky|brittle/i, /first|tiny|minimum|verification/i],
  },
  {
    id: 'sensory_no_name_local_test',
    message: 'I do not know the name. In Trinidad I had a hot fried fish sandwich with sharp orange sauce. I live in Portland now. I need a cheap grocery-store test that tells us if we are on the right track.',
    expect: [/Trinidad|Trinidadian|bake and shark|fish/i, /lime|vinegar|acid|tang/i, /chile|pepper|hot|heat/i, /first|tiny|minimum|verification|right track/i],
  },
  {
    id: 'explicit_minimum_cue_abroad',
    message: 'I remember a white coconut sweet from a school festival abroad. Grainy sugar crystals, a little chewy, not chocolate. I live in Ohio now. Please give me the minimum local test I can make cheaply tonight.',
    expect: [/coconut/i, /sugar/i, /grainy|crystal|crystalline|chewy/i, /Ohio|local|grocery|pantry/i, /first|tiny|minimum|verification/i],
  },
  {
    id: 'correct_mistakes_not_literal',
    message: 'My family in Puerto Rico called it pastelay or pastellay. I might be spelling it wrong. Porky, wrapped, holiday-ish, yellow-orange seasoning smell. I live in Florida now. Correct my mistake and give me the smallest cheap local test.',
    expect: [/pasteles|pastel/i, /spelling|probably|likely|sounds like|correct|your .{0,40}(?:pastelay|pastellay)/i, /achiote|annatto|saz[oó]n|orange/i, /pork/i, /first-pass|verification|tiny check|revise|rule out|smallest/i],
  },
];

function parseSse(text) {
  return text.split('\n\n').filter(Boolean).map((block) => {
    const lines = block.split('\n');
    return {
      event: lines.find((line) => line.startsWith('event: '))?.slice(7),
      data: lines.filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n'),
    };
  });
}

function parseData(event) {
  try {
    return JSON.parse(event.data);
  } catch {
    return event.data;
  }
}

function normalizeAskUrl(value) {
  const normalized = value.trim().replace(/\/+$/, '');
  return normalized.endsWith('/ask') ? normalized : `${normalized}/ask`;
}

function isNegatedPurchase(text, matchIndex) {
  const before = text.slice(Math.max(0, matchIndex - 42), matchIndex);
  return /(?:do not|don(?:['\u2019])?t|never|avoid|instead of|rather than)\s+$/i.test(before);
}

function rejectedExactDishPurchases(text) {
  const rejected = [];
  for (const pattern of buyExactDishPatterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (!isNegatedPurchase(text, match.index ?? 0)) {
        rejected.push(pattern);
        break;
      }
    }
  }
  return rejected;
}

function headers() {
  const result = { 'Content-Type': 'application/json' };
  if (process.env.ACHIOTE_API_KEY) result['x-api-key'] = process.env.ACHIOTE_API_KEY;
  if (process.env.ACHIOTE_DEMO_PASSWORD) result['x-demo-password'] = process.env.ACHIOTE_DEMO_PASSWORD;
  return result;
}

async function ask(testCase) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${testCase.id} timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    const response = await fetch(askUrl, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ message: testCase.message }),
      signal: controller.signal,
    });
    const body = await response.text();
    const events = parseSse(body);
    const errors = events.filter((event) => event.event === 'error').map(parseData);
    const text = events.filter((event) => event.event === 'text').map(parseData).join('');
    const toolNames = events.filter((event) => event.event === 'tool_call').map((event) => parseData(event).name);
    const statuses = events.filter((event) => event.event === 'status').map(parseData);
    const done = [...events].reverse().find((event) => event.event === 'done');
    const runtime = statuses.find((status) => status.stage === 'model') ?? {};
    const missing = testCase.expect.filter((pattern) => !pattern.test(text));
    const rejected = rejectedExactDishPurchases(text);
    const pass = response.ok && errors.length === 0 && Boolean(done) && missing.length === 0 && rejected.length === 0;
    return {
      id: testCase.id,
      pass,
      status: response.status,
      runtime,
      tools: toolNames,
      done: done ? parseData(done) : null,
      errors,
      missing: missing.map(String),
      rejected: rejected.map(String),
      text,
    };
  } finally {
    clearTimeout(timer);
  }
}

let failures = 0;
console.log(`Preview /ask smoke target: ${askUrl}`);

for (const testCase of cases) {
  console.log(`\n=== ${testCase.id} ===`);
  const result = await ask(testCase);
  console.log(JSON.stringify({
    pass: result.pass,
    status: result.status,
    runtime: result.runtime,
    tools: result.tools,
    done: result.done,
    errors: result.errors,
    missing: result.missing,
    rejected: result.rejected,
  }, null, 2));
  console.log(result.text.slice(0, 700));
  if (!result.pass) failures += 1;
}

if (failures > 0) {
  console.error(`\n${failures} preview /ask quality case(s) failed.`);
  process.exit(1);
}

console.log('\nAll preview /ask quality cases passed.');
