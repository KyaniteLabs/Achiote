#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
async function loadExpectedTools() {
  const registry = await import(path.join(repoRoot, 'dist', 'tools', 'tool-registry.js'));
  return registry.toolNames;
}

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
  return path.join(installDir, 'node_modules', '.bin', `achiote${suffix}`);
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

function waitForServer(child, port) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => reject(new Error(`Packaged HTTP server startup timed out on port ${port}${stderr ? `\n\nstderr:\n${stderr}` : ''}`)), 10_000);
    child.stdout?.on('data', (chunk) => {
      if (Buffer.from(chunk).toString('utf8').includes(`localhost:${port}`)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr?.on('data', (chunk) => { stderr += Buffer.from(chunk).toString('utf8'); });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Packaged HTTP server exited early with ${code}${stderr ? `\n\nstderr:\n${stderr}` : ''}`));
      }
    });
  });
}

function assertPackagedHelperScripts(installDir, tempRoot) {
  const packageRoot = path.join(installDir, 'node_modules', 'achiote');
  const keygenPath = path.join(packageRoot, 'scripts', 'generate-api-key.mjs');
  const dockerSmokePath = path.join(packageRoot, 'scripts', 'docker-smoke.mjs');
  const liveAskPath = path.join(packageRoot, 'scripts', 'live-ask-smoke.mjs');
  const referenceSeedOperatorPath = path.join(packageRoot, 'scripts', 'reference-seed-operator.mjs');
  if (!fs.existsSync(keygenPath)) throw new Error(`Packaged keygen helper missing at ${keygenPath}`);
  if (!fs.existsSync(dockerSmokePath)) throw new Error(`Packaged docker smoke helper missing at ${dockerSmokePath}`);
  if (!fs.existsSync(liveAskPath)) throw new Error(`Packaged live ask smoke helper missing at ${liveAskPath}`);
  if (!fs.existsSync(referenceSeedOperatorPath)) throw new Error(`Packaged reference seed operator helper missing at ${referenceSeedOperatorPath}`);

  const keygen = spawnSync(process.execPath, [keygenPath, '--tier', 'free', '--name', 'package-smoke'], { encoding: 'utf8' });
  if (keygen.status !== 0) {
    throw new Error(`Packaged keygen helper failed\nstdout:\n${keygen.stdout}\nstderr:\n${keygen.stderr}`);
  }
  const parsed = JSON.parse(keygen.stdout);
  if (!/^ach_[0-9a-f]{48}$/.test(parsed.key) || parsed.envRecord?.tier !== 'free' || parsed.envRecord?.name !== 'package-smoke') {
    throw new Error(`Packaged keygen helper returned unexpected record: ${keygen.stdout}`);
  }
  if (!/^ak_[0-9a-f]{16}$/.test(parsed.envRecord.keyId) || !/^sha256:[0-9a-f]{64}$/.test(parsed.envRecord.keyHash) || 'key' in parsed.envRecord) {
    throw new Error(`Packaged keygen helper returned unsafe envRecord: ${keygen.stdout}`);
  }

  const referenceReport = spawnSync(process.execPath, [referenceSeedOperatorPath, '--limit', '1'], { encoding: 'utf8' });
  if (referenceReport.status !== 0) {
    throw new Error(`Packaged reference seed operator helper failed\nstdout:\n${referenceReport.stdout}\nstderr:\n${referenceReport.stderr}`);
  }
  const report = JSON.parse(referenceReport.stdout);
  if (!report.coverage?.axes?.foodForms || !Array.isArray(report.cacheWarmingTasks)) {
    throw new Error(`Packaged reference seed operator returned unexpected report: ${referenceReport.stdout}`);
  }

  const bundledCachePath = path.join(tempRoot, 'packaged-reference-pantry.db');
  const bundledWrite = spawnSync(process.execPath, [
    referenceSeedOperatorPath,
    '--fixture',
    'bundled',
    '--cache-path',
    bundledCachePath,
  ], { encoding: 'utf8' });
  if (bundledWrite.status !== 0) {
    throw new Error(`Packaged bundled reference pantry write failed\nstdout:\n${bundledWrite.stdout}\nstderr:\n${bundledWrite.stderr}`);
  }
  const bundledWriteResult = JSON.parse(bundledWrite.stdout);
  if (typeof bundledWriteResult.stored !== 'number' || bundledWriteResult.stored < 138) {
    throw new Error(`Packaged bundled reference pantry write returned unexpected result: ${bundledWrite.stdout}`);
  }
}

async function assertPackagedHttpServerStarts(installDir, tempRoot) {
  const port = 39000 + Math.floor(Math.random() * 20000);
  const serverPath = path.join(installDir, 'node_modules', 'achiote', 'dist', 'http-server.js');
  const child = spawn(process.execPath, [serverPath], {
    cwd: installDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      ACHIOTE_AUTH_ENABLED: 'false',
      ACHIOTE_CACHE_PATH: path.join(tempRoot, 'http-cache', 'culture-cache.db'),
      ACHIOTE_RATE_LIMIT_DB: path.join(tempRoot, 'http-rate-limit.db'),
      ANTHROPIC_API_KEY: 'package-smoke-placeholder',
    },
  });

  try {
    await withTimeout(waitForServer(child, port), 12_000, 'packaged HTTP startup');
    for (const pathPart of ['/health', '/about', '/privacy', '/privacy/', '/terms', '/support', '/safety', '/ai-search', '/ai-search/', '/compare', '/compare/', '/llms.txt', '/sitemap.xml', '/robots.txt']) {
      const res = await withTimeout(fetch(`http://127.0.0.1:${port}${pathPart}`), 5_000, `GET ${pathPart}`);
      if (!res.ok) throw new Error(`GET ${pathPart} returned ${res.status}`);
      if (pathPart !== '/health' && !res.headers.get('x-content-type-options')) {
        throw new Error(`GET ${pathPart} did not return static security headers`);
      }
    }

    const privateEvents = await withTimeout(fetch(`http://127.0.0.1:${port}/events`), 5_000, 'GET /events');
    if (privateEvents.status !== 404) throw new Error(`GET /events returned ${privateEvents.status}; expected private 404`);
  } finally {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await withTimeout(exited, 5_000, 'packaged HTTP shutdown');
  }
}

async function assertPackagedCliListsTools(installDir, tempRoot, expectedTools) {
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
      ACHIOTE_CACHE_PATH: path.join(tempRoot, 'cache', 'culture-cache.db'),
      XDG_CACHE_HOME: path.join(tempRoot, 'xdg-cache'),
    },
  });
  const stderrChunks = [];
  transport.stderr?.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk).toString('utf8')));

  const client = new Client({ name: 'achiote-package-smoke', version: '0.0.0' });

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
  const smokeRoot = path.join(os.tmpdir(), 'achiote-package-smoke');
  fs.mkdirSync(smokeRoot, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(smokeRoot, 'run-'));
  const installDir = path.join(tempRoot, 'install');

  try {
    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(path.join(installDir, 'package.json'), '{"private":true,"type":"module"}\n');

    console.log(`Packing achiote into ${tempRoot}`);
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

    const expectedTools = await loadExpectedTools();

    console.log('Checking packaged CLI MCP tools/list response');
    await assertPackagedCliListsTools(installDir, tempRoot, expectedTools);

    console.log('Checking packaged helper scripts');
    assertPackagedHelperScripts(installDir, tempRoot);

    console.log('Checking packaged HTTP server health, trust, and launch metadata responses');
    await assertPackagedHttpServerStarts(installDir, tempRoot);

    console.log(`Package smoke passed: installed tarball CLI listed ${expectedTools.length} MCP tools and HTTP smoke responded.`);
  } finally {
    if (process.env.ACHIOTE_KEEP_PACKAGE_SMOKE !== '1') {
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
