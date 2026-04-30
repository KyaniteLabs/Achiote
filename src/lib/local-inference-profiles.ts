export type LocalInferenceProfileName = 'speed' | 'quality' | 'memory';

export interface LocalInferenceProfile {
  contextLength: number;
  evalBatchSize: number;
  parallel: number;
  flashAttention: boolean;
  offloadKvCacheToGpu: boolean;
  numExperts?: number;
  advanced: LocalInferenceAdvancedKnobs;
}

export interface LocalInferenceAdvancedKnobs {
  keepModelInMemory: boolean;
  useFp16ForKVCache: boolean;
  llamaKCacheQuantizationType: string;
  llamaVCacheQuantizationType: string;
  cpuThreads: 'all' | number;
  gpuOffload: 'max' | 'balanced' | 'minimal';
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
  ].join(' | ');
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
