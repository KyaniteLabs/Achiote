import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('product differentiation surface', () => {
  it('publishes a competitor comparison without attacking specific brands', () => {
    const compare = fs.readFileSync('docs/landing/compare.html', 'utf8');

    expect(compare).toContain('Why not just use ChatGPT or Google?');
    expect(compare).toContain('Generic AI is good at plausible answers');
    expect(compare).toContain('Achiote is built for evidence-bounded food-memory reconstruction');
    expect(compare).toContain('Memory Receipt');
    expect(compare).toContain('User-said');
    expect(compare).toContain('Inferred');
    expect(compare).toContain('Unknown');
    expect(compare).toContain('First tiny taste test');
    expect(compare).not.toMatch(/ChatGPT is bad|Claude is bad|Google is bad/i);
  });

  it('links comparison from public discovery surfaces', () => {
    const landing = fs.readFileSync('docs/landing/index.html', 'utf8');
    const sitemap = fs.readFileSync('docs/landing/sitemap.xml', 'utf8');
    expect(landing).toContain('/compare');
    expect(sitemap).toContain('https://achiote.kyanitelabs.tech/compare');
  });
});
