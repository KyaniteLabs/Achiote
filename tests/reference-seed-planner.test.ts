import { describe, expect, it } from 'vitest';
import referenceSeedQueueData from '../src/data/reference-seed-queue.json' with { type: 'json' };
import {
  bundledGlobalReferenceSeeds,
  prioritizeReferenceSeeds,
} from '../src/lib/reference-seed-planner.js';
import type { QualitySignalReport } from '../src/lib/quality-signals.js';

function emptyReport(): QualitySignalReport {
  return {
    total: 0,
    byMemoryType: {},
    byFamily: {},
    byRegion: {},
    byGuard: {},
    bySearch: {},
    byCache: {},
    missing: {},
  };
}

describe('reference seed planner', () => {
  it('exposes the validated global reference data bundle to the compiled package', () => {
    expect(bundledGlobalReferenceSeeds.globalCoverageMatrix).toBeTruthy();
    expect(bundledGlobalReferenceSeeds.referenceSeedQueue.seeds).toHaveLength(referenceSeedQueueData.seeds.length);
    expect(bundledGlobalReferenceSeeds.cacheWarmingManifest.tasks).toHaveLength(referenceSeedQueueData.seeds.length);
  });

  it('prioritizes beverage and missing-region seeds from private aggregate quality signals', () => {
    const report = emptyReport();
    report.total = 8;
    report.byMemoryType = { beverage: 5, sauce_broth: 2 };
    report.byFamily = { unknown: 6 };
    report.byGuard = { explicit_minimum_cue_fallback: 3 };
    report.byCache = { unavailable: 8 };
    report.missing = { missing_region: 4 };

    const priorities = prioritizeReferenceSeeds(report, referenceSeedQueueData);

    const beveragePriority = priorities.find((priority) => priority.seedId === 'beverage-rice-cinnamon-latin-america');
    expect(beveragePriority).toMatchObject({
      seedId: 'beverage-rice-cinnamon-latin-america',
      reasons: expect.arrayContaining([
        'frequent_memory_type',
        'missing_region',
        'fallback_guard',
        'cache_unavailable',
      ]),
    });
    expect(JSON.stringify(priorities)).not.toMatch(/horchata but thinner|my aunt|rawMemory|memoryText/i);
  });

  it('keeps reason codes bounded and deterministic', () => {
    const report = emptyReport();
    report.total = 3;
    report.byMemoryType = { confectionery: 2 };
    report.byFamily = { unknown: 2 };
    report.byCache = { unavailable: 3 };

    const first = prioritizeReferenceSeeds(report, referenceSeedQueueData);
    const second = prioritizeReferenceSeeds(report, referenceSeedQueueData);

    expect(second).toEqual(first);
    expect(new Set(first.flatMap((priority) => priority.reasons))).toEqual(new Set([
      'frequent_memory_type',
      'unknown_family',
      'cache_unavailable',
    ]));
  });

  it('contains seed targets for the final-canary knowledge-gap buckets', () => {
    const seedIds = referenceSeedQueueData.seeds.map((seed) => seed.id);
    expect(seedIds).toEqual(expect.arrayContaining([
      'soup-sour-herb-eastern-europe',
      'beverage-rice-cinnamon-latin-america',
      'beverage-barley-cebada-latin-america',
      'cassava-fritter-caribbean-central-america',
      'confectionery-coconut-sugar-festival',
      'curry-cream-tomato-substitution-roles',
    ]));
  });
});
