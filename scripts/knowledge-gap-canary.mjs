#!/usr/bin/env node

import fs from 'node:fs';
import { resolve } from 'node:path';
import { analyzeKnowledgeGaps, parseJsonl } from './lib/knowledge-gap-canary.mjs';

function usage() {
  return [
    'Usage:',
    '  node scripts/knowledge-gap-canary.mjs --results artifacts/run/results.jsonl [--out report.json]',
    '',
    'Reads existing canary JSONL. Does not browse, call providers, or use user raw memories as seed data.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--results') args.results = argv[++index];
    else if (arg === '--out') args.out = argv[++index];
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
  if (!args.results) throw new Error('--results is required');
  const rows = parseJsonl(fs.readFileSync(resolve(args.results), 'utf8'));
  const report = {
    generatedAt: new Date().toISOString(),
    source: resolve(args.results),
    gaps: analyzeKnowledgeGaps(rows),
  };
  const json = JSON.stringify(report, null, 2);
  if (args.out) fs.writeFileSync(resolve(args.out), `${json}\n`);
  else console.log(json);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage());
  process.exit(1);
}
