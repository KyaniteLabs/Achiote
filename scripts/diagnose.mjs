#!/usr/bin/env node
// Achiote — flavor fault diagnosis (cited).
//
// Maps a plain-language symptom ("my negroni smells like wet cardboard") to the
// most likely flavor/process fault, the cited food-science mechanism behind it,
// and a concrete fix. Every diagnosis is grounded in src/data/food-science-references.json
// (the verified, Crossref-checked moat) via the fault's mechanism slug — so the
// explanation and citation come straight from the DB, not from guessing.
//
//   node scripts/diagnose.mjs "the whisky is harsh and hot"
//   node scripts/diagnose.mjs --list      # show every fault it can detect
//
// Beverage-weighted for the professional beverage/mixology vertical, but covers
// core kitchen faults too. This is a demo surface over the engine: show it to a
// beverage pro, or wire it into the MCP/CLI/API later.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

const faultsDoc = readJson('src/data/fault-patterns.json');
const refs = readJson('src/data/food-science-references.json');
const mechanisms = refs.mechanisms ?? {};
const FAULTS = faultsDoc.faults ?? [];

// Keep the fault map honest: every referenced mechanism must exist in the DB.
const orphans = FAULTS.filter((f) => !mechanisms[f.mechanism]).map((f) => `${f.id} -> ${f.mechanism}`);
if (orphans.length) {
  console.error(`! fault-patterns references mechanisms missing from the DB:\n  ${orphans.join('\n  ')}`);
}

const firstSentences = (text, n = 2) => {
  const parts = String(text).split(/(?<=[.!?])\s+/);
  return parts.slice(0, n).join(' ').trim();
};

function citationFor(slug) {
  const m = mechanisms[slug];
  const src = m?.sources?.[0];
  if (!src) return null;
  return { why: firstSentences(m.summary), citation: src.citation, doi: src.doi };
}

// Score a fault against the input: phrase (substring) matches dominate; distinctive
// single-word overlap breaks ties.
function scoreFault(fault, input, inputWords) {
  let score = 0;
  const hits = [];
  for (const symptom of fault.symptoms ?? []) {
    const s = symptom.toLowerCase();
    if (input.includes(s)) {
      score += 3;
      hits.push(symptom);
      continue;
    }
    const words = s.split(/\s+/).filter((w) => w.length >= 4);
    const overlap = words.filter((w) => inputWords.has(w)).length;
    if (overlap) score += overlap;
  }
  return { score, hits };
}

function diagnose(query) {
  const input = ` ${query.toLowerCase()} `;
  const inputWords = new Set(query.toLowerCase().split(/[^a-z]+/).filter(Boolean));
  return FAULTS
    .map((f) => ({ fault: f, ...scoreFault(f, input, inputWords) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

function printFault(r, lead) {
  const c = citationFor(r.fault.mechanism);
  const marker = lead ? 'MOST LIKELY' : 'also consider';
  console.log(`\n${lead ? '▶ ' : '  • '}${r.fault.name}  [${r.fault.domain}]   (${marker})`);
  if (c?.why) console.log(`    why  ${c.why}`);
  console.log(`    fix  ${r.fault.fix}`);
  if (c) console.log(`    cite ${c.citation}\n         doi:${c.doi}`);
}

function listFaults() {
  console.log('Achiote — detectable faults (cited):\n');
  const byDomain = new Map();
  for (const f of FAULTS) {
    const d = f.domain;
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d).push(f);
  }
  for (const [domain, list] of byDomain) {
    console.log(`[${domain}]`);
    for (const f of list) console.log(`  ${f.name}  —  e.g. "${(f.symptoms[0] || '')}", "${(f.symptoms[1] || '')}"`);
    console.log('');
  }
  console.log(`${FAULTS.length} faults over ${Object.keys(mechanisms).length} cited mechanisms.`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) return listFaults();
  const query = args.filter((a) => !a.startsWith('--')).join(' ').trim();
  if (!query) {
    console.log('Achiote flavor fault-finder\n');
    console.log('  node scripts/diagnose.mjs "<what tastes/smells wrong>"');
    console.log('  node scripts/diagnose.mjs --list\n');
    console.log('Examples:');
    console.log('  node scripts/diagnose.mjs "my negroni smells like wet cardboard"');
    console.log('  node scripts/diagnose.mjs "the beer has no head"');
    console.log('  node scripts/diagnose.mjs "this coffee is sour and weak"');
    return;
  }

  const results = diagnose(query);
  console.log(`\nAchiote — diagnosing: "${query}"`);
  if (!results.length) {
    console.log('\nNo confident match. Describe the smell/taste/texture in plain words');
    console.log('(e.g. "wet cardboard", "rotten egg", "too bitter", "no fizz", "greasy").');
    console.log('Run with --list to see everything it can detect.');
    return;
  }
  printFault(results[0], true);
  for (const r of results.slice(1, 3)) printFault(r, false);
  console.log('\nGrounded in Achiote\'s cited food-science reference base. Verify against your own batch.');
}

main();
