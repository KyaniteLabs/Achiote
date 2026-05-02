#!/usr/bin/env node

import fs from 'node:fs';
import { resolve } from 'node:path';
import { ResearchCache } from '../dist/lib/research-cache.js';
import { bundledGlobalReferenceSeeds } from '../dist/lib/reference-seed-planner.js';
import {
  buildReferenceSeedOperatorReport,
  writeReferenceSeedFixturesToCache,
} from '../dist/lib/reference-seed-operator.js';

function usage() {
  return [
    'Usage:',
    '  node scripts/reference-seed-operator.mjs [--quality-report quality.json] [--limit 10]',
    '  node scripts/reference-seed-operator.mjs --fixture approved-fixture.json --cache-path /path/to/cache.db',
    '  node scripts/reference-seed-operator.mjs --fixture bundled --cache-path /path/to/cache.db',
    '',
    'This script does not browse. It only prints host-research tasks or stores approved typed ResearchRecord fixtures.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { limit: 10 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--quality-report') args.qualityReport = argv[++i];
    else if (arg === '--fixture') args.fixture = argv[++i];
    else if (arg === '--cache-path') args.cachePath = argv[++i];
    else if (arg === '--limit') args.limit = Number.parseInt(argv[++i] ?? '', 10);
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(resolve(filePath), 'utf8'));
}

function emptyQualityReport() {
  return {
    total: 0,
    byMemoryType: {},
    byFamily: {},
    byRegion: {},
    byGuard: {},
    bySearch: {},
    byCache: {},
    missing: {},
  };
}

function writeApprovedFixtures(fixturePath, cachePath) {
  const fixture = fixturePath === 'bundled' ? readJson('src/data/reference-pantry-fixtures.json') : readJson(fixturePath);
  const cache = new ResearchCache(resolve(cachePath));
  try {
    return writeReferenceSeedFixturesToCache(fixture, cache);
  } finally {
    cache.close();
  }
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  if (args.fixture || args.cachePath) {
    if (!args.fixture || !args.cachePath) throw new Error('--fixture and --cache-path must be provided together');
    console.log(JSON.stringify(writeApprovedFixtures(args.fixture, args.cachePath), null, 2));
  } else {
    const report = args.qualityReport ? readJson(args.qualityReport) : emptyQualityReport();
    console.log(JSON.stringify(buildReferenceSeedOperatorReport(report, { limit: args.limit }), null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage());
  process.exit(1);
}
