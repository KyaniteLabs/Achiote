#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const isOpenAICompatible = ['openai', 'openai-compatible', 'lmstudio', 'lm-studio'].includes(process.env.ACHIOTE_ASK_PROVIDER?.trim().toLowerCase() ?? '')
  || Boolean(process.env.OPENAI_BASE_URL?.trim() || process.env.LMSTUDIO_BASE_URL?.trim() || process.env.LM_STUDIO_BASE_URL?.trim());
const isGlm = ['glm', 'zhipu'].includes(process.env.ACHIOTE_ASK_PROVIDER?.trim().toLowerCase() ?? '');
const hasProviderCredential = Boolean(
  process.env.ANTHROPIC_API_KEY?.trim()
  || process.env.ANTHROPIC_AUTH_TOKEN?.trim()
  || process.env.OPENAI_API_KEY?.trim()
  || process.env.GLM_API_KEY?.trim()
  || process.env.ZHIPU_API_KEY?.trim()
  || process.env.LMSTUDIO_API_KEY?.trim()
  || isOpenAICompatible,
);

if (!hasProviderCredential) {
  console.error('ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, OPENAI_API_KEY, GLM_API_KEY, ZHIPU_API_KEY, or a local OpenAI-compatible base URL is required for live /ask smoke.');
  process.exit(1);
}

const root = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'achiote-live-ask-'));
const port = 42000 + Math.floor(Math.random() * 10000);
const serverPath = path.join(root, 'dist', 'http-server.js');
const liveAskTimeoutMs = Number.parseInt(process.env.LIVE_ASK_TIMEOUT_MS || '180000', 10);

function cleanupDir() {
  if (process.env.ACHIOTE_KEEP_LIVE_ASK_SMOKE !== '1') {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } else {
    console.log(`Preserved live smoke temp directory: ${tmpRoot}`);
  }
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timeout;

    function cleanupListeners() {
      clearTimeout(timeout);
      child.stdout?.off('data', onStdout);
      child.stderr?.off('data', onStderr);
      child.off('error', onError);
      child.off('exit', onExit);
    }

    function settle(callback, value) {
      if (settled) return;
      settled = true;
      cleanupListeners();
      callback(value);
    }

    function onStdout(chunk) {
      stdout += Buffer.from(chunk).toString('utf8');
      if (stdout.includes(`localhost:${port}`)) {
        settle(resolve, { stdout, stderr });
      }
    }

    function onStderr(chunk) {
      stderr += Buffer.from(chunk).toString('utf8');
    }

    function onError(error) {
      settle(reject, error);
    }

    function onExit(code) {
      if (code !== null && code !== 0) {
        settle(reject, new Error(`HTTP server exited early with ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      }
    }

    timeout = setTimeout(() => {
      settle(reject, new Error(`HTTP server did not start on ${port}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 15_000);

    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    child.on('error', onError);
    child.on('exit', onExit);
  });
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

function parseSse(text) {
  const events = [];
  for (const block of text.split('\n\n')) {
    if (!block.trim()) continue;
    const event = block.split('\n').find((line) => line.startsWith('event: '))?.slice(7);
    const data = block.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n');
    events.push({ event, data });
  }
  return events;
}

function parseTextPayload(item, index) {
  try {
    return JSON.parse(item.data);
  } catch (error) {
    throw new Error(`Malformed text event JSON at text event ${index + 1}: ${error instanceof Error ? error.message : String(error)}\nPayload:\n${item.data}`);
  }
}

async function main() {
  if (!fs.existsSync(serverPath)) {
    throw new Error(`Build output missing at ${serverPath}. Run npm run build first.`);
  }

  const providerBase = isGlm
    ? (process.env.GLM_BASE_URL || process.env.ZHIPU_BASE_URL || 'https://api.z.ai/api/anthropic')
    : (process.env.OPENAI_BASE_URL || process.env.LMSTUDIO_BASE_URL || process.env.LM_STUDIO_BASE_URL || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com');
  const providerModel = process.env.ACHIOTE_ASK_MODEL || process.env.GLM_MODEL || process.env.ZHIPU_MODEL || process.env.OPENAI_MODEL || process.env.LMSTUDIO_MODEL || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'claude-sonnet-4-5-20250929';
  console.log(`Live /ask smoke target: provider=${process.env.ACHIOTE_ASK_PROVIDER || (isOpenAICompatible ? 'openai' : 'anthropic')} base=${providerBase} model=${providerModel} timeout=${liveAskTimeoutMs}ms`);

  const child = spawn(process.execPath, [serverPath], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      ACHIOTE_AUTH_ENABLED: 'false',
      ACHIOTE_ALLOW_ANON_ASK: 'true',
      ACHIOTE_CACHE_PATH: path.join(tmpRoot, 'cache.db'),
      ACHIOTE_RATE_LIMIT_DB: path.join(tmpRoot, 'rate-limit.db'),
    },
  });

  try {
    await withTimeout(waitForServer(child), 16_000, 'HTTP server startup');

    const ready = await withTimeout(fetch(`http://127.0.0.1:${port}/ready`), 5_000, '/ready');
    if (!ready.ok) {
      throw new Error(`/ready returned ${ready.status}: ${await ready.text()}`);
    }

    const response = await withTimeout(fetch(`http://127.0.0.1:${port}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'My grandma made a warm sour dill soup with pale chunks. What is the smallest safe cue to test first?',
      }),
    }), liveAskTimeoutMs, '/ask request');

    if (!response.ok) {
      throw new Error(`/ask returned ${response.status}: ${await response.text()}`);
    }

    const body = await withTimeout(response.text(), liveAskTimeoutMs, '/ask SSE body');
    const events = parseSse(body);
    const errors = events.filter((item) => item.event === 'error');
    if (errors.length > 0) {
      throw new Error(`/ask emitted error event: ${errors.map((item) => item.data).join('\n')}`);
    }

    const textPayloads = events.filter((item) => item.event === 'text').map(parseTextPayload);
    const doneCount = events.filter((item) => item.event === 'done').length;
    if (textPayloads.length === 0) {
      throw new Error(`/ask did not emit a text event. Raw SSE:\n${body}`);
    }
    if (doneCount === 0) {
      throw new Error(`/ask did not emit a done event. Raw SSE:\n${body}`);
    }

    const text = textPayloads.join('');
    console.log('Live /ask smoke passed. Response preview:');
    console.log(text.slice(0, 500));
  } finally {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await withTimeout(exited, 5_000, 'HTTP server shutdown');
    cleanupDir();
  }
}

main().catch((error) => {
  cleanupDir();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
