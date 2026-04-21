import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('P1 launch hardening guardrails', () => {
  it('runs the full local check script in CI so citation validation cannot drift', () => {
    const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci).toContain('npm run check');
  });

  it('fails citation validation when the landing page has no DOI citations', () => {
    const script = fs.readFileSync('scripts/validate-citations.mjs', 'utf8');
    expect(script).toContain('No DOI citations found');
    expect(script).not.toContain('No citations found");\n    process.exit(0);');
  });

  it('does not accept API keys in query strings in production code or docs', () => {
    const combined = [
      fs.readFileSync('src/http-server.ts', 'utf8'),
      fs.readFileSync('README.md', 'utf8'),
      fs.readFileSync('SECURITY.md', 'utf8'),
      fs.readFileSync('docs/ARCHITECTURE.md', 'utf8'),
    ].join('\n');

    expect(combined).not.toContain('apiKey=');
    expect(combined).not.toContain("searchParams.get('apiKey')");
    expect(combined).not.toContain('query param');
  });

  it('makes frontend HTTP errors actionable instead of generic Server N messages', () => {
    const app = fs.readFileSync('docs/landing/app.js', 'utf8');
    expect(app).toContain('Authentication required');
    expect(app).toContain('Rate limit exceeded');
    expect(app).toContain('Could not parse server response');
  });

  it('extends package smoke to exercise the packaged HTTP server', () => {
    const smoke = fs.readFileSync('scripts/package-smoke.mjs', 'utf8');
    expect(smoke).toContain('assertPackagedHttpServerStarts');
    expect(smoke).toContain('/health');
    expect(smoke).toContain('/about');
  });

  it('makes HTTP output validation and tool failures deterministic', () => {
    const server = fs.readFileSync('src/http-server.ts', 'utf8');
    expect(server).toContain('throw new Error(`[validation]');
    expect(server).toContain("send('error', { message: 'Tool failed'");
  });
});
