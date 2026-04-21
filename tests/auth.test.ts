import { describe, it, expect } from 'vitest';
import { generateApiKey, createAuthenticator, loadKeysFromEnv, getTierLimits, hashApiKey } from '../src/lib/auth.js';

describe('auth module', () => {
  it('generates keys with one-time raw key plus stored key hash', () => {
    const key = generateApiKey('free', 'test');
    expect(key.key).toMatch(/^ach_[0-9a-f]{48}$/);
    expect(key.keyId).toMatch(/^ak_[0-9a-f]{16}$/);
    expect(key.keyHash).toBe(hashApiKey(key.key));
    expect(key.keyHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(key.tier).toBe('free');
    expect(key.name).toBe('test');
    expect(key.createdAt).toBeTruthy();
  });

  it('authenticates a valid hashed key record', () => {
    const record = generateApiKey('pro', 'test-user');
    const rawKey = record.key;
    const auth = createAuthenticator([{ keyId: record.keyId, keyHash: record.keyHash, tier: record.tier, name: record.name, createdAt: record.createdAt }]);
    const result = auth.authenticate(rawKey);
    expect(result.authenticated).toBe(true);
    if (result.authenticated) {
      expect(result.tier).toBe('pro');
      expect(result.name).toBe('test-user');
    }
  });

  it('temporarily supports legacy plaintext key records', () => {
    const record = { key: 'ach_0123456789abcdef0123456789abcdef0123456789abcdef', tier: 'free' as const, name: 'legacy', createdAt: '2026-04-21T00:00:00.000Z' };
    const auth = createAuthenticator([record]);
    const result = auth.authenticate(record.key);
    expect(result.authenticated).toBe(true);
  });

  it('uses last-record-wins when duplicate key hashes are configured', () => {
    const record = generateApiKey('free', 'first');
    const auth = createAuthenticator([
      { keyId: 'ak_1111111111111111', keyHash: record.keyHash, tier: 'free', name: 'first', createdAt: record.createdAt },
      { keyId: 'ak_2222222222222222', keyHash: record.keyHash, tier: 'business', name: 'second', createdAt: record.createdAt },
    ]);

    const result = auth.authenticate(record.key);
    expect(result).toMatchObject({ authenticated: true, tier: 'business', name: 'second', keyId: 'ak_2222222222222222' });
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

  it('listKeys omits the secret key and hash', () => {
    const record = generateApiKey('free', 'test');
    const auth = createAuthenticator([record]);
    const listed = auth.listKeys();
    expect(listed).toHaveLength(1);
    expect((listed[0] as Record<string, unknown>)['key']).toBeUndefined();
    expect((listed[0] as Record<string, unknown>)['keyHash']).toBeUndefined();
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
  it('parses valid JSON array with hashed records', () => {
    const key = generateApiKey('free', 'env-test');
    const envRecord = { keyId: key.keyId, keyHash: key.keyHash, tier: key.tier, name: key.name, createdAt: key.createdAt };
    const loaded = loadKeysFromEnv(JSON.stringify([envRecord]));
    expect(loaded).toHaveLength(1);
    expect(loaded[0].tier).toBe('free');
    expect(loaded[0]).not.toHaveProperty('key');
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
    const env = JSON.stringify([{ keyHash: 'sha256:test' }]);
    expect(loadKeysFromEnv(env)).toEqual([]);
  });

  it('filters malformed key hashes and key ids even with tier and name present', () => {
    const malformed = [
      { keyId: 'ak_bad', keyHash: 'sha256:nothex', tier: 'free', name: 'bad' },
      { keyId: 'bad_0123456789abcdef', keyHash: hashApiKey('ach_0123456789abcdef0123456789abcdef0123456789abcdef'), tier: 'free', name: 'bad-id' },
    ];
    expect(loadKeysFromEnv(JSON.stringify(malformed))).toEqual([]);
  });
});


describe('generate-api-key script', () => {
  it('prints a one-time raw key and a hashed env record', async () => {
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, ['scripts/generate-api-key.mjs', '--tier', 'pro', '--name', 'script-test'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.key).toMatch(/^ach_[0-9a-f]{48}$/);
    expect(parsed.envRecord).toMatchObject({ tier: 'pro', name: 'script-test' });
    expect(parsed.envRecord.keyId).toMatch(/^ak_[0-9a-f]{16}$/);
    expect(parsed.envRecord.keyHash).toBe(hashApiKey(parsed.key));
    expect(parsed.envRecord).not.toHaveProperty('key');
    expect(parsed.envExample).toContain('ACHIOTE_API_KEYS=');
    expect(parsed.envExample).toContain(parsed.envRecord.keyHash);
    expect(result.stderr).toContain('raw key is shown once');
  });
});
