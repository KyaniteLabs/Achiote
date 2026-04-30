import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ResearchCache } from '../src/lib/research-cache.js';
import { getBundledReferenceResearch } from '../src/lib/reference-pantry.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, 'test-cache.db');

describe('ResearchCache', () => {
  let cache: ResearchCache;

  beforeEach(() => {
    cache = new ResearchCache(TEST_DB);
  });

  afterEach(() => {
    cache.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it('creates parent directories for new database paths', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'achiote-cache-parent-'));
    const nestedDb = path.join(tempRoot, 'nested', 'cache.db');
    const nestedCache = new ResearchCache(nestedDb);

    try {
      nestedCache.store('dumpling', 'Poland', '{"ok":true}');
      expect(fs.existsSync(nestedDb)).toBe(true);
      expect(nestedCache.get('dumpling', 'Poland')!.researchData).toBe('{"ok":true}');
    } finally {
      nestedCache.close();
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('stores and retrieves research data', () => {
    cache.store('stuffed-vegetables', 'Armenia', '{"key":"value"}');
    const entry = cache.get('stuffed-vegetables', 'Armenia');
    expect(entry).not.toBeNull();
    expect(entry!.researchData).toBe('{"key":"value"}');
  });

  it('returns null for uncached queries', () => {
    const entry = cache.get('nonexistent', 'nowhere');
    expect(entry).toBeNull();
  });

  it('increments hit count on retrieval', () => {
    cache.store('rice-dish', 'Pakistan', '{"data":1}');
    cache.get('rice-dish', 'Pakistan');
    cache.get('rice-dish', 'Pakistan');
    const entry = cache.get('rice-dish', 'Pakistan');
    expect(entry!.hitCount).toBe(3);
  });

  it('stores and retrieves typed research records as JSON', () => {
    const record = {
      dishName: 'pasteles',
      query: 'pasteles Puerto Rican holiday',
      sources: [
        {
          title: 'Source',
          url: 'https://example.org/source',
          sourceType: 'article',
          accessedAt: '2026-04-18T00:00:00.000Z',
          reliability: 'Medium',
          quotedFacts: ['Pasteles are a hypothesis to verify.'],
        },
      ],
      extractedFacts: {
        namesAndAliases: ['pasteles'],
        regions: ['Puerto Rican'],
        ingredients: ['banana leaves'],
        techniques: ['wrapped or steamed preparation'],
        sensoryDescriptors: ['leaf aroma'],
        culturalOccasions: [],
        regionalVariants: [],
      },
      uncertainty: ['family-specific version'],
      confidence: 'Medium',
      createdAt: '2026-04-18T00:00:00.000Z',
    };

    cache.storeResearchRecord('pasteles', 'Puerto Rico', record);

    expect(cache.getResearchRecord('pasteles', 'Puerto Rico')).toEqual(record);
  });

  it('returns null when cached JSON is corrupted', () => {
    cache.store('dumpling', 'China', 'not-valid-json{{{');
    expect(cache.getResearchRecord('dumpling', 'China')).toBeNull();
  });

  it('can read committed bundled pantry records without writing SQLite first', () => {
    const bundled = getBundledReferenceResearch('dumpling', 'Eastern Europe');

    expect(bundled).toMatchObject({
      source: 'bundled',
      entry: {
        dishFamily: 'dumpling',
        region: 'Global',
        hitCount: 0,
      },
    });
    expect(JSON.parse(bundled!.entry.researchData).dishName).toBe('dumpling');
  });

  it('rejects entries exceeding max data size', () => {
    const oversized = 'x'.repeat(513 * 1024);
    expect(() => cache.store('stew-braise', 'Morocco', oversized)).toThrow(/maximum cache entry size/);
  });

  it('rejects entries exceeding max data size with multi-byte characters', () => {
    // Each CJK character is 3 bytes in UTF-8
    const oversized = '\u{4E00}'.repeat(172 * 1024); // 172K chars * 3 bytes = 516 KB
    expect(() => cache.store('dumpling', 'China', oversized)).toThrow(/maximum cache entry size/);
  });
});
