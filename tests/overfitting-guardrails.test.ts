import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'did', 'do',
  'does', 'for', 'from', 'give', 'had', 'has', 'have', 'help', 'i', 'if',
  'in', 'is', 'it', 'kind', 'like', 'made', 'maybe', 'me', 'my', 'not', 'of',
  'or', 'over', 'please', 'something', 'that', 'the', 'this', 'to', 'was',
  'what', 'when', 'where', 'with', 'you',
]);

function read(path: string) {
  return fs.readFileSync(path, 'utf8');
}

function meaningfulTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .match(/[a-z0-9]{3,}/g)
      ?.filter((token) => !STOPWORDS.has(token)) ?? [],
  );
}

function similarity(left: string, right: string): { score: number; shared: string[] } {
  const leftTokens = meaningfulTokens(left);
  const rightTokens = meaningfulTokens(right);
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).sort();
  const smaller = Math.min(leftTokens.size, rightTokens.size);
  return {
    score: smaller === 0 ? 0 : shared.length / smaller,
    shared,
  };
}

function extractLandingExamples(): string[] {
  const app = read('docs/landing/app.html');
  const index = read('docs/landing/index.html');
  return [
    ...[...app.matchAll(/data-suggestion="([^"]+)"/g)].map((match) => match[1]),
    ...[...index.matchAll(/<q>"([^"]+)"<\/q>/g)].map((match) => match[1]),
  ];
}

function extractCanaryPrompts(): Array<{ source: string; text: string }> {
  const sources = ['scripts/local-canary-qa.mjs', 'scripts/lib/canary-prompt-bank.mjs', 'scripts/preview-ask-smoke.mjs'];
  return sources.flatMap((source) => (
    [...read(source).matchAll(/\b(?:message|text): '([^']+)'/g)]
      .map((match) => ({ source, text: match[1] }))
  ));
}

function extractDefaultCanaryText(): string {
  return [
    'scripts/local-canary-qa.mjs',
    'scripts/lib/canary-prompt-bank.mjs',
  ].map(read).join('\n');
}

describe('overfitting guardrails', () => {
  it('keeps internal QA and canary terminology out of production-facing strings', () => {
    const productionText = [
      'src/lib/memory-workflow.ts',
      'src/http-server.ts',
      'src/tools/tool-registry.ts',
      'src/data/dish-families.json',
      'src/data/corrected-research-targets.json',
      'src/data/reference-seed-queue.json',
      'src/data/cache-warming-manifest.json',
      'src/data/reference-pantry-fixtures.json',
    ].map(read).join('\n').toLowerCase();

    expect(productionText).not.toMatch(/\b(?:final-canary|weak-cloud|canary gap|prompt bucket|prompt fixture)\b/);
  });

  it('keeps corrected research targets in data, not as a workflow-code answer key', () => {
    const planner = read('src/lib/dish-research-planner.ts');

    expect(planner).toContain("from '../data/corrected-research-targets.json'");
    expect(planner).not.toContain('const CORRECTED_RESEARCH_TARGETS');
  });

  it('keeps multilingual concept aliases in taxonomy data, not cue-selection code', () => {
    const workflow = read('src/lib/memory-workflow.ts');
    const memoryHints = read('src/data/memory-hints.json');
    const cueSelectionCode = workflow.slice(workflow.indexOf('function signalIncludes'));

    expect(memoryHints).toContain('"conceptAliases"');
    expect(workflow).toContain('conceptIncludes');
    expect(cueSelectionCode).not.toMatch(/\b(?:arroz|canela|hielo|fria|fría|maiz|maíz|bebida)\b/i);
  });

  it('keeps canary prompts out-of-sample from public landing examples', () => {
    const landingExamples = extractLandingExamples();
    const canaryPrompts = extractCanaryPrompts();

    const overlaps = canaryPrompts.flatMap((prompt) =>
      landingExamples.map((landing) => ({ prompt, landing, ...similarity(prompt.text, landing) })),
    ).filter((overlap) => overlap.score >= 0.72 && overlap.shared.length >= 5);

    expect(overlaps).toEqual([]);
  });

  it('does not let the default canary bank regress to stale solved memories', () => {
    const defaultCanaryText = extractDefaultCanaryText();

    expect(defaultCanaryText).not.toMatch(/\b(?:sparse_sour_dill_soup|misspelled_carimanola|baseline_food_memory|beverage_horchata_like)\b/i);
    expect(defaultCanaryText).not.toMatch(/\b(?:carima[nñ]ola|caribanyola|tart green-herb broth|soft potato or egg bits|thinner than horchata|agua de cebada|aguita de ceb[aá])\b/i);
  });

  it('keeps multiple hard prompt cohorts available for post-seed reruns', async () => {
    const { weakCloudPromptBanks } = await import('../scripts/lib/canary-prompt-bank.mjs');
    const promptIds = weakCloudPromptBanks.flatMap((bank: { prompts: Array<{ id: string }> }) => bank.prompts.map((prompt) => prompt.id));

    expect(weakCloudPromptBanks.length).toBeGreaterThanOrEqual(3);
    expect(new Set(promptIds).size).toBe(promptIds.length);
    expect(promptIds).not.toEqual(expect.arrayContaining([
      'sparse_sour_dill_soup',
      'misspelled_carimanola',
      'beverage_horchata_like',
    ]));
    expect(weakCloudPromptBanks.every((bank: { prompts: unknown[] }) => bank.prompts.length >= 7)).toBe(true);
  });
});
