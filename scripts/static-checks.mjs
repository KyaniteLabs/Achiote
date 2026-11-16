#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { driftedFiles } from './hermes-plugin.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exists = (rel) => fs.existsSync(path.join(root, rel));
// A packed install ships dist/ and not the TypeScript sources or git metadata.
const packaged = !exists('src/http-server.ts') && exists('dist/http-server.js');

const checks = [
  {
    files: packaged
      ? ['dist/http-server.js', 'README.md', 'docs/ARCHITECTURE.md', ...(exists('SECURITY.md') ? ['SECURITY.md'] : [])]
      : ['src/http-server.ts', 'README.md', 'SECURITY.md', 'docs/ARCHITECTURE.md'],
    forbidden: ['apiKey=', "searchParams.get('apiKey')", 'query param'],
  },
  {
    files: ['docs/landing/index.html', 'docs/landing/robots.txt', 'docs/landing/sitemap.xml'],
    forbidden: ['achiote.app'],
  },
];

let failures = 0;
for (const check of checks) {
  for (const file of check.files) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) {
      failures++;
      console.error(`Required static-check input missing: ${file}`);
      continue;
    }
    const text = fs.readFileSync(absolute, 'utf8');
    for (const pattern of check.forbidden) {
      if (text.includes(pattern)) {
        failures++;
        console.error(`Forbidden pattern ${JSON.stringify(pattern)} found in ${file}`);
      }
    }
  }
}

// .gitignore is a repo file. npm packs omit it, so a packaged install has nothing to ignore.
if (!packaged) {
  const gitignore = path.join(root, '.gitignore');
  if (!fs.existsSync(gitignore) || !fs.readFileSync(gitignore, 'utf8').includes('.claude/')) {
    failures++;
    console.error('Forbidden pattern guard missing: .claude/ must stay ignored');
  }
}

// plugins/achiote/ holds generated copies (see docs/HERMES_PLUGIN.md); they must match their sources.
// The npm tarball is not the Hermes plugin package, so this check is source-checkout only.
if (!packaged) {
  const driftedPluginFiles = driftedFiles();
  if (driftedPluginFiles.length > 0) {
    failures++;
    console.error(`Hermes plugin out of sync: ${driftedPluginFiles.join(', ')}. Run: node scripts/hermes-plugin.mjs sync`);
  }
}

const phantomTools = skillToolNamesMissingFromRegistry();
if (phantomTools.length > 0) {
  failures++;
  console.error(`skill/SKILL.md names tools absent from toolRegistry: ${phantomTools.join(', ')}`);
}

if (failures > 0) process.exit(1);
console.log(packaged ? 'Static checks passed (packaged install)' : 'Static checks passed');

function registryToolNames() {
  const source = path.join(root, 'src/tools/tool-registry.ts');
  const built = path.join(root, 'dist/tools/tool-registry.js');
  const file = fs.existsSync(source) ? source : built;
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const names = new Set([...text.matchAll(/name:\s*'([a-z][a-z0-9_]*)'/g)].map((match) => match[1]));
  names.add('reconstruct_food_memory');
  return names;
}

function skillToolNamesMissingFromRegistry() {
  const skillPath = path.join(root, 'skill/SKILL.md');
  if (!fs.existsSync(skillPath)) return [];
  const registry = registryToolNames();
  if (!registry) return ['<tool registry unavailable>'];
  const skill = fs.readFileSync(skillPath, 'utf8');
  const mentioned = new Set();
  for (const match of skill.matchAll(/^\s*Tool:\s*([a-z][a-z0-9_]*)/gm)) mentioned.add(match[1]);
  for (const block of skill.matchAll(/toolsRun:\s*\[([\s\S]*?)\]/g)) {
    for (const name of block[1].matchAll(/"([a-z][a-z0-9_]*)"/g)) mentioned.add(name[1]);
  }
  return [...mentioned].filter((name) => !registry.has(name)).sort();
}
