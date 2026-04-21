import { describe, expect, it } from 'vitest';
import { getRequestRateLimitIdentity, isAnonymousAskAllowed } from '../src/lib/http-runtime.js';

describe('HTTP runtime auth boundaries', () => {
  it('requires explicit ACHIOTE_ALLOW_ANON_ASK for anonymous /ask', () => {
    expect(isAnonymousAskAllowed({ authEnabled: false, allowAnonymousAsk: false })).toBe(false);
    expect(isAnonymousAskAllowed({ authEnabled: true, allowAnonymousAsk: true })).toBe(true);
  });

  it('allows anonymous /ask only when ACHIOTE_ALLOW_ANON_ASK=true', () => {
    expect(isAnonymousAskAllowed({ authEnabled: false, allowAnonymousAsk: true })).toBe(true);
  });

  it('does not let client-supplied session ids choose anonymous quota buckets', () => {
    const identity = getRequestRateLimitIdentity({
      authEnabled: false,
      headers: { 'x-session-id': 'browser-a' },
      remoteAddress: '127.0.0.1',
      trustProxy: false,
      trustedProxyIps: [],
    });

    expect(identity?.keyId).toBe('anon:ip:127.0.0.1');
  });

  it('ignores x-forwarded-for when proxy trust is disabled', () => {
    const identity = getRequestRateLimitIdentity({
      authEnabled: false,
      headers: { 'x-forwarded-for': '203.0.113.10' },
      remoteAddress: '127.0.0.1',
      trustProxy: false,
      trustedProxyIps: [],
    });

    expect(identity?.keyId).toBe('anon:ip:127.0.0.1');
  });

  it('ignores x-forwarded-for when remote address is not trusted', () => {
    const identity = getRequestRateLimitIdentity({
      authEnabled: false,
      headers: { 'x-forwarded-for': '203.0.113.10' },
      remoteAddress: '198.51.100.5',
      trustProxy: true,
      trustedProxyIps: ['127.0.0.1'],
    });

    expect(identity?.keyId).toBe('anon:ip:198.51.100.5');
  });

  it('honors x-forwarded-for when remote address is trusted', () => {
    const identity = getRequestRateLimitIdentity({
      authEnabled: false,
      headers: { 'x-forwarded-for': '203.0.113.10' },
      remoteAddress: '127.0.0.1',
      trustProxy: true,
      trustedProxyIps: ['127.0.0.1'],
    });

    expect(identity?.keyId).toBe('anon:ip:203.0.113.10');
  });

  it('does not trust spoofed x-forwarded-for prefixes from append-style proxies', () => {
    const identity = getRequestRateLimitIdentity({
      authEnabled: false,
      headers: { 'x-forwarded-for': '1.2.3.4, 198.51.100.10' },
      remoteAddress: '127.0.0.1',
      trustProxy: true,
      trustedProxyIps: ['127.0.0.1'],
    });

    expect(identity?.keyId).toBe('anon:ip:127.0.0.1');
  });

  it('uses original client from a trusted multi-hop x-forwarded-for chain', () => {
    const identity = getRequestRateLimitIdentity({
      authEnabled: false,
      headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.2' },
      remoteAddress: '127.0.0.1',
      trustProxy: true,
      trustedProxyIps: ['127.0.0.1', '10.0.0.2'],
    });

    expect(identity?.keyId).toBe('anon:ip:203.0.113.10');
  });
});
