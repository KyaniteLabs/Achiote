import { describe, it, expect } from 'vitest';
import { generateApiKey, createAuthenticator, loadKeysFromEnv, getTierLimits } from '../src/lib/auth.js';

describe('auth module', () => {
  it('generates keys with ach_ prefix', () => {
    const key = generateApiKey('free', 'test');
    expect(key.key).toMatch(/^ach_[0-9a-f]{48}$/);
    expect(key.tier).toBe('free');
    expect(key.name).toBe('test');
    expect(key.createdAt).toBeTruthy();
  });

  it('authenticates a valid key', () => {
    const record = generateApiKey('pro', 'test-user');
    const auth = createAuthenticator([record]);
    const result = auth.authenticate(record.key);
    expect(result.authenticated).toBe(true);
    if (result.authenticated) {
      expect(result.tier).toBe('pro');
      expect(result.name).toBe('test-user');
    }
  });

  it('rejects an invalid key', () => {
    const auth = createAuthenticator([generateApiKey('free', 'test')]);
    const result = auth.authenticate('ach_invalid');
    expect(result.authenticated).toBe(false);
    if (!result.authenticated) {
      expect(result.error).toContain('Invalid');
    }
  });

  it('rejects missing key', () => {
    const auth = createAuthenticator([]);
    const result = auth.authenticate(undefined);
    expect(result.authenticated).toBe(false);
    if (!result.authenticated) {
      expect(result.error).toContain('required');
    }
  });

  it('supports all tiers', () => {
    for (const tier of ['free', 'pro', 'business', 'enterprise'] as const) {
      const record = generateApiKey(tier, `${tier}-test`);
      const auth = createAuthenticator([record]);
      const result = auth.authenticate(record.key);
      expect(result.authenticated).toBe(true);
      if (result.authenticated) expect(result.tier).toBe(tier);
    }
  });

  it('adds and removes keys dynamically', () => {
    const auth = createAuthenticator([]);
    const record = generateApiKey('free', 'dynamic');
    auth.addKey(record);
    expect(auth.authenticate(record.key).authenticated).toBe(true);
    auth.removeKey(record.key);
    expect(auth.authenticate(record.key).authenticated).toBe(false);
  });

  it('listKeys omits the secret key', () => {
    const record = generateApiKey('free', 'test');
    const auth = createAuthenticator([record]);
    const listed = auth.listKeys();
    expect(listed).toHaveLength(1);
    expect((listed[0] as Record<string, unknown>)['key']).toBeUndefined();
    expect(listed[0].name).toBe('test');
  });
});

describe('getTierLimits', () => {
  it('returns correct limits for each tier', () => {
    expect(getTierLimits('free').mcpCallsPerMonth).toBe(50);
    expect(getTierLimits('pro').mcpCallsPerMonth).toBe(5_000);
    expect(getTierLimits('business').mcpCallsPerMonth).toBe(100_000);
    expect(getTierLimits('enterprise').mcpCallsPerMonth).toBe(Infinity);
  });

  it('free tier has limited web reconstructions', () => {
    expect(getTierLimits('free').webReconstructions).toBe(3);
  });

  it('pro and above have unlimited web reconstructions', () => {
    expect(getTierLimits('pro').webReconstructions).toBe(Infinity);
    expect(getTierLimits('enterprise').webReconstructions).toBe(Infinity);
  });
});

describe('loadKeysFromEnv', () => {
  it('parses valid JSON array', () => {
    const key = generateApiKey('free', 'env-test');
    const env = JSON.stringify([key]);
    const loaded = loadKeysFromEnv(env);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].tier).toBe('free');
  });

  it('returns empty for undefined', () => {
    expect(loadKeysFromEnv(undefined)).toEqual([]);
  });

  it('returns empty for invalid JSON', () => {
    expect(loadKeysFromEnv('not-json')).toEqual([]);
  });

  it('returns empty for non-array JSON', () => {
    expect(loadKeysFromEnv('{"key": "value"}')).toEqual([]);
  });

  it('filters entries missing required fields', () => {
    const env = JSON.stringify([{ key: 'ach_test' }]);
    expect(loadKeysFromEnv(env)).toEqual([]);
  });
});
