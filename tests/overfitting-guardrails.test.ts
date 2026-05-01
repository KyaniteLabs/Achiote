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
  const sources = ['scripts/local-canary-qa.mjs', 'scripts/weak-cloud-overnight.mjs', 'scripts/preview-ask-smoke.mjs'];
  return sources.flatMap((source) => (
    [...read(source).matchAll(/\b(?:message|text): '([^']+)'/g)]
      .map((match) => ({ source, text: match[1] }))
  ));
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
    const workflow = read('src/lib/memory-workflow.ts');

    expect(workflow).toContain("from '../data/corrected-research-targets.json'");
    expect(workflow).not.toContain('const CORRECTED_RESEARCH_TARGETS');
  });

  it('keeps canary prompts out-of-sample from public landing examples', () => {
    const landingExamples = extractLandingExamples();
    const canaryPrompts = extractCanaryPrompts();

    const overlaps = canaryPrompts.flatMap((prompt) =>
      landingExamples.map((landing) => ({ prompt, landing, ...similarity(prompt.text, landing) })),
    ).filter((overlap) => overlap.score >= 0.72 && overlap.shared.length >= 5);

    expect(overlaps).toEqual([]);
  });
});
