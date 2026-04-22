import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
  getHttpReadiness,
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

  it('accepts Anthropic-compatible auth tokens for /ask readiness', () => {
    const readiness = getHttpReadiness({
      authEnabled: false,
      apiKeyCount: 0,
      anthropicAuthToken: 'token-for-compatible-provider',
      cacheAvailable: true,
      rateLimitPersistenceConfigured: true,
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'anthropicApiKey', ok: true }),
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
