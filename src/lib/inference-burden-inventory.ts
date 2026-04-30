import inferenceBurdenInventoryData from '../data/inference-burden-inventory.json' with { type: 'json' };

export type InferenceBurdenType =
  | 'normalization'
  | 'intent_routing'
  | 'context_packing'
  | 'reference_retrieval'
  | 'workflow_control'
  | 'evidence_bookkeeping'
  | 'safety_policy'
  | 'output_contract'
  | 'quality_evaluation'
  | 'sensory_mechanism'
  | 'availability_substitution'
  | 'privacy_consent';

export type InferenceBurdenStatus = 'candidate' | 'partially_supported' | 'ready_to_extract';

export type DeterministicOwner =
  | 'data'
  | 'retrieval'
  | 'controller'
  | 'validator'
  | 'formatter'
  | 'observability'
  | 'consent_gate';

export interface InferenceBurden {
  id: string;
  burdenType: InferenceBurdenType;
  title: string;
  currentSurfaceRefs: string[];
  currentModelBurden: string;
  dataEngineeringMove: string;
  deterministicOwner: DeterministicOwner;
  leverage: number;
  rigidityRisk: number;
  candidateArtifacts: string[];
  promptRemovalTargets: string[];
  acceptanceSignals: string[];
  preserveLatitude: string[];
  modelKeeps: string[];
  riskIfOverRigid: string;
  status: InferenceBurdenStatus;
}

export interface InferenceBurdenSummary {
  total: number;
  highLeverageCount: number;
  byBurdenType: Record<InferenceBurdenType, number>;
  byOwner: Record<DeterministicOwner, number>;
  promptRemovalTargets: string[];
  candidateArtifacts: string[];
}

export interface PromptOffloadCandidateOptions {
  minLeverage?: number;
  maxRigidityRisk?: number;
  burdenType?: InferenceBurdenType;
}

const inventory = inferenceBurdenInventoryData as {
  burdens: InferenceBurden[];
  burdenTypes: InferenceBurdenType[];
  deterministicOwners: DeterministicOwner[];
};

export function listInferenceBurdens(): InferenceBurden[] {
  return inventory.burdens.map((burden) => ({
    ...burden,
    currentSurfaceRefs: [...burden.currentSurfaceRefs],
    candidateArtifacts: [...burden.candidateArtifacts],
    promptRemovalTargets: [...burden.promptRemovalTargets],
    acceptanceSignals: [...burden.acceptanceSignals],
    preserveLatitude: [...burden.preserveLatitude],
    modelKeeps: [...burden.modelKeeps],
  }));
}

export function buildInferenceBurdenSummary(): InferenceBurdenSummary {
  const burdens = listInferenceBurdens();
  const byBurdenType = Object.fromEntries(inventory.burdenTypes.map((type) => [type, 0])) as Record<InferenceBurdenType, number>;
  const byOwner = Object.fromEntries(inventory.deterministicOwners.map((owner) => [owner, 0])) as Record<DeterministicOwner, number>;
  const promptRemovalTargets = new Set<string>();
  const candidateArtifacts = new Set<string>();

  for (const burden of burdens) {
    byBurdenType[burden.burdenType] = (byBurdenType[burden.burdenType] ?? 0) + 1;
    byOwner[burden.deterministicOwner] = (byOwner[burden.deterministicOwner] ?? 0) + 1;
    burden.promptRemovalTargets.forEach((target) => promptRemovalTargets.add(target));
    burden.candidateArtifacts.forEach((artifact) => candidateArtifacts.add(artifact));
  }

  return {
    total: burdens.length,
    highLeverageCount: burdens.filter((burden) => burden.leverage >= 4).length,
    byBurdenType,
    byOwner,
    promptRemovalTargets: [...promptRemovalTargets].sort(),
    candidateArtifacts: [...candidateArtifacts].sort(),
  };
}

export function findPromptOffloadCandidates(options: PromptOffloadCandidateOptions = {}): InferenceBurden[] {
  const minLeverage = options.minLeverage ?? 4;
  const maxRigidityRisk = options.maxRigidityRisk ?? 5;
  return listInferenceBurdens()
    .filter((burden) => burden.leverage >= minLeverage)
    .filter((burden) => burden.rigidityRisk <= maxRigidityRisk)
    .filter((burden) => options.burdenType === undefined || burden.burdenType === options.burdenType)
    .sort((left, right) => {
      const leverage = right.leverage - left.leverage;
      if (leverage !== 0) return leverage;
      const rigidity = left.rigidityRisk - right.rigidityRisk;
      if (rigidity !== 0) return rigidity;
      return left.id.localeCompare(right.id);
    });
}
