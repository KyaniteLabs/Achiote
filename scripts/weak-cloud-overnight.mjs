#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { selectWeakCloudPromptBank } from './lib/canary-prompt-bank.mjs';
import { buildQaRunManifest } from './lib/qa-artifact-pipeline.mjs';
import { qualityFindings } from './lib/weak-cloud-quality.mjs';
import { shouldStartRound } from './lib/weak-cloud-schedule.mjs';

const root = process.cwd();
const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.join('=') || 'true'];
}));

if (args.has('help')) {
  console.log(`Usage: node scripts/weak-cloud-overnight.mjs [--out=artifacts/weak-cloud-overnight] [--interval-ms=1800000] [--end=ISO_DATE] [--prompt-bank=bank-id]

Runs final canary torture across one local LM Studio model, one OpenRouter free model, and one GLM Coding Plan model concurrently per wave.
GLM telemetry rows include endpointStyle and baseUrl so GLM-4.5-era models can be compared across Anthropic-compatible and OpenAI-compatible Coding Plan routes.
The runner disables live web/search provider keys inside Achiote child processes and writes both engineering and marketing comparison artifacts.
Prompt banks rotate from the bundled reference-data fingerprint so reruns after cache/reference seeding ask different hard questions.`);
  process.exit(0);
}

const artifactDir = path.resolve(args.get('out') || 'artifacts/weak-cloud-overnight');
const intervalMs = Number.parseInt(args.get('interval-ms') || String(60 * 60 * 1000), 10);
const endAt = args.has('end') ? new Date(args.get('end')) : nextEightAm();
const nakedProviderTimeoutMs = Number.parseInt(args.get('provider-timeout-ms') || '180000', 10);
const achioteAskTimeoutMs = Number.parseInt(args.get('ask-timeout-ms') || '420000', 10);
const retryCount = Number.parseInt(args.get('retry-count') || '2', 10);
const retryDelayMs = Number.parseInt(args.get('retry-delay-ms') || '45000', 10);
const minRoundStartWindowMs = Number.parseInt(args.get('min-round-start-window-ms') || '300000', 10);
const jsonlPath = path.join(artifactDir, 'results.jsonl');
const summaryPath = path.join(artifactDir, 'summary.md');
const statePath = path.join(artifactDir, 'state.json');
const logPath = path.join(artifactDir, 'runner.log');
const manifestPath = path.join(artifactDir, 'run-manifest.json');
const marketingPath = path.join(artifactDir, 'marketing-candidates.md');
const localBaseUrl = (args.get('local-base-url') || process.env.LOCAL_INFERENCE_BASE_URL || process.env.OPENAI_BASE_URL || 'http://100.66.225.85:1234/v1').replace(/\/$/, '');
const localProfile = args.get('local-profile') || process.env.LOCAL_INFERENCE_PROFILE || 'speed';
const localEndpointStyle = args.get('local-endpoint-style') || process.env.LOCAL_INFERENCE_ENDPOINT_STYLE || 'openai-chat-completions';
const localTimeoutMs = Number.parseInt(args.get('local-timeout-ms') || String(Math.max(achioteAskTimeoutMs, 240_000)), 10);
const openRouterPerRound = Number.parseInt(args.get('openrouter-per-round') || '7', 10);
const localPerRound = Number.parseInt(args.get('local-per-round') || '2', 10);
const protectedLocalModels = parseCsv([
  process.env.LOCAL_INFERENCE_PROTECTED_MODELS,
  args.get('protected-model'),
  'repo-pipeline-qwen35-q8-prod',
].filter(Boolean).join(','));

const noWebSearchEnv = {
  SERPER_API_KEY: '',
  BRAVE_API_KEY: '',
  TAVILY_API_KEY: '',
  BING_API_KEY: '',
  GOOGLE_API_KEY: '',
  GOOGLE_CSE_ID: '',
  SEARCH_API_KEY: '',
};

const selectedPromptBank = selectWeakCloudPromptBank({
  root,
  artifactDir,
  requestedBankId: args.get('prompt-bank'),
});
const prompts = selectedPromptBank.prompts;
const promptById = Object.fromEntries(prompts.map((prompt) => [prompt.id, prompt.text]));
const searchDisabledPromptIds = new Set(selectedPromptBank.searchDisabledPromptIds);

const openRouterPriority = [
  'openai/gpt-oss-20b:free',
  'openai/gpt-oss-120b:free',
  'nvidia/nemotron-nano-9b-v2:free',
  'minimax/minimax-m2.5:free',
  'inclusionai/ling-2.6-1t:free',
  'liquid/lfm-2.5-1.2b-instruct:free',
  'liquid/lfm-2.5-1.2b-thinking:free',
  'openrouter/free',
  'baidu/qianfan-ocr-fast:free',
  'google/gemma-3n-e2b-it:free',
  'google/gemma-3n-e4b-it:free',
  'google/gemma-3-4b-it:free',
  'meta-llama/llama-3.2-3b-instruct:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'poolside/laguna-xs.2:free',
  'poolside/laguna-m.1:free',
];

const localPriority = parseCsv(args.get('local-models') || process.env.LOCAL_INFERENCE_MODELS || '').length > 0
  ? parseCsv(args.get('local-models') || process.env.LOCAL_INFERENCE_MODELS || '')
  : [
      'google_gemma-3-270m-it',
      'qwen3-0.6b',
      'qwen3.5-4b',
      'gemma-4-e2b-it',
      'lfm2-8b-a1b',
      'qwen3-coder-next-reap-40b-a3b-i1',
    ];

const glmMatrix = [
  { model: 'GLM-5.1', endpointStyle: 'anthropic-coding', baseUrl: 'https://api.z.ai/api/anthropic' },
  { model: 'GLM-5-Turbo', endpointStyle: 'anthropic-coding', baseUrl: 'https://api.z.ai/api/anthropic' },
  { model: 'GLM-4.7', endpointStyle: 'anthropic-coding', baseUrl: 'https://api.z.ai/api/anthropic' },
  { model: 'GLM-4.5-Air', endpointStyle: 'anthropic-coding', baseUrl: 'https://api.z.ai/api/anthropic' },
  { model: 'GLM-4.5-Air', endpointStyle: 'openai-coding', baseUrl: 'https://api.z.ai/api/coding/paas/v4' },
  { model: 'GLM-4.5-Flash', endpointStyle: 'anthropic-coding', baseUrl: 'https://api.z.ai/api/anthropic' },
  { model: 'GLM-4.5-Flash', endpointStyle: 'openai-coding', baseUrl: 'https://api.z.ai/api/coding/paas/v4' },
];
const liveChildren = new Set();

fs.mkdirSync(artifactDir, { recursive: true });
writeRunManifest();

process.on('uncaughtException', (error) => {
  log(`uncaughtException ${error?.stack || error}`);
  writeSummary();
  shutdown(1);
});

process.on('unhandledRejection', (reason) => {
  log(`unhandledRejection ${reason?.stack || reason}`);
  writeSummary();
  shutdown(1);
});

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));

function nextEightAm() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(8, 0, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target;
}

function shutdown(code) {
  for (const child of liveChildren) child.kill('SIGTERM');
  process.exit(code);
}

function log(line) {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  fs.appendFileSync(logPath, `${stamped}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(value, max = 900) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function redactDiagnosticText(value) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[redacted-key]')
    .replace(/\bsk-or-[A-Za-z0-9_-]{12,}\b/g, '[redacted-openrouter-key]')
    .replace(/("(?:api[_-]?key|authorization|token|secret)"\s*:\s*")[^"]+(")/gi, '$1[redacted]$2')
    .replace(/((?:api[_-]?key|authorization|token|secret)\s*=\s*)\S+/gi, '$1[redacted]');
}

function safeDiagnosticPreview(value, max = 500) {
  return truncate(redactDiagnosticText(value), max);
}

function timeoutClassForStatus(status, errorText = '') {
  const combined = `${status} ${errorText}`;
  if (status === 'timeout' || /timeout|aborted|AbortError/i.test(combined)) return 'provider_timeout';
  if (/\b429\b|rate limit|temporarily overloaded|overloaded/i.test(combined)) return 'provider_rate_limit';
  if (/\b(?:401|auth(?:entication|orization)?|token|api key|invalid key)\b/i.test(combined)) return 'provider_auth';
  if (/\b5\d\d\b|server error|bad gateway|service unavailable/i.test(combined)) return 'provider_5xx';
  return undefined;
}

function reasoningTokenCountFrom(body) {
  const candidates = [
    body?.usage?.reasoning_tokens,
    body?.usage?.completion_tokens_details?.reasoning_tokens,
    body?.usage?.output_tokens_details?.reasoning_tokens,
    body?.stats?.reasoning_output_tokens,
  ];
  const found = candidates.find((value) => Number.isFinite(value));
  return found === undefined ? undefined : found;
}

function parseJsonBody(rawBody) {
  try {
    return rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return {};
  }
}

function writeRunManifest(extra = {}) {
  const sharedManifest = buildQaRunManifest({
    root,
    artifactDir,
    runKind: 'weak-cloud-overnight',
    stopCondition: `Run waves until ${endAt.toISOString()} or until shutdown.`,
    promptBank: selectedPromptBank,
    promptIds: prompts.map((prompt) => prompt.id),
    searchDisabledPromptIds: [...searchDisabledPromptIds],
    providers: ['local', 'openrouter', 'glm'],
    models: [...localPriority, ...openRouterPriority, ...glmMatrix.map((entry) => entry.model)],
    profile: localProfile,
    endpointStyle: localEndpointStyle,
    excludedEvidenceReasons: ['control_flow_violation', 'provider_path_failure', 'wrapper_quality_regression'],
    outputs: { jsonlPath, summaryPath, statePath, logPath, marketingPath },
  });
  const manifest = {
    ...sharedManifest,
    generatedAt: new Date().toISOString(),
    artifactDir,
    qaArtifactPipeline: sharedManifest,
    timeoutBudget: {
      nakedProviderTimeoutMs,
      achioteAskTimeoutMs,
      localTimeoutMs,
      intervalMs,
      endAt: endAt.toISOString(),
      minRoundStartWindowMs,
    },
    retryBudget: {
      retryCount,
      retryDelayMs,
    },
    laneConcurrency: {
      local: 1,
      openrouter: 1,
      glm: 1,
    },
    localInference: {
      baseUrl: localBaseUrl,
      profile: localProfile,
      endpointStyle: localEndpointStyle,
      protectedModels: protectedLocalModels,
      priority: localPriority,
      perRound: localPerRound,
    },
    keyAvailability: {
      glm: Boolean(getGlmKey()),
      openrouterConfigured: Boolean(getOpenRouterKey()),
    },
    noWebSearchEnv: Object.keys(noWebSearchEnv),
    searchDisabledPromptIds: [...searchDisabledPromptIds],
    promptBank: {
      id: selectedPromptBank.id,
      description: selectedPromptBank.description,
      referenceFingerprint: selectedPromptBank.referenceFingerprint,
      previousPromptBankId: selectedPromptBank.previousPromptBankId,
      previousReferenceFingerprint: selectedPromptBank.previousReferenceFingerprint,
      rotatedAfterReferenceUpdate: selectedPromptBank.rotatedAfterReferenceUpdate,
    },
    promptIds: prompts.map((prompt) => prompt.id),
    glmMatrix,
    openRouterPriority,
    ...extra,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseSse(text) {
  return text.split('\n\n').filter(Boolean).map((block) => ({
    event: block.split('\n').find((line) => line.startsWith('event: '))?.slice(7),
    data: block.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n'),
  }));
}

function parseData(event) {
  try {
    return JSON.parse(event.data);
  } catch {
    return event.data;
  }
}

function eventText(events) {
  return events.filter((event) => event.event === 'text').map(parseData).join('');
}

function eventTools(events) {
  return events.filter((event) => event.event === 'tool_call').map((event) => parseData(event).name);
}

async function timedFetchText(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout ${timeoutMs}ms`)), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.text();
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

async function timedFetchJson(url, init, timeoutMs) {
  const { response, body } = await timedFetchText(url, init, timeoutMs);
  return { response, body: parseJsonBody(body), rawBody: body };
}

function getGlmKey() {
  if (process.env.GLM_API_KEY?.trim()) return process.env.GLM_API_KEY.trim();
  try {
    return execFileSync('ssh', [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=8',
      'root@100.92.68.103',
      "awk -F= '/^(GLM_API_KEY|ZHIPU_API_KEY)=/{print $2; exit}' /docker/achiote/env/achiote.env | tr -d '\"'",
    ], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function getOpenRouterKey() {
  if (process.env.OPENROUTER_API_KEY?.trim()) return process.env.OPENROUTER_API_KEY.trim();
  const roots = [
    '~/.codex',
    '~/.agents',
    root,
  ];
  const candidates = new Set();
  function walk(item) {
    let stat;
    try { stat = fs.statSync(item); } catch { return; }
    if (stat.isDirectory()) {
      if (['node_modules', '.git'].includes(path.basename(item))) return;
      for (const name of fs.readdirSync(item)) walk(path.join(item, name));
      return;
    }
    if (!stat.isFile() || stat.size > 5_000_000) return;
    let text;
    try { text = fs.readFileSync(item, 'utf8'); } catch { return; }
    for (const match of text.matchAll(/sk-or-[A-Za-z0-9_-]{20,}/g)) candidates.add(match[0]);
  }
  for (const rootDir of roots) walk(rootDir);
  return [...candidates][0] || '';
}

async function validatedOpenRouterKey() {
  const key = getOpenRouterKey();
  if (!key) return '';
  try {
    const { response } = await timedFetchText('https://openrouter.ai/api/v1/auth/key', {
      headers: { authorization: `Bearer ${key}` },
    }, 12_000);
    return response.ok ? key : '';
  } catch {
    return '';
  }
}

async function openRouterCatalog() {
  try {
    const { body } = await timedFetchJson('https://openrouter.ai/api/v1/models', {}, 20_000);
    return (body.data || [])
      .filter((model) => /:free$/i.test(model.id) || /\(free\)/i.test(model.name || ''))
      .filter((model) => !/\bglm\b|z-ai|zai/i.test(`${model.id} ${model.name || ''}`));
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function openRouterModelFromCatalog(catalog, modelId) {
  if (!Array.isArray(catalog)) return null;
  return catalog.find((model) => model?.id === modelId) || null;
}

function openRouterCapabilityMetadata(catalog, modelId) {
  const model = openRouterModelFromCatalog(catalog, modelId);
  const supportedParameters = Array.isArray(model?.supported_parameters) ? model.supported_parameters.filter((item) => typeof item === 'string') : [];
  const topProvider = model && typeof model.top_provider === 'object' && model.top_provider !== null ? model.top_provider : {};
  return {
    catalogMetadata: model ? {
      id: model.id,
      name: typeof model.name === 'string' ? model.name : undefined,
      context_length: typeof model.context_length === 'number' ? model.context_length : undefined,
      top_provider: {
        context_length: typeof topProvider.context_length === 'number' ? topProvider.context_length : undefined,
        max_completion_tokens: typeof topProvider.max_completion_tokens === 'number' ? topProvider.max_completion_tokens : undefined,
      },
      supported_parameters: supportedParameters,
    } : null,
    endpointStyle: 'openai-chat-completions',
    baseUrl: 'https://openrouter.ai/api/v1',
    nativeTools: supportedParameters.includes('tools') ? 'supported' : model ? 'unsupported' : 'unknown',
    nativeToolChoice: supportedParameters.includes('tool_choice') ? 'supported' : model ? 'unsupported' : 'unknown',
    rateLimitSensitive: modelId === 'openrouter/free' || /:free$/i.test(modelId),
    compatibilitySource: model ? 'catalog' : 'default',
    supportedParameters,
    contextLength: typeof model?.context_length === 'number'
      ? model.context_length
      : typeof topProvider.context_length === 'number' ? topProvider.context_length : undefined,
  };
}

function localCapabilityMetadata(modelId) {
  return {
    endpointStyle: localEndpointStyle,
    baseUrl: localBaseUrl,
    nativeTools: localEndpointStyle === 'openai-completions' || localEndpointStyle === 'native-chat' ? 'unsupported' : 'unknown',
    nativeToolChoice: localEndpointStyle === 'openai-completions' || localEndpointStyle === 'native-chat' ? 'unsupported' : 'unknown',
    rateLimitSensitive: false,
    compatibilitySource: 'local-inference-profile',
    supportedParameters: ['max_tokens', 'tools', 'tool_choice'],
    localProfile,
  };
}

function classifyProvider(status, errorText, text) {
  const combined = `${status} ${errorText} ${text}`;
  const statusAndError = `${status} ${errorText}`;
  if (/\b429\b|rate limit|temporarily overloaded|overloaded/i.test(combined)) return 'provider_rate_limited';
  if (/\b400\b|provider returned error|unsupported|not support|tool/i.test(statusAndError)) return 'provider_compatibility';
  if (/\b(?:401|403|auth(?:entication|orization)?|token|api key|invalid key)\b/i.test(statusAndError)) return 'provider_auth';
  if (!text?.trim()) return 'empty_visible_output';
  return 'provider_ok';
}

function shouldRetryProviderResult(result) {
  return ['provider_rate_limited', 'empty_visible_output'].includes(result?.classification)
    || result?.status === 'timeout';
}

function classifyAchioteWorkflow(responseStatus, errors, text, tools, done, quality) {
  if (errors.length > 0) return classifyProvider(responseStatus, JSON.stringify(errors), text);
  if (!text?.trim()) return 'empty_visible_output';
  if (tools.length === 0) return 'workflow_incomplete';
  if (!done?.guarded && quality.includes('missed_minimum_cue_frame')) return 'workflow_incomplete';
  return 'workflow_ok';
}

async function runWithRetries(label, fn) {
  let result;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    if (attempt > 0) {
      const delay = retryDelayMs * attempt;
      log(`${label} retry ${attempt}/${retryCount} after ${delay}ms`);
      await sleep(delay);
    }
    result = await fn();
    result.attempt = attempt + 1;
    if (!shouldRetryProviderResult(result)) return result;
  }
  return result;
}

async function nakedGlm(model, prompt, endpointStyle = 'anthropic-coding') {
  const started = Date.now();
  const key = getGlmKey();
  const baseUrl = endpointStyle === 'openai-coding'
    ? 'https://api.z.ai/api/coding/paas/v4'
    : 'https://api.z.ai/api/anthropic';
  if (!key) return { mode: 'naked', provider: 'glm', model, endpointStyle, baseUrl, status: 'missing_key', ms: 0, text: '', errors: ['missing_glm_key'], classification: 'provider_auth', quality: [] };
  try {
    const { response, body, rawBody } = await timedFetchJson(endpointStyle === 'openai-coding'
      ? `${baseUrl}/chat/completions`
      : `${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: endpointStyle === 'openai-coding'
        ? { 'content-type': 'application/json', authorization: `Bearer ${key}` }
        : { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 900, messages: [{ role: 'user', content: prompt.text }] }),
    }, nakedProviderTimeoutMs);
    const text = endpointStyle === 'openai-coding'
      ? (body.choices?.[0]?.message?.content || '')
      : (body.content || []).map((block) => block.text || '').join('\n');
    const error = body.error?.message || body.message || '';
    return {
      mode: 'naked', provider: 'glm', model, endpointStyle, baseUrl, prompt: prompt.id, status: response.status, ms: Date.now() - started,
      text: truncate(text), errors: error ? [safeDiagnosticPreview(error)] : [], classification: classifyProvider(response.status, error, text),
      providerErrorPreview: error || response.status >= 400 ? safeDiagnosticPreview(rawBody) : undefined,
      timeoutClass: timeoutClassForStatus(response.status, error),
      reasoningTokenCount: reasoningTokenCountFrom(body),
      quality: qualityFindings(text, prompt.text, 'naked'),
    };
  } catch (error) {
    return { mode: 'naked', provider: 'glm', model, endpointStyle, baseUrl, prompt: prompt.id, status: 'timeout', ms: Date.now() - started, text: '', errors: [safeDiagnosticPreview(error.message)], providerErrorPreview: safeDiagnosticPreview(error.message), timeoutClass: 'provider_timeout', classification: 'provider_rate_limited', quality: [] };
  }
}

async function nakedOpenRouter(model, prompt, key, capabilityMetadata = {}) {
  const started = Date.now();
  if (!key) return { mode: 'naked', provider: 'openrouter', model, ...capabilityMetadata, status: 'missing_key', ms: 0, text: '', errors: ['missing_openrouter_key'], classification: 'provider_auth', quality: [] };
  try {
    const { response, body, rawBody } = await timedFetchJson('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        'HTTP-Referer': 'https://achiote.kyanitelabs.tech',
        'X-Title': 'Achiote weak cloud overnight',
      },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt.text }], max_tokens: 900 }),
    }, nakedProviderTimeoutMs);
    const text = body.choices?.[0]?.message?.content || '';
    const error = body.error?.message || '';
    return {
      mode: 'naked', provider: 'openrouter', model, ...capabilityMetadata, prompt: prompt.id, status: response.status, ms: Date.now() - started,
      text: truncate(text), errors: error ? [safeDiagnosticPreview(error)] : [], classification: classifyProvider(response.status, error, text),
      providerErrorPreview: error || response.status >= 400 ? safeDiagnosticPreview(rawBody) : undefined,
      timeoutClass: timeoutClassForStatus(response.status, error),
      reasoningTokenCount: reasoningTokenCountFrom(body),
      quality: qualityFindings(text, prompt.text, 'naked'),
    };
  } catch (error) {
    return { mode: 'naked', provider: 'openrouter', model, ...capabilityMetadata, prompt: prompt.id, status: 'timeout', ms: Date.now() - started, text: '', errors: [safeDiagnosticPreview(error.message)], providerErrorPreview: safeDiagnosticPreview(error.message), timeoutClass: 'provider_timeout', classification: 'provider_rate_limited', quality: [] };
  }
}

async function nakedLocal(model, prompt, capabilityMetadata = {}) {
  const started = Date.now();
  try {
    const { response, body, rawBody } = await timedFetchJson(`${localBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...localAuthHeaders() },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt.text }], max_tokens: 900 }),
    }, localTimeoutMs);
    const text = body.choices?.[0]?.message?.content || '';
    const error = body.error?.message || '';
    return {
      mode: 'naked', provider: 'local', model, ...capabilityMetadata, prompt: prompt.id, status: response.status, ms: Date.now() - started,
      text: truncate(text), errors: error ? [safeDiagnosticPreview(error)] : [], classification: classifyProvider(response.status, error, text),
      providerErrorPreview: error || response.status >= 400 ? safeDiagnosticPreview(rawBody) : undefined,
      timeoutClass: timeoutClassForStatus(response.status, error),
      reasoningTokenCount: reasoningTokenCountFrom(body),
      reasoningTracePreview: extractReasoningTrace(text),
      quality: qualityFindings(text, prompt.text, 'naked'),
    };
  } catch (error) {
    return { mode: 'naked', provider: 'local', model, ...capabilityMetadata, prompt: prompt.id, status: 'timeout', ms: Date.now() - started, text: '', errors: [safeDiagnosticPreview(error.message)], providerErrorPreview: safeDiagnosticPreview(error.message), timeoutClass: 'provider_timeout', classification: 'provider_rate_limited', quality: [] };
  }
}

async function waitForServer(child, port) {
  await new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`server startup timeout: ${stderr.slice(-500)}`)), 20_000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (stdout.includes(`localhost:${port}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code) reject(new Error(`server exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

async function achioteAsk({ provider, model, prompt, openRouterKey, endpointStyle, baseUrl, capabilityMetadata }) {
  const started = Date.now();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'achiote-weak-cloud-'));
  const port = 46000 + Math.floor(Math.random() * 10_000);
  const env = {
    ...process.env,
    ...noWebSearchEnv,
    PORT: String(port),
    ACHIOTE_AUTH_ENABLED: 'false',
    ACHIOTE_ALLOW_ANON_ASK: 'true',
    ACHIOTE_CACHE_PATH: path.join(tmp, 'cache.db'),
    ACHIOTE_RATE_LIMIT_DB: path.join(tmp, 'rate.db'),
    OPENAI_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    ACHIOTE_DISABLE_SEARCH_WEB: searchDisabledPromptIds.has(prompt.id) ? 'true' : '',
  };
  if (provider === 'glm') {
    env.ACHIOTE_ASK_PROVIDER = 'glm';
    env.ACHIOTE_ASK_MODEL = model;
    env.GLM_ENDPOINT_STYLE = endpointStyle || 'anthropic-coding';
    env.GLM_BASE_URL = 'https://api.z.ai/api/anthropic';
    env.GLM_OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4';
    env.GLM_API_KEY = getGlmKey();
    env.ANTHROPIC_TIMEOUT_MS = String(achioteAskTimeoutMs);
    env.GLM_TIMEOUT_MS = String(achioteAskTimeoutMs);
  } else if (provider === 'local') {
    env.ACHIOTE_ASK_PROVIDER = 'local';
    env.ACHIOTE_ASK_MODEL = model;
    env.LOCAL_INFERENCE_MODEL = model;
    env.LOCAL_INFERENCE_BASE_URL = localBaseUrl;
    env.LOCAL_INFERENCE_ENDPOINT_STYLE = localEndpointStyle;
    env.LOCAL_INFERENCE_TIMEOUT_MS = String(localTimeoutMs);
    env.LOCAL_INFERENCE_API_KEY = process.env.LOCAL_INFERENCE_API_KEY || '';
    env.OPENAI_TIMEOUT_MS = String(localTimeoutMs);
    env.ANTHROPIC_TIMEOUT_MS = String(localTimeoutMs);
  } else {
    env.ACHIOTE_ASK_PROVIDER = 'openai';
    env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1';
    env.OPENAI_MODEL = model;
    env.OPENAI_API_KEY = openRouterKey || '';
    env.OPENAI_TIMEOUT_MS = String(achioteAskTimeoutMs);
  }
  const child = spawn(process.execPath, ['dist/http-server.js'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  liveChildren.add(child);
  try {
    await waitForServer(child, port);
    const { response, body: raw } = await timedFetchText(`http://127.0.0.1:${port}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: prompt.text }),
    }, achioteAskTimeoutMs + 30_000);
    const events = parseSse(raw);
    const text = eventText(events);
    const errors = events.filter((event) => event.event === 'error').map(parseData);
    const tools = eventTools(events);
    const done = events.filter((event) => event.event === 'done').map(parseData).at(-1) || null;
    const quality = [...qualityFindings(text, prompt.text, 'achiote', { tools }), ...(tools.length === 0 ? ['missing_tool_workflow'] : [])];
    return {
      mode: 'achiote', provider, model, ...(capabilityMetadata || {}), endpointStyle: endpointStyle || capabilityMetadata?.endpointStyle, baseUrl: baseUrl || capabilityMetadata?.baseUrl, prompt: prompt.id, status: response.status, ms: Date.now() - started,
      text: truncate(text), errors, tools, done,
      classification: classifyAchioteWorkflow(response.status, errors, text, tools, done, quality),
      providerErrorPreview: errors.length > 0 ? safeDiagnosticPreview(JSON.stringify(errors)) : undefined,
      timeoutClass: timeoutClassForStatus(response.status, JSON.stringify(errors)),
      quality,
    };
  } catch (error) {
    return {
      mode: 'achiote', provider, model, ...(capabilityMetadata || {}), endpointStyle: endpointStyle || capabilityMetadata?.endpointStyle, baseUrl: baseUrl || capabilityMetadata?.baseUrl, prompt: prompt.id, status: 'timeout', ms: Date.now() - started,
      text: '', errors: [{ message: safeDiagnosticPreview(error.message), code: 'timeout_or_runtime' }], tools: [], done: null,
      providerErrorPreview: safeDiagnosticPreview(error.message),
      timeoutClass: 'provider_timeout',
      classification: 'provider_rate_limited', quality: [],
    };
  } finally {
    child.kill('SIGTERM');
    await waitForChildExit(child);
    liveChildren.delete(child);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function waitForChildExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => child.once('exit', resolve));
}

async function inventoryLocalModels() {
  try {
    const { body } = await timedFetchJson(`${localBaseUrl}/models`, {
      headers: localAuthHeaders(),
    }, 20_000);
    const ids = (body.data || []).map((model) => model.id).filter((id) => typeof id === 'string');
    return ids.filter((id) => !isProtectedLocalModel(id));
  } catch (error) {
    log(`local inventory failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function isProtectedLocalModel(modelId) {
  const normalized = String(modelId || '').toLowerCase();
  return protectedLocalModels.some((protectedModel) => normalized === protectedModel.toLowerCase());
}

function localAuthHeaders() {
  const token = process.env.LOCAL_INFERENCE_API_KEY || process.env.LM_API_TOKEN || '';
  return token.trim() ? { authorization: `Bearer ${token.trim()}` } : {};
}

function loadProfilePayload(model) {
  const profile = localProfile === 'quality'
    ? { context_length: 16384, eval_batch_size: 512, parallel: 1, flash_attention: true, offload_kv_cache_to_gpu: true, num_experts: 4 }
    : localProfile === 'memory'
      ? { context_length: 4096, eval_batch_size: 256, parallel: 1, flash_attention: true, offload_kv_cache_to_gpu: false }
      : { context_length: 8192, eval_batch_size: 1024, parallel: 1, flash_attention: true, offload_kv_cache_to_gpu: true, num_experts: 4 };
  const payload = { model, ...profile, echo_load_config: true };
  if (!/\b(?:moe|a\d+b|a\d+\.\d+b)\b/i.test(model) && !/-\d+b-a\d+b/i.test(model)) delete payload.num_experts;
  return payload;
}

async function loadLocalModel(model) {
  if (isProtectedLocalModel(model)) throw new Error(`refusing to load protected local model ${model}`);
  const managementBase = localBaseUrl.replace(/\/$/, '').replace(/\/(?:v1|api\/v1)$/, '') + '/api/v1';
  const result = await timedFetchJson(`${managementBase}/models/load`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...localAuthHeaders() },
    body: JSON.stringify(loadProfilePayload(model)),
  }, localTimeoutMs);
  if (!result.response.ok || result.body?.error) {
    throw new Error(`local load failed: status=${result.response.status} body=${safeDiagnosticPreview(result.rawBody)}`);
  }
  return result;
}

async function unloadLocalModel(model, loadResult) {
  if (isProtectedLocalModel(model)) return { skipped: true, reason: 'protected_model' };
  const managementBase = localBaseUrl.replace(/\/$/, '').replace(/\/(?:v1|api\/v1)$/, '') + '/api/v1';
  const candidates = localModelIdentifiers(model, loadResult?.body).filter((value, index, all) => all.indexOf(value) === index);
  const attempts = [];
  for (const id of candidates) {
    for (const body of [{ instance_id: id }, { model_key: id }, { model: id }]) {
      try {
        const { body: responseBody } = await timedFetchJson(`${managementBase}/models/unload`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...localAuthHeaders() },
          body: JSON.stringify(body),
        }, localTimeoutMs);
        if (responseBody?.error) {
          attempts.push({ id, body, error: 'unload_response_error', response: responseBody });
          continue;
        }
        return { ok: true, id, body, response: responseBody, attempts };
      } catch (error) {
        attempts.push({ id, body, error: safeDiagnosticPreview(error.message) });
      }
    }
  }
  return { ok: false, candidates, attempts: attempts.slice(-9) };
}

function localModelIdentifiers(...values) {
  const identifiers = [];
  for (const value of values) {
    if (!value) continue;
    if (typeof value === 'string') {
      identifiers.push(value);
      continue;
    }
    if (typeof value !== 'object') continue;
    for (const key of ['id', 'key', 'name', 'model', 'loaded_instance_id', 'instance_id']) {
      const candidate = value[key];
      if (typeof candidate === 'string' && candidate.trim()) identifiers.push(candidate);
      if (candidate && typeof candidate === 'object') identifiers.push(...localModelIdentifiers(candidate));
    }
    if (Array.isArray(value.loaded_instances)) {
      for (const loaded of value.loaded_instances) identifiers.push(...localModelIdentifiers(loaded));
    }
  }
  return identifiers;
}

function chooseLocalModels(inventory, roundIndex) {
  const available = localPriority.filter((id) => inventory.includes(id) && !isProtectedLocalModel(id));
  if (available.length === 0) return [];
  const count = Math.min(Math.max(localPerRound, 0), available.length);
  const chosen = new Set();
  for (let i = 0; i < count; i += 1) {
    chosen.add(available[(roundIndex * count + i) % available.length]);
  }
  return [...chosen];
}

function appendResult(result) {
  fs.appendFileSync(jsonlPath, `${JSON.stringify({ ...result, at: new Date().toISOString() })}\n`);
}

function exceptionResult({ roundId, mode, provider, model, endpointStyle, baseUrl, prompt, error, capabilityMetadata }) {
  return {
    roundId,
    mode,
    provider,
    model,
    ...(capabilityMetadata || {}),
    endpointStyle: endpointStyle || capabilityMetadata?.endpointStyle,
    baseUrl: baseUrl || capabilityMetadata?.baseUrl,
    prompt: prompt.id,
    status: 'runner_exception',
    ms: 0,
    text: '',
    errors: [{ message: error instanceof Error ? error.message : String(error), code: 'runner_exception' }],
    classification: 'runner_exception',
    quality: [],
  };
}

function localManagementFailureResult({ roundId, mode, provider, model, endpointStyle, baseUrl, prompt, error, capabilityMetadata }) {
  return {
    roundId,
    mode,
    provider,
    model,
    ...(capabilityMetadata || {}),
    endpointStyle: endpointStyle || capabilityMetadata?.endpointStyle,
    baseUrl: baseUrl || capabilityMetadata?.baseUrl,
    prompt: prompt.id,
    status: 'local_management_error',
    ms: 0,
    text: '',
    errors: [{ message: error instanceof Error ? safeDiagnosticPreview(error.message) : safeDiagnosticPreview(String(error)), code: 'local_management_failed' }],
    classification: 'local_management_failed',
    quality: [],
  };
}

function chooseOpenRouterModels(catalog, roundIndex) {
  const ids = Array.isArray(catalog)
    ? catalog.map((model) => model.id)
    : [];
  const ordered = [
    ...openRouterPriority.filter((id) => ids.includes(id)),
    ...ids.filter((id) => !openRouterPriority.includes(id)),
  ];
  if (ordered.length === 0) return [];
  const count = Math.min(openRouterPerRound, ordered.length);
  const chosen = new Set();
  for (let i = 0; i < count; i += 1) {
    chosen.add(ordered[(roundIndex * count + i) % ordered.length]);
  }
  chosen.add('openrouter/free');
  return [...chosen].filter((id) => ids.includes(id));
}

async function runNakedAndAchiote(roundId, test, openRouterKey) {
  log(`${roundId} naked ${test.provider} ${test.model} ${test.prompt.id}`);
  const naked = await runWithRetries(`${roundId} naked ${test.provider} ${test.model}`, async () => {
    try {
      if (test.provider === 'glm') return await nakedGlm(test.model, test.prompt, test.endpointStyle);
      if (test.provider === 'local') return await nakedLocal(test.model, test.prompt, test.capabilityMetadata);
      return await nakedOpenRouter(test.model, test.prompt, openRouterKey, test.capabilityMetadata);
    } catch (error) {
      log(`${roundId} naked exception ${test.provider} ${test.model}: ${error instanceof Error ? error.message : String(error)}`);
      return exceptionResult({ roundId, mode: 'naked', ...test, error });
    }
  });
  appendResult({ roundId, ...naked });

  log(`${roundId} achiote ${test.provider} ${test.model} ${test.prompt.id}`);
  const achiote = await runWithRetries(`${roundId} achiote ${test.provider} ${test.model}`, async () => {
    try {
      return await achioteAsk({ ...test, openRouterKey });
    } catch (error) {
      log(`${roundId} achiote exception ${test.provider} ${test.model}: ${error instanceof Error ? error.message : String(error)}`);
      return exceptionResult({ roundId, mode: 'achiote', ...test, error });
    }
  });
  appendResult({ roundId, ...achiote });
}

async function runLocalTest(roundId, test) {
  appendResult({ kind: 'local_load', roundId, provider: 'local', model: test.model, prompt: test.prompt.id, at: new Date().toISOString(), loadProfile: loadProfilePayload(test.model) });
  let loadResult;
  try {
    loadResult = await loadLocalModel(test.model);
    await runNakedAndAchiote(roundId, test, '');
  } catch (error) {
    appendResult({ roundId, ...localManagementFailureResult({ roundId, mode: 'naked', ...test, error }) });
    appendResult({ roundId, ...localManagementFailureResult({ roundId, mode: 'achiote', ...test, error }) });
  } finally {
    const unload = await unloadLocalModel(test.model, loadResult);
    appendResult({ kind: 'local_unload', roundId, provider: 'local', model: test.model, prompt: test.prompt.id, at: new Date().toISOString(), unload });
  }
}

async function runRound(roundIndex) {
  const roundId = `round-${String(roundIndex).padStart(2, '0')}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  log(`starting ${roundId}`);
  const catalog = await openRouterCatalog();
  const localInventory = await inventoryLocalModels();
  const openRouterKey = await validatedOpenRouterKey();
  const promptOffset = roundIndex % prompts.length;
  const selectedOpenRouter = chooseOpenRouterModels(catalog, roundIndex);
  const selectedLocal = chooseLocalModels(localInventory, roundIndex);
  const selectedModelCapabilities = Object.fromEntries(selectedOpenRouter.map((modelId) => [
    modelId,
    openRouterCapabilityMetadata(catalog, modelId),
  ]));
  const catalogResult = {
    kind: 'catalog',
    roundId,
    provider: 'openrouter',
    modelCount: Array.isArray(catalog) ? catalog.length : 0,
    selectedModels: selectedOpenRouter,
    localInventoryCount: localInventory.length,
    selectedLocal,
    selectedModelCapabilities,
    catalogError: catalog.error || null,
  };
  appendResult(catalogResult);
  writeRunManifest({
    lastRound: {
      roundId,
      openRouterCatalogCount: Array.isArray(catalog) ? catalog.length : 0,
      selectedOpenRouter,
      localInventoryCount: localInventory.length,
      selectedLocal,
      selectedModelCapabilities,
      catalogError: catalog.error || null,
    },
  });

  const glmTests = [];
  for (let i = 0; i < glmMatrix.length; i += 1) {
    glmTests.push({ provider: 'glm', ...glmMatrix[i], prompt: prompts[(promptOffset + i) % prompts.length] });
  }
  const openRouterTests = [];
  for (let i = 0; i < selectedOpenRouter.length; i += 1) {
    const capabilityMetadata = selectedModelCapabilities[selectedOpenRouter[i]];
    openRouterTests.push({ provider: 'openrouter', model: selectedOpenRouter[i], capabilityMetadata, prompt: prompts[(promptOffset + i + 2) % prompts.length] });
  }
  const localTests = selectedLocal.map((model, index) => ({
    provider: 'local',
    model,
    capabilityMetadata: localCapabilityMetadata(model),
    prompt: prompts[(promptOffset + index + 4) % prompts.length],
  }));

  const waveCount = Math.max(glmTests.length, openRouterTests.length, localTests.length);
  for (let waveIndex = 0; waveIndex < waveCount; waveIndex += 1) {
    const wave = [
      glmTests[waveIndex] ? runNakedAndAchiote(roundId, glmTests[waveIndex], openRouterKey) : null,
      openRouterTests[waveIndex] ? runNakedAndAchiote(roundId, openRouterTests[waveIndex], openRouterKey) : null,
      localTests[waveIndex] ? runLocalTest(roundId, localTests[waveIndex]) : null,
    ].filter(Boolean);
    log(`${roundId} wave ${waveIndex + 1}/${waveCount} lanes=${wave.length}`);
    await Promise.all(wave);
    writeSummary();
    writeMarketingSummary();
  }
  writeSummary();
  writeMarketingSummary();
  log(`finished ${roundId}`);
}

function readResults() {
  if (!fs.existsSync(jsonlPath)) return [];
  return fs.readFileSync(jsonlPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function writeSummary() {
  const results = readResults();
  const tested = results.filter((result) => result.mode);
  const byClass = new Map();
  const quality = [];
  for (const result of tested) {
    byClass.set(result.classification, (byClass.get(result.classification) || 0) + 1);
    if (result.quality?.length) quality.push(result);
  }
  const lines = [];
  lines.push('# Weak Cloud Overnight Torture');
  lines.push('');
  lines.push(`Updated: ${new Date().toISOString()}`);
  lines.push(`End target: ${endAt.toISOString()}`);
  lines.push(`Total model-path tests: ${tested.length}`);
  lines.push('');
  lines.push('## Classification Counts');
  for (const [classification, count] of [...byClass.entries()].sort()) {
    lines.push(`- ${classification}: ${count}`);
  }
  lines.push('');
  lines.push('## Latest Quality Findings');
  for (const result of quality.slice(-30)) {
    const endpoint = result.endpointStyle ? `[${result.endpointStyle}]` : '';
    lines.push(`- ${result.at} ${result.mode}/${result.provider}/${result.model}${endpoint}/${result.prompt}: ${result.quality.join(', ')} | ${truncate(result.text, 240)}`);
  }
  lines.push('');
  lines.push('## Latest Provider/Workflow Failures');
  for (const result of tested.filter((item) => item.classification !== 'provider_ok' && item.classification !== 'workflow_ok').slice(-30)) {
    const endpoint = result.endpointStyle ? `[${result.endpointStyle}]` : '';
    lines.push(`- ${result.at} ${result.mode}/${result.provider}/${result.model}${endpoint}/${result.prompt}: ${result.classification} status=${result.status} errors=${truncate(JSON.stringify(result.errors), 240)}`);
  }
  fs.writeFileSync(summaryPath, `${lines.join('\n')}\n`);
  fs.writeFileSync(statePath, JSON.stringify({ updatedAt: new Date().toISOString(), endAt: endAt.toISOString(), totalTests: tested.length }, null, 2));
}

function pairKey(result) {
  return [result.roundId, result.provider, result.model, result.endpointStyle || '', result.prompt].join('|');
}

function writeMarketingSummary() {
  const results = readResults().filter((result) => result.mode && result.prompt);
  const groups = new Map();
  for (const result of results) {
    const key = pairKey(result);
    const group = groups.get(key) || {};
    group[result.mode] = result;
    groups.set(key, group);
  }
  const candidates = [...groups.values()]
    .filter((group) => group.naked && group.achiote)
    .map((group) => marketingCandidate(group.naked, group.achiote))
    .sort((a, b) => b.score - a.score);

  const lines = [];
  lines.push('# Achiote Versus Naked Model Marketing Candidates');
  lines.push('');
  lines.push(`Updated: ${new Date().toISOString()}`);
  lines.push(`Paired comparisons: ${candidates.length}`);
  lines.push('');
  for (const candidate of candidates.slice(0, 40)) {
    const endpoint = candidate.endpointStyle ? `[${candidate.endpointStyle}]` : '';
    lines.push(`## ${candidate.provider}/${candidate.model}${endpoint}/${candidate.prompt}`);
    lines.push('');
    lines.push(`Score: ${candidate.score} | Publishable: ${candidate.publishable ? 'yes' : 'no'} | Labels: ${candidate.labels.join(', ') || 'none'}`);
    lines.push('');
    lines.push(`Naked: ${candidate.nakedExcerpt}`);
    lines.push('');
    lines.push(`Achiote: ${candidate.achioteExcerpt}`);
    lines.push('');
    lines.push(`Why it matters: ${candidate.whyItMatters}`);
    lines.push('');
  }
  fs.writeFileSync(marketingPath, `${lines.join('\n')}\n`);
}

function marketingCandidate(naked, achiote) {
  const labels = [];
  const nakedQuality = effectiveQualitySet(naked);
  const achioteQuality = effectiveQualitySet(achiote);
  if (nakedQuality.has('full_recipe_drift') && !achioteQuality.has('full_recipe_drift')) labels.push('prevents full-recipe drift');
  if (nakedQuality.has('overconfident_identity') && !achioteQuality.has('overconfident_identity')) labels.push('reduces false certainty');
  if (nakedQuality.has('false_browsing_claim') && !achioteQuality.has('false_browsing_claim')) labels.push('blocks fake browsing claims');
  if (nakedQuality.has('missed_minimum_cue_frame') && !achioteQuality.has('missed_minimum_cue_frame')) labels.push('keeps minimum-cue frame');
  if ((achiote.tools || []).includes('generate_minimum_viable_nostalgia')) labels.push('structured cue workflow');
  if (achiote.done?.guarded) labels.push(`deterministic recovery: ${achiote.done.guarded}`);
  const publishable = achiote.classification === 'workflow_ok'
    && achiote.text?.trim()
    && !achioteQuality.has('provider_identity_leak')
    && !achioteQuality.has('forbidden_tool:search_web')
    && !achioteQuality.has('false_browsing_claim')
    && !achioteQuality.has('full_recipe_drift');
  const score = labels.length * 2
    + (publishable ? 3 : 0)
    + (naked.text?.trim() ? 1 : -2)
    + (achiote.text?.trim() ? 2 : -4)
    - (achiote.errors?.length ? 3 : 0);
  return {
    provider: achiote.provider,
    model: achiote.model,
    endpointStyle: achiote.endpointStyle,
    prompt: achiote.prompt,
    score,
    publishable: Boolean(publishable),
    labels,
    nakedExcerpt: truncate(naked.text, 500) || '[empty]',
    achioteExcerpt: truncate(achiote.text, 500) || '[empty]',
    whyItMatters: labels.length > 0
      ? `Achiote changes the same model input into a more bounded reconstruction path: ${labels.join('; ')}.`
      : 'This pair is retained for audit, but it is not a strong marketing example yet.',
  };
}

function effectiveQualitySet(result) {
  return new Set([
    ...(result.quality || []),
    ...qualityFindings(result.text || '', promptById[result.prompt] || '', result.mode, { tools: result.tools || [] }),
  ]);
}

function extractReasoningTrace(text) {
  const value = String(text || '');
  const match = value.match(/(?:<think>[\s\S]{0,700}<\/think>|Thinking Process\s*:[\s\S]{0,700}|Reasoning\s*:[\s\S]{0,700})/i);
  return match ? truncate(match[0], 700) : undefined;
}

function nextDelay() {
  const now = Date.now();
  const next = Math.ceil(now / intervalMs) * intervalMs;
  return Math.max(1_000, next - now);
}

log(`weak cloud overnight runner start; end=${endAt.toISOString()} intervalMs=${intervalMs}`);
let roundIndex = readResults().filter((result) => result.kind === 'catalog').length;
while (shouldStartRound({ now: new Date(), endAt, minRoundStartWindowMs })) {
  await runRound(roundIndex);
  roundIndex += 1;
  if (!shouldStartRound({ now: new Date(), endAt, minRoundStartWindowMs })) break;
  const delay = Math.min(intervalMs, nextDelay(), endAt.getTime() - Date.now());
  log(`sleeping ${Math.round(delay / 1000)}s`);
  await sleep(delay);
}
writeSummary();
log('weak cloud overnight runner complete');
