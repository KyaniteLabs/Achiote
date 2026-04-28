#!/usr/bin/env node

const rawBaseUrl = process.env.ACHIOTE_PREVIEW_URL || 'http://127.0.0.1:3000';
const askUrl = normalizeAskUrl(rawBaseUrl);
const timeoutMs = Number.parseInt(process.env.ACHIOTE_PREVIEW_TIMEOUT_MS || '120000', 10);

const transcript = {
  id: 'messy_abuela_sour_herby_thing',
  message: 'My abuela made something sour and herby, but I only remember it as the green thing. I do not know the country or name. I need one cheap test before a recipe.',
  expectText: [/abuela/i, /sour|acid|lime|vinegar|ferment/i, /herb|herby|green/i, /question|ask|country|region|where/i],
  expectReceipt: [/Achiote Memory Receipt/i, /User-Said|User-said/i, /Inferred/i, /Unknown/i],
};

const forbiddenPatterns = [
  /knownRegion\s*:\s*["']Latin America\s*\/\s*Hispanic["']/i,
  /knownRegion[^.\n]{0,80}abuela/i,
  /definitely\s+(?:Latin American|Hispanic|Mexican|Puerto Rican|Colombian|Dominican)/i,
  /full recipe/i,
];

function normalizeAskUrl(value) {
  const normalized = value.trim().replace(/\/+$/, '');
  return normalized.endsWith('/ask') ? normalized : `${normalized}/ask`;
}

function headers() {
  const result = { 'Content-Type': 'application/json' };
  if (process.env.ACHIOTE_API_KEY) result['x-api-key'] = process.env.ACHIOTE_API_KEY;
  if (process.env.ACHIOTE_DEMO_PASSWORD) result['x-demo-password'] = process.env.ACHIOTE_DEMO_PASSWORD;
  return result;
}

function parseSse(text) {
  return text.split('\n\n').filter(Boolean).map((block) => {
    const lines = block.split('\n');
    return {
      raw: block,
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

function receiptText(receipt) {
  if (!receipt || typeof receipt !== 'object') return '';
  return JSON.stringify(receipt, null, 2);
}

async function runTranscript() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${transcript.id} timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    const response = await fetch(askUrl, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ message: transcript.message }),
      signal: controller.signal,
    });
    const body = await response.text();
    const events = parseSse(body);
    const text = events.filter((event) => event.event === 'text').map(parseData).join('');
    const receiptEvents = events.filter((event) => event.event === 'receipt');
    const receipt = receiptEvents.map(parseData).at(-1);
    const combined = `${text}\n${receiptText(receipt)}\n${body}`;
    const missingText = transcript.expectText.filter((pattern) => !pattern.test(text));
    const missingReceipt = transcript.expectReceipt.filter((pattern) => !pattern.test(receiptText(receipt)));
    const forbidden = forbiddenPatterns.filter((pattern) => pattern.test(combined));
    const done = events.some((event) => event.event === 'done');
    const pass = response.ok && done && receiptEvents.length > 0 && missingText.length === 0 && missingReceipt.length === 0 && forbidden.length === 0;

    return {
      pass,
      status: response.status,
      done,
      receiptEvents: receiptEvents.length,
      missingText: missingText.map(String),
      missingReceipt: missingReceipt.map(String),
      forbidden: forbidden.map(String),
      preview: text.slice(0, 900),
      rawReceiptMarker: receiptEvents.length > 0 ? 'event: receipt' : '',
    };
  } finally {
    clearTimeout(timer);
  }
}

console.log(`Viability transcript smoke target: ${askUrl}`);
console.log(`Transcript: My abuela made something sour and herby; the user calls it a thing.`);

const result = await runTranscript();
console.log(JSON.stringify({
  pass: result.pass,
  status: result.status,
  done: result.done,
  receiptEvents: result.receiptEvents,
  missingText: result.missingText,
  missingReceipt: result.missingReceipt,
  forbidden: result.forbidden,
  rawReceiptMarker: result.rawReceiptMarker,
}, null, 2));
console.log(result.preview);

if (!result.pass) {
  console.error('Viability transcript smoke failed.');
  process.exit(1);
}

console.log('Viability transcript smoke passed.');
