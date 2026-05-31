import Anthropic from '@anthropic-ai/sdk';
type AnthropicTool = Anthropic.Tool;

type OpenAITool = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: AnthropicTool['input_schema'];
  };
};

type OpenAITextContent = { type: 'text'; text: string };
type OpenAIImageContent = { type: 'image_url'; image_url: { url: string } };
type OpenAIUserContent = string | Array<OpenAITextContent | OpenAIImageContent>;

type OpenAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: OpenAIUserContent }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

type OpenAIToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments?: string };
};

type FetchLike = typeof fetch;

export type AskProviderKind = 'anthropic' | 'openai';
export type GlmEndpointStyle = 'anthropic-coding' | 'openai-coding';
export type LocalInferenceEndpointStyle =
  | 'openai-chat-completions'
  | 'openai-responses'
  | 'openai-completions'
  | 'anthropic-messages'
  | 'native-chat';

export type AskToolCall = {
  id: string;
  name: string;
  input: unknown;
};

export type AskToolResult = {
  id: string;
  content: string;
};

export type AskModelResponse = {
  textBlocks: string[];
  toolCalls: AskToolCall[];
  providerMessage: unknown;
};

export type NativeToolSupport = 'supported' | 'unsupported' | 'unknown';

export interface ProviderCapabilityProfile {
  provider: 'anthropic' | 'openai' | 'glm' | 'local' | 'openrouter';
  providerKind: AskProviderKind;
  model: string;
  endpointStyle?: string;
  baseUrl?: string;
  nativeTools: NativeToolSupport;
  nativeToolChoice: NativeToolSupport;
  rateLimitSensitive: boolean;
  recommendedTimeoutMs: number;
  compatibilitySource: 'explicit-env' | 'model-family' | 'catalog' | 'default';
  compatibilityNotes: string[];
}

export interface AskSession {
  create(maxTokens: number): Promise<AskModelResponse>;
  appendToolResults(response: AskModelResponse, toolResults: AskToolResult[]): void;
  injectDeterministicToolResult(toolCallId: string, toolName: string, toolInput: unknown, result: unknown): void;
  setAvailableTools(tools: AnthropicTool[]): void;
  pushUserMessage(text: string): void;
  compactForSynthesis(caseFileText: string): void;
}

export function resolveAskProviderKind(env: Record<string, string | undefined> = process.env): AskProviderKind {
  const explicit = env.ACHIOTE_ASK_PROVIDER?.trim().toLowerCase();
  if ((explicit === 'local' || explicit === 'lmstudio' || explicit === 'lm-studio')
    && resolveLocalInferenceEndpointStyle(env) === 'anthropic-messages') return 'anthropic';
  if (explicit === 'openai' || explicit === 'openai-compatible' || explicit === 'lmstudio' || explicit === 'lm-studio' || explicit === 'local') return 'openai';
  if ((explicit === 'glm' || explicit === 'zhipu') && resolveGlmEndpointStyle(env) === 'openai-coding') return 'openai';
  if (explicit === 'anthropic' || explicit === 'anthropic-compatible' || explicit === 'glm' || explicit === 'zhipu') return 'anthropic';
  return 'anthropic';
}

export function resolveAskModel(env: Record<string, string | undefined> = process.env): string {
  const provider = env.ACHIOTE_ASK_PROVIDER?.trim().toLowerCase();
  const providerKind = resolveAskProviderKind(env);
  const isLocalProvider = provider === 'local' || provider === 'lmstudio' || provider === 'lm-studio';
  if (provider === 'glm' || provider === 'zhipu') {
    return glmModelFromEnv(env);
  }

  if (providerKind === 'openai') {
    return env.LOCAL_INFERENCE_MODEL?.trim()
      || env.ACHIOTE_ASK_MODEL?.trim()
      || env.OPENAI_MODEL?.trim()
      || env.LMSTUDIO_MODEL?.trim()
      || env.LM_STUDIO_MODEL?.trim()
      || env.ANTHROPIC_DEFAULT_SONNET_MODEL?.trim()
      || 'gpt-4o-mini';
  }

  if (isLocalProvider) {
    return env.LOCAL_INFERENCE_MODEL?.trim()
      || env.ACHIOTE_ASK_MODEL?.trim()
      || env.LMSTUDIO_MODEL?.trim()
      || env.LM_STUDIO_MODEL?.trim()
      || env.ANTHROPIC_MODEL?.trim()
      || 'qwen3.5-0.8b';
  }

  return env.ACHIOTE_ASK_MODEL?.trim()
    || env.ANTHROPIC_MODEL?.trim()
    || env.CLAUDE_MODEL?.trim()
    || env.ANTHROPIC_DEFAULT_SONNET_MODEL?.trim()
    || 'claude-sonnet-4-5-20250929';
}


export function openAIBaseUrlFromEnv(env: Record<string, string | undefined> = process.env): string {
  const provider = env.ACHIOTE_ASK_PROVIDER?.trim().toLowerCase();
  const isLocalInference = provider === 'local' || provider === 'lmstudio' || provider === 'lm-studio';
  // LOCAL_INFERENCE_BASE_URL is only consulted when the provider is explicitly set to a local
  // inference variant. This prevents it from silently overriding cloud routing for openai/anthropic.
  if (isLocalInference) {
    return normalizeOpenAICompatibleBaseUrl(env.LOCAL_INFERENCE_BASE_URL?.trim()
      || env.OPENAI_BASE_URL?.trim()
      || env.LMSTUDIO_BASE_URL?.trim()
      || env.LM_STUDIO_BASE_URL?.trim()
      || 'http://127.0.0.1:1234/v1');
  }
  if ((provider === 'glm' || provider === 'zhipu') && resolveGlmEndpointStyle(env) === 'openai-coding') {
    return glmOpenAIBaseUrlFromEnv(env);
  }
  return env.OPENAI_BASE_URL?.trim()
    || env.LMSTUDIO_BASE_URL?.trim()
    || env.LM_STUDIO_BASE_URL?.trim()
    || 'https://api.openai.com/v1';
}

export function anthropicBaseUrlFromEnv(env: Record<string, string | undefined> = process.env): string | undefined {
  const provider = env.ACHIOTE_ASK_PROVIDER?.trim().toLowerCase();
  if ((provider === 'local' || provider === 'lmstudio' || provider === 'lm-studio')
    && resolveLocalInferenceEndpointStyle(env) === 'anthropic-messages') {
    return normalizeAnthropicCompatibleBaseUrl(env.LOCAL_INFERENCE_BASE_URL?.trim()
      || env.LMSTUDIO_BASE_URL?.trim()
      || env.LM_STUDIO_BASE_URL?.trim()
      || env.ANTHROPIC_BASE_URL?.trim()
      || 'http://127.0.0.1:1234');
  }
  if ((provider === 'glm' || provider === 'zhipu') && resolveGlmEndpointStyle(env) === 'openai-coding') return undefined;
  return env.ANTHROPIC_BASE_URL?.trim()
    || env.GLM_BASE_URL?.trim()
    || env.ZHIPU_BASE_URL?.trim()
    || (provider === 'glm' || provider === 'zhipu' ? 'https://api.z.ai/api/anthropic' : undefined);
}

export function resolveLocalInferenceEndpointStyle(env: Record<string, string | undefined> = process.env): LocalInferenceEndpointStyle | undefined {
  const provider = env.ACHIOTE_ASK_PROVIDER?.trim().toLowerCase();
  if (provider !== 'local' && provider !== 'lmstudio' && provider !== 'lm-studio') return undefined;
  return normalizeLocalInferenceEndpointStyle(
    env.LOCAL_INFERENCE_ENDPOINT_STYLE?.trim()
    || env.LMSTUDIO_ENDPOINT_STYLE?.trim()
    || env.LM_STUDIO_ENDPOINT_STYLE?.trim()
    || 'openai-chat-completions',
  );
}

export function resolveGlmEndpointStyle(env: Record<string, string | undefined> = process.env): GlmEndpointStyle | undefined {
  const provider = env.ACHIOTE_ASK_PROVIDER?.trim().toLowerCase();
  if (provider !== 'glm' && provider !== 'zhipu') return undefined;

  const explicit = explicitGlmEndpointStyle(env);
  if (explicit) return normalizeGlmEndpointStyle(explicit);

  return defaultGlmEndpointStyleForModel(glmModelFromEnv(env));
}

export function glmOpenAIBaseUrlFromEnv(env: Record<string, string | undefined> = process.env): string {
  return env.GLM_OPENAI_BASE_URL?.trim()
    || env.ZHIPU_OPENAI_BASE_URL?.trim()
    || env.GLM_CODING_BASE_URL?.trim()
    || env.ZHIPU_CODING_BASE_URL?.trim()
    || env.OPENAI_BASE_URL?.trim()
    || 'https://api.z.ai/api/coding/paas/v4';
}

function normalizeGlmEndpointStyle(value: string): GlmEndpointStyle {
  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  if (['openai', 'openai-compatible', 'openai-coding', 'coding-openai', 'coding/paas/v4'].includes(normalized)) {
    return 'openai-coding';
  }
  if (['anthropic', 'anthropic-compatible', 'anthropic-coding', 'claude', 'claude-code'].includes(normalized)) {
    return 'anthropic-coding';
  }
  return 'anthropic-coding';
}

function normalizeLocalInferenceEndpointStyle(value: string): LocalInferenceEndpointStyle {
  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  if (['anthropic', 'anthropic-compatible', 'anthropic-messages', 'messages', 'claude'].includes(normalized)) {
    return 'anthropic-messages';
  }
  if (['responses', 'openai-responses', 'response'].includes(normalized)) {
    return 'openai-responses';
  }
  if (['completions', 'openai-completions', 'completion'].includes(normalized)) {
    return 'openai-completions';
  }
  if (['native', 'native-chat', 'lmstudio-native', 'api-v1-chat'].includes(normalized)) {
    return 'native-chat';
  }
  return 'openai-chat-completions';
}

function normalizeOpenAICompatibleBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  if (trimmed.endsWith('/v1')) return trimmed;
  if (trimmed.endsWith('/api/v1')) return trimmed.replace(/\/api\/v1$/, '/v1');
  return `${trimmed}/v1`;
}

function normalizeAnthropicCompatibleBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '').replace(/\/v1$/, '').replace(/\/api\/v1$/, '');
}

export function openAICompatibleProviderReady(baseUrl: string, apiKey?: string | null): boolean {
  return isLocalInferenceUrl(baseUrl) || Boolean(apiKey?.trim());
}

export function isOpenRouterUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === 'openrouter.ai';
  } catch {
    return false;
  }
}

export function openRouterCatalogModelSupportsParameter(
  catalog: unknown,
  modelId: string,
  parameter: string,
): boolean | undefined {
  if (!catalog || typeof catalog !== 'object') return undefined;
  const data = (catalog as { data?: unknown }).data;
  if (!Array.isArray(data)) return undefined;
  const model = data.find((item): item is { id?: unknown; supported_parameters?: unknown } =>
    Boolean(item)
    && typeof item === 'object'
    && (item as { id?: unknown }).id === modelId);
  if (!model) return false;
  return Array.isArray(model.supported_parameters)
    && model.supported_parameters.includes(parameter);
}

export function defaultGlmEndpointStyleForModel(model: string): GlmEndpointStyle {
  return isGlm45FamilyModel(model) ? 'openai-coding' : 'anthropic-coding';
}

export function isOpenRouterFreeModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized === 'openrouter/free' || /:free$/i.test(normalized);
}

export function resolveProviderCapabilityProfile(
  env: Record<string, string | undefined> = process.env,
  openRouterCatalog?: unknown,
): ProviderCapabilityProfile {
  const provider = env.ACHIOTE_ASK_PROVIDER?.trim().toLowerCase();
  const providerKind = resolveAskProviderKind(env);
  const model = resolveAskModel(env);
  const timeoutMs = recommendedProviderTimeoutMs(env, providerKind);
  const localProvider = provider === 'local' || provider === 'lmstudio' || provider === 'lm-studio';
  const glmProvider = provider === 'glm' || provider === 'zhipu';
  const baseUrl = providerKind === 'openai' ? openAIBaseUrlFromEnv(env) : anthropicBaseUrlFromEnv(env);

  if (glmProvider) {
    const endpointStyle = resolveGlmEndpointStyle(env);
    const explicit = Boolean(explicitGlmEndpointStyle(env));
    return {
      provider: 'glm',
      providerKind,
      model,
      endpointStyle,
      baseUrl,
      nativeTools: 'unknown',
      nativeToolChoice: 'unknown',
      rateLimitSensitive: false,
      recommendedTimeoutMs: timeoutMs,
      compatibilitySource: explicit ? 'explicit-env' : 'model-family',
      compatibilityNotes: endpointStyle === 'openai-coding'
        ? ['GLM 4.5-family coding-plan models default to the OpenAI-compatible coding endpoint unless overridden.']
        : ['Newer GLM coding-plan models default to the Anthropic-compatible endpoint unless overridden.'],
    };
  }

  if (localProvider) {
    const endpointStyle = resolveLocalInferenceEndpointStyle(env);
    const explicit = Boolean(env.LOCAL_INFERENCE_ENDPOINT_STYLE?.trim()
      || env.LMSTUDIO_ENDPOINT_STYLE?.trim()
      || env.LM_STUDIO_ENDPOINT_STYLE?.trim());
    return {
      provider: 'local',
      providerKind,
      model,
      endpointStyle,
      baseUrl,
      nativeTools: endpointStyle === 'openai-completions' || endpointStyle === 'native-chat' ? 'unsupported' : 'unknown',
      nativeToolChoice: endpointStyle === 'openai-completions' || endpointStyle === 'native-chat' ? 'unsupported' : 'unknown',
      rateLimitSensitive: false,
      recommendedTimeoutMs: timeoutMs,
      compatibilitySource: explicit ? 'explicit-env' : 'default',
      compatibilityNotes: [
        'LM Studio exposes multiple endpoint families; runtime support and profiler support are tracked separately.',
      ],
    };
  }

  if (providerKind === 'openai' && baseUrl && isOpenRouterUrl(baseUrl)) {
    const tools = openRouterCatalogModelSupportsParameter(openRouterCatalog, model, 'tools');
    const toolChoice = openRouterCatalogModelSupportsParameter(openRouterCatalog, model, 'tool_choice');
    const catalogKnown = tools !== undefined || toolChoice !== undefined;
    return {
      provider: 'openrouter',
      providerKind,
      model,
      endpointStyle: 'openai-chat-completions',
      baseUrl,
      nativeTools: nativeToolSupportFromCatalog(tools),
      nativeToolChoice: nativeToolSupportFromCatalog(toolChoice),
      rateLimitSensitive: isOpenRouterFreeModel(model),
      recommendedTimeoutMs: Math.max(timeoutMs, isOpenRouterFreeModel(model) ? 240_000 : timeoutMs),
      compatibilitySource: catalogKnown ? 'catalog' : 'default',
      compatibilityNotes: [
        isOpenRouterFreeModel(model)
          ? 'OpenRouter free models are treated as rate-limit sensitive and need long timeouts for QA runs.'
          : 'OpenRouter models vary by model; catalog metadata should decide tool support when available.',
      ],
    };
  }

  return {
    provider: providerKind,
    providerKind,
    model,
    baseUrl,
    nativeTools: 'unknown',
    nativeToolChoice: 'unknown',
    rateLimitSensitive: false,
    recommendedTimeoutMs: timeoutMs,
    compatibilitySource: 'default',
    compatibilityNotes: ['No model-specific compatibility profile is configured for this provider.'],
  };
}

/** Returns true when the URL looks like a local or Tailscale inference endpoint. */
export interface FallbackProviderConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKey: string | null;
  timeoutMs: number;
}

export function resolveFallbackProviderConfig(
  env: Record<string, string | undefined> = process.env,
): FallbackProviderConfig {
  const enabled = env.ACHIOTE_ALLOW_LOCAL_FALLBACK?.trim() === '1'
    || env.ACHIOTE_ALLOW_LOCAL_FALLBACK?.trim().toLowerCase() === 'true';
  const baseUrl = normalizeOpenAICompatibleBaseUrl(
    env.ACHIOTE_LOCAL_FALLBACK_BASE_URL?.trim()
      || env.LOCAL_INFERENCE_BASE_URL?.trim()
      || 'http://host.docker.internal:8085/v1',
  );
  const model = env.ACHIOTE_LOCAL_FALLBACK_MODEL?.trim()
    || env.LOCAL_INFERENCE_MODEL?.trim()
    || 'Qwen3.5-0.8B-Q4_K_M';
  const apiKey = env.ACHIOTE_LOCAL_FALLBACK_API_KEY?.trim()
    || env.LOCAL_INFERENCE_API_KEY?.trim()
    || null;
  const timeoutMs = Number.parseInt(env.ACHIOTE_LOCAL_FALLBACK_TIMEOUT_MS?.trim() || '', 10);
  return {
    enabled,
    baseUrl,
    model,
    apiKey,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60_000,
  };
}

/** Returns true when the URL looks like a local or Tailscale inference endpoint. */
export function isLocalInferenceUrl(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    return parsed.hostname === '127.0.0.1'
      || parsed.hostname === 'localhost'
      || parsed.hostname === '::1'
      || parsed.hostname === '[::1]'
      || parsed.hostname === 'host.docker.internal'
      || parsed.hostname.startsWith('100.');
  } catch {
    return false;
  }
}

function explicitGlmEndpointStyle(env: Record<string, string | undefined>): string | undefined {
  return env.GLM_ENDPOINT_STYLE?.trim()
    || env.ZHIPU_ENDPOINT_STYLE?.trim()
    || env.GLM_COMPATIBILITY?.trim()
    || env.ZHIPU_COMPATIBILITY?.trim()
    || undefined;
}

function glmModelFromEnv(env: Record<string, string | undefined>): string {
  return env.ACHIOTE_ASK_MODEL?.trim()
    || env.GLM_MODEL?.trim()
    || env.ZHIPU_MODEL?.trim()
    || 'glm-5v-turbo';
}

function isGlm45FamilyModel(model: string): boolean {
  return /\bglm[-_ ]?4\.5(?:[-_ ]?(?:air|flash))?\b/i.test(model);
}

function nativeToolSupportFromCatalog(value: boolean | undefined): NativeToolSupport {
  if (value === true) return 'supported';
  if (value === false) return 'unsupported';
  return 'unknown';
}

function recommendedProviderTimeoutMs(env: Record<string, string | undefined>, providerKind: AskProviderKind): number {
  const candidates = providerKind === 'openai'
    ? [
        env.LOCAL_INFERENCE_TIMEOUT_MS,
        env.OPENAI_TIMEOUT_MS,
        env.LMSTUDIO_TIMEOUT_MS,
        env.GLM_TIMEOUT_MS,
        env.ZHIPU_TIMEOUT_MS,
        env.API_TIMEOUT_MS,
      ]
    : [env.ANTHROPIC_TIMEOUT_MS, env.GLM_TIMEOUT_MS, env.ZHIPU_TIMEOUT_MS, env.API_TIMEOUT_MS];
  for (const candidate of candidates) {
    const parsed = candidate ? Number.parseInt(candidate, 10) : Number.NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return providerKind === 'openai' ? 180_000 : 120_000;
}

/**
 * Fires a minimal single-token completion against the local inference endpoint.
 * Returns true if the endpoint is up and responding, false on any error or timeout.
 * Used to make the fallback decision before committing to a provider for a request.
 */
export async function pingLocalInference(
  baseUrl: string,
  model: string,
  apiKey: string | null | undefined,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey?.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function openAiToolsFromAnthropic(tools: AnthropicTool[]): OpenAITool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

function parseJsonObject(value: string | undefined): unknown {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse tool arguments: ${detail}. Raw args: ${value.slice(0, 500)}`);
  }
}

function stringifyToolJson(value: unknown): string {
  return JSON.stringify(value) ?? 'null';
}

export type AskHistoryItem = { role: 'user' | 'assistant'; content: string };
export type AskImage = { base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' };

export function createAnthropicAskSession(input: {
  client: Anthropic;
  model: string;
  systemPrompt: string;
  userMessage: string;
  tools: AnthropicTool[];
  history?: AskHistoryItem[];
  images?: AskImage[];
}): AskSession {
  const userContent: Anthropic.ContentBlockParam[] = [
    ...(input.images ?? []).map((img): Anthropic.ImageBlockParam => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
    })),
    { type: 'text', text: input.userMessage },
  ];

  const messages: Anthropic.MessageParam[] = [
    ...(input.history ?? []).map((h): Anthropic.MessageParam => ({ role: h.role, content: h.content })),
    { role: 'user', content: userContent },
  ];
  const initialMessages = [...messages];
  let activeTools = input.tools;

  return {
    async create(maxTokens: number): Promise<AskModelResponse> {
      const response = await input.client.messages.create({
        model: input.model,
        max_tokens: maxTokens,
        system: input.systemPrompt,
        messages,
        tools: activeTools,
      });
      const toolCalls = response.content
        .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
        .map((block) => ({ id: block.id, name: block.name, input: block.input }));
      const textBlocks = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text);
      return { textBlocks, toolCalls, providerMessage: response.content };
    },
    appendToolResults(response: AskModelResponse, toolResults: AskToolResult[]): void {
      messages.push({ role: 'assistant', content: response.providerMessage as Anthropic.ContentBlockParam[] });
      messages.push({
        role: 'user',
        content: toolResults.map((result): Anthropic.ToolResultBlockParam => ({
          type: 'tool_result',
          tool_use_id: result.id,
          content: result.content,
        })),
      });
    },
    injectDeterministicToolResult(toolCallId: string, toolName: string, toolInput: unknown, result: unknown): void {
      messages.push({
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: toolCallId,
          name: toolName,
          input: toolInput,
        }],
      });
      messages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: toolCallId,
          content: stringifyToolJson(result),
        }],
      });
    },
    setAvailableTools(tools: AnthropicTool[]): void {
      activeTools = tools;
    },
    pushUserMessage(text: string): void {
      messages.push({ role: 'user', content: text });
    },
    compactForSynthesis(caseFileText: string): void {
      messages.length = 0;
      messages.push(...initialMessages, { role: 'user', content: caseFileText });
      activeTools = [];
    },
  };
}

export function createOpenAICompatibleAskSession(input: {
  model: string;
  systemPrompt: string;
  userMessage: string;
  tools: AnthropicTool[];
  baseUrl: string;
  apiKey?: string | null;
  timeoutMs: number;
  fetchImpl?: FetchLike;
  history?: AskHistoryItem[];
  images?: AskImage[];
}): AskSession {
  const fetchImpl = input.fetchImpl ?? fetch;
  const historyMessages: OpenAIMessage[] = (input.history ?? []).map((h): OpenAIMessage => ({ role: h.role, content: h.content }));
  const userContent: OpenAIUserContent = [
    ...(input.images ?? []).map((img): OpenAIImageContent => ({
      type: 'image_url',
      image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
    })),
    { type: 'text', text: input.userMessage },
  ];
  const messages: OpenAIMessage[] = [
    { role: 'system', content: input.systemPrompt },
    ...historyMessages,
    { role: 'user', content: userContent },
  ];
  const initialMessages = [...messages];
  let activeTools = input.tools;

  return {
    async create(maxTokens: number): Promise<AskModelResponse> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (input.apiKey?.trim()) headers.Authorization = `Bearer ${input.apiKey.trim()}`;
        const response = await fetchImpl(`${input.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            model: input.model,
            messages,
            ...(activeTools.length > 0 ? {
              tools: openAiToolsFromAnthropic(activeTools),
              tool_choice: 'auto',
            } : {}),
            max_tokens: maxTokens,
          }),
        });
        const body = await response.text();
        if (!response.ok) throw new Error(`OpenAI-compatible provider returned ${response.status}: ${body.slice(0, 1000)}`);
        const parsed = JSON.parse(body) as {
          choices?: Array<{ message?: OpenAIMessage; finish_reason?: string }>;
          error?: { code?: string | number; message?: string };
        };
        if (parsed.error) {
          const code = parsed.error.code ?? response.status;
          const message = parsed.error.message ?? 'Unknown provider error';
          throw new Error(`OpenAI-compatible provider returned ${code}: ${message}`);
        }
        const choice = parsed.choices?.[0];
        const message = choice?.message;
        if (!message || message.role !== 'assistant') throw new Error('OpenAI-compatible provider returned no assistant message');
        // Detect context-window overflow — treat as a hard error so the client
        // gets a meaningful signal rather than a silent empty response.
        if (choice?.finish_reason === 'length') {
          throw new Error('Model hit context length limit (finish_reason: length). Message history is too long for this model.');
        }
        const toolCalls = (message.tool_calls ?? []).map((call) => ({
          id: call.id,
          name: call.function.name,
          input: parseJsonObject(call.function.arguments),
        }));
        // Strip <think>…</think> reasoning blocks that some models (e.g. Qwen3)
        // embed in message.content. Without stripping, thinking prose can trigger
        // guard regexes on measurement or candidate-list patterns and suppress
        // valid model output.
        const rawContent = typeof message.content === 'string' ? message.content : '';
        const strippedContent = rawContent
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .replace(/<think>[\s\S]*?(?:\n\s*\n|$)/gi, '')
          .trim();
        const textBlocks = strippedContent.length > 0 ? [strippedContent] : [];
        return { textBlocks, toolCalls, providerMessage: message };
      } finally {
        clearTimeout(timeout);
      }
    },
    appendToolResults(response: AskModelResponse, toolResults: AskToolResult[]): void {
      messages.push(response.providerMessage as OpenAIMessage);
      for (const result of toolResults) {
        messages.push({ role: 'tool', tool_call_id: result.id, content: result.content });
      }
    },
    injectDeterministicToolResult(toolCallId: string, toolName: string, toolInput: unknown, result: unknown): void {
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: toolCallId,
          type: 'function',
          function: {
            name: toolName,
            arguments: stringifyToolJson(toolInput),
          },
        }],
      });
      messages.push({ role: 'tool', tool_call_id: toolCallId, content: stringifyToolJson(result) });
    },
    setAvailableTools(tools: AnthropicTool[]): void {
      activeTools = tools;
    },
    pushUserMessage(text: string): void {
      messages.push({ role: 'user', content: text });
    },
    compactForSynthesis(caseFileText: string): void {
      messages.length = 0;
      messages.push(...initialMessages, { role: 'user', content: caseFileText });
      activeTools = [];
    },
  };
}
