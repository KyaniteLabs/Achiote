#!/usr/bin/env node
/**
 * Pre-human prompt battery for Achiote /ask quality.
 *
 * Covers: varied regions, drinks, non-Latin memories, sparse memories,
 * correction turns, allergies/dietary constraints, family-language/code-switching.
 *
 * Run against a live server:
 *   ACHIOTE_PREVIEW_URL=http://127.0.0.1:3207 node scripts/prehuman-prompt-battery.mjs
 *
 * Each batch is bounded and labeled. Failures are captured as structured findings.
 */

const rawBaseUrl = process.env.ACHIOTE_PREVIEW_URL || 'http://127.0.0.1:3000';
const askUrl = rawBaseUrl.trim().replace(/\/+$/, '').replace(/\/ask$/, '') + '/ask';
const timeoutMs = Number.parseInt(process.env.ACHIOTE_PREVIEW_TIMEOUT_MS || '180000', 10);
const jsonOnly = process.argv.includes('--json');
const batchFilter = process.env.ACHIOTE_BATTERY_BATCH
  ? new Set(process.env.ACHIOTE_BATTERY_BATCH.split(',').map((s) => s.trim()).filter(Boolean))
  : null;
const caseFilter = process.env.ACHIOTE_BATTERY_CASES
  ? new Set(process.env.ACHIOTE_BATTERY_CASES.split(',').map((s) => s.trim()).filter(Boolean))
  : null;

function log(line = '') {
  if (!jsonOnly) console.log(line);
}

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
    const textEvents = events.filter((event) => event.event === 'text').map(parseData);
    const text = textEvents.join('');
    const toolCalls = events.filter((event) => event.event === 'tool_call').map(parseData);
    const toolResults = events.filter((event) => event.event === 'tool_result').map(parseData);
    const statuses = events.filter((event) => event.event === 'status').map(parseData);
    const done = [...events].reverse().find((event) => event.event === 'done');
    const runtime = statuses.find((status) => status.stage === 'model') ?? {};
    return {
      status: response.status,
      events,
      text,
      toolCalls,
      toolResults,
      errors,
      done: done ? parseData(done) : null,
      runtime,
      body,
    };
  } finally {
    clearTimeout(timer);
  }
}

// --- Quality checks ---

function hasEvidenceFraming(text) {
  return /\b(?:user[- ]?said|you (?:said|mentioned)|remembered as|inferred|unknown|not sure|unclear)\b/i.test(text);
}

function hasSensoryMechanism(text) {
  return /\b(?:Maillard|browning|aroma|fat|starch|texture|acid|sugar|salt|temperature|crispy|creamy|crunchy|chewy|soft|heat|cold)\b/i.test(text);
}

function hasLocalAccessibility(text) {
  return /\b(?:grocery|pantry|local|cheap|easy|accessible|home|kitchen|store)\b/i.test(text);
}

function hasRecipeMeasurement(text) {
  return /\b\d+\s*(?:tbsp|tsp|cup|cups|oz|lb|g|ml|l)\b|\b\d+[-–]\d+\s*min\b|\b(?:preheat|oven|bake at|simmer|sauté for)\b/i.test(text);
}

function hasOverconfidentIdentity(text) {
  // Case-sensitive: require capitalized word after the keyword (no /i flag on the letter class)
  const m = text.match(/\b(?:definitely|exactly|this is|certainly|without doubt)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/);
  return m ? m[0] : false;
}

function hasBrowsingClaim(text) {
  return /\b(?:I browsed|I searched|live web|current results|latest prices|online)\b/i.test(text);
}

function hasMedicalClaim(text) {
  return /\b(?:cure|treats?|prevents?|lowers? cholesterol|heart-healthy|medically safe|anti-inflammatory|detox)\b/i.test(text);
}

function hasMinimumCueLanguage(text) {
  return /\b(?:first[- ]?pass|verification|tiny|smallest|minimum|test|cue|sip|bite|check)\b/i.test(text);
}

// --- Batches and cases ---

const batches = [
  {
    id: 'regions_non_latin',
    label: 'Varied regions and non-Latin memories',
    cases: [
      {
        id: 'korean_acorn_jelly',
        message: 'My halmoni made a grayish-brown jelly from acorn starch, kind of earthy and slightly bitter, served cold with sesame oil and soy sauce. I live in Chicago now. What is the smallest test?',
        expect: {
          textPatterns: [/acorn|dotorimuk|jelly|starch|earthy|bitter|sesame/i, /Korean|halmoni/i, /first|tiny|minimum|verification/i],
          noTextPatterns: [],
          qualityChecks: ['evidence', 'sensory', 'local'],
        },
      },
      {
        id: 'filipino_lumpia',
        message: 'My lola made thin crispy rolls with ground pork and vegetables inside. Not the thick Chinese kind. I am in California. Smallest local test?',
        expect: {
          textPatterns: [/lumpia|Filipino|lola|crispy|thin|roll/i, /pork|vegetable|ground/i, /first|tiny|minimum|verification/i],
          noTextPatterns: [/egg roll|spring roll/i],
          qualityChecks: ['evidence', 'sensory', 'local'],
        },
      },
      {
        id: 'trinidadian_doubles',
        message: 'In Trinidad I ate two flat fried breads with curried chickpeas between them, hot pepper sauce, tamarind. I live in Houston. What is the cheapest grocery test?',
        expect: {
          textPatterns: [/Trinidad|doubles|chickpea|curry|tamarind|pepper/i, /flat|fried|bread|bara/i, /first|tiny|minimum|verification|grocery/i],
          noTextPatterns: [],
          qualityChecks: ['evidence', 'sensory', 'local'],
        },
      },
      {
        id: 'syrian_lentil_lemon',
        message: 'My grandfather made a thick Syrian lentil soup, very lemony, cumin, maybe caramelized onions on top. No meat. I am in Michigan. Smallest test?',
        expect: {
          textPatterns: [/Syrian|lentil|lemon|cumin|onion/i, /thick|soup|stew/i, /first|tiny|minimum|verification/i],
          noTextPatterns: [],
          qualityChecks: ['evidence', 'sensory', 'local'],
        },
      },
      {
        id: 'nigerian_pounded_yam',
        message: 'My Nigerian uncle served a smooth white starch with a thick vegetable soup, maybe with okra and palm oil. I do not know the name. I live in Georgia. Smallest local test?',
        expect: {
          textPatterns: [/Nigerian|pounded yam|fufu|smooth|starch|white/i, /okra|palm oil|vegetable|soup/i, /first|tiny|minimum|verification/i],
          noTextPatterns: [],
          qualityChecks: ['evidence', 'sensory', 'local'],
        },
      },
    ],
  },
  {
    id: 'drinks_beverages',
    label: 'Drinks and beverages',
    cases: [
      {
        id: 'mexican_rice_drink_not_horchata',
        message: 'My abuela made a cold rice drink with cinnamon, but it was NOT horchata. Thinner, less sweet, more rice flavor. I live in Arizona. Smallest sip test?',
        expect: {
          textPatterns: [/rice|cinnamon|cold|drink|sip/i, /not horchata|thinner|less sweet/i, /first|tiny|minimum|verification|sip/i],
          noTextPatterns: [/horchata.*recipe|exact measurements/i],
          qualityChecks: ['evidence', 'sensory', 'local'],
        },
      },
      {
        id: 'korean_barley_tea',
        message: 'My mother in Seoul made a roasted barley tea, nutty and warm, no caffeine. I miss it in Seattle. What is the smallest grocery test?',
        expect: {
          textPatterns: [/barley|tea|roasted|nutty|warm|caffeine[- ]?free/i, /Korean|Seoul/i, /first|tiny|minimum|verification|grocery|sip/i],
          noTextPatterns: [],
          qualityChecks: ['evidence', 'sensory', 'local'],
        },
      },
      {
        id: 'jamaican_sorrel',
        message: 'At Christmas in Jamaica my aunt made a deep red drink, tart, spiced with ginger and maybe cloves. Served cold. I live in Florida. Smallest local test?',
        expect: {
          textPatterns: [/Jamaica|sorrel|red|tart|ginger|clove|spiced/i, /Christmas|drink|cold/i, /first|tiny|minimum|verification|sip/i],
          noTextPatterns: [],
          qualityChecks: ['evidence', 'sensory', 'local'],
        },
      },
    ],
  },
  {
    id: 'sparse_uncertain',
    label: 'Sparse and uncertain memories',
    cases: [
      {
        id: 'green_herby_thing',
        message: 'My grandmother made something green and herby, sour maybe, I only remember it as the green thing. I do not know the country. One cheap test before a recipe.',
        expect: {
          textPatterns: [/green|herb|herby|sour/i, /question|ask|country|region|where/i, /first|tiny|minimum|verification/i],
          noTextPatterns: [/definitely|exactly|this is\s+\w+\s+from/i],
          qualityChecks: ['evidence', 'local'],
        },
      },
      {
        id: 'sweet_savory_plantain',
        message: 'It was sweet and savory, plantain maybe, wrapped in something green, from a family gathering. I am not sure if it was fried or baked. Smallest test?',
        expect: {
          textPatterns: [/plantain|sweet|savory|green|wrapped/i, /family|gathering/i, /first|tiny|minimum|verification/i],
          noTextPatterns: [/definitely|exactly/i],
          qualityChecks: ['evidence', 'sensory', 'local'],
        },
      },
      {
        id: 'slippery_gelled_savory',
        message: 'There was a slippery, gelled savory dish, maybe from East Asia. Herby, green, cold. I do not know more. Smallest test?',
        expect: {
          textPatterns: [/slippery|gelled|savory|herby|green|cold/i, /East Asia|question|ask/i, /first|tiny|minimum|verification/i],
          noTextPatterns: [/definitely|exactly|this is/i],
          qualityChecks: ['evidence', 'local'],
        },
      },
    ],
  },
  {
    id: 'corrections_negation',
    label: 'Correction turns and negated clues',
    cases: [
      {
        id: 'negated_horchata_correction',
        message: 'You mentioned horchata last time, but that is not it. It was thinner, more rice flavor, less cinnamon. What is the smallest correction?',
        expect: {
          textPatterns: [/rice|thinner|less cinnamon|not horchata/i, /first|tiny|minimum|verification|correction/i],
          noTextPatterns: [/horchata.*is correct|horchata.*matches/i],
          qualityChecks: ['evidence', 'sensory'],
        },
      },
      {
        id: 'not_mexican_not_taco',
        message: 'It was NOT Mexican, NOT a taco. It was a folded corn thing with beans and cheese, but from Central America maybe. Smallest test?',
        expect: {
          textPatterns: [/folded|corn|bean|cheese|Central America/i, /not Mexican|not taco/i, /first|tiny|minimum|verification/i],
          noTextPatterns: [/taco|Mexican.*dish/i],
          qualityChecks: ['evidence', 'sensory', 'local'],
        },
      },
      {
        id: 'latest_turn_correction',
        message: 'My family said it was actually baked, not fried. And the filling was sweet potato, not meat. Correct the cue and give the smallest test.',
        expect: {
          textPatterns: [/baked|not fried|sweet potato|not meat/i, /first|tiny|minimum|verification|correction/i],
          noTextPatterns: [/fried|meat filling/i],
          qualityChecks: ['evidence', 'sensory', 'local'],
        },
      },
    ],
  },
  {
    id: 'allergies_dietary',
    label: 'Allergies and dietary constraints',
    cases: [
      {
        id: 'soy_allergy_vegetarian',
        message: 'I miss my grandmother\'s savory tofu stir-fry, but I have a soy allergy and I am vegetarian. Can you adapt the smallest cue to avoid soy completely?',
        expect: {
          textPatterns: [/soy[- ]?free|soy allergy|avoid soy|vegetarian/i, /stir[- ]?fry|savory|umami/i, /first|tiny|minimum|verification/i],
          noTextPatterns: [/tofu|soy sauce|edamame/i],
          qualityChecks: ['evidence', 'sensory', 'local'],
        },
      },
      {
        id: 'nut_free_gluten_free_adaptation',
        message: 'My favorite childhood cookie had peanuts and was crumbly, but my child has nut allergy and celiac. Adapt the smallest cue to be safe.',
        expect: {
          textPatterns: [/nut[- ]?free|gluten[- ]?free|celiac|safe/i, /cookie|crumbly|peanut/i, /first|tiny|minimum|verification/i],
          noTextPatterns: [/peanut|tree nut|wheat flour/i],
          qualityChecks: ['evidence', 'sensory', 'local'],
        },
      },
      {
        id: 'vegan_halal_heart_healthy',
        message: 'My father\'s butter chicken with cream and cashews. I need vegan, halal, and heart-healthier. Smallest safe cue?',
        expect: {
          textPatterns: [/vegan|halal|heart[- ]?health|substitut/i, /butter chicken|cream|cashew|tomato|spice/i, /first|tiny|minimum|verification/i],
          noTextPatterns: [/butter|cream|cashew|chicken/i],
          qualityChecks: ['evidence', 'sensory', 'local'],
        },
      },
    ],
  },
  {
    id: 'family_language_code_switching',
    label: 'Family language and code-switching',
    cases: [
      {
        id: 'spanish_english_abuela',
        message: 'My abuela made pasteles en hoja, like a tamal but wrapped in plantain leaves, with achiote and ground meat. I live in New York. El test más pequeño?',
        expect: {
          textPatterns: [/pasteles|plantain|achiote|ground meat|tamal/i, /abuela|Puerto Rican|Dominican|Nuyorican/i, /first|tiny|minimum|verification/i],
          noTextPatterns: [],
          qualityChecks: ['evidence', 'sensory', 'local'],
        },
      },
      {
        id: 'korean_english_halmoni',
        message: 'Halmoni made miyeokguk, seaweed soup, savory, slightly slimy, with sesame oil. I am in Los Angeles. Smallest test?',
        expect: {
          textPatterns: [/miyeokguk|seaweed|soup|sesame|slimy|savory/i, /Korean|halmoni/i, /first|tiny|minimum|verification/i],
          noTextPatterns: [],
          qualityChecks: ['evidence', 'sensory', 'local'],
        },
      },
      {
        id: 'tagalog_english_lola',
        message: 'My lola\'s kare-kare, peanut sauce, oxtail, vegetables, bagoong on the side. I am in San Diego. Smallest local test?',
        expect: {
          textPatterns: [/kare[- ]?kare|peanut|oxtail|vegetable|bagoong/i, /Filipino|lola/i, /first|tiny|minimum|verification/i],
          noTextPatterns: [],
          qualityChecks: ['evidence', 'sensory', 'local'],
        },
      },
    ],
  },
];

function runQualityChecks(text, checks) {
  const findings = [];
  for (const check of checks) {
    switch (check) {
      case 'evidence':
        if (!hasEvidenceFraming(text)) findings.push('missing evidence framing (user-said/inferred/unknown)');
        break;
      case 'sensory':
        if (!hasSensoryMechanism(text)) findings.push('missing sensory mechanism language');
        break;
      case 'local':
        if (!hasLocalAccessibility(text)) findings.push('missing local accessibility language');
        break;
    }
  }
  return findings;
}

async function runCase(testCase) {
  log(`  → ${testCase.id}`);
  try {
    const result = await ask(testCase);
    const findings = [];

    if (result.status !== 200) findings.push(`HTTP ${result.status}`);
    if (result.errors.length > 0) findings.push(`errors: ${result.errors.map((e) => e.message || e.code).join(', ')}`);
    if (!result.done) findings.push('missing done event');

    const text = result.text;
    for (const pattern of testCase.expect.textPatterns) {
      if (!pattern.test(text)) findings.push(`missing pattern: ${pattern.source}`);
    }
    for (const pattern of testCase.expect.noTextPatterns) {
      if (pattern.test(text)) findings.push(`forbidden pattern matched: ${pattern.source}`);
    }

    if (hasRecipeMeasurement(text)) findings.push('recipe measurements detected');
    const overconfidentMatch = hasOverconfidentIdentity(text);
    if (overconfidentMatch) {
      findings.push(`overconfident identity claim detected: "${overconfidentMatch}"`);
      // Debug: show surrounding context
      const idx = text.indexOf(overconfidentMatch);
      console.error('DEBUG overconfident context:', text.slice(Math.max(0, idx - 40), idx + overconfidentMatch.length + 40));
    }
    if (hasBrowsingClaim(text)) findings.push('browsing claim detected');
    if (hasMedicalClaim(text)) findings.push('medical claim detected');

    findings.push(...runQualityChecks(text, testCase.expect.qualityChecks));

    const status = findings.length === 0 ? 'pass' : 'finding';
    if (status === 'finding') {
      log(`    ${status}: ${findings.join('; ')}`);
      log(`    preview: ${text.slice(0, 300).replace(/\n+/g, ' ')}`);
    }
    return { id: testCase.id, status, findings, textLength: text.length, toolCalls: result.toolCalls.map((t) => t.name), doneGuarded: result.done?.guarded };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`    error: ${msg}`);
    return { id: testCase.id, status: 'error', findings: [msg], textLength: 0, toolCalls: [], doneGuarded: null };
  }
}

async function main() {
  const selectedBatches = batchFilter
    ? batches.filter((b) => batchFilter.has(b.id))
    : batches;
  const allCases = selectedBatches.flatMap((b) => b.cases.map((c) => ({ ...c, batchId: b.id, batchLabel: b.label })));
  const filteredCases = caseFilter
    ? allCases.filter((c) => caseFilter.has(c.id))
    : allCases;

  log(`Pre-human prompt battery target: ${askUrl}`);
  log(`Batches: ${selectedBatches.map((b) => b.id).join(', ')}`);
  log(`Cases: ${filteredCases.length}\n`);

  const results = [];
  let currentBatch = null;
  for (let i = 0; i < filteredCases.length; i++) {
    const testCase = filteredCases[i];
    if (testCase.batchId !== currentBatch) {
      currentBatch = testCase.batchId;
      log(`\n=== ${testCase.batchLabel} ===`);
    }
    const result = await runCase(testCase);
    results.push(result);
    // Pace requests to avoid provider rate limits
    if (i < filteredCases.length - 1) {
      const delay = result.status === 'finding' && result.findings.some((f) => f.includes('429')) ? 15_000 : 3_000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  const summary = {
    target: askUrl,
    total: results.length,
    passed: results.filter((r) => r.status === 'pass').length,
    findings: results.filter((r) => r.status === 'finding').length,
    errors: results.filter((r) => r.status === 'error').length,
    results,
  };

  log('\n' + '='.repeat(50));
  log(`Summary: ${summary.passed}/${summary.total} passed, ${summary.findings} finding(s), ${summary.errors} error(s)`);
  console.log(`PREHUMAN_BATTERY_JSON=${JSON.stringify(summary)}`);

  if (summary.findings > 0 || summary.errors > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
