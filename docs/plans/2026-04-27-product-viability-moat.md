# Product Viability Moat Implementation Plan

**Goal:** Make Achiote clearly more valuable than generic ChatGPT, Claude, Google, or recipe apps by turning it into a food-memory forensics product with explicit evidence boundaries, a durable memory receipt, better feedback learning, and aligned public positioning.

**Architecture:** Keep the existing MCP-first engine and HTTP `/ask` flow. Add a structured inference ledger to the existing memory workflow, emit a portable memory receipt from the server, and make the static app and landing page sell the receipt-driven workflow instead of generic recipe search. No new runtime dependencies, no live grocery/price integrations, no raw prompt telemetry, and no README drift into SaaS marketing.

**Tech Stack:** TypeScript, Zod schemas, MCP tool registry, Node HTTP SSE, static HTML/CSS/JS, Vitest, dependency-free Node scripts, Stripe already present.

---

## Non-Negotiable Product Decisions

1. Public consumer positioning is: **"Recover the taste of a half-remembered family dish."**
2. Technical positioning is secondary: MCP/source-available belongs below the fold and in README/developer surfaces.
3. A broad inference such as "abuela suggests Spanish-speaking family context" is allowed only as an explicit inference. It must never be stored as user-said evidence and must never be enough to generate named candidate dishes.
4. The durable product artifact is the **Memory Receipt**: user-said clues, inferred context, researched/source-backed facts, unknowns, family questions, first tiny taste test, and what changed after feedback.
5. v1 does not store raw food memories server-side beyond existing operational logs. The app may render and download receipts client-side; server telemetry stays category/count based.
6. Pricing source of truth for this implementation is:
   - Free: 3 guided memories/month.
   - Personal: $9/month for 25 guided memories/month.
   - Personal Annual: $59/year.
   - Memory Pack: $49 one-time for 25 guided memories.
   - Family Archive: $39/month for 300 guided memories/month.
   - Family Archive Sprint: $149 one-time.
   - Commercial hosted MCP/API: from $299/month.
   - Commercial pilots: from $1,500.
7. Do not add new npm dependencies.
8. Do not add browsing, scraping, geocoding, grocery inventory, or live price lookup.
9. Do not put SaaS/business-plan content in `README.md`; product-facing copy belongs under `docs/landing/`.

## Acceptance Criteria

The implementation is complete only when all of these are true:

1. `/about` and `/ai-search` lead with food-memory forensics, not "MCP server".
2. `/app` offers a visible memory-receipt/export path after a successful answer.
3. The MCP schema and `/ask` transcript separate `userSaid`, `inferredContext`, `researched`, and `unknown`.
4. Sparse prompts like `My abuela made something sour and herby.` do not produce named candidate dishes unless the user supplies a region, ingredient, dish name fragment, or serving format.
5. The app can download a Markdown memory receipt without any backend persistence.
6. Feedback categories teach the product what failed: `closer`, `wrong_region`, `wrong_acid`, `wrong_texture`, `too_generic`, `too_hard`, and `missed_name_correction`.
7. `docs/landing/llms.txt`, `docs/landing/ai-search.html`, and landing-page JSON-LD all describe the same prices and same differentiated value proposition.
8. The plan is verified with `npm run check`, `npm run package:smoke`, `npm audit --audit-level=moderate`, `git diff --check`, and `npm pack --dry-run`.

---

### Task 1: Lock Public Positioning And Pricing In Tests

**Files:**
- Modify: `tests/launch-business-hardening.test.ts`
- Modify: `tests/ai-search-visibility.test.ts`
- Modify: `tests/docs-consistency.test.ts`

**Step 1: Add failing landing-positioning assertions**

In `tests/launch-business-hardening.test.ts`, add this test inside the existing `describe('launch business hardening', ...)` block:

```ts
it('positions Achiote as food-memory forensics before technical MCP framing', () => {
  const page = landing();
  const appPage = app();

  expect(page).toContain('Recover the taste of a half-remembered family dish');
  expect(page).toContain('food-memory forensics');
  expect(page).toContain('Memory Receipt');
  expect(page).toContain('one cheap taste test before a full recipe');
  expect(page.indexOf('Recover the taste of a half-remembered family dish')).toBeLessThan(page.indexOf('MCP'));
  expect(appPage).toContain('Food Memory Detective');
  expect(page).not.toContain('AI Food Memory Reconstruction | Source-Available MCP Server');
});
```

**Step 2: Add failing pricing alignment assertions**

In `tests/ai-search-visibility.test.ts`, extend the visible-facts test with exact pricing strings:

```ts
expect(page).toContain('Free includes 3 guided memories per month');
expect(page).toContain('Personal is $9/month for 25 guided memories');
expect(page).toContain('Personal Annual is $59/year');
expect(page).toContain('Memory Pack is $49 one-time for 25 guided memories');
expect(page).toContain('Family Archive is $39/month for 300 guided memories');
expect(page).toContain('Family Archive Sprint is $149 one-time');
expect(page).toContain('Commercial hosted MCP/API starts from $299/month');
expect(page).toContain('Commercial pilots start from $1,500');
expect(page).not.toContain('Pro is $19/month');
expect(page).not.toContain('$9 memory pack');
```

**Step 3: Add a docs consistency guard**

In `tests/docs-consistency.test.ts`, add:

```ts
it('keeps public pricing surfaces aligned', () => {
  const surfaces = [
    fs.readFileSync('docs/landing/index.html', 'utf8'),
    fs.readFileSync('docs/landing/ai-search.html', 'utf8'),
    fs.readFileSync('docs/landing/llms.txt', 'utf8'),
  ].join('\n');

  for (const required of [
    '$9/month',
    '$59/year',
    '$49 one-time',
    '$39/month',
    '$149 one-time',
    '$299/month',
    '$1,500',
  ]) {
    expect(surfaces).toContain(required);
  }
  expect(surfaces).not.toMatch(/\bPro\b[^.\n]*\$19/i);
});
```

**Step 4: Run the tests and confirm they fail**

Run:

```bash
npm test -- tests/launch-business-hardening.test.ts tests/ai-search-visibility.test.ts tests/docs-consistency.test.ts
```

Expected: FAIL because copy still does not consistently lead with the new positioning and one or more pricing strings are missing.

**Step 5: Commit only failing tests**

```bash
git add tests/launch-business-hardening.test.ts tests/ai-search-visibility.test.ts tests/docs-consistency.test.ts
git commit -m "Define the product moat in launch guardrails

The public product must sell food-memory forensics and a durable
memory receipt before developer implementation details.

Constraint: README remains MCP/skill focused by repository policy
Confidence: high
Scope-risk: narrow
Tested: focused tests expected to fail before implementation
Not-tested: copy implementation
"
```

---

### Task 2: Rewrite Public Positioning Surfaces

**Files:**
- Modify: `docs/landing/index.html`
- Modify: `docs/landing/ai-search.html`
- Modify: `docs/landing/llms.txt`
- Modify: `docs/landing/sample-reconstruction-artifact.md`
- Modify: `docs/LAUNCH_RUNBOOK.md`

**Step 1: Update landing metadata**

In `docs/landing/index.html`, replace the title and meta descriptions with:

```html
<title>Achiote — Food Memory Detective</title>
<meta name="description" content="Recover the taste of a half-remembered family dish. Achiote turns family food memories into evidence, questions, and one cheap taste test before a full recipe." />
<meta property="og:title" content="Achiote — Food Memory Detective" />
<meta property="og:description" content="Recover the taste of a half-remembered family dish with evidence-bounded food-memory forensics and a portable Memory Receipt." />
<meta name="twitter:title" content="Achiote — Food Memory Detective" />
<meta name="twitter:description" content="Recover the taste of a half-remembered family dish with evidence-bounded food-memory forensics and a portable Memory Receipt." />
```

**Step 2: Update hero copy**

Replace the first-viewport hero headline and supporting copy with these exact ideas. Preserve existing class names and layout:

```html
<p class="eyebrow">Food-memory forensics</p>
<h1>Recover the taste of a half-remembered family dish.</h1>
<p class="hero-copy">Achiote interviews the memory, separates evidence from inference, asks the right family questions, and gives you one cheap taste test before a full recipe.</p>
```

Primary CTA text:

```html
Try the memory detective
```

Secondary CTA text:

```html
See a Memory Receipt
```

**Step 3: Add a "Why not just ChatGPT?" section**

Add a full-width section before pricing with this visible content:

```html
<section id="different">
  <div class="container">
    <p class="eyebrow">Why this is different</p>
    <h2>Not recipe search. A forensic workflow for fragile memories.</h2>
    <div class="comparison-grid">
      <article>
        <h3>Generic AI</h3>
        <p>Often jumps from vague clues to plausible recipes.</p>
      </article>
      <article>
        <h3>Achiote</h3>
        <p>Labels what you said, what it inferred, what sources support, and what is still unknown.</p>
      </article>
      <article>
        <h3>The payoff</h3>
        <p>A portable Memory Receipt and one tiny test bite before you spend money or cook a full recipe.</p>
      </article>
    </div>
  </div>
</section>
```

Do not use nested cards. Use the existing layout style or a flat responsive grid.

**Step 4: Align pricing copy**

Ensure `docs/landing/index.html`, `docs/landing/ai-search.html`, and `docs/landing/llms.txt` contain exactly the pricing source of truth from the Non-Negotiable Product Decisions section. Remove all public `Pro $19` references.

**Step 5: Update sample artifact**

In `docs/landing/sample-reconstruction-artifact.md`, rename it visibly from a generic reconstruction artifact to:

```md
# Sample Memory Receipt
```

Ensure it contains these headings:

```md
## User-Said Evidence
## Inferred Context
## Researched Or Source-Backed Facts
## Unknowns
## Family Questions
## First Tiny Taste Test
## Feedback To Try Next
```

**Step 6: Update launch runbook**

In `docs/LAUNCH_RUNBOOK.md`, add a "Viability Smoke" section with:

```md
## Viability Smoke

Before spending on broad launch, test Achiote against generic AI on five sparse memories. A launch candidate must show:

- A visible Memory Receipt after a successful `/ask`.
- No named dish guesses from broad family words alone.
- At least one specific family question.
- One cheap taste test only after evidence is sufficient or the user explicitly requests a minimum test.
- Pricing surfaces aligned across `/`, `/ai-search`, and `/llms.txt`.
```

**Step 7: Run focused tests**

```bash
npm test -- tests/launch-business-hardening.test.ts tests/ai-search-visibility.test.ts tests/docs-consistency.test.ts
```

Expected: PASS.

**Step 8: Commit**

```bash
git add docs/landing/index.html docs/landing/ai-search.html docs/landing/llms.txt docs/landing/sample-reconstruction-artifact.md docs/LAUNCH_RUNBOOK.md tests/launch-business-hardening.test.ts tests/ai-search-visibility.test.ts tests/docs-consistency.test.ts
git commit -m "Position Achiote around food-memory forensics

The consumer-facing surfaces now sell the durable memory-receipt
workflow before implementation details, while AI-readable surfaces
share one pricing source of truth.

Constraint: README stays MCP/skill focused
Rejected: Lead with source-available MCP | too developer-centric for consumer launch
Confidence: high
Scope-risk: moderate
Tested: npm test -- tests/launch-business-hardening.test.ts tests/ai-search-visibility.test.ts tests/docs-consistency.test.ts
Not-tested: browser visual review
"
```

---

### Task 3: Add An Explicit Inference Ledger To Memory Intake

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/schemas/tool-schemas.ts`
- Modify: `src/lib/memory-workflow.ts`
- Modify: `tests/types.test.ts`
- Modify: `tests/memory-workflow.test.ts`
- Modify: `tests/memory-workflow-mcp.test.ts`

**Step 1: Add failing type tests**

In `tests/types.test.ts`, import `CollectedFoodMemory` and add:

```ts
it('CollectedFoodMemory separates inferred context from user-said region hints', () => {
  const memory: CollectedFoodMemory = {
    rawMemory: 'My abuela made something sour and herby.',
    normalizedMemory: 'My abuela made something sour and herby.',
    extractedClues: {
      possibleDishNames: [],
      culturalOrRegionalHints: [],
      rememberedIngredients: [],
      sensoryClues: ['sour/tangy'],
      occasions: ['grandmother/family context'],
    },
    inferredContext: {
      culturalOrRegional: [{
        label: 'Spanish-speaking family context',
        basis: 'User used the family word "abuela".',
        confidence: 'Low',
        evidenceKind: 'model_inferred',
        canSeedQuestions: true,
        canSeedCandidateDishes: false,
      }],
      language: [],
    },
    missingInformation: ['country, island, region, town, or community'],
    nextQuestions: ['Where was your abuela from?'],
    reassurance: "You don't need to spell it correctly or know the original language; sound-alikes and tiny clues are enough to start.",
  };

  expect(memory.extractedClues.culturalOrRegionalHints).toEqual([]);
  expect(memory.inferredContext.culturalOrRegional[0].canSeedCandidateDishes).toBe(false);
});
```

Expected initial result: TypeScript FAIL because `CollectedFoodMemory.inferredContext` does not exist.

**Step 2: Add failing workflow tests**

In `tests/memory-workflow.test.ts`, add:

```ts
it('keeps abuela as inferred context rather than user-said region evidence', () => {
  const memory = collectFoodMemory({
    memoryText: 'My abuela made something sour and herby.',
  });
  const plan = planDishResearch(memory);

  expect(memory.extractedClues.culturalOrRegionalHints).toEqual([]);
  expect(memory.inferredContext.culturalOrRegional).toEqual([
    expect.objectContaining({
      label: 'Spanish-speaking family context',
      confidence: 'Low',
      evidenceKind: 'model_inferred',
      canSeedQuestions: true,
      canSeedCandidateDishes: false,
    }),
  ]);
  expect(plan.hypotheses.map((hypothesis) => hypothesis.name)).not.toContain('Pozole Verde');
  expect(plan.questionsForUser.join(' ')).toMatch(/abuela|where/i);
});
```

**Step 3: Add the types**

In `src/lib/types.ts`, add:

```ts
export type EvidenceKind = 'user_said' | 'model_inferred' | 'source_researched' | 'unknown';

export interface InferredContextClue {
  label: string;
  basis: string;
  confidence: Confidence;
  evidenceKind: Extract<EvidenceKind, 'model_inferred'>;
  canSeedQuestions: boolean;
  canSeedCandidateDishes: boolean;
}

export interface InferredMemoryContext {
  culturalOrRegional: InferredContextClue[];
  language: InferredContextClue[];
}
```

Add this required field to `CollectedFoodMemory`:

```ts
inferredContext: InferredMemoryContext;
```

**Step 4: Add the schemas**

In `src/schemas/tool-schemas.ts`, add:

```ts
const inferredContextClueSchema = z.object({
  label: z.string(),
  basis: z.string(),
  confidence: confidenceSchema,
  evidenceKind: z.literal('model_inferred'),
  canSeedQuestions: z.boolean(),
  canSeedCandidateDishes: z.boolean(),
});

const inferredMemoryContextSchema = z.object({
  culturalOrRegional: z.array(inferredContextClueSchema),
  language: z.array(inferredContextClueSchema),
});
```

Then add to `collectedFoodMemorySchema`:

```ts
inferredContext: inferredMemoryContextSchema,
```

**Step 5: Implement deterministic inferred context**

In `src/lib/memory-workflow.ts`, add this helper near `extractRegionHints`:

```ts
function inferContextFromFamilyWords(lowerText: string): InferredMemoryContext {
  const culturalOrRegional: InferredContextClue[] = [];
  const language: InferredContextClue[] = [];

  if (includesAny(lowerText, ['abuela', 'abuelo'])) {
    culturalOrRegional.push({
      label: 'Spanish-speaking family context',
      basis: 'User used the family word "abuela" or "abuelo".',
      confidence: 'Low',
      evidenceKind: 'model_inferred',
      canSeedQuestions: true,
      canSeedCandidateDishes: false,
    });
    language.push({
      label: 'Spanish language clue',
      basis: 'The family word is Spanish, but it does not identify a country or dish.',
      confidence: 'Low',
      evidenceKind: 'model_inferred',
      canSeedQuestions: true,
      canSeedCandidateDishes: false,
    });
  }

  if (includesAny(lowerText, ['nonna', 'nonno'])) {
    culturalOrRegional.push({
      label: 'Italian-speaking family context',
      basis: 'User used the family word "nonna" or "nonno".',
      confidence: 'Low',
      evidenceKind: 'model_inferred',
      canSeedQuestions: true,
      canSeedCandidateDishes: false,
    });
  }

  return { culturalOrRegional, language };
}
```

Add imports for `InferredContextClue` and `InferredMemoryContext`.

In `collectFoodMemory`, compute:

```ts
const inferredContext = inferContextFromFamilyWords(lower);
```

Return it as:

```ts
inferredContext,
```

**Step 6: Use inferred context only for questions**

In `buildNextQuestions`, add an optional input:

```ts
inferredContext?: InferredMemoryContext;
```

When no user-said region exists but inferred context includes `Spanish-speaking family context`, prefer:

```ts
questions.push('Where was your abuela from? Even a country, island, city, or "I had it in ___" is enough.');
```

Do not add inferred context to:

- `culturalOrRegionalHints`
- `contextTerms`
- `searchQueries`
- `INFERRED_DISH_PATTERNS` matching
- hypothesis names

**Step 7: Update MCP tests**

In `tests/memory-workflow-mcp.test.ts`, extend the collect-memory expectations:

```ts
expect(collected.structuredContent).toHaveProperty('inferredContext');
```

For an `abuela` case, assert:

```ts
expect(collected.structuredContent?.inferredContext).toMatchObject({
  culturalOrRegional: [
    expect.objectContaining({
      label: 'Spanish-speaking family context',
      canSeedCandidateDishes: false,
    }),
  ],
});
```

**Step 8: Run focused tests**

```bash
npm run typecheck
npm test -- tests/types.test.ts tests/memory-workflow.test.ts tests/memory-workflow-mcp.test.ts
```

Expected: PASS.

**Step 9: Commit**

```bash
git add src/lib/types.ts src/schemas/tool-schemas.ts src/lib/memory-workflow.ts tests/types.test.ts tests/memory-workflow.test.ts tests/memory-workflow-mcp.test.ts
git commit -m "Separate inferred cultural context from user evidence

Family words such as abuela can guide better questions without
becoming region evidence or named-dish support.

Rejected: Put abuela-derived context into culturalOrRegionalHints | that makes model inference look user-supplied
Confidence: high
Scope-risk: moderate
Tested: npm run typecheck; npm test -- tests/types.test.ts tests/memory-workflow.test.ts tests/memory-workflow-mcp.test.ts
"
```

---

### Task 4: Add A Memory Receipt Data Model And Builder

**Files:**
- Create: `src/lib/memory-receipt.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/schemas/tool-schemas.ts`
- Modify: `src/tools/tool-registry.ts`
- Modify: `tests/tool-registry.test.ts`
- Create: `tests/memory-receipt.test.ts`
- Modify: `tests/package-metadata.test.ts`

**Step 1: Add failing receipt tests**

Create `tests/memory-receipt.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildMemoryReceipt, formatMemoryReceiptMarkdown } from '../src/lib/memory-receipt.js';

describe('memory receipt', () => {
  it('renders a portable evidence-bounded receipt', () => {
    const receipt = buildMemoryReceipt({
      memory: {
        rawMemory: 'My abuela made something sour and herby.',
        normalizedMemory: 'My abuela made something sour and herby.',
        extractedClues: {
          possibleDishNames: [],
          culturalOrRegionalHints: [],
          rememberedIngredients: [],
          sensoryClues: ['sour/tangy'],
          occasions: ['grandmother/family context'],
        },
        inferredContext: {
          culturalOrRegional: [{
            label: 'Spanish-speaking family context',
            basis: 'User used the family word "abuela".',
            confidence: 'Low',
            evidenceKind: 'model_inferred',
            canSeedQuestions: true,
            canSeedCandidateDishes: false,
          }],
          language: [],
        },
        missingInformation: ['country, island, region, town, or community'],
        nextQuestions: ['Where was your abuela from?'],
        reassurance: "You don't need to spell it correctly or know the original language; sound-alikes and tiny clues are enough to start.",
      },
      researchPlan: {
        researchRequired: true,
        hypotheses: [{
          name: 'Unidentified traditional dish',
          whyPossible: ['You mentioned: sour/tangy; grandmother/family context'],
          whatWouldConfirm: ['exact dish name or local nickname'],
          confidence: 'Low',
          researchRequired: true,
        }],
        searchQueries: [],
        preferredSourceTypes: ['family/community recipe sources'],
        factsToVerify: ['region'],
        questionsForUser: ['Where was your abuela from?'],
      },
      assistantText: 'Before I give you a tasting cue, I need one or two details.',
      createdAt: '2026-04-27T12:00:00.000Z',
    });

    expect(receipt.title).toBe('Achiote Memory Receipt');
    expect(receipt.evidence.userSaid).toEqual(['My abuela made something sour and herby.']);
    expect(receipt.evidence.inferred[0]).toContain('Spanish-speaking family context');
    expect(receipt.status).toBe('needs_more_clues');
    expect(receipt.nextBestQuestions).toContain('Where was your abuela from?');

    const markdown = formatMemoryReceiptMarkdown(receipt);
    expect(markdown).toContain('# Achiote Memory Receipt');
    expect(markdown).toContain('## User-Said Evidence');
    expect(markdown).toContain('## Inferred Context');
    expect(markdown).toContain('## Unknowns');
    expect(markdown).toContain('## Family Questions');
    expect(markdown).not.toContain('undefined');
  });
});
```

Expected initial result: FAIL because the module does not exist.

**Step 2: Add receipt types**

In `src/lib/types.ts`, add:

```ts
export type MemoryReceiptStatus = 'needs_more_clues' | 'first_test_ready' | 'recipe_handoff_ready';

export interface MemoryReceipt {
  title: 'Achiote Memory Receipt';
  createdAt: string;
  status: MemoryReceiptStatus;
  evidence: {
    userSaid: string[];
    inferred: string[];
    researched: string[];
    unknown: string[];
  };
  hypotheses: DishHypothesis[];
  nextBestQuestions: string[];
  firstTinyTasteTest?: {
    title: string;
    cue: string;
    estimatedTime: string;
  };
  assistantSummary: string;
}
```

**Step 3: Implement the receipt builder**

Create `src/lib/memory-receipt.ts`:

```ts
import type { CollectedFoodMemory, DishResearchPlan, MemoryReceipt, MinimumViableNostalgiaCue } from './types.js';

export function buildMemoryReceipt(input: {
  memory: CollectedFoodMemory;
  researchPlan?: DishResearchPlan;
  cue?: MinimumViableNostalgiaCue;
  assistantText?: string;
  createdAt?: string;
}): MemoryReceipt {
  const inferred = [
    ...input.memory.inferredContext.culturalOrRegional,
    ...input.memory.inferredContext.language,
  ].map((clue) => `${clue.label} (${clue.confidence} confidence): ${clue.basis}`);

  const unknown = [
    ...input.memory.missingInformation,
    ...(input.researchPlan?.factsToVerify ?? []),
  ].filter((value, index, array) => value && array.indexOf(value) === index);

  const status = input.cue
    ? 'first_test_ready'
    : 'needs_more_clues';

  return {
    title: 'Achiote Memory Receipt',
    createdAt: input.createdAt ?? new Date().toISOString(),
    status,
    evidence: {
      userSaid: [input.memory.rawMemory],
      inferred,
      researched: [],
      unknown,
    },
    hypotheses: input.researchPlan?.hypotheses ?? [],
    nextBestQuestions: (input.researchPlan?.questionsForUser.length
      ? input.researchPlan.questionsForUser
      : input.memory.nextQuestions).slice(0, 5),
    firstTinyTasteTest: input.cue
      ? {
          title: input.cue.title,
          cue: input.cue.cue,
          estimatedTime: input.cue.estimatedTime,
        }
      : undefined,
    assistantSummary: input.assistantText ?? '',
  };
}

export function formatMemoryReceiptMarkdown(receipt: MemoryReceipt): string {
  const list = (items: string[]) => items.length
    ? items.map((item) => `- ${item}`).join('\n')
    : '- None recorded yet.';

  return [
    '# Achiote Memory Receipt',
    '',
    `Created: ${receipt.createdAt}`,
    `Status: ${receipt.status}`,
    '',
    '## User-Said Evidence',
    list(receipt.evidence.userSaid),
    '',
    '## Inferred Context',
    list(receipt.evidence.inferred),
    '',
    '## Researched Or Source-Backed Facts',
    list(receipt.evidence.researched),
    '',
    '## Unknowns',
    list(receipt.evidence.unknown),
    '',
    '## Family Questions',
    list(receipt.nextBestQuestions),
    '',
    '## First Tiny Taste Test',
    receipt.firstTinyTasteTest
      ? `- ${receipt.firstTinyTasteTest.title}: ${receipt.firstTinyTasteTest.cue} (${receipt.firstTinyTasteTest.estimatedTime})`
      : '- Not ready yet. Answer the family questions first.',
    '',
    '## Assistant Summary',
    receipt.assistantSummary || '- No final summary recorded.',
    '',
  ].join('\n');
}
```

**Step 4: Add receipt schema**

In `src/schemas/tool-schemas.ts`, add `memoryReceiptOutputSchema` matching the `MemoryReceipt` type. Export it.

**Step 5: Add MCP tool**

In `src/tools/tool-registry.ts`, import `buildMemoryReceipt`, `formatMemoryReceiptMarkdown`, and `memoryReceiptOutputSchema`.

Add a tool after `build_reconstruction_dossier`:

```ts
createTool({
  name: 'build_memory_receipt',
  mcp: {
    title: 'Build Memory Receipt',
    description: 'Create a portable evidence-bounded receipt for a food-memory reconstruction session.',
    inputSchema: {
      memory: collectedFoodMemorySchema,
      researchPlan: dishResearchPlanSchema.optional(),
      assistantText: z.string().optional(),
    },
    outputSchema: memoryReceiptOutputSchema,
  },
  outputSchema: memoryReceiptOutputSchema,
  anthropicInputSchema: {
    type: 'object' as const,
    required: ['memory'],
    properties: {
      memory: { type: 'object' as const, description: 'Structured output from collect_food_memory' },
      researchPlan: { type: 'object' as const, description: 'Structured output from plan_dish_research' },
      assistantText: { type: 'string' as const, description: 'Final assistant-facing summary to include in the receipt' },
    },
  },
  execute: (raw) => {
    const input = asInput(raw);
    const receipt = buildMemoryReceipt({
      memory: memoryFromModelInput(input.memory),
      researchPlan: input.researchPlan as DishResearchPlan | undefined,
      assistantText: typeof input.assistantText === 'string' ? input.assistantText : undefined,
    });
    return output({ ...receipt }, formatMemoryReceiptMarkdown(receipt));
  },
}),
```

Ensure the tool appears after `build_reconstruction_dossier` in `TOOL_ORDER`.

**Step 6: Update registry tests**

In `tests/tool-registry.test.ts`, extend the expected tool list with `build_memory_receipt` and assert its schema validates:

```ts
const receipt = await executeToolDefinition('build_memory_receipt', {
  memory: collectedMemory,
  researchPlan,
}, defaultToolExecutionContext);
expect(outputSchemas.build_memory_receipt.safeParse(receipt.payload).success).toBe(true);
expect(receipt.content?.[0]?.text).toContain('# Achiote Memory Receipt');
```

**Step 7: Update package metadata test**

If `tests/package-metadata.test.ts` checks tool counts, increase the expected MCP tool count by 1.

**Step 8: Run focused tests**

```bash
npm run typecheck
npm test -- tests/memory-receipt.test.ts tests/tool-registry.test.ts tests/package-metadata.test.ts
```

Expected: PASS.

**Step 9: Commit**

```bash
git add src/lib/types.ts src/schemas/tool-schemas.ts src/lib/memory-receipt.ts src/tools/tool-registry.ts tests/memory-receipt.test.ts tests/tool-registry.test.ts tests/package-metadata.test.ts
git commit -m "Make the memory receipt a structured product artifact

Achiote now has a portable receipt object and MCP tool that preserve
evidence boundaries beyond the chat transcript.

Constraint: No backend persistence in v1
Rejected: Store full receipts server-side | privacy and launch-scope risk
Confidence: high
Scope-risk: moderate
Tested: npm run typecheck; npm test -- tests/memory-receipt.test.ts tests/tool-registry.test.ts tests/package-metadata.test.ts
"
```

---

### Task 5: Emit Memory Receipts From `/ask`

**Files:**
- Modify: `src/http-server.ts`
- Modify: `tests/ask-openai-provider.test.ts`
- Modify: `tests/ask-endpoint.test.ts`

**Step 1: Add failing `/ask` receipt test**

In `tests/ask-openai-provider.test.ts`, add a test where the fake model calls `collect_food_memory`, then `plan_dish_research`, then stops with text. Assert SSE contains `event: receipt` before `event: done`:

```ts
it('emits a memory receipt before done', async () => {
  // Reuse spawnAchioteServer and fakeOpenAi style from nearby tests.
  // Fake turns:
  // 1 collect_food_memory
  // 2 plan_dish_research
  // 3 final text "Before I give you a tasting cue..."
  const events = parseSse(await response.text());
  const receipt = events.find((event) => event.event === 'receipt');
  expect(receipt).toBeDefined();
  expect(JSON.parse(receipt!.data)).toMatchObject({
    title: 'Achiote Memory Receipt',
    status: 'needs_more_clues',
  });
  expect(events.map((event) => event.event).lastIndexOf('receipt')).toBeLessThan(events.map((event) => event.event).lastIndexOf('done'));
});
```

Expected initial result: FAIL because no `receipt` event exists.

**Step 2: Import receipt builder**

In `src/http-server.ts`, add:

```ts
import { buildMemoryReceipt } from './lib/memory-receipt.js';
```

**Step 3: Add helper**

Add below `type SseSender`:

```ts
function maybeSendMemoryReceipt(input: {
  toolPayloads: Record<string, unknown>;
  assistantText: string;
  send: SseSender;
}): void {
  const memory = input.toolPayloads.collect_food_memory as CollectedFoodMemory | undefined;
  if (!memory) return;
  const researchPlan = input.toolPayloads.plan_dish_research as DishResearchPlan | undefined;
  const cue = input.toolPayloads.generate_minimum_viable_nostalgia as MinimumViableNostalgiaCue | undefined;
  input.send('receipt', buildMemoryReceipt({
    memory,
    researchPlan,
    cue,
    assistantText: input.assistantText,
  }));
}
```

Import `DishResearchPlan` and `MinimumViableNostalgiaCue` types if not already imported.

**Step 4: Emit receipts on all successful answer paths**

Before each successful `send('done', ...)`, call:

```ts
maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
```

For guard paths that call `buildClarificationOnlyResponse(toolPayloads)`, store the response first:

```ts
const responseText = buildClarificationOnlyResponse(toolPayloads);
send('text', responseText);
maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
send('done', { guarded: 'missing_research_plan_clarification' });
```

For the normal text loop:

```ts
const responseText = modelResponse.textBlocks
  .map((text) => ensureCueQualityLanguage(text, toolPayloads, calledTools))
  .join('\n\n');
if (responseText) send('text', responseText);
maybeSendMemoryReceipt({ toolPayloads, assistantText: responseText, send });
send('done', {});
```

Do not emit a receipt on error events.

**Step 5: Run focused tests**

```bash
npm run build
npm test -- tests/ask-openai-provider.test.ts tests/ask-endpoint.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/http-server.ts tests/ask-openai-provider.test.ts tests/ask-endpoint.test.ts
git commit -m "Emit memory receipts from the ask stream

The hosted app can now receive a durable evidence artifact from the
same workflow that produced the assistant answer.

Constraint: Receipt is streamed only on successful answer paths
Rejected: Persist receipts by default | sensitive family-memory storage risk
Confidence: high
Scope-risk: moderate
Tested: npm run build; npm test -- tests/ask-openai-provider.test.ts tests/ask-endpoint.test.ts
"
```

---

### Task 6: Add Receipt Download And Family-Question UX To The App

**Files:**
- Modify: `docs/landing/app.html`
- Modify: `docs/landing/app.js`
- Modify: `tests/launch-business-hardening.test.ts`
- Modify: `tests/p1-launch-hardening.test.ts`

**Step 1: Add failing UI guardrails**

In `tests/launch-business-hardening.test.ts`, add:

```ts
it('lets users keep the memory receipt after a successful answer', () => {
  const page = app();
  const js = appJs();

  expect(page).toContain('.receipt-actions');
  expect(js).toContain("eventType === 'receipt'");
  expect(js).toContain('downloadMemoryReceipt');
  expect(js).toContain('copyFamilyQuestions');
  expect(js).toContain('Achiote Memory Receipt');
  expect(js).toContain('URL.createObjectURL');
  expect(js).not.toContain('localStorage.setItem(\\'achiote-last-memory');
});
```

**Step 2: Add styles**

In `docs/landing/app.html`, add:

```css
.receipt-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.receipt-actions button {
  border: 1px solid var(--line);
  background: var(--card-solid);
  color: var(--achiote);
  border-radius: var(--radius-full);
  padding: 7px 11px;
  font: inherit;
  font-weight: 750;
  cursor: pointer;
}
```

**Step 3: Capture receipt event**

In `docs/landing/app.js`, add:

```js
let lastReceipt = null;
```

In `streamResponse`, handle:

```js
} else if (eventType === 'receipt') {
  lastReceipt = d;
```

**Step 4: Add receipt actions after done**

In the successful `done` branch, after `addFeedback(el);`, call:

```js
addReceiptActions(el);
```

Add:

```js
function addReceiptActions(el) {
  if (!lastReceipt || el.querySelector('.receipt-actions')) return;
  const actions = document.createElement('div');
  actions.className = 'receipt-actions';
  actions.innerHTML = [
    '<button type="button" data-receipt-action="download">Download Memory Receipt</button>',
    '<button type="button" data-receipt-action="questions">Copy Family Questions</button>',
  ].join('');
  actions.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    if (target.dataset.receiptAction === 'download') downloadMemoryReceipt(lastReceipt);
    if (target.dataset.receiptAction === 'questions') await copyFamilyQuestions(lastReceipt, target);
  });
  el.appendChild(actions);
}

function formatReceiptMarkdown(receipt) {
  const list = (items) => Array.isArray(items) && items.length
    ? items.map((item) => `- ${item}`).join('\n')
    : '- None recorded yet.';
  return [
    '# Achiote Memory Receipt',
    '',
    `Created: ${receipt.createdAt || new Date().toISOString()}`,
    `Status: ${receipt.status || 'unknown'}`,
    '',
    '## User-Said Evidence',
    list(receipt.evidence?.userSaid),
    '',
    '## Inferred Context',
    list(receipt.evidence?.inferred),
    '',
    '## Researched Or Source-Backed Facts',
    list(receipt.evidence?.researched),
    '',
    '## Unknowns',
    list(receipt.evidence?.unknown),
    '',
    '## Family Questions',
    list(receipt.nextBestQuestions),
    '',
    '## First Tiny Taste Test',
    receipt.firstTinyTasteTest
      ? `- ${receipt.firstTinyTasteTest.title}: ${receipt.firstTinyTasteTest.cue} (${receipt.firstTinyTasteTest.estimatedTime})`
      : '- Not ready yet. Answer the family questions first.',
    '',
    '## Assistant Summary',
    receipt.assistantSummary || '- No final summary recorded.',
    '',
  ].join('\n');
}

function downloadMemoryReceipt(receipt) {
  const blob = new Blob([formatReceiptMarkdown(receipt)], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'achiote-memory-receipt.md';
  link.click();
  URL.revokeObjectURL(url);
  trackEvent('receipt_downloaded', { route: '/app' });
}

async function copyFamilyQuestions(receipt, button) {
  const questions = Array.isArray(receipt?.nextBestQuestions) ? receipt.nextBestQuestions : [];
  const text = questions.map((question, index) => `${index + 1}. ${question}`).join('\n');
  if (!text) return;
  await navigator.clipboard.writeText(text);
  button.textContent = 'Questions copied';
  trackEvent('family_questions_copied', { route: '/app' });
}
```

**Step 5: Allow telemetry events**

In `src/http-server.ts`, add these to `allowedTelemetryEvents`:

```ts
'receipt_downloaded',
'family_questions_copied',
```

Add a focused assertion in `tests/launch-business-hardening.test.ts`.

**Step 6: Run focused tests**

```bash
npm test -- tests/launch-business-hardening.test.ts tests/p1-launch-hardening.test.ts
```

Expected: PASS.

**Step 7: Commit**

```bash
git add docs/landing/app.html docs/landing/app.js src/http-server.ts tests/launch-business-hardening.test.ts tests/p1-launch-hardening.test.ts
git commit -m "Let users keep and share the memory receipt

The app now turns a successful reconstruction into a portable artifact
and copyable family questions without storing sensitive memories.

Constraint: Receipt export is client-side only
Confidence: high
Scope-risk: moderate
Tested: npm test -- tests/launch-business-hardening.test.ts tests/p1-launch-hardening.test.ts
"
```

---

### Task 7: Improve Feedback Into Product-Learning Signals

**Files:**
- Modify: `docs/landing/app.js`
- Modify: `src/http-server.ts`
- Modify: `tests/launch-business-hardening.test.ts`
- Modify: `docs/LAUNCH_RUNBOOK.md`

**Step 1: Add failing feedback assertions**

In `tests/launch-business-hardening.test.ts`, update feedback expectations to require:

```ts
for (const eventName of [
  'feedback_closer',
  'feedback_wrong_region',
  'feedback_wrong_acid',
  'feedback_wrong_texture',
  'feedback_too_generic',
  'feedback_too_hard',
  'feedback_missed_name_correction',
]) {
  expect(appJs()).toContain(eventName);
  expect(server()).toContain(`'${eventName}'`);
}
expect(appJs()).not.toContain('feedback_helpful');
expect(appJs()).not.toContain('feedback_generic');
```

**Step 2: Replace feedback buttons**

In `docs/landing/app.js`, replace `addFeedback` button HTML with:

```js
feedback.innerHTML = [
  '<button type="button" data-feedback="feedback_closer">Closer</button>',
  '<button type="button" data-feedback="feedback_wrong_region">Wrong region</button>',
  '<button type="button" data-feedback="feedback_wrong_acid">Wrong acid</button>',
  '<button type="button" data-feedback="feedback_wrong_texture">Wrong texture</button>',
  '<button type="button" data-feedback="feedback_too_generic">Too generic</button>',
  '<button type="button" data-feedback="feedback_too_hard">Too hard</button>',
  '<button type="button" data-feedback="feedback_missed_name_correction">Missed name correction</button>',
].join('');
```

**Step 3: Update server allowlist**

In `src/http-server.ts`, replace old answer-quality feedback events with the seven events above. Keep backwards compatibility only if tests currently rely on an older event; otherwise remove old events.

**Step 4: Update launch runbook metrics**

In `docs/LAUNCH_RUNBOOK.md`, add:

```md
Track answer-quality feedback ratios:

- `feedback_closer / ask_succeeded`
- `feedback_wrong_region / ask_succeeded`
- `feedback_wrong_acid / ask_succeeded`
- `feedback_wrong_texture / ask_succeeded`
- `feedback_too_generic / ask_succeeded`
- `feedback_too_hard / ask_succeeded`
- `feedback_missed_name_correction / ask_succeeded`

During launch, treat `feedback_closer / ask_succeeded < 25%` or `feedback_too_generic / ask_succeeded > 20%` as a product-quality blocker.
```

**Step 5: Run focused tests**

```bash
npm test -- tests/launch-business-hardening.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add docs/landing/app.js src/http-server.ts tests/launch-business-hardening.test.ts docs/LAUNCH_RUNBOOK.md
git commit -m "Turn feedback into product-learning signals

Answer feedback now maps to the failure modes that matter for
food-memory reconstruction rather than generic like/dislike labels.

Confidence: high
Scope-risk: narrow
Tested: npm test -- tests/launch-business-hardening.test.ts
"
```

---

### Task 8: Add A Competitor-Comparison Page And Static Benchmark

**Files:**
- Create: `docs/landing/compare.html`
- Modify: `docs/landing/index.html`
- Modify: `docs/landing/sitemap.xml`
- Modify: `docs/landing/robots.txt`
- Modify: `tests/ai-search-visibility.test.ts`
- Create: `tests/product-differentiation.test.ts`

**Step 1: Add failing differentiation test**

Create `tests/product-differentiation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('product differentiation surface', () => {
  it('publishes a competitor comparison without attacking specific brands', () => {
    const compare = fs.readFileSync('docs/landing/compare.html', 'utf8');

    expect(compare).toContain('Why not just use ChatGPT or Google?');
    expect(compare).toContain('Generic AI is good at plausible answers');
    expect(compare).toContain('Achiote is built for evidence-bounded food-memory reconstruction');
    expect(compare).toContain('Memory Receipt');
    expect(compare).toContain('User-said');
    expect(compare).toContain('Inferred');
    expect(compare).toContain('Unknown');
    expect(compare).toContain('First tiny taste test');
    expect(compare).not.toMatch(/ChatGPT is bad|Claude is bad|Google is bad/i);
  });

  it('links comparison from public discovery surfaces', () => {
    const landing = fs.readFileSync('docs/landing/index.html', 'utf8');
    const sitemap = fs.readFileSync('docs/landing/sitemap.xml', 'utf8');
    expect(landing).toContain('/compare');
    expect(sitemap).toContain('https://achiote.kyanitelabs.tech/compare');
  });
});
```

**Step 2: Create `compare.html`**

Use the same header/footer style as other static pages. Body copy must include:

```html
<h1>Why not just use ChatGPT or Google?</h1>
<p>Generic AI is good at plausible answers. Achiote is built for evidence-bounded food-memory reconstruction.</p>

<table>
  <thead>
    <tr><th>Job</th><th>Generic AI or Search</th><th>Achiote</th></tr>
  </thead>
  <tbody>
    <tr><td>Vague memory</td><td>May jump to likely recipes</td><td>Asks for the highest-value missing clue</td></tr>
    <tr><td>Family word or sound-alike</td><td>May treat inference as fact</td><td>Labels user-said vs inferred context</td></tr>
    <tr><td>Before cooking</td><td>Often gives a full recipe</td><td>Gives one first tiny taste test</td></tr>
    <tr><td>After the chat</td><td>Transcript is the artifact</td><td>Memory Receipt is the artifact</td></tr>
  </tbody>
</table>
```

Do not claim generic AI cannot do these tasks. Claim Achiote is constrained and packaged for this job.

**Step 3: Link it**

Add `/compare` to the landing nav or footer. Add sitemap entry:

```xml
<url>
  <loc>https://achiote.kyanitelabs.tech/compare</loc>
  <lastmod>2026-04-27</lastmod>
</url>
```

Allow it in `robots.txt` if explicit allow blocks exist.

**Step 4: Run tests**

```bash
npm test -- tests/product-differentiation.test.ts tests/ai-search-visibility.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add docs/landing/compare.html docs/landing/index.html docs/landing/sitemap.xml docs/landing/robots.txt tests/product-differentiation.test.ts tests/ai-search-visibility.test.ts
git commit -m "Publish the generic AI comparison honestly

Achiote now explains why its constrained receipt workflow is different
from broad AI/search tools without making false competitor claims.

Rejected: Attack ChatGPT or Google directly | unverifiable and weak positioning
Confidence: high
Scope-risk: narrow
Tested: npm test -- tests/product-differentiation.test.ts tests/ai-search-visibility.test.ts
"
```

---

### Task 9: Add A 30-Day Viability Experiment Runbook

**Files:**
- Create: `docs/VIABILITY_EXPERIMENT.md`
- Modify: `docs/LAUNCH_RUNBOOK.md`
- Modify: `tests/docs-consistency.test.ts`

**Step 1: Add failing docs test**

In `tests/docs-consistency.test.ts`, add:

```ts
it('documents the 30-day viability experiment gates', () => {
  const experiment = fs.readFileSync('docs/VIABILITY_EXPERIMENT.md', 'utf8');
  const runbook = fs.readFileSync('docs/LAUNCH_RUNBOOK.md', 'utf8');

  for (const required of [
    '30-Day Viability Experiment',
    '30 strangers',
    'under 3 minutes',
    '40% say it feels more useful than generic AI',
    '10% pay',
    'feedback_closer / ask_succeeded',
    'do not scale paid acquisition',
  ]) {
    expect(experiment).toContain(required);
  }
  expect(runbook).toContain('docs/VIABILITY_EXPERIMENT.md');
});
```

**Step 2: Create `docs/VIABILITY_EXPERIMENT.md`**

Content:

```md
# 30-Day Viability Experiment

## Goal

Determine whether Achiote is valuable as food-memory forensics, not as generic recipe search.

## Traffic

Recruit 30 strangers or weak-tie testers with real family food memories. Do not use friends who already understand the product.

## Success Gates

- 30 strangers complete a first memory attempt.
- Median time to first useful response is under 3 minutes.
- At least 40% say it feels more useful than generic AI after seeing the Memory Receipt.
- At least 10% pay for a Memory Pack or Family Archive Sprint offer.
- At least 25% of successful asks receive `feedback_closer`.
- `feedback_too_generic / ask_succeeded` remains below 20%.
- At least 20% copy family questions or download a Memory Receipt.

## Kill Or Pivot Gates

- If fewer than 10% download or copy the receipt, the artifact is not compelling enough.
- If `feedback_too_generic / ask_succeeded` exceeds 30%, improve workflow quality before marketing.
- If no one pays for one-time offers, pause subscription emphasis and test concierge archive service.
- If users mostly ask for normal recipes, reposition away from consumer SaaS and toward MCP/API tooling.

## Explicit Instruction

Do not scale paid acquisition until the success gates pass.
```

**Step 3: Link from launch runbook**

In `docs/LAUNCH_RUNBOOK.md`, add:

```md
Before broad launch, run `docs/VIABILITY_EXPERIMENT.md` and record the outcome.
```

**Step 4: Run focused tests**

```bash
npm test -- tests/docs-consistency.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add docs/VIABILITY_EXPERIMENT.md docs/LAUNCH_RUNBOOK.md tests/docs-consistency.test.ts
git commit -m "Define the viability experiment before scaling launch

The launch path now has explicit product-quality and payment gates
instead of assuming polished copy equals market pull.

Confidence: high
Scope-risk: narrow
Tested: npm test -- tests/docs-consistency.test.ts
"
```

---

### Task 10: Add A Live Transcript Quality Smoke

**Files:**
- Create: `scripts/viability-transcript-smoke.mjs`
- Modify: `package.json`
- Modify: `tests/launch-business-hardening.test.ts`

**Step 1: Add failing script metadata test**

In `tests/launch-business-hardening.test.ts`, add:

```ts
it('ships a viability transcript smoke for moat regressions', () => {
  const script = fs.readFileSync('scripts/viability-transcript-smoke.mjs', 'utf8');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };

  expect(pkg.scripts['viability:smoke']).toBe('node scripts/viability-transcript-smoke.mjs');
  expect(script).toContain('My abuela made something sour and herby');
  expect(script).toContain('thing');
  expect(script).toContain('Memory Receipt');
  expect(script).toContain('event: receipt');
  expect(script).toContain('forbiddenPatterns');
});
```

**Step 2: Create script**

Create `scripts/viability-transcript-smoke.mjs` as a dependency-free Node script. It must:

1. Read `ACHIOTE_PREVIEW_URL`, default `http://127.0.0.1:3000/ask`.
2. POST five sparse memory prompts:
   - `My abuela made something sour and herby.`
   - `My grandma made a brown peanut candy from India that sounded like chicky.`
   - `My mom made something wrapped and orange for Christmas, maybe pork.`
   - `I remember a sour dill soup with pale chunks.`
   - `A white coconut sweet with grainy sugar crystals from a school festival abroad.`
3. Parse SSE.
4. Fail if any response has:
   - `event: error`
   - missing `event: text`
   - missing `event: done`
   - missing `event: receipt`
   - `thing` as a dish name
   - `fits dozens of dishes`
   - `so many different dishes`
   - `could point in quite a few directions`
   - `buy the exact`
5. Pass only when all cases pass.

Use the same SSE parsing style as `scripts/preview-ask-smoke.mjs`.

**Step 3: Add package script**

In `package.json`:

```json
"viability:smoke": "node scripts/viability-transcript-smoke.mjs"
```

**Step 4: Run focused test**

```bash
npm test -- tests/launch-business-hardening.test.ts
```

Expected: PASS.

**Step 5: Run local smoke after build**

Start a local server in one terminal:

```bash
PORT=60646 ACHIOTE_AUTH_ENABLED=false ACHIOTE_ALLOW_ANON_ASK=true node dist/http-server.js
```

Run:

```bash
ACHIOTE_PREVIEW_URL=http://127.0.0.1:60646/ask npm run viability:smoke
```

Expected:

```text
All viability transcript cases passed
```

**Step 6: Commit**

```bash
git add scripts/viability-transcript-smoke.mjs package.json tests/launch-business-hardening.test.ts
git commit -m "Add a live smoke for viability transcript failures

The launch gate now checks for the specific generic-AI failure modes
that would erase Achiote's differentiation.

Confidence: medium
Scope-risk: narrow
Tested: npm test -- tests/launch-business-hardening.test.ts; ACHIOTE_PREVIEW_URL=http://127.0.0.1:60646/ask npm run viability:smoke
Not-tested: public hosted smoke
"
```

---

### Task 11: Final Verification

**Files:**
- All changed files.

**Step 1: Run full repo gate**

```bash
npm run check
```

Expected:

```text
Test Files  all passed
Tests       all passed
```

**Step 2: Run package smoke**

```bash
npm run package:smoke
```

Expected:

```text
Package smoke passed: installed tarball CLI listed 17 MCP tools and HTTP smoke responded.
```

If the tool count differs, inspect `tests/package-metadata.test.ts` and the package smoke script. The correct expected count after adding `build_memory_receipt` is the previous count plus one.

**Step 3: Run audit**

```bash
npm audit --audit-level=moderate
```

Expected:

```text
found 0 vulnerabilities
```

**Step 4: Run whitespace check**

```bash
git diff --check
```

Expected: no output and exit code 0.

**Step 5: Run dry pack**

```bash
npm pack --dry-run
```

Expected: tarball contents include:

- `docs/landing/compare.html`
- `docs/landing/sample-reconstruction-artifact.md`
- `docs/VIABILITY_EXPERIMENT.md`
- `scripts/viability-transcript-smoke.mjs`
- compiled `dist/lib/memory-receipt.js`

**Step 6: Browser/visual review**

Open locally:

```bash
PORT=60646 ACHIOTE_AUTH_ENABLED=false ACHIOTE_ALLOW_ANON_ASK=true node dist/http-server.js
```

Review:

- `http://127.0.0.1:60646/about`
- `http://127.0.0.1:60646/app`
- `http://127.0.0.1:60646/ai-search`
- `http://127.0.0.1:60646/compare`

Required visual checks:

- Hero text fits on mobile and desktop.
- Memory Receipt CTA is visible.
- App receipt buttons appear after a successful `/ask`.
- Compare page has no broken layout on mobile.
- Pricing section matches the source of truth.

**Step 7: Run transcript smoke**

```bash
ACHIOTE_PREVIEW_URL=http://127.0.0.1:60646/ask npm run viability:smoke
```

Expected:

```text
All viability transcript cases passed
```

**Step 8: Commit verification-only fixes if needed**

If verification reveals minor docs/test string drift, fix only the drift and commit:

```bash
git add <files>
git commit -m "Align launch moat verification surfaces

Follow-up verification found stale product-surface strings and this
commit aligns them with the receipt-led positioning.

Confidence: high
Scope-risk: narrow
Tested: npm run check; npm run package:smoke; npm audit --audit-level=moderate; git diff --check; npm pack --dry-run
"
```

---

## Final Delivery Checklist

Before reporting completion:

1. `git status --short --branch` shows only intentional changes.
2. All task commits exist and are ordered test-first.
3. `npm run check` passed.
4. `npm run package:smoke` passed.
5. `npm audit --audit-level=moderate` passed.
6. `git diff --check` passed.
7. `npm pack --dry-run` passed.
8. Local browser review was performed or explicitly reported as not performed.
9. Local `npm run viability:smoke` passed against a freshly built local server.
10. No README SaaS/business-plan drift.
11. No raw prompt telemetry was added.
12. No new runtime dependency was added.

## Recommended Execution Order

Execute tasks in this exact order:

1. Task 1: Tests for positioning/pricing.
2. Task 2: Public positioning copy.
3. Task 3: Inference ledger.
4. Task 4: Receipt data model and MCP tool.
5. Task 5: Receipt SSE event.
6. Task 6: App receipt UX.
7. Task 7: Feedback learning signals.
8. Task 8: Compare page.
9. Task 9: Viability experiment runbook.
10. Task 10: Transcript quality smoke.
11. Task 11: Full verification.

Do not reorder Tasks 3, 4, 5, and 6. The app receipt UX depends on the server emitting a receipt, the server receipt depends on the receipt builder, and the receipt builder depends on the inference ledger.

