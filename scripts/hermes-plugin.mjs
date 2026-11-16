#!/usr/bin/env node
/**
 * Hermes plugin pipeline for Achiote.
 *
 * plugins/achiote/ is a portable Agent Plugins v1 package (plugin.json +
 * mcp.json + skills/) that Hermes installs with
 * `hermes plugins install KyaniteLabs/Achiote --subdir plugins/achiote`.
 * Parts of it are COPIES of files that live elsewhere in this repo. This script
 * is the one place that writes them, so they can never drift:
 *
 *   package.json version      -> plugin.json "version" + the pinned npx launcher in mcp.json
 *   skill/SKILL.md            -> skills/achiote/SKILL.md
 *   branding/achiote-512.png  -> icon.png
 *   branding/achiote-banner.png -> banner.png  (2:1 catalog card image)
 *   LICENSE                   -> LICENSE
 *
 * Usage:
 *   node scripts/hermes-plugin.mjs sync              # rewrite the copies
 *   node scripts/hermes-plugin.mjs check             # exit 1 if any copy drifted (CI / lint)
 *   node scripts/hermes-plugin.mjs catalog-entry --sha <40-hex>
 *                                                    # print the hermes-agent plugin-catalog YAML
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PLUGIN_DIR = path.join(ROOT, 'plugins', 'achiote');
export const PLUGIN_NAME = 'achiote';
const REPO_URL = 'https://github.com/KyaniteLabs/Achiote';

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/** Every file the pipeline owns, mapped to its exact expected bytes. */
export function expectedFiles() {
  const version = pkg.version;
  const pluginJson = {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: PLUGIN_NAME,
    version,
    description:
      'Recreate a remembered dish with ingredients available where you are. Food-memory reconstruction via MCP: sensory cues, substitutions, and a first test recipe.',
    author: { name: 'Kyanite Labs', url: 'https://github.com/KyaniteLabs' },
    homepage: 'https://achiote.kyanitelabs.tech/',
    repository: `${REPO_URL}/tree/master/plugins/achiote`,
    license: 'BUSL-1.1',
    keywords: ['food', 'recipes', 'nostalgia', 'culinary', 'food-memory', 'mcp'],
  };
  const mcpJson = {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
    mcpServers: {
      // Exact version pin: the catalog's SHA pin must decide what runs, so the
      // launcher never floats to a newer npm release nobody reviewed.
      achiote: { type: 'stdio', command: 'npx', args: ['-y', `achiote@${version}`] },
    },
  };
  // Claude Code reads .claude-plugin/plugin.json and .mcp.json; derive both from
  // the portable manifests above so the hosts can never drift apart.
  const { $schema: _pluginSchema, keywords: _keywords, ...claudeShared } = pluginJson;
  const claudePluginJson = { ...claudeShared, displayName: 'Achiote', repository: REPO_URL };
  const { $schema: _mcpSchema, ...claudeMcpJson } = mcpJson;
  return {
    'plugin.json': Buffer.from(`${JSON.stringify(pluginJson, null, 2)}\n`),
    'mcp.json': Buffer.from(`${JSON.stringify(mcpJson, null, 2)}\n`),
    '.claude-plugin/plugin.json': Buffer.from(`${JSON.stringify(claudePluginJson, null, 2)}\n`),
    '.mcp.json': Buffer.from(`${JSON.stringify(claudeMcpJson, null, 2)}\n`),
    'skills/achiote/SKILL.md': fs.readFileSync(path.join(ROOT, 'skill', 'SKILL.md')),
    'icon.png': fs.readFileSync(path.join(ROOT, 'branding', 'achiote-512.png')),
    'banner.png': fs.readFileSync(path.join(ROOT, 'branding', 'achiote-banner.png')),
    LICENSE: fs.readFileSync(path.join(ROOT, 'LICENSE')),
  };
}

export function driftedFiles() {
  const drifted = [];
  for (const [rel, bytes] of Object.entries(expectedFiles())) {
    const file = path.join(PLUGIN_DIR, rel);
    if (!fs.existsSync(file) || !fs.readFileSync(file).equals(bytes)) drifted.push(rel);
  }
  return drifted;
}

function sync() {
  for (const [rel, bytes] of Object.entries(expectedFiles())) {
    const file = path.join(PLUGIN_DIR, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
  console.log(`Hermes plugin synced at plugins/achiote (version ${pkg.version})`);
}

function check() {
  const drifted = driftedFiles();
  if (drifted.length > 0) {
    console.error(`Hermes plugin out of sync: ${drifted.join(', ')}. Run: node scripts/hermes-plugin.mjs sync`);
    process.exit(1);
  }
  console.log('Hermes plugin in sync');
}

export function catalogEntry(sha) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) {
    throw new Error('catalog-entry needs --sha <full 40-character commit sha> (the catalog rejects branches, tags and short SHAs)');
  }
  const banner = `https://raw.githubusercontent.com/KyaniteLabs/Achiote/${sha}/plugins/achiote/banner.png`;
  return [
    `name: ${PLUGIN_NAME}`,
    `repo: ${REPO_URL}`,
    `sha: ${sha}`,
    'subdir: plugins/achiote',
    'description: Recreate a remembered dish with ingredients available where you are (food-memory reconstruction MCP).',
    'maintainer: KyaniteLabs',
    'tier: community',
    'category: tools',
    `docs_url: ${REPO_URL}/tree/${sha}/plugins/achiote#readme`,
    `version: "${pkg.version}"`,
    `image: ${banner}`,
    'platforms: []',
    'capabilities:',
    '  provides_tools: []',
    '  provides_hooks: []',
    '  provides_middleware: []',
    '  requires_env: []',
    '',
  ].join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'sync') sync();
  else if (command === 'check') check();
  else if (command === 'catalog-entry') {
    const i = rest.indexOf('--sha');
    try {
      process.stdout.write(catalogEntry(i >= 0 ? rest[i + 1] : undefined));
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  } else {
    console.error('Usage: node scripts/hermes-plugin.mjs <sync|check|catalog-entry --sha <sha>>');
    process.exit(2);
  }
}

