#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { QA_ARTIFACT_MANIFEST_FILE, writeQaRunManifest } from './lib/qa-artifact-pipeline.mjs';
import {
  buildLmStudioLoadPayload,
  isProtectedLocalInferenceModel,
  isLocalInferenceProfileName,
  lmStudioInferenceEndpointStyles,
  localInferenceProfiles,
  localInferenceModelIdentifiers,
  parseProtectedLocalInferenceModels,
  profileApplicationSummary,
  summarizeLoadProfile,
} from '../dist/lib/local-inference-profiles.js';

const DEFAULT_BASE_URL = 'http://100.66.225.85:1234/v1';
const args = parseArgs(process.argv.slice(2));
const baseUrl = stringArg('base-url') ?? process.env.LOCAL_INFERENCE_BASE_URL ?? process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL;
const model = stringArg('model') ?? process.env.LOCAL_INFERENCE_MODEL ?? 'qwen3.5-0.8b';
const profileName = profileArg();
const endpointStyle = endpointStyleArg();
const outputDir = stringArg('out') ?? path.join('artifacts', 'local-inference-profiler');
const timeoutMs = numberArg('timeout-ms') ?? 180_000;
const protectedModels = protectedModelArg();

if (args.has('list-profiles')) {
  printJson({
    profiles: Object.fromEntries(Object.keys(localInferenceProfiles).map((name) => [
      name,
      {
        summary: summarizeLoadProfile(name),
        application: profileApplicationSummary(name),
        profile: localInferenceProfiles[name],
      },
    ])),
    endpointStyles: lmStudioInferenceEndpointStyles,
  });
  process.exit(0);
}

if (args.has('list-models')) {
  printJson(await inventoryModels(baseUrl, protectedModels, timeoutMs));
  process.exit(0);
}

const startedAt = new Date().toISOString();
const artifact = {
  generatedAt: startedAt,
  baseUrl,
  managementBaseUrl: managementBaseUrl(baseUrl),
  model,
  profile: profileName,
  endpointStyle,
  endpoint: lmStudioInferenceEndpointStyles[endpointStyle],
  intendedLoadPayload: buildLmStudioLoadPayload(model, profileName),
  protectedModels,
  application: profileApplicationSummary(profileName),
  profileSummary: summarizeLoadProfile(profileName),
  events: [],
};

if (args.has('unload-all')) {
  artifact.events.push(await timed('unload_all', () => unloadAll(baseUrl, protectedModels, timeoutMs)));
}

let loadResult;
if (args.has('load') || args.has('probe') || args.has('canary')) {
  artifact.events.push(await timed('load_model', async () => {
    loadResult = await loadModel(baseUrl, artifact.intendedLoadPayload, protectedModels, timeoutMs);
    return loadResult;
  }));
}

if (args.has('probe')) {
  artifact.events.push(await timed('direct_probe', () => directProbe(baseUrl, model, endpointStyle, timeoutMs)));
}

if (args.has('canary')) {
  artifact.events.push(await timed('local_canary', () => runLocalCanary({ baseUrl, model, profileName, outputDir })));
}

if (args.has('unload-after')) {
  artifact.events.push(await timed('unload_model', () => unloadModel(baseUrl, model, protectedModels, timeoutMs, loadResult)));
}

if (artifact.events.length === 0) {
  artifact.events.push({
    label: 'noop',
    ok: true,
    ms: 0,
    note: 'Use --load, --probe, --canary, --unload-after, --unload-all, --list-models, --list-profiles, and --protected-model <name>.',
  });
}

fs.mkdirSync(outputDir, { recursive: true });
const artifactPath = path.join(outputDir, `${slug(model)}-${profileName}-${Date.now()}.json`);
fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
const manifestPath = path.join(outputDir, QA_ARTIFACT_MANIFEST_FILE);
writeQaRunManifest(manifestPath, {
  artifactDir: outputDir,
  runKind: 'local-inference-profiler',
  stopCondition: 'Profiler operations completed or recorded per-event failures.',
  sampleCount: artifact.events.length,
  providers: ['local'],
  models: [model],
  profile: profileName,
  endpointStyle,
  excludedEvidenceReasons: artifact.events
    .filter((event) => !event.ok)
    .map((event) => `${event.label}: ${event.error?.message ?? event.error ?? 'event failed'}`),
  outputs: { artifactPath },
});
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

function endpointStyleArg() {
  const requested = stringArg('endpoint-style') ?? process.env.LOCAL_INFERENCE_ENDPOINT_STYLE ?? 'openai-chat-completions';
  if (!Object.hasOwn(lmStudioInferenceEndpointStyles, requested)) {
    throw new Error(`Unknown LM Studio endpoint style "${requested}". Expected ${Object.keys(lmStudioInferenceEndpointStyles).join(', ')}.`);
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

function protectedModelArg() {
  return [
    ...parseProtectedLocalInferenceModels(process.env.LOCAL_INFERENCE_PROTECTED_MODELS),
    ...parseProtectedLocalInferenceModels(stringArg('protected-model')),
  ];
}

async function inventoryModels(targetBaseUrl, protectedModelNames, requestTimeoutMs) {
  const apiBase = managementBaseUrl(targetBaseUrl);
  const [management, openai] = await Promise.allSettled([
    fetchJson(`${apiBase}/models`, {}, requestTimeoutMs),
    fetchJson(`${openAiBaseUrl(targetBaseUrl)}/models`, {}, requestTimeoutMs),
  ]);
  const managementModels = extractModelDescriptors(management.status === 'fulfilled' ? management.value : {});
  const openAiModels = extractModelDescriptors(openai.status === 'fulfilled' ? openai.value : {});
  return {
    baseUrl: targetBaseUrl,
    managementBaseUrl: apiBase,
    protectedModels: protectedModelNames,
    managementError: management.status === 'rejected' ? String(management.reason?.message ?? management.reason) : undefined,
    openAiError: openai.status === 'rejected' ? String(openai.reason?.message ?? openai.reason) : undefined,
    managementModels: markProtectedModels(managementModels, protectedModelNames),
    openAiModels: markProtectedModels(openAiModels, protectedModelNames),
  };
}

async function unloadAll(targetBaseUrl, protectedModelNames, requestTimeoutMs) {
  const apiBase = managementBaseUrl(targetBaseUrl);
  const models = await fetchJson(`${apiBase}/models`, {}, requestTimeoutMs);
  const descriptors = extractModelDescriptors(models);
  const ids = descriptors.map((entry) => entry.key ?? entry.id).filter((id) => typeof id === 'string');
  const loadedIds = Array.isArray(models.models)
    ? models.models
      .filter((entry) => entry?.state === 'loaded' || entry?.loaded === true || entry?.loaded_instance_id)
      .map((entry) => entry?.loaded_instance_id ?? entry?.key ?? entry?.id)
      .filter((id) => typeof id === 'string')
    : [];
  const candidates = loadedIds.length > 0 ? loadedIds : ids;
  const safeCandidates = candidates.filter((id) => !isProtectedLocalInferenceModel(id, protectedModelNames));
  const skippedProtected = candidates.filter((id) => isProtectedLocalInferenceModel(id, protectedModelNames));
  const responses = [];
  for (const id of safeCandidates) {
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
  return { attempted: safeCandidates, skippedProtected, responses };
}

async function loadModel(targetBaseUrl, payload, protectedModelNames, requestTimeoutMs) {
  if (isProtectedLocalInferenceModel(payload.model, protectedModelNames)) {
    throw new Error(`Refusing to load protected local inference model: ${payload.model}`);
  }
  return fetchJson(`${managementBaseUrl(targetBaseUrl)}/models/load`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  }, requestTimeoutMs);
}

async function unloadModel(targetBaseUrl, targetModel, protectedModelNames, requestTimeoutMs, loadResult) {
  if (isProtectedLocalInferenceModel(targetModel, protectedModelNames)) {
    throw new Error(`Refusing to unload protected local inference model: ${targetModel}`);
  }
  const candidates = [
    targetModel,
    ...localInferenceModelIdentifiers(loadResult && typeof loadResult === 'object' ? loadResult : {}),
    ...localInferenceModelIdentifiers(loadResult?.model && typeof loadResult.model === 'object' ? loadResult.model : {}),
  ].filter((value, index, all) => typeof value === 'string' && value.length > 0 && all.indexOf(value) === index);

  const responses = [];
  for (const id of candidates) {
    if (isProtectedLocalInferenceModel(id, protectedModelNames)) {
      responses.push({ id, skipped: true, reason: 'protected_model' });
      continue;
    }
    responses.push(await tryUnloadIdentifier(targetBaseUrl, id, requestTimeoutMs));
    if (responses.at(-1)?.ok === true) break;
  }
  return { candidates, responses };
}

async function tryUnloadIdentifier(targetBaseUrl, id, requestTimeoutMs) {
  const apiBase = managementBaseUrl(targetBaseUrl);
  const bodies = [
    { instance_id: id },
    { model_key: id },
    { model: id },
  ];
  const errors = [];
  for (const body of bodies) {
    try {
      return {
        id,
        body,
        ok: true,
        response: await fetchJson(`${apiBase}/models/unload`, {
          method: 'POST',
          headers: jsonHeaders(),
          body: JSON.stringify(body),
        }, requestTimeoutMs),
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { id, ok: false, errors };
}

async function directProbe(targetBaseUrl, targetModel, targetEndpointStyle, requestTimeoutMs) {
  const prompt = 'Give a tiny rice-cinnamon drink nostalgia cue. Include no full recipe, no browsing claim, and no provider identity.';
  const response = await fetchJson(probeUrl(targetBaseUrl, targetEndpointStyle), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(probeBody(targetModel, targetEndpointStyle, prompt)),
  }, requestTimeoutMs);
  const text = extractProbeText(response, targetEndpointStyle);
  return {
    endpointStyle: targetEndpointStyle,
    endpoint: lmStudioInferenceEndpointStyles[targetEndpointStyle],
    response,
    textPreview: typeof text === 'string' ? text.slice(0, 1200) : '',
    reasoningTracePreview: extractReasoningTrace(typeof text === 'string' ? text : ''),
  };
}

function extractModelDescriptors(models) {
  if (Array.isArray(models.models)) return models.models;
  if (Array.isArray(models.data)) return models.data;
  return [];
}

function markProtectedModels(models, protectedModelNames) {
  return models.map((entry) => ({
    id: entry?.id ?? entry?.key ?? entry?.model ?? entry?.name,
    key: entry?.key,
    name: entry?.name,
    state: entry?.state,
    loaded: entry?.loaded,
    loaded_instance_id: entry?.loaded_instance_id,
    protected: isProtectedLocalInferenceModel(entry ?? {}, protectedModelNames),
  }));
}

function probeUrl(targetBaseUrl, targetEndpointStyle) {
  if (targetEndpointStyle === 'anthropic-messages') return `${anthropicBaseUrl(targetBaseUrl)}/v1/messages`;
  if (targetEndpointStyle === 'openai-responses') return `${openAiBaseUrl(targetBaseUrl)}/responses`;
  if (targetEndpointStyle === 'openai-completions') return `${openAiBaseUrl(targetBaseUrl)}/completions`;
  if (targetEndpointStyle === 'native-chat') return `${managementBaseUrl(targetBaseUrl)}/chat`;
  return `${openAiBaseUrl(targetBaseUrl)}/chat/completions`;
}

function probeBody(targetModel, targetEndpointStyle, prompt) {
  if (targetEndpointStyle === 'anthropic-messages') {
    return { model: targetModel, max_tokens: 512, messages: [{ role: 'user', content: prompt }] };
  }
  if (targetEndpointStyle === 'openai-responses') {
    return { model: targetModel, max_output_tokens: 512, input: prompt };
  }
  if (targetEndpointStyle === 'openai-completions') {
    return { model: targetModel, max_tokens: 512, prompt };
  }
  if (targetEndpointStyle === 'native-chat') {
    return { model: targetModel, input: prompt, temperature: 0.2, max_output_tokens: 512, store: false };
  }
  return {
    model: targetModel,
    temperature: 0.2,
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  };
}

function extractProbeText(response, targetEndpointStyle) {
  if (targetEndpointStyle === 'anthropic-messages') {
    return (response.content || []).map((block) => block.text || block.content || '').join('\n');
  }
  if (targetEndpointStyle === 'openai-responses') {
    return (response.output || []).flatMap((item) => item.content || []).map((item) => item.text || '').join('\n');
  }
  if (targetEndpointStyle === 'openai-completions') {
    return response.choices?.[0]?.text ?? '';
  }
  if (targetEndpointStyle === 'native-chat') {
    return (response.output || []).map((item) => item.content || '').join('\n');
  }
  return response.choices?.[0]?.message?.content ?? '';
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

function anthropicBaseUrl(targetBaseUrl) {
  return targetBaseUrl.replace(/\/$/, '').replace(/\/v1$/, '').replace(/\/api\/v1$/, '');
}

function runLocalCanary(options) {
  return new Promise((resolve, reject) => {
    const summaryPath = path.join(options.outputDir, `${slug(options.model)}-${options.profileName}-canary-summary.json`);
    const child = spawn(process.execPath, ['scripts/local-canary-qa.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LOCAL_CANARY_BASE_URL: options.baseUrl,
        LOCAL_CANARY_MODEL: options.model,
        LOCAL_CANARY_PROFILE: process.env.LOCAL_CANARY_PROFILE ?? 'core',
        LOCAL_CANARY_ARTIFACT_DIR: options.outputDir,
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
