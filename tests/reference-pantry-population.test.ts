import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { auditReferencePantryPopulation } from '../src/lib/reference-pantry-population.js';
import pantryFixtureData from '../src/data/reference-pantry-fixtures.json' with { type: 'json' };
import taxonomyData from '../src/data/reference-family-taxonomy.json' with { type: 'json' };

describe('reference pantry population audit', () => {
  it('proves the bundled pantry is dense, deduplicated, and taxonomy-synced', () => {
    const audit = auditReferencePantryPopulation({
      referencePantryFixtures: pantryFixtureData as never,
      referenceFamilyTaxonomy: taxonomyData as never,
    });

    expect(audit.totalFixtures).toBeGreaterThanOrEqual(1120);
    expect(audit.familyCount).toBe(160);
    expect(audit.depthBuckets).toEqual({ '7': 160 });
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
      'wikidata-structured-food-data': 1120,
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
      familyCount: 160,
      minRecordsPerFamily: 7,
      maxRecordsPerFamily: 7,
      depthBuckets: { '7': 160 },
      duplicateCacheTargets: [],
      artificialTargets: [],
      taxonomyCountDrift: [],
      issues: [],
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
