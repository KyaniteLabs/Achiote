export const PACKAGE_SURFACE = {
  runtimeEntrypoints: [
    'bin/achiote.mjs',
    'dist/index.js',
    'dist/http-server.js',
  ],
  productAppAssets: [
    'docs/landing/app.html',
    'docs/landing/product-app.js',
    'docs/landing/app.js',
    'docs/landing/index.html',
    'docs/landing/index.js',
    'docs/landing/manifest.json',
    'docs/landing/robots.txt',
    'docs/landing/sitemap.xml',
    'docs/landing/llms.txt',
  ],
  publicDocs: [
    'README.md',
    'LICENSE',
    'docs/ARCHITECTURE.md',
    'docs/AI_SEARCH_SUBMISSION_RUNBOOK.md',
    'docs/LAUNCH_RUNBOOK.md',
    'docs/ROADMAP.md',
    'docs/SELF_HOSTED_RUNNER.md',
  ],
  helperScripts: [
    'scripts/generate-api-key.mjs',
    'scripts/docker-smoke.mjs',
    'scripts/live-ask-smoke.mjs',
    'scripts/preview-ask-smoke.mjs',
    'scripts/local-canary-qa.mjs',
    'scripts/local-inference-profiler.mjs',
    'scripts/model-telemetry-report.mjs',
    'scripts/knowledge-gap-canary.mjs',
    'scripts/torture-smoke.mjs',
    'scripts/viability-transcript-smoke.mjs',
    'scripts/reference-seed-operator.mjs',
  ],
  forbiddenPackagePathPatterns: [
    /^artifacts\//,
    /^\.worktrees\//,
    /^\.omx\//,
    /^\.env(?:$|\.)/,
    /(?:^|\/)(?:[^/]+\.)?(?:sqlite|sqlite3|db)$/,
    /(?:^|\/)local-.*(?:log|jsonl)$/,
    /(?:^|\/)weak-cloud-overnight\.mjs$/,
    /(?:^|\/)run-manifest\.json$/,
    /(?:^|\/)results\.jsonl$/,
    /(?:^|\/)overnight_results\.json$/,
    /(?:^|\/)overnight_test\.log$/,
  ],
};

export function expectedPackageFiles() {
  return [
    ...PACKAGE_SURFACE.runtimeEntrypoints,
    ...PACKAGE_SURFACE.productAppAssets,
    ...PACKAGE_SURFACE.publicDocs,
    ...PACKAGE_SURFACE.helperScripts,
  ];
}

export function assertPackageSurfaceFiles(files) {
  const packaged = new Set(files);
  const missing = expectedPackageFiles().filter((file) => !packaged.has(file));
  const forbidden = files.filter((file) => PACKAGE_SURFACE.forbiddenPackagePathPatterns.some((pattern) => pattern.test(file)));
  return { missing, forbidden };
}
