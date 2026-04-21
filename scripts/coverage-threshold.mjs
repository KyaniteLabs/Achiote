#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const MIN_TEST_COUNT = 200;
const REQUIRED_TEST_FILES = [
  'tests/mcp-server.test.ts',
  'tests/http-server.test.ts',
  'tests/http-edge-cases.test.ts',
  'tests/reconstruction-flow-e2e.test.ts',
  'tests/minimum-viable-nostalgia.test.ts',
  'tests/research-provenance.test.ts',
  'tests/package-metadata.test.ts',
  'tests/p1-launch-hardening.test.ts',
  'tests/p2-product-trust.test.ts',
  'tests/p3-release-hygiene.test.ts',
];

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) {
    console.error(`Required test directory missing: ${dir}`);
    return out;
  }
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    console.error(`Unable to read test directory ${dir}: ${error instanceof Error ? error.message : String(error)}`);
    return out;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

let failures = 0;
for (const file of REQUIRED_TEST_FILES) {
  if (!fs.existsSync(file)) {
    failures++;
    console.error(`Required coverage guard test file missing: ${file}`);
  }
}

const testText = walk('tests').filter((file) => file.endsWith('.test.ts')).map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const testCount = testText
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => /^\s*(?:it|test)\s*\(/.test(line) && !line.trimStart().startsWith('//'))
  .length;
if (testCount < MIN_TEST_COUNT) {
  failures++;
  console.error(`Test count ${testCount} is below MIN_TEST_COUNT ${MIN_TEST_COUNT}`);
}

if (failures > 0) process.exit(1);
console.log(`Coverage guard passed: ${testCount} tests across required launch surfaces`);
