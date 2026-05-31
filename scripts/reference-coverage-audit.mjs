#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function axisIds(matrix, axisName) {
  return (matrix.axes?.[axisName]?.values ?? []).map((entry) => entry.id).filter(Boolean);
}

function countTags(records, prefix) {
  const counts = Object.create(null);
  for (const record of records) {
    for (const tag of record.coverageTags ?? []) {
      if (typeof tag !== 'string') continue;
      const marker = `${prefix}.`;
      if (!tag.startsWith(marker)) continue;
      const id = tag.slice(marker.length);
      counts[id] = (counts[id] ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function issue(issues, path, message) {
  issues.push({ path, message });
}

function arrayValues(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim()) : [];
}

function nameFormEntries(block) {
  if (Array.isArray(block)) return block;
  if (block && typeof block === 'object' && Array.isArray(block.forms)) return block.forms;
  return [];
}

function hasNameSystemBlock(block) {
  if (!block || typeof block !== 'object') return false;
  if (nameFormEntries(block).length > 0) return true;
  return block.status === 'not_applicable' && typeof block.rationale === 'string' && block.rationale.trim().length > 0;
}

function audit() {
  const matrix = readJson('src/data/global-coverage-matrix.json');
  const dishFamilies = readJson('src/data/dish-families.json');
  const ingredients = readJson('src/data/ingredients.json');
  const regionalAvailability = readJson('src/data/regional-availability.json');
  const foodScience = readJson('src/data/food-science-references.json');
  const referenceFamilyTaxonomy = readJson('src/data/reference-family-taxonomy.json');

  const issues = [];
  const warnings = [];
  const cultureAreas = axisIds(matrix, 'cultureAreas');
  const foodForms = axisIds(matrix, 'foodForms');
  const nameSystems = axisIds(matrix, 'nameSystems');
  const mechanisms = axisIds(matrix, 'mechanisms');
  const taxonomyRecords = referenceFamilyTaxonomy.familyMappings ?? [];

  const cultureCounts = countTags(taxonomyRecords, 'cultureAreas');
  for (const id of cultureAreas) {
    if ((cultureCounts[id] ?? 0) < 8) {
      issue(issues, `referenceFamilyTaxonomy.coverageTags.cultureAreas.${id}`, `must have at least 8 tagged family mappings, found ${cultureCounts[id] ?? 0}`);
    }
  }

  const foodFormCounts = countTags(taxonomyRecords, 'foodForms');
  for (const id of foodForms) {
    if ((foodFormCounts[id] ?? 0) < 1) {
      issue(issues, `referenceFamilyTaxonomy.coverageTags.foodForms.${id}`, 'must have at least one tagged family mapping');
    }
  }

  const mechanismTagCounts = countTags(taxonomyRecords, 'mechanisms');
  for (const id of mechanisms) {
    if ((mechanismTagCounts[id] ?? 0) < 1) {
      issue(issues, `referenceFamilyTaxonomy.coverageTags.mechanisms.${id}`, 'must have at least one tagged family mapping');
    }
  }

  for (const [index, family] of (dishFamilies.families ?? []).entries()) {
    const familyId = family.canonicalName ?? index;
    const base = `dishFamilies.families.${familyId}`;
    const familyFoodForms = arrayValues(family.foodForms);
    if (familyFoodForms.length === 0) {
      issue(issues, `${base}.foodForms`, 'must tag at least one global food form');
    }
    for (const form of familyFoodForms) {
      if (!foodForms.includes(form)) {
        issue(issues, `${base}.foodForms`, `unknown food form ${form}`);
      }
    }

    if (!family.nameForms || typeof family.nameForms !== 'object') {
      issue(issues, `${base}.nameForms`, 'must include all matrix name systems');
      continue;
    }
    for (const id of nameSystems) {
      if (!hasNameSystemBlock(family.nameForms[id])) {
        issue(issues, `${base}.nameForms.${id}`, 'must include forms, or a not_applicable status with rationale');
      }
    }
  }

  const allergenKeys = ['peanut', 'treeNut', 'milk', 'egg', 'wheatGluten', 'soy', 'shellfish', 'fish', 'sesame'];
  const ingredientEntries = Object.entries(ingredients.ingredients ?? {});
  for (const [key, ingredient] of ingredientEntries) {
    const flags = ingredient.allergenFlags?.contains;
    if (!flags || typeof flags !== 'object') {
      issue(issues, `ingredients.ingredients.${key}.allergenFlags.contains`, 'must include common allergen booleans');
      continue;
    }
    for (const allergen of allergenKeys) {
      if (typeof flags[allergen] !== 'boolean') {
        issue(issues, `ingredients.ingredients.${key}.allergenFlags.contains.${allergen}`, 'must be a boolean');
      }
    }
  }
  if (ingredientEntries.length < 200) {
    warnings.push({
      path: 'ingredients.ingredients',
      message: `long-term target is at least 200 ingredients; current committed count is ${ingredientEntries.length}`,
    });
  }

  const coveredMechanisms = new Set();
  for (const [key, record] of Object.entries(foodScience.mechanisms ?? {})) {
    for (const id of arrayValues(record.coverageMechanisms)) coveredMechanisms.add(id);
    if (!Array.isArray(record.sources) || record.sources.length === 0) {
      issue(issues, `foodScience.mechanisms.${key}.sources`, 'must include at least one cited source');
    }
  }
  for (const id of mechanisms) {
    if (!coveredMechanisms.has(id)) {
      issue(issues, `foodScience.mechanisms.${id}`, 'must have at least one sourced food-science record');
    }
  }

  const layers = regionalAvailability.layers;
  if (!layers || typeof layers !== 'object') {
    issue(issues, 'regionalAvailability.layers', 'must define layered sourcing fallback');
  } else {
    const worldwide = layers.worldwide;
    if (!worldwide || typeof worldwide !== 'object') {
      issue(issues, 'regionalAvailability.layers.worldwide', 'must define a worldwide fallback');
    } else {
      if (arrayValues(worldwide.degradeOrder).length < 4) {
        issue(issues, 'regionalAvailability.layers.worldwide.degradeOrder', 'must list a multi-step sourcing ladder');
      }
      if (!worldwide.majorStores || typeof worldwide.majorStores !== 'object') {
        issue(issues, 'regionalAvailability.layers.worldwide.majorStores', 'must provide broad store or source categories');
      }
      if (!Array.isArray(worldwide.majorEthnicCorridors) || worldwide.majorEthnicCorridors.length === 0) {
        issue(issues, 'regionalAvailability.layers.worldwide.majorEthnicCorridors', 'must provide broad market categories');
      }
    }
  }

  return {
    ok: issues.length === 0,
    generatedAt: new Date().toISOString(),
    thresholds: {
      cultureAreaFamilyMappings: 8,
      foodFormTaggedMappings: 1,
      mechanismTaggedMappings: 1,
      ingredientLongTermTarget: 200,
    },
    counts: {
      dishFamilies: dishFamilies.families?.length ?? 0,
      ingredients: ingredientEntries.length,
      foodScienceMechanismRecords: Object.keys(foodScience.mechanisms ?? {}).length,
      regionalMetroRecords: Object.keys(regionalAvailability.regions ?? {}).length,
      cultureAreas: cultureCounts,
      foodForms: foodFormCounts,
      mechanisms: mechanismTagCounts,
    },
    issues,
    warnings,
  };
}

const report = audit();
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--fail') && !report.ok) {
  process.exitCode = 1;
}
