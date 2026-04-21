import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createCacheWithStatus } from '../src/lib/cache-path.js';

describe('P3 release hygiene and operational guardrails', () => {
  it('keeps local Claude worktrees out of release status and package scope', () => {
    expect(fs.readFileSync('.gitignore', 'utf8')).toContain('.claude/');
  });

  it('restores a durable forward-hardening plan under docs/plans', () => {
    const planPath = 'docs/plans/2026-04-21-forward-hardening-plan.md';
    const plan = fs.readFileSync(planPath, 'utf8');
    expect(plan).toContain('Forward hardening plan');
    expect(plan).toContain('ROI');
    expect(plan).toContain('unknown unknowns');
  });

  it('adds dependency-free lint/static and coverage guard scripts to the release gate', () => {
    const pkg = fs.readFileSync('package.json', 'utf8');
    expect(pkg).toContain('"lint": "node scripts/static-checks.mjs"');
    expect(pkg).toContain('"coverage:guard": "node scripts/coverage-threshold.mjs"');
    expect(pkg).toContain('npm run lint && npm run coverage:guard');
    const staticChecks = fs.readFileSync('scripts/static-checks.mjs', 'utf8');
    expect(staticChecks).toContain('Required static-check input missing');
    expect(staticChecks).toContain('Forbidden pattern');
    const coverageGuard = fs.readFileSync('scripts/coverage-threshold.mjs', 'utf8');
    expect(coverageGuard).toContain('MIN_TEST_COUNT');
    expect(coverageGuard).toContain('Required test directory missing');
    expect(coverageGuard).toContain('Unable to read test directory');
    expect(coverageGuard).toContain('.replace(/\\/\\*[\\s\\S]*?\\*\\//g');
    expect(coverageGuard).toContain('line) => /^\\s*(?:it|test)');
  });

  it('reports cache fallback status instead of hiding configured cache failures', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'achiote-cache-status-'));
    const directoryPath = path.join(tempRoot, 'not-a-db-directory');
    fs.mkdirSync(directoryPath);

    const status = createCacheWithStatus({ cachePath: directoryPath });
    try {
      expect(status.fallbackUsed).toBe(true);
      expect(status.error).toBeTruthy();
      expect(status.cache).not.toBeNull();
    } finally {
      status.cache?.close();
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
