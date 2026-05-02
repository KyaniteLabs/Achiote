#!/usr/bin/env node

import fs from 'node:fs';
import { resolve } from 'node:path';
import {
  analyzeKnowledgeGaps,
  buildTaxonomyRemediationQueue,
  parseJsonl,
  reconcileTaxonomyRemediationQueue,
} from './lib/knowledge-gap-canary.mjs';

function usage() {
  return [
    'Usage:',
    '  node scripts/knowledge-gap-canary.mjs --results artifacts/run/results.jsonl [--out report.json] [--taxonomy-queue queue.json] [--source-artifact label]',
    '  node scripts/knowledge-gap-canary.mjs --reconcile-taxonomy docs/taxonomy-remediation-queue.json [--out docs/taxonomy-remediation-queue.json]',
    '',
    'Reads existing canary JSONL. Does not browse, call providers, or use user raw memories as seed data.',
    'When --taxonomy-queue is provided, writes a clean knowledge-gap remediation queue for taxonomy work.',
    'When --reconcile-taxonomy is provided, marks queue items covered by bundled seeds, dish families, and fixtures.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--results') args.results = argv[++index];
    else if (arg === '--out') args.out = argv[++index];
    else if (arg === '--taxonomy-queue') args.taxonomyQueue = argv[++index];
    else if (arg === '--reconcile-taxonomy') args.reconcileTaxonomy = argv[++index];
    else if (arg === '--source-artifact') args.sourceArtifact = argv[++index];
    else if (arg === '--landed-in') args.landedIn = argv[++index];
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  if (args.reconcileTaxonomy) {
    const queue = readJson(args.reconcileTaxonomy);
    const reconciled = reconcileTaxonomyRemediationQueue(queue, {
      landedIn: args.landedIn,
      referenceSeedQueue: readJson('src/data/reference-seed-queue.json'),
      referencePantryFixtures: readJson('src/data/reference-pantry-fixtures.json'),
      dishFamilies: readJson('src/data/dish-families.json'),
    });
    const json = JSON.stringify(reconciled, null, 2);
    if (args.out) fs.writeFileSync(resolve(args.out), `${json}\n`);
    else console.log(json);
    process.exit(0);
  }
  if (!args.results) throw new Error('--results is required');
  const source = resolve(args.results);
  const rows = parseJsonl(fs.readFileSync(source, 'utf8'));
  const analysis = analyzeKnowledgeGaps(rows);
  const taxonomyRemediationQueue = buildTaxonomyRemediationQueue(analysis, {
    sourceArtifact: args.sourceArtifact ?? args.results,
    landedIn: args.landedIn,
  });
  const report = {
    generatedAt: new Date().toISOString(),
    source,
    ...analysis,
    taxonomyRemediationQueue,
  };
  const json = JSON.stringify(report, null, 2);
  if (args.out) fs.writeFileSync(resolve(args.out), `${json}\n`);
  else console.log(json);
  if (args.taxonomyQueue) {
    fs.writeFileSync(resolve(args.taxonomyQueue), `${JSON.stringify(taxonomyRemediationQueue, null, 2)}\n`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage());
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(resolve(filePath), 'utf8'));
}
