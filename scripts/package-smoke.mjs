#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const expectedTools = [
  'analyze_nostalgic_dish',
  'build_reconstruction_dossier',
  'build_research_record',
  'collect_food_memory',
  'discover_regional_similars',
  'extract_research_findings',
  'find_sensory_substitutes',
  'generate_family_followup_questions',
  'generate_minimum_viable_nostalgia',
  'generate_recipe',
  'plan_dish_research',
  'resolve_dish_name',
  'source_ingredients',
  'validate_research_record',
];

function run(command, args, options = {}) {
  const printable = [command, ...args].join(' ');
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    },
    ...options,
  });

  if (result.error) {
    throw new Error(`${printable} failed to start: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(
      `${printable} exited with ${result.status}\n\nstdout:\n${result.stdout ?? ''}\n\nstderr:\n${result.stderr ?? ''}`,
    );
  }

  return result;
}

function parsePackJson(stdout) {
  const trimmed = stdout.trim();
  const jsonMatch = trimmed.match(/(\[\s*\{[\s\S]*\}\s*\])\s*$/);
  if (!jsonMatch) {
    throw new Error(`Unable to parse npm pack --json output:\n${stdout}`);
  }

  const parsed = JSON.parse(jsonMatch[1]);
  if (!Array.isArray(parsed) || parsed.length !== 1 || typeof parsed[0]?.filename !== 'string') {
    throw new Error(`Unexpected npm pack --json shape:\n${JSON.stringify(parsed, null, 2)}`);
  }

  return parsed[0];
}

function installedBinPath(installDir) {
  const suffix = process.platform === 'win32' ? '.cmd' : '';
  return path.join(installDir, 'node_modules', '.bin', `member-berries${suffix}`);
}

async function withTimeout(promise, ms, label) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
}

async function assertPackagedCliListsTools(installDir, tempRoot) {
  const cliPath = installedBinPath(installDir);
  if (!fs.existsSync(cliPath)) {
    throw new Error(`Installed CLI bin was not found at ${cliPath}`);
  }

  const transport = new StdioClientTransport({
    command: cliPath,
    cwd: installDir,
    stderr: 'pipe',
    env: {
      ...process.env,
      MEMBER_BERRIES_CACHE_PATH: path.join(tempRoot, 'cache', 'culture-cache.db'),
      XDG_CACHE_HOME: path.join(tempRoot, 'xdg-cache'),
    },
  });
  const stderrChunks = [];
  transport.stderr?.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk).toString('utf8')));

  const client = new Client({ name: 'member-berries-package-smoke', version: '0.0.0' });

  try {
    await withTimeout(client.connect(transport), 10_000, 'MCP client connection');
    const { tools } = await withTimeout(client.listTools(), 10_000, 'MCP tools/list');
    const toolNames = tools.map((tool) => tool.name).sort();

    if (JSON.stringify(toolNames) !== JSON.stringify(expectedTools)) {
      throw new Error(
        `Packaged CLI returned unexpected tools.\nExpected: ${expectedTools.join(', ')}\nReceived: ${toolNames.join(', ')}`,
      );
    }
  } catch (error) {
    const stderr = stderrChunks.join('').trim();
    const suffix = stderr ? `\n\nCLI stderr:\n${stderr}` : '';
    throw new Error(`${error instanceof Error ? error.message : String(error)}${suffix}`);
  } finally {
    await withTimeout(client.close(), 5_000, 'MCP client close');
  }
}

async function main() {
  const smokeRoot = path.join(os.tmpdir(), 'member-berries-package-smoke');
  fs.mkdirSync(smokeRoot, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(smokeRoot, 'run-'));
  const installDir = path.join(tempRoot, 'install');

  try {
    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(path.join(installDir, 'package.json'), '{"private":true,"type":"module"}\n');

    console.log(`Packing member-berries into ${tempRoot}`);
    const packResult = run(npmCommand, ['pack', '--json', '--pack-destination', tempRoot]);
    const pack = parsePackJson(packResult.stdout ?? '');
    const tarballPath = path.isAbsolute(pack.filename) ? pack.filename : path.join(tempRoot, pack.filename);

    if (!fs.existsSync(tarballPath)) {
      throw new Error(`npm pack reported ${tarballPath}, but the tarball does not exist`);
    }

    console.log(`Installing ${path.basename(tarballPath)} into ${installDir}`);
    run(npmCommand, ['install', '--no-audit', '--no-fund', '--package-lock=false', '--no-save', tarballPath], {
      cwd: installDir,
    });

    console.log('Checking packaged CLI MCP tools/list response');
    await assertPackagedCliListsTools(installDir, tempRoot);

    console.log(`Package smoke passed: installed tarball CLI listed ${expectedTools.length} MCP tools.`);
  } finally {
    if (process.env.MEMBER_BERRIES_KEEP_PACKAGE_SMOKE !== '1') {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } else {
      console.log(`Preserved smoke temp directory: ${tempRoot}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
