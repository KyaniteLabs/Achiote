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
});
