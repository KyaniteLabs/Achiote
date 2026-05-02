import Anthropic from '@anthropic-ai/sdk';
import {
  createAnthropicAskSession,
  createOpenAICompatibleAskSession,
  isOpenRouterUrl,
  openAIBaseUrlFromEnv,
  openAICompatibleProviderReady,
  resolveAskModel,
  resolveAskProviderKind,
  resolveProviderCapabilityProfile,
  type AskHistoryItem,
  type AskImage,
  type AskSession,
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
  };
};

export function createProviderRuntime(input: ProviderRuntimeInput): ProviderRuntime {
  const env = input.env ?? process.env;
  const providerKind = resolveAskProviderKind(env);
  const model = resolveAskModel(env);
  const openAIBaseUrl = openAIBaseUrlFromEnv(env);
  const profile = resolveProviderCapabilityProfile(env);
  let openRouterToolsSupportPromise: Promise<boolean | undefined> | undefined;

  function openAIApiKey(): string | null {
    return env.LOCAL_INFERENCE_API_KEY
      || env.OPENAI_API_KEY
      || env.GLM_API_KEY
      || env.ZHIPU_API_KEY
      || env.LMSTUDIO_API_KEY
      || env.LM_STUDIO_API_KEY
      || null;
  }

  return {
    providerKind,
    model,
    openAIBaseUrl,
    profile,
    createAskSession(sessionInput) {
      if (providerKind === 'openai') {
        return createOpenAICompatibleAskSession({
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
