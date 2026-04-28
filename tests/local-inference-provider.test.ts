import { describe, expect, it } from 'vitest';
import {
  resolveAskProviderKind,
  resolveAskModel,
  openAIBaseUrlFromEnv,
  anthropicBaseUrlFromEnv,
  openAICompatibleProviderReady,
} from '../src/lib/ask-provider.js';

describe('local inference provider resolution', () => {
  describe('resolveAskProviderKind', () => {
    it('maps local to openai provider kind', () => {
      expect(resolveAskProviderKind({ ACHIOTE_ASK_PROVIDER: 'local' })).toBe('openai');
    });

    it('maps lmstudio to openai provider kind', () => {
      expect(resolveAskProviderKind({ ACHIOTE_ASK_PROVIDER: 'lmstudio' })).toBe('openai');
    });

    it('maps glm to anthropic provider kind', () => {
      expect(resolveAskProviderKind({ ACHIOTE_ASK_PROVIDER: 'glm' })).toBe('anthropic');
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
  });

  describe('openAIBaseUrlFromEnv', () => {
    it('prioritizes LOCAL_INFERENCE_BASE_URL', () => {
      expect(
        openAIBaseUrlFromEnv({
          LOCAL_INFERENCE_BASE_URL: 'http://host.docker.internal:1234/v1',
          OPENAI_BASE_URL: 'https://api.openai.com/v1',
        }),
      ).toBe('http://host.docker.internal:1234/v1');
    });

    it('resolves Tailscale IP URLs', () => {
      expect(
        openAIBaseUrlFromEnv({
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

    it('defaults to openai.com for unset provider', () => {
      expect(openAIBaseUrlFromEnv({})).toBe('https://api.openai.com/v1');
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
});
