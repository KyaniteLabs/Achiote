import { describe, expect, it } from 'vitest';

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
});
