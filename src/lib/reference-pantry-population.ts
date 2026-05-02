import {
  bundledGlobalReferenceSeeds,
} from './reference-seed-planner.js';
import type {
  ReferenceFamilyTaxonomy,
  ReferencePantryFixtureBatch,
} from './data-schemas.js';

const ARTIFICIAL_CACHE_FAMILY_PATTERN = /(?:-liquids-and-comfort|-protein-vegetable-mains|-sweet-ritual-foods|-handheld-social-foods|-staple-starches|-acid-heat-condiment|-cue)$/;
const ARTIFICIAL_CACHE_REGION_PATTERN = /\b(?:comparison|variants?|cue)\b/i;

export type ReferencePantryPopulationData = {
  referencePantryFixtures: ReferencePantryFixtureBatch;
  referenceFamilyTaxonomy: ReferenceFamilyTaxonomy;
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
