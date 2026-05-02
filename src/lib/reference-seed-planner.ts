import globalCoverageMatrixData from '../data/global-coverage-matrix.json' with { type: 'json' };
import referenceSeedQueueData from '../data/reference-seed-queue.json' with { type: 'json' };
import cacheWarmingManifestData from '../data/cache-warming-manifest.json' with { type: 'json' };
import referenceSourceRegistryData from '../data/reference-source-registry.json' with { type: 'json' };
import referencePantryFixturesData from '../data/reference-pantry-fixtures.json' with { type: 'json' };
import referenceFamilyTaxonomyData from '../data/reference-family-taxonomy.json' with { type: 'json' };
import type { QualitySignalReport } from './quality-signals.js';
import type {
  CacheWarmingManifest,
  GlobalCoverageMatrix,
  ReferenceFamilyTaxonomy,
  ReferencePantryFixtureBatch,
  ReferenceSourceRegistry,
  ReferenceSeedEntry,
  ReferenceSeedQueue,
} from './data-schemas.js';

export type SeedPriorityReason =
  | 'frequent_memory_type'
  | 'missing_region'
  | 'fallback_guard'
  | 'unknown_family'
  | 'cache_unavailable';

export interface SeedPriority {
  seedId: string;
  score: number;
  reasons: SeedPriorityReason[];
  coverageTags: string[];
}

export const bundledGlobalReferenceSeeds = {
  globalCoverageMatrix: globalCoverageMatrixData as GlobalCoverageMatrix,
  referenceSeedQueue: referenceSeedQueueData as ReferenceSeedQueue,
  cacheWarmingManifest: cacheWarmingManifestData as CacheWarmingManifest,
  referenceSourceRegistry: referenceSourceRegistryData as ReferenceSourceRegistry,
  referencePantryFixtures: referencePantryFixturesData as ReferencePantryFixtureBatch,
  referenceFamilyTaxonomy: referenceFamilyTaxonomyData as ReferenceFamilyTaxonomy,
};

const MEMORY_TYPE_TO_FORM_TAGS: Record<string, string[]> = {
  beverage: ['foodForms.beverage'],
  sauce_broth: ['foodForms.soup_broth', 'foodForms.stew_braise', 'foodForms.sauce_condiment'],
  confectionery: ['foodForms.confectionery', 'foodForms.dessert'],
  dish: [
    'foodForms.bread_flatbread',
    'foodForms.grain_rice_noodle',
    'foodForms.dumpling_pocket',
    'foodForms.protein_centered',
    'foodForms.vegetable_fungi',
    'foodForms.snack_street_food',
    'foodForms.ceremonial_holiday',
    'foodForms.breakfast',
  ],
};

const REASON_ORDER: SeedPriorityReason[] = [
  'frequent_memory_type',
  'missing_region',
  'fallback_guard',
  'unknown_family',
  'cache_unavailable',
];

export function prioritizeReferenceSeeds(
  report: QualitySignalReport,
  queue: ReferenceSeedQueue = referenceSeedQueueData as ReferenceSeedQueue,
): SeedPriority[] {
  const priorities = queue.seeds
    .map((seed, index) => ({ priority: scoreSeed(seed, report), index }))
    .filter((entry) => entry.priority.score > 0)
    .sort((a, b) => b.priority.score - a.priority.score || a.index - b.index)
    .map((entry) => entry.priority)

  return priorities;
}

function scoreSeed(seed: ReferenceSeedEntry, report: QualitySignalReport): SeedPriority {
  const seedId = typeof seed.id === 'string' ? seed.id : 'unknown';
  const forms = stringArray(seed.forms);
  const coverageTags = stringArray(seed.coverageTags);
  const tags = new Set([...forms, ...coverageTags]);
  const reasons = new Set<SeedPriorityReason>();
  let score = 0;

  for (const [memoryType, count] of Object.entries(report.byMemoryType)) {
    if (count <= 0) continue;
    const matchingTags = MEMORY_TYPE_TO_FORM_TAGS[memoryType] ?? [];
    if (matchingTags.some((tag) => tags.has(tag))) {
      score += count * 3;
      reasons.add('frequent_memory_type');
    }
  }

  if ((report.missing.missing_region ?? 0) > 0 && hasTagPrefix(tags, 'regionScopes.')) {
    score += report.missing.missing_region * 2;
    reasons.add('missing_region');
  }

  const fallbackCount = (report.byGuard.explicit_minimum_cue_fallback ?? 0)
    + (report.byGuard.minimum_cue_deterministic_completion ?? 0)
    + (report.byGuard.broad_memory_clarification ?? 0);
  if (fallbackCount > 0) {
    score += fallbackCount;
    reasons.add('fallback_guard');
  }

  if ((report.byFamily.unknown ?? 0) > 0) {
    score += report.byFamily.unknown;
    reasons.add('unknown_family');
  }

  if ((report.byCache.unavailable ?? 0) > 0) {
    score += Math.ceil(report.byCache.unavailable / 2);
    reasons.add('cache_unavailable');
  }

  return {
    seedId,
    score,
    reasons: REASON_ORDER.filter((reason) => reasons.has(reason)),
    coverageTags: [...tags].sort(),
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function hasTagPrefix(tags: Set<string>, prefix: string): boolean {
  return [...tags].some((tag) => tag.startsWith(prefix));
}
