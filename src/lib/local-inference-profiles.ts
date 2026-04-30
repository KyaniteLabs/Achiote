export type LocalInferenceProfileName = 'speed' | 'quality' | 'memory';
export type LmStudioInferenceEndpointStyleName =
  | 'openai-chat-completions'
  | 'openai-responses'
  | 'openai-completions'
  | 'anthropic-messages'
  | 'native-chat';

export interface LocalInferenceProfile {
  contextLength: number;
  evalBatchSize: number;
  parallel: number;
  flashAttention: boolean;
  offloadKvCacheToGpu: boolean;
  numExperts?: number;
  advanced: LocalInferenceAdvancedKnobs;
}

export interface LocalInferenceProfileApplicationSummary {
  appliedByRest: string[];
  requiresSdkOrCli: string[];
}

export interface LocalInferenceAdvancedKnobs {
  keepModelInMemory: boolean;
  useFp16ForKVCache: boolean;
  llamaKCacheQuantizationType: string;
  llamaVCacheQuantizationType: string;
  cpuThreads: 'all' | number;
  gpuOffload: 'max' | 'balanced' | 'minimal';
}

export interface LmStudioInferenceEndpointStyle {
  protocol: 'openai-compatible' | 'anthropic-compatible' | 'lmstudio-native';
  path: string;
  runtimeSupportedByAchiote: boolean;
  note: string;
}

export type LocalInferenceProfileOverrides = Partial<Omit<LocalInferenceProfile, 'advanced'>> & {
  advanced?: Partial<LocalInferenceAdvancedKnobs>;
};

export interface LmStudioLoadPayload {
  model: string;
  context_length: number;
  eval_batch_size: number;
  parallel: number;
  flash_attention: boolean;
  offload_kv_cache_to_gpu: boolean;
  num_experts?: number;
  echo_load_config: true;
}

export const localInferenceProfiles: Record<LocalInferenceProfileName, LocalInferenceProfile> = {
  speed: {
    contextLength: 8192,
    evalBatchSize: 1024,
    parallel: 1,
    flashAttention: true,
    offloadKvCacheToGpu: true,
    numExperts: 4,
    advanced: {
      keepModelInMemory: true,
      useFp16ForKVCache: true,
      llamaKCacheQuantizationType: 'q8_0',
      llamaVCacheQuantizationType: 'q8_0',
      cpuThreads: 'all',
      gpuOffload: 'max',
    },
  },
  quality: {
    contextLength: 16384,
    evalBatchSize: 512,
    parallel: 1,
    flashAttention: true,
    offloadKvCacheToGpu: true,
    numExperts: 4,
    advanced: {
      keepModelInMemory: true,
      useFp16ForKVCache: true,
      llamaKCacheQuantizationType: 'q8_0',
      llamaVCacheQuantizationType: 'q8_0',
      cpuThreads: 'all',
      gpuOffload: 'max',
    },
  },
  memory: {
    contextLength: 4096,
    evalBatchSize: 256,
    parallel: 1,
    flashAttention: true,
    offloadKvCacheToGpu: false,
    advanced: {
      keepModelInMemory: false,
      useFp16ForKVCache: true,
      llamaKCacheQuantizationType: 'q4_0',
      llamaVCacheQuantizationType: 'q4_0',
      cpuThreads: 'all',
      gpuOffload: 'balanced',
    },
  },
};

export const lmStudioInferenceEndpointStyles: Record<LmStudioInferenceEndpointStyleName, LmStudioInferenceEndpointStyle> = {
  'openai-chat-completions': {
    protocol: 'openai-compatible',
    path: '/v1/chat/completions',
    runtimeSupportedByAchiote: true,
    note: 'Default Achiote local/lmstudio route; supports OpenAI-compatible tool-call experiments.',
  },
  'openai-responses': {
    protocol: 'openai-compatible',
    path: '/v1/responses',
    runtimeSupportedByAchiote: false,
    note: 'Useful for profiling newer LM Studio Responses behavior; Achiote does not yet have a Responses adapter.',
  },
  'openai-completions': {
    protocol: 'openai-compatible',
    path: '/v1/completions',
    runtimeSupportedByAchiote: false,
    note: 'Legacy text-completion surface; keep as a diagnostic baseline, not the Achiote workflow path.',
  },
  'anthropic-messages': {
    protocol: 'anthropic-compatible',
    path: '/v1/messages',
    runtimeSupportedByAchiote: true,
    note: 'Claude-style Messages route for LM Studio; configure Achiote with local/lmstudio plus anthropic-messages endpoint style.',
  },
  'native-chat': {
    protocol: 'lmstudio-native',
    path: '/api/v1/chat',
    runtimeSupportedByAchiote: false,
    note: 'Stateful LM Studio native chat endpoint; profiler/diagnostic route until Achiote has a native adapter.',
  },
};

export function buildLmStudioLoadPayload(
  model: string,
  profileName: LocalInferenceProfileName,
  overrides: LocalInferenceProfileOverrides = {},
): LmStudioLoadPayload {
  const profile = resolveLoadProfile(profileName, overrides);
  const payload: LmStudioLoadPayload = {
    model,
    context_length: profile.contextLength,
    eval_batch_size: profile.evalBatchSize,
    parallel: profile.parallel,
    flash_attention: profile.flashAttention,
    offload_kv_cache_to_gpu: profile.offloadKvCacheToGpu,
    echo_load_config: true,
  };

  if (isMixtureOfExpertsModel(model) && profile.numExperts !== undefined) {
    payload.num_experts = profile.numExperts;
  }

  return payload;
}

export function summarizeLoadProfile(profileName: LocalInferenceProfileName): string {
  const profile = localInferenceProfiles[profileName];
  const application = profileApplicationSummary(profileName);
  const kvType = profile.advanced.llamaKCacheQuantizationType === profile.advanced.llamaVCacheQuantizationType
    ? profile.advanced.llamaKCacheQuantizationType
    : `${profile.advanced.llamaKCacheQuantizationType}/${profile.advanced.llamaVCacheQuantizationType}`;
  const kvLocation = profile.offloadKvCacheToGpu ? 'GPU KV' : 'CPU KV';
  const flash = profile.flashAttention ? 'Flash Attention' : 'Flash Attention off';
  const keepWarm = profile.advanced.keepModelInMemory ? 'keep-warm' : 'unloadable';

  return [
    `${profileName}: ctx ${profile.contextLength}`,
    `eval batch ${profile.evalBatchSize}`,
    `parallel ${profile.parallel}`,
    flash,
    kvLocation,
    `KV ${kvType}`,
    `threads ${profile.advanced.cpuThreads}`,
    `offload ${profile.advanced.gpuOffload}`,
    keepWarm,
    `REST applies ${application.appliedByRest.join(',')}`,
    `SDK/CLI required ${application.requiresSdkOrCli.join(',')}`,
  ].join(' | ');
}

export function profileApplicationSummary(profileName: LocalInferenceProfileName): LocalInferenceProfileApplicationSummary {
  const profile = localInferenceProfiles[profileName];
  const appliedByRest = [
    'context_length',
    'eval_batch_size',
    'parallel',
    'flash_attention',
    'offload_kv_cache_to_gpu',
  ];
  if (profile.numExperts !== undefined) appliedByRest.push('num_experts');

  return {
    appliedByRest,
    requiresSdkOrCli: [
      'cpu_threads',
      'llama_k_cache_quantization_type',
      'llama_v_cache_quantization_type',
      'keep_model_in_memory',
      'gpu_offload_policy',
    ],
  };
}

export function resolveLoadProfile(
  profileName: LocalInferenceProfileName,
  overrides: LocalInferenceProfileOverrides = {},
): LocalInferenceProfile {
  const base = localInferenceProfiles[profileName];
  return {
    ...base,
    ...overrides,
    advanced: {
      ...base.advanced,
      ...overrides.advanced,
    },
  };
}

export function isLocalInferenceProfileName(value: string): value is LocalInferenceProfileName {
  return value === 'speed' || value === 'quality' || value === 'memory';
}

function isMixtureOfExpertsModel(model: string): boolean {
  return /\b(?:moe|a\d+b|a\d+\.\d+b)\b/i.test(model) || /-\d+b-a\d+b/i.test(model);
}
