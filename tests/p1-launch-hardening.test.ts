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

  it('keeps the product ask prompt aligned with the MCP follow-up workflow', () => {
    const server = fs.readFileSync('src/http-server.ts', 'utf8');

    expect(server).toContain('Ask 1-3 specific, high-value follow-up questions');
    expect(server).toContain('quote or adapt the tool-generated nextQuestions');
    expect(server).not.toContain('NEVER ask follow-up questions');
    expect(server).not.toContain('The cue IS the answer');
  });

  it('does not silently drop chat history updates in the frontend SSE parser', () => {
    const app = fs.readFileSync('docs/landing/app.js', 'utf8');

    expect(app).toContain('streamResponse(res, aiEl, val)');
    expect(app).toContain('chatHistory.push({ role: \'user\', content: userMessage })');
    expect(app).toContain('console.warn');
    expect(app).not.toContain('content: val');
    expect(app).not.toContain('catch { /* skip */ }');
  });

  it('does not stream a plain first model response when the tool workflow was skipped', () => {
    const server = fs.readFileSync('src/http-server.ts', 'utf8');

    expect(server).toContain('provider_tool_deterministic_recovery');
    expect(server).toContain('model skipped required Achiote tool workflow');
  });

  it('keeps provider and model identity out of the public ask trace', () => {
    const server = fs.readFileSync('src/http-server.ts', 'utf8');
    const app = fs.readFileSync('docs/landing/app.js', 'utf8');

    expect(server).toContain("send('status', { stage: 'model'");
    expect(server).not.toContain("send('status', { stage: 'model', provider:");
    expect(server).not.toContain('provider=${ASK_PROVIDER_KIND} model=${ASK_MODEL}');
    expect(app).not.toContain('model-label');
    expect(app).not.toContain('trace-provider');
  });
});
