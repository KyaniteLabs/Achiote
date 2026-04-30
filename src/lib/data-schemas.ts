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
};

const VALID_CONFIDENCE = new Set(['High', 'Medium', 'Low']);
const VALID_FIXTURE_POLICIES = new Set(['allowed', 'manual_review', 'rejected']);
const REQUIRED_SENSORY_DIMENSIONS = ['aroma', 'texture', 'flavor', 'visual', 'temperature'];

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
  options: { requireNonEmpty?: boolean } = { requireNonEmpty: true },
): void {
  validateStringArray(issues, path, value, { requireNonEmpty: options.requireNonEmpty, unique: true });
  if (!Array.isArray(value)) return;
  value.forEach((tag, index) => {
    if (isNonEmptyString(tag) && !validTags.has(tag)) {
      pushIssue(issues, `${path}[${index}]`, 'unknown coverage tag');
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
    validateCoverageTags(issues, `${base}.forms`, seed.forms, validTags);
    validateStringArray(issues, `${base}.regions`, seed.regions, { requireNonEmpty: true, unique: true });
    validateStringArray(issues, `${base}.nameSignals`, seed.nameSignals, { requireNonEmpty: true, unique: true });
    validateCoverageTags(issues, `${base}.mechanisms`, seed.mechanisms, validTags);
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

export function validateBundledData(data: BundledDataSet): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  validateDishFamilies(issues, data.dishFamilies);
  validateIngredients(issues, data.ingredients);
  validateRegionalAvailability(issues, data.regionalAvailability);
  validateSensoryProfiles(issues, data.sensoryProfiles);
  validateMemoryHints(issues, data.memoryHints);
  const validTags = validateGlobalCoverageMatrix(issues, data.globalCoverageMatrix);
  const seedIds = validateReferenceSeedQueue(issues, data.referenceSeedQueue, validTags);
  validateCacheWarmingManifest(issues, data.cacheWarmingManifest, validTags, seedIds);
  validateReferenceSourceRegistry(issues, data.referenceSourceRegistry);
  return issues;
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
