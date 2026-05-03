import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyReferencePantryAppend, auditReferencePantryPopulation } from '../src/lib/reference-pantry-population.js';
import pantryFixtureData from '../src/data/reference-pantry-fixtures.json' with { type: 'json' };
import taxonomyData from '../src/data/reference-family-taxonomy.json' with { type: 'json' };

describe('reference pantry population audit', () => {
  it('proves the bundled pantry is dense, deduplicated, and taxonomy-synced', () => {
    const audit = auditReferencePantryPopulation({
      referencePantryFixtures: pantryFixtureData as never,
      referenceFamilyTaxonomy: taxonomyData as never,
    });

    expect(audit.totalFixtures).toBeGreaterThanOrEqual(1120);
    expect(audit.familyCount).toBe(184);
    expect(audit.depthBuckets).toEqual({ '7': 184 });
    expect(audit.minRecordsPerFamily).toBe(7);
    expect(audit.maxRecordsPerFamily).toBe(7);
    expect(audit.familiesBelowFloor).toEqual([]);
    expect(audit.duplicateCacheTargets).toEqual([]);
    expect(audit.artificialTargets).toEqual([]);
    expect(audit.taxonomyCountDrift).toEqual([]);
    expect(audit.fixtureFamiliesMissingTaxonomy).toEqual([]);
    expect(audit.taxonomyFamiliesMissingFixtures).toEqual([]);
    expect(audit.sourceCounts).toMatchObject({
      'usda-fooddata-central': 51,
      'wikidata-structured-food-data': 1288,
    });
    expect(audit.sourceFamilyCounts['usda-fooddata-central']).toBe(51);
    expect(audit.issues).toEqual([]);
  });

  it('surfaces thin, duplicated, artificial, and taxonomy-drifted fixture batches', () => {
    const audit = auditReferencePantryPopulation({
      referencePantryFixtures: {
        meta: {},
        fixtures: [
          fixture('seed-a', 'thin-soup-liquids-and-comfort', 'comparison region', ['wikidata-structured-food-data']),
          fixture('seed-b', 'thin-soup-liquids-and-comfort', 'comparison region', ['wikidata-structured-food-data']),
          fixture('seed-c', 'real-family', 'Andes', ['wikidata-structured-food-data', 'usda-fooddata-central']),
          fixture('seed-d', 'missing-taxonomy-family', 'Horn of Africa', ['wikidata-structured-food-data']),
        ],
      },
      referenceFamilyTaxonomy: {
        meta: {},
        clusterPolicy: {
          minimumTargetRecordsPerFamily: 3,
        },
        clusters: [],
        familyMappings: [
          { dishFamily: 'thin-soup-liquids-and-comfort', currentRecordCount: 3 },
          { dishFamily: 'real-family', currentRecordCount: 1 },
          { dishFamily: 'taxonomy-only-family', currentRecordCount: 2 },
        ],
      },
    } as never);

    expect(audit.familiesBelowFloor.map((entry) => entry.dishFamily)).toEqual([
      'missing-taxonomy-family',
      'real-family',
      'thin-soup-liquids-and-comfort',
    ]);
    expect(audit.duplicateCacheTargets).toEqual([{
      dishFamily: 'thin-soup-liquids-and-comfort',
      region: 'comparison region',
      count: 2,
    }]);
    expect(audit.artificialTargets).toEqual(expect.arrayContaining([
      {
        dishFamily: 'thin-soup-liquids-and-comfort',
        region: 'comparison region',
        reason: 'artificial_family',
      },
      {
        dishFamily: 'thin-soup-liquids-and-comfort',
        region: 'comparison region',
        reason: 'artificial_region',
      },
    ]));
    expect(audit.taxonomyCountDrift).toEqual(expect.arrayContaining([
      { dishFamily: 'missing-taxonomy-family', taxonomyCount: 0, fixtureCount: 1 },
      { dishFamily: 'taxonomy-only-family', taxonomyCount: 2, fixtureCount: 0 },
      { dishFamily: 'thin-soup-liquids-and-comfort', taxonomyCount: 3, fixtureCount: 2 },
    ]));
    expect(audit.fixtureFamiliesMissingTaxonomy).toEqual(['missing-taxonomy-family']);
    expect(audit.taxonomyFamiliesMissingFixtures).toEqual(['taxonomy-only-family']);
    expect(audit.sourceFamilyCounts).toMatchObject({
      'usda-fooddata-central': 1,
      'wikidata-structured-food-data': 3,
    });
    expect(audit.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      'families.thin-soup-liquids-and-comfort',
      'cacheTargets.thin-soup-liquids-and-comfort.comparison region',
      'taxonomy.familyMappings.thin-soup-liquids-and-comfort.currentRecordCount',
      'taxonomy.familyMappings.missing-taxonomy-family',
      'fixtures.taxonomy-only-family',
    ]));
  });

  it('exposes the population audit through the operator script', () => {
    const result = spawnSync(process.execPath, ['scripts/reference-seed-operator.mjs', '--population-audit'], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    const audit = JSON.parse(result.stdout);
    expect(audit).toMatchObject({
      totalFixtures: pantryFixtureData.fixtures.length,
      familyCount: 184,
      minRecordsPerFamily: 7,
      maxRecordsPerFamily: 7,
      depthBuckets: { '7': 184 },
      duplicateCacheTargets: [],
      artificialTargets: [],
      taxonomyCountDrift: [],
      issues: [],
    });
  });

  it('plans safe pantry appends across fixtures, seeds, manifests, and taxonomy counts', () => {
    const result = applyReferencePantryAppend(basePopulationData(), {
      items: [appendItem({
        seedId: 'seed-new-region',
        dishFamily: 'existing-family',
        region: 'Diaspora table',
      })],
    });

    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      appendedFixtureCount: 1,
      changedFamilies: ['existing-family'],
    });
    expect(result.data.referencePantryFixtures.fixtures).toHaveLength(2);
    expect(result.data.referenceSeedQueue.seeds.map((seed) => seed.id)).toContain('seed-new-region');
    expect(result.data.cacheWarmingManifest.tasks.map((task) => task.id)).toContain('warm-seed-new-region');
    expect(result.data.referenceFamilyTaxonomy.familyMappings[0]).toMatchObject({
      dishFamily: 'existing-family',
      currentRecordCount: 2,
      currentRegions: ['Base region', 'Diaspora table'],
    });
    expect(auditReferencePantryPopulation(result.data, { minimumRecordsPerFamily: 1 }).issues).toEqual([]);
  });

  it('rejects unsafe append plans before mutating synchronized pantry assets', () => {
    const data = basePopulationData();
    const result = applyReferencePantryAppend(data, {
      items: [
        appendItem({
          seedId: 'seed-duplicate',
          dishFamily: 'existing-family',
          region: 'Base region',
        }),
        appendItem({
          seedId: 'seed-bad-source',
          dishFamily: 'new-family-cue',
          region: 'variant cue',
          sourceIds: ['open-food-facts-products'],
        }),
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.appendedFixtureCount).toBe(0);
    expect(result.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      'items[0].fixture.cacheTarget',
      'items[1].fixture.cacheTarget.dishFamily',
      'items[1].fixture.cacheTarget.region',
      'items[1].fixture.sourceIds',
      'items[1].taxonomyMapping',
    ]));
    expect(data.referencePantryFixtures.fixtures).toHaveLength(1);
  });

  it('exposes append dry-runs through the operator script without writing files', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'achiote-append-plan-'));
    const appendPath = path.join(tempRoot, 'append.json');
    fs.writeFileSync(appendPath, JSON.stringify({
      items: [appendItem({
        seedId: 'script-dry-run-existing-family',
        dishFamily: 'rice-cinnamon-beverage',
        region: 'Script dry-run context',
      })],
    }));

    const result = spawnSync(process.execPath, ['scripts/reference-seed-operator.mjs', '--append', appendPath], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      dryRun: true,
      appendedFixtureCount: 1,
      changedFamilies: ['rice-cinnamon-beverage'],
      wroteFiles: [],
    });
  });
});

function fixture(seedId: string, dishFamily: string, region: string, sourceIds: string[]) {
  return {
    seedId,
    cacheTarget: { dishFamily, region },
    sourceIds,
    record: {},
  };
}

function basePopulationData() {
  return {
    referencePantryFixtures: {
      meta: {},
      fixtures: [
        fixture('seed-base', 'existing-family', 'Base region', ['wikidata-structured-food-data']),
      ],
    },
    referenceFamilyTaxonomy: {
      meta: {},
      clusterPolicy: { minimumTargetRecordsPerFamily: 1 },
      clusters: [],
      familyMappings: [
        {
          dishFamily: 'existing-family',
          currentRecordCount: 1,
          currentRegions: ['Base region'],
        },
      ],
    },
    referenceSeedQueue: {
      meta: {},
      seeds: [
        {
          id: 'seed-base',
          cacheTargets: [{ dishFamily: 'existing-family', region: 'Base region' }],
        },
      ],
    },
    cacheWarmingManifest: {
      meta: {},
      tasks: [
        {
          id: 'warm-seed-base',
          seedId: 'seed-base',
          cacheTarget: { dishFamily: 'existing-family', region: 'Base region' },
        },
      ],
    },
    referenceSourceRegistry: {
      meta: {},
      disallowedPatterns: [],
      sources: [
        { id: 'wikidata-structured-food-data', fixturePolicy: 'allowed' },
        { id: 'open-food-facts-products', fixturePolicy: 'manual_review' },
      ],
    },
  } as never;
}

function appendItem(input: {
  seedId: string;
  dishFamily: string;
  region: string;
  sourceIds?: string[];
}) {
  return {
    seed: {
      id: input.seedId,
      cacheTargets: [{ dishFamily: input.dishFamily, region: input.region }],
    },
    task: {
      id: `warm-${input.seedId}`,
      seedId: input.seedId,
      cacheTarget: { dishFamily: input.dishFamily, region: input.region },
    },
    fixture: fixture(input.seedId, input.dishFamily, input.region, input.sourceIds ?? ['wikidata-structured-food-data']),
  };
}
