import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('weak cloud runner hardening', () => {
  it('does not classify deterministic fallback wording as an identity claim', async () => {
    const { qualityFindings } = await import('../scripts/lib/weak-cloud-quality.mjs');

    const findings = qualityFindings(
      'Minimum viable composed-bite cue. First-pass verification bite: a tiny amount of cassava-family carrier matching the remembered base. Why this is minimum: a composed bite tests aroma, fat, browning, starch texture, and balance.',
      'I had something in Panama that sounded like carimanolla or carimanola. Give me the first cheap local test, not a full recipe.',
      'achiote',
    );

    expect(findings).not.toContain('overconfident_identity');
    expect(qualityFindings(
      'This is definitely carimanola.',
      'I had something in Panama that sounded like carimanolla or carimanola. Give me the first cheap local test, not a full recipe.',
      'achiote',
    )).toContain('overconfident_identity');
  });

  it('catches browsed-contraction claims and unicode fraction measurements', async () => {
    const { qualityFindings } = await import('../scripts/lib/weak-cloud-quality.mjs');

    const findings = qualityFindings(
      "I've browsed the local prices. Steep a tea bag in ½ cup boiling water for five minutes.",
      'I miss the cold rice-cinnamon drink. Give me the smallest local sip test, not a recipe.',
      'achiote',
    );

    expect(findings).toContain('false_browsing_claim');
    expect(findings).toContain('full_recipe_drift');
  });

  it('catches recipe-like cooking procedures even without measurements', async () => {
    const { qualityFindings } = await import('../scripts/lib/weak-cloud-quality.mjs');

    const findings = qualityFindings(
      'For your first test, make a simple yuca fritter: peel and boil a yuca until tender, then mash it with a pinch of salt. Form it into small ovals, press seasoned ground beef into the center, seal well, and fry in oil until golden and crispy.',
      'I had something in Panama that sounded like carimanolla or carimanola. Give me the first cheap local test, not a full recipe.',
      'achiote',
    );

    expect(findings).toContain('full_recipe_drift');
    expect(qualityFindings(
      'Minimum viable composed-bite cue. First-pass verification bite: a tiny amount of cassava-family carrier plus a tiny amount of accessible protein. Why this is minimum: a composed bite tests aroma, fat, browning, starch texture, and balance.',
      'I had something in Panama that sounded like carimanolla or carimanola. Give me the first cheap local test, not a full recipe.',
      'achiote',
    )).not.toContain('full_recipe_drift');
  });

  it('downranks soft identity overclaims and currency-price fragments', async () => {
    const { qualityFindings } = await import('../scripts/lib/weak-cloud-quality.mjs');

    expect(qualityFindings(
      'Your drink sounds like a classic agua de horchata de arroz.',
      'I miss the cold rice-cinnamon drink, kind of like horchata but thinner.',
      'achiote',
    )).toContain('overconfident_identity');

    expect(qualityFindings(
      'Based on lemons at $0.69 each, warm broth and dill.',
      'Warm sour dill soup. Do not claim current grocery prices.',
      'achiote',
    )).toContain('false_browsing_claim');
  });

  it('does not classify successful content that mentions tools as provider compatibility failure', () => {
    const runner = fs.readFileSync('scripts/weak-cloud-overnight.mjs', 'utf8');

    expect(runner).toContain('const statusAndError = `${status} ${errorText}`;');
    expect(runner).toContain("if (/\\b400\\b|provider returned error|unsupported|not support|tool/i.test(statusAndError)) return 'provider_compatibility';");
    expect(runner).not.toContain("if (/\\b400\\b|provider returned error|unsupported|not support|tool/i.test(combined)) return 'provider_compatibility';");
  });

  it('does not mark incomplete Achiote tool runs as workflow ok', () => {
    const runner = fs.readFileSync('scripts/weak-cloud-overnight.mjs', 'utf8');

    expect(runner).toContain('function classifyAchioteWorkflow');
    expect(runner).toContain("return 'workflow_incomplete';");
    expect(runner).toContain("if (!done?.guarded && quality.includes('missed_minimum_cue_frame')) return 'workflow_incomplete';");
    expect(runner).toContain('classification: classifyAchioteWorkflow(response.status, errors, text, tools, done, quality)');
  });

  it('refuses to start another round when the remaining window is too small', async () => {
    const { shouldStartRound } = await import('../scripts/lib/weak-cloud-schedule.mjs');
    const endAt = new Date('2026-05-01T06:01:14.752Z');

    expect(shouldStartRound({
      now: new Date('2026-05-01T05:59:59.990Z'),
      endAt,
      minRoundStartWindowMs: 5 * 60 * 1000,
    })).toBe(false);

    expect(shouldStartRound({
      now: new Date('2026-05-01T05:49:30.978Z'),
      endAt,
      minRoundStartWindowMs: 5 * 60 * 1000,
    })).toBe(true);
  });

  it('documents the final campaign three-lane concurrency and no-web child env', () => {
    const runner = fs.readFileSync('scripts/weak-cloud-overnight.mjs', 'utf8');

    expect(runner).toContain('laneConcurrency');
    expect(runner).toContain('local: 1');
    expect(runner).toContain('openrouter: 1');
    expect(runner).toContain('glm: 1');
    expect(runner).toContain('Promise.all(wave)');
    expect(runner).toContain('glmTests[waveIndex]');
    expect(runner).toContain('openRouterTests[waveIndex]');
    expect(runner).toContain('localTests[waveIndex]');
    expect(runner).toContain('noWebSearchEnv');
    expect(runner).toContain("SERPER_API_KEY: ''");
    expect(runner).toContain("BRAVE_API_KEY: ''");
    expect(runner).toContain("TAVILY_API_KEY: ''");
    expect(runner).toContain('marketing-candidates.md');
  });

  it('protects the reserved local model and records LM Studio load profile intent', () => {
    const runner = fs.readFileSync('scripts/weak-cloud-overnight.mjs', 'utf8');

    expect(runner).toContain('repo-pipeline-qwen35-q8-prod');
    expect(runner).toContain('protectedLocalModels');
    expect(runner).toContain('isProtectedLocalModel');
    expect(runner).toContain('refusing to load protected local model');
    expect(runner).toContain('loadProfilePayload');
    expect(runner).toContain('flash_attention: true');
    expect(runner).toContain('offload_kv_cache_to_gpu');
    expect(runner).toContain('eval_batch_size');
    expect(runner).toContain('context_length');
  });

  it('records local inference management failures without false ok unloads', () => {
    const runner = fs.readFileSync('scripts/weak-cloud-overnight.mjs', 'utf8');

    expect(runner).toContain('localManagementFailureResult');
    expect(runner).toContain("classification: 'local_management_failed'");
    expect(runner).toContain('if (responseBody?.error)');
    expect(runner).toContain("error: 'unload_response_error'");
    expect(runner).toMatch(/if \(responseBody\?\.error\)[\s\S]+error: 'unload_response_error'[\s\S]+continue;[\s\S]+return \{ ok: true, id, body, response: responseBody, attempts \};/);
  });
});
