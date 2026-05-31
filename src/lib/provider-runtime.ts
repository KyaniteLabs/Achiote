import Anthropic from '@anthropic-ai/sdk';
import {
  createAnthropicAskSession,
  createOpenAICompatibleAskSession,
  isOpenRouterUrl,
  openAIBaseUrlFromEnv,
  openAICompatibleProviderReady,
  resolveAskModel,
  resolveAskProviderKind,
  resolveFallbackProviderConfig,
  resolveProviderCapabilityProfile,
  type AskHistoryItem,
  type AskImage,
  type AskModelResponse,
  type AskSession,
  type AskToolResult,
  type FallbackProviderConfig,
  type ProviderCapabilityProfile,
} from './ask-provider.js';

type AnthropicTool = Anthropic.Tool;

export type ProviderRuntimeInput = {
  env?: Record<string, string | undefined>;
  anthropicClient: Anthropic;
  systemPrompt: string;
  tools: AnthropicTool[];
  openAITimeoutMs: number;
};

export type ProviderRuntime = {
  providerKind: ReturnType<typeof resolveAskProviderKind>;
  model: string;
  openAIBaseUrl: string;
  profile: ProviderCapabilityProfile;
  fallbackConfig: FallbackProviderConfig;
  createAskSession(input: {
    userMessage: string;
    history?: AskHistoryItem[];
    images?: AskImage[];
  }): AskSession;
  selectedProviderSupportsNativeTools(): Promise<boolean | undefined>;
  readinessCredentials(): {
    anthropicApiKey?: string;
    anthropicAuthToken?: string;
    openaiProviderReady: boolean;
    fallbackReady: boolean;
  };
};

function isFallbackTriggerError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message;
    // Connection failure (fetch throws)
    if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('fetch failed')) return true;
    // AbortController timeout
    if (err.name === 'AbortError' || msg.includes('abort')) return true;
    // HTTP 5xx from createOpenAICompatibleAskSession
    if (/returned\s5\d\d/.test(msg)) return true;
  }
  return false;
}

function createFallbackDecoratedSession(
  primary: AskSession,
  fallbackInput: {
    model: string;
    systemPrompt: string;
    tools: AnthropicTool[];
    baseUrl: string;
    apiKey: string | null;
    timeoutMs: number;
    userMessage: string;
    history?: AskHistoryItem[];
    images?: AskImage[];
  },
): AskSession {
  let fallbackSession: AskSession | null = null;
  let usingFallback = false;

  function getOrCreateFallback(): AskSession {
    if (!fallbackSession) {
      fallbackSession = createOpenAICompatibleAskSession({
        model: fallbackInput.model,
        systemPrompt: fallbackInput.systemPrompt,
        userMessage: fallbackInput.userMessage,
        tools: fallbackInput.tools,
        baseUrl: fallbackInput.baseUrl,
        apiKey: fallbackInput.apiKey,
        timeoutMs: fallbackInput.timeoutMs,
        history: fallbackInput.history,
        images: fallbackInput.images,
      });
    }
    return fallbackSession;
  }

  return {
    async create(maxTokens: number): Promise<AskModelResponse> {
      if (usingFallback) return getOrCreateFallback().create(maxTokens);
      try {
        const result = await primary.create(maxTokens);
        console.log('[ask] provider=primary');
        return result;
      } catch (err) {
        if (isFallbackTriggerError(err)) {
          console.warn(`[ask] primary provider failed, falling back to local: ${err instanceof Error ? err.message : String(err)}`);
          usingFallback = true;
          console.log('[ask] provider=fallback');
          return getOrCreateFallback().create(maxTokens);
        }
        throw err;
      }
    },
    appendToolResults(response: AskModelResponse, toolResults: AskToolResult[]): void {
      (usingFallback ? getOrCreateFallback() : primary).appendToolResults(response, toolResults);
    },
    injectDeterministicToolResult(toolCallId: string, toolName: string, toolInput: unknown, result: unknown): void {
      // Deterministic results are injected before the first model call, so they
      // go to both sessions to keep state consistent.
      primary.injectDeterministicToolResult(toolCallId, toolName, toolInput, result);
      if (fallbackSession) fallbackSession.injectDeterministicToolResult(toolCallId, toolName, toolInput, result);
    },
    setAvailableTools(tools: Anthropic.Tool[]): void {
      primary.setAvailableTools(tools);
      if (fallbackSession) fallbackSession.setAvailableTools(tools);
    },
    pushUserMessage(text: string): void {
      (usingFallback ? getOrCreateFallback() : primary).pushUserMessage(text);
    },
    compactForSynthesis(caseFileText: string): void {
      (usingFallback ? getOrCreateFallback() : primary).compactForSynthesis(caseFileText);
    },
  };
}

export function createProviderRuntime(input: ProviderRuntimeInput): ProviderRuntime {
  const env = input.env ?? process.env;
  const providerKind = resolveAskProviderKind(env);
  const model = resolveAskModel(env);
  const openAIBaseUrl = openAIBaseUrlFromEnv(env);
  const profile = resolveProviderCapabilityProfile(env);
  const fallbackConfig = resolveFallbackProviderConfig(env);
  let openRouterToolsSupportPromise: Promise<boolean | undefined> | undefined;

  function openAIApiKey(): string | null {
    const provider = env.ACHIOTE_ASK_PROVIDER?.trim().toLowerCase();
    if (provider === 'local' || provider === 'lmstudio' || provider === 'lm-studio') {
      return env.LOCAL_INFERENCE_API_KEY
        || env.LMSTUDIO_API_KEY
        || env.LM_STUDIO_API_KEY
        || env.OPENAI_API_KEY
        || null;
    }
    if (provider === 'glm' || provider === 'zhipu') {
      return env.GLM_API_KEY || env.ZHIPU_API_KEY || null;
    }
    if (openAIBaseUrl && openAIBaseUrl.includes('openrouter.ai')) {
      return env.OPENROUTER_API_KEY || env.OPENAI_API_KEY || null;
    }
    return env.OPENAI_API_KEY || null;
  }

  return {
    providerKind,
    model,
    openAIBaseUrl,
    profile,
    fallbackConfig,
    createAskSession(sessionInput) {
      if (providerKind === 'openai') {
        const primary = createOpenAICompatibleAskSession({
          model,
          systemPrompt: input.systemPrompt,
          userMessage: sessionInput.userMessage,
          tools: input.tools,
          baseUrl: openAIBaseUrl,
          apiKey: openAIApiKey(),
          timeoutMs: input.openAITimeoutMs,
          history: sessionInput.history,
          images: sessionInput.images,
        });
        if (fallbackConfig.enabled) {
          return createFallbackDecoratedSession(primary, {
            model: fallbackConfig.model,
            systemPrompt: input.systemPrompt,
            tools: input.tools,
            baseUrl: fallbackConfig.baseUrl,
            apiKey: fallbackConfig.apiKey,
            timeoutMs: fallbackConfig.timeoutMs,
            userMessage: sessionInput.userMessage,
            history: sessionInput.history,
            images: sessionInput.images,
          });
        }
        return primary;
      }

      return createAnthropicAskSession({
        client: input.anthropicClient,
        model,
        systemPrompt: input.systemPrompt,
        userMessage: sessionInput.userMessage,
        tools: input.tools,
        history: sessionInput.history,
        images: sessionInput.images,
      });
    },
    selectedProviderSupportsNativeTools() {
      const explicit = parseBooleanEnv(env.ACHIOTE_ASK_MODEL_SUPPORTS_TOOLS)
        ?? parseBooleanEnv(env.OPENROUTER_MODEL_SUPPORTS_TOOLS);
      if (explicit !== undefined) return Promise.resolve(explicit);
      if (providerKind !== 'openai' || !isOpenRouterUrl(openAIBaseUrl)) return Promise.resolve(undefined);
      openRouterToolsSupportPromise ??= fetchOpenRouterModelSupportsTools(env);
      return openRouterToolsSupportPromise;
    },
    readinessCredentials() {
      const ready = providerKind === 'openai' && openAICompatibleProviderReady(openAIBaseUrl, openAIApiKey());
      return {
        anthropicApiKey: ready ? 'openai-compatible-provider' : providerKind === 'openai' ? undefined : (env.ANTHROPIC_API_KEY || env.GLM_API_KEY || env.ZHIPU_API_KEY || undefined),
        anthropicAuthToken: providerKind === 'openai' ? undefined : env.ANTHROPIC_AUTH_TOKEN,
        openaiProviderReady: ready,
        fallbackReady: fallbackConfig.enabled,
      };
    },
  };
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return undefined;
}

async function fetchOpenRouterModelSupportsTools(env: Record<string, string | undefined>): Promise<boolean | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7_500);
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models?supported_parameters=tools', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return undefined;
    const catalog = await response.json() as unknown;
    const profile = resolveProviderCapabilityProfile(env, catalog);
    if (profile.nativeTools === 'supported') return true;
    if (profile.nativeTools === 'unsupported') return false;
    return undefined;
  } catch (err) {
    console.warn('[ask] OpenRouter tool capability lookup failed:', err instanceof Error ? err.message : String(err));
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}
