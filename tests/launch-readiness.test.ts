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

  it('applies rate limit for image-only requests without a text message', () => {
    expect(shouldApplyRateLimit({ contentType: 'application/json', parsedBody: { images: ['data:image/jpeg;base64,/9j/4AAQ'] } })).toBe(true);
    expect(shouldApplyRateLimit({ contentType: 'application/json', parsedBody: { message: '', images: ['data:image/jpeg;base64,/9j/4AAQ'] } })).toBe(true);
    expect(shouldApplyRateLimit({ contentType: 'application/json', parsedBody: { images: [] } })).toBe(false);
  });

  it('marks HTTP readiness degraded when launch-critical config is missing', () => {
    const readiness = getHttpReadiness({
      authEnabled: true,
      apiKeyCount: 0,
      demoPasswordConfigured: false,
      billingEnabled: false,
      anthropicApiKey: undefined,
      cacheAvailable: true,
      rateLimitPersistenceConfigured: false,
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.status).toBe('degraded');
    expect(readiness.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'apiKeys', ok: false }),
      expect.objectContaining({ name: 'modelProvider', ok: false }),
      expect.objectContaining({ name: 'rateLimitPersistence', ok: false }),
    ]));
    expect(JSON.stringify(readiness)).not.toMatch(/\b(?:anthropic|openai|glm|zhipu)\b/i);
  });

  it('keeps public readiness provider checks generic', () => {
    const readiness = getHttpReadiness({
      authEnabled: false,
      apiKeyCount: 0,
      demoPasswordConfigured: false,
      billingEnabled: false,
      anthropicAuthToken: 'token-for-compatible-provider',
      cacheAvailable: true,
      rateLimitPersistenceConfigured: true,
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'modelProvider', ok: true }),
    ]));
    expect(JSON.stringify(readiness)).not.toMatch(/\b(?:anthropic|openai|glm|zhipu)\b/i);
  });

  it('does not publish unresolved achiote.app metadata before DNS exists', () => {
    const landing = fs.readFileSync('docs/landing/index.html', 'utf8');
    const robots = fs.readFileSync('docs/landing/robots.txt', 'utf8');
    const sitemap = fs.readFileSync('docs/landing/sitemap.xml', 'utf8');

    expect(`${landing}\n${robots}\n${sitemap}`).not.toContain('achiote.app');
  });

  it('does not publish placeholder testimonials before real customer feedback exists', () => {
    const landing = fs.readFileSync('docs/landing/index.html', 'utf8');

    expect(landing).not.toContain('Simon G., first memory reconstructed');
    expect(landing).not.toContain('Beta user, family recipe recovery');
    expect(landing).not.toMatch(/\btestimonials?\b/i);
  });

  it('documents secure HTTP auth defaults and source/tarball install status', () => {
    const readme = fs.readFileSync('README.md', 'utf8');
    const envExample = fs.readFileSync('.env.example', 'utf8');

    expect(readme).toContain('Authentication is enabled by default');
    expect(readme).toContain('Achiote is not published to npm yet');
    expect(envExample).toContain('ACHIOTE_AUTH_ENABLED=true');
    expect(envExample).toContain('ACHIOTE_ASK_PROVIDER=anthropic');
    expect(envExample).toContain('ANTHROPIC_API_KEY=');
    expect(envExample).toContain('OPENAI_BASE_URL=');
    expect(envExample).toContain('OPENAI_MODEL=');
  });

  it('documents paid-launch production safety checks and auth-disabled warning', () => {
    const runbook = fs.readFileSync('docs/LAUNCH_RUNBOOK.md', 'utf8');

    for (const copy of [
      'Paid Launch Checklist',
      'ACHIOTE_AUTH_ENABLED=true',
      'ACHIOTE_ALLOWED_ORIGINS set to exact HTTPS origins',
      'STRIPE_WEBHOOK_SECRET',
      'billing portal',
      'checkout smoke',
      'No anonymous paid traffic',
      'Current Production State',
      'ACHIOTE_ALLOW_ANON_ASK=false',
      'Checkout session creation has been smoke-tested live',
      'Actual card payment completion and webhook-issued API key delivery still need one real transaction test',
      'If /ready reports "authEnabled": false, do not treat the deployment as paid-launch ready',
    ]) {
      expect(runbook).toContain(copy);
    }
  });
});
