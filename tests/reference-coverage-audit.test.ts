import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

describe('reference coverage audit', () => {
  it('passes the committed P0 reference coverage contract', () => {
    const result = spawnSync(process.execPath, ['scripts/reference-coverage-audit.mjs', '--fail'], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.counts.dishFamilies).toBeGreaterThanOrEqual(55);
    expect(report.counts.ingredients).toBeGreaterThanOrEqual(82);
    expect(Object.keys(report.counts.cultureAreas)).toHaveLength(20);
    expect(Object.keys(report.counts.foodForms)).toHaveLength(17);
    expect(Object.keys(report.counts.mechanisms)).toHaveLength(12);
  });
});
