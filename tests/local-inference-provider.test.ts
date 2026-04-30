import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
  resolveAskProviderKind,
  resolveAskModel,
  openAIBaseUrlFromEnv,
  anthropicBaseUrlFromEnv,
  openAICompatibleProviderReady,
  resolveLocalInferenceEndpointStyle,
  resolveGlmEndpointStyle,
  resolveProviderCapabilityProfile,
} from '../src/lib/ask-provider.js';

describe('local inference provider resolution', () => {
  describe('resolveAskProviderKind', () => {
    it('maps local to openai provider kind', () => {
      expect(resolveAskProviderKind({ ACHIOTE_ASK_PROVIDER: 'local' })).toBe('openai');
    });

    it('maps local LM Studio Anthropic Messages style to anthropic provider kind', () => {
      expect(resolveAskProviderKind({
        ACHIOTE_ASK_PROVIDER: 'local',
        LOCAL_INFERENCE_ENDPOINT_STYLE: 'anthropic-messages',
      })).toBe('anthropic');
    });

    it('maps lmstudio to openai provider kind', () => {
      expect(resolveAskProviderKind({ ACHIOTE_ASK_PROVIDER: 'lmstudio' })).toBe('openai');
    });

    it('maps glm to anthropic provider kind', () => {
      expect(resolveAskProviderKind({ ACHIOTE_ASK_PROVIDER: 'glm' })).toBe('anthropic');
      expect(resolveAskProviderKind({ ACHIOTE_ASK_PROVIDER: 'glm', ACHIOTE_ASK_MODEL: 'GLM-4.5-Air' })).toBe('openai');
    });

    it('maps GLM Coding Plan OpenAI style to openai provider kind for endpoint experiments', () => {
      expect(resolveAskProviderKind({
        ACHIOTE_ASK_PROVIDER: 'glm',
        GLM_ENDPOINT_STYLE: 'openai-coding',
      })).toBe('openai');
    });

    it('defaults to anthropic when unset', () => {
      expect(resolveAskProviderKind({})).toBe('anthropic');
    });
  });

  describe('resolveAskModel', () => {
    it('prioritizes LOCAL_INFERENCE_MODEL for local provider', () => {
      expect(
        resolveAskModel({
          ACHIOTE_ASK_PROVIDER: 'local',
          LOCAL_INFERENCE_MODEL: 'llama-3.2-3b',
          ACHIOTE_ASK_MODEL: 'glm-5.1',
        }),
      ).toBe('llama-3.2-3b');
    });

    it('falls back to ACHIOTE_ASK_MODEL when LOCAL_INFERENCE_MODEL is unset', () => {
      expect(
        resolveAskModel({
          ACHIOTE_ASK_PROVIDER: 'local',
          ACHIOTE_ASK_MODEL: 'mistral-7b',
        }),
      ).toBe('mistral-7b');
    });

    it('uses GLM model when provider is glm', () => {
      expect(
        resolveAskModel({
          ACHIOTE_ASK_PROVIDER: 'glm',
          ACHIOTE_ASK_MODEL: 'glm-5.1',
          LOCAL_INFERENCE_MODEL: 'local-model',
        }),
      ).toBe('glm-5.1');
    });

    it('uses LOCAL_INFERENCE_MODEL when local provider is routed through Anthropic Messages style', () => {
      expect(
        resolveAskModel({
          ACHIOTE_ASK_PROVIDER: 'local',
          LOCAL_INFERENCE_ENDPOINT_STYLE: 'anthropic-messages',
          LOCAL_INFERENCE_MODEL: 'qwen3.6-35b-a3b',
        }),
      ).toBe('qwen3.6-35b-a3b');
    });
  });

  describe('openAIBaseUrlFromEnv', () => {
    it('prioritizes LOCAL_INFERENCE_BASE_URL when provider is local', () => {
      expect(
        openAIBaseUrlFromEnv({
          ACHIOTE_ASK_PROVIDER: 'local',
          LOCAL_INFERENCE_BASE_URL: 'http://host.docker.internal:1234/v1',
          OPENAI_BASE_URL: 'https://api.openai.com/v1',
        }),
      ).toBe('http://host.docker.internal:1234/v1');
    });

    it('does NOT use LOCAL_INFERENCE_BASE_URL when provider is openai', () => {
      expect(
        openAIBaseUrlFromEnv({
          ACHIOTE_ASK_PROVIDER: 'openai',
          LOCAL_INFERENCE_BASE_URL: 'http://host.docker.internal:1234/v1',
          OPENAI_BASE_URL: 'https://api.openai.com/v1',
        }),
      ).toBe('https://api.openai.com/v1');
    });

    it('resolves Tailscale IP URLs when provider is local', () => {
      expect(
        openAIBaseUrlFromEnv({
          ACHIOTE_ASK_PROVIDER: 'local',
          LOCAL_INFERENCE_BASE_URL: 'http://100.92.68.103:1234/v1',
        }),
      ).toBe('http://100.92.68.103:1234/v1');
    });

    it('falls back to LMSTUDIO_BASE_URL', () => {
      expect(
        openAIBaseUrlFromEnv({
          ACHIOTE_ASK_PROVIDER: 'lmstudio',
          LMSTUDIO_BASE_URL: 'http://127.0.0.1:1234/v1',
        }),
      ).toBe('http://127.0.0.1:1234/v1');
    });

    it('defaults to localhost for local provider', () => {
      expect(
        openAIBaseUrlFromEnv({
          ACHIOTE_ASK_PROVIDER: 'local',
        }),
      ).toBe('http://127.0.0.1:1234/v1');
    });

    it('normalizes local OpenAI-compatible style to a /v1 base URL', () => {
      expect(
        openAIBaseUrlFromEnv({
          ACHIOTE_ASK_PROVIDER: 'local',
          LOCAL_INFERENCE_BASE_URL: 'http://100.66.225.85:1234',
          LOCAL_INFERENCE_ENDPOINT_STYLE: 'openai-chat-completions',
        }),
      ).toBe('http://100.66.225.85:1234/v1');
    });

    it('defaults to openai.com for unset provider', () => {
      expect(openAIBaseUrlFromEnv({})).toBe('https://api.openai.com/v1');
    });

    it('defaults GLM OpenAI Coding Plan experiments to the dedicated coding endpoint', () => {
      expect(
        openAIBaseUrlFromEnv({
          ACHIOTE_ASK_PROVIDER: 'glm',
          GLM_ENDPOINT_STYLE: 'openai-coding',
        }),
      ).toBe('https://api.z.ai/api/coding/paas/v4');
    });
  });

  describe('anthropicBaseUrlFromEnv', () => {
    it('prioritizes GLM_BASE_URL for glm provider', () => {
      expect(
        anthropicBaseUrlFromEnv({
          ACHIOTE_ASK_PROVIDER: 'glm',
          GLM_BASE_URL: 'https://api.z.ai/api/anthropic',
        }),
      ).toBe('https://api.z.ai/api/anthropic');
    });

    it('normalizes local LM Studio Anthropic Messages style to the server root base URL', () => {
      expect(
        anthropicBaseUrlFromEnv({
          ACHIOTE_ASK_PROVIDER: 'local',
          LOCAL_INFERENCE_ENDPOINT_STYLE: 'anthropic-messages',
          LOCAL_INFERENCE_BASE_URL: 'http://100.66.225.85:1234/v1',
        }),
      ).toBe('http://100.66.225.85:1234');
    });

    it('does not provide an Anthropic base URL when GLM is forced to OpenAI Coding Plan style', () => {
      expect(
        anthropicBaseUrlFromEnv({
          ACHIOTE_ASK_PROVIDER: 'glm',
          GLM_ENDPOINT_STYLE: 'openai-coding',
          GLM_BASE_URL: 'https://api.z.ai/api/anthropic',
        }),
      ).toBeUndefined();
    });
  });

  describe('resolveLocalInferenceEndpointStyle', () => {
    it('tracks LM Studio endpoint families separately from the model', () => {
      expect(resolveLocalInferenceEndpointStyle({ ACHIOTE_ASK_PROVIDER: 'local' })).toBe('openai-chat-completions');
      expect(resolveLocalInferenceEndpointStyle({ ACHIOTE_ASK_PROVIDER: 'lmstudio', LMSTUDIO_ENDPOINT_STYLE: 'anthropic' })).toBe('anthropic-messages');
      expect(resolveLocalInferenceEndpointStyle({ ACHIOTE_ASK_PROVIDER: 'local', LOCAL_INFERENCE_ENDPOINT_STYLE: 'responses' })).toBe('openai-responses');
      expect(resolveLocalInferenceEndpointStyle({ ACHIOTE_ASK_PROVIDER: 'local', LOCAL_INFERENCE_ENDPOINT_STYLE: 'native-chat' })).toBe('native-chat');
      expect(resolveLocalInferenceEndpointStyle({ ACHIOTE_ASK_PROVIDER: 'openai' })).toBeUndefined();
    });
  });

  describe('resolveGlmEndpointStyle', () => {
    it('defaults newer Coding Plan models to Anthropic-compatible style while allowing old-model endpoint experiments', () => {
      expect(resolveGlmEndpointStyle({ ACHIOTE_ASK_PROVIDER: 'glm', ACHIOTE_ASK_MODEL: 'GLM-5.1' })).toBe('anthropic-coding');
      expect(resolveGlmEndpointStyle({ ACHIOTE_ASK_PROVIDER: 'glm', ACHIOTE_ASK_MODEL: 'GLM-4.7' })).toBe('anthropic-coding');
      expect(resolveGlmEndpointStyle({ ACHIOTE_ASK_PROVIDER: 'glm', ACHIOTE_ASK_MODEL: 'GLM-4.5-Air' })).toBe('openai-coding');
      expect(resolveGlmEndpointStyle({ ACHIOTE_ASK_PROVIDER: 'glm', ACHIOTE_ASK_MODEL: 'GLM-4.5-Air', GLM_ENDPOINT_STYLE: 'openai-coding' })).toBe('openai-coding');
      expect(resolveGlmEndpointStyle({ ACHIOTE_ASK_PROVIDER: 'glm', ACHIOTE_ASK_MODEL: 'GLM-4.5-Air', GLM_ENDPOINT_STYLE: 'anthropic-coding' })).toBe('anthropic-coding');
      expect(resolveGlmEndpointStyle({ ACHIOTE_ASK_PROVIDER: 'zhipu', ZHIPU_ENDPOINT_STYLE: 'openai' })).toBe('openai-coding');
    });
  });

  describe('resolveProviderCapabilityProfile', () => {
    it('keeps provider, model, endpoint style, and capability posture together for telemetry', () => {
      expect(resolveProviderCapabilityProfile({
        ACHIOTE_ASK_PROVIDER: 'local',
        LOCAL_INFERENCE_MODEL: 'lfm2-8b-a1b',
        LOCAL_INFERENCE_BASE_URL: 'http://100.66.225.85:1234',
      })).toMatchObject({
        provider: 'local',
        providerKind: 'openai',
        model: 'lfm2-8b-a1b',
        endpointStyle: 'openai-chat-completions',
        baseUrl: 'http://100.66.225.85:1234/v1',
        nativeTools: 'unknown',
      });

      expect(resolveProviderCapabilityProfile({
        ACHIOTE_ASK_PROVIDER: 'openai',
        OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
        OPENAI_MODEL: 'meta-llama/llama-3.3-8b-instruct:free',
      }, {
        data: [{ id: 'meta-llama/llama-3.3-8b-instruct:free', supported_parameters: ['max_tokens'] }],
      })).toMatchObject({
        provider: 'openrouter',
        nativeTools: 'unsupported',
        rateLimitSensitive: true,
        recommendedTimeoutMs: 240_000,
      });
    });
  });

  describe('openAICompatibleProviderReady', () => {
    it('accepts 127.0.0.1 without API key', () => {
      expect(openAICompatibleProviderReady('http://127.0.0.1:1234/v1')).toBe(true);
    });

    it('accepts localhost without API key', () => {
      expect(openAICompatibleProviderReady('http://localhost:1234/v1')).toBe(true);
    });

    it('accepts host.docker.internal without API key', () => {
      expect(openAICompatibleProviderReady('http://host.docker.internal:1234/v1')).toBe(true);
    });

    it('accepts Tailscale IPs (100.x.x.x) without API key', () => {
      expect(openAICompatibleProviderReady('http://100.92.68.103:1234/v1')).toBe(true);
    });

    it('rejects public URLs without API key', () => {
      expect(openAICompatibleProviderReady('https://api.openai.com/v1')).toBe(false);
    });

    it('accepts public URLs with API key', () => {
      expect(openAICompatibleProviderReady('https://api.openai.com/v1', 'sk-test-key')).toBe(true);
    });
  });

  describe('live ask smoke reporting', () => {
    it('reports the local inference model instead of falling back to stale cloud defaults', () => {
      const script = fs.readFileSync('scripts/live-ask-smoke.mjs', 'utf8');
      expect(script).toContain('process.env.LOCAL_INFERENCE_MODEL');
    });
  });
});
