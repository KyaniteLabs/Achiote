import { describe, expect, it } from 'vitest';
import inferenceBurdenInventoryData from '../src/data/inference-burden-inventory.json' with { type: 'json' };
import {
  buildInferenceBurdenSummary,
  findPromptOffloadCandidates,
  listInferenceBurdens,
  type InferenceBurdenType,
} from '../src/lib/inference-burden-inventory.js';

const REQUIRED_BURDEN_TYPES: InferenceBurdenType[] = [
  'normalization',
  'intent_routing',
  'context_packing',
  'reference_retrieval',
  'workflow_control',
  'evidence_bookkeeping',
  'safety_policy',
  'output_contract',
  'quality_evaluation',
  'sensory_mechanism',
  'availability_substitution',
  'privacy_consent',
];

describe('inference burden inventory', () => {
  it('covers every major burden class that should not live only in the prompt', () => {
    const summary = buildInferenceBurdenSummary();

    for (const burdenType of REQUIRED_BURDEN_TYPES) {
      expect(summary.byBurdenType[burdenType], `${burdenType} coverage`).toBeGreaterThanOrEqual(1);
    }
    expect(summary.total).toBeGreaterThanOrEqual(16);
    expect(summary.highLeverageCount).toBeGreaterThanOrEqual(8);
    expect(summary.promptRemovalTargets).toContain('/ask system prompt');
    expect(summary.promptRemovalTargets).toContain('tool promptForAgent fields');
  });

  it('keeps smart-model latitude explicit instead of turning reconstruction into a rigid script', () => {
    for (const burden of listInferenceBurdens()) {
      expect(burden.preserveLatitude.length, burden.id).toBeGreaterThanOrEqual(2);
      expect(burden.riskIfOverRigid.length, burden.id).toBeGreaterThan(20);
      expect(burden.modelKeeps.length, burden.id).toBeGreaterThanOrEqual(1);
      expect(burden.modelKeeps.join(' '), burden.id).toMatch(/reason|synthesi|interpret|rank|explain|creative|ambigu/i);
    }
  });

  it('can select prompt-offload candidates without raw memories, provider details, or browsing claims', () => {
    const candidates = findPromptOffloadCandidates({ minLeverage: 4, maxRigidityRisk: 3 });
    expect(candidates.length).toBeGreaterThanOrEqual(5);
    expect(candidates[0].leverage).toBeGreaterThanOrEqual(candidates.at(-1)!.leverage);

    const serialized = JSON.stringify(candidates).toLowerCase();
    for (const forbidden of [
      'api_key',
      'password',
      'bearer ',
      'raw prompt',
      'provider diagnostics',
      'achiote browses',
      'live inventory',
      'medical advice',
      'legal advice',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('stores the committed inventory as source-controlled data, not an ephemeral cache warmup', () => {
    expect(inferenceBurdenInventoryData.meta.description).toContain('inference burden');
    expect(inferenceBurdenInventoryData.burdens.length).toBeGreaterThanOrEqual(16);
    expect(inferenceBurdenInventoryData.burdens.every((burden) => burden.status !== 'cache_only')).toBe(true);
  });
});
