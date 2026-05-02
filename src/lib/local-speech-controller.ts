import {
  synthesizeWithLocalSpeech,
  transcribeWithLocalSpeech,
  validateSpeechAudioPayload,
  validateSpeechTextPayload,
  type LocalSpeechConfig,
} from './local-speech.js';

export type SpeechControllerResponse =
  | { status: 200; body: unknown }
  | { status: 400 | 502 | 503; body: { error: string } };

export function createLocalSpeechController(config: LocalSpeechConfig) {
  return {
    status() {
      return config;
    },
    async transcribe(input: unknown): Promise<SpeechControllerResponse> {
      const payload = validateSpeechAudioPayload(input);
      if (!payload.ok) return { status: 400, body: { error: payload.error } };
      if (!config.stt.ready) return { status: 503, body: { error: config.stt.reason || 'speech-to-text is not ready' } };
      try {
        return { status: 200, body: await transcribeWithLocalSpeech(config, payload) };
      } catch (err) {
        return { status: 502, body: { error: err instanceof Error ? err.message : 'Local transcription failed' } };
      }
    },
    async synthesize(input: unknown): Promise<SpeechControllerResponse> {
      const payload = validateSpeechTextPayload(input);
      if (!payload.ok) return { status: 400, body: { error: payload.error } };
      if (!config.tts.ready) return { status: 503, body: { error: config.tts.reason || 'text-to-speech is not ready' } };
      try {
        return { status: 200, body: await synthesizeWithLocalSpeech(config, payload) };
      } catch (err) {
        return { status: 502, body: { error: err instanceof Error ? err.message : 'Local speech synthesis failed' } };
      }
    },
  };
}
