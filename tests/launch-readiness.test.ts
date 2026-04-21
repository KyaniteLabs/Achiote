import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
  getHttpReadiness,
  getRequestRateLimitIdentity,
  shouldApplyRateLimit,
} from '../src/lib/http-runtime.js';

describe('P0 launch readiness guards', () => {
  it('does not apply reconstruction quota before a syntactically valid message exists', () => {
    expect(shouldApplyRateLimit({ contentType: 'text/plain', parsedBody: null })).toBe(false);
    expect(shouldApplyRateLimit({ contentType: 'application/json', parsedBody: null })).toBe(false);
    expect(shouldApplyRateLimit({ contentType: 'application/json', parsedBody: { notMessage: 'hello' } })).toBe(false);
    expect(shouldApplyRateLimit({ contentType: 'application/json', parsedBody: { message: '   ' } })).toBe(false);
    expect(shouldApplyRateLimit({ contentType: 'application/json', parsedBody: { message: 'hello' } })).toBe(true);
  });

  it('keys anonymous rate limits by explicit session or client address instead of one global anon bucket', () => {
    expect(getRequestRateLimitIdentity({
      authEnabled: false,
      headers: { 'x-session-id': 'browser-a' },
      remoteAddress: '127.0.0.1',
      trustProxy: false,
    })).toMatchObject({ tier: 'free', keyId: 'anon:session:browser-a' });

    expect(getRequestRateLimitIdentity({
      authEnabled: false,
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
      remoteAddress: '127.0.0.1',
      trustProxy: true,
    })).toMatchObject({ tier: 'free', keyId: 'anon:ip:203.0.113.9' });

    expect(getRequestRateLimitIdentity({
      authEnabled: false,
      headers: {},
      remoteAddress: '127.0.0.1',
      trustProxy: false,
    })).toMatchObject({ tier: 'free', keyId: 'anon:ip:127.0.0.1' });
  });

  it('marks HTTP readiness degraded when launch-critical config is missing', () => {
    const readiness = getHttpReadiness({
      authEnabled: true,
      apiKeyCount: 0,
      anthropicApiKey: undefined,
      cacheAvailable: true,
      rateLimitPersistenceConfigured: false,
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.status).toBe('degraded');
    expect(readiness.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'apiKeys', ok: false }),
      expect.objectContaining({ name: 'anthropicApiKey', ok: false }),
      expect.objectContaining({ name: 'rateLimitPersistence', ok: false }),
    ]));
  });

  it('does not publish unresolved achiote.app metadata before DNS exists', () => {
    const landing = fs.readFileSync('docs/landing/index.html', 'utf8');
    const robots = fs.readFileSync('docs/landing/robots.txt', 'utf8');
    const sitemap = fs.readFileSync('docs/landing/sitemap.xml', 'utf8');

    expect(`${landing}\n${robots}\n${sitemap}`).not.toContain('achiote.app');
  });

  it('documents secure HTTP auth defaults and source/tarball install status', () => {
    const readme = fs.readFileSync('README.md', 'utf8');
    const envExample = fs.readFileSync('.env.example', 'utf8');

    expect(readme).toContain('Authentication is enabled by default');
    expect(readme).toContain('Achiote is not published to npm yet');
    expect(envExample).toContain('ACHIOTE_AUTH_ENABLED=true');
  });
});
