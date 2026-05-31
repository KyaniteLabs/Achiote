export type ValidationIssue = {
  path: string;
  message: string;
};

type Meta = {
  version?: unknown;
  description?: unknown;
  confidence?: unknown;
  sources?: unknown;
  provenance?: unknown;
  [key: string]: unknown;
};

type DishFamily = {
  canonicalName?: unknown;
  aliases?: unknown;
  transliterations?: Record<string, unknown>;
  regions?: unknown;
  sharedElements?: unknown;
  divergentElements?: unknown;
  nostalgiaTriggers?: unknown;
  provenance?: unknown;
  [key: string]: unknown;
};

type Ingredient = {
  name?: unknown;
  aliases?: unknown;
  compounds?: unknown;
  sensoryContribution?: { aroma?: unknown; flavor?: unknown };
  substitutionGroup?: unknown;
  commonIn?: unknown;
  provenance?: unknown;
  [key: string]: unknown;
};

type Region = {
  cities?: unknown;
  majorEthnicCorridors?: unknown;
  majorStores?: Record<string, unknown>;
  [key: string]: unknown;
};

type SensoryDimension = {
  description?: unknown;
  scale?: unknown;
  categories?: unknown;
  nostalgiaIndicators?: unknown;
  [key: string]: unknown;
};

type MemoryHintPattern = {
  label?: unknown;
  regexSource?: unknown;
  flags?: unknown;
  [key: string]: unknown;
};

type MemoryHints = {
  meta: Meta;
  ingredients: unknown;
  cookingMethods: MemoryHintPattern[];
  regionPatterns: MemoryHintPattern[];
  regionFamilyMap: Record<string, unknown>;
};

type CoverageAxisValue = {
  id?: unknown;
  label?: unknown;
  description?: unknown;
};

type CoverageAxis = {
  label?: unknown;
  description?: unknown;
  values?: CoverageAxisValue[];
};

export type GlobalCoverageMatrix = {
  meta: Meta;
  axes: Record<string, CoverageAxis>;
};

type CacheTarget = {
  dishFamily?: unknown;
  region?: unknown;
};

export type ReferenceSeedEntry = {
  id?: unknown;
  forms?: unknown;
  regions?: unknown;
  nameSignals?: unknown;
  mechanisms?: unknown;
  querySeeds?: unknown;
  cacheTargets?: CacheTarget[];
  coverageTags?: unknown;
  provenance?: unknown;
};

export type ReferenceSeedQueue = {
  meta: Meta;
  seeds: ReferenceSeedEntry[];
};

type CacheWarmingTask = {
  id?: unknown;
  seedId?: unknown;
  cacheTarget?: CacheTarget;
  coverageTags?: unknown;
  qualityTriggers?: unknown;
  doneWhen?: unknown;
  provenance?: unknown;
};

export type CacheWarmingManifest = {
  meta: Meta;
  tasks: CacheWarmingTask[];
};

type SourceLicense = {
  id?: unknown;
  name?: unknown;
  url?: unknown;
  status?: unknown;
};

export type ReferenceSourceEntry = {
  id?: unknown;
  label?: unknown;
  homepage?: unknown;
  license?: SourceLicense;
  fixturePolicy?: unknown;
  coverageRoles?: unknown;
  allowedUses?: unknown;
  disallowedUses?: unknown;
  operatorNotes?: unknown;
};

export type ReferenceSourceRegistry = {
  meta: Meta;
  sources: ReferenceSourceEntry[];
  disallowedPatterns: string[];
};

export type ReferencePantryFixtureEntry = {
  seedId?: unknown;
  cacheTarget?: CacheTarget;
  sourceIds?: unknown;
  coverageTags?: unknown;
  record?: unknown;
};

export type ReferencePantryFixtureBatch = {
  meta: Meta;
  fixtures: ReferencePantryFixtureEntry[];
};

type ReferenceFamilyCluster = {
  id?: unknown;
  label?: unknown;
  description?: unknown;
  primaryCoverageTags?: unknown;
  anchorMechanisms?: unknown;
  targetRecordFloor?: unknown;
  populationStrategy?: unknown;
};

type ReferenceFamilyMapping = {
  dishFamily?: unknown;
  primaryCluster?: unknown;
  supportClusters?: unknown;
  currentRecordCount?: unknown;
  currentRegions?: unknown;
  coverageTags?: unknown;
  targetRecordFloor?: unknown;
  targetDiversity?: unknown;
  populationPriority?: unknown;
};

export type ReferenceFamilyTaxonomy = {
  meta: Meta;
  clusterPolicy: {
    coverageUniverse?: unknown;
    currentCoverageAxesAreCompleteClaim?: unknown;
    requiredCoverageAxesScope?: unknown;
    expansionBacklogAxes?: unknown;
    familyCountIsNotSuccessMetric?: unknown;
    minimumTargetRecordsPerFamily?: unknown;
    minimumTargetRecordsPerCluster?: unknown;
    requiredCoverageAxes?: unknown;
    populationOrder?: unknown;
  };
  clusters: ReferenceFamilyCluster[];
  familyMappings: ReferenceFamilyMapping[];
};

export type InferenceBurdenType =
  | 'normalization'
  | 'intent_routing'
  | 'context_packing'
  | 'reference_retrieval'
  | 'workflow_control'
  | 'evidence_bookkeeping'
  | 'safety_policy'
  | 'output_contract'
  | 'quality_evaluation'
  | 'sensory_mechanism'
  | 'availability_substitution'
  | 'privacy_consent';

type InferenceBurdenEntry = {
  id?: unknown;
  burdenType?: unknown;
  title?: unknown;
  currentSurfaceRefs?: unknown;
  currentModelBurden?: unknown;
  dataEngineeringMove?: unknown;
  deterministicOwner?: unknown;
  leverage?: unknown;
  rigidityRisk?: unknown;
  candidateArtifacts?: unknown;
  promptRemovalTargets?: unknown;
  acceptanceSignals?: unknown;
  preserveLatitude?: unknown;
  modelKeeps?: unknown;
  riskIfOverRigid?: unknown;
  status?: unknown;
};

export type InferenceBurdenInventory = {
  meta: Meta;
  burdenTypes: InferenceBurdenType[];
  deterministicOwners: string[];
  burdens: InferenceBurdenEntry[];
};

export type BundledDataSet = {
  dishFamilies: { meta: Meta; families: DishFamily[] };
  ingredients: { meta: Meta; ingredients: Record<string, Ingredient> };
  regionalAvailability: { meta: Meta; regions: Record<string, Region> };
  sensoryProfiles: {
    meta: Meta;
    dimensions: Record<string, SensoryDimension | undefined>;
    nostalgiaCriticalCriteria?: unknown;
  };
  memoryHints: MemoryHints;
  globalCoverageMatrix: GlobalCoverageMatrix;
  referenceSeedQueue: ReferenceSeedQueue;
  cacheWarmingManifest: CacheWarmingManifest;
  referenceSourceRegistry: ReferenceSourceRegistry;
  referenceFamilyTaxonomy: ReferenceFamilyTaxonomy;
  referencePantryFixtures?: ReferencePantryFixtureBatch;
  inferenceBurdenInventory: InferenceBurdenInventory;
};

const VALID_CONFIDENCE = new Set(['High', 'Medium', 'Low']);
const VALID_FIXTURE_POLICIES = new Set(['allowed', 'manual_review', 'rejected']);
const REQUIRED_SENSORY_DIMENSIONS = ['aroma', 'texture', 'flavor', 'visual', 'temperature'];
const VALID_INFERENCE_BURDEN_TYPES = new Set<InferenceBurdenType>([
  'normalization',
  'intent_routing',
  'context_packing',
  'reference_retrieval',
  'workflow_control',
  'evidence_bookkeeping',
  'safety_policy',
  'output_contract',
  'quality_evaluation',
  'sensory_mechanism',
  'availability_substitution',
  'privacy_consent',
]);
const VALID_INFERENCE_OWNERS = new Set([
  'data',
  'retrieval',
  'controller',
  'validator',
  'formatter',
  'observability',
  'consent_gate',
]);
const VALID_INFERENCE_STATUSES = new Set(['candidate', 'partially_supported', 'ready_to_extract']);
const VALID_POPULATION_PRIORITIES = new Set(['high', 'medium', 'maintain']);
export const ARTIFICIAL_CACHE_FAMILY_PATTERN = /(?:-liquids-and-comfort|-protein-vegetable-mains|-sweet-ritual-foods|-handheld-social-foods|-staple-starches|-acid-heat-condiment|-cue)$/;
export const ARTIFICIAL_CACHE_REGION_PATTERN = /\b(?:comparison|variants?|cue)\b/i;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function pushIssue(issues: ValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function validateNonEmptyString(issues: ValidationIssue[], path: string, value: unknown): void {
  if (!isNonEmptyString(value)) {
    pushIssue(issues, path, 'must be a non-empty string');
  }
}

function validateUrlString(issues: ValidationIssue[], path: string, value: unknown): void {
  if (!isNonEmptyString(value)) {
    pushIssue(issues, path, 'must be a non-empty string');
    return;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      pushIssue(issues, path, 'must be an http(s) URL');
    }
  } catch {
    pushIssue(issues, path, 'must be an http(s) URL');
  }
}

function validateStringArray(
  issues: ValidationIssue[],
  path: string,
  value: unknown,
  options: { requireNonEmpty?: boolean; unique?: boolean } = {},
): void {
  if (!Array.isArray(value)) {
    pushIssue(issues, path, 'must be an array');
    return;
  }

  if (options.requireNonEmpty && value.length === 0) {
    pushIssue(issues, path, 'must be a non-empty array');
  }

  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isNonEmptyString(entry)) {
      pushIssue(issues, entryPath, 'must be a non-empty string');
      return;
    }

    const normalized = entry.trim().toLowerCase();
    if (options.unique && seen.has(normalized)) {
      pushIssue(issues, entryPath, 'duplicate value');
    }
    seen.add(normalized);
  });
}

function validateNumberRange(issues: ValidationIssue[], path: string, value: unknown, min: number, max: number): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    pushIssue(issues, path, `must be an integer between ${min} and ${max}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateNonEmptyRecord(issues: ValidationIssue[], path: string, value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    pushIssue(issues, path, 'must be a non-empty object');
    return false;
  }

  if (Object.keys(value).length === 0) {
    pushIssue(issues, path, 'must be a non-empty object');
    return false;
  }

  return true;
}

function validateProvenance(issues: ValidationIssue[], path: string, value: unknown): void {
  if (typeof value === 'string') {
    validateNonEmptyString(issues, path, value);
    return;
  }

  if (!validateNonEmptyRecord(issues, path, value)) return;

  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${path}.${key}`;
    if (!isNonEmptyString(key)) {
      pushIssue(issues, entryPath, 'must use a non-empty string key');
    }

    if (Array.isArray(entry)) {
      validateStringArray(issues, entryPath, entry, { requireNonEmpty: true, unique: true });
    } else {
      validateNonEmptyString(issues, entryPath, entry);
    }
  }
}

function validateRequiredProvenance(issues: ValidationIssue[], path: string, value: unknown): void {
  if (value === undefined) {
    pushIssue(issues, path, 'provenance is required');
    return;
  }
  validateProvenance(issues, path, value);
}

function validateMeta(issues: ValidationIssue[], path: string, meta: Meta): void {
  validateNonEmptyString(issues, `${path}.version`, meta.version);
  validateNonEmptyString(issues, `${path}.description`, meta.description);

  if (meta.confidence !== undefined && (!isNonEmptyString(meta.confidence) || !VALID_CONFIDENCE.has(meta.confidence))) {
    pushIssue(issues, `${path}.confidence`, 'must be High, Medium, or Low');
  }

  if (meta.sources !== undefined) {
    validateStringArray(issues, `${path}.sources`, meta.sources, { requireNonEmpty: true, unique: true });
  }

  if (meta.provenance !== undefined) {
    validateProvenance(issues, `${path}.provenance`, meta.provenance);
  }
}

function validateDishFamilies(issues: ValidationIssue[], data: BundledDataSet['dishFamilies']): void {
  validateMeta(issues, 'dishFamilies.meta', data.meta);

  const canonicalNames = new Set<string>();
  data.families.forEach((family, familyIndex) => {
    const base = `dishFamilies.families[${familyIndex}]`;
    validateNonEmptyString(issues, `${base}.canonicalName`, family.canonicalName);
    if (isNonEmptyString(family.canonicalName)) {
      const canonical = family.canonicalName.trim().toLowerCase();
      if (canonicalNames.has(canonical)) {
        pushIssue(issues, `${base}.canonicalName`, 'duplicate canonicalName');
      }
      canonicalNames.add(canonical);
    }

    validateStringArray(issues, `${base}.aliases`, family.aliases, { requireNonEmpty: true, unique: true });
    validateStringArray(issues, `${base}.regions`, family.regions, { requireNonEmpty: true, unique: true });
    validateStringArray(issues, `${base}.sharedElements`, family.sharedElements, { requireNonEmpty: true, unique: true });
    validateStringArray(issues, `${base}.divergentElements`, family.divergentElements, { requireNonEmpty: true, unique: true });
    validateStringArray(issues, `${base}.nostalgiaTriggers`, family.nostalgiaTriggers, { requireNonEmpty: true, unique: true });
    validateRequiredProvenance(issues, `${base}.provenance`, family.provenance);

    if (!validateNonEmptyRecord(issues, `${base}.transliterations`, family.transliterations)) {
      return;
    }

    for (const [language, forms] of Object.entries(family.transliterations)) {
      if (!isNonEmptyString(language)) {
        pushIssue(issues, `${base}.transliterations.${language}`, 'must use a non-empty string key');
      }
      validateStringArray(issues, `${base}.transliterations.${language}`, forms, { requireNonEmpty: true, unique: true });
    }

    const variants = (family as { variants?: unknown }).variants;
    if (variants !== undefined) {
      if (!Array.isArray(variants)) {
        pushIssue(issues, `${base}.variants`, 'must be an array');
      } else {
        variants.forEach((variant, variantIndex) => {
          const variantPath = `${base}.variants[${variantIndex}]`;
          const value = variant as {
            name?: unknown;
            aliases?: unknown;
            regions?: unknown;
            distinguishingElements?: unknown;
            clarificationPrompt?: unknown;
          };
          validateNonEmptyString(issues, `${variantPath}.name`, value.name);
          validateStringArray(issues, `${variantPath}.aliases`, value.aliases, { requireNonEmpty: true, unique: true });
          validateStringArray(issues, `${variantPath}.regions`, value.regions, { requireNonEmpty: true, unique: true });
          validateStringArray(issues, `${variantPath}.distinguishingElements`, value.distinguishingElements, {
            requireNonEmpty: true,
            unique: true,
          });
          validateNonEmptyString(issues, `${variantPath}.clarificationPrompt`, value.clarificationPrompt);
        });
      }
    }

  });
}

function validateIngredients(issues: ValidationIssue[], data: BundledDataSet['ingredients']): void {
  validateMeta(issues, 'ingredients.meta', data.meta);

  const ingredientNames = new Set<string>();
  for (const [key, ingredient] of Object.entries(data.ingredients)) {
    const base = `ingredients.ingredients.${key}`;
    validateNonEmptyString(issues, `${base}.name`, ingredient.name);
    if (isNonEmptyString(ingredient.name)) {
      const normalized = ingredient.name.trim().toLowerCase();
      if (ingredientNames.has(normalized)) {
        pushIssue(issues, `${base}.name`, 'duplicate ingredient name');
      }
      ingredientNames.add(normalized);
    }

    validateStringArray(issues, `${base}.aliases`, ingredient.aliases, { requireNonEmpty: true, unique: true });
    validateStringArray(issues, `${base}.compounds`, ingredient.compounds, { requireNonEmpty: true, unique: true });
    validateNonEmptyString(issues, `${base}.sensoryContribution.aroma`, ingredient.sensoryContribution?.aroma);
    validateNonEmptyString(issues, `${base}.sensoryContribution.flavor`, ingredient.sensoryContribution?.flavor);
    validateNonEmptyString(issues, `${base}.substitutionGroup`, ingredient.substitutionGroup);
    validateStringArray(issues, `${base}.commonIn`, ingredient.commonIn, { requireNonEmpty: true, unique: true });
    validateRequiredProvenance(issues, `${base}.provenance`, ingredient.provenance);
  }
}

function validateRegex(issues: ValidationIssue[], path: string, source: unknown, flags: unknown): void {
  if (!isNonEmptyString(source)) {
    pushIssue(issues, path, 'must be a non-empty string');
    return;
  }

  if (flags !== undefined && !isNonEmptyString(flags)) {
    pushIssue(issues, path.replace(/\.regexSource$/, '.flags'), 'must be a non-empty string');
    return;
  }
  if (typeof flags === 'string' && /[gy]/.test(flags)) {
    pushIssue(issues, path.replace(/\.regexSource$/, '.flags'), 'must not use stateful g or y flags');
    return;
  }

  try {
    new RegExp(source, typeof flags === 'string' ? flags : undefined);
  } catch {
    pushIssue(issues, path, 'must be a valid regular expression');
  }
}

function validateLabeledRegexHints(issues: ValidationIssue[], path: string, value: unknown, options: { requireRegex?: boolean } = {}): void {
  if (!Array.isArray(value)) {
    pushIssue(issues, path, 'must be an array');
    return;
  }

  if (value.length === 0) {
    pushIssue(issues, path, 'must be a non-empty array');
    return;
  }

  const labels = new Set<string>();
  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      pushIssue(issues, entryPath, 'must be an object');
      return;
    }

    validateNonEmptyString(issues, `${entryPath}.label`, entry.label);
    if (isNonEmptyString(entry.label)) {
      const normalized = entry.label.trim().toLowerCase();
      if (labels.has(normalized)) {
        pushIssue(issues, `${entryPath}.label`, 'duplicate label');
      }
      labels.add(normalized);
    }

    if (entry.regexSource !== undefined || options.requireRegex) {
      validateRegex(issues, `${entryPath}.regexSource`, entry.regexSource, entry.flags);
    }
  });
}

function validateRegionFamilyMap(issues: ValidationIssue[], path: string, value: unknown): void {
  if (!validateNonEmptyRecord(issues, path, value)) return;

  for (const [region, families] of Object.entries(value)) {
    if (!isNonEmptyString(region)) {
      pushIssue(issues, `${path}.${region}`, 'must use a non-empty string key');
    }
    validateStringArray(issues, `${path}.${region}`, families, { requireNonEmpty: true, unique: true });
  }
}

function validateMemoryHints(issues: ValidationIssue[], data: BundledDataSet['memoryHints']): void {
  validateMeta(issues, 'memoryHints.meta', data.meta);
  validateStringArray(issues, 'memoryHints.ingredients', data.ingredients, { requireNonEmpty: true, unique: true });
  validateLabeledRegexHints(issues, 'memoryHints.cookingMethods', data.cookingMethods);
  validateLabeledRegexHints(issues, 'memoryHints.regionPatterns', data.regionPatterns, { requireRegex: true });
  validateRegionFamilyMap(issues, 'memoryHints.regionFamilyMap', data.regionFamilyMap);
}

function validateRegionalAvailability(issues: ValidationIssue[], data: BundledDataSet['regionalAvailability']): void {
  validateMeta(issues, 'regionalAvailability.meta', data.meta);

  for (const [key, region] of Object.entries(data.regions)) {
    const base = `regionalAvailability.regions.${key}`;
    if (!isNonEmptyString(key)) {
      pushIssue(issues, base, 'must use a non-empty string key');
    }
    validateStringArray(issues, `${base}.cities`, region.cities, { requireNonEmpty: true, unique: true });

    if (!Array.isArray(region.majorEthnicCorridors)) {
      pushIssue(issues, `${base}.majorEthnicCorridors`, 'must be an array');
    } else {
      region.majorEthnicCorridors.forEach((corridor, index) => {
        const corridorPath = `${base}.majorEthnicCorridors[${index}]`;
        const value = corridor as { name?: unknown; city?: unknown; cuisines?: unknown };
        validateNonEmptyString(issues, `${corridorPath}.name`, value.name);
        validateNonEmptyString(issues, `${corridorPath}.city`, value.city);
        validateStringArray(issues, `${corridorPath}.cuisines`, value.cuisines, { requireNonEmpty: true, unique: true });
      });
    }

    if (!validateNonEmptyRecord(issues, `${base}.majorStores`, region.majorStores)) {
      continue;
    }

    for (const [category, stores] of Object.entries(region.majorStores)) {
      if (!isNonEmptyString(category)) {
        pushIssue(issues, `${base}.majorStores.${category}`, 'must use a non-empty string key');
      }
      validateStringArray(issues, `${base}.majorStores.${category}`, stores, { requireNonEmpty: true, unique: true });
    }
  }
}

function validateSensoryProfiles(issues: ValidationIssue[], data: BundledDataSet['sensoryProfiles']): void {
  validateMeta(issues, 'sensoryProfiles.meta', data.meta);
  validateNonEmptyString(issues, 'sensoryProfiles.nostalgiaCriticalCriteria', data.nostalgiaCriticalCriteria);

  for (const dimensionName of REQUIRED_SENSORY_DIMENSIONS) {
    const dimension = data.dimensions[dimensionName];
    const base = `sensoryProfiles.dimensions.${dimensionName}`;
    if (!dimension) {
      pushIssue(issues, base, 'required dimension is missing');
      continue;
    }

    validateNonEmptyString(issues, `${base}.description`, dimension.description);
    validateStringArray(issues, `${base}.nostalgiaIndicators`, dimension.nostalgiaIndicators, {
      requireNonEmpty: true,
      unique: true,
    });

    if (dimension.scale === undefined && dimension.categories === undefined) {
      pushIssue(issues, base, 'must define scale or categories');
    }

    if (dimension.scale !== undefined) {
      validateNonEmptyString(issues, `${base}.scale`, dimension.scale);
    }

    if (dimension.categories !== undefined) {
      validateStringArray(issues, `${base}.categories`, dimension.categories, { requireNonEmpty: true, unique: true });
    }
  }
}

function validateGlobalCoverageMatrix(issues: ValidationIssue[], data: GlobalCoverageMatrix): Set<string> {
  validateMeta(issues, 'globalCoverageMatrix.meta', data.meta);
  if (!validateNonEmptyRecord(issues, 'globalCoverageMatrix.axes', data.axes)) return new Set();

  const tags = new Set<string>();
  for (const [axisId, axis] of Object.entries(data.axes)) {
    const base = `globalCoverageMatrix.axes.${axisId}`;
    if (!isNonEmptyString(axisId)) pushIssue(issues, base, 'must use a non-empty string key');
    validateNonEmptyString(issues, `${base}.label`, axis.label);
    validateNonEmptyString(issues, `${base}.description`, axis.description);
    if (!Array.isArray(axis.values)) {
      pushIssue(issues, `${base}.values`, 'must be an array');
      continue;
    }
    if (axis.values.length === 0) pushIssue(issues, `${base}.values`, 'must be a non-empty array');

    const valueIds = new Set<string>();
    axis.values.forEach((value, index) => {
      const valuePath = `${base}.values[${index}]`;
      validateNonEmptyString(issues, `${valuePath}.id`, value.id);
      validateNonEmptyString(issues, `${valuePath}.label`, value.label);
      validateNonEmptyString(issues, `${valuePath}.description`, value.description);
      if (!isNonEmptyString(value.id)) return;
      const normalized = value.id.trim();
      if (valueIds.has(normalized)) {
        pushIssue(issues, `${valuePath}.id`, 'duplicate value id');
      }
      valueIds.add(normalized);
      tags.add(`${axisId}.${normalized}`);
    });
  }

  return tags;
}

function validateCoverageTags(
  issues: ValidationIssue[],
  path: string,
  value: unknown,
  validTags: Set<string>,
  options: { requireNonEmpty?: boolean; allowedAxisIds?: string[] } = { requireNonEmpty: true },
): void {
  validateStringArray(issues, path, value, { requireNonEmpty: options.requireNonEmpty, unique: true });
  if (!Array.isArray(value)) return;
  value.forEach((tag, index) => {
    if (isNonEmptyString(tag) && !validTags.has(tag)) {
      pushIssue(issues, `${path}[${index}]`, 'unknown coverage tag');
    } else if (isNonEmptyString(tag) && options.allowedAxisIds && !options.allowedAxisIds.some((axisId) => tag.startsWith(`${axisId}.`))) {
      pushIssue(issues, `${path}[${index}]`, `must use ${options.allowedAxisIds.join(' or ')} coverage tag`);
    }
  });
}

function validateCacheTarget(issues: ValidationIssue[], path: string, value: unknown): void {
  if (!isRecord(value)) {
    pushIssue(issues, path, 'must be an object');
    return;
  }
  validateNonEmptyString(issues, `${path}.dishFamily`, value.dishFamily);
  validateNonEmptyString(issues, `${path}.region`, value.region);
  if (isNonEmptyString(value.dishFamily) && ARTIFICIAL_CACHE_FAMILY_PATTERN.test(value.dishFamily.trim())) {
    pushIssue(issues, `${path}.dishFamily`, 'must not encode coverage band or canary cue taxonomy');
  }
  if (isNonEmptyString(value.region) && ARTIFICIAL_CACHE_REGION_PATTERN.test(value.region.trim())) {
    pushIssue(issues, `${path}.region`, 'must not encode comparison, variant, or cue context');
  }
}

function validateCacheTargets(issues: ValidationIssue[], path: string, value: unknown): void {
  if (!Array.isArray(value)) {
    pushIssue(issues, path, 'must be an array');
    return;
  }
  if (value.length === 0) pushIssue(issues, path, 'must be a non-empty array');
  value.forEach((target, index) => validateCacheTarget(issues, `${path}[${index}]`, target));
}

function validateReferenceSeedQueue(
  issues: ValidationIssue[],
  data: ReferenceSeedQueue,
  validTags: Set<string>,
): Set<string> {
  validateMeta(issues, 'referenceSeedQueue.meta', data.meta);
  const seedIds = new Set<string>();
  if (!Array.isArray(data.seeds)) {
    pushIssue(issues, 'referenceSeedQueue.seeds', 'must be an array');
    return seedIds;
  }
  if (data.seeds.length === 0) pushIssue(issues, 'referenceSeedQueue.seeds', 'must be a non-empty array');

  data.seeds.forEach((seed, index) => {
    const base = `referenceSeedQueue.seeds[${index}]`;
    validateNonEmptyString(issues, `${base}.id`, seed.id);
    if (isNonEmptyString(seed.id)) {
      if (seedIds.has(seed.id)) pushIssue(issues, `${base}.id`, 'duplicate seed id');
      seedIds.add(seed.id);
    }
    validateCoverageTags(issues, `${base}.forms`, seed.forms, validTags, { allowedAxisIds: ['foodForms'] });
    validateStringArray(issues, `${base}.regions`, seed.regions, { requireNonEmpty: true, unique: true });
    validateStringArray(issues, `${base}.nameSignals`, seed.nameSignals, { requireNonEmpty: true, unique: true });
    validateCoverageTags(issues, `${base}.mechanisms`, seed.mechanisms, validTags, { allowedAxisIds: ['mechanisms'] });
    validateStringArray(issues, `${base}.querySeeds`, seed.querySeeds, { requireNonEmpty: true, unique: true });
    validateCacheTargets(issues, `${base}.cacheTargets`, seed.cacheTargets);
    validateCoverageTags(issues, `${base}.coverageTags`, seed.coverageTags, validTags);
    validateRequiredProvenance(issues, `${base}.provenance`, seed.provenance);
  });

  return seedIds;
}

function validateCacheWarmingManifest(
  issues: ValidationIssue[],
  data: CacheWarmingManifest,
  validTags: Set<string>,
  seedIds: Set<string>,
): void {
  validateMeta(issues, 'cacheWarmingManifest.meta', data.meta);
  if (!Array.isArray(data.tasks)) {
    pushIssue(issues, 'cacheWarmingManifest.tasks', 'must be an array');
    return;
  }
  if (data.tasks.length === 0) pushIssue(issues, 'cacheWarmingManifest.tasks', 'must be a non-empty array');

  const taskIds = new Set<string>();
  data.tasks.forEach((task, index) => {
    const base = `cacheWarmingManifest.tasks[${index}]`;
    validateNonEmptyString(issues, `${base}.id`, task.id);
    if (isNonEmptyString(task.id)) {
      if (taskIds.has(task.id)) pushIssue(issues, `${base}.id`, 'duplicate task id');
      taskIds.add(task.id);
    }
    validateNonEmptyString(issues, `${base}.seedId`, task.seedId);
    if (isNonEmptyString(task.seedId) && !seedIds.has(task.seedId)) {
      pushIssue(issues, `${base}.seedId`, 'unknown seed id');
    }
    validateCacheTarget(issues, `${base}.cacheTarget`, task.cacheTarget);
    validateCoverageTags(issues, `${base}.coverageTags`, task.coverageTags, validTags);
    validateStringArray(issues, `${base}.qualityTriggers`, task.qualityTriggers, { requireNonEmpty: true, unique: true });
    validateStringArray(issues, `${base}.doneWhen`, task.doneWhen, { requireNonEmpty: true, unique: true });
    validateRequiredProvenance(issues, `${base}.provenance`, task.provenance);
  });
}

function validateReferenceSourceRegistry(issues: ValidationIssue[], data: ReferenceSourceRegistry): void {
  validateMeta(issues, 'referenceSourceRegistry.meta', data.meta);
  validateStringArray(issues, 'referenceSourceRegistry.disallowedPatterns', data.disallowedPatterns, {
    requireNonEmpty: true,
    unique: true,
  });

  if (!Array.isArray(data.sources)) {
    pushIssue(issues, 'referenceSourceRegistry.sources', 'must be an array');
    return;
  }
  if (data.sources.length === 0) pushIssue(issues, 'referenceSourceRegistry.sources', 'must be a non-empty array');

  const sourceIds = new Set<string>();
  data.sources.forEach((source, index) => {
    const base = `referenceSourceRegistry.sources[${index}]`;
    validateNonEmptyString(issues, `${base}.id`, source.id);
    if (isNonEmptyString(source.id)) {
      if (sourceIds.has(source.id)) pushIssue(issues, `${base}.id`, 'duplicate source id');
      sourceIds.add(source.id);
    }
    validateNonEmptyString(issues, `${base}.label`, source.label);
    validateUrlString(issues, `${base}.homepage`, source.homepage);

    if (!isRecord(source.license)) {
      pushIssue(issues, `${base}.license`, 'must be an object');
    } else {
      validateNonEmptyString(issues, `${base}.license.id`, source.license.id);
      validateNonEmptyString(issues, `${base}.license.name`, source.license.name);
      validateUrlString(issues, `${base}.license.url`, source.license.url);
      validateNonEmptyString(issues, `${base}.license.status`, source.license.status);
    }

    if (!isNonEmptyString(source.fixturePolicy) || !VALID_FIXTURE_POLICIES.has(source.fixturePolicy)) {
      pushIssue(issues, `${base}.fixturePolicy`, 'must be allowed, manual_review, or rejected');
    }

    validateStringArray(issues, `${base}.coverageRoles`, source.coverageRoles, { requireNonEmpty: true, unique: true });
    validateStringArray(issues, `${base}.allowedUses`, source.allowedUses, { requireNonEmpty: true, unique: true });
    validateStringArray(issues, `${base}.disallowedUses`, source.disallowedUses, { requireNonEmpty: true, unique: true });
    validateStringArray(issues, `${base}.operatorNotes`, source.operatorNotes, { requireNonEmpty: true, unique: true });
  });
}

function validateReferenceFamilyTaxonomy(
  issues: ValidationIssue[],
  data: ReferenceFamilyTaxonomy,
  validTags: Set<string>,
  fixtureFamilies: Set<string>,
): void {
  validateMeta(issues, 'referenceFamilyTaxonomy.meta', data.meta);

  const policy = data.clusterPolicy;
  if (!isRecord(policy)) {
    pushIssue(issues, 'referenceFamilyTaxonomy.clusterPolicy', 'must be an object');
  } else {
    if (policy.coverageUniverse !== 'open_world') {
      pushIssue(issues, 'referenceFamilyTaxonomy.clusterPolicy.coverageUniverse', 'must be open_world');
    }
    if (policy.currentCoverageAxesAreCompleteClaim !== false) {
      pushIssue(issues, 'referenceFamilyTaxonomy.clusterPolicy.currentCoverageAxesAreCompleteClaim', 'must be false');
    }
    validateNonEmptyString(issues, 'referenceFamilyTaxonomy.clusterPolicy.requiredCoverageAxesScope', policy.requiredCoverageAxesScope);
    validateStringArray(issues, 'referenceFamilyTaxonomy.clusterPolicy.expansionBacklogAxes', policy.expansionBacklogAxes, {
      requireNonEmpty: true,
      unique: true,
    });
    if (policy.familyCountIsNotSuccessMetric !== true) {
      pushIssue(issues, 'referenceFamilyTaxonomy.clusterPolicy.familyCountIsNotSuccessMetric', 'must be true');
    }
    validateNumberRange(issues, 'referenceFamilyTaxonomy.clusterPolicy.minimumTargetRecordsPerFamily', policy.minimumTargetRecordsPerFamily, 1, 100);
    validateNumberRange(issues, 'referenceFamilyTaxonomy.clusterPolicy.minimumTargetRecordsPerCluster', policy.minimumTargetRecordsPerCluster, 1, 1000);
    validateStringArray(issues, 'referenceFamilyTaxonomy.clusterPolicy.requiredCoverageAxes', policy.requiredCoverageAxes, {
      requireNonEmpty: true,
      unique: true,
    });
    validateStringArray(issues, 'referenceFamilyTaxonomy.clusterPolicy.populationOrder', policy.populationOrder, {
      requireNonEmpty: true,
      unique: true,
    });
  }

  if (!Array.isArray(data.clusters)) {
    pushIssue(issues, 'referenceFamilyTaxonomy.clusters', 'must be an array');
    return;
  }
  if (data.clusters.length === 0) pushIssue(issues, 'referenceFamilyTaxonomy.clusters', 'must be a non-empty array');

  const clusterIds = new Set<string>();
  data.clusters.forEach((cluster, index) => {
    const base = `referenceFamilyTaxonomy.clusters[${index}]`;
    validateNonEmptyString(issues, `${base}.id`, cluster.id);
    if (isNonEmptyString(cluster.id)) {
      if (clusterIds.has(cluster.id)) pushIssue(issues, `${base}.id`, 'duplicate cluster id');
      clusterIds.add(cluster.id);
    }
    validateNonEmptyString(issues, `${base}.label`, cluster.label);
    validateNonEmptyString(issues, `${base}.description`, cluster.description);
    validateCoverageTags(issues, `${base}.primaryCoverageTags`, cluster.primaryCoverageTags, validTags);
    validateCoverageTags(issues, `${base}.anchorMechanisms`, cluster.anchorMechanisms, validTags);
    validateNumberRange(issues, `${base}.targetRecordFloor`, cluster.targetRecordFloor, 1, 1000);
    validateStringArray(issues, `${base}.populationStrategy`, cluster.populationStrategy, { requireNonEmpty: true, unique: true });
  });

  if (!Array.isArray(data.familyMappings)) {
    pushIssue(issues, 'referenceFamilyTaxonomy.familyMappings', 'must be an array');
    return;
  }
  if (data.familyMappings.length === 0) pushIssue(issues, 'referenceFamilyTaxonomy.familyMappings', 'must be a non-empty array');

  const mappedFamilies = new Set<string>();
  const clustersWithFamilies = new Set<string>();
  data.familyMappings.forEach((mapping, index) => {
    const base = `referenceFamilyTaxonomy.familyMappings[${index}]`;
    validateNonEmptyString(issues, `${base}.dishFamily`, mapping.dishFamily);
    if (isNonEmptyString(mapping.dishFamily)) {
      if (mappedFamilies.has(mapping.dishFamily)) pushIssue(issues, `${base}.dishFamily`, 'duplicate dish family mapping');
      mappedFamilies.add(mapping.dishFamily);
      if (!fixtureFamilies.has(mapping.dishFamily)) {
        pushIssue(issues, `${base}.dishFamily`, 'must reference a bundled fixture family');
      }
    }
    validateNonEmptyString(issues, `${base}.primaryCluster`, mapping.primaryCluster);
    if (isNonEmptyString(mapping.primaryCluster)) {
      if (!clusterIds.has(mapping.primaryCluster)) pushIssue(issues, `${base}.primaryCluster`, 'must reference a known family cluster');
      clustersWithFamilies.add(mapping.primaryCluster);
    }
    validateStringArray(issues, `${base}.supportClusters`, mapping.supportClusters, { unique: true });
    if (Array.isArray(mapping.supportClusters)) {
      mapping.supportClusters.forEach((clusterId, clusterIndex) => {
        if (isNonEmptyString(clusterId) && !clusterIds.has(clusterId)) {
          pushIssue(issues, `${base}.supportClusters[${clusterIndex}]`, 'must reference a known family cluster');
        }
      });
    }
    validateNumberRange(issues, `${base}.currentRecordCount`, mapping.currentRecordCount, 1, 10000);
    validateStringArray(issues, `${base}.currentRegions`, mapping.currentRegions, { requireNonEmpty: true, unique: true });
    validateCoverageTags(issues, `${base}.coverageTags`, mapping.coverageTags, validTags);
    validateNumberRange(issues, `${base}.targetRecordFloor`, mapping.targetRecordFloor, 1, 100);
    validateStringArray(issues, `${base}.targetDiversity`, mapping.targetDiversity, { requireNonEmpty: true, unique: true });
    if (!isNonEmptyString(mapping.populationPriority) || !VALID_POPULATION_PRIORITIES.has(mapping.populationPriority)) {
      pushIssue(issues, `${base}.populationPriority`, 'must be high, medium, or maintain');
    }
  });

  for (const family of fixtureFamilies) {
    if (!mappedFamilies.has(family)) {
      pushIssue(issues, 'referenceFamilyTaxonomy.familyMappings', `missing fixture family mapping: ${family}`);
    }
  }
  for (const clusterId of clusterIds) {
    if (!clustersWithFamilies.has(clusterId)) {
      pushIssue(issues, `referenceFamilyTaxonomy.clusters.${clusterId}`, 'must map at least one fixture family');
    }
  }
}

function validateInferenceBurdenInventory(issues: ValidationIssue[], data: InferenceBurdenInventory): void {
  validateMeta(issues, 'inferenceBurdenInventory.meta', data.meta);
  validateStringArray(issues, 'inferenceBurdenInventory.burdenTypes', data.burdenTypes, { requireNonEmpty: true, unique: true });
  validateStringArray(issues, 'inferenceBurdenInventory.deterministicOwners', data.deterministicOwners, { requireNonEmpty: true, unique: true });

  for (const [index, burdenType] of (Array.isArray(data.burdenTypes) ? data.burdenTypes : []).entries()) {
    if (isNonEmptyString(burdenType) && !VALID_INFERENCE_BURDEN_TYPES.has(burdenType as InferenceBurdenType)) {
      pushIssue(issues, `inferenceBurdenInventory.burdenTypes[${index}]`, 'must be a known burden type');
    }
  }
  for (const [index, owner] of (Array.isArray(data.deterministicOwners) ? data.deterministicOwners : []).entries()) {
    if (isNonEmptyString(owner) && !VALID_INFERENCE_OWNERS.has(owner)) {
      pushIssue(issues, `inferenceBurdenInventory.deterministicOwners[${index}]`, 'must be a known owner');
    }
  }

  if (!Array.isArray(data.burdens)) {
    pushIssue(issues, 'inferenceBurdenInventory.burdens', 'must be an array');
    return;
  }
  if (data.burdens.length === 0) pushIssue(issues, 'inferenceBurdenInventory.burdens', 'must be a non-empty array');

  const burdenIds = new Set<string>();
  data.burdens.forEach((burden, index) => {
    const base = `inferenceBurdenInventory.burdens[${index}]`;
    validateNonEmptyString(issues, `${base}.id`, burden.id);
    if (isNonEmptyString(burden.id)) {
      if (burdenIds.has(burden.id)) pushIssue(issues, `${base}.id`, 'duplicate burden id');
      burdenIds.add(burden.id);
    }
    validateNonEmptyString(issues, `${base}.title`, burden.title);
    if (!isNonEmptyString(burden.burdenType) || !VALID_INFERENCE_BURDEN_TYPES.has(burden.burdenType as InferenceBurdenType)) {
      pushIssue(issues, `${base}.burdenType`, 'must be a known burden type');
    }
    if (!isNonEmptyString(burden.deterministicOwner) || !VALID_INFERENCE_OWNERS.has(burden.deterministicOwner)) {
      pushIssue(issues, `${base}.deterministicOwner`, 'must be a known owner');
    }
    validateNumberRange(issues, `${base}.leverage`, burden.leverage, 1, 5);
    validateNumberRange(issues, `${base}.rigidityRisk`, burden.rigidityRisk, 1, 5);
    validateStringArray(issues, `${base}.currentSurfaceRefs`, burden.currentSurfaceRefs, { requireNonEmpty: true, unique: true });
    validateNonEmptyString(issues, `${base}.currentModelBurden`, burden.currentModelBurden);
    validateNonEmptyString(issues, `${base}.dataEngineeringMove`, burden.dataEngineeringMove);
    validateStringArray(issues, `${base}.candidateArtifacts`, burden.candidateArtifacts, { requireNonEmpty: true, unique: true });
    validateStringArray(issues, `${base}.promptRemovalTargets`, burden.promptRemovalTargets, { requireNonEmpty: true, unique: true });
    validateStringArray(issues, `${base}.acceptanceSignals`, burden.acceptanceSignals, { requireNonEmpty: true, unique: true });
    validateStringArray(issues, `${base}.preserveLatitude`, burden.preserveLatitude, { requireNonEmpty: true, unique: true });
    if (Array.isArray(burden.preserveLatitude) && burden.preserveLatitude.length < 2) {
      pushIssue(issues, `${base}.preserveLatitude`, 'must include at least 2 latitude-preserving notes');
    }
    validateStringArray(issues, `${base}.modelKeeps`, burden.modelKeeps, { requireNonEmpty: true, unique: true });
    validateNonEmptyString(issues, `${base}.riskIfOverRigid`, burden.riskIfOverRigid);
    if (!isNonEmptyString(burden.status) || !VALID_INFERENCE_STATUSES.has(burden.status)) {
      pushIssue(issues, `${base}.status`, 'must be candidate, partially_supported, or ready_to_extract');
    }
  });
}

export function validateCoreFoodData(data: Pick<BundledDataSet,
  'dishFamilies' |
  'ingredients' |
  'regionalAvailability' |
  'sensoryProfiles' |
  'memoryHints'
>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  validateDishFamilies(issues, data.dishFamilies);
  validateIngredients(issues, data.ingredients);
  validateRegionalAvailability(issues, data.regionalAvailability);
  validateSensoryProfiles(issues, data.sensoryProfiles);
  validateMemoryHints(issues, data.memoryHints);
  return issues;
}

export function validateOperatorData(data: Pick<BundledDataSet,
  'globalCoverageMatrix' |
  'referenceSeedQueue' |
  'cacheWarmingManifest' |
  'referenceSourceRegistry'
>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const validTags = validateGlobalCoverageMatrix(issues, data.globalCoverageMatrix);
  const seedIds = validateReferenceSeedQueue(issues, data.referenceSeedQueue, validTags);
  validateCacheWarmingManifest(issues, data.cacheWarmingManifest, validTags, seedIds);
  validateReferenceSourceRegistry(issues, data.referenceSourceRegistry);
  return issues;
}

export function validateReferencePantryData(data: Pick<BundledDataSet,
  'globalCoverageMatrix' |
  'referenceSeedQueue' |
  'cacheWarmingManifest' |
  'referenceSourceRegistry' |
  'referenceFamilyTaxonomy' |
  'referencePantryFixtures'
>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const validTags = validateGlobalCoverageMatrix(issues, data.globalCoverageMatrix);
  const seedIds = validateReferenceSeedQueue(issues, data.referenceSeedQueue, validTags);
  validateCacheWarmingManifest(issues, data.cacheWarmingManifest, validTags, seedIds);
  validateReferenceSourceRegistry(issues, data.referenceSourceRegistry);
  const fixtureFamilies = referencePantryFixtureFamilies(data);
  validateReferenceFamilyTaxonomy(issues, data.referenceFamilyTaxonomy, validTags, fixtureFamilies);
  validateReferencePantryPopulationSync(issues, data);
  return issues;
}

export function validateInferenceBurdenData(data: Pick<BundledDataSet, 'inferenceBurdenInventory'>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  validateInferenceBurdenInventory(issues, data.inferenceBurdenInventory);
  return issues;
}

export function validateBundledData(data: BundledDataSet): ValidationIssue[] {
  return [
    ...validateCoreFoodData(data),
    ...validateReferencePantryData(data),
    ...validateInferenceBurdenData(data),
  ];
}

function referencePantryFixtureFamilies(data: Pick<BundledDataSet,
  'cacheWarmingManifest' |
  'referencePantryFixtures'
>): Set<string> {
  const fixtureFamilies = new Set<string>();
  if (Array.isArray(data.referencePantryFixtures?.fixtures)) {
    for (const fixture of data.referencePantryFixtures.fixtures) {
      if (isRecord(fixture.cacheTarget) && isNonEmptyString(fixture.cacheTarget.dishFamily)) {
        fixtureFamilies.add(fixture.cacheTarget.dishFamily);
      }
    }
  } else {
    for (const task of data.cacheWarmingManifest.tasks ?? []) {
      if (isRecord(task.cacheTarget) && isNonEmptyString(task.cacheTarget.dishFamily)) {
        fixtureFamilies.add(task.cacheTarget.dishFamily);
      }
    }
  }
  return fixtureFamilies;
}

function validateReferencePantryPopulationSync(
  issues: ValidationIssue[],
  data: Pick<BundledDataSet, 'referenceFamilyTaxonomy' | 'referencePantryFixtures'>,
): void {
  if (!Array.isArray(data.referencePantryFixtures?.fixtures)) return;
  const fixtureCounts = new Map<string, number>();
  const targetKeys = new Set<string>();
  data.referencePantryFixtures.fixtures.forEach((fixture, index) => {
    const cacheTarget = isRecord(fixture.cacheTarget) ? fixture.cacheTarget : {};
    const dishFamily = isNonEmptyString(cacheTarget.dishFamily) ? cacheTarget.dishFamily : '';
    const region = isNonEmptyString(cacheTarget.region) ? cacheTarget.region : '';
    if (!dishFamily || !region) return;
    const targetKey = `${dishFamily}\u0000${region}`;
    if (targetKeys.has(targetKey)) {
      pushIssue(issues, `referencePantryFixtures.fixtures[${index}].cacheTarget`, 'duplicate fixture cache target');
    }
    targetKeys.add(targetKey);
    fixtureCounts.set(dishFamily, (fixtureCounts.get(dishFamily) ?? 0) + 1);
  });

  for (const [index, mapping] of data.referenceFamilyTaxonomy.familyMappings.entries()) {
    if (!isNonEmptyString(mapping.dishFamily)) continue;
    const fixtureCount = fixtureCounts.get(mapping.dishFamily) ?? 0;
    if (typeof mapping.currentRecordCount === 'number' && mapping.currentRecordCount !== fixtureCount) {
      pushIssue(
        issues,
        `referenceFamilyTaxonomy.familyMappings[${index}].currentRecordCount`,
        `taxonomy says ${mapping.currentRecordCount}, fixtures contain ${fixtureCount}`,
      );
    }
  }
}

export function validateCrossReferences(data: BundledDataSet): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const substitutionGroupMembers = new Map<string, string[]>();
  for (const [key, ingredient] of Object.entries(data.ingredients.ingredients)) {
    if (typeof ingredient.substitutionGroup === 'string') {
      const group = ingredient.substitutionGroup;
      if (!substitutionGroupMembers.has(group)) substitutionGroupMembers.set(group, []);
      substitutionGroupMembers.get(group)!.push(key);
    }
  }

  for (const [group, members] of substitutionGroupMembers) {
    if (members.length < 2) {
      pushIssue(issues, `ingredients.ingredients.${members[0]}.substitutionGroup`, `group "${group}" has only ${members.length} member(s) — substitutions will be limited`);
    }
  }

  return issues;
}
