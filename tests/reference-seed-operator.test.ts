import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ResearchCache } from '../src/lib/research-cache.js';
import pantryFixtureData from '../src/data/reference-pantry-fixtures.json' with { type: 'json' };
import globalCoverageMatrixData from '../src/data/global-coverage-matrix.json' with { type: 'json' };
import {
  buildReferencePantryFixtureReport,
  buildReferenceSeedOperatorReport,
  validateReferenceSeedFixtures,
  writeReferenceSeedFixturesToCache,
} from '../src/lib/reference-seed-operator.js';
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

const EXPANSION_BANDS = [
  'staple_starches',
  'liquids_and_comfort',
  'acid_heat_condiment',
  'protein_vegetable_mains',
  'handheld_social_foods',
  'sweet_ritual_foods',
] as const;

const NON_FOOD_WIKIDATA_COLLISIONS = /Dallas Cowboys|Hamburger SV|American football team|football team|sports club/i;

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

describe('reference seed operator integration', () => {
  it('turns private aggregate quality signals into prioritized host-research tasks and coverage gaps', () => {
    const report = emptyReport();
    report.total = 7;
    report.byMemoryType = { beverage: 5 };
    report.byCache = { unavailable: 7 };
    report.missing = { missing_region: 3 };

    const operatorReport = buildReferenceSeedOperatorReport(report, { limit: 3 });

    expect(operatorReport.priorities[0]).toMatchObject({
      seedId: 'beverage-rice-cinnamon-latin-america',
      reasons: expect.arrayContaining(['frequent_memory_type', 'missing_region', 'cache_unavailable']),
    });
    expect(operatorReport.cacheWarmingTasks[0]).toMatchObject({
      id: 'warm-beverage-rice-cinnamon-latin-america',
      seedId: 'beverage-rice-cinnamon-latin-america',
      cacheTarget: { dishFamily: 'rice-cinnamon-beverage', region: 'Mexico' },
      promptForHostResearch: expect.stringContaining('host-led research'),
    });
    expect(operatorReport.sourcePolicy.allowedFixtureSources.map((source) => source.id)).toEqual([
      'wikidata-structured-food-data',
      'usda-fooddata-central',
    ]);
    expect(operatorReport.sourcePolicy.manualReviewSources.map((source) => source.id)).toEqual([
      'open-food-facts-products',
      'fao-infoods-food-composition',
    ]);
    expect(operatorReport.sourcePolicy.disallowedPatterns).toEqual(expect.arrayContaining([
      'copied recipe instructions or article prose',
      'proprietary food guides or ranking databases',
    ]));
    expect(operatorReport.coverage.axes.foodForms).toMatchObject({ covered: 17, total: 17, missing: [] });
    expect(operatorReport.coverage.axes.cultureAreas).toMatchObject({ covered: 20, total: 20, missing: [] });
    expect(operatorReport.coverage.axes.regionScopes.missing).not.toEqual(expect.arrayContaining(['indigenous', 'borderland']));
    expect(operatorReport.coverage.axes.nameSystems.missing).not.toEqual(expect.arrayContaining(['script_form', 'phonetic']));
    expect(operatorReport.coverage.axes.mechanisms.missing).not.toEqual(expect.arrayContaining(['smoke']));
    expect(JSON.stringify(operatorReport)).not.toMatch(/rawMemory|memoryText|prompt_text|Achiote browses/i);
  });

  it('validates approved cache-warming fixtures before writing cache records', () => {
    const fixture = {
      fixtures: [
        {
          seedId: 'beverage-rice-cinnamon-latin-america',
          cacheTarget: { dishFamily: 'rice-cinnamon-beverage', region: 'Mexico' },
          sourceIds: ['wikidata-structured-food-data'],
          record: {
            dishName: 'rice cinnamon beverage',
            query: 'rice cinnamon beverage Mexico variants',
            sources: [
              {
                title: 'Approved operator source',
                url: 'https://example.org/rice-cinnamon-beverage',
                sourceType: 'article',
                accessedAt: '2026-04-29T00:00:00.000Z',
                reliability: 'Medium',
                quotedFacts: ['Rice cinnamon drinks appear in multiple Mexican and diaspora contexts.'],
              },
            ],
            extractedFacts: {
              namesAndAliases: ['rice cinnamon beverage'],
              regions: ['Mexico'],
              ingredients: [],
              techniques: [],
              sensoryDescriptors: [],
              culturalOccasions: [],
              regionalVariants: ['diaspora versions vary'],
            },
            uncertainty: ['family-specific sweetness and thickness'],
            confidence: 'Medium',
            createdAt: '2026-04-29T00:00:00.000Z',
          },
        },
      ],
    };

    expect(validateReferenceSeedFixtures(fixture)).toEqual([]);
  });

  it('ships the canary-remediated barley cebada fixture as bundled taxonomy evidence', () => {
    const fixture = pantryFixtureData.fixtures.find((entry) => entry.seedId === 'beverage-barley-cebada-latin-america');

    expect(fixture).toMatchObject({
      cacheTarget: { dishFamily: 'grain-beverage', region: 'Latin America' },
      sourceIds: ['wikidata-structured-food-data'],
    });
    expect(fixture?.record.extractedFacts.namesAndAliases).toEqual(expect.arrayContaining([
      'agua de cebada',
      'barley water',
      'cebada',
    ]));
    expect(fixture?.record.extractedFacts.sensoryDescriptors).toEqual(expect.arrayContaining([
      'starch texture',
      'temperature',
      'serving ritual',
    ]));
    expect(JSON.stringify(fixture)).not.toMatch(/rawMemory|memoryText|prompt_text|recipe instructions|live web/i);
  });

  it('rejects fixture records whose seed target or research record is malformed', () => {
    const issues = validateReferenceSeedFixtures({
      fixtures: [
        {
          seedId: 'missing-seed',
          cacheTarget: { dishFamily: 'rice-cinnamon-beverage', region: 'Mexico' },
          sourceIds: ['open-food-facts-products'],
          record: { dishName: '', query: '', sources: [] },
        },
      ],
    });

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'fixtures[0].seedId', message: expect.stringContaining('known seed') }),
      expect.objectContaining({ path: 'fixtures[0].sourceIds[0]', message: expect.stringContaining('allowed fixture source') }),
      expect.objectContaining({ path: 'fixtures[0].record.dishName' }),
      expect.objectContaining({ path: 'fixtures[0].record.sources' }),
    ]));
  });

  it('validates the committed CC0 reference pantry fixture batch and proves full axis coverage', () => {
    expect(validateReferenceSeedFixtures(pantryFixtureData)).toEqual([]);

    const report = buildReferencePantryFixtureReport(pantryFixtureData);

    expect(report.totalFixtures).toBeGreaterThanOrEqual(18);
    expect(report.sourceIds).toEqual(['wikidata-structured-food-data']);
    expect(report.coverage.axes.foodForms).toMatchObject({ covered: 17, total: 17, missing: [] });
    expect(report.coverage.axes.cultureAreas).toMatchObject({ covered: 20, total: 20, missing: [] });
    expect(report.coverage.axes.regionScopes).toMatchObject({ covered: 9, total: 9, missing: [] });
    expect(report.coverage.axes.nameSystems).toMatchObject({ covered: 8, total: 8, missing: [] });
    expect(report.coverage.axes.mechanisms).toMatchObject({ covered: 12, total: 12, missing: [] });
    expect(report.coverage.axes.evidenceLevels).toMatchObject({
      covered: 2,
      total: 4,
      missing: ['family_confirmed', 'operator_quality_signal'],
    });
    expect(JSON.stringify(pantryFixtureData)).not.toMatch(/rawMemory|memoryText|prompt_text|medical advice|legal advice/i);

    const emptyReport = buildReferencePantryFixtureReport({ fixtures: [] });
    expect(emptyReport.totalFixtures).toBe(0);
    expect(emptyReport.coverage.axes.foodForms).toMatchObject({ covered: 0, total: 17 });
    expect(emptyReport.coverage.axes.cultureAreas).toMatchObject({ covered: 0, total: 20 });
    expect(emptyReport.coverage.axes.mechanisms).toMatchObject({ covered: 0, total: 12 });
    expect(emptyReport.coverage.axes.evidenceLevels).toMatchObject({ covered: 0, total: 4 });
  });

  it('keeps the first pantry expansion balanced across every culture area and food-memory band', () => {
    const cultureAreaIds = globalCoverageMatrixData.axes.cultureAreas.values.map((value) => value.id);
    const expansionFixtures = pantryFixtureData.fixtures.filter((fixture) => typeof fixture.expansionBand === 'string');

    expect(expansionFixtures).toHaveLength(cultureAreaIds.length * EXPANSION_BANDS.length);

    for (const cultureArea of cultureAreaIds) {
      const fixturesForCulture = expansionFixtures.filter((fixture) => stringArray(fixture.coverageTags).includes(`cultureAreas.${cultureArea}`));
      expect(fixturesForCulture.map((fixture) => fixture.expansionBand).sort()).toEqual([...EXPANSION_BANDS].sort());
    }

    for (const band of EXPANSION_BANDS) {
      const fixturesForBand = expansionFixtures.filter((fixture) => fixture.expansionBand === band);
      expect(fixturesForBand).toHaveLength(cultureAreaIds.length);
      expect(new Set(fixturesForBand.flatMap((fixture) => stringArray(fixture.coverageTags).filter((tag) => tag.startsWith('cultureAreas.'))))).toEqual(
        new Set(cultureAreaIds.map((cultureArea) => `cultureAreas.${cultureArea}`)),
      );
    }

    for (const fixture of expansionFixtures) {
      expect(fixture.sourceIds).toEqual(['wikidata-structured-food-data']);
      expect(stringArray(fixture.coverageTags)).toEqual(expect.arrayContaining([
        'evidenceLevels.seed_hypothesis',
        'evidenceLevels.researched_record',
      ]));
      expect(stringArray(fixture.coverageTags)).not.toEqual(expect.arrayContaining([
        'evidenceLevels.family_confirmed',
        'evidenceLevels.operator_quality_signal',
      ]));
      expect(JSON.stringify(fixture)).not.toMatch(/rawMemory|memoryText|prompt_text|recipe instructions|medical advice|legal advice|Achiote browses|live web/i);
      expect(JSON.stringify(fixture)).not.toMatch(NON_FOOD_WIKIDATA_COLLISIONS);
    }
  });

  it('counts only fixture writes that can be read back from the cache', () => {
    const fixture = {
      fixtures: [
        {
          seedId: 'beverage-rice-cinnamon-latin-america',
          cacheTarget: { dishFamily: 'rice-cinnamon-beverage', region: 'Mexico' },
          sourceIds: ['wikidata-structured-food-data'],
          record: {
            dishName: 'rice cinnamon beverage',
            query: 'rice cinnamon beverage Mexico variants',
            sources: [{
              title: 'Approved operator source',
              url: 'https://example.org/rice-cinnamon-beverage',
              sourceType: 'article',
              accessedAt: '2026-04-29T00:00:00.000Z',
              reliability: 'Medium',
              quotedFacts: ['Rice cinnamon drinks appear in multiple Mexican and diaspora contexts.'],
            }],
            extractedFacts: {
              namesAndAliases: ['rice cinnamon beverage'],
              regions: ['Mexico'],
              ingredients: [],
              techniques: [],
              sensoryDescriptors: [],
              culturalOccasions: [],
              regionalVariants: [],
            },
            uncertainty: ['family-specific sweetness and thickness'],
            confidence: 'Medium',
            createdAt: '2026-04-29T00:00:00.000Z',
          },
        },
      ],
    };

    expect(() => writeReferenceSeedFixturesToCache(fixture, {
      storeResearchRecord: () => {},
      getResearchRecord: () => null,
    })).toThrow(/Cache write verification failed/);
  });

  it('runs the operator script in report and approved fixture write modes without live browsing', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'achiote-reference-seeds-'));
    const qualityPath = path.join(tempRoot, 'quality.json');
    const fixturePath = path.join(tempRoot, 'fixture.json');
    const cachePath = path.join(tempRoot, 'cache.db');
    fs.writeFileSync(qualityPath, JSON.stringify({
      total: 3,
      byMemoryType: { beverage: 3 },
      byFamily: {},
      byRegion: {},
      byGuard: {},
      bySearch: {},
      byCache: { unavailable: 3 },
      missing: { missing_region: 1 },
    }));
    fs.writeFileSync(fixturePath, JSON.stringify({
      fixtures: [
        {
          seedId: 'beverage-rice-cinnamon-latin-america',
          cacheTarget: { dishFamily: 'rice-cinnamon-beverage', region: 'Mexico' },
          sourceIds: ['wikidata-structured-food-data'],
          record: {
            dishName: 'rice cinnamon beverage',
            query: 'rice cinnamon beverage Mexico variants',
            sources: [{
              title: 'Approved operator source',
              url: 'https://example.org/rice-cinnamon-beverage',
              sourceType: 'article',
              accessedAt: '2026-04-29T00:00:00.000Z',
              reliability: 'Medium',
              quotedFacts: ['Rice cinnamon drinks appear in multiple Mexican and diaspora contexts.'],
            }],
            extractedFacts: {
              namesAndAliases: ['rice cinnamon beverage'],
              regions: ['Mexico'],
              ingredients: [],
              techniques: [],
              sensoryDescriptors: [],
              culturalOccasions: [],
              regionalVariants: [],
            },
            uncertainty: ['family-specific sweetness and thickness'],
            confidence: 'Medium',
            createdAt: '2026-04-29T00:00:00.000Z',
          },
        },
      ],
    }));

    try {
      const report = spawnSync(process.execPath, ['scripts/reference-seed-operator.mjs', '--quality-report', qualityPath, '--limit', '2'], {
        encoding: 'utf8',
      });
      expect(report.status).toBe(0);
      expect(report.stdout).toContain('warm-beverage-rice-cinnamon-latin-america');
      expect(report.stdout).not.toMatch(/Achiote browses|live web|rawMemory|memoryText/i);

      const write = spawnSync(process.execPath, [
        'scripts/reference-seed-operator.mjs',
        '--fixture',
        fixturePath,
        '--cache-path',
        cachePath,
      ], { encoding: 'utf8' });
      expect(write.status).toBe(0);
      expect(JSON.parse(write.stdout)).toEqual({ stored: 1 });

      const cache = new ResearchCache(cachePath);
      try {
        expect(cache.getResearchRecord('rice-cinnamon-beverage', 'Mexico')?.dishName).toBe('rice cinnamon beverage');
      } finally {
        cache.close();
      }

      const bundledCachePath = path.join(tempRoot, 'bundled-cache.db');
      const bundledWrite = spawnSync(process.execPath, [
        'scripts/reference-seed-operator.mjs',
        '--fixture',
        'bundled',
        '--cache-path',
        bundledCachePath,
      ], { encoding: 'utf8' });
      expect(bundledWrite.status).toBe(0);
      expect(JSON.parse(bundledWrite.stdout)).toEqual({ stored: pantryFixtureData.fixtures.length });

      const bundledCache = new ResearchCache(bundledCachePath);
      try {
        expect(bundledCache.getResearchRecord('fermented-vegetable-pickle', 'East Asia')?.dishName).toBe('fermented-vegetable-pickle');
        expect(bundledCache.getResearchRecord('coconut-taro-earth-oven-foodway', 'Oceania and Pacific')?.dishName).toBe('coconut-taro-earth-oven-foodway');
      } finally {
        bundledCache.close();
      }
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 20_000);
});
