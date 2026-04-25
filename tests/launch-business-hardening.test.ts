import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const landing = () => fs.readFileSync('docs/landing/index.html', 'utf8');
const app = () => fs.readFileSync('docs/landing/app.html', 'utf8');
const appJs = () => fs.readFileSync('docs/landing/app.js', 'utf8');
const server = () => fs.readFileSync('src/http-server.ts', 'utf8');

describe('launch business hardening', () => {
  it('publishes trust, legal, safety, and support pages linked from public surfaces', () => {
    for (const page of ['privacy.html', 'terms.html', 'support.html', 'safety.html', 'ai-search.html', 'llms.txt']) {
      expect(fs.existsSync(`docs/landing/${page}`)).toBe(true);
    }

    const publicSurfaces = `${landing()}\n${app()}`;
    expect(publicSurfaces).toContain('/privacy');
    expect(publicSurfaces).toContain('/terms');
    expect(publicSurfaces).toContain('/support');
    expect(publicSurfaces).toContain('/safety');
    expect(publicSurfaces).toContain('/ai-search');
    expect(publicSurfaces).toContain('support@kyanitelabs.tech');
  });

  it('documents privacy controls, retention, deletion, and AI food-safety limits', () => {
    const privacy = fs.readFileSync('docs/landing/privacy.html', 'utf8');
    const safety = fs.readFileSync('docs/landing/safety.html', 'utf8');
    const support = fs.readFileSync('docs/landing/support.html', 'utf8');

    expect(privacy).toContain('Data deletion');
    expect(privacy).toContain('Food memories');
    expect(privacy).toContain('90 days');
    expect(safety).toContain('not medical advice');
    expect(safety).toContain('allergies');
    expect(support).toContain('Response target');
    expect(support).toContain('refund');
  });

  it('adds privacy-preserving telemetry and feedback hooks without storing prompt text', () => {
    expect(appJs()).toContain("trackEvent('ask_started'");
    expect(appJs()).toContain("trackEvent('ask_succeeded'");
    expect(appJs()).toContain("trackEvent('ask_failed'");
    expect(appJs()).toContain("sendFeedback(");
    expect(appJs()).toContain("navigator.sendBeacon('/events'");
    expect(appJs()).not.toContain("prompt_text");

    expect(server()).toContain('Forbidden origin');
    expect(server()).toContain('Telemetry rate limit exceeded');
    expect(server()).toContain("pathname === '/events'");
    expect(server()).toContain('allowedTelemetryEvents');
    expect(server()).toContain('telemetryCounters');
    expect(server()).toContain("sendJson(res, 404, { error: 'Not found' })");
    expect(server()).not.toContain('event.payload');
  });

  it('keeps SEO and launch metadata current for trust pages', () => {
    const sitemap = fs.readFileSync('docs/landing/sitemap.xml', 'utf8');
    const robots = fs.readFileSync('docs/landing/robots.txt', 'utf8');
    const manifest = fs.readFileSync('docs/landing/manifest.json', 'utf8');

    expect(landing()).toContain('application/ld+json');
    expect(landing()).toContain('ContactPoint');
    const jsonLdBlocks = [...landing().matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    expect(jsonLdBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of jsonLdBlocks) {
      expect(() => JSON.parse(block[1] ?? '')).not.toThrow();
    }
    expect(sitemap).toContain('/privacy');
    expect(sitemap).toContain('/terms');
    expect(sitemap).toContain('/support');
    expect(sitemap).toContain('/safety');
    expect(robots).toContain('Sitemap: https://achiote.kyanitelabs.tech/sitemap.xml');
    expect(manifest).toContain('Achiote');
  });

  it('documents launch operations, monitoring, support, rollback, and deletion workflow', () => {
    const runbook = fs.readFileSync('docs/LAUNCH_RUNBOOK.md', 'utf8');

    expect(runbook).toContain('npm run check');
    expect(runbook).toContain('ask_failed / ask_started');
    expect(runbook).toContain('support@kyanitelabs.tech');
    expect(runbook).toContain('90 days');
    expect(runbook).toContain('Rollback');
    expect(runbook).toContain('deletion/export/correction');
    expect(runbook).toContain('Do not expose raw event counters on a public route');
  });

  it('sells guided memories publicly and keeps hosted MCP/API commercial', () => {
    const page = landing();
    const setupScript = fs.readFileSync('scripts/setup-stripe-products.mjs', 'utf8');
    const httpServer = server();

    for (const copy of ['3 guided memories', '25 guided memories', '100 guided memories', '300 guided memories']) {
      expect(page).toContain(copy);
    }

    for (const copy of ['25 guided memories', '100 guided memories', '300 guided memories']) {
      expect(setupScript).toContain(copy);
    }

    expect(page).toContain('$9');
    expect(page).toContain('$19');
    expect(page).toContain('$39');
    expect(page).toContain('API and MCP access require a commercial license');
    expect(page).toContain('data-checkout-tier="personal"');
    expect(page).toContain('data-checkout-tier="family"');
    expect(httpServer).toContain("tier !== 'personal' && tier !== 'pro' && tier !== 'family'");
    expect(httpServer).toContain('Use personal, pro, or family.');

    for (const stale of [
      '50 MCP calls / month',
      '5,000 MCP calls / month',
      '100,000 MCP calls / month',
      'Unlimited web reconstructions',
      '1,000 extra calls',
      'hosted API free tier',
      'A hosted HTTP API is also available',
    ]) {
      expect(page).not.toContain(stale);
      expect(setupScript).not.toContain(stale);
    }
  });
});
