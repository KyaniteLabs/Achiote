import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ResearchCache } from '../src/lib/research-cache.js';
import fs from 'node:fs';
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
});
