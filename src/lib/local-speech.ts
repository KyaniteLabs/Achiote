export type SpeechProvider = 'disabled' | 'whispercpp' | 'kokoro';

export type LocalSttConfig = {
  provider: 'disabled' | 'whispercpp';
  ready: boolean;
  reason?: string;
  binary?: string;
  model?: string;
  language?: string;
  languages: string[];
};

export type LocalTtsVoice = {
  id: string;
  label: string;
  language?: string;
};

export type LocalTtsConfig = {
  provider: 'disabled' | 'kokoro';
  ready: boolean;
  reason?: string;
  command?: string[];
  mediaType: string;
  voices: LocalTtsVoice[];
  defaultVoice?: string;
};

export type LocalSpeechConfig = {
  stt: LocalSttConfig;
  tts: LocalTtsConfig;
};

type Env = Record<string, string | undefined>;

const DEFAULT_STT_LANGUAGES = ['auto'];
const DEFAULT_TTS_MEDIA_TYPE = 'audio/wav';
const MAX_SPEECH_AUDIO_BASE64_CHARS = 12_000_000;
const MAX_SPEECH_TEXT_CHARS = 5_000;
const ALLOWED_SPEECH_AUDIO_MEDIA_TYPES = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
]);

function parseCsv(value: string | undefined, fallback: string[]): string[] {
  const values = value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return values && values.length > 0 ? [...new Set(values)] : fallback;
}

function parseJsonStringArray(value: string | undefined): string[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string' && item.trim())) return null;
    return parsed.map((item) => item.trim());
  } catch {
    return null;
  }
}

function parseVoices(value: string | undefined): LocalTtsVoice[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => ({
        id: typeof item.id === 'string' ? item.id.trim() : '',
        label: typeof item.label === 'string' ? item.label.trim() : '',
        language: typeof item.language === 'string' ? item.language.trim() : undefined,
      }))
      .filter((voice) => voice.id && voice.label);
  } catch {
    return [];
  }
}

function resolveWhisperConfig(env: Env): LocalSttConfig {
  const model = env.ACHIOTE_WHISPER_CPP_MODEL?.trim();
  const binary = env.ACHIOTE_WHISPER_CPP_BINARY?.trim() || 'whisper-cli';
  const language = env.ACHIOTE_STT_LANGUAGE?.trim() || 'auto';
  const languages = parseCsv(env.ACHIOTE_STT_LANGUAGES, DEFAULT_STT_LANGUAGES);

  if (!model) {
    return {
      provider: 'whispercpp',
      ready: false,
      reason: 'ACHIOTE_WHISPER_CPP_MODEL is required',
      binary,
      language,
      languages,
    };
  }

  return {
    provider: 'whispercpp',
    ready: true,
    binary,
    model,
    language,
    languages,
  };
}

function resolveKokoroConfig(env: Env): LocalTtsConfig {
  const command = parseJsonStringArray(env.ACHIOTE_KOKORO_COMMAND);
  const voices = parseVoices(env.ACHIOTE_KOKORO_VOICES);
  const defaultVoice = env.ACHIOTE_KOKORO_VOICE?.trim() || voices[0]?.id;
  const mediaType = env.ACHIOTE_TTS_MEDIA_TYPE?.trim() || DEFAULT_TTS_MEDIA_TYPE;

  if (!env.ACHIOTE_KOKORO_COMMAND?.trim()) {
    return {
      provider: 'kokoro',
      ready: false,
      reason: 'ACHIOTE_KOKORO_COMMAND is required',
      mediaType,
      voices,
      defaultVoice,
    };
  }

  if (!command) {
    return {
      provider: 'kokoro',
      ready: false,
      reason: 'ACHIOTE_KOKORO_COMMAND must be a JSON string array',
      mediaType,
      voices,
      defaultVoice,
    };
  }

  const joined = command.join('\u0000');
  if (!joined.includes('{text}')) {
    return {
      provider: 'kokoro',
      ready: false,
      reason: 'ACHIOTE_KOKORO_COMMAND must include a {text} placeholder',
      command,
      mediaType,
      voices,
      defaultVoice,
    };
  }
  if (!joined.includes('{output}')) {
    return {
      provider: 'kokoro',
      ready: false,
      reason: 'ACHIOTE_KOKORO_COMMAND must include an {output} placeholder',
      command,
      mediaType,
      voices,
      defaultVoice,
    };
  }

  return {
    provider: 'kokoro',
    ready: true,
    command,
    mediaType,
    voices,
    defaultVoice,
  };
}

export function resolveLocalSpeechConfig(env: Env = process.env): LocalSpeechConfig {
  const sttProvider = env.ACHIOTE_STT_PROVIDER?.trim().toLowerCase();
  const ttsProvider = env.ACHIOTE_TTS_PROVIDER?.trim().toLowerCase();

  return {
    stt: sttProvider === 'whispercpp'
      ? resolveWhisperConfig(env)
      : {
        provider: 'disabled',
        ready: false,
        reason: 'speech-to-text is disabled',
        language: 'auto',
        languages: DEFAULT_STT_LANGUAGES,
      },
    tts: ttsProvider === 'kokoro'
      ? resolveKokoroConfig(env)
      : {
        provider: 'disabled',
        ready: false,
        reason: 'text-to-speech is disabled',
        mediaType: DEFAULT_TTS_MEDIA_TYPE,
        voices: [],
      },
  };
}

export function expandCommandTemplate(template: string[], values: Record<string, string | undefined>): string[] {
  const expanded = template.map((part) => part.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => {
    const value = values[key];
    if (value === undefined) return match;
    return value;
  }));

  const unresolved = expanded.find((part) => /\{[a-zA-Z0-9_]+\}/.test(part));
  if (unresolved) throw new Error(`Unresolved command placeholder in argument: ${unresolved}`);
  return expanded;
}

export function validateSpeechAudioPayload(raw: unknown): { ok: true; audioBase64: string; mediaType: string; language?: string } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'JSON object body is required' };
  const body = raw as Record<string, unknown>;
  if (typeof body.audioBase64 !== 'string' || body.audioBase64.trim().length === 0) {
    return { ok: false, error: 'audioBase64 is required' };
  }
  if (body.audioBase64.length > MAX_SPEECH_AUDIO_BASE64_CHARS) {
    return { ok: false, error: 'audioBase64 is too large' };
  }
  if (typeof body.mediaType !== 'string' || !ALLOWED_SPEECH_AUDIO_MEDIA_TYPES.has(body.mediaType)) {
    return { ok: false, error: `Unsupported audio media type: ${String(body.mediaType || 'missing')}` };
  }
  if (!/^[A-Za-z0-9+/=\s]+$/.test(body.audioBase64)) {
    return { ok: false, error: 'audioBase64 must contain base64 audio data' };
  }
  return {
    ok: true,
    audioBase64: body.audioBase64.replace(/\s/g, ''),
    mediaType: body.mediaType,
    language: typeof body.language === 'string' && body.language.trim() ? body.language.trim() : undefined,
  };
}

export function validateSpeechTextPayload(raw: unknown): { ok: true; text: string; voice?: string; language?: string } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'JSON object body is required' };
  const body = raw as Record<string, unknown>;
  if (typeof body.text !== 'string' || body.text.trim().length === 0) return { ok: false, error: 'text is required' };
  const text = body.text.trim();
  if (text.length > MAX_SPEECH_TEXT_CHARS) return { ok: false, error: 'text is too long' };
  return {
    ok: true,
    text,
    voice: typeof body.voice === 'string' && body.voice.trim() ? body.voice.trim() : undefined,
    language: typeof body.language === 'string' && body.language.trim() ? body.language.trim() : undefined,
  };
}
