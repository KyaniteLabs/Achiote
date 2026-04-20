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
  [key: string]: unknown;
};

type Ingredient = {
  name?: unknown;
  aliases?: unknown;
  compounds?: unknown;
  sensoryContribution?: { aroma?: unknown; flavor?: unknown };
  substitutionGroup?: unknown;
  commonIn?: unknown;
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

export type BundledDataSet = {
  dishFamilies: { meta: Meta; families: DishFamily[] };
  ingredients: { meta: Meta; ingredients: Record<string, Ingredient> };
  regionalAvailability: { meta: Meta; regions: Record<string, Region> };
  sensoryProfiles: {
    meta: Meta;
    dimensions: Record<string, SensoryDimension | undefined>;
    nostalgiaCriticalCriteria?: unknown;
  };
};

const VALID_CONFIDENCE = new Set(['High', 'Medium', 'Low']);
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
  }
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

export function validateBundledData(data: BundledDataSet): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  validateDishFamilies(issues, data.dishFamilies);
  validateIngredients(issues, data.ingredients);
  validateRegionalAvailability(issues, data.regionalAvailability);
  validateSensoryProfiles(issues, data.sensoryProfiles);
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
