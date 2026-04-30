#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildLmStudioLoadPayload,
  isLocalInferenceProfileName,
  localInferenceProfiles,
  summarizeLoadProfile,
} from '../dist/lib/local-inference-profiles.js';

const DEFAULT_BASE_URL = 'http://100.66.225.85:1234/v1';
const args = parseArgs(process.argv.slice(2));
const baseUrl = stringArg('base-url') ?? process.env.LOCAL_INFERENCE_BASE_URL ?? process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL;
const model = stringArg('model') ?? process.env.LOCAL_INFERENCE_MODEL ?? 'qwen3.5-0.8b';
const profileName = profileArg();
const outputDir = stringArg('out') ?? path.join('artifacts', 'local-inference-profiler');
const timeoutMs = numberArg('timeout-ms') ?? 180_000;

if (args.has('list-profiles')) {
  printJson({
    profiles: Object.fromEntries(Object.keys(localInferenceProfiles).map((name) => [
      name,
      {
        summary: summarizeLoadProfile(name),
        profile: localInferenceProfiles[name],
      },
    ])),
  });
  process.exit(0);
}

const startedAt = new Date().toISOString();
const artifact = {
  generatedAt: startedAt,
  baseUrl,
  managementBaseUrl: managementBaseUrl(baseUrl),
  model,
  profile: profileName,
  intendedLoadPayload: buildLmStudioLoadPayload(model, profileName),
  profileSummary: summarizeLoadProfile(profileName),
  events: [],
};

if (args.has('unload-all')) {
  artifact.events.push(await timed('unload_all', () => unloadAll(baseUrl, timeoutMs)));
}

if (args.has('load') || args.has('probe') || args.has('canary')) {
  artifact.events.push(await timed('load_model', () => loadModel(baseUrl, artifact.intendedLoadPayload, timeoutMs)));
}

if (args.has('probe')) {
  artifact.events.push(await timed('direct_probe', () => directProbe(baseUrl, model, timeoutMs)));
}

if (args.has('canary')) {
  artifact.events.push(await timed('local_canary', () => runLocalCanary({ baseUrl, model, profileName, outputDir })));
}

if (artifact.events.length === 0) {
  artifact.events.push({
    label: 'noop',
    ok: true,
    ms: 0,
    note: 'Use --load, --probe, --canary, --unload-all, or --list-profiles.',
  });
}

fs.mkdirSync(outputDir, { recursive: true });
const artifactPath = path.join(outputDir, `${slug(model)}-${profileName}-${Date.now()}.json`);
fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
printJson({ artifactPath, ...artifact });

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed.set(key, next);
      index += 1;
    } else {
      parsed.set(key, true);
    }
  }
  return parsed;
}

function stringArg(name) {
  const value = args.get(name);
  return typeof value === 'string' ? value : undefined;
}

function numberArg(name) {
  const value = stringArg(name);
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function profileArg() {
  const requested = stringArg('profile') ?? process.env.LOCAL_INFERENCE_PROFILE ?? 'speed';
  if (!isLocalInferenceProfileName(requested)) {
    throw new Error(`Unknown local inference profile "${requested}". Expected speed, quality, or memory.`);
  }
  return requested;
}

async function timed(label, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    return {
      label,
      ok: true,
      ms: Date.now() - start,
      result,
    };
  } catch (error) {
    return {
      label,
      ok: false,
      ms: Date.now() - start,
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
    };
  }
}

async function unloadAll(targetBaseUrl, requestTimeoutMs) {
  const apiBase = managementBaseUrl(targetBaseUrl);
  const models = await fetchJson(`${apiBase}/models`, {}, requestTimeoutMs);
  const ids = Array.isArray(models.models)
    ? models.models.map((entry) => entry?.key ?? entry?.id).filter((id) => typeof id === 'string')
    : Array.isArray(models.data)
      ? models.data.map((entry) => entry?.id).filter((id) => typeof id === 'string')
      : [];
  const loadedIds = Array.isArray(models.models)
    ? models.models
      .filter((entry) => entry?.state === 'loaded' || entry?.loaded === true || entry?.loaded_instance_id)
      .map((entry) => entry?.loaded_instance_id ?? entry?.key ?? entry?.id)
      .filter((id) => typeof id === 'string')
    : [];
  const responses = [];
  for (const id of loadedIds.length > 0 ? loadedIds : ids) {
    try {
      responses.push(await fetchJson(`${apiBase}/models/unload`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ instance_id: id }),
      }, requestTimeoutMs));
    } catch (error) {
      responses.push({
        instance_id: id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { attempted: loadedIds.length > 0 ? loadedIds : ids, responses };
}

async function loadModel(targetBaseUrl, payload, requestTimeoutMs) {
  return fetchJson(`${managementBaseUrl(targetBaseUrl)}/models/load`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  }, requestTimeoutMs);
}

async function directProbe(targetBaseUrl, targetModel, requestTimeoutMs) {
  const response = await fetchJson(`${openAiBaseUrl(targetBaseUrl)}/chat/completions`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      model: targetModel,
      temperature: 0.2,
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: 'Give a tiny rice-cinnamon drink nostalgia cue. Include no full recipe, no browsing claim, and no provider identity.',
        },
      ],
    }),
  }, requestTimeoutMs);
  const text = response.choices?.[0]?.message?.content ?? '';
  return {
    response,
    textPreview: typeof text === 'string' ? text.slice(0, 1200) : '',
    reasoningTracePreview: extractReasoningTrace(typeof text === 'string' ? text : ''),
  };
}

async function fetchJson(url, options, requestTimeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.text();
    let parsed;
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch {
      parsed = { raw: body };
    }
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${body.slice(0, 1200)}`);
    }
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

function jsonHeaders() {
  const headers = { 'content-type': 'application/json' };
  if (process.env.LM_API_TOKEN) headers.authorization = `Bearer ${process.env.LM_API_TOKEN}`;
  return headers;
}

function managementBaseUrl(targetBaseUrl) {
  const normalized = targetBaseUrl.replace(/\/$/, '');
  if (normalized.endsWith('/api/v1')) return normalized;
  return normalized.replace(/\/(?:v1|api\/v1)$/, '') + '/api/v1';
}

function openAiBaseUrl(targetBaseUrl) {
  const normalized = targetBaseUrl.replace(/\/$/, '');
  if (normalized.endsWith('/v1') && !normalized.endsWith('/api/v1')) return normalized;
  return normalized.replace(/\/api\/v1$/, '') + '/v1';
}

function runLocalCanary(options) {
  return new Promise((resolve, reject) => {
    const summaryPath = path.join(options.outputDir, `${slug(options.model)}-${options.profileName}-canary-summary.json`);
    const child = spawn(process.execPath, ['scripts/local-canary-qa.mjs', '--list-json'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LOCAL_CANARY_BASE_URL: options.baseUrl,
        LOCAL_CANARY_MODEL: options.model,
        LOCAL_CANARY_PROFILE: process.env.LOCAL_CANARY_PROFILE ?? 'core',
        LOCAL_CANARY_SUMMARY_JSON: summaryPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`local canary exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve({ summaryPath, stdoutPreview: stdout.slice(0, 2000), stderrPreview: stderr.slice(0, 2000) });
    });
  });
}

function extractReasoningTrace(text) {
  const match = text.match(/(?:Thinking Process|Reasoning|Trace)\s*:\s*[\s\S]{0,500}/i);
  return match?.[0];
}

function slug(value) {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'model';
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
