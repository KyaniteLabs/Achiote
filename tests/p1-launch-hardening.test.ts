import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('P1 launch hardening guardrails', () => {
  it('runs the full release check script in the Node 22 CI gate so citation validation cannot drift', () => {
    const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
    const releaseJob = ci.slice(ci.indexOf('release-gate:'), ci.indexOf('compatibility-gate:'));
    expect(ci).toContain('release-gate:');
    expect(releaseJob).toContain('name: Node 22 release gate');
    expect(releaseJob).toContain('node-version: 22');
    expect(releaseJob).toMatch(/^\s+run: npm run check$/m);
    expect(releaseJob).toMatch(/^\s+run: npm run validate:citations$/m);
    expect(releaseJob).toContain('npm audit --audit-level=moderate');
    expect(releaseJob).toContain('npm run package:smoke');
    expect(releaseJob).toContain('npm pack --dry-run');
  });

  it('keeps Node 24 as a compatibility gate without duplicating release packaging work', () => {
    const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');

    expect(ci).toContain('compatibility-gate:');
    expect(ci).toContain('name: Node 24 compatibility gate');
    expect(ci).toContain('node-version: 24');
    expect(ci).toContain('npm run check:compat');
    expect(ci).toContain('npm ci');

    const compatibilityJob = ci.slice(ci.indexOf('compatibility-gate:'));
    expect(compatibilityJob).not.toContain('npm run package:smoke');
    expect(compatibilityJob).not.toContain('npm pack --dry-run');
    expect(compatibilityJob).not.toContain('npm audit --audit-level=moderate');
  });

  it('fails citation validation when the landing page has no DOI citations', () => {
    const script = fs.readFileSync('scripts/validate-citations.mjs', 'utf8');
    expect(script).toContain('No DOI citations found');
    expect(script).not.toContain('No citations found");\n    process.exit(0);');
  });

  it('keeps flaky doi.org network resolution secondary to Crossref metadata', () => {
    const script = fs.readFileSync('scripts/validate-citations.mjs', 'utf8');
    expect(script).toContain('relying on Crossref');
    expect(script).not.toContain('errors.push(`DOI resolution failed: ${e.message}`)');
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
    const productApp = fs.readFileSync('docs/landing/product-app.js', 'utf8');
    expect(app).toContain('ProductApp.explainHttpStatus');
    expect(productApp).toContain('The public demo should be open');
    expect(productApp).not.toContain('demo password');
    expect(productApp).toContain('Rate limit exceeded');
    expect(productApp).toContain('Could not parse server response');
  });

  it('extends package smoke to exercise the packaged HTTP server', () => {
    const smoke = fs.readFileSync('scripts/package-smoke.mjs', 'utf8');
    expect(smoke).toContain('assertPackagedHttpServerStarts');
    expect(smoke).toContain('/health');
    expect(smoke).toContain('/about');
  });

  it('makes HTTP output validation and tool failures deterministic', () => {
    // Output validation + tool-failure error streaming were extracted into the transport-neutral
    // engine that the HTTP /ask surface delegates to.
    const engine = fs.readFileSync('src/core/ask-engine.ts', 'utf8');
    expect(engine).toContain('throw new Error(`[validation]');
    expect(engine).toContain("send('error', { message: 'Tool failed'");
  });

  it('keeps the product ask prompt aligned with the MCP follow-up workflow', () => {
    // The shared /ask system prompt was extracted into the engine deps factory in phase 2.
    const prompt = fs.readFileSync('src/core/ask-engine-deps.ts', 'utf8');

    expect(prompt).toContain('Ask 1-3 specific, high-value follow-up questions');
    expect(prompt).toContain('quote or adapt the tool-generated nextQuestions');
    expect(prompt).not.toContain('NEVER ask follow-up questions');
    expect(prompt).not.toContain('The cue IS the answer');
  });

  it('does not silently drop chat history updates in the frontend SSE parser', () => {
    const app = fs.readFileSync('docs/landing/app.js', 'utf8');
    const productApp = fs.readFileSync('docs/landing/product-app.js', 'utf8');

    expect(app).toContain('streamResponse(res, aiEl, val)');
    expect(app).toContain('ProductApp.appendChatTurn(chatHistory, userMessage, assistantTurnText, 20)');
    // Receipt-only turns (no prose) must still record the user's message, otherwise the
    // conversation resets and earlier clues are lost.
    expect(app).toContain('ProductApp.summarizeReceiptForHistory(lastReceipt)');
    expect(productApp).toContain("{ role: 'user', content: String(userMessage || '') }");
    expect(app).toContain('console.warn');
    expect(app).not.toContain('content: val');
    expect(app).not.toContain('catch { /* skip */ }');
  });

  it('does not stream a plain first model response when the tool workflow was skipped', () => {
    // The deterministic-recovery path lives in the transport-neutral engine the HTTP surface delegates to.
    const engine = fs.readFileSync('src/core/ask-engine.ts', 'utf8');

    expect(engine).toContain('provider_tool_deterministic_recovery');
    expect(engine).toContain('model skipped required Achiote tool workflow');
  });

  it('keeps provider and model identity out of the public ask trace', () => {
    // The /ask model status events are emitted from the engine now.
    const engine = fs.readFileSync('src/core/ask-engine.ts', 'utf8');
    const app = fs.readFileSync('docs/landing/app.js', 'utf8');

    expect(engine).toContain("send('status', { stage: 'model'");
    expect(engine).not.toContain("send('status', { stage: 'model', provider:");
    expect(engine).not.toContain('provider=${ASK_PROVIDER_KIND} model=${ASK_MODEL}');
    expect(app).not.toContain('model-label');
    expect(app).not.toContain('trace-provider');
  });
});
