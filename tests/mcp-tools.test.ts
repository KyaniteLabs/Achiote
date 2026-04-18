import { describe, it, expect } from 'vitest';
import { resolveDishName } from '../src/lib/name-resolver.js';
import { findSubstitutes } from '../src/lib/substitution-engine.js';
import { ResearchCache } from '../src/lib/research-cache.js';
import type { RecipeOutput, Confidence } from '../src/lib/types.js';
import sensoryProfilesData from '../src/data/sensory-profiles.json' with { type: 'json' };
import regionalData from '../src/data/regional-availability.json' with { type: 'json' };
import dishFamiliesData from '../src/data/dish-families.json' with { type: 'json' };
import path from 'path';
import fs from 'fs';
import os from 'os';

// ---------------------------------------------------------------------------
// 1. resolve_dish_name integration
// ---------------------------------------------------------------------------
describe('resolve_dish_name integration', () => {
  it('resolves pierogi to dumpling family with aliases', () => {
    const result = resolveDishName('pierogi');
    expect(result.canonicalName).toBe('dumpling');
    expect(result.aliases).toContain('varenyky');
    expect(result.aliases).toContain('mandu');
    expect(result.confidence).toBe('High');
    expect(result.input).toBe('pierogi');
  });

  it('resolves dolma to stuffed-vegetables family', () => {
    const result = resolveDishName('dolma');
    expect(result.canonicalName).toBe('stuffed-vegetables');
    expect(result.aliases).toContain('sarma');
  });

  it('returns unknown for unrecognized dish', () => {
    const result = resolveDishName('totally-unknown-dish-xyz');
    expect(result.canonicalName).toBe('totally-unknown-dish-xyz');
    expect(result.confidence).toBe('Low');
    expect(result.dishFamily).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// 2. analyze_nostalgic_dish data integration
// ---------------------------------------------------------------------------
describe('analyze_nostalgic_dish data integration', () => {
  it('sensory profiles contain all 5 dimensions', () => {
    const dimensions = Object.keys(sensoryProfilesData.dimensions);
    expect(dimensions).toContain('aroma');
    expect(dimensions).toContain('texture');
    expect(dimensions).toContain('flavor');
    expect(dimensions).toContain('visual');
    expect(dimensions).toContain('temperature');
  });

  it('each dimension has required fields', () => {
    for (const [, dim] of Object.entries(sensoryProfilesData.dimensions)) {
      expect(dim).toHaveProperty('description');
      expect(dim).toHaveProperty('nostalgiaIndicators');
      expect(Array.isArray(dim.nostalgiaIndicators)).toBe(true);
    }
  });

  it('nostalgia critical criteria exists', () => {
    expect(sensoryProfilesData.nostalgiaCriticalCriteria).toBeTruthy();
    expect(typeof sensoryProfilesData.nostalgiaCriticalCriteria).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// 3. find_sensory_substitutes integration
// ---------------------------------------------------------------------------
describe('find_sensory_substitutes integration', () => {
  it('finds real substitutes for cumin seeds', () => {
    const results = findSubstitutes('cumin-seeds');
    expect(results.length).toBeGreaterThan(0);
    // Turmeric should be a substitute (same warm-spice group)
    const turmeric = results.find(r => r.substitute === 'Turmeric');
    expect(turmeric).toBeDefined();
    expect(turmeric!.confidence).toMatch(/^(High|Medium|Low)$/);
  });

  it('finds substitutes with compound match data', () => {
    const results = findSubstitutes('fish-sauce');
    expect(results.length).toBeGreaterThan(0);
    // Fish sauce and soy sauce share glutamate compounds
    const soy = results.find(r => r.substitute === 'Soy Sauce');
    expect(soy).toBeDefined();
    expect(soy!.compoundMatch).toBeGreaterThan(0);
    expect(soy!.reasoning).toContain('glutamate');
  });

  it('returns empty for unknown ingredient', () => {
    const results = findSubstitutes('totally-unknown-ingredient');
    expect(results).toEqual([]);
  });

  it('all substitutes have required fields', () => {
    const results = findSubstitutes('cumin-seeds');
    for (const sub of results) {
      expect(sub).toHaveProperty('original');
      expect(sub).toHaveProperty('substitute');
      expect(sub).toHaveProperty('compoundMatch');
      expect(sub).toHaveProperty('confidence');
      expect(sub).toHaveProperty('reasoning');
      expect(sub).toHaveProperty('availableAt');
      expect(typeof sub.compoundMatch).toBe('number');
      expect(['High', 'Medium', 'Low']).toContain(sub.confidence);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. source_ingredients regional data integration
// ---------------------------------------------------------------------------
describe('source_ingredients regional data integration', () => {
  it('has 5 US regions', () => {
    const regions = Object.keys(regionalData.regions);
    expect(regions).toHaveLength(5);
    expect(regions).toContain('southern-california');
    expect(regions).toContain('bay-area');
    expect(regions).toContain('new-york-metro');
    expect(regions).toContain('chicago-metro');
    expect(regions).toContain('texas-metro');
  });

  it('each region has required data fields', () => {
    for (const [, region] of Object.entries(regionalData.regions)) {
      expect(Array.isArray(region.cities)).toBe(true);
      expect(region.cities.length).toBeGreaterThan(0);
      expect(Array.isArray(region.majorEthnicCorridors)).toBe(true);
      expect(region.majorEthnicCorridors.length).toBeGreaterThan(0);
      expect(region.majorStores).toBeTruthy();
      // Each corridor has name, city, cuisines
      for (const corridor of region.majorEthnicCorridors) {
        expect(corridor).toHaveProperty('name');
        expect(corridor).toHaveProperty('city');
        expect(corridor).toHaveProperty('cuisines');
        expect(Array.isArray(corridor.cuisines)).toBe(true);
      }
    }
  });

  it('findMatchingRegion logic works for known cities', () => {
    const regions = regionalData.regions;
    const socal = regions['southern-california'];
    expect(socal.cities).toContain('Los Angeles');

    const ny = regions['new-york-metro'];
    expect(ny.cities).toContain('New York City');
  });
});

// ---------------------------------------------------------------------------
// 5. discover_regional_similars family data integration
// ---------------------------------------------------------------------------
describe('discover_regional_similars family data integration', () => {
  it('dish families have required structural data', () => {
    for (const family of dishFamiliesData.families) {
      expect(family).toHaveProperty('canonicalName');
      expect(family).toHaveProperty('aliases');
      expect(family).toHaveProperty('sharedElements');
      expect(family).toHaveProperty('divergentElements');
      expect(family).toHaveProperty('nostalgiaTriggers');
      expect(family).toHaveProperty('regions');
      expect(Array.isArray(family.sharedElements)).toBe(true);
      expect(family.sharedElements.length).toBeGreaterThan(0);
    }
  });

  it('resolved dish maps to family with elements', () => {
    const resolution = resolveDishName('biryani');
    const family = dishFamiliesData.families.find(
      f => f.canonicalName === resolution.canonicalName,
    );
    expect(family).toBeDefined();
    expect(family!.sharedElements).toContain('rice as base');
    expect(family!.nostalgiaTriggers.length).toBeGreaterThan(0);
  });

  it('sarma resolves to stuffed-vegetables with correct family data', () => {
    const resolution = resolveDishName('sarma');
    expect(resolution.canonicalName).toBe('stuffed-vegetables');
    const family = dishFamiliesData.families.find(
      f => f.canonicalName === 'stuffed-vegetables',
    );
    expect(family!.divergentElements).toContain(
      'wrapper type (grape leaf vs cabbage vs pepper)',
    );
  });
});

// ---------------------------------------------------------------------------
// 6. generate_recipe schema integration
// ---------------------------------------------------------------------------
describe('generate_recipe schema integration', () => {
  it('RecipeOutput type is complete', () => {
    const recipe: RecipeOutput = {
      title: 'Recreated Pierogi',
      yield: '4 servings',
      prepTime: '45 minutes',
      cookTime: '20 minutes',
      ingredients: [
        { item: 'flour', amount: '2 cups' },
        { item: 'potato', amount: '3 medium', notes: 'russet preferred' },
      ],
      steps: ['Make dough', 'Prepare filling', 'Fill and seal', 'Boil'],
      sensoryAnalysis: 'The nostalgia trigger is the dough texture...',
      confidencePerElement: {
        doughTexture: 'High' as Confidence,
        fillingFlavor: 'Medium' as Confidence,
      },
      whatsDifferent:
        'Using locally available flour instead of Polish type 450',
    };
    expect(recipe.title).toBeTruthy();
    expect(recipe.ingredients.length).toBeGreaterThan(0);
    expect(recipe.steps.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 7. ResearchCache integration with MCP tools pattern
// ---------------------------------------------------------------------------
describe('ResearchCache integration with MCP tools pattern', () => {
  it('cache stores and retrieves research for dish families', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'member-berries-mcp-cache-'));
    const dbPath = path.join(tempRoot, 'test-mcp-cache.db');
    const testCache = new ResearchCache(dbPath);

    try {
      testCache.store(
        'dumpling',
        'Eastern Europe',
        JSON.stringify({
          dishes: ['pierogi', 'varenyky', 'pelmeni'],
          notes: 'Research cached for Eastern European dumpling family',
        }),
      );

      const result = testCache.get('dumpling', 'Eastern Europe');
      expect(result).not.toBeNull();
      expect(result!.dishFamily).toBe('dumpling');

      const data = JSON.parse(result!.researchData);
      expect(data.dishes).toContain('pierogi');
    } finally {
      testCache.close();
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('cache miss returns null', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'member-berries-mcp-cache-miss-'));
    const dbPath = path.join(tempRoot, 'test-mcp-cache-miss.db');
    const testCache = new ResearchCache(dbPath);

    try {
      const result = testCache.get('nonexistent', 'nowhere');
      expect(result).toBeNull();
    } finally {
      testCache.close();
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
