import { describe, expect, it } from 'vitest';
import dishFamiliesData from '../src/data/dish-families.json' with { type: 'json' };
import ingredientsData from '../src/data/ingredients.json' with { type: 'json' };
import memoryHintsData from '../src/data/memory-hints.json' with { type: 'json' };
import regionalAvailabilityData from '../src/data/regional-availability.json' with { type: 'json' };
import sensoryProfilesData from '../src/data/sensory-profiles.json' with { type: 'json' };
import { validateBundledData, type BundledDataSet } from '../src/lib/data-schemas.js';

const bundledData: BundledDataSet = {
  dishFamilies: dishFamiliesData,
  ingredients: ingredientsData,
  regionalAvailability: regionalAvailabilityData,
  sensoryProfiles: sensoryProfilesData,
  memoryHints: memoryHintsData,
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

  it('rejects dish families with empty fields or duplicate family identifiers', () => {
    const data = cloneBundledData();
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
    expectIssue(issues, 'dishFamilies.families[40].canonicalName', 'duplicate');
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

    expectIssue(issues, 'memoryHints.ingredients[29]', 'duplicate');
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
});
