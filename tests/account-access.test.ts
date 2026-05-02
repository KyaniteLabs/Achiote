import { describe, expect, it, vi } from 'vitest';
import { createAccountAccess, rateLimitHeaders } from '../src/lib/account-access.js';

function createAccess(overrides = {}) {
  return createAccountAccess({
    authEnabled: true,
    allowAnonymousAsk: false,
    demoPassword: 'demo-pass',
    trustProxy: false,
    trustedProxyIps: [],
    authenticator: {
      authenticate: vi.fn((rawKey: string | undefined) => rawKey === 'api-key'
        ? { authenticated: true as const, tier: 'personal', name: 'paid', keyId: 'ak_paid' }
        : { authenticated: false as const, error: 'nope' }),
    },
    rateLimiter: {
      checkWebLimit: vi.fn((_tier, keyId, limitOverride) => ({ allowed: keyId !== 'blocked', remaining: 2, limit: limitOverride ?? 3, resetAt: 2_000 })),
      checkMcpLimit: vi.fn((_tier, keyId) => ({ allowed: keyId !== 'blocked', remaining: 1, limit: 2, resetAt: 3_000 })),
    },
    ...overrides,
  });
}

describe('AccountAccess', () => {
  it('authenticates demo, configured API, and billing-issued keys through one boundary', () => {
    const billingDb = {
      authenticateApiKey: vi.fn((rawKey: string) => rawKey === 'billing-key'
        ? { tier: 'family' as const, name: 'family archive', keyId: 'ak_billing' }
        : null),
      getCustomerIdByKeyId: vi.fn(),
      deductMcpCredit: vi.fn(),
      deductWebCredit: vi.fn(),
    };
    const access = createAccess({ billingDb });

    expect(access.authenticate({ demoPassword: 'demo-pass', headers: {} })).toMatchObject({ tier: 'pro', keyId: 'demo' });
    expect(access.authenticate({ apiKey: 'api-key', headers: {} })).toMatchObject({ tier: 'personal', keyId: 'key:ak_paid' });
    expect(access.authenticate({ apiKey: 'billing-key', headers: {} })).toMatchObject({ tier: 'family', keyId: 'ak_billing' });
  });

  it('owns anonymous demo policy, rate-limit headers, and memory-pack credit fallback', () => {
    const billingDb = {
      authenticateApiKey: vi.fn(() => null),
      getCustomerIdByKeyId: vi.fn(() => 'cus_123'),
      deductMcpCredit: vi.fn(() => true),
      deductWebCredit: vi.fn(() => true),
    };
    const access = createAccess({
      authEnabled: false,
      allowAnonymousAsk: true,
      anonymousWebLimitOverride: 7,
      billingDb,
    });
    const authed = access.authenticate({ headers: {}, remoteAddress: '127.0.0.1' });

    expect(access.anonymousProductAccessAllowed()).toBe(true);
    expect(access.webLimit(authed).limit).toBe(7);
    expect(access.spendCredit({ tier: 'personal', name: 'x', keyId: 'ak_paid' }, 'web')).toBe(true);
    expect(billingDb.deductWebCredit).toHaveBeenCalledWith('cus_123');
    expect(rateLimitHeaders({ remaining: 1, limit: 3, resetAt: 2_000 })).toEqual({
      'X-RateLimit-Remaining': '1',
      'X-RateLimit-Limit': '3',
      'X-RateLimit-Reset': '2',
    });
  });
});
