#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

function run(command, args, options = {}) {
  const printable = [command, ...args].join(' ');
  const result = spawnSync(command, args, { stdio: 'inherit', encoding: 'utf8', ...options });
  if (result.error) throw new Error(`${printable} failed to start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${printable} exited with ${result.status}`);
  return result;
}

function capture(command, args) {
  const printable = [command, ...args].join(' ');
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) throw new Error(`${printable} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${printable} exited with ${result.status}\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReadiness(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const body = await response.text();
      if (response.ok) return body;
      lastError = `${response.status} ${body}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

function parsePublishedPort(portOutput) {
  const match = portOutput.match(/(?:0\.0\.0\.0|127\.0\.0\.1|\[::\]):(\d+)/);
  if (!match) throw new Error(`Could not parse docker port output: ${portOutput}`);
  return match[1];
}

async function waitForContainerHealth(containerId, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'unknown';
  while (Date.now() < deadline) {
    lastStatus = capture('docker', ['inspect', '--format', '{{.State.Health.Status}}', containerId]);
    if (lastStatus === 'healthy') return lastStatus;
    if (lastStatus === 'unhealthy') throw new Error(`Container health became unhealthy`);
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for healthy container; last Health.Status=${lastStatus}`);
}

const requiredSourceFiles = ['Dockerfile', 'tsconfig.json', 'src', 'package-lock.json'];
const missing = requiredSourceFiles.filter((file) => !fs.existsSync(file));
if (missing.length > 0) {
  console.error(`docker:smoke requires a source checkout. Missing: ${missing.join(', ')}`);
  process.exit(1);
}

const tag = `achiote-smoke:${Date.now()}`;
let containerId = '';
try {
  console.log(`Running docker build for ${tag}`);
  run('docker', ['build', '-t', tag, '.']);

  console.log('Starting Docker container for health and readiness smoke');
  containerId = capture('docker', [
    'run',
    '-d',
    '--rm',
    '-p',
    '127.0.0.1::3000',
    '-e',
    'ACHIOTE_AUTH_ENABLED=false',
    '-e',
    'ACHIOTE_ALLOW_ANON_ASK=true',
    '-e',
    'ANTHROPIC_API_KEY=docker-smoke-placeholder',
    '-e',
    'ACHIOTE_CACHE_PATH=/tmp/achiote-cache.db',
    '-e',
    'ACHIOTE_RATE_LIMIT_DB=/tmp/achiote-rate.db',
    tag,
  ]);

  const port = parsePublishedPort(capture('docker', ['port', containerId, '3000/tcp']));
  console.log(`Container ${containerId.slice(0, 12)} published on 127.0.0.1:${port}`);

  await waitForContainerHealth(containerId);
  const readyBody = await waitForReadiness(`http://127.0.0.1:${port}/ready`);
  console.log(`Docker smoke passed: Health.Status=healthy and /ready responded: ${readyBody.slice(0, 160)}`);
} finally {
  if (containerId) {
    spawnSync('docker', ['stop', containerId], { stdio: 'inherit' });
  }
  spawnSync('docker', ['rmi', tag], { stdio: 'ignore' });
}
