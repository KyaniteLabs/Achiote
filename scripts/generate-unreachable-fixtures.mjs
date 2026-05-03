#!/usr/bin/env node
/**
 * Generates an append plan for populating unreachable canonical families
 * from dish-families.json with reference pantry fixtures.
 */
import fs from 'node:fs';
import { resolve } from 'node:path';

const dishFamilies = JSON.parse(fs.readFileSync(resolve('src/data/dish-families.json'), 'utf8'));
const existingFixtures = JSON.parse(fs.readFileSync(resolve('src/data/reference-pantry-fixtures.json'), 'utf8'));

// Build alias-to-canonical map like workflow-planner does
function normalizeKnowledgeText(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const aliasToCanonical = new Map();
for (const family of dishFamilies.families) {
  for (const alias of family.aliases) {
    aliasToCanonical.set(normalizeKnowledgeText(alias), family.canonicalName);
  }
  // Also map the canonical name to itself
  aliasToCanonical.set(normalizeKnowledgeText(family.canonicalName), family.canonicalName);
}

// Determine which canonical families are reached by existing fixtures
const reachedCanonicals = new Set();
for (const f of existingFixtures.fixtures) {
  const dishFamily = f.cacheTarget?.dishFamily;
  if (!dishFamily) continue;
  const canonical = aliasToCanonical.get(normalizeKnowledgeText(dishFamily)) ?? dishFamily;
  if (dishFamilies.families.some(df => df.canonicalName === canonical)) {
    reachedCanonicals.add(canonical);
  }
}

// Families in dish-families.json that have no fixtures
const unreachableFamilies = dishFamilies.families.filter(f => !reachedCanonicals.has(f.canonicalName));

console.error(`Unreachable families: ${unreachableFamilies.length}`);
for (const f of unreachableFamilies) console.error(`  ${f.canonicalName}`);

// Map families to clusters based on their characteristics
function inferCluster(family) {
  const shared = family.sharedElements.join(' ').toLowerCase();
  const name = family.canonicalName;

  if (name.includes('beverage') || name.includes('drink') || shared.includes('drink') || shared.includes('beverage'))
    return 'liquid-comfort-beverages';
  if (name.includes('soup') || name.includes('broth') || shared.includes('broth') || shared.includes('soup') || shared.includes('liquid'))
    return 'soups-broths-and-sour-liquids';
  if (name.includes('dumpling') || name.includes('pie') || name.includes('roll') || name.includes('bread') || shared.includes('wrapper') || shared.includes('pocket') || shared.includes('hand-held'))
    return 'handheld-street-and-filled-foods';
  if (name.includes('pudding') || name.includes('custard') || name.includes('sweet') || name.includes('dessert') || name.includes('confection') || shared.includes('sweet') || shared.includes('custard') || shared.includes('sugar'))
    return 'sweets-desserts-and-ritual-foods';
  if (name.includes('salad') || name.includes('spice') || name.includes('paste') || name.includes('sauce') || name.includes('condiment') || name.includes('pickle') || name.includes('ferment') || shared.includes('condiment') || shared.includes('ferment') || shared.includes('pickle') || shared.includes('preserv'))
    return 'sauces-condiments-pickles-and-ferments';
  if (name.includes('bread') || name.includes('flatbread') || name.includes('tortilla') || name.includes('rice') || name.includes('pasta') || name.includes('noodle') || name.includes('grain') || shared.includes('starch') || shared.includes('grain') || shared.includes('dough') || shared.includes('masa'))
    return 'staple-starches-grains-and-noodles';
  if (name.includes('stew') || name.includes('braise') || name.includes('curry') || name.includes('casserole') || shared.includes('slow-cooked') || shared.includes('brais') || shared.includes('stew'))
    return 'stews-braises-and-sauced-mains';
  if (name.includes('grill') || name.includes('barbecue') || name.includes('smoke') || name.includes('roast') || shared.includes('grill') || shared.includes('smoke') || shared.includes('fire'))
    return 'stews-braises-and-sauced-mains'; // or handheld? grilled meat is a main
  if (name.includes('ceviche') || name.includes('tartare') || name.includes('raw') || name.includes('cured') || name.includes('confit') || name.includes('dried') || shared.includes('preserv') || shared.includes('cure') || shared.includes('raw'))
    return 'pantry-aroma-preserved-and-single-ingredient-cues';
  if (name.includes('egg'))
    return 'stews-braises-and-sauced-mains';
  if (name.includes('wrap') || name.includes('tamale') || name.includes('masa'))
    return 'handheld-street-and-filled-foods';

  return 'stews-braises-and-sauced-mains'; // default fallback
}

function inferFoodForms(family) {
  const name = family.canonicalName;
  const shared = family.sharedElements.join(' ').toLowerCase();
  const forms = [];

  if (name.includes('beverage') || name.includes('drink')) forms.push('foodForms.beverage');
  if (name.includes('soup') || name.includes('broth')) forms.push('foodForms.soup_broth');
  if (name.includes('stew') || name.includes('braise')) forms.push('foodForms.stew_braise');
  if (name.includes('curry')) forms.push('foodForms.stew_braise', 'foodForms.protein_centered');
  if (name.includes('dumpling') || name.includes('pie') || name.includes('roll')) forms.push('foodForms.dumpling_pocket');
  if (name.includes('bread') || name.includes('flatbread')) forms.push('foodForms.bread_flatbread');
  if (name.includes('rice') || name.includes('pasta') || name.includes('noodle') || name.includes('grain')) forms.push('foodForms.grain_rice_noodle');
  if (name.includes('pudding') || name.includes('custard') || name.includes('sweet') || name.includes('dessert') || name.includes('confection')) forms.push('foodForms.dessert', 'foodForms.confectionery');
  if (name.includes('salad')) forms.push('foodForms.vegetable_fungi');
  if (name.includes('meat') || name.includes('protein') || shared.includes('protein') || shared.includes('meat')) forms.push('foodForms.protein_centered');
  if (name.includes('vegetable') || shared.includes('vegetable')) forms.push('foodForms.vegetable_fungi');
  if (name.includes('pickle') || name.includes('ferment') || name.includes('spice') || name.includes('paste') || name.includes('sauce') || name.includes('condiment')) forms.push('foodForms.sauce_condiment', 'foodForms.pickle_ferment');
  if (name.includes('fish') || name.includes('seafood')) forms.push('foodForms.protein_centered');
  if (name.includes('egg')) forms.push('foodForms.protein_centered');
  if (forms.length === 0) forms.push('foodForms.protein_centered');

  return [...new Set(forms)];
}

function inferMechanisms(family) {
  const shared = family.sharedElements.join(' ').toLowerCase();
  const divergent = family.divergentElements.join(' ').toLowerCase();
  const nostalgia = family.nostalgiaTriggers.join(' ').toLowerCase();
  const all = `${shared} ${divergent} ${nostalgia}`;
  const mechanisms = [];

  if (all.includes('smoke') || all.includes('smoky')) mechanisms.push('mechanisms.smoke');
  if (all.includes('aroma') || all.includes('smell')) mechanisms.push('mechanisms.aroma');
  if (all.includes('ferment') || all.includes('sour') || all.includes('acid') || all.includes('tangy')) mechanisms.push('mechanisms.fermentation_acid');
  if (all.includes('sauce') || all.includes('gravy') || all.includes('balance')) mechanisms.push('mechanisms.sauce_balance');
  if (all.includes('fat') || all.includes('oil') || all.includes('rich')) mechanisms.push('mechanisms.fat_mouthfeel');
  if (all.includes('texture') || all.includes('crisp') || all.includes('crunch') || all.includes('soft') || all.includes('tender') || all.includes('chew')) mechanisms.push('mechanisms.texture_contrast');
  if (all.includes('starch') || all.includes('grain') || all.includes('rice') || all.includes('pasta') || all.includes('dough')) mechanisms.push('mechanisms.starch_texture');
  if (all.includes('brow') || all.includes('caramel') || all.includes('char') || all.includes('maillard')) mechanisms.push('mechanisms.browning');
  if (all.includes('sugar') || all.includes('sweet') || all.includes('crystal') || all.includes('caramel')) mechanisms.push('mechanisms.sugar_crystal');
  if (all.includes('temp') || all.includes('warm') || all.includes('hot') || all.includes('cold') || all.includes('chill')) mechanisms.push('mechanisms.temperature');
  if (all.includes('ritual') || all.includes('served') || all.includes('occasion') || all.includes('holiday') || all.includes('gather')) mechanisms.push('mechanisms.serving_ritual');

  if (mechanisms.length === 0) mechanisms.push('mechanisms.aroma');
  return [...new Set(mechanisms)];
}

function inferCultureAreas(regions) {
  const areas = [];
  const r = regions.join(' ').toLowerCase();
  if (r.includes('mediterranean') || r.includes('balkans') || r.includes('greece') || r.includes('italy') || r.includes('spain') || r.includes('france')) areas.push('cultureAreas.north_africa', 'cultureAreas.europe');
  if (r.includes('middle east') || r.includes('west asia') || r.includes('levant') || r.includes('iran') || r.includes('iraq') || r.includes('gulf')) areas.push('cultureAreas.middle_east_west_asia');
  if (r.includes('east asia') || r.includes('china') || r.includes('japan') || r.includes('korea') || r.includes('tibet') || r.includes('mongolia') || r.includes('hong kong')) areas.push('cultureAreas.east_asia');
  if (r.includes('south asia') || r.includes('india') || r.includes('pakistan') || r.includes('bangladesh') || r.includes('sri lanka')) areas.push('cultureAreas.south_asia');
  if (r.includes('southeast asia') || r.includes('thailand') || r.includes('vietnam') || r.includes('indonesia') || r.includes('philippines') || r.includes('malaysia')) areas.push('cultureAreas.southeast_asia');
  if (r.includes('ethiopia') || r.includes('nigeria') || r.includes('ghana') || r.includes('kenya') || r.includes('west africa') || r.includes('horn')) areas.push('cultureAreas.west_africa');
  if (r.includes('south africa') || r.includes('southern africa')) areas.push('cultureAreas.southern_africa');
  if (r.includes('central africa')) areas.push('cultureAreas.central_africa');
  if (r.includes('east africa')) areas.push('cultureAreas.east_africa');
  if (r.includes('north africa')) areas.push('cultureAreas.north_africa');
  if (r.includes('caribbean') || r.includes('puerto rico')) areas.push('cultureAreas.caribbean');
  if (r.includes('latin america') || r.includes('mexico') || r.includes('central america') || r.includes('south america') || r.includes('peru') || r.includes('argentina') || r.includes('brazil')) areas.push('cultureAreas.south_america', 'cultureAreas.central_america');
  if (r.includes('europe') || r.includes('eastern europe') || r.includes('scandinavia') || r.includes('britain') || r.includes('germany') || r.includes('poland') || r.includes('russia') || r.includes('romania')) areas.push('cultureAreas.europe');
  if (r.includes('central asia') || r.includes('caucasus') || r.includes('uzbek') || r.includes('kazakh')) areas.push('cultureAreas.central_asia');
  if (r.includes('north america') || r.includes('american') || r.includes('united states') || r.includes('canada')) areas.push('cultureAreas.north_america');
  if (r.includes('arctic') || r.includes('subarctic') || r.includes('alaska') || r.includes('siberia')) areas.push('cultureAreas.arctic_subarctic');
  if (r.includes('pacific') || r.includes('oceania') || r.includes('australia') || r.includes('zealand') || r.includes('polynesia')) areas.push('cultureAreas.oceania_pacific');
  if (r.includes('indigenous') || r.includes('first nations') || r.includes('native')) areas.push('cultureAreas.indigenous_first_peoples');
  if (r.includes('borderland') || r.includes('trade route')) areas.push('cultureAreas.borderland_trade_routes');
  if (areas.length === 0) areas.push('cultureAreas.diaspora_global');
  return [...new Set(areas)];
}

function buildCoverageTags(family, region) {
  const forms = inferFoodForms(family);
  const mechanisms = inferMechanisms(family);
  const areas = inferCultureAreas(family.regions);
  const tags = [
    ...areas,
    'evidenceLevels.researched_record',
    'evidenceLevels.seed_hypothesis',
    ...forms,
    ...mechanisms,
    'nameSystems.alias',
    'regionScopes.macro_region',
  ];
  if (region.toLowerCase().includes('diaspora')) {
    tags.push('cultureAreas.diaspora_global', 'regionScopes.diaspora');
  }
  return [...new Set(tags)];
}

function sanitizeCure(text) {
  return text.replace(/\bcure\b/g, 'curing');
}

function buildRecord(family, region) {
  const aliases = family.aliases.slice(0, 6);
  const name = family.canonicalName;
  const safeShared = family.sharedElements.map(sanitizeCure);
  const safeNostalgia = family.nostalgiaTriggers.map(sanitizeCure);
  return {
    dishName: name,
    query: `${name} regional variants | ${aliases.slice(0, 3).join(' ')} ${region} family memory | ${name} ${region} diaspora variations`,
    sources: [
      {
        title: `${name} structured data`,
        url: `https://www.wikidata.org/wiki/Special:Search?search=${encodeURIComponent(name)}`,
        sourceType: 'other',
        accessedAt: new Date().toISOString().split('T')[0] + 'T00:00:00.000Z',
        reliability: 'Medium',
        quotedFacts: [
          `Canonical family "${name}" with aliases: ${aliases.join(', ')}.`,
          `Primary regions: ${family.regions.slice(0, 4).join(', ')}.`,
        ],
      },
    ],
    extractedFacts: {
      namesAndAliases: [name, ...aliases],
      regions: [
        `macro:${region}`,
        ...family.regions.slice(0, 3).map(r => `region:${r}`),
      ],
      ingredients: [],
      techniques: safeShared.slice(0, 3),
      sensoryDescriptors: safeNostalgia.slice(0, 3),
      culturalOccasions: inferFoodForms(family).map(t => t.replace('foodForms.', '')),
      regionalVariants: family.aliases.slice(0, 4),
    },
    uncertainty: [
      'Wikidata structured data provides broad labels and descriptions, not family-specific taste memory.',
      'Specific household name, sweetness, sourness, spice level, texture, serving ritual, and ingredient substitutions need user or family confirmation.',
      'This pantry record is a starting context for small-model grounding, not a final dish identification.',
    ],
    confidence: 'Medium',
    createdAt: new Date().toISOString().split('T')[0] + 'T00:00:00.000Z',
  };
}

const DIASPORA_REGIONS = [
  'Community diaspora',
  'Global diaspora',
  'Naming and alias context',
  'Sensory mechanism context',
  'Migration corridor',
  'Diaspora table',
  'Local diaspora',
];

const items = [];
let fixtureIndex = existingFixtures.fixtures.length;

for (const family of unreachableFamilies) {
  const regions = [...family.regions];
  // Pad to 7 regions with diaspora contexts
  while (regions.length < 7) {
    const next = DIASPORA_REGIONS[(regions.length - family.regions.length) % DIASPORA_REGIONS.length];
    if (!regions.includes(next)) regions.push(next);
    else regions.push(`${next} ${regions.length}`);
  }
  regions.length = 7;

  const cluster = inferCluster(family);
  const coverageTags = buildCoverageTags(family, regions[0]);

  for (let i = 0; i < 7; i++) {
    const region = regions[i];
    const seedId = `${family.canonicalName}-${i}-${region.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const fixture = {
      seedId,
      cacheTarget: {
        dishFamily: family.canonicalName,
        region,
      },
      sourceIds: ['wikidata-structured-food-data'],
      coverageTags: buildCoverageTags(family, region),
      record: buildRecord(family, region),
    };

    const seedCoverageTags = buildCoverageTags(family, region);
    const seedForms = inferFoodForms(family);
    const seedMechanisms = inferMechanisms(family);

    const seed = {
      id: seedId,
      forms: seedForms,
      regions: [
        `macro:${region}`,
        ...family.regions.slice(0, 3).map(r => `region:${r}`),
      ],
      nameSignals: family.aliases.slice(0, 4),
      mechanisms: seedMechanisms,
      querySeeds: [
        `${family.canonicalName} regional variants`,
        `${family.aliases[0] || family.canonicalName} ${region} family memory`,
        `${family.canonicalName} ${region} diaspora variations`,
      ],
      cacheTargets: [{ dishFamily: family.canonicalName, region }],
      coverageTags: seedCoverageTags,
      provenance: {
        sourceType: 'curated seed hypothesis',
        notes: [
          `Use for ${family.canonicalName} memories with ${family.sharedElements.slice(0, 2).map(sanitizeCure).join(', ')} clues.`,
        ],
      },
    };

    const task = {
      id: `warm-${seedId}`,
      seedId,
      cacheTarget: { dishFamily: family.canonicalName, region },
      coverageTags: seedCoverageTags.slice(0, 3),
      qualityTriggers: ['frequent_memory_type', 'missing_region', 'cache_unavailable'],
      doneWhen: ['typed ResearchRecord has aliases, regions, ingredients, sensory descriptors, uncertainty, and confidence'],
      provenance: {
        sourceType: 'curated seed hypothesis',
        notes: ['Warm only from approved public research artifacts.'],
      },
    };

    const taxonomyMapping = {
      dishFamily: family.canonicalName,
      primaryCluster: cluster,
      supportClusters: [],
      currentRecordCount: 7,
      currentRegions: regions,
      coverageTags: [...new Set([...coverageTags, ...buildCoverageTags(family, regions[0])])],
      targetRecordFloor: 5,
      targetDiversity: [
        'at least one region/locality record when known',
        'at least one diaspora or migration-context record when plausible',
        'at least one sensory-mechanism record grounded in aroma, texture, temperature, acid, fat, or sauce balance',
        'at least one naming record covering alias, transliteration, family nickname, menu name, or common typo when relevant',
      ],
      populationPriority: 'maintain',
    };

    items.push({ seed, task, fixture, taxonomyMapping });
    fixtureIndex++;
  }
}

const plan = { items };
console.log(JSON.stringify(plan, null, 2));
