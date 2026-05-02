import { describe, expect, it } from 'vitest';
import dishFamiliesData from '../src/data/dish-families.json' with { type: 'json' };
import ingredientsData from '../src/data/ingredients.json' with { type: 'json' };
import memoryHintsData from '../src/data/memory-hints.json' with { type: 'json' };
import regionalAvailabilityData from '../src/data/regional-availability.json' with { type: 'json' };
import sensoryProfilesData from '../src/data/sensory-profiles.json' with { type: 'json' };
import globalCoverageMatrixData from '../src/data/global-coverage-matrix.json' with { type: 'json' };
import referenceSeedQueueData from '../src/data/reference-seed-queue.json' with { type: 'json' };
import cacheWarmingManifestData from '../src/data/cache-warming-manifest.json' with { type: 'json' };
import referenceSourceRegistryData from '../src/data/reference-source-registry.json' with { type: 'json' };
import referenceFamilyTaxonomyData from '../src/data/reference-family-taxonomy.json' with { type: 'json' };
import inferenceBurdenInventoryData from '../src/data/inference-burden-inventory.json' with { type: 'json' };
import { validateBundledData, type BundledDataSet } from '../src/lib/data-schemas.js';

const bundledData: BundledDataSet = {
  dishFamilies: dishFamiliesData,
  ingredients: ingredientsData,
  regionalAvailability: regionalAvailabilityData,
  sensoryProfiles: sensoryProfilesData,
  memoryHints: memoryHintsData,
  globalCoverageMatrix: globalCoverageMatrixData,
  referenceSeedQueue: referenceSeedQueueData,
  cacheWarmingManifest: cacheWarmingManifestData,
  referenceSourceRegistry: referenceSourceRegistryData,
  referenceFamilyTaxonomy: referenceFamilyTaxonomyData,
  inferenceBurdenInventory: inferenceBurdenInventoryData,
};

function cloneBundledData(): BundledDataSet {
  return structuredClone(bundledData);
}

function expectIssue(issues: ReturnType<typeof validateBundledData>, path: string, messagePart: string) {
  expect(issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path,
        message: expect.stringContaining(messagePart),
      }),
    ]),
  );
}

describe('bundled data validation', () => {
  it('accepts the committed bundled JSON data files', () => {
    expect(validateBundledData(bundledData)).toEqual([]);
  });

  it('keeps production reference data framed as generalized mechanisms, not canary prompt fixtures', () => {
    const productionReferenceText = JSON.stringify({
      dishFamilies: dishFamiliesData,
      referenceSeedQueue: referenceSeedQueueData,
      cacheWarmingManifest: cacheWarmingManifestData,
    }).toLowerCase();

    expect(productionReferenceText).not.toContain('final-canary');
    expect(productionReferenceText).not.toContain('misspelled carimanola');
    expect(productionReferenceText).not.toContain('sparse sour dill soup');
    expect(productionReferenceText).not.toContain('ambiguous festival sweet');
    expect(productionReferenceText).not.toContain('substitution-pressure prompts');
  });

  it('rejects dish families with empty fields or duplicate family identifiers', () => {
    const data = cloneBundledData();
    const duplicateIndex = data.dishFamilies.families.length;
    data.dishFamilies.meta.description = ' ';
    data.dishFamilies.families[0].aliases.push('dolma', ' ');
    data.dishFamilies.families.push({
      ...structuredClone(data.dishFamilies.families[0]),
      aliases: ['copy-alias'],
    });

    const issues = validateBundledData(data);

    expectIssue(issues, 'dishFamilies.meta.description', 'non-empty string');
    expectIssue(issues, 'dishFamilies.families[0].aliases[12]', 'duplicate');
    expectIssue(issues, 'dishFamilies.families[0].aliases[13]', 'non-empty string');
    expectIssue(issues, `dishFamilies.families[${duplicateIndex}].canonicalName`, 'duplicate');
  });


  it('rejects malformed dish variant metadata', () => {
    const data = cloneBundledData();
    data.dishFamilies.families[0].variants = [
      {
        name: '',
        aliases: ['dolma', 'dolma'],
        regions: [],
        distinguishingElements: ['wrapper', 'wrapper'],
        clarificationPrompt: '',
      },
    ];

    const issues = validateBundledData(data);

    expectIssue(issues, 'dishFamilies.families[0].variants[0].name', 'non-empty string');
    expectIssue(issues, 'dishFamilies.families[0].variants[0].aliases[1]', 'duplicate');
    expectIssue(issues, 'dishFamilies.families[0].variants[0].regions', 'non-empty array');
    expectIssue(issues, 'dishFamilies.families[0].variants[0].distinguishingElements[1]', 'duplicate');
    expectIssue(issues, 'dishFamilies.families[0].variants[0].clarificationPrompt', 'non-empty string');
  });

  it('rejects ingredients with duplicate names, empty compounds, and incomplete sensory metadata', () => {
    const data = cloneBundledData();
    data.ingredients.ingredients['cumin-seeds-copy'] = {
      ...structuredClone(data.ingredients.ingredients['cumin-seeds']),
      compounds: ['cuminaldehyde', 'cuminaldehyde', ' '],
      sensoryContribution: { aroma: '', flavor: 'warming' },
      commonIn: ['South Asian', 'South Asian'],
    };

    const issues = validateBundledData(data);

    expectIssue(issues, 'ingredients.ingredients.cumin-seeds-copy.name', 'duplicate');
    expectIssue(issues, 'ingredients.ingredients.cumin-seeds-copy.compounds[1]', 'duplicate');
    expectIssue(issues, 'ingredients.ingredients.cumin-seeds-copy.compounds[2]', 'non-empty string');
    expectIssue(issues, 'ingredients.ingredients.cumin-seeds-copy.sensoryContribution.aroma', 'non-empty string');
    expectIssue(issues, 'ingredients.ingredients.cumin-seeds-copy.commonIn[1]', 'duplicate');
  });


  it('rejects malformed memory hint vocabularies', () => {
    const data = cloneBundledData();
    data.memoryHints.ingredients.push('pork');
    data.memoryHints.cookingMethods.push({ label: ' ', regexSource: '(' });
    data.memoryHints.regionPatterns.push({ label: 'Puerto Rican', regexSource: '(' });
    data.memoryHints.regionFamilyMap['Puerto Rican'] = [];

    const issues = validateBundledData(data);

    expectIssue(issues, `memoryHints.ingredients[${data.memoryHints.ingredients.length - 1}]`, 'duplicate');
    expectIssue(issues, 'memoryHints.cookingMethods[14].label', 'non-empty string');
    expectIssue(issues, 'memoryHints.cookingMethods[14].regexSource', 'valid regular expression');
    expectIssue(issues, 'memoryHints.regionPatterns[94].label', 'duplicate');
    expectIssue(issues, 'memoryHints.regionPatterns[94].regexSource', 'valid regular expression');
    expectIssue(issues, 'memoryHints.regionFamilyMap.Puerto Rican', 'non-empty array');
  });

  it('requires provenance on bundled dish families and ingredient groups', () => {
    const data = cloneBundledData();
    delete data.dishFamilies.families[0].provenance;
    delete data.ingredients.ingredients['cumin-seeds'].provenance;

    const issues = validateBundledData(data);

    expectIssue(issues, 'dishFamilies.families[0].provenance', 'provenance');
    expectIssue(issues, 'ingredients.ingredients.cumin-seeds.provenance', 'provenance');
  });

  it('rejects regional availability data with empty corridors, stores, or duplicate location entries', () => {
    const data = cloneBundledData();
    const socal = data.regionalAvailability.regions['southern-california'];
    socal.cities.push('Los Angeles');
    socal.majorEthnicCorridors.push({ name: ' ', city: '', cuisines: ['Korean', 'Korean', ' '] });
    socal.majorStores.asian.push('H Mart');
    socal.majorStores.emptyCategory = [];

    const issues = validateBundledData(data);

    expectIssue(issues, 'regionalAvailability.regions.southern-california.cities[4]', 'duplicate');
    expectIssue(issues, 'regionalAvailability.regions.southern-california.majorEthnicCorridors[8].name', 'non-empty string');
    expectIssue(issues, 'regionalAvailability.regions.southern-california.majorEthnicCorridors[8].city', 'non-empty string');
    expectIssue(issues, 'regionalAvailability.regions.southern-california.majorEthnicCorridors[8].cuisines[1]', 'duplicate');
    expectIssue(issues, 'regionalAvailability.regions.southern-california.majorEthnicCorridors[8].cuisines[2]', 'non-empty string');
    expectIssue(issues, 'regionalAvailability.regions.southern-california.majorStores.asian[4]', 'duplicate');
    expectIssue(issues, 'regionalAvailability.regions.southern-california.majorStores.emptyCategory', 'non-empty array');
  });

  it('rejects sensory profiles that omit required dimensions or critical nostalgia metadata', () => {
    const data = cloneBundledData();
    delete data.sensoryProfiles.dimensions.flavor;
    data.sensoryProfiles.dimensions.aroma.nostalgiaIndicators.push('triggers specific memory');
    data.sensoryProfiles.dimensions.texture.categories.push('crispy', ' ');
    data.sensoryProfiles.nostalgiaCriticalCriteria = '';

    const issues = validateBundledData(data);

    expectIssue(issues, 'sensoryProfiles.dimensions.flavor', 'required dimension');
    expectIssue(issues, 'sensoryProfiles.dimensions.aroma.nostalgiaIndicators[3]', 'duplicate');
    expectIssue(issues, 'sensoryProfiles.dimensions.texture.categories[10]', 'duplicate');
    expectIssue(issues, 'sensoryProfiles.dimensions.texture.categories[11]', 'non-empty string');
    expectIssue(issues, 'sensoryProfiles.nostalgiaCriticalCriteria', 'non-empty string');
  });

  it('validates optional confidence and provenance-ready metadata when present', () => {
    const data = cloneBundledData();
    data.ingredients.meta.version = '';
    data.ingredients.meta.confidence = 'Maybe';
    data.ingredients.meta.sources = ['existing source', ' '];
    data.ingredients.meta.provenance = { source: '', notes: ['field notes', ''] };

    const issues = validateBundledData(data);

    expectIssue(issues, 'ingredients.meta.version', 'non-empty string');
    expectIssue(issues, 'ingredients.meta.confidence', 'High, Medium, or Low');
    expectIssue(issues, 'ingredients.meta.sources[1]', 'non-empty string');
    expectIssue(issues, 'ingredients.meta.provenance.source', 'non-empty string');
    expectIssue(issues, 'ingredients.meta.provenance.notes[1]', 'non-empty string');
  });

  it('accepts committed global coverage, reference seed queue, and cache warming manifest data', () => {
    expect(validateBundledData(bundledData)).toEqual([]);
  });

  it('keeps the reference family taxonomy broad, mapped, and population-oriented', () => {
    const fixtureFamilies = new Set(cacheWarmingManifestData.tasks.map((task) => task.cacheTarget.dishFamily));
    const mappedFamilies = new Set(referenceFamilyTaxonomyData.familyMappings.map((mapping) => mapping.dishFamily));
    const clusterIds = new Set(referenceFamilyTaxonomyData.clusters.map((cluster) => cluster.id));
    const mappedClusterIds = new Set(referenceFamilyTaxonomyData.familyMappings.map((mapping) => mapping.primaryCluster));
    const coveredTags = new Set(referenceFamilyTaxonomyData.familyMappings.flatMap((mapping) => mapping.coverageTags));

    expect(referenceFamilyTaxonomyData.clusterPolicy.coverageUniverse).toBe('open_world');
    expect(referenceFamilyTaxonomyData.clusterPolicy.currentCoverageAxesAreCompleteClaim).toBe(false);
    expect(referenceFamilyTaxonomyData.clusterPolicy.requiredCoverageAxesScope).toContain('not a final or exhaustive ontology');
    expect(referenceFamilyTaxonomyData.clusterPolicy.expansionBacklogAxes).toEqual(expect.arrayContaining([
      'microRegionsAndEcologies',
      'stapleIngredientBases',
      'languagesScriptsTransliterationsAndHouseholdNames',
      'seasonalityClimateAndAvailabilityConstraints',
    ]));
    expect(referenceFamilyTaxonomyData.clusterPolicy.familyCountIsNotSuccessMetric).toBe(true);
    expect(referenceFamilyTaxonomyData.clusterPolicy.populationOrder).toEqual(expect.arrayContaining([
      'cover every current global coverage axis value while treating the axis list as expandable',
      'add region, diaspora, naming, ingredient, and sensory variants under existing families before creating new families',
    ]));
    expect(referenceFamilyTaxonomyData.clusters.length).toBeGreaterThanOrEqual(8);
    expect([...clusterIds].every((clusterId) => mappedClusterIds.has(clusterId))).toBe(true);
    expect(mappedFamilies).toEqual(fixtureFamilies);

    for (const axis of ['foodForms', 'cultureAreas', 'regionScopes', 'nameSystems', 'mechanisms']) {
      const expectedTags = globalCoverageMatrixData.axes[axis].values.map((value) => `${axis}.${value.id}`);
      expect([...coveredTags].filter((tag) => tag.startsWith(`${axis}.`)).sort()).toEqual(expectedTags.sort());
    }
  });

  it('rejects malformed global coverage axes and duplicate values', () => {
    const data = cloneBundledData();
    data.globalCoverageMatrix.axes.foodForms.values.push(
      { id: 'beverage', label: 'Duplicate beverage', description: 'duplicate' },
      { id: '', label: '', description: '' },
    );

    const issues = validateBundledData(data);

    expectIssue(issues, 'globalCoverageMatrix.axes.foodForms.values[17].id', 'duplicate');
    expectIssue(issues, 'globalCoverageMatrix.axes.foodForms.values[18].id', 'non-empty string');
    expectIssue(issues, 'globalCoverageMatrix.axes.foodForms.values[18].label', 'non-empty string');
  });

  it('rejects malformed reference seed queue entries', () => {
    const data = cloneBundledData();
    const badSeedIndex = data.referenceSeedQueue.seeds.length;
    data.referenceSeedQueue.seeds.push({
      ...structuredClone(data.referenceSeedQueue.seeds[0]),
      id: data.referenceSeedQueue.seeds[0].id,
      coverageTags: ['foodForms.not-real'],
      querySeeds: [],
      cacheTargets: [{ dishFamily: 'borscht-liquids-and-comfort', region: 'Europe comparison' }],
    });
    delete data.referenceSeedQueue.seeds[1].provenance;

    const issues = validateBundledData(data);

    expectIssue(issues, `referenceSeedQueue.seeds[${badSeedIndex}].id`, 'duplicate');
    expectIssue(issues, `referenceSeedQueue.seeds[${badSeedIndex}].coverageTags[0]`, 'unknown coverage tag');
    expectIssue(issues, `referenceSeedQueue.seeds[${badSeedIndex}].querySeeds`, 'non-empty array');
    expectIssue(issues, `referenceSeedQueue.seeds[${badSeedIndex}].cacheTargets[0].dishFamily`, 'must not encode coverage band');
    expectIssue(issues, `referenceSeedQueue.seeds[${badSeedIndex}].cacheTargets[0].region`, 'must not encode comparison');
    expectIssue(issues, 'referenceSeedQueue.seeds[1].provenance', 'provenance');
  });

  it('rejects artificial taxonomy keys in cache warming targets', () => {
    const data = cloneBundledData();
    const badTaskIndex = data.cacheWarmingManifest.tasks.length;
    data.cacheWarmingManifest.tasks.push({
      ...structuredClone(data.cacheWarmingManifest.tasks[0]),
      id: 'synthetic-taxonomy-task',
      cacheTarget: {
        dishFamily: 'rice-cinnamon-beverage-cue',
        region: 'Latin America variants',
      },
    });

    const issues = validateBundledData(data);

    expectIssue(issues, `cacheWarmingManifest.tasks[${badTaskIndex}].cacheTarget.dishFamily`, 'must not encode coverage band');
    expectIssue(issues, `cacheWarmingManifest.tasks[${badTaskIndex}].cacheTarget.region`, 'must not encode comparison');
  });

  it('rejects malformed cache warming manifest tasks', () => {
    const data = cloneBundledData();
    const badTaskIndex = data.cacheWarmingManifest.tasks.length;
    data.cacheWarmingManifest.tasks.push({
      ...structuredClone(data.cacheWarmingManifest.tasks[0]),
      id: data.cacheWarmingManifest.tasks[0].id,
      seedId: 'missing-seed',
      coverageTags: ['mechanisms.not-real'],
      qualityTriggers: [],
      doneWhen: [],
    });

    const issues = validateBundledData(data);

    expectIssue(issues, `cacheWarmingManifest.tasks[${badTaskIndex}].id`, 'duplicate');
    expectIssue(issues, `cacheWarmingManifest.tasks[${badTaskIndex}].seedId`, 'unknown seed id');
    expectIssue(issues, `cacheWarmingManifest.tasks[${badTaskIndex}].coverageTags[0]`, 'unknown coverage tag');
    expectIssue(issues, `cacheWarmingManifest.tasks[${badTaskIndex}].qualityTriggers`, 'non-empty array');
    expectIssue(issues, `cacheWarmingManifest.tasks[${badTaskIndex}].doneWhen`, 'non-empty array');
  });

  it('requires a legally bounded source registry for pantry fixtures', () => {
    const data = cloneBundledData();
    data.referenceSourceRegistry.sources[0].license.id = '';
    data.referenceSourceRegistry.sources[1].fixturePolicy = 'always-allowed';
    data.referenceSourceRegistry.sources.push({
      ...structuredClone(data.referenceSourceRegistry.sources[0]),
      id: data.referenceSourceRegistry.sources[0].id,
      allowedUses: [],
      disallowedUses: [],
    });

    const issues = validateBundledData(data);

    expectIssue(issues, 'referenceSourceRegistry.sources[0].license.id', 'non-empty string');
    expectIssue(issues, 'referenceSourceRegistry.sources[1].fixturePolicy', 'allowed, manual_review, or rejected');
    expectIssue(issues, 'referenceSourceRegistry.sources[4].id', 'duplicate source id');
    expectIssue(issues, 'referenceSourceRegistry.sources[4].allowedUses', 'non-empty array');
    expectIssue(issues, 'referenceSourceRegistry.sources[4].disallowedUses', 'non-empty array');
  });

  it('accepts the committed inference burden inventory contract', () => {
    expect(validateBundledData(bundledData)).toEqual([]);
  });

  it('rejects malformed inference burden inventory entries', () => {
    const data = cloneBundledData();
    const badIndex = data.inferenceBurdenInventory.burdens.length;
    data.inferenceBurdenInventory.burdens.push({
      ...structuredClone(data.inferenceBurdenInventory.burdens[0]),
      id: data.inferenceBurdenInventory.burdens[0].id,
      burdenType: 'magic',
      deterministicOwner: 'model',
      leverage: 6,
      rigidityRisk: 0,
      promptRemovalTargets: [],
      preserveLatitude: ['interpretation'],
      modelKeeps: [],
    });

    const issues = validateBundledData(data);

    expectIssue(issues, `inferenceBurdenInventory.burdens[${badIndex}].id`, 'duplicate');
    expectIssue(issues, `inferenceBurdenInventory.burdens[${badIndex}].burdenType`, 'known burden type');
    expectIssue(issues, `inferenceBurdenInventory.burdens[${badIndex}].deterministicOwner`, 'known owner');
    expectIssue(issues, `inferenceBurdenInventory.burdens[${badIndex}].leverage`, 'between 1 and 5');
    expectIssue(issues, `inferenceBurdenInventory.burdens[${badIndex}].rigidityRisk`, 'between 1 and 5');
    expectIssue(issues, `inferenceBurdenInventory.burdens[${badIndex}].promptRemovalTargets`, 'non-empty array');
    expectIssue(issues, `inferenceBurdenInventory.burdens[${badIndex}].preserveLatitude`, 'at least 2');
    expectIssue(issues, `inferenceBurdenInventory.burdens[${badIndex}].modelKeeps`, 'non-empty array');
  });
});
