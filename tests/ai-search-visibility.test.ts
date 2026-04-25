import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');

describe('AI search visibility', () => {
  it('publishes an AI-readable summary and answer page', () => {
    const llms = read('docs/landing/llms.txt');
    const page = read('docs/landing/ai-search.html');
    const landing = read('docs/landing/index.html');

    expect(llms).toContain('Achiote is a source-available food-memory reconstruction system');
    expect(llms).toContain('License: Business Source License 1.1 (BUSL-1.1)');
    expect(llms).toContain('https://achiote.kyanitelabs.tech/ai-search');
    expect(llms).toContain('Not a generic recipe search engine');
    expect(llms).toContain('not medical, allergy, or nutrition advice');

    expect(page).toContain('Achiote is food-memory reconstruction for AI agents');
    expect(page).toContain('Business Source License 1.1 (BUSL-1.1)');
    expect(page).toContain('How is Achiote different from recipe search?');
    expect(page).toContain('/llms.txt');
    expect(landing).toContain('Business Source License 1.1');
    expect(landing).not.toContain('Open-Source MCP Server');
  });

  it('keeps AI-search structured data parseable and aligned with visible facts', () => {
    const page = read('docs/landing/ai-search.html');
    const jsonLdBlocks = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];

    expect(jsonLdBlocks).toHaveLength(2);
    const parsed = jsonLdBlocks.map((block) => JSON.parse(block[1] ?? '{}') as { '@type'?: string; mainEntity?: unknown[]; about?: { name?: string } });
    expect(parsed.map((block) => block['@type'])).toEqual(['WebPage', 'FAQPage']);
    expect(parsed[0].about?.name).toBe('Achiote');
    expect(parsed[1].mainEntity?.length).toBeGreaterThanOrEqual(5);
  });

  it('allows search/retrieval crawlers while keeping API endpoints and training crawlers closed', () => {
    const robots = read('docs/landing/robots.txt');

    for (const agent of ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'Googlebot', 'Google-Extended']) {
      expect(robots).toContain(`User-agent: ${agent}`);
      expect(robots).toMatch(new RegExp(`User-agent: ${agent}[\\s\\S]*?Allow: /`));
      expect(robots).toMatch(new RegExp(`User-agent: ${agent}[\\s\\S]*?Disallow: /ask`));
      expect(robots).toMatch(new RegExp(`User-agent: ${agent}[\\s\\S]*?Disallow: /events`));
    }

    expect(robots).toMatch(/User-agent: GPTBot\s+Disallow: \//);
    expect(robots).toMatch(/User-agent: ClaudeBot\s+Disallow: \//);
  });

  it('links AI search assets from the public surfaces and sitemap', () => {
    const landing = read('docs/landing/index.html');
    const app = read('docs/landing/app.html');
    const sitemap = read('docs/landing/sitemap.xml');
    const runbook = read('docs/LAUNCH_RUNBOOK.md');

    expect(landing).toContain('/ai-search');
    expect(landing).toContain('/llms.txt');
    expect(app).toContain('/ai-search');
    expect(sitemap).toContain('https://achiote.kyanitelabs.tech/ai-search');
    expect(sitemap).toContain('https://achiote.kyanitelabs.tech/llms.txt');
    expect(runbook).toContain('AI Search Visibility');
  });
});
