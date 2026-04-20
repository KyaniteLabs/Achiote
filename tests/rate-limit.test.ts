import { describe, it, expect } from 'vitest';
import { createRateLimiter } from '../src/lib/rate-limit.js';

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

  it('enterprise tier has infinite limit', () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < 200; i++) {
      limiter.checkMcpLimit('enterprise', 'ent-key');
    }
    const result = limiter.checkMcpLimit('enterprise', 'ent-key');
    expect(result.allowed).toBe(true);
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
});
