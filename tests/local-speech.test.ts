import { describe, expect, it } from 'vitest';
import {
  expandCommandTemplate,
  resolveLocalSpeechConfig,
  validateSpeechAudioPayload,
  validateSpeechTextPayload,
} from '../src/lib/local-speech.js';

describe('local speech runtime config', () => {
  it('keeps speech disabled by default', () => {
    const config = resolveLocalSpeechConfig({});
    expect(config.stt).toMatchObject({ provider: 'disabled', ready: false, reason: 'speech-to-text is disabled' });
    expect(config.tts).toMatchObject({ provider: 'disabled', ready: false, reason: 'text-to-speech is disabled' });
  });

  it('requires a local whisper.cpp model before reporting STT ready', () => {
    const missingModel = resolveLocalSpeechConfig({ ACHIOTE_STT_PROVIDER: 'whispercpp' });
    expect(missingModel.stt).toMatchObject({
      provider: 'whispercpp',
      ready: false,
      reason: 'ACHIOTE_WHISPER_CPP_MODEL is required',
    });

    const ready = resolveLocalSpeechConfig({
      ACHIOTE_STT_PROVIDER: 'whispercpp',
      ACHIOTE_WHISPER_CPP_MODEL: '/models/ggml-base.en.bin',
    });
    expect(ready.stt).toMatchObject({
      provider: 'whispercpp',
      ready: true,
      binary: 'whisper-cli',
      model: '/models/ggml-base.en.bin',
      language: 'auto',
      languages: ['auto'],
    });
  });

  it('keeps multilingual and accent-heavy STT as an explicit auto-detect contract', () => {
    const ready = resolveLocalSpeechConfig({
      ACHIOTE_STT_PROVIDER: 'whispercpp',
      ACHIOTE_WHISPER_CPP_MODEL: '/models/ggml-large-v3-turbo.bin',
      ACHIOTE_STT_LANGUAGE: 'auto',
      ACHIOTE_STT_LANGUAGES: 'auto,es,hi,zh,ar,fr,pt,tl',
    });

    expect(ready.stt).toMatchObject({
      provider: 'whispercpp',
      ready: true,
      language: 'auto',
      languages: ['auto', 'es', 'hi', 'zh', 'ar', 'fr', 'pt', 'tl'],
    });
  });

  it('requires a Kokoro argv template with text and output placeholders before reporting TTS ready', () => {
    const missingCommand = resolveLocalSpeechConfig({ ACHIOTE_TTS_PROVIDER: 'kokoro' });
    expect(missingCommand.tts).toMatchObject({
      provider: 'kokoro',
      ready: false,
      reason: 'ACHIOTE_KOKORO_COMMAND is required',
    });

    const missingOutput = resolveLocalSpeechConfig({
      ACHIOTE_TTS_PROVIDER: 'kokoro',
      ACHIOTE_KOKORO_COMMAND: JSON.stringify(['python', 'kokoro_tts.py', '--text', '{text}']),
    });
    expect(missingOutput.tts.ready).toBe(false);
    expect(missingOutput.tts.reason).toContain('{output}');

    const ready = resolveLocalSpeechConfig({
      ACHIOTE_TTS_PROVIDER: 'kokoro',
      ACHIOTE_KOKORO_COMMAND: JSON.stringify(['python', 'kokoro_tts.py', '--text', '{text}', '--output', '{output}']),
    });
    expect(ready.tts).toMatchObject({
      provider: 'kokoro',
      ready: true,
      command: ['python', 'kokoro_tts.py', '--text', '{text}', '--output', '{output}'],
      mediaType: 'audio/wav',
    });
  });

  it('expands command templates without invoking a shell', () => {
    expect(expandCommandTemplate(
      ['python', 'tts.py', '--text={text}', '--out', '{output}', '--voice', '{voice}'],
      { text: 'grandma soup; rm -rf /', output: '/tmp/out.wav', voice: 'af_heart' },
    )).toEqual([
      'python',
      'tts.py',
      '--text=grandma soup; rm -rf /',
      '--out',
      '/tmp/out.wav',
      '--voice',
      'af_heart',
    ]);

    expect(() => expandCommandTemplate(['cmd', '{missing}'], { text: 'x', output: 'y' })).toThrow('Unresolved command placeholder');
  });
});

describe('local speech payload guards', () => {
  it('accepts bounded open audio media types', () => {
    expect(validateSpeechAudioPayload({
      audioBase64: Buffer.from('tiny wav').toString('base64'),
      mediaType: 'audio/wav',
      language: 'es',
    })).toMatchObject({ ok: true, language: 'es' });

    expect(validateSpeechAudioPayload({
      audioBase64: Buffer.from('tiny webm').toString('base64'),
      mediaType: 'audio/webm',
    })).toMatchObject({ ok: true });
  });

  it('rejects missing, unsupported, or oversized audio payloads', () => {
    expect(validateSpeechAudioPayload({ mediaType: 'audio/wav' }).error).toContain('audioBase64');
    expect(validateSpeechAudioPayload({ audioBase64: 'abcd', mediaType: 'video/mp4' }).error).toContain('Unsupported audio media type');
    expect(validateSpeechAudioPayload({
      audioBase64: 'A'.repeat(12_000_001),
      mediaType: 'audio/wav',
    }).error).toContain('too large');
  });

  it('keeps TTS text bounded', () => {
    expect(validateSpeechTextPayload({ text: 'Read this nostalgia cue.' })).toEqual({ ok: true, text: 'Read this nostalgia cue.' });
    expect(validateSpeechTextPayload({ text: '   ' }).error).toContain('text is required');
    expect(validateSpeechTextPayload({ text: 'x'.repeat(5_001) }).error).toContain('too long');
  });
});
