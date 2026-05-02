import { chmodSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLocalSpeechController } from '../src/lib/local-speech-controller.js';
import type { LocalSpeechConfig } from '../src/lib/local-speech.js';

function disabledConfig(): LocalSpeechConfig {
  return {
    stt: { provider: 'disabled', ready: false, reason: 'speech-to-text is disabled', languages: ['auto'] },
    tts: { provider: 'disabled', ready: false, reason: 'text-to-speech is disabled', mediaType: 'audio/wav', voices: [] },
  };
}

describe('LocalSpeechController', () => {
  it('reports readiness and validates payloads before local engine execution', async () => {
    const controller = createLocalSpeechController(disabledConfig());

    expect(controller.status().stt.ready).toBe(false);
    await expect(controller.transcribe({ mediaType: 'audio/wav' })).resolves.toMatchObject({
      status: 400,
      body: { error: expect.stringContaining('audioBase64') },
    });
    await expect(controller.synthesize({ text: 'hello' })).resolves.toMatchObject({
      status: 503,
      body: { error: 'text-to-speech is disabled' },
    });
  });

  it('runs fake local engines through argv arrays and shapes successful responses', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'achiote-speech-controller-'));
    try {
      const whisper = join(dir, 'whisper-cli');
      const kokoro = join(dir, 'kokoro');
      writeFileSync(whisper, [
        '#!/bin/sh',
        'output=""',
        'while [ "$#" -gt 0 ]; do',
        '  case "$1" in -of) shift; output="$1" ;; esac',
        '  shift',
        'done',
        'printf "controller transcript" > "$output.txt"',
      ].join('\n'));
      writeFileSync(kokoro, [
        '#!/bin/sh',
        'output=""',
        'while [ "$#" -gt 0 ]; do',
        '  case "$1" in --output) shift; output="$1" ;; esac',
        '  shift',
        'done',
        'printf "fake wav" > "$output"',
      ].join('\n'));
      chmodSync(whisper, 0o755);
      chmodSync(kokoro, 0o755);

      const controller = createLocalSpeechController({
        stt: { provider: 'whispercpp', ready: true, binary: whisper, model: join(dir, 'model.bin'), language: 'auto', languages: ['auto'] },
        tts: { provider: 'kokoro', ready: true, command: [kokoro, '--text', '{text}', '--output', '{output}'], mediaType: 'audio/wav', voices: [] },
      });

      await expect(controller.transcribe({
        audioBase64: Buffer.from('wav').toString('base64'),
        mediaType: 'audio/wav',
        language: 'auto',
      })).resolves.toMatchObject({
        status: 200,
        body: { text: 'controller transcript', language: 'auto', provider: 'whispercpp' },
      });
      await expect(controller.synthesize({ text: 'read this' })).resolves.toMatchObject({
        status: 200,
        body: { audioBase64: Buffer.from('fake wav').toString('base64'), mediaType: 'audio/wav', provider: 'kokoro' },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns command failures as local speech gateway errors', async () => {
    const controller = createLocalSpeechController({
      ...disabledConfig(),
      tts: { provider: 'kokoro', ready: true, command: ['/definitely/missing/kokoro', '--output', '{output}', '--text', '{text}'], mediaType: 'audio/wav', voices: [] },
    });

    await expect(controller.synthesize({ text: 'read this' })).resolves.toMatchObject({
      status: 502,
      body: { error: expect.stringMatching(/spawn|Binary path rejected/) },
    });
  });
});
