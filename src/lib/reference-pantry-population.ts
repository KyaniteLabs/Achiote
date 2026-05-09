import {
  bundledGlobalReferenceSeeds,
} from './reference-seed-planner.js';
import {
  ARTIFICIAL_CACHE_FAMILY_PATTERN,
  ARTIFICIAL_CACHE_REGION_PATTERN,
} from './data-schemas.js';
import type {
  CacheWarmingManifest,
  ReferenceFamilyTaxonomy,
  ReferencePantryFixtureBatch,
  ReferencePantryFixtureEntry,
  ReferenceSeedEntry,
  ReferenceSeedQueue,
  ReferenceSourceRegistry,
} from './data-schemas.js';

export type ReferencePantryPopulationData = {
  referencePantryFixtures: ReferencePantryFixtureBatch;
  referenceFamilyTaxonomy: ReferenceFamilyTaxonomy;
  referenceSeedQueue?: ReferenceSeedQueue;
  cacheWarmingManifest?: CacheWarmingManifest;
  referenceSourceRegistry?: ReferenceSourceRegistry;
};

export type ReferencePantryPopulationIssue = {
  path: string;
  message: string;
};

export type ReferencePantryFamilyDepth = {
  dishFamily: string;
  count: number;
};

export type ReferencePantryDuplicateTarget = {
  dishFamily: string;
  region: string;
  count: number;
};

export type ReferencePantryArtificialTarget = {
  dishFamily: string;
  region: string;
  reason: 'artificial_family' | 'artificial_region';
};

export type ReferencePantryTaxonomyCountDrift = {
  dishFamily: string;
  taxonomyCount: number;
  fixtureCount: number;
};

export type ReferencePantryPopulationAudit = {
  totalFixtures: number;
  familyCount: number;
  minRecordsPerFamily: number;
  maxRecordsPerFamily: number;
  depthBuckets: Record<string, number>;
  familiesBelowFloor: ReferencePantryFamilyDepth[];
  sourceIds: string[];
  sourceCounts: Record<string, number>;
  sourceFamilyCounts: Record<string, number>;
  duplicateCacheTargets: ReferencePantryDuplicateTarget[];
  artificialTargets: ReferencePantryArtificialTarget[];
  taxonomyCountDrift: ReferencePantryTaxonomyCountDrift[];
  fixtureFamiliesMissingTaxonomy: string[];
  taxonomyFamiliesMissingFixtures: string[];
  issues: ReferencePantryPopulationIssue[];
};

export type ReferencePantryAppendItem = {
  seed: ReferenceSeedEntry;
  task: CacheWarmingManifest['tasks'][number];
  fixture: ReferencePantryFixtureEntry;
  taxonomyMapping?: ReferenceFamilyTaxonomy['familyMappings'][number];
};

export type ReferencePantryAppendPlan = {
  items: ReferencePantryAppendItem[];
};

export type ReferencePantryAppendResult = {
  ok: boolean;
  dryRun: boolean;
  issues: ReferencePantryPopulationIssue[];
  appendedFixtureCount: number;
  changedFamilies: string[];
  summary: string;
  data: Required<Pick<ReferencePantryPopulationData,
    'referencePantryFixtures' |
    'referenceFamilyTaxonomy' |
    'referenceSeedQueue' |
    'cacheWarmingManifest' |
    'referenceSourceRegistry'
  >>;
};

export function auditReferencePantryPopulation(
  data: ReferencePantryPopulationData = bundledGlobalReferenceSeeds,
  options: { minimumRecordsPerFamily?: number } = {},
): ReferencePantryPopulationAudit {
  const minimumRecordsPerFamily = Math.max(1, options.minimumRecordsPerFamily
    ?? numberValue(data.referenceFamilyTaxonomy.clusterPolicy.minimumTargetRecordsPerFamily, 1));
  const fixtures = Array.isArray(data.referencePantryFixtures.fixtures)
    ? data.referencePantryFixtures.fixtures
    : [];
  const familyCounts = new Map<string, number>();
  const targetCounts = new Map<string, { dishFamily: string; region: string; count: number }>();
  const sourceCounts = new Map<string, number>();
  const sourceFamilies = new Map<string, Set<string>>();
  const artificialTargets: ReferencePantryArtificialTarget[] = [];

  fixtures.forEach((fixture, fixtureIndex) => {
    const cacheTarget = isRecord(fixture.cacheTarget) ? fixture.cacheTarget : {};
    const dishFamily = stringValue(cacheTarget.dishFamily, `unknown-fixture-${fixtureIndex}`);
    const region = stringValue(cacheTarget.region, 'unknown-region');
    familyCounts.set(dishFamily, (familyCounts.get(dishFamily) ?? 0) + 1);

    const targetKey = `${dishFamily}\u0000${region}`;
    const existingTarget = targetCounts.get(targetKey);
    targetCounts.set(targetKey, {
      dishFamily,
      region,
      count: (existingTarget?.count ?? 0) + 1,
    });

    if (ARTIFICIAL_CACHE_FAMILY_PATTERN.test(dishFamily)) {
      artificialTargets.push({ dishFamily, region, reason: 'artificial_family' });
    }
    if (ARTIFICIAL_CACHE_REGION_PATTERN.test(region)) {
      artificialTargets.push({ dishFamily, region, reason: 'artificial_region' });
    }

    stringArray(fixture.sourceIds).forEach((sourceId) => {
      sourceCounts.set(sourceId, (sourceCounts.get(sourceId) ?? 0) + 1);
      if (!sourceFamilies.has(sourceId)) sourceFamilies.set(sourceId, new Set());
      sourceFamilies.get(sourceId)!.add(dishFamily);
    });
  });

  const familyDepths = [...familyCounts.entries()]
    .map(([dishFamily, count]) => ({ dishFamily, count }))
    .sort((a, b) => a.dishFamily.localeCompare(b.dishFamily));
  const familyDepthValues = familyDepths.map((entry) => entry.count);
  const depthBuckets: Record<string, number> = {};
  for (const count of familyDepthValues) {
    depthBuckets[String(count)] = (depthBuckets[String(count)] ?? 0) + 1;
  }

  const taxonomyCounts = new Map<string, number>();
  for (const [index, mapping] of data.referenceFamilyTaxonomy.familyMappings.entries()) {
    const dishFamily = stringValue(mapping.dishFamily, `unknown-taxonomy-${index}`);
    taxonomyCounts.set(dishFamily, numberValue(mapping.currentRecordCount, 0));
  }

  const taxonomyCountDrift = [...new Set([...familyCounts.keys(), ...taxonomyCounts.keys()])]
    .map((dishFamily) => ({
      dishFamily,
      taxonomyCount: taxonomyCounts.get(dishFamily) ?? 0,
      fixtureCount: familyCounts.get(dishFamily) ?? 0,
    }))
    .filter((entry) => entry.taxonomyCount !== entry.fixtureCount)
    .sort((a, b) => a.dishFamily.localeCompare(b.dishFamily));
  const duplicateCacheTargets = [...targetCounts.values()]
    .filter((entry) => entry.count > 1)
    .sort((a, b) => a.dishFamily.localeCompare(b.dishFamily) || a.region.localeCompare(b.region));
  const fixtureFamiliesMissingTaxonomy = [...familyCounts.keys()]
    .filter((dishFamily) => !taxonomyCounts.has(dishFamily))
    .sort();
  const taxonomyFamiliesMissingFixtures = [...taxonomyCounts.keys()]
    .filter((dishFamily) => !familyCounts.has(dishFamily))
    .sort();
  const familiesBelowFloor = familyDepths.filter((entry) => entry.count < minimumRecordsPerFamily);

  const issues: ReferencePantryPopulationIssue[] = [
    ...familiesBelowFloor.map((entry) => ({
      path: `families.${entry.dishFamily}`,
      message: `has ${entry.count} record(s), below the ${minimumRecordsPerFamily}-record floor`,
    })),
    ...duplicateCacheTargets.map((entry) => ({
      path: `cacheTargets.${entry.dishFamily}.${entry.region}`,
      message: `has ${entry.count} duplicate fixture records for the same cache target`,
    })),
    ...artificialTargets.map((entry) => ({
      path: `cacheTargets.${entry.dishFamily}.${entry.region}`,
      message: entry.reason === 'artificial_family'
        ? 'uses an artificial dish-family taxonomy suffix'
        : 'uses an artificial region label',
    })),
    ...taxonomyCountDrift.map((entry) => ({
      path: `taxonomy.familyMappings.${entry.dishFamily}.currentRecordCount`,
      message: `taxonomy says ${entry.taxonomyCount}, fixtures contain ${entry.fixtureCount}`,
    })),
    ...fixtureFamiliesMissingTaxonomy.map((dishFamily) => ({
      path: `taxonomy.familyMappings.${dishFamily}`,
      message: 'fixture family is missing from the reference family taxonomy',
    })),
    ...taxonomyFamiliesMissingFixtures.map((dishFamily) => ({
      path: `fixtures.${dishFamily}`,
      message: 'taxonomy family has no fixture records',
    })),
  ];

  return {
    totalFixtures: fixtures.length,
    familyCount: familyCounts.size,
    minRecordsPerFamily: familyDepthValues.length > 0 ? Math.min(...familyDepthValues) : 0,
    maxRecordsPerFamily: familyDepthValues.length > 0 ? Math.max(...familyDepthValues) : 0,
    depthBuckets,
    familiesBelowFloor,
    sourceIds: [...sourceCounts.keys()].sort(),
    sourceCounts: Object.fromEntries([...sourceCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    sourceFamilyCounts: Object.fromEntries([...sourceFamilies.entries()]
      .map(([sourceId, families]) => [sourceId, families.size] as const)
      .sort(([a], [b]) => a.localeCompare(b))),
    duplicateCacheTargets,
    artificialTargets,
    taxonomyCountDrift,
    fixtureFamiliesMissingTaxonomy,
    taxonomyFamiliesMissingFixtures,
    issues,
  };
}

export function applyReferencePantryAppend(
  data: ReferencePantryPopulationData = bundledGlobalReferenceSeeds,
  plan: ReferencePantryAppendPlan,
  options: { dryRun?: boolean } = {},
): ReferencePantryAppendResult {
  const dryRun = options.dryRun !== false;
  const workingData = clonePopulationData(data);
  const issues = validateAppendPlan(workingData, plan);

  if (issues.length > 0) {
    return {
      ok: false,
      dryRun,
      issues,
      appendedFixtureCount: 0,
      changedFamilies: [],
      summary: `Reference pantry append blocked by ${issues.length} issue${issues.length === 1 ? '' : 's'}.`,
      data: workingData,
    };
  }

  const changedFamilies = new Set<string>();
  for (const item of plan.items) {
    const fixtureTarget = cacheTargetOf(item.fixture.cacheTarget);
    changedFamilies.add(fixtureTarget.dishFamily);
    workingData.referencePantryFixtures.fixtures.push(item.fixture);
    workingData.referenceSeedQueue.seeds.push(item.seed);
    workingData.cacheWarmingManifest.tasks.push(item.task);
    upsertTaxonomyMapping(workingData.referenceFamilyTaxonomy, item, fixtureTarget.region);
  }

  const audit = auditReferencePantryPopulation(workingData);
  const postAppendIssues = audit.duplicateCacheTargets.length > 0
    || audit.artificialTargets.length > 0
    || audit.taxonomyCountDrift.length > 0
    || audit.fixtureFamiliesMissingTaxonomy.length > 0
    ? audit.issues
    : [];

  return {
    ok: postAppendIssues.length === 0,
    dryRun,
    issues: postAppendIssues,
    appendedFixtureCount: postAppendIssues.length === 0 ? plan.items.length : 0,
    changedFamilies: [...changedFamilies].sort(),
    summary: postAppendIssues.length === 0
      ? `${dryRun ? 'Dry-run planned' : 'Applied'} ${plan.items.length} reference pantry append item${plan.items.length === 1 ? '' : 's'} across ${changedFamilies.size} famil${changedFamilies.size === 1 ? 'y' : 'ies'}.`
      : `Reference pantry append would leave ${postAppendIssues.length} population issue${postAppendIssues.length === 1 ? '' : 's'}.`,
    data: workingData,
  };
}

function validateAppendPlan(
  data: Required<Pick<ReferencePantryPopulationData,
    'referencePantryFixtures' |
    'referenceFamilyTaxonomy' |
    'referenceSeedQueue' |
    'cacheWarmingManifest' |
    'referenceSourceRegistry'
  >>,
  plan: ReferencePantryAppendPlan,
): ReferencePantryPopulationIssue[] {
  const issues: ReferencePantryPopulationIssue[] = [];
  const fixtureTargets = new Set(data.referencePantryFixtures.fixtures.map((fixture) => {
    const target = cacheTargetOf(fixture.cacheTarget);
    return `${target.dishFamily}\u0000${target.region}`;
  }));
  const seedIds = new Set(data.referenceSeedQueue.seeds.map((seed) => stringValue(seed.id, '')));
  const taskIds = new Set(data.cacheWarmingManifest.tasks.map((task) => stringValue(task.id, '')));
  const taxonomyFamilies = new Set(data.referenceFamilyTaxonomy.familyMappings.map((mapping) => stringValue(mapping.dishFamily, '')));
  const allowedSourceIds = new Set(data.referenceSourceRegistry.sources
    .filter((source) => source.fixturePolicy === 'allowed')
    .map((source) => stringValue(source.id, ''))
    .filter(Boolean));
  const plannedTargets = new Set<string>();
  const plannedSeeds = new Set<string>();
  const plannedTasks = new Set<string>();

  plan.items.forEach((item, index) => {
    const base = `items[${index}]`;
    const seedId = stringValue(item.seed.id, '');
    const taskSeedId = stringValue(item.task.seedId, '');
    const fixtureSeedId = stringValue(item.fixture.seedId, '');
    const seedTargets = Array.isArray(item.seed.cacheTargets) ? item.seed.cacheTargets.map(cacheTargetOf) : [];
    const taskTarget = cacheTargetOf(item.task.cacheTarget);
    const fixtureTarget = cacheTargetOf(item.fixture.cacheTarget);
    const targetKey = `${fixtureTarget.dishFamily}\u0000${fixtureTarget.region}`;

    if (!seedId) issues.push({ path: `${base}.seed.id`, message: 'must be a non-empty seed id' });
    if (seedId && (seedIds.has(seedId) || plannedSeeds.has(seedId))) issues.push({ path: `${base}.seed.id`, message: 'must not duplicate an existing or planned seed id' });
    if (!stringValue(item.task.id, '')) issues.push({ path: `${base}.task.id`, message: 'must be a non-empty task id' });
    if (stringValue(item.task.id, '') && (taskIds.has(stringValue(item.task.id, '')) || plannedTasks.has(stringValue(item.task.id, '')))) {
      issues.push({ path: `${base}.task.id`, message: 'must not duplicate an existing or planned task id' });
    }
    if (seedId && (taskSeedId !== seedId || fixtureSeedId !== seedId)) {
      issues.push({ path: base, message: 'seed, task, and fixture must share the same seedId' });
    }
    if (seedTargets.length === 0 || !seedTargets.some((target) => target.dishFamily === fixtureTarget.dishFamily && target.region === fixtureTarget.region)) {
      issues.push({ path: `${base}.seed.cacheTargets`, message: 'must include the fixture cache target' });
    }
    if (taskTarget.dishFamily !== fixtureTarget.dishFamily || taskTarget.region !== fixtureTarget.region) {
      issues.push({ path: `${base}.task.cacheTarget`, message: 'must match the fixture cache target' });
    }
    if (fixtureTargets.has(targetKey) || plannedTargets.has(targetKey)) {
      issues.push({ path: `${base}.fixture.cacheTarget`, message: 'must not duplicate an existing or planned cache target' });
    }
    if (ARTIFICIAL_CACHE_FAMILY_PATTERN.test(fixtureTarget.dishFamily)) {
      issues.push({ path: `${base}.fixture.cacheTarget.dishFamily`, message: 'must not use an artificial taxonomy suffix' });
    }
    if (ARTIFICIAL_CACHE_REGION_PATTERN.test(fixtureTarget.region)) {
      issues.push({ path: `${base}.fixture.cacheTarget.region`, message: 'must not use artificial comparison, variant, or cue labels' });
    }
    for (const sourceId of stringArray(item.fixture.sourceIds)) {
      if (!allowedSourceIds.has(sourceId)) {
        issues.push({ path: `${base}.fixture.sourceIds`, message: `source ${sourceId} is not allowed for committed pantry fixtures` });
      }
    }
    if (stringArray(item.fixture.sourceIds).length === 0) {
      issues.push({ path: `${base}.fixture.sourceIds`, message: 'must list at least one approved fixture source id' });
    }
    if (!taxonomyFamilies.has(fixtureTarget.dishFamily) && stringValue(item.taxonomyMapping?.dishFamily, '') !== fixtureTarget.dishFamily) {
      issues.push({ path: `${base}.taxonomyMapping`, message: 'must provide a taxonomy mapping for a new fixture family' });
    }
    plannedTargets.add(targetKey);
    if (seedId) plannedSeeds.add(seedId);
    const taskId = stringValue(item.task.id, '');
    if (taskId) plannedTasks.add(taskId);
  });

  return issues;
}

function upsertTaxonomyMapping(
  taxonomy: ReferenceFamilyTaxonomy,
  item: ReferencePantryAppendItem,
  region: string,
): void {
  const target = cacheTargetOf(item.fixture.cacheTarget);
  const existing = taxonomy.familyMappings.find((mapping) => stringValue(mapping.dishFamily, '') === target.dishFamily);
  if (!existing) {
    taxonomy.familyMappings.push({
      ...item.taxonomyMapping,
      dishFamily: target.dishFamily,
      currentRecordCount: 1,
      currentRegions: [region],
    });
    return;
  }
  existing.currentRecordCount = numberValue(existing.currentRecordCount, 0) + 1;
  existing.currentRegions = [...new Set([...stringArray(existing.currentRegions), region])].sort();
}

function clonePopulationData(data: ReferencePantryPopulationData): ReferencePantryAppendResult['data'] {
  return {
    referencePantryFixtures: structuredClone(data.referencePantryFixtures),
    referenceFamilyTaxonomy: structuredClone(data.referenceFamilyTaxonomy),
    referenceSeedQueue: structuredClone(data.referenceSeedQueue ?? bundledGlobalReferenceSeeds.referenceSeedQueue),
    cacheWarmingManifest: structuredClone(data.cacheWarmingManifest ?? bundledGlobalReferenceSeeds.cacheWarmingManifest),
    referenceSourceRegistry: structuredClone(data.referenceSourceRegistry ?? bundledGlobalReferenceSeeds.referenceSourceRegistry),
  };
}

function cacheTargetOf(value: unknown): { dishFamily: string; region: string } {
  const cacheTarget = isRecord(value) ? value : {};
  return {
    dishFamily: stringValue(cacheTarget.dishFamily, ''),
    region: stringValue(cacheTarget.region, ''),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
