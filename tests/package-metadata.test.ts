import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import pkg from '../package.json' with { type: 'json' };

describe('package distribution metadata', () => {
  it('declares install, type, executable, and source-control metadata', () => {
    expect(pkg.license).toBe('BUSL-1.1');
    expect(pkg.types).toBe('dist/index.d.ts');
    expect(pkg.bin).toEqual({ achiote: 'bin/achiote.mjs' });
    expect(pkg.exports).toEqual({
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
      },
    });
    expect(pkg.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/KyaniteLabs/Achiote.git',
    });
    expect(pkg.bugs).toEqual({
      url: 'https://github.com/KyaniteLabs/Achiote/issues',
    });
    expect(pkg.homepage).toBe('https://github.com/KyaniteLabs/Achiote#readme');
    expect(pkg.engines.node).toBe('>=22.0.0');
  });

  it('ships Business Source License 1.1 terms', () => {
    const license = fs.readFileSync('LICENSE', 'utf8');

    expect(license).toContain('Business Source License 1.1');
    expect(license).toContain('Additional Use Grant: None');
    expect(license).toContain('Change Date: 2030-04-25');
    expect(license).toContain('Change License: GNU General Public License version 2.0 or later');
    expect(license).not.toContain('MIT License');
  });

  it('publishes only intentional package files', () => {
    expect(pkg.files).toEqual([
      'bin/',
      'dist/',
      'skill/',
      'scripts/',
      '!scripts/weak-cloud-overnight.mjs',
      'docs/ARCHITECTURE.md',
      'docs/AI_SEARCH_SUBMISSION_RUNBOOK.md',
      'docs/LAUNCH_RUNBOOK.md',
      'docs/ROADMAP.md',
      'docs/SELF_HOSTED_RUNNER.md',
      'docs/landing/about.html',
      'docs/landing/ai-search.html',
      'docs/landing/app.html',
      'docs/landing/product-app.js',
      'docs/landing/app.js',
      'docs/landing/blog.html',
      'docs/landing/billing-success.html',
      'docs/landing/changelog.html',
      'docs/landing/compare.html',
      'docs/landing/fonts/',
      'docs/landing/hero-image.jpg',
      'docs/landing/images/',
      'docs/landing/index.html',
      'docs/landing/index.js',
      'docs/landing/llms.txt',
      'docs/landing/manifest.json',
      'docs/landing/og-image.jpg',
      'docs/landing/pricing.html',
      'docs/landing/privacy.html',
      'docs/landing/receipt.html',
      'docs/landing/receipt.js',
      'docs/landing/robots.txt',
      'docs/landing/roadmap.html',
      'docs/landing/safety.html',
      'docs/landing/sample-reconstruction-artifact.md',
      'docs/landing/sitemap.xml',
      'docs/landing/status.html',
      'docs/landing/support.html',
      'docs/landing/terms.html',
      'README.md',
      'LICENSE',
    ]);
  });

  it('has reproducible quality and packaging scripts', () => {
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
    expect(pkg.scripts.check).toBe('npm run typecheck && npm run lint && npm run coverage:guard && npm run build && npm run validate:citations && npm test');
    expect(pkg.scripts['check:compat']).toBe('npm run typecheck && npm run build && npm test');
    expect(pkg.scripts.lint).toBe('node scripts/static-checks.mjs');
    expect(pkg.scripts['coverage:guard']).toBe('node scripts/coverage-threshold.mjs');
    expect(pkg.scripts.keygen).toBe('node scripts/generate-api-key.mjs');
    expect(pkg.scripts['docker:smoke']).toBe('node scripts/docker-smoke.mjs');
    expect(pkg.scripts['live:ask']).toBe('node scripts/live-ask-smoke.mjs');
    expect(pkg.scripts['preview:smoke']).toBe('node scripts/preview-ask-smoke.mjs');
    expect(pkg.scripts['canary:local']).toBe('npm run build && node scripts/local-canary-qa.mjs');
    expect(pkg.scripts['local:profile']).toBe('npm run build && node scripts/local-inference-profiler.mjs');
    expect(pkg.scripts['telemetry:models']).toBe('npm run build && node scripts/model-telemetry-report.mjs');
    expect(pkg.scripts['torture:fake']).toBe('npm run build && node scripts/torture-smoke.mjs');
    expect(pkg.scripts['viability:smoke']).toBe('node scripts/viability-transcript-smoke.mjs');
    expect(pkg.scripts['reference:seeds']).toBe('npm run build && node scripts/reference-seed-operator.mjs');
    expect(pkg.scripts['pack:check']).toBe('npm run check && npm run package:smoke && npm pack --dry-run');
    expect(pkg.scripts['package:smoke']).toBe('node scripts/package-smoke.mjs');
  });

  it('keeps private quality-signal telemetry inside the shipped server build', () => {
    const server = fs.readFileSync('src/http-server.ts', 'utf8');
    const qualitySignals = fs.readFileSync('src/lib/quality-signals.ts', 'utf8');

    expect(pkg.files).toContain('dist/');
    expect(server).toContain("from './lib/quality-signals.js'");
    expect(server).toContain('quality: qualitySignalReport');
    expect(qualitySignals).toContain('export function buildAskQualitySignal');
    expect(qualitySignals).not.toContain('rawMemory');
    expect(qualitySignals).not.toContain('memoryText');
  });

  it('ships global reference seed data only through the compiled dist data bundle', () => {
    const planner = fs.readFileSync('src/lib/reference-seed-planner.ts', 'utf8');
    const index = fs.readFileSync('src/index.ts', 'utf8');

    expect(pkg.files).toContain('dist/');
    expect(pkg.files).not.toContain('src/data/global-coverage-matrix.json');
    expect(pkg.files).not.toContain('src/data/reference-seed-queue.json');
    expect(pkg.files).not.toContain('src/data/cache-warming-manifest.json');
    expect(pkg.files).not.toContain('src/data/reference-source-registry.json');
    expect(pkg.files).not.toContain('src/data/reference-pantry-fixtures.json');
    expect(pkg.files).not.toContain('src/data/inference-burden-inventory.json');
    expect(planner).toContain("from '../data/global-coverage-matrix.json'");
    expect(planner).toContain("from '../data/reference-seed-queue.json'");
    expect(planner).toContain("from '../data/cache-warming-manifest.json'");
    expect(planner).toContain("from '../data/reference-source-registry.json'");
    expect(planner).toContain("from '../data/reference-pantry-fixtures.json'");
    expect(index).toContain("export { bundledGlobalReferenceSeeds, prioritizeReferenceSeeds } from './lib/reference-seed-planner.js';");
    expect(index).toContain('writeReferenceSeedFixturesToCache');
    expect(index).toContain('buildInferenceBurdenSummary');
    expect(index).toContain('findPromptOffloadCandidates');
    expect(fs.existsSync('src/lib/reference-seed-operator.ts')).toBe(true);
    expect(fs.existsSync('src/lib/inference-burden-inventory.ts')).toBe(true);
  });

  it('uses a portable package-smoke temp directory prefix', () => {
    const smokeScript = fs.readFileSync('scripts/package-smoke.mjs', 'utf8');

    expect(smokeScript).toContain("const smokeRoot = path.join(os.tmpdir(), 'achiote-package-smoke');");
    expect(smokeScript).toContain("fs.mkdirSync(smokeRoot, { recursive: true });");
    expect(smokeScript).toContain("fs.mkdtempSync(path.join(smokeRoot, 'run-'))");
    expect(smokeScript).not.toContain("fs.mkdtempSync(path.join(os.tmpdir(), 'achiote-package-smoke-'))");
    expect(smokeScript).not.toContain("achiote-package-smoke-XXXXXX");
    expect(smokeScript).toContain("'--fixture'");
    expect(smokeScript).toContain("'bundled'");
    expect(smokeScript).toContain('packaged-reference-pantry.db');
    expect(smokeScript).toContain("const exited = new Promise((resolve) => child.once('exit', resolve));");
    expect(smokeScript).toContain("await withTimeout(exited, 5_000, 'packaged HTTP shutdown');");
  });

  it('declares the package surface as a single release contract', async () => {
    const { PACKAGE_SURFACE, assertPackageSurfaceFiles } = await import('../scripts/lib/package-surface.mjs');
    const smokeScript = fs.readFileSync('scripts/package-smoke.mjs', 'utf8');

    expect(PACKAGE_SURFACE.runtimeEntrypoints).toEqual(expect.arrayContaining([
      'bin/achiote.mjs',
      'dist/index.js',
      'dist/http-server.js',
    ]));
    expect(PACKAGE_SURFACE.productAppAssets).toContain('docs/landing/product-app.js');
    expect(PACKAGE_SURFACE.helperScripts).toContain('scripts/reference-seed-operator.mjs');
    expect(assertPackageSurfaceFiles([
      ...PACKAGE_SURFACE.runtimeEntrypoints,
      ...PACKAGE_SURFACE.productAppAssets,
      ...PACKAGE_SURFACE.publicDocs,
      ...PACKAGE_SURFACE.helperScripts,
      'artifacts/private.json',
    ])).toMatchObject({
      missing: [],
      forbidden: ['artifacts/private.json'],
    });
    expect(smokeScript).toContain('assertPackageSurfaceFiles');
    expect(smokeScript).toContain('Package surface mismatch');
  });


  it('keeps live ask smoke diagnostics graceful', () => {
    const liveSmokeScript = fs.readFileSync('scripts/live-ask-smoke.mjs', 'utf8');

    expect(liveSmokeScript).toContain('function cleanupListeners()');
    expect(liveSmokeScript).toContain('Malformed text event JSON');
    expect(liveSmokeScript).toContain('parseTextPayload');
    expect(liveSmokeScript).toContain("ACHIOTE_ALLOW_ANON_ASK: 'true'");
    expect(liveSmokeScript).toContain('ANTHROPIC_AUTH_TOKEN');
    expect(liveSmokeScript).toContain('ANTHROPIC_BASE_URL');
    expect(liveSmokeScript).toContain('ANTHROPIC_DEFAULT_SONNET_MODEL');
    expect(liveSmokeScript).toContain('LIVE_ASK_TIMEOUT_MS');
    expect(liveSmokeScript).toContain('OPENAI_BASE_URL');
    expect(liveSmokeScript).toContain('ACHIOTE_ASK_PROVIDER');
  });

  it('keeps local canary QA gentle and qwen3.5-0.8b focused', () => {
    const canaryScript = fs.readFileSync('scripts/local-canary-qa.mjs', 'utf8');

    expect(canaryScript).toContain("const DEFAULT_MODEL = 'qwen3.5-0.8b';");
    expect(canaryScript).toContain('Stopping early after');
    expect(canaryScript).toContain('provider/runtime failure');
    expect(canaryScript).toContain('LOCAL_CANARY_PACE_MS');
    expect(canaryScript).toContain('LOCAL_CANARY_CASES');
    expect(canaryScript).toContain('LOCAL_CANARY_PROFILE');
    expect(canaryScript).toContain('LOCAL_CANARY_SUMMARY_JSON');
    expect(canaryScript).toContain("forbidden_tool:search_web");
    expect(canaryScript).toContain('generic_placeholder_cue');
  });


  it('allows the /ask model to be overridden for Anthropic-compatible providers', () => {
    const httpServer = fs.readFileSync('src/http-server.ts', 'utf8');
    const askProvider = fs.readFileSync('src/lib/ask-provider.ts', 'utf8');
    const providerRuntime = fs.readFileSync('src/lib/provider-runtime.ts', 'utf8');

    expect(providerRuntime).toContain('const model = resolveAskModel(env)');
    expect(providerRuntime).toContain('createOpenAICompatibleAskSession');
    expect(providerRuntime).toContain('createAnthropicAskSession');
    expect(askProvider).toContain('ANTHROPIC_DEFAULT_SONNET_MODEL');
    expect(askProvider).toContain('ANTHROPIC_MODEL');
    expect(httpServer).toContain('ANTHROPIC_TIMEOUT_MS');
    expect(httpServer).toContain('API_TIMEOUT_MS');
    expect(httpServer).toContain('anthropicClientOptions');
    expect(httpServer).toContain('authToken');
    expect(httpServer).toContain('createProviderRuntime');
    expect(askProvider).toContain('OPENAI_BASE_URL');
    expect(askProvider).toContain('LM_STUDIO_MODEL');
    expect(askProvider).toContain('glm-5v-turbo');
    expect(httpServer).not.toContain("model: 'glm-5v-turbo'");
  });

});


describe('packaged helper scripts', () => {
  it('ships helper scripts referenced by package metadata', () => {
    expect(fs.existsSync('scripts/generate-api-key.mjs')).toBe(true);
    expect(fs.existsSync('scripts/docker-smoke.mjs')).toBe(true);
    expect(fs.existsSync('scripts/live-ask-smoke.mjs')).toBe(true);
    expect(fs.existsSync('scripts/preview-ask-smoke.mjs')).toBe(true);
    expect(fs.existsSync('scripts/local-canary-qa.mjs')).toBe(true);
    expect(fs.existsSync('scripts/local-inference-profiler.mjs')).toBe(true);
    expect(fs.existsSync('scripts/model-telemetry-report.mjs')).toBe(true);
    expect(fs.existsSync('scripts/torture-smoke.mjs')).toBe(true);
    expect(fs.existsSync('scripts/viability-transcript-smoke.mjs')).toBe(true);
    expect(fs.existsSync('scripts/reference-seed-operator.mjs')).toBe(true);
  });
});
