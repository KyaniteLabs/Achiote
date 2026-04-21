import { describe, it, expect, afterAll } from 'vitest';
import { createRateLimiter } from '../src/lib/rate-limit.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('rate limiter', () => {
  it('allows requests under the limit', () => {
    const limiter = createRateLimiter();
    const result = limiter.checkMcpLimit('free', 'key1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(49);
    expect(result.limit).toBe(50);
  });

  it('blocks requests over the limit for free tier', () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < 50; i++) {
      limiter.checkMcpLimit('free', 'key2');
    }
    const result = limiter.checkMcpLimit('free', 'key2');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('tracks usage per key independently', () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < 50; i++) {
      limiter.checkMcpLimit('free', 'key-a');
    }
    const resultA = limiter.checkMcpLimit('free', 'key-a');
    expect(resultA.allowed).toBe(false);

    const resultB = limiter.checkMcpLimit('free', 'key-b');
    expect(resultB.allowed).toBe(true);
  });

  it('pro tier allows 5000 calls', () => {
    const limiter = createRateLimiter();
    const result = limiter.checkMcpLimit('pro', 'pro-key');
    expect(result.limit).toBe(5_000);
  });

  it('enterprise tier has infinite MCP limit with monthly reset metadata', () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < 200; i++) {
      limiter.checkMcpLimit('enterprise', 'ent-key');
    }
    const result = limiter.checkMcpLimit('enterprise', 'ent-key');
    const now = new Date();
    const expectedReset = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(Infinity);
    expect(result.remaining).toBe(Infinity);
    expect(result.resetAt).toBe(expectedReset);
  });

  it('resets usage for a key', () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < 50; i++) {
      limiter.checkMcpLimit('free', 'reset-key');
    }
    expect(limiter.checkMcpLimit('free', 'reset-key').allowed).toBe(false);

    limiter.resetUsage('reset-key');
    expect(limiter.checkMcpLimit('free', 'reset-key').allowed).toBe(true);
  });

  describe('web limits', () => {
    it('free tier allows 3 reconstructions', () => {
      const limiter = createRateLimiter();
      expect(limiter.checkWebLimit('free', 'session-1').allowed).toBe(true);
      expect(limiter.checkWebLimit('free', 'session-1').allowed).toBe(true);
      expect(limiter.checkWebLimit('free', 'session-1').allowed).toBe(true);
      expect(limiter.checkWebLimit('free', 'session-1').allowed).toBe(false);
    });

    it('pro tier has unlimited web reconstructions', () => {
      const limiter = createRateLimiter();
      for (let i = 0; i < 100; i++) {
        limiter.checkWebLimit('pro', 'session-2');
      }
      expect(limiter.checkWebLimit('pro', 'session-2').allowed).toBe(true);
    });
  });

  describe('close()', () => {
    it('does not throw when called without db', () => {
      const limiter = createRateLimiter();
      expect(() => limiter.close()).not.toThrow();
    });

    it('does not throw on double close', () => {
      const limiter = createRateLimiter();
      limiter.close();
      expect(() => limiter.close()).not.toThrow();
    });
  });

  describe('resetAt timestamp', () => {
    it('returns a future resetAt timestamp', () => {
      const limiter = createRateLimiter();
      const result = limiter.checkMcpLimit('free', 'ts-key');
      expect(result.resetAt).toBeGreaterThan(Date.now());
    });

    it('resetAt is start of next month', () => {
      const limiter = createRateLimiter();
      const result = limiter.checkMcpLimit('free', 'month-key');
      const now = new Date();
      const expected = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
      expect(result.resetAt).toBe(expected);
    });
  });

  describe('remaining count', () => {
    it('counts down correctly', () => {
      const limiter = createRateLimiter();
      const r1 = limiter.checkMcpLimit('free', 'count-key');
      expect(r1.remaining).toBe(49);
      const r2 = limiter.checkMcpLimit('free', 'count-key');
      expect(r2.remaining).toBe(48);
      const r3 = limiter.checkMcpLimit('free', 'count-key');
      expect(r3.remaining).toBe(47);
    });

    it('remaining stays at 0 after limit reached', () => {
      const limiter = createRateLimiter();
      for (let i = 0; i < 50; i++) {
        limiter.checkMcpLimit('free', 'floor-key');
      }
      const result = limiter.checkMcpLimit('free', 'floor-key');
      expect(result.remaining).toBe(0);
      expect(result.allowed).toBe(false);
    });
  });
});

describe('rate limiter with SQLite persistence', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'rl-test-'));

  afterAll(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('persists usage across instances', () => {
    const dbPath = join(tmpDir, 'persist.db');
    const limiter1 = createRateLimiter(dbPath);
    limiter1.checkMcpLimit('free', 'persist-key');
    limiter1.checkMcpLimit('free', 'persist-key');
    limiter1.close();

    const limiter2 = createRateLimiter(dbPath);
    const result = limiter2.checkMcpLimit('free', 'persist-key');
    expect(result.remaining).toBe(47);
    limiter2.close();
  });

  it('survives reset and reopen', () => {
    const dbPath = join(tmpDir, 'reset.db');
    const limiter1 = createRateLimiter(dbPath);
    for (let i = 0; i < 50; i++) {
      limiter1.checkMcpLimit('free', 'reset-persist-key');
    }
    expect(limiter1.checkMcpLimit('free', 'reset-persist-key').allowed).toBe(false);
    limiter1.close();

    const limiter2 = createRateLimiter(dbPath);
    expect(limiter2.checkMcpLimit('free', 'reset-persist-key').allowed).toBe(false);
    limiter2.resetUsage('reset-persist-key');
    expect(limiter2.checkMcpLimit('free', 'reset-persist-key').allowed).toBe(true);
    limiter2.close();
  });

  it('creates DB directory if missing', () => {
    const nestedDir = join(tmpDir, 'nested', 'deep');
    const nestedDb = join(nestedDir, 'rl.db');
    const limiter = createRateLimiter(nestedDb);
    const result = limiter.checkMcpLimit('free', 'nested-key');
    expect(result.allowed).toBe(true);
    limiter.close();
  });

  it('tracks web and MCP limits independently per key', () => {
    const dbPath = join(tmpDir, 'dual.db');
    const limiter = createRateLimiter(dbPath);
    const mcpResult = limiter.checkMcpLimit('free', 'dual-key');
    const webResult = limiter.checkWebLimit('free', 'dual-key');
    expect(mcpResult.allowed).toBe(true);
    expect(webResult.allowed).toBe(true);
    limiter.close();
  });

  it('uses immediate transactions for persistent limit checks', () => {
    const source = readFileSync('src/lib/rate-limit.ts', 'utf8');
    expect(source).toContain('dbCheck.immediate');
  });

  it('enforces MCP limits across separate limiter instances sharing one database', () => {
    const dbPath = join(tmpDir, 'multi-instance-mcp.db');
    const limiterA = createRateLimiter(dbPath);
    const limiterB = createRateLimiter(dbPath);

    try {
      for (let i = 0; i < 25; i++) {
        expect(limiterA.checkMcpLimit('free', 'shared-key').allowed).toBe(true);
        expect(limiterB.checkMcpLimit('free', 'shared-key').allowed).toBe(true);
      }

      expect(limiterA.checkMcpLimit('free', 'shared-key')).toMatchObject({ allowed: false, remaining: 0 });
      expect(limiterB.checkMcpLimit('free', 'shared-key')).toMatchObject({ allowed: false, remaining: 0 });
    } finally {
      limiterA.close();
      limiterB.close();
    }
  });

  it('enforces web limits across separate limiter instances sharing one database', () => {
    const dbPath = join(tmpDir, 'multi-instance-web.db');
    const limiterA = createRateLimiter(dbPath);
    const limiterB = createRateLimiter(dbPath);

    try {
      expect(limiterA.checkWebLimit('free', 'shared-web').allowed).toBe(true);
      expect(limiterB.checkWebLimit('free', 'shared-web').allowed).toBe(true);
      expect(limiterA.checkWebLimit('free', 'shared-web').allowed).toBe(true);
      expect(limiterB.checkWebLimit('free', 'shared-web')).toMatchObject({ allowed: false, remaining: 0 });
    } finally {
      limiterA.close();
      limiterB.close();
    }
  });

  it('does not throw when many SQLite-backed limiter instances contend for the same quota', async () => {
    const dbPath = join(tmpDir, 'contended.db');
    const limiters = Array.from({ length: 10 }, () => createRateLimiter(dbPath));

    try {
      const results = await Promise.all(
        limiters.map((limiter) => new Promise((resolve) => {
          setImmediate(() => resolve(limiter.checkMcpLimit('free', 'contended-key')));
        })),
      );

      expect(results.filter((result) => result.allowed)).toHaveLength(10);
    } finally {
      for (const limiter of limiters) limiter.close();
    }
  });
});
