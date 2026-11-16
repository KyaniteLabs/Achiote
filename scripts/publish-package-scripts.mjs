#!/usr/bin/env node
/**
 * npm pack/publish copies package.json as it sits after prepack. Dev scripts
 * need a git checkout (TypeScript sources, tests, the plugin tree) and cannot
 * run from the published tarball. Strip them from the packed manifest and
 * restore the working tree in postpack.
 *
 *   node scripts/publish-package-scripts.mjs apply
 *   node scripts/publish-package-scripts.mjs restore
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'package.json');
const backupPath = path.join(root, '.package.json.prepack-backup');

/**
 * Scripts that run from an installed tarball: production dependencies plus the
 * shipped files (dist/, scripts/, src/data/). Dev-only scripts stay in the repo
 * manifest and are removed here, which is what makes "every published script
 * runs from the tarball" true.
 */
export const PUBLISHED_SCRIPTS = {
  start: 'node dist/index.js',
  diagnose: 'node scripts/diagnose.mjs',
  keygen: 'node scripts/generate-api-key.mjs',
  lint: 'node scripts/static-checks.mjs',
  'reference:coverage': 'node scripts/reference-coverage-audit.mjs --fail',
  'reference:seeds': 'node scripts/reference-seed-operator.mjs',
  'knowledge:canary': 'node scripts/knowledge-gap-canary.mjs',
  'verify:dois': 'node scripts/verify-dois.mjs --fail',
  'validate:citations': 'node scripts/validate-citations.mjs --tolerant',
  'live:ask': 'node scripts/live-ask-smoke.mjs',
  'preview:smoke': 'node scripts/preview-ask-smoke.mjs',
  'canary:local': 'node scripts/local-canary-qa.mjs',
  'local:profile': 'node scripts/local-inference-profiler.mjs',
  'telemetry:models': 'node scripts/model-telemetry-report.mjs',
  'torture:fake': 'node scripts/torture-smoke.mjs',
  'viability:smoke': 'node scripts/viability-transcript-smoke.mjs',
};

function apply() {
  if (fs.existsSync(backupPath)) {
    throw new Error(`Refusing to apply twice; restore ${backupPath} first`);
  }
  const original = fs.readFileSync(manifestPath, 'utf8');
  const pkg = JSON.parse(original);
  fs.writeFileSync(backupPath, original);
  pkg.scripts = { ...PUBLISHED_SCRIPTS };
  fs.writeFileSync(manifestPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function restore() {
  if (!fs.existsSync(backupPath)) return;
  fs.copyFileSync(backupPath, manifestPath);
  fs.unlinkSync(backupPath);
}

const command = process.argv[2];
if (command === 'apply') apply();
else if (command === 'restore') restore();
else {
  console.error('usage: node scripts/publish-package-scripts.mjs apply|restore');
  process.exit(2);
}
